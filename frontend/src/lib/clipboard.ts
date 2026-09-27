import { toast } from "sonner";

/**
 * Best-effort text copy. The async Clipboard API fails on insecure origins,
 * when permission is denied, or on older browsers — fall back to a hidden
 * textarea + `execCommand("copy")` (select-to-copy) before giving up.
 * Returns true when the text is on the clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("Clipboard API unavailable");
  } catch {
    // Fall through to the legacy path.
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    // Deprecated but still the only synchronous fallback where the async
    // Clipboard API is unavailable.
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy with user feedback: success toast on copy, error toast (with a
 * manual-copy hint) when both mechanisms fail.
 */
export async function copyWithToast(
  text: string,
  successMessage: string,
  errorMessage = "Could not copy to clipboard",
): Promise<boolean> {
  const ok = await copyTextToClipboard(text);
  if (ok) {
    toast.success(successMessage);
  } else {
    toast.error(errorMessage, {
      description: "Select the text manually to copy it.",
    });
  }
  return ok;
}
