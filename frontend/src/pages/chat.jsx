import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getSocket } from "../api/socket";
import { encryptMessage, decryptMessage } from "../utils/crypto.js";

export default function Chat() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  const chatRef = useRef(null);
  const lastMessageRef = useRef(null);
  const profileRef = useRef(null);
  const typingTimeoutRef = useRef(null);

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

  /* ---------------- LOGOUT ---------------- */
  const handleLogout = async () => {
    localStorage.removeItem("chat_private_key");
    await api.post("/auth/logout");
    navigate("/", { replace: true });
  };

  /* ---------------- CLOSE PROFILE ON OUTSIDE CLICK ---------------- */
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

    const res = await api.get(
      `/messages/${selectedUser._id}?cursor=${nextCursor}`
    );

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

  /* ---------------- HANDLE TYPING INPUT ---------------- */
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

    if (!myPrivateKey || !theirPublicKey) {
      alert("Security Error: Keys missing.");
      return;
    }

    const encryptedData = encryptMessage(messageText, myPrivateKey, theirPublicKey);
    if (!encryptedData) {
      alert("Encryption failed");
      return;
    }

    await api.post(`/messages/${selectedUser._id}`, {
      content: encryptedData.content,
      iv: encryptedData.iv
    });

    setMessageText("");
  };

  /* ---------------- AUTO SCROLL ---------------- */
  useLayoutEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({
        behavior: "auto",
        block: "end",
      });
    }
  }, [messages, isTyping]);

  /* ---------------- SCROLL HANDLER ---------------- */
  const handleScroll = () => {
    if (chatRef.current.scrollTop === 0) {
      fetchOlderMessages();
    }
  };

  /* ---------------- SOCKET LISTENERS ---------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return; 

    socket.on("get_online_users", (onlineUserIds) => {
        setOnlineUsers(onlineUserIds);
    });

    const handleUserTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) {
            setIsTyping(true);
        }
    };

    const handleUserStoppedTyping = ({ senderId }) => {
        if (selectedUser && senderId === selectedUser._id) {
            setIsTyping(false);
        }
    };

    const handleNewMessage = (message) => {
      if (selectedUser && message.sender === selectedUser._id) {
          setIsTyping(false);
      }

      if (message.receiver === user._id) {
          socket.emit("mark_delivered", {
              messageId: message._id,
              senderId: message.sender
          });
      }

      const isCurrentChat = selectedUser && (
          message.sender === selectedUser._id || 
          message.receiver === selectedUser._id
      );

      if (isCurrentChat) {
        setMessages((prev) => [...prev, message]);
        if (message.receiver === user._id) {
            socket.emit("mark_seen", {
                senderId: message.sender,
                receiverId: user._id
            });
        }
      }
    };

    const handleMessageSent = (message) => {
      if (selectedUser && message.receiver === selectedUser._id) {
        setMessages((prev) => [...prev, message]);
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
      socket.off("get_online_users");
      socket.off("new_message", handleNewMessage);
      socket.off("message_sent", handleMessageSent);
      socket.off("message_status_update", handleStatusUpdate);
      socket.off("messages_seen_update", handleMessagesSeen);
      socket.off("user_typing", handleUserTyping);
      socket.off("user_stopped_typing", handleUserStoppedTyping);
    };
  }, [selectedUser, user._id]);


  /* ---------------- RENDER STATUS TEXT ---------------- */
  const renderMessageStatus = (status) => {
    if (status === "seen") return "Seen";
    if (status === "delivered") return "Delivered";
    return "Sent";
  };


  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">

      {/* LEFT SIDEBAR (User List) 
          - On mobile: Visible ONLY if no user is selected
          - On desktop: Always visible
      */}
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
                    }}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-800 flex justify-between items-center ${
                        selectedUser?._id === u._id ? "bg-slate-800" : ""
                    }`}
                >
                    <div>
                        <p className="font-medium">{u.userName}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                    </div>
                    {isOnline && (
                        <div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-md shadow-green-500/50"></div>
                    )}
                </div>
              );
            })
          )}
        </div>
        
        {/* Mobile-only Logout at bottom of list if needed, or rely on Header profile */}
      </aside>

      {/* RIGHT CHAT AREA 
          - On mobile: Visible ONLY if a user IS selected
          - On desktop: Always visible
      */}
      <section 
        className={`flex-col h-full w-full
           ${!selectedUser ? "hidden lg:flex lg:flex-1" : "flex flex-1"}
        `}
      >

        {/* TOP BAR */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
              
              {/* BACK BUTTON (Mobile Only) */}
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
                  
                  {/* HEADER STATUS */}
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

        {/* MESSAGES */}
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
                <p className="text-center text-xs text-slate-500">
                  Loading older messages...
                </p>
              )}

              {messages.map((msg, index) => {
                const isMine = msg.sender === user._id;
                const isLast = index === messages.length - 1;

                const myPrivateKey = localStorage.getItem("chat_private_key");
                const theirPublicKey = selectedUser.publicKey;

                let displayText = "Loading...";
                if (msg.isEncrypted && msg.iv) {
                   displayText = decryptMessage(
                      msg.content, 
                      msg.iv, 
                      myPrivateKey, 
                      theirPublicKey
                    );
                } else {
                    displayText = msg.content;
                }

                return (
                  <div
                    key={msg._id}
                    ref={isLast ? lastMessageRef : null}
                    className={`flex ${
                      isMine ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"} max-w-md`}>
                        <div
                          className={`px-4 py-2 rounded-lg break-words ${
                            isMine
                              ? "bg-cyan-500 text-slate-900"
                              : "bg-slate-800"
                          }`}
                        >
                          {displayText}
                        </div>
                        {isMine && isLast && (
                           <span className="text-[10px] text-slate-500 font-medium mt-1 mr-1">
                               {renderMessageStatus(msg.status)}
                           </span>
                        )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* INPUT */}
        {selectedUser && (
          <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3 shrink-0">
            <input
              value={messageText}
              onChange={handleInputCallback} 
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 bg-slate-800 px-4 py-2 rounded outline-none"
              placeholder="Type a message..."
            />
            <button
              onClick={handleSendMessage}
              className="bg-cyan-400 text-black px-4 py-2 rounded"
            >
              Send
            </button>
          </div>
        )}
      </section>
    </div>
  );
}