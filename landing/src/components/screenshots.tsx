import {
  BarChart3,
  Bot,
  FolderOpen,
  MessagesSquare,
  ScrollText,
  Server,
} from "lucide-react";
import { SectionHeading } from "./nav";
import { FadeUp, ScaleIn } from "@/lib/motion";

function Frame({
  title,
  url,
  children,
}: {
  title: string;
  url: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="shot glass-reflection overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_56px_-28px_rgba(15,23,42,0.35)]">
      {/* Mac-style chrome */}
      <div className="relative z-[2] flex items-center gap-2 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-gold" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint" />
        </span>
        <span className="ml-1 hidden max-w-44 truncate rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 ring-1 ring-slate-200 sm:block">
          {url}
        </span>
        <span className="ml-auto font-mono text-[11px] text-slate-500">
          {title}
        </span>
      </div>
      <div className="relative z-[2] p-4">{children}</div>
      <figcaption className="relative z-[2] border-t border-dashed border-slate-200 bg-slate-50/60 px-4 py-2 text-center text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        UI mockup — illustrative, not a screenshot
      </figcaption>
    </figure>
  );
}

function ChatMock() {
  return (
    <Frame title="chat" url="tollma/ui/chat">
      <div className="space-y-2.5 text-xs">
        <div className="flex gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600">U</span>
          <div className="rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2">
            Summarize the refund policy from our docs.
          </div>
        </div>
        <div className="flex gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white">T</span>
          <div className="rounded-xl rounded-tl-sm border border-blue-100 bg-blue-50/60 px-3 py-2">
            <p>Based on <span className="font-semibold text-brand-dark">policy.pdf §3</span>:</p>
            <div className="mt-1.5 h-1.5 w-full rounded bg-blue-200/70" />
            <div className="mt-1.5 h-1.5 w-5/6 rounded bg-blue-200/70" />
            <p className="mt-1.5 font-mono text-[10px] text-slate-500">llama-3.1-8b · local · 640 ms</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-500">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Ask anything…
          <span className="ml-auto rounded bg-brand px-2 py-0.5 font-bold text-white">Send</span>
        </div>
      </div>
    </Frame>
  );
}

function ProvidersMock() {
  const rows = [
    { name: "OpenAI", model: "gpt-4o-mini", ok: true },
    { name: "Anthropic", model: "claude-sonnet", ok: true },
    { name: "Ollama", model: "llama-3.1:8b", ok: true },
    { name: "Custom agent", model: "rag-support", ok: false },
  ];
  return (
    <Frame title="providers" url="tollma/ui/providers">
      <ul className="space-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <Server className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            <span className="font-bold">{r.name}</span>
            <span className="truncate font-mono text-[10px] text-slate-500">{r.model}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${r.ok ? "bg-mint-light text-emerald-700" : "bg-gold-light text-yellow-700"}`}>
              {r.ok ? "connected" : "paused"}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function RepoMock() {
  return (
    <Frame title="repository" url="tollma/ui/repository">
      <div className="space-y-2 text-xs">
        {[
          { n: "policy.pdf", s: "2.1 MB · 48 chunks", w: "w-full" },
          { n: "runbook.md", s: "84 KB · 12 chunks", w: "w-4/5" },
          { n: "api-spec.yaml", s: "310 KB · 30 chunks", w: "w-3/5" },
        ].map((f) => (
          <div key={f.n} className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-yellow-700" aria-hidden />
              <span className="font-bold">{f.n}</span>
              <span className="ml-auto text-[10px] text-slate-500">{f.s}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded bg-slate-100">
              <div className={`h-1.5 rounded bg-mint ${f.w}`} />
            </div>
          </div>
        ))}
        <p className="pt-1 text-center text-[10px] font-semibold text-emerald-700">✓ indexed · searchable by every model</p>
      </div>
    </Frame>
  );
}

function AnalyticsMock() {
  const bars = [35, 55, 42, 70, 58, 85, 64, 92, 76, 60, 48, 66];
  return (
    <Frame title="analytics" url="tollma/ui/analytics">
      <div className="mb-2 flex gap-3 text-[10px] font-bold text-slate-500">
        <span><span className="font-extrabold text-ink">1.2M</span> tokens</span>
        <span><span className="font-extrabold text-ink">$18.42</span> spend</span>
        <span><span className="font-extrabold text-ink">412ms</span> p50</span>
      </div>
      <div className="flex h-24 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            style={{ height: `${h}%` }}
            className={`flex-1 rounded-t ${i === 7 ? "bg-gold" : "bg-brand/80"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-500">
        <span>per model · per key · per day</span>
      </div>
    </Frame>
  );
}

function LogsMock() {
  const rows = [
    { m: "POST /v1/chat", s: "200", t: "412 ms", c: "text-emerald-600" },
    { m: "POST /v1/chat", s: "200", t: "388 ms", c: "text-emerald-600" },
    { m: "POST /v1/embed", s: "429", t: "—", c: "text-yellow-600" },
    { m: "POST /v1/chat", s: "200", t: "521 ms", c: "text-emerald-600" },
  ];
  return (
    <Frame title="gateway logs" url="tollma/ui/logs">
      <ul className="space-y-1.5 font-mono text-[11px]">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-slate-300">
            <ScrollText className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
            <span className="truncate">{r.m}</span>
            <span className={`ml-auto font-bold ${r.c}`}>{r.s}</span>
            <span className="w-14 text-right text-slate-500">{r.t}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const SHOTS = [
  { icon: Bot, label: "Chat", url: "tollma/ui/chat", el: <ChatMock /> },
  { icon: Server, label: "Providers", url: "tollma/ui/providers", el: <ProvidersMock /> },
  { icon: FolderOpen, label: "Repository", url: "tollma/ui/repository", el: <RepoMock /> },
  { icon: BarChart3, label: "Analytics", url: "tollma/ui/analytics", el: <AnalyticsMock /> },
  { icon: ScrollText, label: "Gateway logs", url: "tollma/ui/logs", el: <LogsMock /> },
];

export default function Screenshots() {
  return (
    <section
      id="screenshots"
      aria-label="Product tour"
      className="section relative scroll-mt-20 overflow-hidden bg-white"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_100%,rgba(16,185,129,0.07),transparent),radial-gradient(40rem_22rem_at_50%_0%,rgba(37,99,235,0.06),transparent)]"
      />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Product tour"
          title="One dashboard for all of it"
          sub="Stylized mockups of the ToLLma UI: chat, providers, knowledge repository, analytics, and gateway logs."
        />
        {/* Layered perspective gallery: no carousels, active-card focus */}
        <div className="perspective-stage group/gallery grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&:has(:hover)_.tilt-card:not(:hover)]:opacity-90">
          {SHOTS.map((s, i) => (
            <div key={s.label} className="tilt-card" role="group" aria-label={`${s.label} UI mockup`}>
              {i < 2 ? (
                <ScaleIn delay={Math.min(i * 0.07, 0.14)}>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                      <s.icon className="h-4 w-4 text-brand" aria-hidden /> {s.label}
                    </p>
                    {s.el}
                  </div>
                </ScaleIn>
              ) : (
                <FadeUp delay={Math.min((i - 2) * 0.06, 0.18)}>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                      <s.icon className="h-4 w-4 text-brand" aria-hidden /> {s.label}
                    </p>
                    {s.el}
                  </div>
                </FadeUp>
              )}
            </div>
          ))}
          <FadeUp delay={0.18}>
            <div className="flex h-full min-h-48 flex-col justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm font-bold text-slate-700">Real screenshots ship with v1</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                These panels are design mockups. They will be replaced with
                actual product screenshots before the first stable release.
              </p>
            </div>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
