import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import api from "../api/axios";

export default function Chat() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);

  /* ---------------- LOGOUT ---------------- */
  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  /* ---------------- FETCH USERS ---------------- */
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get("/getUsers");
        setUsers(res.data.users);
      } catch (err) {
        console.error("Failed to fetch users", err);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, []);

  /* ---------------- FETCH MESSAGES ---------------- */
  const fetchMessages = async (userId) => {
    try {
      setLoadingMessages(true);
      const res = await api.get(`/messages/${userId}`);
      setMessages(res.data.messages);
    } catch (err) {
      console.error("Failed to fetch messages", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  /* ---------------- SEND MESSAGE ---------------- */
  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedUser) return;

    try {
      const res = await api.post(`/messages/${selectedUser._id}`, {
        content: messageText, // MUST match backend
      });

      setMessages((prev) => [...prev, res.data.message]);
      setMessageText("");
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">

      {/* MOBILE OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`
          fixed lg:static z-40
          h-full w-72
          bg-slate-900 border-r border-slate-800
          transform transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">CipherText</h2>
            <p className="text-xs text-slate-400">Secure Messaging</p>
          </div>
          <button
            className="lg:hidden text-slate-400"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingUsers ? (
            <p className="p-4 text-slate-400">Loading users...</p>
          ) : (
            users.map((u) => (
              <div
                key={u._id}
                onClick={() => {
                  setSelectedUser(u);
                  fetchMessages(u._id);
                  setSidebarOpen(false);
                }}
                className={`px-4 py-3 cursor-pointer hover:bg-slate-800 transition ${
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

      {/* RIGHT CHAT AREA */}
      <section className="flex-1 flex flex-col">

        {/* TOP BAR */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 sm:px-6 bg-slate-900">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-xl"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>

            <div className="w-10 h-10 rounded-full bg-cyan-500 flex items-center justify-center font-semibold">
              {(selectedUser || user).userName[0].toUpperCase()}
            </div>

            <div>
              <p className="font-medium">
                {selectedUser ? selectedUser.userName : user.userName}
              </p>
              <p className="text-xs text-green-400">
                {selectedUser ? "Chatting" : "Online"}
              </p>
            </div>
          </div>

          {/* PROFILE + LOGOUT */}
          <div className="flex items-center gap-4">
            <div
              className="relative"
              onMouseEnter={() => setShowProfile(true)}
              onMouseLeave={() => setShowProfile(false)}
            >
              <button className="text-slate-400 hover:text-white">
                Profile
              </button>

              {showProfile && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-4 z-50">
                  <p className="text-sm font-semibold">{user.userName}</p>
                  <p className="text-xs text-slate-400 mt-1">{user.email}</p>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="bg-red-500/20 text-red-400 px-3 py-1 rounded hover:bg-red-500/30"
            >
              Logout
            </button>
          </div>
        </header>

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!selectedUser ? (
            <p className="text-slate-400 text-center mt-10">
              Select a user to start chatting
            </p>
          ) : loadingMessages ? (
            <p className="text-slate-400">Loading messages...</p>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender.toString() === user._id;

              return (
                <div
                  key={msg._id}
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
            })
          )}
        </div>

        {/* MESSAGE INPUT */}
        {selectedUser && (
          <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-slate-800 px-4 py-2 rounded text-white focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            />
            <button
              onClick={handleSendMessage}
              className="bg-cyan-400 text-slate-900 px-4 py-2 rounded hover:bg-cyan-300"
            >
              Send
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
