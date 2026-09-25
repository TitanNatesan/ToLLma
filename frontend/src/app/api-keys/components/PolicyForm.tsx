"use client";

import { useState } from "react";
import { Coins, Gauge, Wallet } from "lucide-react";
import { fmtBudgetAmount } from "./BudgetBar";
import { NumberField } from "./NumberField";
import { SelectField } from "./SelectField";
import { asNumber } from "./StatusPill";
import type { ApiKeyPolicy, ApiKeyPolicyInput } from "@/types/apiKeys";

const RESET_PRESETS = [7, 14, 24, 30, 60, 90] as const;

/** Existing policy -> form input (null-safe; Decimal strings coerced). */
export function policyToInput(policy: ApiKeyPolicy | null | undefined): ApiKeyPolicyInput {
  return {
    max_budget_usd: asNumber(policy?.max_budget_usd),
    budget_reset_days: policy?.budget_reset_days ?? null,
    rpm: policy?.rpm ?? null,
    rph: policy?.rph ?? null,
    rpd: policy?.rpd ?? null,
    tpm: policy?.tpm ?? null,
    tpd: policy?.tpd ?? null,
    daily_spend_limit: asNumber(policy?.daily_spend_limit),
    monthly_spend_limit: asNumber(policy?.monthly_spend_limit),
  };
}

/** True when at least one limit is set (used to skip a needless PUT on create). */
export function hasPolicyValues(policy: ApiKeyPolicyInput): boolean {
  return Object.values(policy).some((value) => value !== null && value !== undefined);
}

interface PolicyFormProps {
  value: ApiKeyPolicyInput;
  onChange: (value: ApiKeyPolicyInput) => void;
  disabled?: boolean;
}

function LimitGroup({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Wallet;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200/80 bg-zinc-50/40 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/30">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
          <Icon className="size-3" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {title}
          </p>
          {description && <p className="text-[10px] text-zinc-400">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Budget, reset window, spend caps and rate limits. Empty = unlimited. */
export function PolicyForm({ value, onChange, disabled }: PolicyFormProps) {
  const resetDays = value.budget_reset_days ?? null;
  const isPreset = resetDays === null || (RESET_PRESETS as readonly number[]).includes(resetDays);
  const [customReset, setCustomReset] = useState(!isPreset);

  function patch(part: Partial<ApiKeyPolicyInput>) {
    onChange({ ...value, ...part });
  }

  const resetOptions = [
    { value: "unlimited", label: "No reset window", description: "Budget never resets" },
    ...RESET_PRESETS.map((days) => ({
      value: String(days),
      label: `Every ${days} days`,
      description: days === 30 ? "Calendar month" : undefined,
    })),
    { value: "custom", label: "Custom…", description: "Choose your own window" },
  ];

  return (
    <div className="space-y-3">
      <LimitGroup icon={Wallet} title="Budget" description="Hard cap for the reset window.">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Budget"
            suffix="USD"
            step={0.01}
            value={value.max_budget_usd ?? null}
            onChange={(max_budget_usd) => patch({ max_budget_usd })}
            disabled={disabled}
            format={fmtBudgetAmount}
            placeholder="Unlimited"
            testId="policy-budget"
          />
          <SelectField
            label="Budget reset"
            size="sm"
            value={customReset ? "custom" : String(resetDays ?? "unlimited")}
            disabled={disabled}
            onChange={(next) => {
              if (next === "unlimited") {
                setCustomReset(false);
                patch({ budget_reset_days: null });
              } else if (next === "custom") {
                setCustomReset(true);
              } else {
                setCustomReset(false);
                patch({ budget_reset_days: Number(next) });
              }
            }}
            options={resetOptions}
            testId="policy-reset"
          />
        </div>
        {customReset && (
          <div className="mt-3 max-w-xs">
            <NumberField
              label="Custom reset (days)"
              min={1}
              max={365}
              value={resetDays}
              onChange={(budget_reset_days) => patch({ budget_reset_days })}
              disabled={disabled}
              placeholder="e.g. 45"
              testId="policy-reset-custom"
            />
          </div>
        )}
      </LimitGroup>

      <LimitGroup
        icon={Gauge}
        title="Rate limits"
        description="Requests and tokens per rolling window."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="RPM"
            suffix="req/min"
            value={value.rpm ?? null}
            onChange={(rpm) => patch({ rpm })}
            disabled={disabled}
            testId="policy-rpm"
          />
          <NumberField
            label="RPH"
            suffix="req/hour"
            value={value.rph ?? null}
            onChange={(rph) => patch({ rph })}
            disabled={disabled}
            testId="policy-rph"
          />
          <NumberField
            label="RPD"
            suffix="req/day"
            value={value.rpd ?? null}
            onChange={(rpd) => patch({ rpd })}
            disabled={disabled}
            testId="policy-rpd"
          />
          <NumberField
            label="TPM"
            suffix="tokens/min"
            value={value.tpm ?? null}
            onChange={(tpm) => patch({ tpm })}
            disabled={disabled}
            testId="policy-tpm"
          />
          <NumberField
            label="TPD"
            suffix="tokens/day"
            value={value.tpd ?? null}
            onChange={(tpd) => patch({ tpd })}
            disabled={disabled}
            testId="policy-tpd"
          />
        </div>
      </LimitGroup>

      <LimitGroup
        icon={Coins}
        title="Spend caps"
        description="Optional daily and monthly ceilings independent of the budget."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Daily spend limit"
            suffix="USD"
            step={0.01}
            value={value.daily_spend_limit ?? null}
            onChange={(daily_spend_limit) => patch({ daily_spend_limit })}
            disabled={disabled}
            format={fmtBudgetAmount}
            testId="policy-daily-spend"
          />
          <NumberField
            label="Monthly spend limit"
            suffix="USD"
            step={0.01}
            value={value.monthly_spend_limit ?? null}
            onChange={(monthly_spend_limit) => patch({ monthly_spend_limit })}
            disabled={disabled}
            format={fmtBudgetAmount}
            testId="policy-monthly-spend"
          />
        </div>
      </LimitGroup>
    </div>
  );
}
