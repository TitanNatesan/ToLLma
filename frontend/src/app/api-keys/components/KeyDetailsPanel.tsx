"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Gauge, KeyRound, Loader2, Network, ShieldCheck } from "lucide-react";
import { Badge, Button, DetailPanel } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  apiKeyErrorMessage,
  updateApiKeyIpRules,
  updateApiKeyModelPermissions,
  updateApiKeyPolicy,
} from "@/services/apiKeys";
import { KeyAnalytics } from "./KeyAnalytics";
import { NetworkPanel } from "./NetworkPanel";
import { SectionFrame } from "./analytics/shared";
import { IpRulesEditor, ipRulesToText, parseIpRules } from "./IpRulesEditor";
import { ModelPermissionsEditor, modelPermissionsToInput } from "./ModelPermissionsEditor";
import { PolicyForm, policyToInput } from "./PolicyForm";
import { ApiKeyStatusPill, apiKeyStatus, fmtDateTime } from "./StatusPill";
import type {
  ApiKey,
  ApiKeyModelPermissionInput,
  ApiKeyPolicyInput,
} from "@/types/apiKeys";

type Tab = "analytics" | "limits" | "network" | "models";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "limits", label: "Limits", icon: Gauge },
  { id: "network", label: "Network", icon: Network },
  { id: "models", label: "Models", icon: ShieldCheck },
];

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-300">{value}</p>
    </div>
  );
}

interface KeyDetailsPanelProps {
  apiKey: ApiKey | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Right-side key console: analytics plus the three replace-payload editors
 * (limits, network rules, model access). Each editor saves through its own
 * endpoint and refetches the key list.
 */
export function KeyDetailsPanel({ apiKey, open, onClose }: KeyDetailsPanelProps) {
  if (!apiKey) return null;
  return <KeyDetailsContent key={apiKey.id} apiKey={apiKey} open={open} onClose={onClose} />;
}

function KeyDetailsContent({
  apiKey,
  open,
  onClose,
}: {
  apiKey: ApiKey;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("analytics");

  const initialIp = ipRulesToText(apiKey.ip_rules);
  const [policy, setPolicy] = useState<ApiKeyPolicyInput>(() => policyToInput(apiKey.policy));
  const [allow, setAllow] = useState(initialIp.allow);
  const [deny, setDeny] = useState(initialIp.deny);
  const [permissions, setPermissions] = useState<ApiKeyModelPermissionInput[]>(() =>
    modelPermissionsToInput(apiKey.model_permissions),
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["api-keys"] });

  const policyMutation = useMutation({
    mutationFn: (body: ApiKeyPolicyInput) => updateApiKeyPolicy(apiKey.id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Limits updated");
    },
    onError: (error) =>
      toast.error("Could not update limits", { description: apiKeyErrorMessage(error) }),
  });

  const ipMutation = useMutation({
    mutationFn: (rules: ReturnType<typeof parseIpRules>["rules"]) =>
      updateApiKeyIpRules(apiKey.id, rules),
    onSuccess: () => {
      invalidate();
      toast.success("Network rules updated");
    },
    onError: (error) =>
      toast.error("Could not update network rules", { description: apiKeyErrorMessage(error) }),
  });

  const modelsMutation = useMutation({
    mutationFn: (value: ApiKeyModelPermissionInput[]) =>
      updateApiKeyModelPermissions(apiKey.id, value),
    onSuccess: () => {
      invalidate();
      toast.success("Model access updated");
    },
    onError: (error) =>
      toast.error("Could not update model access", { description: apiKeyErrorMessage(error) }),
  });

  const parsedIp = parseIpRules(allow, deny);
  const status = apiKeyStatus(apiKey);
  // Observability tabs need room for charts and tables; editors stay compact.
  const wide = tab === "analytics" || tab === "network";

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      width={wide ? "min(96vw, 1180px)" : "min(94vw, 460px)"}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-zinc-400" />
          {apiKey.name}
        </span>
      }
      subtitle={<span className="font-mono">{apiKey.masked}</span>}
      testId="key-details-panel"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Meta label="Status" value={<ApiKeyStatusPill status={status} />} />
          <Meta label="Prefix" value={<span className="font-mono">{apiKey.key_prefix}</span>} />
          <Meta label="Created" value={fmtDateTime(apiKey.created_at)} />
          <Meta label="Last used" value={fmtDateTime(apiKey.last_used_at)} />
          <Meta label="Expires" value={fmtDateTime(apiKey.expires_at)} />
          <Meta
            label="Rotations"
            value={
              <Badge variant="secondary" className="text-[10px]">
                {apiKey.rotation_count}
              </Badge>
            }
          />
        </div>

        <div
          role="tablist"
          aria-label="Key configuration"
          className="flex flex-wrap gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                data-testid={`key-tab-${item.id}`}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                <Icon className="size-3" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "analytics" && <KeyAnalytics keyId={apiKey.id} />}

        {tab === "limits" && (
          <div className="space-y-4">
            <PolicyForm value={policy} onChange={setPolicy} disabled={policyMutation.isPending} />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPolicy(policyToInput(apiKey.policy))}
                disabled={policyMutation.isPending}
              >
                Reset
              </Button>
              <Button
                size="sm"
                onClick={() => policyMutation.mutate(policy)}
                disabled={policyMutation.isPending}
                data-testid="policy-save"
              >
                {policyMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save limits
              </Button>
            </div>
          </div>
        )}

        {tab === "network" && (
          <div className="space-y-4">
            <NetworkPanel keyId={apiKey.id} />
            <SectionFrame
              title="IP access rules"
              description="Allow/deny list enforced by the gateway, separate from analytics."
              testId="key-ip-rules"
            >
              <div className="space-y-4">
                <IpRulesEditor
                  allow={allow}
                  deny={deny}
                  onAllowChange={setAllow}
                  onDenyChange={setDeny}
                  disabled={ipMutation.isPending}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = ipRulesToText(apiKey.ip_rules);
                      setAllow(current.allow);
                      setDeny(current.deny);
                    }}
                    disabled={ipMutation.isPending}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => ipMutation.mutate(parsedIp.rules)}
                    disabled={ipMutation.isPending || parsedIp.invalid.length > 0}
                    data-testid="ip-rules-save"
                  >
                    {ipMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                    Save rules
                  </Button>
                </div>
              </div>
            </SectionFrame>
          </div>
        )}

        {tab === "models" && (
          <div className="space-y-4">
            <ModelPermissionsEditor
              value={permissions}
              onChange={setPermissions}
              disabled={modelsMutation.isPending}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPermissions(modelPermissionsToInput(apiKey.model_permissions))}
                disabled={modelsMutation.isPending}
              >
                Reset
              </Button>
              <Button
                size="sm"
                onClick={() => modelsMutation.mutate(permissions)}
                disabled={modelsMutation.isPending}
                data-testid="model-permissions-save"
              >
                {modelsMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save access
              </Button>
            </div>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}
