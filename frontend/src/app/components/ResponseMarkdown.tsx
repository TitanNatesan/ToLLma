"use client";

import React, { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toast } from "@/lib/notify";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Info,
  Lightbulb,
  Pencil,
  ShieldAlert,
  Table,
  WrapText,
} from "lucide-react";
import { MermaidBlock } from "./MermaidBlock";
import {
  HtmlPreview,
  HtmlPreviewFullscreen,
  isPreviewableLanguage,
} from "./HtmlPreview";
import { InlineCitation, type CitationSource } from "./chat/citations/InlineCitation";
import { cn } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

/** Minimal hast shapes for the citation transform (no unist dependency). */
interface HastTextNode {
  type: "text";
  value: string;
}
interface HastElementNode {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
interface HastParentNode {
  type: string;
  children?: HastNode[];
}
type HastNode = HastTextNode | HastElementNode | HastParentNode;

const CITATION_MARKER = /\[(\d{1,3})\]/g;
const CITATION_SKIP_TAGS = new Set(["code", "pre", "math", "annotation", "semantics"]);

// Fenced blocks (```...```, possibly unterminated while streaming) and
// inline code (`...`): math delimiters inside them are literal source text
// and must never be rewritten.
const CODE_SPAN_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
// remark-math only understands $...$ / $$...$$, but models frequently emit
// LaTeX-style \(...\) and \[...\] (often multi-line). Normalize those to
// dollar form in prose segments. Unmatched delimiters (mid-stream) pass
// through untouched; an escaped \\[ stays literal.
const LATEX_INLINE_RE = /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g;
const LATEX_DISPLAY_RE = /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g;

/**
 * Convert LaTeX-style math delimiters to dollar form for remark-math.
 * Code spans are preserved byte-for-byte; only prose is rewritten.
 * Exported for unit tests.
 */
export function normalizeMathDelimiters(content: string): string {
  return content.split(CODE_SPAN_RE).map((segment, i) => {
    if (i % 2 === 1) return segment;
    return segment
      .replace(LATEX_DISPLAY_RE, (_, inner: string) => `$$${inner}$$`)
      .replace(LATEX_INLINE_RE, (_, inner: string) => `$${inner}$`);
  }).join("");
}

/**
 * KaTeX renders math to `span.katex` trees (incl. an `annotation` with the raw
 * TeX source). Citations must not rewrite inside them.
 */
function isSkippedElement(node: HastElementNode): boolean {
  if (CITATION_SKIP_TAGS.has(node.tagName)) return true;
  const raw = node.properties?.className ?? node.properties?.class;
  const classes = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : [];
  return classes.some((c) => c === "katex" || c === "math" || String(c).startsWith("katex"));
}

/**
 * Rehype plugin: turn `[n]` text markers into `<sup data-citation-index="n">`
 * elements so the markdown renderer can mount AI Elements InlineCitation
 * markers. Code and pre subtrees are left untouched. Exported for unit tests.
 */
export function rehypeCitations({ maxIndex }: { maxIndex: number }) {
  function transform(node: HastNode) {
    if (!("children" in node) || !node.children) return;
    if (node.type === "element" && isSkippedElement(node as HastElementNode)) {
      return;
    }
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text") {
        transform(child);
        next.push(child);
        continue;
      }
      const value = (child as HastTextNode).value;
      let last = 0;
      let found = false;
      CITATION_MARKER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CITATION_MARKER.exec(value)) !== null) {
        const index = Number(match[1]);
        if (index < 1 || index > maxIndex) continue;
        found = true;
        if (match.index > last) {
          next.push({ type: "text", value: value.slice(last, match.index) });
        }
        next.push({
          type: "element",
          tagName: "sup",
          properties: { "data-citation-index": index },
          children: [{ type: "text", value: match[0] }],
        });
        last = match.index + match[0].length;
      }
      if (!found) {
        next.push(child);
      } else if (last < value.length) {
        next.push({ type: "text", value: value.slice(last) });
      }
    }
    node.children = next;
  }

  return (tree: unknown) => transform(tree as HastNode);
}

export function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (
    typeof node === "object" &&
    "props" in node &&
    (node as { props?: { children?: React.ReactNode } }).props?.children
  ) {
    return extractText(
      (node as { props: { children: React.ReactNode } }).props.children,
    );
  }
  return "";
}

function getExtension(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts",
    ts: "ts",
    javascript: "js",
    js: "js",
    tsx: "tsx",
    jsx: "jsx",
    python: "py",
    py: "py",
    json: "json",
    sql: "sql",
    html: "html",
    css: "css",
    markdown: "md",
    md: "md",
    bash: "sh",
    sh: "sh",
    shell: "sh",
    zsh: "sh",
    rust: "rs",
    rs: "rs",
    go: "go",
    yaml: "yaml",
    yml: "yaml",
    dockerfile: "dockerfile",
    cpp: "cpp",
    c: "c",
    java: "java",
  };
  return map[lang.toLowerCase()] ?? "txt";
}

function getLanguageLabel(lang: string): string {
  const map: Record<string, string> = {
    ts: "TypeScript",
    typescript: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    javascript: "JavaScript",
    jsx: "JSX",
    py: "Python",
    python: "Python",
    sh: "Bash",
    bash: "Bash",
    shell: "Shell",
    zsh: "Zsh",
    json: "JSON",
    sql: "SQL",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    rust: "Rust",
    rs: "Rust",
    go: "Go",
    yaml: "YAML",
    yml: "YAML",
    markdown: "Markdown",
    md: "Markdown",
    dockerfile: "Dockerfile",
    cpp: "C++",
    c: "C",
    java: "Java",
  };
  return map[lang.toLowerCase()] ?? lang;
}

function downloadCode(code: string, language: string) {
  const ext = getExtension(language);
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `snippet.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded snippet.${ext}`);
}

function RichCodeBlock({
  className,
  children,
  streaming = false,
}: {
  className?: string;
  children: React.ReactNode;
  /** While streaming, live preview is disabled to avoid reloading partial HTML. */
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [view, setView] = useState<"code" | "preview">("code");
  const [fullscreen, setFullscreen] = useState(false);
  const rawCode = extractText(children);
  // Local scratch edit: display + copy/download follow the edited text until
  // cancelled. Never persisted — the stored message is untouched.
  const code = editedCode ?? rawCode;
  const langMatch = className?.match(/language-([a-zA-Z0-9_-]+)/);
  const rawLang = langMatch ? langMatch[1] : "";
  const displayLang = rawLang ? getLanguageLabel(rawLang) : "Code";
  const linesCount = code.trim().split("\n").length;
  const previewable = isPreviewableLanguage(rawLang);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success("Code copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    downloadCode(code, rawLang || "txt");
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-xs shadow-md">
      {/* Code Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-800 bg-zinc-900/80 px-3.5 py-1.5 select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-wide text-zinc-300">
            {displayLang}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            · {linesCount} {linesCount === 1 ? "line" : "lines"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {previewable && (
            <button
              type="button"
              onClick={() => {
                if (view === "preview") {
                  setView("code");
                } else {
                  setEditing(false);
                  setView("preview");
                }
              }}
              disabled={streaming}
              aria-pressed={view === "preview"}
              title={streaming ? "Preview is available when the response completes" : view === "preview" ? "Show source code" : "Preview rendered website"}
              data-testid="html-preview-toggle"
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                view === "preview"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
              )}
            >
              <Eye className="size-3" />
              <span>{view === "preview" ? "Source" : "Preview"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setView("code");
              setEditing((v) => !v);
            }}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors",
              editing
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
            )}
            title={editing ? "Close editor" : "Edit code (local scratch, not saved to the message)"}
          >
            <Pencil className="size-3" />
            <span>{editing ? "Editing" : "Edit"}</span>
          </button>
          <button
            type="button"
            onClick={() => setWrap(!wrap)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors",
              wrap
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
            )}
            title={wrap ? "Disable text wrapping" : "Enable text wrapping"}
          >
            <WrapText className="size-3" />
            <span>Wrap</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Download code snippet"
          >
            <Download className="size-3" />
            <span>Download</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
              copied
                ? "bg-tollma-500/20 text-tollma-400"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white",
            )}
            title="Copy code"
          >
            {copied ? (
              <Check className="size-3 text-tollma-400" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      {/* Code Content */}
      {view === "preview" ? (
        <>
          <HtmlPreview
            source={code}
            onFullscreen={() => setFullscreen(true)}
            onClose={() => setView("code")}
          />
          {fullscreen && (
            <HtmlPreviewFullscreen
              source={code}
              title={`${displayLang} preview`}
              onClose={() => setFullscreen(false)}
            />
          )}
        </>
      ) : editing ? (
        <div className="p-3.5">
          <textarea
            value={editedCode ?? rawCode}
            onChange={(e) => setEditedCode(e.target.value)}
            spellCheck={false}
            rows={Math.min(Math.max(code.split("\n").length + 1, 4), 24)}
            className="max-h-[480px] w-full resize-y overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-2.5 font-mono text-xs leading-relaxed text-zinc-100 focus:border-tollma-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => {
                setEditedCode(null);
                setEditing(false);
              }}
              className="rounded-md px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Revert
            </button>
          </div>
        </div>
      ) : (
        <pre
          className={cn(
            "max-h-[480px] overflow-y-auto overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-zinc-100",
            wrap && "whitespace-pre-wrap break-words",
          )}
        >
          {editedCode ?? children}
        </pre>
      )}
    </div>
  );
}

const ALERT_CONFIGS = {
  note: {
    label: "Note",
    icon: Info,
    border: "border-tollma-500",
    bg: "bg-tollma-50/70 dark:bg-tollma-950/30",
    titleColor: "text-tollma-700 dark:text-tollma-300",
    iconColor: "text-tollma-600 dark:text-tollma-400",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    border: "border-tollma-500",
    bg: "bg-tollma-50/70 dark:bg-tollma-950/30",
    titleColor: "text-tollma-700 dark:text-tollma-300",
    iconColor: "text-tollma-600 dark:text-tollma-400",
  },
  important: {
    label: "Important",
    icon: AlertCircle,
    border: "border-purple-500",
    bg: "bg-purple-50/70 dark:bg-purple-950/30",
    titleColor: "text-purple-700 dark:text-purple-300",
    iconColor: "text-purple-600 dark:text-purple-400",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    border: "border-amber-500",
    bg: "bg-amber-50/70 dark:bg-amber-950/30",
    titleColor: "text-amber-700 dark:text-amber-300",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  caution: {
    label: "Caution",
    icon: ShieldAlert,
    border: "border-rose-500",
    bg: "bg-rose-50/70 dark:bg-rose-950/30",
    titleColor: "text-rose-700 dark:text-rose-300",
    iconColor: "text-rose-600 dark:text-rose-400",
  },
};

function stripAlertPrefix(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") {
    return node.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "");
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => (idx === 0 ? stripAlertPrefix(child) : child));
  }
  if (node && typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    if (el.props && el.props.children) {
      return React.cloneElement(el, {
        children: stripAlertPrefix(el.props.children),
      });
    }
  }
  return node;
}

function parseAlert(children: React.ReactNode): {
  type: keyof typeof ALERT_CONFIGS;
} | null {
  const fullText = extractText(children).trim();
  const match = fullText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  if (!match) return null;
  const alertType = match[1].toLowerCase() as keyof typeof ALERT_CONFIGS;
  if (alertType in ALERT_CONFIGS) {
    return { type: alertType };
  }
  return null;
}

function RichBlockquote({ children }: { children: React.ReactNode }) {
  const alert = parseAlert(children);
  if (alert) {
    const config = ALERT_CONFIGS[alert.type];
    const Icon = config.icon;
    const cleanChildren = stripAlertPrefix(children);

    return (
      <div
        className={cn(
          "my-3 rounded-r-lg border-l-4 p-3.5 shadow-2xs",
          config.border,
          config.bg,
        )}
      >
        <div className="flex items-center gap-2 font-semibold text-xs mb-1.5 select-none">
          <Icon className={cn("size-4 shrink-0", config.iconColor)} />
          <span className={config.titleColor}>{config.label}</span>
        </div>
        <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed pl-6">
          {cleanChildren}
        </div>
      </div>
    );
  }

  return (
    <blockquote className="my-3 rounded-r-lg border-l-3 border-zinc-300 bg-zinc-50/70 px-4 py-2.5 text-xs italic text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
      {children}
    </blockquote>
  );
}

function RichTable({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopyTable = () => {
    if (!containerRef.current) return;
    const tableEl = containerRef.current.querySelector("table");
    if (!tableEl) return;
    const rows = Array.from(tableEl.querySelectorAll("tr"));
    const tsv = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        return cells
          .map((cell) => cell.textContent?.trim().replace(/\t/g, " ") ?? "")
          .join("\t");
      })
      .join("\n");

    void navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      toast.success("Table copied as TSV (ready for Sheets/Excel)!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      ref={containerRef}
      className="my-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xs bg-white dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/80 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/60 text-xs select-none">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          <Table className="size-3.5 text-zinc-400" />
          <span>Table</span>
        </div>
        <button
          type="button"
          onClick={handleCopyTable}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
          title="Copy table contents"
        >
          {copied ? (
            <Check className="size-3 text-tollma-500" />
          ) : (
            <Copy className="size-3" />
          )}
          <span>{copied ? "Copied" : "Copy TSV"}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          {children}
        </table>
      </div>
    </div>
  );
}

export function ResponseMarkdown({
  content,
  isStreaming,
  sources,
}: {
  content: string;
  isStreaming?: boolean;
  sources?: CitationSource[];
}) {
  const sourceMap = new Map((sources ?? []).map((source) => [source.index, source]));
  // Models emit \(...\) / \[...\] math; remark-math only parses $...$.
  const normalized = normalizeMathDelimiters(content);
  return (
    <div className={cn("prose max-w-full break-words text-sm leading-[1.75]", isStreaming && "streaming-cursor")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight, [rehypeCitations, { maxIndex: sources?.length ?? 0 }]]}
        components={{
          pre: ({ children }) => {
            // Fenced block without a language tag: render a proper cell
            // instead of falling through to the inline-code style below
            // (which has no max-height and no copy/edit affordances).
            // Note: child.type is the custom `code` component (a function),
            // not the string "code", so the language tag is the only
            // reliable discriminator.
            const child = React.Children.toArray(children)[0];
            if (
              React.isValidElement<{ className?: string; children?: React.ReactNode }>(child) &&
              !child.props.className
            ) {
              return <RichCodeBlock>{child.props.children}</RichCodeBlock>;
            }
            return <>{children}</>;
          },
          code: ({ className, children, ...props }) => {
            const codeStr = extractText(children);
            const isMermaid =
              className === "language-mermaid" ||
              className?.includes("mermaid") ||
              (className?.startsWith("language-") &&
                /^\s*(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/m.test(
                  codeStr,
                ));
            if (isMermaid) {
              return <MermaidBlock chart={codeStr} />;
            }
            // className arrives as "hljs language-<lang>" (rehype-highlight
            // prefixes hljs), so match anywhere, not just at the start.
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <RichCodeBlock className={className} streaming={isStreaming}>
                {children}
              </RichCodeBlock>
            ) : (
              <code
                className="rounded-md border border-zinc-200/80 break-all bg-zinc-100/90 px-1.5 py-0.5 font-mono text-[11px] text-zinc-900 shadow-2xs dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-200"
                {...props}
              >
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <RichBlockquote>{children}</RichBlockquote>
          ),
          table: ({ children }) => (
            <RichTable>{children}</RichTable>
          ),
          th: ({ children }) => (
            <th className="border-b border-zinc-200 bg-zinc-100/60 px-3.5 py-2.5 text-[11px] font-semibold text-zinc-700 uppercase tracking-wider dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-zinc-100 px-3.5 py-2.5 text-xs text-zinc-800 dark:border-zinc-800/40 dark:text-zinc-200">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
              {children}
            </tr>
          ),
          input: ({ type, checked, disabled, ...props }) => {
            if (type === "checkbox") {
              return (
                <span className="inline-flex items-center mr-2 align-middle">
                  <span
                    className={cn(
                      "flex size-3.5 items-center justify-center rounded border transition-colors",
                      checked
                        ? "border-tollma-500 bg-tollma-500 text-white"
                        : "border-zinc-400 bg-transparent dark:border-zinc-600",
                    )}
                  >
                    {checked && <Check className="size-2.5 stroke-[3]" />}
                  </span>
                </span>
              );
            }
            return <input type={type} disabled={disabled} {...props} />;
          },
          a: ({ href, children, ...props }) => {
            const isExternal =
              href?.startsWith("http://") || href?.startsWith("https://");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="inline-flex max-w-full items-center gap-0.5 break-all font-medium text-tollma-500 hover:text-tollma-600 dark:text-tollma-400 dark:hover:text-tollma-300 underline underline-offset-2 transition-colors"
                {...props}
              >
                <span>{children}</span>
                {isExternal && <ExternalLink className="size-2.5 opacity-70" />}
              </a>
            );
          },
          sup: ({ children, ...props }) => {
            const raw = (props as Record<string, unknown>)["data-citation-index"];
            const index = typeof raw === "number" ? raw : Number(raw);
            const source = Number.isFinite(index) ? sourceMap.get(index) : undefined;
            if (!source) return <sup {...props}>{children}</sup>;
            return <InlineCitation source={source} />;
          },
          h1: ({ children }) => (
            <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-5 mb-2.5 pb-1.5 border-b border-zinc-200 dark:border-zinc-800">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mt-4 mb-2 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mt-2 mb-1">
              {children}
            </h4>
          ),
          hr: () => (
            <hr className="my-4 border-t border-zinc-200 dark:border-zinc-800" />
          ),
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2.5 list-disc space-y-1.5 pl-5 marker:text-zinc-400 dark:marker:text-zinc-600">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2.5 list-decimal space-y-1.5 pl-5 marker:text-zinc-500 dark:marker:text-zinc-400">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-[1.75]">{children}</li>,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
