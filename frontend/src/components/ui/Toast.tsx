import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "info" | "success" | "error" };
const Ctx = createContext<(text: string, tone?: Toast["tone"], ms?: number) => void>(() => {});

/** Transient messages ("Copied", "Wallet rejected the network switch"), announced politely to screen readers. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: Toast["tone"] = "info", ms = 2600) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mt-toast rounded-ctl px-4 py-2.5 text-[14px] font-medium shadow-hover ${t.tone === "error" ? "bg-error text-white" : t.tone === "success" ? "bg-success-ink text-white" : "bg-ink text-white"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
