import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import api from "../api/axios";

export default function ProtectedRoute() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await api.get("/auth/me");
        setUser(res.data.user); 
        setAuthorized(true);
      } catch (err) {
        setAuthorized(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) return null; // or loader

  if (!authorized) {
    return <Navigate to="/" replace />;
  }

  return <Outlet context={{ user }} />;
}
