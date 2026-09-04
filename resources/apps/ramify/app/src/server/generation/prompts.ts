// 生成提示词:计划(定方向,结构化 JSON)+ 逐卡生成(单文件产出)。
// 提示词用英文 —— 中文提示会把短需求的产出拉向中文;可见文字的语言跟随用户需求本身。
export const CARD_TYPES = ['html', 'markdown', 'svg'] as const;
export type CardType = (typeof CARD_TYPES)[number];

const LANGUAGE_RULE =
  'Language: write every visible word in the same language as the user brief. '
  + 'If the brief names a target audience, market or language, follow that instead. '
  + 'Never mix languages within one piece of work.';

const SHARED_RULES =
  'Output the work itself only — no JSON, no markdown code fences, no explanation, no preamble. '
  + 'Never propose a backend, database, API, account login, payment, multi-page routing or anything needing a server: '
  + 'this tool produces self-contained single-file work only. '
  + LANGUAGE_RULE
  + ' Content must be substantive and believable, and the presentation refined.';

const GENERATOR_SYSTEMS: Record<CardType, string> = {
  html:
    'You are a senior designer and front-end engineer. Produce one self-contained HTML document: '
    + 'CSS and JS inlined, no external resources at all (no external fonts, images, scripts or stylesheets). '
    + 'Render imagery with inline SVG, CSS gradients and shapes, or emoji. '
    + 'Never link to external images or placeholder services, and never leave an empty or externally-pointing <img>. '
    + 'Output a complete document starting with <!DOCTYPE html> and ending with </html>. '
    + SHARED_RULES,
  markdown:
    'You are a senior writer and information architect. Produce one complete, well-structured Markdown document. '
    + 'Use heading levels, lists, tables, quotes and code blocks to organise the content. '
    + 'It must be substantive and immediately usable — no placeholders. '
    + 'Do not embed HTML tags and do not link to external images. Output plain Markdown text directly. '
    + SHARED_RULES,
  svg:
    'You are a senior illustrator and visual designer. Produce one self-contained SVG work: '
    + 'it must carry a viewBox, keep all styling inline, and use no external resources, no <script> and no bitmaps. '
    + 'Composition complete, detail rich, palette considered; render text with <text>. Output a complete <svg>…</svg>. '
    + SHARED_RULES,
};

export const generatorSystem = (type: CardType): string => GENERATOR_SYSTEMS[type] || GENERATOR_SYSTEMS.html;

export const PLAN_SYSTEM =
  'You are a senior creative director. Understand what the user actually wants, then split it into executable creative directions. '
  + 'Each direction has a short title, an output type, and an idea — a concrete direction for the downstream creator. '
  + 'Keep title and idea separate. '
  + LANGUAGE_RULE
  + ' Both title and idea follow that same language.\n'
  + 'Each direction picks one output type: html = pages, posters, interfaces, interactive demos; '
  + 'markdown = documents, articles, proposals, reading-first content; svg = logos, icons, illustrations, pure vector work. '
  + 'When the intent is clear, give every direction the same type; mix types only when the user explicitly wants to compare formats. '
  + 'This tool does not produce bitmap photographs: express photo-like intent through svg or html.\n'
  + 'Whatever the user already made explicit — subject, content, aesthetic leaning, audience — is evidence; '
  + 'never change what the user cares about just to manufacture variety. '
  + 'The more specific the brief, the more restrained the differences between directions; '
  + 'only when the brief is open, or the user explicitly asks to diverge, should the directions pull apart on style, structure and mood.\n'
  + 'Every idea must describe in natural language how this version should be made and how it differs from the others, '
  + 'directly executable by the downstream creator.';

const TYPE_TASK: Record<CardType, string> = {
  html: 'produce one complete single-file HTML page',
  markdown: 'write one complete Markdown document',
  svg: 'produce one complete SVG work',
};

export const rootPrompt = (idea: string, type: CardType): string =>
  `Following this creative direction, ${TYPE_TASK[type] || TYPE_TASK.html}:\n\n${idea}`;

export const branchPrompt = (parentType: string, parentContent: string, type: CardType, idea: string): string =>
  `This is the complete previous version (type: ${parentType}):\n\n${parentContent}\n\n`
  + `Building on it, ${TYPE_TASK[type] || TYPE_TASK.html} following the direction below. `
  + `The direction decides whether this is a large rework or a small adjustment:\n${idea}`;

export function planPrompt(params: { kind: 'root' | 'branch'; count: number; prompt: string; parentType?: string; parentContent?: string }): string {
  if (params.kind === 'root') {
    return `User brief:\n${params.prompt}\n\n`
      + `Plan ${params.count} creative directions that match the user's real intent and are distinguishable from each other, `
      + 'and pick an output type (html/markdown/svg) for each. '
      + 'The more specific the brief, the more restrained the differences. Do not manufacture difference mechanically. '
      + 'Every direction produces one complete piece of work.';
  }
  const context = params.parentContent
    ? `Previous version (type: ${params.parentType || 'html'}):\n${params.parentContent}`
    : 'No previous content.';
  return `${context}\n\nUser instruction for this round:\n${params.prompt}\n\n`
    + `Plan ${params.count} downstream directions that satisfy this instruction, and pick an output type (html/markdown/svg) for each. `
    + "Keep the previous version's type unless the user explicitly asks to change format. "
    + 'For a specific fix, let the versions differ only in detail, pacing or emphasis; for exploration, pull them clearly apart. '
    + 'Do not manufacture difference mechanically.';
}

// ── 产出整形与校验 ──

const stripFence = (text: string): string => {
  const m = String(text || '').trim().match(/^```[a-z]*\s*\n([\s\S]*?)\n?```$/i);
  return m ? m[1].trim() : String(text || '').trim();
};

export function normalizeContent(text: string, type: CardType): string {
  const content = type === 'markdown' ? String(text || '').trim() : stripFence(text);
  if (!content) throw new Error('missing_content');
  return content;
}

export function contentError(type: CardType, content: string): string {
  const value = String(content || '').trim();
  if (!value) return 'missing_content';
  if (type === 'html' && !(/<html[\s>]/i.test(value) && /<\/html>\s*$/i.test(value))) return 'invalid_html_output';
  if (type === 'svg' && (!/<svg[\s>]/i.test(value) || /<script[\s>]/i.test(value))) return 'invalid_svg_output';
  return '';
}

export type Direction = { title: string; type: CardType; idea: string };

/** 计划步的结构化输出约束:原生 json_schema,不靠提示词求格式。 */
export const DIRECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['directions'],
  properties: {
    directions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'type', 'idea'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['html', 'markdown', 'svg'] },
          idea: { type: 'string' },
        },
      },
    },
  },
} as const;

const asType = (value: unknown): CardType =>
  (CARD_TYPES as readonly string[]).includes(String(value || '').trim().toLowerCase())
    ? (String(value).trim().toLowerCase() as CardType) : 'html';

/** 宽松处理:方向少于请求数由调用方用最后一个补齐,完全没有才算失败。 */
export function parseDirections(text: string, count: number): Direction[] {
  let json: any;
  try { json = JSON.parse(stripFence(text)); } catch { throw new Error('plan_not_json'); }
  const raw = Array.isArray(json?.directions) ? json.directions : [];
  const directions = raw
    .map((item: any) => ({ title: String(item?.title || '').trim(), type: asType(item?.type), idea: String(item?.idea || '').trim() }))
    .filter((d: Direction) => d.title && d.idea);
  if (!directions.length) throw new Error('missing_directions');
  return directions.slice(0, count);
}
