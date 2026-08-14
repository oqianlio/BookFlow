import { createContext, useContext, useRef, useState, type ReactNode } from "react";

interface ErrorContextValue {
  showError: (msg: string) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextValue>({
  showError: () => {},
  clearError: () => {},
});

export function useError(): ErrorContextValue {
  return useContext(ErrorContext);
}

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const showError = (msg: string) => {
    setMessage(String(msg));
    setSeq((n) => n + 1);
    setCopied(false);
  };
  const clearError = () => {
    setMessage(null);
    setCopied(false);
  };

  const copy = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ErrorContext.Provider value={{ showError, clearError }}>
      {children}
      {message !== null && (
        <div className="error-dialog-overlay" key={seq}>
          <div className="error-dialog" role="alertdialog" aria-label="错误">
            <h3>出错了</h3>
            <pre className="error-dialog-message">{message}</pre>
            <div className="error-dialog-actions">
              <button className="btn btn-primary" onClick={() => void copy()}>
                {copied ? "已复制" : "复制"}
              </button>
              <button className="btn btn-ghost" onClick={clearError}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </ErrorContext.Provider>
  );
}
