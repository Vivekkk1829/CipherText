import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getSocket } from "../api/socket";
import { encryptMessage, decryptMessage } from "../utils/crypto.js";

/* ----------------------------------------------------------------
   HELPER FUNCTIONS
---------------------------------------------------------------- */
const isSameDay = (d1, d2) => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

const formatDateLabel = (dateString) => {
  if (!dateString) return ""; 
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/* 🔥 FIXED SORTING HELPER 🔥 */
/* Prioritizes Date first. Uses Sequence only as a tie-breaker. */
const sortMessages = (msgs) => {
    return [...msgs].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

        // 1. Primary Sort: Always respect Time first
        if (dateA !== dateB) {
            return dateA - dateB;
        }

        // 2. Secondary Sort: Tie-breaker for same millisecond
        // (Only strictly order by sequence if times are identical)
        if (a.sender === b.sender && a.clientSeq && b.clientSeq) {
            return a.clientSeq - b.clientSeq;
        }

        return 0;
    });
};

export default function Chat() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  const chatRef = useRef(null);
  const lastMessageRef = useRef(null);
  const profileRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const expectedSeqRef = useRef(0);   
  const bufferRef = useRef({});       
  const pendingStatusUpdatesRef = useRef({}); 
  
  // 🆕 TIMER REF for Gap Skimming
  const gapTimeoutRef = useRef(null);

  const [myClientSeq, setMyClientSeq] = useState(0);

  const [showMyProfile, setShowMyProfile] = useState(false);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);

  /* ---------------- INIT ---------------- */
  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
  }, []);

  const handleLogout = async () => {
    localStorage.removeItem("chat_private_key");
    await api.post("/auth/logout");
    navigate("/", { replace: true });
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowMyProfile(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ---------------- FETCH USERS ---------------- */
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get("/getUsers");
        setUsers(res.data.users);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, []);

  /* ---------------- GAP RECOVERY ---------------- */
  const executeGapRecovery = async () => {
      if (!selectedUser) return;
      console.warn("Gap Timer Expired. Executing Recovery Fetch...");

      try {
          const res = await api.get(`/messages/${selectedUser._id}`);
          const serverMessages = res.data.messages;

          setMessages(prev => {
              // Merge & Deduplicate
              const combined = [...prev, ...serverMessages];
              const unique = combined.filter((v,i,a)=>a.findIndex(t=>(t._id === v._id))===i);
              return sortMessages(unique);
          });

          // Sync Sequence
          const lastSeen = res.data.theirLastClientSeq || 0;
          if (lastSeen >= expectedSeqRef.current) {
              expectedSeqRef.current = lastSeen + 1;
          }

          // Cleanup
          bufferRef.current = {};
          if (gapTimeoutRef.current) {
              clearTimeout(gapTimeoutRef.current);
              gapTimeoutRef.current = null;
          }
      } catch (err) {
          console.error("Gap recovery failed:", err);
      }
  };

  /* ---------------- PROCESS INCOMING ---------------- */
  const processRealTimeMessage = (msg) => {
      if (msg.sender === user._id) return [msg];

      const incoming = msg.clientSeq;
      const expected = expectedSeqRef.current;
      const validBatch = [];

      console.log(`Processing #${incoming}. Expecting #${expected}`);

      // 🛑 1. BOUNDS CHECK: Gap too huge? (> 50)
      if (incoming - expected > 50) {
          console.warn("Gap > 50. Forcing full reload.");
          if (gapTimeoutRef.current) clearTimeout(gapTimeoutRef.current);
          fetchMessages(selectedUser._id);
          return [];
      }

      if (incoming === expected) {
          // ✅ Exact match
          validBatch.push(msg);
          let next = incoming + 1;
          
          // 🛑 2. SUCCESS: Cancel Gap Timer
          if (gapTimeoutRef.current) {
              clearTimeout(gapTimeoutRef.current);
              gapTimeoutRef.current = null;
          }

          // ♻️ Flush Buffer
          while (bufferRef.current[next]) {
              console.log(`Flushing buffered #${next}`);
              validBatch.push(bufferRef.current[next]);
              delete bufferRef.current[next];
              next++;
          }
          expectedSeqRef.current = next;
      } 
      else if (incoming > expected) {
          // ⚠️ Gap detected -> Buffer it
          console.warn(`Gap! Got #${incoming}, need #${expected}. Buffering.`);
          bufferRef.current[incoming] = msg;

          // 🛑 3. BUFFER CHECK: Too many items? (> 10)
          if (Object.keys(bufferRef.current).length > 10) {
              executeGapRecovery();
              return [];
          }

          // 🛑 4. START TIMER: Wait 5 seconds
          if (!gapTimeoutRef.current) {
              gapTimeoutRef.current = setTimeout(() => {
                  executeGapRecovery();
              }, 5000);
          }
      } 
      else {
          // ⚠️ OLD MESSAGE
          validBatch.push(msg);
      }
      return validBatch;
  };

  /* ---------------- FETCH MESSAGES ---------------- */
  const fetchMessages = async (userId) => {
    setLoadingMessages(true);
    setMessages([]);
    setNextCursor(null);
    setIsTyping(false);
    
    setMyClientSeq(0);
    expectedSeqRef.current = 0;
    bufferRef.current = {};
    pendingStatusUpdatesRef.current = {}; 
    
    // Cleanup Timer
    if (gapTimeoutRef.current) {
        clearTimeout(gapTimeoutRef.current);
        gapTimeoutRef.current = null;
    }

    const res = await api.get(`/messages/${userId}`);
    
    const sortedHistory = sortMessages(res.data.messages);
    setMessages(sortedHistory);
    setNextCursor(res.data.nextCursor);
    
    // Sync Delivery Status
    const socket = getSocket();
    if (socket) {
        res.data.messages.forEach(msg => {
            if (msg.receiver === user._id && msg.status !== 'seen' && msg.status !== 'delivered') {
                socket.emit("mark_delivered", { messageId: msg._id, senderId: msg.sender });
            }
        });
    }
    
    if (res.data.myLastClientSeq) {
        setMyClientSeq(res.data.myLastClientSeq);
    }

    const lastSeen = res.data.theirLastClientSeq || 0;
    expectedSeqRef.current = lastSeen + 1;

    setLoadingMessages(false);
  };

  const fetchOlderMessages = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const prevHeight = chatRef.current.scrollHeight;
    
    const res = await api.get(`/messages/${selectedUser._id}?cursor=${nextCursor}`);
    // Combine and Sort
    const combined = [...res.data.messages, ...messages];
    const sorted = sortMessages(combined); 
    
    setMessages(sorted);
    setNextCursor(res.data.nextCursor);
    
    requestAnimationFrame(() => {
      if (chatRef.current) {
        const newHeight = chatRef.current.scrollHeight;
        chatRef.current.scrollTop = newHeight - prevHeight;
      }
    });
    setLoadingMore(false);
  };

  /* ---------------- HANDLE TYPING ---------------- */
  const handleInputCallback = (e) => {
    setMessageText(e.target.value);
    const socket = getSocket();
    if (!socket || !selectedUser) return;
    socket.emit("typing", { senderId: user._id, receiverId: selectedUser._id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
        socket.emit("stop_typing", { senderId: user._id, receiverId: selectedUser._id });
    }, 2000);
  };

  /* ---------------- SEND RETRY ---------------- */
  const sendWithRetry = async (packet, attempt = 1) => {
      const maxRetries = 5;
      
      setMessages(prev => prev.map(msg => 
          msg._id === packet.tempId ? { ...msg, status: "pending" } : msg
      ));

      try {
          const res = await api.post(`/messages/${packet.receiverId}`, {
             content: packet.content,
             iv: packet.iv,
             clientSeq: packet.clientSeq
          });

          if (res.data.success) {
              const realMessage = res.data.message;

              if (pendingStatusUpdatesRef.current[realMessage._id]) {
                  realMessage.status = pendingStatusUpdatesRef.current[realMessage._id];
                  delete pendingStatusUpdatesRef.current[realMessage._id];
              }

              setMessages(prev => {
                const exists = prev.some(m => m._id === realMessage._id);
                if (exists) return prev.filter(m => m._id !== packet.tempId);
                
                const updated = prev.map(msg => msg._id === packet.tempId ? { ...realMessage } : msg);
                return sortMessages(updated);
              });
          }
      } catch (error) {
          if (attempt < maxRetries) {
              setTimeout(() => sendWithRetry(packet, attempt + 1), 1000 * attempt);
          } else {
              setMessages(prev => prev.map(msg => 
                  msg._id === packet.tempId ? { ...msg, status: "failed" } : msg
              ));
          }
      }
  };

  /* ---------------- SEND MESSAGE ---------------- */
  const handleSendMessage = async () => {
    if (!messageText.trim()) return;

    const socket = getSocket();
    if (socket && typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        socket.emit("stop_typing", { senderId: user._id, receiverId: selectedUser._id });
    }

    const myPrivateKey = localStorage.getItem("chat_private_key");
    const theirPublicKey = selectedUser?.publicKey;
    if (!myPrivateKey || !theirPublicKey) { alert("Keys missing."); return; }
    
    const encryptedData = encryptMessage(messageText, myPrivateKey, theirPublicKey);
    if (!encryptedData) { alert("Encryption failed"); return; }
    
    const nextSeq = myClientSeq + 1;
    setMyClientSeq(nextSeq);

    const tempId = Date.now().toString(); 
    
    const packet = {
      receiverId: selectedUser._id,
      content: encryptedData.content,
      iv: encryptedData.iv,
      tempId: tempId,
      clientSeq: nextSeq 
    };

    const optimisticMessage = {
        _id: tempId,
        sender: user._id,
        receiver: selectedUser._id,
        content: encryptedData.content,
        iv: encryptedData.iv,
        createdAt: new Date().toISOString(),
        status: "pending", 
        isEncrypted: true,
        clientSeq: nextSeq,
        retryPacket: packet 
    };

    setMessages(prev => sortMessages([...prev, optimisticMessage]));
    setMessageText("");

    sendWithRetry(packet);
  };
  
  const handleManualRetry = (msg) => {
      if (!msg.retryPacket) return; 
      sendWithRetry(msg.retryPacket);
  };

  useLayoutEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages, isTyping]);

  const handleScroll = () => {
    if (chatRef.current.scrollTop === 0) fetchOlderMessages();
  };

  /* ---------------- SOCKET LISTENERS ---------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return; 

    const handleNewMessage = (message) => {
      if (selectedUser && message.sender === selectedUser._id) setIsTyping(false);

      if (message.receiver === user._id) {
          socket.emit("mark_delivered", { messageId: message._id, senderId: message.sender });
      }

      const isCurrentChat = selectedUser && (
          message.sender === selectedUser._id || message.receiver === selectedUser._id
      );

      if (isCurrentChat) {
        const validMessages = processRealTimeMessage(message);

        if (validMessages.length > 0) {
            setMessages((prev) => {
                const uniqueIds = validMessages.filter(n => !prev.some(p => p._id === n._id));
                const trulyNew = uniqueIds.filter(n => {
                    const alreadyHasSeq = prev.some(p => p.sender === n.sender && p.clientSeq === n.clientSeq);
                    return !alreadyHasSeq;
                });
                if (trulyNew.length === 0) return prev;
                return sortMessages([...prev, ...trulyNew]);
            });

            if (message.receiver === user._id) {
                socket.emit("mark_seen", { senderId: message.sender, receiverId: user._id });
            }
        }
      } 
      else if (message.receiver === user._id) {
         setUsers(prev => prev.map(u => {
             if (u._id === message.sender) {
                 return { ...u, unreadCount: (u.unreadCount || 0) + 1 };
             }
             return u;
         }));
      }

      if (message.receiver === user._id) {
          if (document.hidden || !isCurrentChat) {
             if (Notification.permission === "granted") {
                 const senderName = users.find(u => u._id === message.sender)?.userName || "Someone";
                 new Notification("New Message", { 
                     body: `${senderName} sent you a message`,
                     icon: "/vite.svg" 
                 });
             }
          }
      }
    };

    const handleUserTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) setIsTyping(true);
    };
    const handleUserStoppedTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) setIsTyping(false);
    };
    const handleMessageSent = (message) => {
        if (selectedUser && message.receiver === selectedUser._id) {
          setMessages((prev) => {
              if (prev.some(m => m._id === message._id)) return prev;
              
              if (pendingStatusUpdatesRef.current[message._id]) {
                  message.status = pendingStatusUpdatesRef.current[message._id];
                  delete pendingStatusUpdatesRef.current[message._id];
              }
              return sortMessages([...prev, message]);
          });
        }
    };
    
    const handleStatusUpdate = (payload) => {
        const { messageId, _id, status } = payload;
        const targetId = messageId || _id;

        setMessages(prev => {
            const exists = prev.some(m => m._id === targetId);
            if (exists) {
                return prev.map(msg => {
                    if (msg._id === targetId) {
                        if (msg.status === "seen" && status === "delivered") return msg;
                        return { ...msg, status };
                    }
                    return msg;
                });
            } else {
                pendingStatusUpdatesRef.current[targetId] = status;
                return prev;
            }
        });
    };

    const handleMessagesSeen = ({ conversationId, status }) => {
        if (selectedUser && conversationId == selectedUser._id) { 
            setMessages(prev => prev.map(msg => 
                msg.sender === user._id ? { ...msg, status: "seen" } : msg
            ));
        }
    };
    const handleOnlineUsers = (ids) => {
        setOnlineUsers(ids);
    };

    socket.on("new_message", handleNewMessage);
    socket.on("message_sent", handleMessageSent);
    socket.on("message_status_update", handleStatusUpdate);
    socket.on("messages_seen_update", handleMessagesSeen);
    socket.on("user_typing", handleUserTyping);
    socket.on("user_stopped_typing", handleUserStoppedTyping);
    socket.on("get_online_users", handleOnlineUsers);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("message_sent", handleMessageSent);
      socket.off("message_status_update", handleStatusUpdate);
      socket.off("messages_seen_update", handleMessagesSeen);
      socket.off("user_typing", handleUserTyping);
      socket.off("user_stopped_typing", handleUserStoppedTyping);
      socket.off("get_online_users", handleOnlineUsers);
      
      if (gapTimeoutRef.current) clearTimeout(gapTimeoutRef.current);
    };
  }, [selectedUser, user._id, users]); 


  /* ---------------- UI RENDER ---------------- */
  const renderMessageStatus = (status, msg) => {
    if (status === "failed") {
        return (
            <button 
                onClick={() => handleManualRetry(msg)}
                className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors shadow-sm"
                title="Retry"
            >
                <span className="text-[10px] text-white font-bold">↻</span>
            </button>
        );
    }
    
    if (status === "pending") {
        return (
             <div className="w-4 h-4 rounded-full border border-slate-500 flex items-center justify-center" title="Sending...">
                <div className="w-2 h-[1px] bg-slate-500 rotate-45"></div>
             </div>
        );
    }

    if (status === "sent") {
        return (
             <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600" title="Sent">
                <span className="text-[9px] text-slate-300">✓</span>
             </div>
        );
    }
    
    if (status === "delivered") {
         return (
             <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600" title="Delivered">
                <span className="text-[9px] text-slate-300 tracking-tighter">✓✓</span>
             </div>
        );
    }
    
    if (status === "seen") {
         return (
             <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center border border-cyan-500/30" title="Seen">
                <span className="text-[9px] text-cyan-400 tracking-tighter shadow-[0_0_5px_rgba(34,211,238,0.4)]">✓✓</span>
             </div>
        );
    }
    
    return null;
  };

  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">
      <aside className={`bg-slate-900 border-r border-slate-800 flex-col ${selectedUser ? "hidden lg:flex lg:w-72" : "flex w-full lg:w-72"}`}>
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-semibold text-lg">CipherText</h2>
        </div>
        <div className="overflow-y-auto h-full pb-20">
          {loadingUsers ? <p className="p-4 text-slate-400">Loading users...</p> : users.map((u) => {
              const isOnline = onlineUsers.includes(u._id);
              return (
                <div key={u._id} onClick={() => {
                        setSelectedUser(u);
                        fetchMessages(u._id);
                        setUsers(prev => prev.map(user => user._id === u._id ? { ...user, unreadCount: 0 } : user));
                        const socket = getSocket();
                        if(socket) socket.emit("mark_seen", { senderId: u._id, receiverId: user._id });
                    }}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-800 flex justify-between items-center ${selectedUser?._id === u._id ? "bg-slate-800" : ""}`}>
                    <div className="flex-1 min-w-0 mr-3">
                        <p className="font-medium truncate">{u.userName}</p>
                        <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    </div>
                    <div className="flex flex-row items-center gap-2">
                        {u.unreadCount > 0 && <span className="bg-cyan-500 text-slate-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">{u.unreadCount}</span>}
                        {isOnline && <div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>}
                    </div>
                </div>
              );
            })}
        </div>
      </aside>

      <section className={`flex-col h-full w-full ${!selectedUser ? "hidden lg:flex lg:flex-1" : "flex flex-1"}`}>
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
              {selectedUser && <button onClick={() => setSelectedUser(null)} className="lg:hidden text-slate-400 hover:text-white">←</button>}
              <div>
                  <p className="font-medium">{selectedUser ? selectedUser.userName : "Select a chat"}</p>
                  {selectedUser && <>{isTyping ? <p className="text-xs text-cyan-400 font-semibold animate-pulse">Typing...</p> : onlineUsers.includes(selectedUser._id) && <p className="text-xs text-green-400 font-medium">Online</p>}</>}
              </div>
          </div>
          <div className="relative" ref={profileRef}>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setShowMyProfile((prev) => !prev)}>
              <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center text-slate-900 font-bold">{user.userName.charAt(0).toUpperCase()}</div>
            </div>
            {showMyProfile && <div className="absolute right-0 top-10 z-50 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-4">
                <p className="font-semibold text-white">{user.userName}</p>
                <p className="text-sm text-slate-400 mb-3">{user.email}</p>
                <button onClick={handleLogout} className="w-full text-left text-red-400 hover:underline">Logout</button>
            </div>}
          </div>
        </header>

        <div ref={chatRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
          {!selectedUser ? <div className="h-full flex items-center justify-center text-slate-500"><p>Select a user to start chatting</p></div> : loadingMessages ? <p className="text-slate-400">Loading messages...</p> : <>
              {loadingMore && <p className="text-center text-xs text-slate-500">Loading older messages...</p>}
              {messages.map((msg, index) => {
                const isMine = msg.sender === user._id;
                const isLast = index === messages.length - 1;
                const myPrivateKey = localStorage.getItem("chat_private_key");
                const theirPublicKey = selectedUser.publicKey;
                const currentDate = new Date(msg.createdAt);
                const prevMessage = messages[index - 1];
                const prevDate = prevMessage ? new Date(prevMessage.createdAt) : null;
                const showDateSeparator = !prevDate || !isSameDay(currentDate, prevDate);

                let displayText = "Loading...";
                if (msg.isEncrypted && msg.iv) {
                   displayText = decryptMessage(msg.content, msg.iv, myPrivateKey, theirPublicKey);
                } else {
                   displayText = msg.content;
                }

                return (
                  <div key={msg._id}>
                      {showDateSeparator && <div className="flex justify-center my-6"><span className="text-[11px] font-medium text-slate-400 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-800">{formatDateLabel(msg.createdAt)}</span></div>}
                      <div ref={isLast ? lastMessageRef : null} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div className={`flex items-end gap-2 max-w-md ${isMine ? "flex-row" : "flex-row"}`}>
                            <div className={`px-4 py-2 rounded-lg break-words ${isMine ? "bg-cyan-500 text-slate-900" : "bg-slate-800"}`}>
                                {displayText}
                            </div>
                            {isMine && (
                                <div className="shrink-0 mb-1">
                                    {renderMessageStatus(msg.status, msg)}
                                </div>
                            )}
                        </div>
                      </div>
                  </div>
                );
              })}
            </>}
        </div>

        {selectedUser && <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3 shrink-0">
            <input value={messageText} onChange={handleInputCallback} onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} className="flex-1 bg-slate-800 px-4 py-2 rounded outline-none" placeholder="Type a message..." />
            <button onClick={handleSendMessage} className="bg-cyan-400 text-black px-4 py-2 rounded">Send</button>
        </div>}
      </section>
    </div>
  );
}