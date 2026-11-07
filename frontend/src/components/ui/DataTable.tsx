"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  testId?: string;
  /** Row activation (details drawer, etc). Adds hover + pointer affordance,
   *  keyboard activation and an optional per-row test id. */
  onRowClick?: (row: T) => void;
  rowTestId?: (row: T) => string;
}

/** Dense admin table shell: uppercase micro headers, hairline rows. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No data in this range",
  testId,
  onRowClick,
  rowTestId,
}: DataTableProps<T>) {
  const clickable = typeof onRowClick === "function";
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg,20px)]" data-testid={testId}>
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("py-2 pr-3 font-medium first:pl-3", column.align === "right" && "text-right", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-zinc-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={clickable ? 0 : undefined}
                data-testid={rowTestId?.(row)}
                className={cn(
                  "border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50",
                  clickable &&
                    "cursor-pointer hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--glass-focus-ring,rgba(6,110,9,0.6))] dark:hover:bg-zinc-800/50",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "py-2 pr-3 text-zinc-600 first:pl-3 dark:text-zinc-300",
                      column.align === "right" && "text-right font-mono tabular-nums",
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
