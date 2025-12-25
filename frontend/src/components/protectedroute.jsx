import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { connectSocket, disconnectSocket } from "../api/socket";
import api from "../api/axios";

export default function ProtectedRoute() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await api.get("/auth/me");

        const userData = res.data.user;

        setUser(userData);
        setAuthorized(true);

        connectSocket(userData._id);

      } catch (err) {
        setAuthorized(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    return () => {
      disconnectSocket();
    };
  }, []);

  if (loading) return null;

  if (!authorized) {
    return <Navigate to="/" replace />;
  }

  return <Outlet context={{ user }} />;
}
