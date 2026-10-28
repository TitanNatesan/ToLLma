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
  /**
   * High-visibility styling for notifications the user must not miss
   * (e.g. background generation completed / failed). Renders a solid
   * semantic fill with white text and a white action button, identical in
   * light and dark mode — AA contrast on both themes.
   */
  contrast?: boolean;
}

/** Solid fills + white text for contrast toasts (AA on both themes). */
const CONTRAST_FILL = {
  success: "#055b08", // tollma-600 (repo documents white-on-500+ as AA)
  error: "#b91c1c", // red-700
} as const;

function toOptions(message: ReactNode, options?: NotifyOptions, tone?: keyof typeof CONTRAST_FILL): SileoOptions {
  // Plain strings become the toast heading; richer nodes render as the body.
  const body = options?.description ?? (typeof message === "string" ? undefined : message);
  const contrast = options?.contrast === true && tone !== undefined ? CONTRAST_FILL[tone] : undefined;
  const contrastButton =
    options?.contrast === true && tone !== undefined
      ? tone === "success"
        ? "bg-white! font-semibold! text-[#055b08]!"
        : "bg-white! font-semibold! text-[#b91c1c]!"
      : undefined;
  return {
    title: typeof message === "string" ? message : undefined,
    description: body,
    duration: options?.duration,
    button: options?.action
      ? { title: options.action.label, onClick: options.action.onClick }
      : undefined,
    ...(contrast === undefined
      ? null
      : {
          fill: contrast,
          styles: {
            title: "text-white!",
            description: "text-white!",
            badge: "text-white!",
            ...(contrastButton === undefined ? null : { button: contrastButton }),
          },
        }),
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
    sileo.success(toOptions(message, options, "success")),
  error: (message: ReactNode, options?: NotifyOptions): string =>
    sileo.error(toOptions(message, options, "error")),
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
