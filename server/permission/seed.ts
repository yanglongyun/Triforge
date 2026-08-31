// 护盾的开机收敛:把老库里的三档模型翻译成「盾是开关,规则是内容」。
//
// 旧模型有三档:逐步确认 / 按照规则 / 完全跳过。新模型只剩两个状态:
// skip = 盾关,rules = 盾开(按你写的规则把关)。「逐步确认」这一档整个去掉了 ——
// 它既不像规则也不像开关,夹在中间反而把层级搞乱,实际也几乎没人会一直开着。
//
// 1.2.0 曾把它做成内置规则「任何操作都问我」落在 rules 表里,这里一并清掉:
// 那行是系统种的,不是用户写的,删掉不会丢任何用户资产。
import { getDb } from "../db.js";
import { getSettings, saveSettings } from "../repo/settings.js";

const LEGACY_ASK_ALL_ID = "factory-ask-all";

/**
 * 硬闸从「猜」变成「存」之后,老规则要补上这个字段。
 *
 * 旧模型里「有没有闸」是从 match 三维是否为空推断的,所以当年凡是编译出了条件的,
 * 就等价于今天的 gate=true;三维全空的当年拦不住任何东西,今天也就是 gate=false。
 * 按这个对应补一次,老规则的行为一丝不变。
 */
const backfillGate = () => {
  const db = getDb();
  const rows = db.prepare("SELECT id, match_json FROM rules").all() as { id: string; match_json: string }[];
  const write = db.prepare("UPDATE rules SET match_json = ? WHERE id = ?");
  for (const row of rows) {
    let match: any;
    try { match = JSON.parse(row.match_json || "{}"); } catch { match = {}; }
    if (typeof match.gate === "boolean") continue; // 已经是新形状
    match.gate = Boolean(match.tools?.length || match.actions?.length || match.paths?.length);
    write.run(JSON.stringify(match), row.id);
  }
};

export const seedShield = () => {
  getDb().prepare("DELETE FROM rules WHERE id = ? OR origin = 'factory'").run(LEGACY_ASK_ALL_ID);
  backfillGate();
  const settings = getSettings() as { permissionMode?: string };
  // 老的「逐步确认」→ 盾开:两者都会拦,只是新模型按规则拦,不再每次都问
  if (settings.permissionMode === "ask") saveSettings({ permissionMode: "rules" });
};
