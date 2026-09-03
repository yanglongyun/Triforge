// 对话列表:对话不再长在文件树里,这里是它们的家。
// 工具行:搜索(只搜对话)+ ＋ 新建 + ⋯(排序 / 每行显示什么 / 清理空对话)。
// 置顶 / 最近两组;行上呼吸点 = 正在运行,绿点 = 未读;悬停 ⋯ 出操作。
import { useCallback, useEffect, useState } from "react";
import type { Node } from "../../../api";
import { api } from "../../../api";
import { ContextMenu, dialog, type MenuItem } from "../../ui";
import { Copy, Folder, FolderOpen, MoreVertical, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Toolbar } from "../Toolbar";
import { relativeTime, toggleChatRowField, useChatRowFields, type ChatRowFields } from "../../../lib/chatRows";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

/** 目录短形:家目录换 ~,只留最后两级 —— 侧栏放不下全路径,尾部才是有信息量的那头。 */
const shortDir = (path: string) => {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return parts.length > 2 ? `…/${tail}` : `/${tail}`;
};

const SORT_KEY = "worktop.chats.sort";
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
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name">(() => (localStorage.getItem(SORT_KEY) === "name" ? "name" : "recent"));
  const changeSort = (next: "recent" | "name") => { setSort(next); localStorage.setItem(SORT_KEY, next); };
  // ⋯ 菜单每次打开现算:勾选项勾完不关菜单,对勾要立刻跟着变
  const moreItems = (): MenuItem[] => [
    { label: "按最近排序", checked: sort === "recent", keepOpen: true, onClick: () => changeSort("recent") },
    { label: "按名称排序", checked: sort === "name", keepOpen: true, onClick: () => changeSort("name") },
    "divider",
    ...([["dir", "显示所在目录"], ["last", "显示最后一条消息"], ["time", "显示时间"]] as [keyof ChatRowFields, string][])
      .map(([key, label]): MenuItem => ({ label, checked: fields[key], keepOpen: true, onClick: () => toggleChatRowField(key) })),
    "divider",
    { label: "清理空对话", icon: <Trash2 size={13} />, danger: true, disabled: !agents.some((a) => !a.last && !running.has(a.id)),
      onClick: () => void cleanEmpty() },
  ];

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

  // 清理空对话:一句话都没说过、也没在跑的
  const cleanEmpty = async () => {
    const empty = agents.filter((a) => !a.last && !running.has(a.id));
    if (!empty.length) return;
    if (!(await dialog.confirm(`删除 ${empty.length} 个空对话?`, { danger: true, confirmText: "删除" }))) return;
    for (const a of empty) await api.deleteChat(a.id).catch(() => {});
    load();
  };

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

  const needle = q.trim().toLowerCase();
  const matches = (a: Node) =>
    !needle || a.title.toLowerCase().includes(needle) || (a.workdir || "").toLowerCase().includes(needle) || (a.last?.text || "").toLowerCase().includes(needle);
  const byName = (a: Node, b: Node) => a.title.localeCompare(b.title, "zh");
  const visible = agents.filter(matches);
  const pinned = sort === "name" ? visible.filter((a) => a.pinned).sort(byName) : visible.filter((a) => a.pinned);
  const recent = sort === "name" ? visible.filter((a) => !a.pinned).sort(byName) : visible.filter((a) => !a.pinned);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="搜索对话…"
        add={{ title: "新建对话", onClick: () => void createNow() }}
        more={moreItems}
      />
      <div className="flex-1 overflow-y-auto py-1">
        {pinned.length > 0 && (<>
          {!needle && <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">置顶</div>}
          {pinned.map(row)}
        </>)}
        {recent.length > 0 && (<>
          {!needle && <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">最近</div>}
          {recent.map(row)}
        </>)}

        {needle && !visible.length && (
          <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">没有匹配的对话</div>
        )}
        {!needle && agents.length === 0 && (
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
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
