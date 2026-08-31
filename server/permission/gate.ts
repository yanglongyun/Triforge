// 审批门:包在每个工具执行器外面的一层。
//
// 位置是有讲究的 —— 它在 permission/,不在 ai/。ai/ 依然不感知工具、不感知权限,
// 它只知道「执行器返回了一个结果」。**被拒绝也是一种结果。**
//
// 拒绝以工具输出的形式回给模型(而不是抛错中断整轮),模型于是能换招或
// 如实告诉用户做不了 —— 这比让它撞死在半路上有用。
import { describe } from "./danger.js";
import { decide, type Mode, type Rule } from "./rules.js";
import { requestApproval } from "./approvals.js";

const refusal = (reason: string) =>
  ({ error: `用户拒绝了这次操作:${reason}。不要重试同一件事,换个做法或直接告诉用户。` });

export type GateOptions = {
  mode: Mode;
  rules: Rule[];
  context: { home?: string; cwd?: string };
  chatId: string;
  signal?: AbortSignal;
  /** 无人可问时是否直接拒绝(后台任务)。默认 false = 弹卡等人。 */
  headless?: boolean;
};

/** 给一张执行器表套上审批门,返回同样形状的一张表。 */
export const gate = (
  executors: Map<string, (args: any, ctx: any) => Promise<any>>,
  options: GateOptions,
) => {
  const { mode, rules, context, chatId, signal, headless = false } = options;
  const wrapped = new Map<string, (args: any, ctx: any) => Promise<any>>();

  for (const [name, execute] of executors) {
    // consult 本身就是「停下来问」这件事,再包一层门就会问两次 ——
    // 而且它永远不该被 skip 档跳过:助手主动提醒是它自己的判断,不受用户档位左右
    if (name === "consult") { wrapped.set(name, execute); continue; }

    wrapped.set(name, async (args, runContext) => {
      const request = describe(name, args);
      const verdict = decide({ mode, rules, request, context });

      if (verdict.effect === "ask") {
        // 没人可问就当场拒绝,不挂起 —— 后台任务不该被一个没人看的卡片卡住
        if (headless) return refusal("当前没有人可以确认这次操作");
        const answer = await requestApproval({ chatId, request, verdict, signal });
        if (answer !== "allow") {
          return refusal(answer === "timeout" ? "确认超时" : "用户在确认时选择了不允许");
        }
      }
      return execute(args, runContext);
    });
  }
  return wrapped;
};
