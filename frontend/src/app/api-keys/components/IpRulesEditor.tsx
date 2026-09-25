"use client";

import { useMemo, useState } from "react";
import { Ban, Plus, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Input, Textarea, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Segmented } from "./SelectField";
import type { ApiKeyIpRule, ApiKeyIpRuleInput } from "@/types/apiKeys";

export interface ParsedIpRules {
  rules: ApiKeyIpRuleInput[];
  invalid: string[];
}

/** IPv4/IPv6 address or CIDR block with a range-checked prefix. */
export function isValidCidr(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.includes(" ")) return false;
  const segments = value.split("/");
  if (segments.length > 2) return false;
  const [address, prefix] = segments;
  let prefixNumber: number | undefined;
  if (prefix !== undefined) {
    if (!/^\d{1,3}$/.test(prefix)) return false;
    prefixNumber = Number(prefix);
  }

  if (address.includes(":")) {
    if (!/^[0-9a-fA-F:]+$/.test(address)) return false;
    return prefixNumber === undefined || prefixNumber <= 128;
  }

  const octets = address.split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;
  return prefixNumber === undefined || prefixNumber <= 32;
}

/** Parse "one CIDR/IP per line" textareas into the replace payload. */
export function parseIpRules(allowText: string, denyText: string): ParsedIpRules {
  const rules: ApiKeyIpRuleInput[] = [];
  const invalid: string[] = [];

  const collect = (text: string, type: ApiKeyIpRuleInput["type"]) => {
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (!value) continue;
      if (!isValidCidr(value)) {
        invalid.push(value);
        continue;
      }
      if (!rules.some((rule) => rule.type === type && rule.cidr === value)) {
        rules.push({ type, cidr: value });
      }
    }
  };

  collect(allowText, "allow");
  collect(denyText, "deny");
  return { rules, invalid };
}

/** Existing rules -> editable textareas, preserving backend order. */
export function ipRulesToText(rules: Array<ApiKeyIpRule | ApiKeyIpRuleInput>): { allow: string; deny: string } {
  return {
    allow: rules
      .filter((rule) => rule.type === "allow")
      .map((rule) => rule.cidr)
      .join("\n"),
    deny: rules
      .filter((rule) => rule.type === "deny")
      .map((rule) => rule.cidr)
      .join("\n"),
  };
}

type RuleKind = ApiKeyIpRuleInput["type"];

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function removeLine(text: string, target: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== target)
    .join("\n");
}

interface RuleListProps {
  kind: RuleKind;
  text: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
}

function RuleList({ kind, text, onChange, disabled, testId }: RuleListProps) {
  const entries = useMemo(() => linesOf(text), [text]);
  const isAllow = kind === "allow";
  const Icon = isAllow ? ShieldCheck : Ban;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          <Icon className={cn("size-3", isAllow ? "text-tollma-500" : "text-red-500")} />
          {isAllow ? "Allow list" : "Deny list"}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-zinc-400">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid={testId ? `${testId}-chips` : undefined}>
          {entries.map((entry) => {
            const valid = isValidCidr(entry);
            return (
              <span
                key={`${kind}-${entry}`}
                data-testid={testId ? `${testId}-chip-${entry}` : undefined}
                className={cn(
                  "group inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pl-1.5 pr-0.5 font-mono text-[10px] transition-colors",
                  valid
                    ? isAllow
                      ? "border-tollma-200 bg-tollma-50 text-tollma-800 dark:border-tollma-900/70 dark:bg-tollma-950/40 dark:text-tollma-200"
                      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                    : "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200",
                )}
              >
                {!valid && <TriangleAlert className="size-2.5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{entry}</span>
                <Tooltip content={`Remove ${entry}`}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(removeLine(text, entry))}
                    aria-label={`Remove ${entry} from ${isAllow ? "allow" : "deny"} list`}
                    className="flex size-4 shrink-0 items-center justify-center rounded text-current opacity-50 transition-opacity hover:bg-black/10 hover:opacity-100 disabled:pointer-events-none dark:hover:bg-white/10"
                  >
                    <X className="size-2.5" />
                  </button>
                </Tooltip>
              </span>
            );
          })}
        </div>
      )}

      <Textarea
        value={text}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={isAllow ? "203.0.113.0/24\n2001:db8::/32" : "198.51.100.7\n203.0.113.0/28"}
        spellCheck={false}
        aria-label={`${isAllow ? "Allow" : "Deny"} list, one IP or CIDR per line`}
        className="min-h-20 font-mono text-xs"
        data-testid={testId}
      />
    </div>
  );
}

interface IpRulesEditorProps {
  allow: string;
  deny: string;
  onAllowChange: (value: string) => void;
  onDenyChange: (value: string) => void;
  disabled?: boolean;
}

/** Tag composer plus line-based allow/deny editors with validation chips. */
export function IpRulesEditor({
  allow,
  deny,
  onAllowChange,
  onDenyChange,
  disabled,
}: IpRulesEditorProps) {
  const [kind, setKind] = useState<RuleKind>("allow");
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const invalid = useMemo(() => parseIpRules(allow, deny).invalid, [allow, deny]);

  function addRule() {
    const value = draft.trim();
    if (!value) return;
    if (!isValidCidr(value)) {
      setComposerError("Not a valid IPv4/IPv6 address or CIDR block.");
      return;
    }
    const inAllow = linesOf(allow).includes(value);
    const inDeny = linesOf(deny).includes(value);
    if (inAllow || inDeny) {
      setComposerError(`Already present in the ${inAllow ? "allow" : "deny"} list.`);
      return;
    }
    if (kind === "allow") onAllowChange(allow ? `${allow}\n${value}` : value);
    else onDenyChange(deny ? `${deny}\n${value}` : value);
    setDraft("");
    setComposerError(null);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/40 p-2.5 dark:border-zinc-800/80 dark:bg-zinc-900/30">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={kind}
            onChange={(next) => {
              setKind(next);
              setComposerError(null);
            }}
            ariaLabel="Rule type"
            size="sm"
            disabled={disabled}
            className="w-40 shrink-0"
            testId="ip-rule-kind"
            options={[
              { value: "allow", label: "Allow", icon: ShieldCheck },
              { value: "deny", label: "Deny", icon: Ban },
            ]}
          />
          <div className="relative min-w-40 flex-1">
            <Input
              value={draft}
              disabled={disabled}
              onChange={(event) => {
                setDraft(event.target.value);
                if (composerError) setComposerError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addRule();
                }
              }}
              placeholder={kind === "allow" ? "203.0.113.0/24" : "198.51.100.7"}
              spellCheck={false}
              aria-label={`Add ${kind} rule`}
              className="h-8 font-mono text-xs"
              data-testid="ip-rule-draft"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !draft.trim()}
            onClick={addRule}
            data-testid="ip-rule-add"
            className="shrink-0"
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        {composerError && (
          <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400" data-testid="ip-rule-error">
            {composerError}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <RuleList
          kind="allow"
          text={allow}
          onChange={onAllowChange}
          disabled={disabled}
          testId="ip-allow-input"
        />
        <RuleList
          kind="deny"
          text={deny}
          onChange={onDenyChange}
          disabled={disabled}
          testId="ip-deny-input"
        />
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-400">
        One IPv4/IPv6 address or CIDR block per line. Leave both lists empty to allow every
        source; deny rules always win over allow rules.
      </p>

      {invalid.length > 0 && (
        <p
          className={cn(
            "flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700",
            "dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
          )}
          data-testid="ip-invalid"
        >
          <TriangleAlert className="mt-0.5 size-3 flex-shrink-0" />
          <span>
            Invalid entr{invalid.length === 1 ? "y" : "ies"}: {invalid.join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}
