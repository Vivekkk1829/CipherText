import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getSocket } from "../api/socket";

export default function Chat() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  const chatRef = useRef(null);
  const lastMessageRef = useRef(null);

  const [showMyProfile, setShowMyProfile] = useState(false);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedUser, setSelectedUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  /* ---------------- LOGOUT ---------------- */
  const handleLogout = async () => {
    await api.post("/auth/logout");
    navigate("/", { replace: true });
  };

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
      const newHeight = chatRef.current.scrollHeight;
      chatRef.current.scrollTop = newHeight - prevHeight;
    });

    setLoadingMore(false);
  };

  /* ---------------- SEND MESSAGE ---------------- */
  const handleSendMessage = async () => {
    if (!messageText.trim()) return;

    // ✅ ONLY HTTP persistence
    await api.post(`/messages/${selectedUser._id}`, {
      content: messageText,
    });

    // ✅ UI updates via socket ONLY
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
  }, [messages]);

  /* ---------------- SCROLL HANDLER ---------------- */
  const handleScroll = () => {
    if (chatRef.current.scrollTop === 0) {
      fetchOlderMessages();
    }
  };

  /* ---------------- SOCKET LISTENERS ---------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !selectedUser) return;

    const handleNewMessage = (message) => {
      if (
        message.sender === selectedUser._id ||
        message.receiver === selectedUser._id
      ) {
        setMessages((prev) => [...prev, message]);
      }
    };

    const handleMessageSent = (message) => {
      if (message.receiver === selectedUser._id) {
        setMessages((prev) => [...prev, message]);
      }
    };

    socket.on("new_message", handleNewMessage);
    socket.on("message_sent", handleMessageSent);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("message_sent", handleMessageSent);
    };
  }, [selectedUser]);

  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">

      {/* LEFT SIDEBAR */}
      <aside className="w-72 bg-slate-900 border-r border-slate-800 hidden lg:block">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-semibold">CipherText</h2>
        </div>

        <div className="overflow-y-auto">
          {loadingUsers ? (
            <p className="p-4 text-slate-400">Loading users...</p>
          ) : (
            users.map((u) => (
              <div
                key={u._id}
                onClick={() => {
                  setSelectedUser(u);
                  fetchMessages(u._id);
                }}
                className={`px-4 py-3 cursor-pointer hover:bg-slate-800 ${
                  selectedUser?._id === u._id ? "bg-slate-800" : ""
                }`}
              >
                <p className="font-medium">{u.userName}</p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* RIGHT CHAT */}
      <section className="flex-1 flex flex-col">

        {/* TOP BAR */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900">
          <p className="font-medium">
            {selectedUser ? selectedUser.userName : "Select a chat"}
          </p>

          <div
            className="relative"
            onMouseEnter={() => setShowMyProfile(true)}
            onMouseLeave={() => setShowMyProfile(false)}
          >
            <div className="flex items-center gap-2 cursor-pointer">
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
            <p className="text-center text-slate-400 mt-10">
              Select a user to start chatting
            </p>
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

                return (
                  <div
                    key={msg._id}
                    ref={isLast ? lastMessageRef : null}
                    className={`flex ${
                      isMine ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`px-4 py-2 rounded-lg max-w-md ${
                        isMine
                          ? "bg-cyan-500 text-slate-900"
                          : "bg-slate-800"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* INPUT */}
        {selectedUser && (
          <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3">
            <input
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
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
