import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "../../api";
import { api } from "../../api";
import { getThemePref, setThemePref, type ThemePref } from "../../lib/theme";
import { Check, Settings2 } from "lucide-react";

const emptySettings: Settings = {
  driver: "responses",
  apiUrl: "",
  apiKey: "",
  model: "",
  system: "",
  compressThreshold: "60000",
  compactPrompt: "",
  toolResultMaxChars: "30000",
};

/** 两种接口协议:URL 提示跟着走。 */
const DRIVER_OPTIONS = [
  { id: "responses", label: "Responses API(OpenAI / DeepSeek 等)", urlPlaceholder: "https://api.openai.com/v1/responses" },
  { id: "chat", label: "Chat Completions(GLM 等)", urlPlaceholder: "https://open.bigmodel.cn/api/paas/v4/chat/completions" },
];

const inputClass =
  "w-full border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent";
const repositoryUrl = "https://github.com/realuckyang/Workbench";

export function SettingsPanel({ onSaved }: { onSaved?: (settings: Settings) => void }) {
  const [form, setForm] = useState<Settings>(emptySettings);
  const [saved, setSaved] = useState(false);
  // 外观是本机视觉偏好:即改即生效,存 localStorage,不进服务端设置
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());
  const changeTheme = (pref: ThemePref) => { setThemePrefState(pref); setThemePref(pref); };

  useEffect(() => {
    let cancelled = false;
    api.getSettings().then((r) => {
      if (cancelled) return;
      const settings = { ...emptySettings, ...r.settings };
      setForm(settings);
    });
    return () => { cancelled = true; };
  }, []);

  const saveModel = async () => {
    const result = await api.saveSettings(form);
    const settings = { ...emptySettings, ...result.settings };
    setForm(settings);
    onSaved?.(result.settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="border-b border-border">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-5 md:px-8">
          <Settings2 size={15} className="text-accent" />
          <span className="flex-1 min-w-0 py-2 text-[13px] font-semibold text-text">设置</span>
          <button
            onClick={saveModel}
            className={[
              "my-1.5 inline-flex h-7 shrink-0 items-center justify-center gap-1.5 px-3 text-[12.5px] font-medium transition-colors",
              saved ? "bg-success/10 text-success" : "bg-accent text-white hover:opacity-90",
            ].join(" ")}
          >
            {saved ? <><Check size={13} /> 已保存</> : "保存"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 md:px-8">
          <div className="divide-y divide-border">
            <Field label="外观">
              <select
                className={`${inputClass} cursor-pointer`}
                value={themePref}
                onChange={(e) => changeTheme(e.target.value as ThemePref)}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Field>

            <Field label="接口协议">
              <select
                className={`${inputClass} cursor-pointer`}
                value={form.driver || "responses"}
                onChange={(e) => set("driver", e.target.value)}
              >
                {DRIVER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Field>

            <Field label="API URL">
              <input
                className={inputClass}
                value={form.apiUrl}
                onChange={(e) => set("apiUrl", e.target.value)}
                placeholder={(DRIVER_OPTIONS.find((o) => o.id === (form.driver || "responses")) || DRIVER_OPTIONS[0]).urlPlaceholder}
              />
            </Field>

            <Field label="API Key">
              <input
                className={inputClass}
                type="password"
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </Field>

            <Field label="Model">
              <input
                className={inputClass}
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="该接口下的模型名,如 glm-4.7 / deepseek-chat"
              />
            </Field>

            <Field label="Default System Prompt" alignTop>
              <textarea
                className={`${inputClass} min-h-40 resize-y leading-relaxed`}
                rows={8}
                value={form.system}
                onChange={(e) => set("system", e.target.value)}
              />
            </Field>

            <Field label="Compress Threshold">
              <input
                className={inputClass}
                type="number"
                min={0}
                step={100}
                value={form.compressThreshold || "60000"}
                onChange={(e) => set("compressThreshold", e.target.value)}
              />
            </Field>

            <Field label="Tool Result Limit">
              <input
                className={inputClass}
                type="number"
                min={1000}
                max={50000}
                step={1000}
                value={form.toolResultMaxChars || "30000"}
                onChange={(e) => set("toolResultMaxChars", e.target.value)}
              />
            </Field>

            <Field label="Compaction Prompt" alignTop>
              <textarea
                className={`${inputClass} min-h-32 resize-y leading-relaxed`}
                rows={6}
                value={form.compactPrompt || ""}
                onChange={(e) => set("compactPrompt", e.target.value)}
              />
            </Field>

            <Field label="关于" alignTop>
              <div className="space-y-1.5 py-1 text-[13px] text-text-dim">
                <div>版本 {__APP_VERSION__}</div>
                <a
                  href={repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-accent hover:underline"
                >
                  {repositoryUrl}
                </a>
              </div>
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  alignTop = false,
}: {
  label: string;
  children: ReactNode;
  alignTop?: boolean;
}) {
  return (
    <label
      className={[
        "grid grid-cols-[170px_minmax(0,1fr)] gap-4 py-4 max-md:grid-cols-1 max-md:gap-2",
        alignTop ? "items-start" : "items-center",
      ].join(" ")}
    >
      <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{label}</span>
      {children}
    </label>
  );
}
