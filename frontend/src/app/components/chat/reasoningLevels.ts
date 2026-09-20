/** Reasoning-level vocabulary shared by the composer selector and the
 *  capability layer. "none" is an explicit off switch, not a missing value:
 *  selecting it sends reasoning_level="none" so the request says
 *  "reasoning disabled" unambiguously (null keeps meaning "unspecified"). */

export const REASONING_OFF_LEVEL = "none";

/** Composer order is always None → … → highest. Declared levels keep their
 *  relative order; "none" is forced first, duplicates and blanks dropped. */
export function normalizeReasoningLevels(levels: string[]): string[] {
  const unique = levels.filter(
    (level, i) => level.length > 0 && level !== REASONING_OFF_LEVEL && levels.indexOf(level) === i,
  );
  return [REASONING_OFF_LEVEL, ...unique];
}

function levelIndex(levels: string[], value: string | null): number {
  const i = value === null ? -1 : levels.indexOf(value);
  return i === -1 ? 0 : i;
}

/** Click-step: wraps around the ring (High → None, None → Low). */
export function cycleReasoningLevel(
  levels: string[],
  value: string | null,
  direction: 1 | -1 = 1,
): string | null {
  if (levels.length === 0) return null;
  return levels[(levelIndex(levels, value) + direction + levels.length) % levels.length];
}

/** Wheel/keyboard-step: clamps at both ends so a gesture can never wrap
 *  None → High by accident. */
export function stepReasoningLevel(
  levels: string[],
  value: string | null,
  direction: 1 | -1,
): string | null {
  if (levels.length === 0) return null;
  const next = Math.min(levels.length - 1, Math.max(0, levelIndex(levels, value) + direction));
  return levels[next];
}
