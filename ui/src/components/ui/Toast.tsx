// 轻提示:全局一个宿主,showToast 即显 2.4s 自隐。应用的 ui.toast 能力也走这里。
import { useEffect, useState } from "react";

const EVENT = "workbench:toast";

export const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message: String(message).slice(0, 200) } }));
};

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onToast = (e: Event) => {
      setMessage(String((e as CustomEvent).detail?.message || ""));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2400);
    };
    window.addEventListener(EVENT, onToast);
    return () => { window.removeEventListener(EVENT, onToast); if (timer) clearTimeout(timer); };
  }, []);
  if (!message) return null;
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] pointer-events-none rounded-full bg-text text-bg text-[12.5px] px-4 py-1.5 shadow-lg shadow-black/20">
      {message}
    </div>
  );
}
