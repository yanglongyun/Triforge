// 「从浏览器导入」对话框。
//
// 为什么是对话框而不是设置页里的一行:这件事有**三个决定**要用户做 ——
// 从哪个 Chrome 配置导、导什么、以及知不知道后果。一行放不下,
// 而放不下的结果就是替用户默认(从前是自动挑最近用过的那个配置,多 Profile 的人没得选)。
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Cookie, Loader2, Star, X } from "lucide-react";
import { Switch } from "./Switch";
import {
  importFromChrome, listChromeProfiles,
  type ChromeProfile, type ImportResult,
} from "../../lib/chromeImport";

export function ChromeImportDialog({ onClose, onDone }: {
  onClose: () => void;
  onDone?: (result: ImportResult) => void;
}) {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [profile, setProfile] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cookies, setCookies] = useState(true);
  const [bookmarks, setBookmarks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void listChromeProfiles().then((list) => {
      setProfiles(list);
      setProfile(list[0]?.dir || "");   // 默认选最近用过的那个
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (pickerOpen) setPickerOpen(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, pickerOpen, onClose]);

  const current = profiles.find((p) => p.dir === profile);
  const nothingPicked = !cookies && !bookmarks;

  const run = () => {
    if (busy || nothingPicked) return;
    setBusy(true);
    setError("");
    void importFromChrome({ profile, cookies, bookmarks })
      .then((result) => { onDone?.(result); onClose(); })
      .catch((e) => { setError(e?.message || "导入失败"); setBusy(false); });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-[440px] rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-[19px] font-semibold text-text">从浏览器导入</h2>
            <p className="mt-1 text-[13px] text-text-faint">选择要导入到内置浏览器的数据</p>
          </div>
          <button onClick={onClose} disabled={busy}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-text-faint
              hover:text-text hover:bg-bg-hover disabled:opacity-40 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 从哪个配置导 —— 多 Profile 的人必须能选 */}
        <div className="px-6">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[13px] text-text-dim">从</span>
            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy || profiles.length < 2}
                className="w-full flex items-center gap-2 h-11 px-3.5 rounded-xl border border-border
                  bg-bg text-left disabled:opacity-100 hover:bg-bg-hover transition-colors"
              >
                <ChromeMark />
                <span className="text-[14px] text-text truncate">Google Chrome</span>
                <span className="text-[13px] text-text-faint truncate">{current?.name || ""}</span>
                {profiles.length > 1 && <ChevronDown size={16} className="ml-auto shrink-0 text-text-faint" />}
              </button>

              {pickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-10 rounded-xl border border-border
                  bg-surface shadow-xl overflow-hidden py-1">
                  {profiles.map((item) => (
                    <button key={item.dir}
                      onClick={() => { setProfile(item.dir); setPickerOpen(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-bg-hover transition-colors"
                    >
                      <ChromeMark />
                      <span className="text-[13.5px] text-text truncate">Google Chrome</span>
                      <span className="text-[12.5px] text-text-faint truncate">{item.name}</span>
                      {item.dir === profile && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="mt-2.5 text-[12.5px] text-text-faint">导入前,请完全关闭 Google Chrome</p>
        </div>

        {/* 导什么 */}
        <div className="mx-6 mt-4 rounded-xl border border-border overflow-hidden">
          <Row icon={<Cookie size={17} className="text-text-dim" />} label="登录状态(Cookie)"
            hint="导入后 AI 可在这些已登录的页面上执行操作"
            on={cookies} onChange={setCookies} disabled={busy} />
          <div className="h-px bg-border mx-3.5" />
          <Row icon={<Star size={17} className="text-text-dim" />} label="书签"
            hint="加入「网站」面板,已有的不重复添加"
            on={bookmarks} onChange={setBookmarks} disabled={busy} />
        </div>

        {error && (
          <div className="mx-6 mt-3 flex items-start gap-1.5 text-[12.5px] text-danger">
            <AlertTriangle size={13} className="shrink-0 mt-[2px]" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 px-6 py-5">
          <button onClick={onClose} disabled={busy}
            className="h-10 px-5 rounded-xl bg-bg-inset text-[14px] text-text
              hover:bg-bg-hover disabled:opacity-40 transition-colors">
            取消
          </button>
          <button onClick={run} disabled={busy || nothingPicked}
            className="h-10 px-6 rounded-xl bg-text text-bg text-[14px] font-medium inline-flex items-center gap-2
              hover:opacity-90 disabled:opacity-40 transition-opacity">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, hint, on, onChange, disabled }: {
  icon: React.ReactNode; label: string; hint: string;
  on: boolean; onChange: (v: boolean) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-text">{label}</span>
        <span className="block text-[11.5px] text-text-faint mt-0.5 leading-snug">{hint}</span>
      </span>
      <Switch on={on} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/** Chrome 的四色圆标 —— 用户是靠这个图标认出「这是我的浏览器」的。 */
const ChromeMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" className="shrink-0">
    <circle cx="24" cy="24" r="10" fill="#fff" />
    <path fill="#4285f4" d="M24 14h18.4A22 22 0 0 0 24 2a22 22 0 0 0-19 11l9.2 16A10 10 0 0 1 24 14Z" transform="translate(0,0)" />
    <path fill="#ea4335" d="M24 14H42.4A22 22 0 0 0 24 2 22 22 0 0 0 5 13l9.2 16A10 10 0 0 1 24 14Z" opacity="0" />
    <path fill="#34a853" d="M31.6 30 22.4 46A22 22 0 0 0 43 30.6L33.8 14.6A10 10 0 0 1 31.6 30Z" />
    <path fill="#fbbc05" d="M14.2 30 5 14A22 22 0 0 0 22.4 46l9.2-16a10 10 0 0 1-17.4 0Z" />
    <circle cx="24" cy="24" r="8.4" fill="#4285f4" />
    <circle cx="24" cy="24" r="4.6" fill="#fff" />
  </svg>
);
