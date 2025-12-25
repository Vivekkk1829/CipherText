import { useState } from "react";
import api from "../api/axios.js";
import { useNavigate } from "react-router-dom";


import { 
  generateKeyPair, 
  encryptPrivateKey, 
  decryptPrivateKey 
} from "../utils/crypto.js"; 

export default function Auth() {
  const [mode, setMode] = useState("signin");
  const navigate = useNavigate();
  const [form, setForm] = useState({
    userName: "",
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  /* -------------------------------------------------------------------------- */
  /* SECURE SUBMIT LOGIC (MODIFIED)                                            */
  /* -------------------------------------------------------------------------- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      
      if (mode === "signup") {
        /* --- SIGN UP FLOW --- */
        // 1. Generate Identity locally
        const { publicKey, privateKey } = generateKeyPair();

        // 2. Encrypt the Private Key (The Vault)
        const encryptedPrivateKey = encryptPrivateKey(privateKey, form.password);

        // 3. Send Vault + Identity to Server
        const payload = {
          ...form,
          publicKey,
          encryptedPrivateKey, 
        };

        await api.post("/auth/register", payload);

        // 4. Save Raw Key locally so user is logged in instantly
        localStorage.setItem("chat_private_key", privateKey);

      } else {
        /* --- SIGN IN FLOW --- */
        const payload = { email: form.email, password: form.password };
        const { data } = await api.post("/auth/login", payload);

        // 1. Get the Vault from the response
        const { encryptedPrivateKey } = data.user;

        // 2. Unlock the Vault
        if (encryptedPrivateKey) {
            const restoredPrivateKey = decryptPrivateKey(encryptedPrivateKey, form.password);
            
            if (restoredPrivateKey) {
                localStorage.setItem("chat_private_key", restoredPrivateKey);
            } else {
                throw new Error("Security Error: Could not restore chat history keys.");
            }
        }
      }

      console.log("AUTH SUCCESS");
      navigate("/chat");

    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Authentication failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="
        min-h-screen grid grid-cols-1 lg:grid-cols-2
        text-white bg-linear-to-br
        from-slate-950 via-blue-950 to-slate-900
      "
    >
      {/* LEFT – BRANDING */}
      <div className="hidden lg:flex flex-col justify-center px-12 xl:px-20">
        <h1 className="font-bold tracking-tight leading-tight">
          <span className="block text-4xl xl:text-5xl opacity-0 animate-word delay-0">
            Welcome
          </span>
          <span className="block text-4xl xl:text-5xl opacity-0 animate-word delay-200 mt-2">
            to
          </span>
          <span className="block text-4xl xl:text-5xl opacity-0 animate-word delay-400 mt-2 text-cyan-400">
            CipherText
          </span>
        </h1>

        <p className="mt-6 text-base xl:text-lg text-slate-300 max-w-md opacity-0 animate-word delay-600">
          Secure, stateless, end-to-end encrypted messaging built on zero-trust principles.
        </p>
      </div>

      {/* RIGHT – AUTH CARD */}
      <div className="flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div
          className="
            w-full max-w-sm sm:max-w-md
            rounded-xl border border-slate-800
            bg-slate-900/80 backdrop-blur-xl
            shadow-2xl p-6 sm:p-8
          "
        >
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-xl sm:text-2xl font-semibold">
              {mode === "signin" ? "Sign in" : "Create account"}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {mode === "signin"
                ? "Access your CipherText account"
                : "Join CipherText securely"}
            </p>
          </div>

          {/* ERROR */}
          {error && (
            <p className="mb-4 text-sm text-red-400 bg-red-400/10 p-2 rounded">
              {error}
            </p>
          )}

          {/* FORM */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  name="userName"
                  value={form.userName}
                  onChange={handleChange}
                  placeholder="cipher_user"
                  className="
                    w-full bg-slate-950 border border-slate-800 rounded-lg
                    px-4 py-2 text-sm sm:text-base
                    text-white placeholder-slate-500
                    focus:outline-none focus:ring-2 focus:ring-cyan-400
                  "
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@ciphertext.dev"
                className="
                  w-full bg-slate-950 border border-slate-800 rounded-lg
                  px-4 py-2 text-sm sm:text-base
                  text-white placeholder-slate-500
                  focus:outline-none focus:ring-2 focus:ring-cyan-400
                "
              />
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Password
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="
                  w-full bg-slate-950 border border-slate-800 rounded-lg
                  px-4 py-2 text-sm sm:text-base
                  text-white placeholder-slate-500
                  focus:outline-none focus:ring-2 focus:ring-cyan-400
                "
              />
            </div>

            {mode === "signup" && (
              <p className="text-xs text-slate-400">
                Keys are generated locally. Server never sees plaintext.
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="
                w-full bg-cyan-400 hover:bg-cyan-300
                disabled:opacity-60 disabled:cursor-not-allowed
                text-slate-900 font-medium rounded-lg
                py-2.5 transition
              "
            >
              {loading
                ? "Processing Keys..."
                : mode === "signin"
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>

          {/* TOGGLE */}
          <div className="mt-6 text-sm text-slate-400">
            {mode === "signin" ? (
              <>
                Don’t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-cyan-400 hover:underline"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-cyan-400 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            End-to-end encrypted • Zero-trust architecture
          </p>
        </div>
      </div>
    </div>
  );
}