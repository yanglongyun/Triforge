// 变更对照视图:@codemirror/merge 的左右双栏,词级差异高亮 + 语法着色 + 折叠未变段。
// 只读展示(暂存/丢弃等动作在外层工具条),Git diff 面板与将来的 AI 变更审阅共用。
import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { minimalSetup } from "codemirror";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { THEME_EVENT, resolvedTheme } from "../../lib/theme";
import { langFor } from "./CodeEditor";

const diffTheme = EditorView.theme({
  "&": { fontSize: "12.5px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": { background: "transparent", border: "none", color: "var(--color-text-faint)" },
  "&.cm-focused": { outline: "none" },
});

export function DiffView({ before, after, filename }: { before: string; after: string; filename: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState(resolvedTheme());
  useEffect(() => {
    const onTheme = () => setTheme(resolvedTheme());
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const side = (doc: string) => ({
      doc,
      extensions: [
        minimalSetup,
        lineNumbers(),
        langFor(filename),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        diffTheme,
        ...(theme === "dark" ? [oneDark] : []),
      ],
    });
    const view = new MergeView({
      a: side(before),
      b: side(after),
      parent: hostRef.current,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    return () => view.destroy();
  }, [before, after, filename, theme]);

  return <div ref={hostRef} className="wb-diff flex-1 min-h-0 overflow-auto bg-bg" />;
}
