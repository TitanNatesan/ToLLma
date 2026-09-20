/** Password strength meter (advisory; the backend enforces the 8-char minimum). */

export interface PasswordStrength {
  /** 0 (too weak) … 4 (strong). */
  score: number;
  label: string;
  hints: string[];
}

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

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
  if (!/\d/.test(password)) hints.push("Add a number");
  if (!/[^A-Za-z0-9]/.test(password)) hints.push("Add a symbol");

  const bounded = Math.max(0, Math.min(4, score));
  return { score: bounded, label: LABELS[bounded], hints };
}
