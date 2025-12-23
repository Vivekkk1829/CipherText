import Auth from "../src/pages/auth.jsx";
import Chat from "../src/pages/chat.jsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/protectedroute.jsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/chat" element={<Chat />} />
        </Route>

        
      </Routes>
    </BrowserRouter>
  );
}

export default App;
