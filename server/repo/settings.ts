import { getDb } from "../db.js";

const DEFAULTS = {
  // 'responses' = OpenAI Responses API;'chat' = Chat Completions(GLM 等只有这个)。
  // 两个驱动在 ai/drivers/ 下彼此独立,循环和工具执行共用。
  driver: "responses",
  apiUrl: "",
  apiKey: "",
  model: "",
  compressThreshold: "60000",
  compactPrompt: "",
  toolResultMaxChars: "30000",
  // 匿名使用统计:on/off。只收 事件名/版本/平台/匿名安装 id(见 server/telemetry.ts)。
  telemetry: "on",
  // 护盾:rules = 盾开(按规则把关)/ skip = 盾关(见 server/permission/)。
  // 旧「逐步确认」档已收敛为内置规则「任何操作都问我」,老库的 ask 启动时被迁移。
  permissionMode: "rules",
  // 默认人格(无自定义 system 的对话的兜底)。工具清单 / 身份 / 协作规则由 buildSystem 每次注入,
  // 这里只放一段简洁、务实的基调,避免和注入内容重复或过时。
  system:
    "你是 Workbench 里的一个对话,以一个节点的形式活在用户的工作树里。\n" +
    "务实、简洁,把事情真正做完 —— 需要建文件、跑命令、查资料,或叫上别的对话协作时,直接用你的工具去做,而不是只在嘴上说。\n" +
    "完成后给一个清楚的最终回复;工具的细节不必复述给用户。",
};

const getSettings = () => {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) settings[row.key as keyof typeof DEFAULTS] = row.value;
  }
  return settings;
};

const saveSettings = (patch = {}) => {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    if (value === undefined || value === null) continue;
    stmt.run(key, String(value));
  }
  return getSettings();
};

export { getSettings, saveSettings, DEFAULTS };
