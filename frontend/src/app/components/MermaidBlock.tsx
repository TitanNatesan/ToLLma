"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "@/lib/notify";
import { Code, Copy, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

interface MermaidBlockProps {
  chart: string;
}

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"diagram" | "code">("diagram");
  const uniqueId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    let cancelled = false;
    const cleanChart = chart.trim();

    async function renderChart() {
      if (!cleanChart) {
        if (!cancelled) {
          setSvg(null);
          setError(null);
        }
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          // Never paint mermaid's own error diagram (the "boom" overlay):
          // render() rejects instead and the inline cell error below shows.
          suppressErrorRendering: true,
          fontFamily: "var(--font-geist-sans), sans-serif",
          themeVariables: {
            darkMode: true,
            background: "#09090b",
            primaryColor: "#27272a",
            primaryTextColor: "#f4f4f5",
            primaryBorderColor: "#3f3f46",
            lineColor: "#71717a",
            secondaryColor: "#18181b",
            tertiaryColor: "#18181b",
          },
        });

        const id = `mermaid-${uniqueId}-${Date.now()}`;
        const { svg: renderedSvg } = await mermaid.render(id, cleanChart);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to parse Mermaid diagram syntax.");
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(chart.trim()).then(() => {
      toast.success("Mermaid code copied!");
    }).catch(() => {});
  };

  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950" data-testid="mermaid-block">
      {/* Header toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Mermaid Diagram
          </span>
          {error && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
              Syntax Error
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("diagram")}
            disabled={!!error}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              activeTab === "diagram" && !error
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 disabled:opacity-40",
            )}
          >
            <Eye className="size-3" />
            <span>Diagram</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("code")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              activeTab === "code" || !!error
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <Code className="size-3" />
            <span>Code</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy Mermaid code"
            className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Copy className="size-3" />
            <span>Copy</span>
          </button>
        </div>
      </div>

      {/* Content view */}
      {activeTab === "diagram" && !error ? (
        <div className="flex min-h-[140px] items-center justify-center overflow-x-auto p-4">
          {svg ? (
            <div
              className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="size-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
              <span>Rendering diagram…</span>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          {error && (
            <div className="mb-2 max-h-32 overflow-y-auto rounded border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-red-400">
              {error}
            </div>
          )}
          <pre className="font-mono text-xs text-zinc-200">{chart.trim()}</pre>
        </div>
      )}
    </div>
  );
}
