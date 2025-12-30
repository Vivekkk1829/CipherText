import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getSocket } from "../api/socket";
import { encryptMessage, decryptMessage } from "../utils/crypto.js";

/* ----------------------------------------------------------------
   🟢 NEW: SESSION UUID GENERATOR
   This creates a unique ID for this specific browser session.
   If the user refreshes, this changes, resetting the sequence logic safely.
---------------------------------------------------------------- */
const generateSessionUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'sess-' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
};

const SESSION_UUID = generateSessionUUID(); 

/* ----------------------------------------------------------------
   HELPER FUNCTIONS FOR DATE SEPARATORS 📅
---------------------------------------------------------------- */
const isSameDay = (d1, d2) => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

const formatDateLabel = (dateString) => {
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
/* ---------------------------------------------------------------- */

export default function Chat() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  const chatRef = useRef(null);
  const lastMessageRef = useRef(null);
  const profileRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // 🟢 NEW: SEQUENCE TRACKER
  // Stores the last sequence number used for each chat partner.
  // Format: { "user_id_A": 5, "user_id_B": 12 }
  const clientSequenceRefs = useRef({});

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

  /* ---------------- REQUEST NOTIFICATION PERMISSION ---------------- */
  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
  }, []);

  /* ---------------- LOGOUT ---------------- */
  const handleLogout = async () => {
    localStorage.removeItem("chat_private_key");
    await api.post("/auth/logout");
    navigate("/", { replace: true });
  };

  /* ---------------- CLOSE PROFILE ---------------- */
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

  /* ---------------- HELPER: GET NEXT CLIENT ID ---------------- */
  // 🟢 NEW function to manage the counter
  const getNextClientId = (receiverId) => {
    if (!clientSequenceRefs.current[receiverId]) {
      clientSequenceRefs.current[receiverId] = 0;
    }
    clientSequenceRefs.current[receiverId] += 1;
    return clientSequenceRefs.current[receiverId];
  };

  /* ---------------- FETCH MESSAGES ---------------- */
  const fetchMessages = async (userId) => {
    setLoadingMessages(true);
    setMessages([]);
    setNextCursor(null);
    setIsTyping(false);

    const res = await api.get(`/messages/${userId}`);
    setMessages(res.data.messages);
    setNextCursor(res.data.nextCursor);
    setLoadingMessages(false);
  };

  /* ---------------- FETCH OLDER MESSAGES ---------------- */
  const fetchOlderMessages = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const prevHeight = chatRef.current.scrollHeight;
    const res = await api.get(`/messages/${selectedUser._id}?cursor=${nextCursor}`);
    setMessages((prev) => [...res.data.messages, ...prev]);
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

  /* ----------------------------------------------------------------
     🚀 RETRY LOGIC (UPDATED WITH NEW FIELDS)
   ---------------------------------------------------------------- */
  const sendWithRetry = async (packet, attempt = 1) => {
      const maxRetries = 5;

      try {
          // Attempt the HTTP Request
          const res = await api.post(`/messages/${packet.receiverId}`, {
             content: packet.content,
             iv: packet.iv,
             // 🟢 NEW: Send the Ordering Data
             clientId: packet.clientId,
             clientUuid: packet.clientUuid
          });

          // ✅ ACK RECEIVED
          if (res.data.success) {
              const realMessage = res.data.message;
              
              setMessages(prev => {
                const socketAlreadyAddedIt = prev.some(m => m._id === realMessage._id);

                if (socketAlreadyAddedIt) {
                    return prev.filter(m => m._id !== packet.tempId);
                } else {
                    return prev.map(msg => 
                        msg._id === packet.tempId ? { ...realMessage } : msg
                    );
                }
              });
          }
      } catch (error) {
          // ❌ FAILURE
          console.warn(`Attempt ${attempt} failed.`);
          
          if (attempt < maxRetries) {
              setTimeout(() => sendWithRetry(packet, attempt + 1), 1000 * attempt);
          } else {
              setMessages(prev => prev.map(msg => 
                  msg._id === packet.tempId ? { ...msg, status: "failed" } : msg
              ));
          }
      }
  };

  /* ----------------------------------------------------------------
     🚀 HANDLE SEND MESSAGE (UPDATED)
   ---------------------------------------------------------------- */
  const handleSendMessage = async () => {
    if (!messageText.trim()) return;

    // 1. Handle Typing Logic
    const socket = getSocket();
    if (socket && typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        socket.emit("stop_typing", { senderId: user._id, receiverId: selectedUser._id });
    }

    // 2. Encrypt
    const myPrivateKey = localStorage.getItem("chat_private_key");
    const theirPublicKey = selectedUser?.publicKey;
    if (!myPrivateKey || !theirPublicKey) { alert("Keys missing."); return; }
    const encryptedData = encryptMessage(messageText, myPrivateKey, theirPublicKey);
    if (!encryptedData) { alert("Encryption failed"); return; }
    
    // 3. 🟢 GET ORDERING IDS
    const clientId = getNextClientId(selectedUser._id);
    const clientUuid = SESSION_UUID;

    // 4. Prepare Packet with Temporary ID
    const tempId = Date.now().toString();
    const packet = {
      receiverId: selectedUser._id,
      content: encryptedData.content,
      iv: encryptedData.iv,
      tempId: tempId,
      // 🟢 Attach to packet
      clientId: clientId,
      clientUuid: clientUuid
    };

    // 5. Optimistic UI
    const optimisticMessage = {
        _id: tempId,
        sender: user._id,
        receiver: selectedUser._id,
        content: encryptedData.content,
        iv: encryptedData.iv,
        createdAt: new Date().toISOString(),
        status: "pending", 
        isEncrypted: true
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setMessageText("");

    // 6. Trigger Reliable Send
    sendWithRetry(packet);
  };

  /* ---------------- AUTO SCROLL ---------------- */
  useLayoutEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages, isTyping]);

  /* ---------------- SCROLL HANDLER ---------------- */
  const handleScroll = () => {
    if (chatRef.current.scrollTop === 0) fetchOlderMessages();
  };

  /* ---------------- SOCKET: ONLINE STATUS ---------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    
    const handleOnlineUsers = (ids) => {
        setOnlineUsers(ids);
    };
    
    socket.on("get_online_users", handleOnlineUsers);
    
    return () => {
        socket.off("get_online_users", handleOnlineUsers);
    };
  }, []); 


  /* ---------------- SOCKET: MESSAGES & TYPING ---------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return; 

    const handleUserTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) setIsTyping(true);
    };

    const handleUserStoppedTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) setIsTyping(false);
    };

    /* ---------- NEW MESSAGE HANDLER ---------- */
    const handleNewMessage = (message) => {
      if (selectedUser && message.sender === selectedUser._id) setIsTyping(false);

      if (message.receiver === user._id) {
          socket.emit("mark_delivered", { messageId: message._id, senderId: message.sender });
      }

      const isCurrentChat = selectedUser && (
          message.sender === selectedUser._id || message.receiver === selectedUser._id
      );

      // 1. If looking at the chat
      if (isCurrentChat) {
        setMessages((prev) => {
            // Prevent Duplicates: If we already have this ID, don't add it
            if (prev.some(m => m._id === message._id)) return prev;
            return [...prev, message];
        });
        if (message.receiver === user._id) {
            socket.emit("mark_seen", { senderId: message.sender, receiverId: user._id });
        }
      } 
      // 2. If NOT looking at the chat
      else if (message.receiver === user._id) {
         setUsers(prev => prev.map(u => {
             if (u._id === message.sender) {
                 return { ...u, unreadCount: (u.unreadCount || 0) + 1 };
             }
             return u;
         }));
      }

      /* 🔔 SYSTEM NOTIFICATION */
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

    const handleMessageSent = (message) => {
      if (selectedUser && message.receiver === selectedUser._id) {
        setMessages((prev) => {
            // Prevent Duplicates: check against real ID
            if (prev.some(m => m._id === message._id)) return prev;
            return [...prev, message];
        });
      }
    };

    const handleStatusUpdate = ({ messageId, status }) => {
        setMessages(prev => prev.map(msg => {
            if (msg._id === messageId) {
                if (msg.status === "seen" && status === "delivered") return msg;
                return { ...msg, status };
            }
            return msg;
        }));
    };

    const handleMessagesSeen = ({ conversationId, status }) => {
        if (selectedUser && conversationId == selectedUser._id) { 
            setMessages(prev => prev.map(msg => 
                msg.sender === user._id ? { ...msg, status: "seen" } : msg
            ));
        }
    };

    socket.on("new_message", handleNewMessage);
    socket.on("message_sent", handleMessageSent);
    socket.on("message_status_update", handleStatusUpdate);
    socket.on("messages_seen_update", handleMessagesSeen);
    socket.on("user_typing", handleUserTyping);
    socket.on("user_stopped_typing", handleUserStoppedTyping);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("message_sent", handleMessageSent);
      socket.off("message_status_update", handleStatusUpdate);
      socket.off("messages_seen_update", handleMessagesSeen);
      socket.off("user_typing", handleUserTyping);
      socket.off("user_stopped_typing", handleUserStoppedTyping);
    };
  }, [selectedUser, user._id, users]);


  /* ---------------- RENDER STATUS TEXT ---------------- */
  const renderMessageStatus = (status) => {
    if (status === "pending") return "Sending..."; // UI Feedback
    if (status === "failed") return "Failed";     // UI Feedback
    if (status === "seen") return "Seen";
    if (status === "delivered") return "Delivered";
    return "Sent";
  };


  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">

      {/* SIDEBAR */}
      <aside 
        className={`bg-slate-900 border-r border-slate-800 flex-col 
          ${selectedUser ? "hidden lg:flex lg:w-72" : "flex w-full lg:w-72"}
        `}
      >
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-semibold text-lg">CipherText</h2>
        </div>

        <div className="overflow-y-auto h-full pb-20">
          {loadingUsers ? (
            <p className="p-4 text-slate-400">Loading users...</p>
          ) : (
            users.map((u) => {
              const isOnline = onlineUsers.includes(u._id);
              return (
                <div
                    key={u._id}
                    onClick={() => {
                        setSelectedUser(u);
                        fetchMessages(u._id);
                        setUsers(prev => prev.map(user => 
                            user._id === u._id ? { ...user, unreadCount: 0 } : user
                        ));
                        const socket = getSocket();
                        if(socket) {
                            socket.emit("mark_seen", { senderId: u._id, receiverId: user._id });
                        }
                    }}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-800 flex justify-between items-center ${
                        selectedUser?._id === u._id ? "bg-slate-800" : ""
                    }`}
                >
                    {/* LEFT: User Info */}
                    <div className="flex-1 min-w-0 mr-3">
                        <p className="font-medium truncate">{u.userName}</p>
                        <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    </div>
                    
                    {/* RIGHT: Status Indicators (Horizontal Layout) */}
                    <div className="flex flex-row items-center gap-2">
                        {u.unreadCount > 0 && (
                            <span className="bg-cyan-500 text-slate-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">
                                {u.unreadCount}
                            </span>
                        )}
                        {isOnline && (
                            <div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                        )}
                    </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* CHAT AREA */}
      <section 
        className={`flex-col h-full w-full
            ${!selectedUser ? "hidden lg:flex lg:flex-1" : "flex flex-1"}
        `}
      >
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
              {selectedUser && (
                  <button 
                    onClick={() => setSelectedUser(null)}
                    className="lg:hidden text-slate-400 hover:text-white"
                  >
                    ←
                  </button>
              )}

              <div>
                  <p className="font-medium">
                    {selectedUser ? selectedUser.userName : "Select a chat"}
                  </p>
                  {selectedUser && (
                    <>
                        {isTyping ? (
                            <p className="text-xs text-cyan-400 font-semibold animate-pulse">Typing...</p>
                        ) : (
                            onlineUsers.includes(selectedUser._id) && (
                                <p className="text-xs text-green-400 font-medium">Online</p>
                            )
                        )}
                    </>
                  )}
              </div>
          </div>

          <div className="relative" ref={profileRef}>
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setShowMyProfile((prev) => !prev)}
            >
              <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center text-slate-900 font-bold">
                {user.userName.charAt(0).toUpperCase()}
              </div>
            </div>

            {showMyProfile && (
              <div className="absolute right-0 top-10 z-50 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-4">
                <p className="font-semibold text-white">{user.userName}</p>
                <p className="text-sm text-slate-400 mb-3">{user.email}</p>
                <button
                  onClick={handleLogout}
                  className="w-full text-left text-red-400 hover:underline"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* MESSAGES WITH DATE SEPARATORS */}
        <div
          ref={chatRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {!selectedUser ? (
            <div className="h-full flex items-center justify-center text-slate-500">
               <p>Select a user to start chatting</p>
            </div>
          ) : loadingMessages ? (
            <p className="text-slate-400">Loading messages...</p>
          ) : (
            <>
              {loadingMore && (
                <p className="text-center text-xs text-slate-500">Loading older messages...</p>
              )}

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
                      {showDateSeparator && (
                          <div className="flex justify-center my-6">
                              <span className="text-[11px] font-medium text-slate-400 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-800">
                                  {formatDateLabel(msg.createdAt)}
                              </span>
                          </div>
                      )}

                      <div ref={isLast ? lastMessageRef : null} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div className={`flex flex-col ${isMine ? "items-end" : "items-start"} max-w-md`}>
                            <div className={`px-4 py-2 rounded-lg break-words ${isMine ? "bg-cyan-500 text-slate-900" : "bg-slate-800"}`}>
                              {displayText}
                            </div>
                            {isMine && isLast && (
                              <span className="text-[10px] text-slate-500 font-medium mt-1 mr-1">{renderMessageStatus(msg.status)}</span>
                            )}
                        </div>
                      </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {selectedUser && (
          <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3 shrink-0">
            <input
              value={messageText}
              onChange={handleInputCallback} 
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 bg-slate-800 px-4 py-2 rounded outline-none"
              placeholder="Type a message..."
            />
            <button onClick={handleSendMessage} className="bg-cyan-400 text-black px-4 py-2 rounded">Send</button>
          </div>
        )}
      </section>
    </div>
  );
}