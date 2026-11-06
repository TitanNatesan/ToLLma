"use client";

import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import { confirmAge } from "@/services/trust";
import { useAuthStore } from "@/store/auth";
import type { UserWithAge } from "@/types/trust";

/**
 * F3 one-click 18+ confirmation for legacy/OAuth accounts (`age_confirmed`
 * NULL). Hidden once confirmed. Posts to /auth/confirm-age and reloads the
 * user into the store.
 */
export function AgeConfirmBanner() {
  const user = useAuthStore((s) => s.user) as UserWithAge | null;
  const setUser = useAuthStore((s) => s.setUser);

  const confirm = useMutation({
    mutationFn: confirmAge,
    onSuccess: (res) => {
      setUser(res.user);
      toast.success("Age confirmed — full access restored.");
    },
    onError: (e) => {
      toast.error("Could not confirm age", { description: parseApiError(e).message });
    },
  });

  if (!user || user.age_confirmed === true) return null;

  return (
    <div
      role="status"
      data-testid="age-confirm-banner"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950"
    >
      <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
        Please confirm you are 18 or older to keep full access to ToLLma.
      </p>
      <Button
        type="button"
        size="sm"
        onClick={() => confirm.mutate()}
        disabled={confirm.isPending}
        data-testid="age-confirm-submit"
      >
        {confirm.isPending ? "Confirming…" : "I am 18 or older"}
      </Button>
    </div>
  );
}
