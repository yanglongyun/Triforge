// 会话列表:对话不再长在文件树里,这里是它们的家。
// 置顶 / 最近两组;行上呼吸点 = 正在运行,绿点 = 未读;悬停 ⋯ 出操作。
import { useCallback, useEffect, useState } from "react";
import type { Node } from "../../../api";
import { api } from "../../../api";
import { ContextMenu, dialog, type MenuItem } from "../../ui";
import { Copy, Folder, FolderOpen, MoreVertical, Pencil, Pin, PinOff, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { relativeTime, toggleChatRowField, useChatRowFields, type ChatRowFields } from "../../../lib/chatRows";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

/** 目录短形:家目录换 ~,只留最后两级 —— 侧栏放不下全路径,尾部才是有信息量的那头。 */
const shortDir = (path: string) => {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return parts.length > 2 ? `…/${tail}` : `/${tail}`;
};

const REVEAL_LABEL = /Mac/i.test(navigator.platform) ? "在 Finder 中显示工作目录" : "在文件管理器中显示工作目录";

export function ChatRail({
  selectedId,
  onSelect,
  refreshKey,
  socket,
  createReq,
  onCreateHandled,
}: {
  selectedId: string;
  onSelect: (n: Node) => void;
  refreshKey: number;
  socket: Socket;
  /** 外部(文件夹右键)发起的「在此新建」请求:带预设 workdir。 */
  createReq: { workdir?: string } | null;
  onCreateHandled: () => void;
}) {
  const [agents, setAgents] = useState<Node[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const fields = useChatRowFields();
  // 显示项菜单只存**位置**:菜单项每次渲染现算 —— 勾完不关菜单,对勾要立刻跟着变,
  // 存成 items 快照的话勾了也不动(菜单是打开那一刻算的)
  const [fieldsMenuAt, setFieldsMenuAt] = useState<{ x: number; y: number } | null>(null);
  const fieldsMenuItems: MenuItem[] = ([
    ["dir", "所在目录"],
    ["last", "最后一条消息"],
    ["time", "时间"],
  ] as [keyof ChatRowFields, string][]).map(([key, label]) => ({
    label, checked: fields[key], keepOpen: true, onClick: () => toggleChatRowField(key),
  }));

  const load = useCallback(async () => {
    const result = await api.listChats().catch(() => null);
    if (result) setAgents(result.chats);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // 呼吸点:事件即亮即灭,10 秒轮询兜底对账
  useEffect(() => {
    const sync = () => api.listRuns().then((r) => setRunning(new Set(r.ids || []))).catch(() => {});
    sync();
    const timer = setInterval(sync, 10_000);
    const offs = [
      socket.on("conversation.start", (p: any) => setRunning((s) => new Set(s).add(String(p.chatId)))),
      ...["conversation.done", "conversation.aborted", "conversation.error"].map((t) =>
        socket.on(t, (p: any) => setRunning((s) => { const n = new Set(s); n.delete(String(p.chatId)); return n; })),
      ),
    ];
    return () => { clearInterval(timer); offs.forEach((f) => f()); };
  }, [socket]);

  // 新建 = 直接开聊:落一条「未命名对话」并打开,名字是系统的事 ——
  // 首条消息跑完后服务端自动取名(runs 层独立补全调用)
  const createNow = async (workdir?: string) => {
    const result = await api.createChat({ title: "", workdir });
    onSelect(result.node);
    load();
  };

  // 外部请求(顶部 + / 文件夹右键「在此新建对话」)
  useEffect(() => {
    if (!createReq) return;
    onCreateHandled();
    void createNow(createReq.workdir);
  }, [createReq]);

  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    await api.updateChat(id, { title });
    load();
  };

  const onContext = (e: React.MouseEvent, agent: Node) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: agent.pinned ? "取消置顶" : "置顶",
          icon: agent.pinned ? <PinOff size={13} /> : <Pin size={13} className="text-accent" />,
          onClick: async () => { await api.updateChat(agent.id, { pinned: !agent.pinned }); load(); } },
        { label: "重命名", icon: <Pencil size={13} />, onClick: () => { setRenamingId(agent.id); setRenameDraft(agent.title); } },
        { label: "复制 ID", icon: <Copy size={13} />,
          onClick: () => { navigator.clipboard.writeText(agent.id).catch(() => {}); } },
        { label: REVEAL_LABEL, icon: <FolderOpen size={13} />, onClick: () => { api.revealNode(agent.id).catch(() => {}); } },
        "divider",
        { label: "删除", icon: <Trash2 size={13} />, danger: true,
          onClick: async () => {
            if (!(await dialog.confirm(`删除对话「${agent.title}」?\n全部消息记录会一并删除;工作目录里的文件不受影响。`, { danger: true, confirmText: "删除" }))) return;
            await api.deleteChat(agent.id);
            load();
          } },
      ],
    });
  };

  const row = (agent: Node) => {
    const isSelected = selectedId === agent.id;
    const live = running.has(agent.id);
    const isRenaming = renamingId === agent.id;
    return (
      <div
        key={agent.id}
        onClick={() => { if (!isRenaming) onSelect(agent); }}
        onContextMenu={(e) => onContext(e, agent)}
        className={[
          "group flex items-start gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text",
          isSelected && !isRenaming ? "bg-bg-inset" : "hover:bg-bg-hover",
        ].join(" ")}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface border border-accent rounded px-1 -mx-1 py-px text-[14px] text-text outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 min-w-0 truncate text-[14.5px]">{agent.title}</span>
              {fields.time && (
                <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
                  {relativeTime(agent.last?.at || agent.updated_at)}
                </span>
              )}
            </div>
            {fields.dir && agent.workdir && (
              <div className="flex items-center gap-1 mt-px text-[11px] text-text-faint font-mono">
                <Folder size={10} className="shrink-0" />
                <span className="truncate">{shortDir(agent.workdir)}</span>
              </div>
            )}
            {fields.last && agent.last && (
              <div className="mt-px truncate text-[11.5px] text-text-faint">
                <span className="text-text-dim">{agent.last.role === "user" ? "我" : "助手"}:</span>{" "}
                {agent.last.text}
              </div>
            )}
          </div>
        )}
        {live
          ? <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px] bg-accent animate-pulse" title="正在运行" />
          : agent.unread
            ? <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px] bg-success" title="未读" />
            : null}
        <button
          onClick={(e) => { e.stopPropagation(); onContext(e, agent); }}
          className="shrink-0 self-center w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100 max-md:opacity-60"
          title="更多操作"
        >
          <MoreVertical size={14} />
        </button>
      </div>
    );
  };

  const pinned = agents.filter((a) => a.pinned);
  const recent = agents.filter((a) => !a.pinned);

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {/* 面板内部的创建入口(顶部 + 已让位给「添加面板」,创建归各面板自己) */}
      {agents.length > 0 && (
        <div
          onClick={() => void createNow()}
          className="flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover"
        >
          <Plus size={14} className="shrink-0" />
          <span className="text-[13.5px]">新建对话</span>
        </div>
      )}
      {pinned.length > 0 && (<>
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">置顶</div>
        {pinned.map(row)}
      </>)}
      {recent.length > 0 && (<>
        <div className="flex items-center gap-1 pl-3 pr-2 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">
          <span className="flex-1">最近</span>
          {/* 显示项:控制点就在这一行右端,不占额外空间、也不必进设置页 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setFieldsMenuAt((open) => (open ? null : { x: r.right - 176, y: r.bottom + 4 }));
            }}
            title="每行显示哪些信息"
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center hover:text-text hover:bg-bg-hover transition-colors"
          >
            <SlidersHorizontal size={12} />
          </button>
        </div>
        {recent.map(row)}
      </>)}

      {agents.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="text-3xl opacity-80">🌱</div>
          <div className="text-[13px] text-text-faint leading-relaxed">
还没有对话
          </div>
          <button
            onClick={() => void createNow()}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> 新建对话
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {fieldsMenuAt && (
        <ContextMenu x={fieldsMenuAt.x} y={fieldsMenuAt.y} items={fieldsMenuItems} onClose={() => setFieldsMenuAt(null)} />
      )}
    </div>
  );
}
