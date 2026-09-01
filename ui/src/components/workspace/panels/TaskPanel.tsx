// 任务详情(标签页):应用触发的一次 agent 轮次,摊开看指令、回复、报错。
import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { api, type TaskInfo } from "../../../api";
import type { TaskTab } from "../types";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const STATUS: Record<TaskInfo["status"], { label: string; cls: string }> = {
  running: { label: "进行中", cls: "text-accent bg-accent-soft" },
  done: { label: "已完成", cls: "text-success bg-success/10" },
  error: { label: "失败", cls: "text-danger bg-danger/10" },
  aborted: { label: "已中止", cls: "text-text-faint bg-bg-inset" },
};

export function TaskPanel({ tab, socket }: { tab: TaskTab; socket: Socket }) {
  const [task, setTask] = useState<TaskInfo | null | undefined>(undefined); // undefined = 读取中

  const load = useCallback(() => {
    void api.listTasks(200)
      .then((list) => setTask(list.find((t) => t.id === tab.taskId) || null))
      .catch(() => setTask(null));
  }, [tab.taskId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => socket.on("tasks_changed", load), [socket, load]);

  if (task === undefined) {
    return <div className="flex-1 flex items-center justify-center text-[13px] text-text-faint">读取中…</div>;
  }
  if (!task) {
    return <div className="flex-1 flex items-center justify-center text-[13px] text-text-faint">这条任务不在了</div>;
  }

  const meta = STATUS[task.status] || STATUS.done;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="max-w-[760px] mx-auto px-8 py-8 flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2 text-[11.5px] text-text-faint">
            <Activity size={13} className="text-accent" />
            <span>{task.app_id}</span>
            <span className={`px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
            <span>{task.created_at}</span>
          </div>
          <h1 className="mt-2 text-[19px] font-semibold text-text leading-snug">{task.title || task.prompt}</h1>
        </div>

        <Section title="指令">{task.prompt}</Section>
        {task.error && <Section title="报错" danger>{task.error}</Section>}
        {task.response && <Section title="回复">{task.response}</Section>}
        {task.status === "running" && !task.response && (
          <div className="text-[12.5px] text-text-faint">还在跑,完成后这里会出现回复。</div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, danger = false }: { title: string; children: string; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] text-text-faint tracking-[1.5px] select-none">{title}</div>
      <div className={[
        "rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
        danger ? "border-danger/30 bg-danger/5 text-danger" : "border-border bg-surface text-text",
      ].join(" ")}>
        {children}
      </div>
    </div>
  );
}
