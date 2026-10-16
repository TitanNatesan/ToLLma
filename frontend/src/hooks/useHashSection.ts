import { useSyncExternalStore, useCallback } from "react";

/**
 * Active section id from the URL hash (`/settings#appearance`), falling back
 * when the hash is missing or unknown. Shared by settings + admin; org pages
 * use `?section=` param navigation instead and stay on their own hook.
 */
export function useHashSection<T extends string>(ids: readonly T[], fallback: T): T {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const getSnapshot = useCallback((): T => {
    const hash = window.location.hash.slice(1);
    return (ids as readonly string[]).includes(hash) ? (hash as T) : fallback;
  }, [ids, fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}
