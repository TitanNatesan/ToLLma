/** Password strength meter + the account policy (mirrors the backend). */

export interface PasswordStrength {
  /** 0 (too weak) … 4 (strong). */
  score: number;
  label: string;
  hints: string[];
}

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

/**
 * Account policy: 8+ characters with an uppercase, a lowercase and a number.
 * Returns a human-readable problem, or null when the password is acceptable.
 */
export function validatePassword(password: string): string | null {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/\d/.test(password)) problems.push("a number");
  if (problems.length === 0) return null;
  return `Password must contain ${problems.join(", ")}.`;
}

export function passwordStrength(password: string): PasswordStrength {
  const hints: string[] = [];
  let score = 0;
  if (password.length >= 8) score += 1;
  else hints.push("Use at least 8 characters");
  if (password.length >= 12) score += 1;
  else if (password.length >= 8) hints.push("12+ characters is stronger");

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 2) score += 1;
  if (classes >= 3) score += 1;

  if (!/[A-Z]/.test(password)) hints.push("Add an uppercase letter");
  if (!/[a-z]/.test(password)) hints.push("Add a lowercase letter");
  if (!/\d/.test(password)) hints.push("Add a number");
  if (!/[^A-Za-z0-9]/.test(password)) hints.push("Add a symbol");

  const bounded = Math.max(0, Math.min(4, score));
  return { score: bounded, label: LABELS[bounded], hints };
}
