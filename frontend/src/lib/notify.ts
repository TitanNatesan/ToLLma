import type { ReactNode } from "react";
import { sileo, type SileoOptions } from "sileo";

/**
 * Central notification API for ToLLma, backed by Sileo.
 *
 * Call sites use the same `(message, options)` shape as before, so existing
 * business logic is untouched — only the rendering engine changed. Import
 * `{ toast }` from here instead of a toast library directly.
 */

export interface NotifyAction {
  label: string;
  onClick: () => void;
}

export interface NotifyOptions {
  description?: ReactNode;
  action?: NotifyAction;
  duration?: number | null;
}

function toOptions(message: ReactNode, options?: NotifyOptions): SileoOptions {
  // Plain strings become the toast heading; richer nodes render as the body.
  const body = options?.description ?? (typeof message === "string" ? undefined : message);
  return {
    title: typeof message === "string" ? message : undefined,
    description: body,
    duration: options?.duration,
    button: options?.action
      ? { title: options.action.label, onClick: options.action.onClick }
      : undefined,
  };
}

type PromiseInput<T> = string | SileoOptions | ((data: T) => string | SileoOptions);

function toPromiseOptionValue(input: string | SileoOptions): SileoOptions {
  return typeof input === "string" ? { title: input } : input;
}

function toPromiseOption<T>(input: PromiseInput<T>): SileoOptions | ((data: T) => SileoOptions) {
  if (typeof input === "function") {
    return (data: T) => {
      const resolved = (input as (data: T) => string | SileoOptions)(data);
      return typeof resolved === "string" ? { title: resolved } : resolved;
    };
  }
  return typeof input === "string" ? { title: input } : input;
}

export interface PromiseToastOptions<T = unknown> {
  loading: string | SileoOptions;
  success: PromiseInput<T>;
  error: PromiseInput<T>;
}

export const toast = {
  success: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.success(toOptions(message, options)),
  error: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.error(toOptions(message, options)),
  warning: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.warning(toOptions(message, options)),
  info: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.info(toOptions(message, options)),
  /** Sticky loading toast; dismiss via the returned id. */
  loading: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.show({ ...toOptions(message, options), type: "loading", duration: null }),
  promise: <T,>(
    promise: Promise<T> | (() => Promise<T>),
    options: PromiseToastOptions<T>,
  ): Promise<T> =>
    sileo.promise(promise, {
      loading: typeof options.loading === "string" ? { title: options.loading } : options.loading,
      success: toPromiseOption<T>(options.success),
      error: (err: unknown) => {
        const input = options.error as string | SileoOptions | ((data: unknown) => string | SileoOptions);
        return typeof input === "function" ? toPromiseOptionValue(input(err)) : toPromiseOptionValue(input);
      },
    }),
  /** Dismiss one toast, or all when called without an id. */
  dismiss: (id?: string): void => {
    if (id) sileo.dismiss(id);
    else sileo.clear();
  },
};
