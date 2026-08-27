import { getDb } from "../db.js";

const createCompaction = ({ agentId, startMessageId, endMessageId, summary, tokens = 0 }: {
  agentId: string; startMessageId: number; endMessageId: number; summary: string; tokens?: number;
}) => {
  const result = getDb().prepare(`
    INSERT INTO compactions (agent_id, start_message_id, end_message_id, summary, tokens)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(agentId), Number(startMessageId), Number(endMessageId), String(summary || ""), Number(tokens) || 0);
  return Number(result.lastInsertRowid);
};

const getLatestCompaction = (agentId: string) => getDb().prepare(`
  SELECT id, agent_id, start_message_id, end_message_id, summary, tokens, created_at
  FROM compactions
  WHERE agent_id = ?
  ORDER BY end_message_id DESC, id DESC
  LIMIT 1
`).get(String(agentId)) || null;

export { createCompaction, getLatestCompaction };
