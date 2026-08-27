// 计数器的后端:跑在 workerd isolate 里(物理断网,只有 env.HOST 一条路)。
// isolate 内存只当缓存 —— 真状态经 HOST.dbExec 落在应用私有 SQLite 里,重启不丢。
import { WorkerEntrypoint } from "cloudflare:workers";

export class Gadget extends WorkerEntrypoint {
  async #init() {
    await this.env.HOST.dbExec(
      "CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)",
    );
  }

  async get() {
    await this.#init();
    const r = await this.env.HOST.dbExec("SELECT n FROM counter WHERE id = 1");
    return (r.rows && r.rows[0] && r.rows[0].n) || 0;
  }

  async increment(by) {
    await this.#init();
    const step = Number(by) || 1;
    await this.env.HOST.dbExec(
      "INSERT INTO counter (id, n) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET n = n + ?",
      [step, step],
    );
    return this.get();
  }

  /** 自证清白:我在哪跑、能不能上网。 */
  async whereAmI() {
    await this.env.HOST.log("counter.whereAmI() 被调用");
    let net;
    try { await fetch("https://example.com"); net = "居然有网(不应该!)"; }
    catch { net = "物理断网 ✓"; }
    return { runtime: "workerd isolate(动态装载,globalOutbound: null)", net };
  }
}
