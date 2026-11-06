import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { AppDataProvider } from "./lib/appContext";
import { ConversationPage } from "./pages/ConversationPage";
import { NewConversationPage } from "./pages/NewConversationPage";

function ConversationRoute() {
  const { id } = useParams();
  // Keyed by id so switching conversations starts from fresh state.
  return id ? <ConversationPage key={id} id={id} /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AppDataProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<NewConversationPage />} />
            <Route path="/c/:id" element={<ConversationRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppDataProvider>
  );
}
