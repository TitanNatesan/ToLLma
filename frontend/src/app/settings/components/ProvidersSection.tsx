"use client";

import Link from "next/link";
import { ArrowRight, Cpu } from "lucide-react";
import { useProviders } from "@/hooks/useRegistry";
import { Badge, EmptyState } from "@/components/ui";
import { providerTypeLabel } from "@/app/providers/fields";

/** Provider shortcuts — management lives on /providers. */
export function ProvidersSection() {
  const { data: providers = [] } = useProviders();
  const active = providers.filter((p) => p.is_active).length;

  return (
    <div className="space-y-3">
      {providers.length === 0 ? (
        <EmptyState title="No providers yet" description="Connect a provider to start chatting with models." />
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {`${providers.length} provider${providers.length === 1 ? "" : "s"} configured · ${active} active.`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {providers.slice(0, 6).map((provider) => (
          <span
            key={provider.id}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
          >
            <Cpu className="size-3.5 text-zinc-400" />
            {provider.name}
            <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">
              {providerTypeLabel(provider.provider_type)}
            </Badge>
          </span>
        ))}
      </div>
      <Link
        href="/providers"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-tollma-600 hover:underline dark:text-tollma-400"
        data-testid="settings-manage-providers"
      >
        Manage providers <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
