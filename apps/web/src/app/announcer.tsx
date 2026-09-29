import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Screen-reader announcements and on-screen toasts from one place. Status changes
 * ("Flag added", "Export ready", "Filters applied: 12 sessions") are spoken
 * through a polite live region; errors through an assertive one.
 */
interface Toast {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
}

const Ctx = createContext<{ announce: (text: string, tone?: Toast["tone"], toast?: boolean) => void } | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const announce = useCallback((text: string, tone: Toast["tone"] = "info", toast = true) => {
    if (tone === "error") {
      setAssertive("");
      setTimeout(() => setAssertive(text), 30);
    } else {
      setPolite("");
      setTimeout(() => setPolite(text), 30);
    }
    if (toast) {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, text, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 9000 : 4500);
    }
  }, []);
  return (
    <Ctx.Provider value={{ announce }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <div className="toasts" aria-hidden="true">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useAnnounce() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnnounce outside AnnouncerProvider");
  return v.announce;
}
