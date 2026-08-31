// Yjs 的 WebSocket 服务端 —— 自己实现,不用 @y/websocket-server。
// 理由:那个包依赖 yjs@14 预发布版,而客户端全家(y-prosemirror / y-websocket / tiptap)
// 都在 13.x,一个进程里两个大版本会破坏 Yjs 的 instanceof 检查。
// 协议本身只有两类消息,自己写反而把持久化的控制权拿了回来。
//
// 线上格式(与 y-websocket 客户端逐字节兼容):
//   [varUint 类型][载荷]   类型 0 = sync(y-protocols/sync)、1 = awareness

import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as repo from '../store/repo.mjs';
import { broadcast } from './events.mjs';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const WS_OPEN = 1;
const SAVE_DEBOUNCE = 800;
const PING_INTERVAL = 25_000;

/** 房间名就是页面 id。别的一律拒掉,免得野连接在内存里堆文档。 */
const pageIdOf = (roomName) => {
  const id = Number(String(roomName).replace(/^page-/, ''));
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** 从 Yjs 文档抽纯文本,只为搜索。ProseMirror 的 XmlFragment 展平即可。 */
function plainText(doc) {
  const out = [];
  const walk = (node) => {
    if (node instanceof Y.XmlText) { out.push(node.toString()); return; }
    if (typeof node.toArray === 'function') node.toArray().forEach(walk);
  };
  doc.getXmlFragment('body').toArray().forEach(walk);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 200_000);
}

class Room {
  constructor(pageId) {
    this.pageId = pageId;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null); // 服务端不是一个参与者
    this.conns = new Map(); // conn -> { ids: Set<clientId>, beat: Timeout }
    this.timer = null;

    const stored = repo.loadDoc(pageId);
    if (stored) Y.applyUpdate(this.doc, new Uint8Array(stored));

    this.doc.on('update', (update, origin) => {
      this.relay(this.encodeSync((encoder) => syncProtocol.writeUpdate(encoder, update)), origin);
      this.scheduleSave();
    });

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const entry = this.conns.get(origin);
      if (entry) {
        added.forEach((id) => entry.ids.add(id));
        removed.forEach((id) => entry.ids.delete(id));
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.relay(encoding.toUint8Array(encoder), null);
    });
  }

  encodeSync(write) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    return encoding.toUint8Array(encoder);
  }

  relay(bytes, except) {
    for (const conn of this.conns.keys()) {
      if (conn === except) continue;
      this.send(conn, bytes);
    }
  }

  send(conn, bytes) {
    if (conn.readyState !== WS_OPEN) { this.drop(conn); return; }
    try { conn.send(bytes, (error) => error && this.drop(conn)); }
    catch { this.drop(conn); }
  }

  /** 防抖落盘。每个按键都写盘没必要;只等「最后一个连接断开」又太晚 ——
   *  手机切后台时那次断开可能永远等不到。 */
  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, SAVE_DEBOUNCE);
  }

  save() {
    try {
      repo.saveDoc(this.pageId, Buffer.from(Y.encodeStateAsUpdate(this.doc)), plainText(this.doc));
      broadcast('doc'); // 侧栏的「最近编辑」跟着动
    } catch (error) {
      console.error('[notes] 正文落盘失败', error);
    }
  }

  flush() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }

  join(conn) {
    conn.binaryType = 'arraybuffer';

    // 心跳存进 conns，由 drop() 统一清 —— 只靠 'close' 事件回收会漏,
    // 而一个漏掉的 setInterval 足以把整个事件循环吊住不退。
    let alive = true;
    const beat = setInterval(() => {
      if (!alive) { this.drop(conn); return; }
      alive = false;
      try { conn.ping(); } catch { this.drop(conn); }
    }, PING_INTERVAL);
    this.conns.set(conn, { ids: new Set(), beat });

    conn.on('pong', () => { alive = true; });
    conn.on('message', (data) => this.receive(conn, new Uint8Array(data)));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));

    // 握手:先要对方的状态向量,再把在场的人告诉他
    this.send(conn, this.encodeSync((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc)));
    const present = Array.from(this.awareness.getStates().keys());
    if (present.length) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, present));
      this.send(conn, encoding.toUint8Array(encoder));
    }
  }

  receive(conn, bytes) {
    try {
      const decoder = decoding.createDecoder(bytes);
      switch (decoding.readVarUint(decoder)) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
          // 只有 syncStep1 需要回话;length 是 1 说明只写了类型字节
          if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
          break;
        default: break; // 不认识的消息类型直接丢,不断连接
      }
    } catch (error) {
      console.error('[notes] 处理 Yjs 消息失败', error);
    }
  }

  drop(conn) {
    const entry = this.conns.get(conn);
    if (!entry) return;
    this.conns.delete(conn);
    clearInterval(entry.beat);
    awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(entry.ids), null);
    try { conn.terminate(); } catch { /* 已经断了 */ }
    if (!this.conns.size) this.flush(); // 人走光了,立刻落盘,别等防抖
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const conn of [...this.conns.keys()]) this.drop(conn);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export function attachYjs(server) {
  const rooms = new Map();
  const roomFor = (pageId) => {
    let room = rooms.get(pageId);
    if (!room) { room = new Room(pageId); rooms.set(pageId, room); }
    return room;
  };

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    const pageId = pageIdOf(url.pathname.replace(/^\/(yjs\/)?/, ''));
    if (!pageId) { socket.destroy(); return; }
    // 页面不存在就别开房间 —— 否则删掉的页还能被连上并写回来
    try { repo.getPage(pageId); } catch { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (conn) => roomFor(pageId).join(conn));
  });

  return {
    /** 页面被删时把内存里那份也扔掉,别让它再写回一个已经不存在的页 */
    forget(pageId) {
      const room = rooms.get(pageId);
      if (!room) return;
      rooms.delete(pageId);
      clearTimeout(room.timer);
      room.timer = null;
      room.destroy();
    },
    flush() { for (const room of rooms.values()) room.flush(); },
    /** 关服务用:先落盘,再断连接、清心跳,让事件循环能空掉 */
    destroyAll() {
      for (const room of rooms.values()) { room.flush(); room.destroy(); }
      rooms.clear();
      wss.close();
    },
    get size() { return rooms.size; },
  };
}
