import { useMemo, useState } from 'react';

import type { Topic } from '../lib/types';

type OutlineTopic = Topic & { children: OutlineTopic[] };

function buildTree(topics: Topic[]) {
    const nodes = new Map<number, OutlineTopic>();
    for (const topic of topics) nodes.set(topic.id, { ...topic, children: [] });
    let root: OutlineTopic | null = null;
    for (const topic of nodes.values()) {
        if (topic.parent_id === null) { root = topic; continue; }
        nodes.get(topic.parent_id)?.children.push(topic);
    }
    for (const topic of nodes.values()) {
        topic.children.sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
    }
    return root;
}

function markdownText(text: string) {
    return text.replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>#])/g, '\\$1');
}

function toMarkdown(root: OutlineTopic) {
    const lines = [`# ${markdownText(root.text)}`, ''];
    const append = (topics: OutlineTopic[], depth: number) => {
        for (const topic of topics) {
            lines.push(`${'  '.repeat(depth)}- ${markdownText(topic.text)}`);
            append(topic.children, depth + 1);
        }
    };
    append(root.children, 0);
    return `${lines.join('\n')}\n`;
}

async function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy failed');
}

function OutlineRow({ topic, depth, onPatch }: {
    topic: OutlineTopic;
    depth: number;
    onPatch(id: number, patch: Partial<{ text: string; collapsed: boolean }>): Promise<void>;
}) {
    const [draft, setDraft] = useState(topic.text);
    const hasChildren = topic.children.length > 0;

    async function commit() {
        const next = draft.trim();
        if (!next) { setDraft(topic.text); return; }
        if (next !== topic.text) await onPatch(topic.id, { text: next });
    }

    return (
        <li className="outline-item">
            <div className={`outline-row${depth === 0 ? ' root' : ''}`}>
                {hasChildren ? (
                    <button
                        type="button"
                        className="outline-toggle"
                        title={topic.collapsed ? '展开' : '收起'}
                        aria-label={topic.collapsed ? '展开' : '收起'}
                        onClick={() => { void onPatch(topic.id, { collapsed: !topic.collapsed }); }}
                    >
                        <svg viewBox="0 0 16 16" aria-hidden><path d="m5 3 5 5-5 5" /></svg>
                    </button>
                ) : <span className="outline-leaf" />}
                <span className="outline-dot" aria-hidden />
                <input
                    value={draft}
                    maxLength={500}
                    aria-label={`${topic.text}，主题`}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => { void commit(); }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') { setDraft(topic.text); event.currentTarget.blur(); }
                    }}
                />
            </div>
            {hasChildren && !topic.collapsed ? (
                <ul>{topic.children.map((child) => <OutlineRow key={child.id} topic={child} depth={depth + 1} onPatch={onPatch} />)}</ul>
            ) : null}
        </li>
    );
}

export function Outline({ topics, onPatch }: {
    topics: Topic[];
    onPatch(id: number, patch: Partial<{ text: string; collapsed: boolean }>): Promise<void>;
}) {
    const root = useMemo(() => buildTree(topics), [topics]);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

    async function copyMarkdown() {
        if (!root) return;
        try {
            await copyText(toMarkdown(root));
            setCopyState('copied');
        } catch {
            setCopyState('error');
        }
        window.setTimeout(() => setCopyState('idle'), 1800);
    }

    return (
        <div className="outline-view">
            <div className="outline-sheet">
                <div className="outline-actions">
                    <button type="button" className={copyState} onClick={() => { void copyMarkdown(); }}>
                        <svg viewBox="0 0 20 20" aria-hidden><rect x="6" y="6" width="10" height="10" rx="2" /><path d="M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4" /></svg>
                        {copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '复制 Markdown'}
                    </button>
                </div>
                {root ? <ul className="outline-tree"><OutlineRow topic={root} depth={0} onPatch={onPatch} /></ul> : null}
            </div>
        </div>
    );
}
