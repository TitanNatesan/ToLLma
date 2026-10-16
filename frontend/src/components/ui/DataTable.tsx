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
}

/** Dense admin table shell: uppercase micro headers, hairline rows. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No data in this range",
  testId,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("py-2 pr-3 font-medium", column.align === "right" && "text-right", column.className)}
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
                className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "py-2 pr-3 text-zinc-600 dark:text-zinc-300",
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
