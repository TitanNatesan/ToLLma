"use client";

import { Badge } from "@/components/ui";

/**
 * Tolerant model-permission row: personal keys carry UUIDs plus live display
 * names (`model_name` / `provider_name`, null when the row was deleted); org
 * keys may additionally arrive as legacy strings or partial objects.
 */
export interface ModelPermissionDisplay {
  id?: string | null;
  provider_id?: string | null;
  model_id?: string | null;
  provider_name?: string | null;
  model_name?: string | null;
}

function uuidTitle(item: ModelPermissionDisplay): string | undefined {
  const uuids = [item.provider_id, item.model_id].filter(Boolean).join(" / ");
  return uuids || undefined;
}

/** One allowlist chip: `provider / model`, or a muted row for deleted models. */
function ModelPermissionChip({ item }: { item: ModelPermissionDisplay }) {
  if (!item.provider_name && !item.model_name) {
    return (
      <Badge
        variant="outline"
        className="font-mono text-[10px] text-zinc-400"
        title={uuidTitle(item) ?? "Removed model"}
      >
        Removed model
      </Badge>
    );
  }
  const label = [item.provider_name, item.model_name].filter(Boolean).join(" / ");
  return (
    <Badge variant="secondary" className="font-mono text-[10px]" title={uuidTitle(item) ?? label}>
      {label}
    </Badge>
  );
}

/** Read-only allowlist chips. Deleted rows stay visible — they still restrict. */
export function ModelPermissionChips({
  items,
  testId,
}: {
  items: ModelPermissionDisplay[];
  testId?: string;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" data-testid={testId}>
      {items.map((item, index) => (
        <ModelPermissionChip
          key={
            item.id ||
            [item.provider_id, item.model_id].filter(Boolean).join("/") ||
            `perm-${index}`
          }
          item={item}
        />
      ))}
    </div>
  );
}
