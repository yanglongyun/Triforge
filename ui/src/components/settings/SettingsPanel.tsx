import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "../../api";
import { api } from "../../api";
import { getThemePref, setThemePref, type ThemePref } from "../../lib/theme";
import { SEARCH_ENGINES, getSearchEngine, setSearchEngine, type SearchEngineId } from "../../lib/search";
import { chromeImportAvailable } from "../../lib/chromeImport";
import { Check, Settings2 } from "lucide-react";
import { ChromeImportDialog } from "../ui";

const emptySettings: Settings = {
  apiUrl: "",
  apiKey: "",
  model: "",
  system: "",
  compressThreshold: "60000",
  compactPrompt: "",
  toolResultMaxChars: "30000",
  telemetry: "on",
};

const inputClass =
  "w-full border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent";
const repositoryUrl = "https://github.com/yanglongyun/Worktop";

export function SettingsPanel({ onSaved }: { onSaved?: (settings: Settings) => void }) {
  const [form, setForm] = useState<Settings>(emptySettings);
  const [saved, setSaved] = useState(false);
  // 外观是本机视觉偏好:即改即生效,存 localStorage,不进服务端设置
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());
  // 搜索引擎同理:地址栏 / 新标签页里输了不像网址的东西交给谁搜
  const [searchEngine, setSearchEngineState] = useState<SearchEngineId>(() => getSearchEngine().id);
  const changeSearchEngine = (id: SearchEngineId) => { setSearchEngine(id); setSearchEngineState(id); };
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

            <Field label="搜索引擎">
              <select
                className={`${inputClass} cursor-pointer`}
                value={searchEngine}
                onChange={(e) => changeSearchEngine(e.target.value as SearchEngineId)}
              >
                {SEARCH_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="mt-1.5 text-[12px] text-text-faint">地址栏和新标签页里输的不像网址的内容,交给它搜。</div>
            </Field>

            <Field label="接口地址">
              <input
                className={inputClass}
                value={form.apiUrl}
                onChange={(e) => set("apiUrl", e.target.value)}
                placeholder="https://api.openai.com/v1/responses"
              />
            </Field>

            <Field label="密钥">
              <input
                className={inputClass}
                type="password"
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </Field>

            <Field label="模型">
              <input
                className={inputClass}
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="该接口下的模型名,如 glm-4.7 / deepseek-chat"
              />
            </Field>

            <Field label="默认系统提示词" alignTop>
              <textarea
                className={`${inputClass} min-h-40 resize-y leading-relaxed`}
                rows={8}
                value={form.system}
                onChange={(e) => set("system", e.target.value)}
              />
            </Field>

            <Field label="压缩阈值">
              <input
                className={inputClass}
                type="number"
                min={0}
                step={100}
                value={form.compressThreshold || "60000"}
                onChange={(e) => set("compressThreshold", e.target.value)}
              />
            </Field>

            <Field label="工具结果上限">
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

            <Field label="压缩提示词" alignTop>
              <textarea
                className={`${inputClass} min-h-32 resize-y leading-relaxed`}
                rows={6}
                value={form.compactPrompt || ""}
                onChange={(e) => set("compactPrompt", e.target.value)}
              />
            </Field>

            <Field label="网页登录状态" alignTop group>
              <BrowserLogins />
            </Field>

            <Field label="匿名统计">
              <div>
                <select
                  className={`${inputClass} cursor-pointer`}
                  value={form.telemetry || "on"}
                  onChange={(e) => set("telemetry", e.target.value)}
                >
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
                <div className="mt-1.5 text-[12px] text-text-faint">
                  仅上报事件名、版本、平台与匿名安装 id,用于统计活跃与更新率;不含任何对话、文件或网址内容。
                </div>
              </div>
            </Field>

            <Field label="关于" alignTop group>
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

/** 网页标签的登录态:导入、退出、清缓存。三个动作分开 —— 别让用户一按就退登。 */
function BrowserLogins() {
  const [available, setAvailable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => { void chromeImportAvailable().then(setAvailable); }, []);

  const run = (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNote("");
    void action()
      .then(setNote)
      .catch((e) => setNote(e?.message || "操作失败"))
      .finally(() => setBusy(""));
  };

  const rowBtn = "shrink-0 px-3 py-1.5 border border-border text-[13px] text-text hover:bg-bg-hover disabled:opacity-40 transition-colors";

  return (
    <div className="space-y-3 py-1">
      {importOpen && (
        <ChromeImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(r) => setNote(
            `已从 ${r.profile} 导入 ${r.imported} 条登录信息` +
            `${r.failed ? `,跳过 ${r.failed} 条` : ""}` +
            `${r.bookmarks ? `,新增 ${r.bookmarks} 个网站` : ""}。刷新页面后生效。`,
          )}
        />
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text">从 Chrome 导入登录状态</div>
          <div className="mt-0.5 text-[12px] text-text-faint leading-relaxed">
            {available
              ? "选择配置与要导入的数据。导入登录信息需通过系统钥匙串授权。"
              : "需要 macOS 上装有 Chrome"}
          </div>
        </div>
        <button className={rowBtn} disabled={!available || !!busy} onClick={() => setImportOpen(true)}>
          导入…
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text">退出所有网站</div>
          <div className="mt-0.5 text-[12px] text-text-faint">清除 Cookie 与站点数据,所有网站将退出登录</div>
        </div>
        <button
          className={rowBtn}
          disabled={!!busy}
          onClick={() => run("logout", async () => {
            const r = await window.worktopDesktop?.clearWebLogins();
            if (r && !r.ok) throw new Error(r.error || "清除失败");
            return "已退出所有网站";
          })}
        >
          {busy === "logout" ? "清除中…" : "清除"}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text">清空网站权限</div>
          <div className="mt-0.5 text-[12px] text-text-faint">撤销已授予的摄像头、麦克风、位置等权限,以及证书例外</div>
        </div>
        <button
          className={rowBtn}
          disabled={!!busy}
          onClick={() => run("perm", async () => {
            await window.worktopDesktop?.forgetWebPermissions();
            return "已清空,下次访问会重新询问。";
          })}
        >
          {busy === "perm" ? "清空中…" : "清空"}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text">清除缓存</div>
          <div className="mt-0.5 text-[12px] text-text-faint">腾出磁盘空间,不影响登录状态</div>
        </div>
        <button
          className={rowBtn}
          disabled={!!busy}
          onClick={() => run("cache", async () => {
            const r = await window.worktopDesktop?.clearWebCache();
            if (r && !r.ok) throw new Error(r.error || "清除失败");
            return "缓存已清除";
          })}
        >
          {busy === "cache" ? "清除中…" : "清除"}
        </button>
      </div>

      {note && <div className="text-[12px] text-accent">{note}</div>}
    </div>
  );
}

/**
 * 一行设置:左边标题,右边内容。
 *
 * **只装着一个控件时才用 `<label>`。** label 会把落在它任何地方的点击转发给里面的
 * 第一个表单控件 —— 对单个输入框这是想要的(点标题就聚焦),但内容是一组行的时候
 * 就成了灾难:点左边空白的标题栏,会触发那一组里的第一个按钮。
 * 「点设置页的空白处,弹出了从浏览器导入」就是这么来的,不是弹窗自己的问题。
 *
 * 所以装一组东西的用 `group`,渲染成普通 div,点空白什么都不会发生。
 */
function Field({
  label,
  children,
  alignTop = false,
  group = false,
}: {
  label: string;
  children: ReactNode;
  alignTop?: boolean;
  /** 内容是一组控件(多按钮/多行)而不是单个输入框 —— 用 div,别用 label。 */
  group?: boolean;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag
      className={[
        "grid grid-cols-[170px_minmax(0,1fr)] gap-4 py-4 max-md:grid-cols-1 max-md:gap-2",
        alignTop ? "items-start" : "items-center",
      ].join(" ")}
    >
      <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{label}</span>
      {children}
    </Tag>
  );
}
