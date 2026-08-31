import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface Session {
  doc: Y.Doc;
  provider: WebsocketProvider;
  local: IndexeddbPersistence;
  destroy(): void;
}

/**
 * 一页一份 Yjs 文档，两层持久化：
 *  - IndexedDB：本机离线副本，断网也能改，重连后自动合并
 *  - WebSocket：服务端那份权威状态，多端实时同步
 * 两层都是 CRDT，合并不需要冲突解决。
 */
export function openSession(pageId: number): Session {
  const doc = new Y.Doc();
  const room = `page-${pageId}`;
  const local = new IndexeddbPersistence(room, doc);
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const provider = new WebsocketProvider(url, room, doc, { connect: true });

  return {
    doc,
    provider,
    local,
    destroy() {
      provider.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}

/** 光标颜色：从 id 派生，同一个人在不同设备上颜色稳定。 */
export const hueFor = (seed: string) => {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
};
