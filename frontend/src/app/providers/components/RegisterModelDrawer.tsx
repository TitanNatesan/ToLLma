"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, CapabilityBadge, DetailPanel } from "@/components/ui";
import { useModelMutations } from "@/hooks/useRegistry";
import type { AIModel, DiscoveredModelInfo, EndpointType, MatchType } from "@/types";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn, fmtPrice, stripTrailingZeros } from "@/lib/utils";
import {
  CAPS,
  ModelForm,
  fromSuggested,
  toPayload,
} from "./ModelForm";

interface RegisterModelDrawerProps {
  info: DiscoveredModelInfo | null;
  providerId: string;
  open: boolean;
  initialStep?: number;
  onClose: () => void;
  onRegistered: (m: AIModel) => void;
}

const STEPS = ["Model information", "Repository match", "Configure & register"];

const MATCH_LABEL: Record<MatchType, string> = {
  provider_specific: "Exact provider match",
  global: "Matched in repository",
  fallback: "No repository match",
};

function fmtCtx(v: unknown): string {
  if (v === null || v === undefined || v === "") return "Unspecified";
  const num = typeof v === "number" ? v : parseInt(String(v), 10);
  if (isNaN(num) || num <= 0) return "Unspecified";
  return num >= 1000 ? `${(num / 1000).toLocaleString()}k tokens` : `${num.toLocaleString()} tokens`;
}

export function RegisterModelDrawer({
  info,
  providerId,
  open,
  initialStep = 0,
  onClose,
  onRegistered,
}: RegisterModelDrawerProps) {
  const mm = useModelMutations();
  const [step, setStep] = useState(initialStep);

  useEffect(() => {
    if (open) {
      setStep(initialStep);
    }
  }, [open, initialStep, info?.model_id]);

  if (!info) return null;

  const suggested = info.suggested ?? {};
  const ctxWindow =
    info.context_window ??
    (suggested.context_window !== undefined && suggested.context_window !== null
      ? suggested.context_window
      : null);
  const maxOutput =
    info.max_output_tokens ??
    (suggested.max_output_tokens !== undefined && suggested.max_output_tokens !== null
      ? suggested.max_output_tokens
      : null);

  const activeCaps = CAPS.map(([k]) => k).filter(
    (k) => (suggested as Record<string, unknown>)[k] === true,
  );
  const price = (v: unknown) => fmtPrice(v);

  async function handleSave(form: Parameters<typeof toPayload>[1]) {
    try {
      const created = await mm.create.mutateAsync(toPayload(providerId, form));
      toast.success(`Registered ${created.name}`);
      onRegistered(created);
      onClose();
    } catch (e) {
      toast.error("Registration failed", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={`Register ${info.name}`}
      subtitle={info.model_id}
      width={460}
      testId="register-drawer"
    >
      <div className="flex flex-col gap-4 text-xs">
        {/* Step indicator */}
        <ol className="flex items-center gap-1" data-testid="reg-steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  i < step
                    ? "bg-emerald-500 text-white"
                    : i === step
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden sm:inline text-[10px]",
                  i === step ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-400",
                )}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />}
            </li>
          ))}
        </ol>

        {/* Step 1: provider information (read-only) */}
        {step === 0 && (
          <div className="flex flex-col gap-2" data-testid="reg-step-0">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Discovered from provider
            </h3>
            <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 dark:border-zinc-800 dark:divide-zinc-800/60 overflow-hidden bg-white dark:bg-zinc-900/30">
              {[
                ["Model ID", info.model_id],
                ["Name", info.name],
                ["Endpoint type", info.endpoint_type],
                ["Context window", fmtCtx(ctxWindow)],
                ["Max output", fmtCtx(maxOutput)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between p-2.5">
                  <span className="text-zinc-500">{k}</span>
                  <span className="font-mono text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: repository match (read-only) */}
        {step === 1 && (
          <div className="flex flex-col gap-2" data-testid="reg-step-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Repository intelligence
            </h3>
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <Badge
                variant={info.match_type === "fallback" ? "secondary" : "outline"}
                data-testid="reg-match-badge"
              >
                {MATCH_LABEL[info.match_type] ?? info.match_type}
              </Badge>
              <p className="mt-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                {info.repository_model_key ?? "defaults: all $0, text only"}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400">Input / 1M</span>
                  <div className="font-semibold">{price(suggested.input_price)}</div>
                </div>
                <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400">Output / 1M</span>
                  <div className="font-semibold">{price(suggested.output_price)}</div>
                </div>
                <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400">Context Window</span>
                  <div className="font-semibold">{fmtCtx(ctxWindow)}</div>
                </div>
                <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400">Max Output</span>
                  <div className="font-semibold">{fmtCtx(maxOutput)}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeCaps.map((cap) => (
                  <CapabilityBadge key={cap} capability={cap} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: configure (editable) */}
        {step === 2 && (
          <div data-testid="reg-step-2">
            <ModelForm
              key={info.model_id}
              initial={fromSuggested(
                {
                  ...suggested,
                  input_price: stripTrailingZeros(suggested.input_price, "0"),
                  output_price: stripTrailingZeros(suggested.output_price, "0"),
                  cache_read_price: stripTrailingZeros(suggested.cache_read_price, "0"),
                  cache_write_price: stripTrailingZeros(suggested.cache_write_price, "0"),
                  endpoint_type: info.endpoint_type || (suggested.endpoint_type as string) || "chat_completions",
                  context_window: ctxWindow ?? suggested.context_window,
                  max_output_tokens: maxOutput ?? suggested.max_output_tokens,
                } as Record<string, unknown>,
                info.repository_model_key ?? "",
                (info.endpoint_type as EndpointType) || "chat_completions",
              )}
              onSubmit={(f) => void handleSave(f)}
              onCancel={() => {
                if (initialStep === 2) {
                  onClose();
                } else {
                  setStep(1);
                }
              }}
            />
          </div>
        )}

        {/* Nav */}
        {step < 2 && (
          <div className="flex justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => {
                if (step === 0) {
                  onClose();
                } else {
                  setStep((s) => s - 1);
                }
              }}
              data-testid="reg-back"
            >
              <ArrowLeft className="size-3.5" /> Back
            </Button>
            <Button
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setStep((s) => s + 1)}
              data-testid="reg-next"
            >
              {step === 1 ? "Configure & register" : "Continue"} <ArrowRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

