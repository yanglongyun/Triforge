// 应用后端运行时(workerd)的进程管理:生成配置 → 拉起 → 健康检查 → 随主进程退出。
//
// 架构(0.7.0,见 APP.md「应用后端」):
//   Node 侧车 ──spawn──▶ workerd(monitor=overseer worker)
//     ▲  NODE 外部服务绑定(回环 127.0.0.1:nodePort,能力网关的执行端)
//     └── UI 经 ws://127.0.0.1:<gadgetPort>/g/<secret>/<appId> 直连 Cap'n Web 会话
// secret 每次启动随机生成:本机其他页面猜不到,连不上 —— workerd 端口不设 Origin 门卫的补偿。
import { randomBytes } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.WORKBENCH_HOME || path.join(__dirname, "..");

let child: ChildProcess | null = null;
let state: { port: number; secret: string } | null = null;

const workerdBin = () => {
  if (process.env.WORKBENCH_WORKERD) return process.env.WORKBENCH_WORKERD;
  return path.join(HOME, "node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd"); // 开发态
};
const overseerBundle = () => {
  if (process.env.WORKBENCH_OVERSEER) return process.env.WORKBENCH_OVERSEER;
  return path.join(HOME, "dist/overseer.js"); // 开发态(npm run build:overseer 的产物)
};

const pickPort = () => new Promise<number>((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const port = typeof address === "object" && address ? address.port : 0;
    probe.close(() => resolve(port));
  });
});

const buildConfig = (nodePort: number, gadgetPort: number, secret: string) => `# 由 Workbench 启动时生成,勿手改(server/gadgets.ts)
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "overseer",
      worker = (
        modules = [ ( name = "overseer.js", esModule = embed "overseer.js" ) ],
        compatibilityDate = "2026-02-01",
        bindings = [
          ( name = "LOADER", workerLoader = ( id = "apps" ) ),
          ( name = "NODE", service = "node" ),
          ( name = "SECRET", text = "${secret}" ),
        ],
      )
    ),
    ( name = "node", external = ( address = "127.0.0.1:${nodePort}" ) ),
  ],
  sockets = [ ( name = "http", address = "127.0.0.1:${gadgetPort}", http = (), service = "overseer" ) ]
);
`;

const waitHealthy = async (port: number, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    if (child && child.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

/** 启动应用后端运行时。失败不拖垮主服务 —— 没有它只是 gadget 能力不可用。 */
export const startGadgetRuntime = async (nodePort: number) => {
  try {
    const bin = workerdBin();
    const bundle = overseerBundle();
    if (!fs.existsSync(bin) || !fs.existsSync(bundle)) {
      console.log("[gadgets] 未找到 workerd 或 overseer 产物,应用后端能力停用");
      return;
    }
    const runtimeDir = path.join(HOME, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundle, path.join(runtimeDir, "overseer.js"));

    const gadgetPort = await pickPort();
    const secret = randomBytes(24).toString("hex");
    const configPath = path.join(runtimeDir, "workerd.capnp");
    fs.writeFileSync(configPath, buildConfig(nodePort, gadgetPort, secret));

    child = spawn(bin, ["serve", configPath, "--experimental"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => process.stdout.write(`[workerd] ${chunk}`));
    child.stderr?.on("data", (chunk: string) => process.stderr.write(`[workerd] ${chunk}`));
    child.on("exit", (code) => {
      if (state) console.error(`[gadgets] workerd 退出(code ${code}),应用后端能力停用`);
      child = null;
      state = null;
    });

    if (await waitHealthy(gadgetPort)) {
      state = { port: gadgetPort, secret };
      console.log(`[gadgets] 应用后端运行时就绪:127.0.0.1:${gadgetPort}`);
    } else {
      console.error("[gadgets] workerd 启动失败,应用后端能力停用");
      try { child?.kill("SIGTERM"); } catch { /* 已退出 */ }
    }
  } catch (e: any) {
    console.error("[gadgets] 启动异常:", e?.message);
  }
};

/** UI 取直连信息(同源 GET,外源读不到响应)。null = 运行时不可用。 */
export const gadgetEndpoint = () => state;

export const stopGadgetRuntime = () => {
  state = null;
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* 已退出 */ }
    child = null;
  }
};

process.on("exit", stopGadgetRuntime);
process.on("SIGTERM", () => { stopGadgetRuntime(); process.exit(0); });
process.on("SIGINT", () => { stopGadgetRuntime(); process.exit(0); });
