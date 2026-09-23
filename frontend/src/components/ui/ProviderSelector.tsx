"use client";

import { useProviders } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Badge,
} from "./primitives";
import { ChevronDown, Cpu } from "lucide-react";
import { providerTypeLabel } from "@/app/providers/fields";
import type { Provider } from "@/types";
import { cn } from "@/lib/utils";

export function ProviderSelector({
  value,
  onChange,
  className,
}: {
  value?: string | null;
  onChange?: (id: string) => void;
  className?: string;
}) {
  const { providerId, setProvider } = useChatStore();
  const { data: providers = [] } = useProviders();

  const currentId = value !== undefined ? value : providerId;
  const currentProvider = providers.find((p) => p.id === currentId);

  const handleSelect = (p: Provider) => {
    if (onChange) {
      onChange(p.id);
    } else {
      setProvider(p.id);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 bg-white",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:bg-zinc-900",
            !currentProvider && "text-zinc-400",
            className,
          )}
          data-testid="provider-selector"
          aria-label="Select provider"
        >
          <Cpu className="size-3.5 text-zinc-500 shrink-0" />
          <span className="max-w-36 truncate font-medium text-zinc-800 dark:text-zinc-200">
            {currentProvider ? currentProvider.name : "Select provider"}
          </span>
          <ChevronDown className="size-3 text-zinc-400 shrink-0 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto p-1">
        {providers.length === 0 ? (
          <div className="p-3 text-center text-xs text-zinc-400">No providers configured</div>
        ) : (
          providers.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => handleSelect(p)}
              data-testid={`provider-option-${p.id}`}
              className={cn(
                "flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer rounded-md",
                currentId === p.id && "bg-zinc-100 font-semibold dark:bg-zinc-800",
              )}
            >
              <span className="truncate">{p.name}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
                {providerTypeLabel(p.provider_type)}
              </Badge>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
