"use client";

import React, { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Info,
  Lightbulb,
  ShieldAlert,
  Table,
  WrapText,
} from "lucide-react";
import { MermaidBlock } from "./MermaidBlock";
import { cn } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

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
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const rawCode = extractText(children);
  const langMatch = className?.match(/language-([a-zA-Z0-9_-]+)/);
  const rawLang = langMatch ? langMatch[1] : "";
  const displayLang = rawLang ? getLanguageLabel(rawLang) : "Code";
  const linesCount = rawCode.trim().split("\n").length;

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawCode).then(() => {
      setCopied(true);
      toast.success("Code copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    downloadCode(rawCode, rawLang || "txt");
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-xs shadow-md">
      {/* Code Header Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3.5 py-1.5 select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-wide text-zinc-300">
            {displayLang}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            · {linesCount} {linesCount === 1 ? "line" : "lines"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white",
            )}
            title="Copy code"
          >
            {copied ? (
              <Check className="size-3 text-emerald-400" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      {/* Code Content */}
      <pre
        className={cn(
          "p-3.5 text-xs text-zinc-100 font-mono leading-relaxed overflow-x-auto",
          wrap && "whitespace-pre-wrap break-words",
        )}
      >
        {children}
      </pre>
    </div>
  );
}

const ALERT_CONFIGS = {
  note: {
    label: "Note",
    icon: Info,
    border: "border-blue-500",
    bg: "bg-blue-50/70 dark:bg-blue-950/30",
    titleColor: "text-blue-700 dark:text-blue-300",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    border: "border-emerald-500",
    bg: "bg-emerald-50/70 dark:bg-emerald-950/30",
    titleColor: "text-emerald-700 dark:text-emerald-300",
    iconColor: "text-emerald-600 dark:text-emerald-400",
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
            <Check className="size-3 text-emerald-500" />
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

function EnhancedThinkBlock({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = content.trim().split(/\s+/).filter(Boolean).length;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success("Reasoning copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-2xs">
      <div
        className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-5 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400",
              isStreaming && "animate-pulse",
            )}
          >
            <Brain className="size-3.5" />
          </div>
          <span className="font-semibold tracking-tight">Thinking Process</span>
          <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70 font-mono">
            · {words} {words === 1 ? "word" : "words"}
            {isStreaming ? " · thinking…" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded p-1 text-amber-600 hover:bg-amber-200/50 dark:text-amber-400 dark:hover:bg-amber-900/40 transition-colors"
            title="Copy thought process"
          >
            {copied ? (
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3" />
            )}
          </button>
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-amber-200/60 dark:border-amber-900/40"
          >
            <div className="prose text-xs text-amber-900/90 dark:text-amber-200/90 p-3.5 leading-relaxed bg-amber-50/30 dark:bg-amber-950/10">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function renderContent(content: string) {
  const parts: Array<{ type: "think" | "text"; content: string }> = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let last = 0;
  let m;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: "text", content: content.slice(last, m.index) });
    parts.push({ type: "think", content: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", content: content.slice(last) });
  return parts;
}

export function ResponseMarkdown({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const parts = renderContent(content);

  return (
    <div className={cn("prose text-sm leading-relaxed", isStreaming && "streaming-cursor")}>
      {parts.map((part, i) =>
        part.type === "think" ? (
          <EnhancedThinkBlock
            key={i}
            content={part.content}
            isStreaming={isStreaming}
          />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              pre: ({ children }) => <>{children}</>,
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
                const isBlock = className?.startsWith("language-");
                return isBlock ? (
                  <RichCodeBlock className={className}>
                    {children}
                  </RichCodeBlock>
                ) : (
                  <code
                    className="rounded-md border border-zinc-200/80 bg-zinc-100/90 px-1.5 py-0.5 font-mono text-[11px] text-zinc-900 shadow-2xs dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-200"
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
                            ? "border-emerald-500 bg-emerald-500 text-white"
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
                    className="inline-flex items-center gap-0.5 font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 transition-colors"
                    {...props}
                  >
                    <span>{children}</span>
                    {isExternal && <ExternalLink className="size-2.5 opacity-70" />}
                  </a>
                );
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
            }}
          >
            {part.content}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
