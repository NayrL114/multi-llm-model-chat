import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAppData } from "../lib/appContext";
import { relativeTime } from "../lib/format";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

export function Sidebar() {
  const { conversations, modelLabel } = useAppData();
  const [theme, setTheme] = useTheme();

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-bars" aria-hidden>
            <span style={{ background: "var(--lane-1)" }} />
            <span style={{ background: "var(--lane-2)" }} />
            <span style={{ background: "var(--lane-3)" }} />
          </span>
          Multi-Model Chat
        </div>
        <Link to="/" className="new-button">
          + New conversation
        </Link>
      </div>

      <ul className="conv-list" aria-label="Conversations">
        {conversations.length === 0 && <li className="muted" style={{ padding: "6px 10px", fontSize: "0.85em" }}>No conversations yet.</li>}
        {conversations.map((c) => (
          <li key={c.id}>
            <NavLink to={`/c/${c.id}`} className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span className="conv-title">{c.title}</span>
              <span className="conv-meta">
                {relativeTime(c.updatedAt)} · {c.lanes.map((l) => modelLabel(l.provider, l.modelId)).join(", ")}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar-foot">
        <label>
          <input type="checkbox" checked={theme === "dark"} onChange={(e) => setTheme(e.target.checked ? "dark" : "light")} />
          Night mode
        </label>
      </div>
    </aside>
  );
}
