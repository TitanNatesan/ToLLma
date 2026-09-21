/** Minimal line diff (LCS) for message version history. No dependencies. */

export type DiffLineType = "same" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const rows = oldLines.length;
  const cols = newLines.length;

  // LCS length table.
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: "same", text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: "remove", text: oldLines[i], oldLine: i + 1 });
      i += 1;
    } else {
      out.push({ type: "add", text: newLines[j], newLine: j + 1 });
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ type: "remove", text: oldLines[i], oldLine: i + 1 });
    i += 1;
  }
  while (j < cols) {
    out.push({ type: "add", text: newLines[j], newLine: j + 1 });
    j += 1;
  }
  return out;
}

/** Split a ts_headline snippet into text/highlight segments (no innerHTML). */
export function splitHighlight(snippet: string): Array<{ text: string; highlight: boolean }> {
  const parts: Array<{ text: string; highlight: boolean }> = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: snippet.slice(lastIndex, match.index), highlight: false });
    }
    parts.push({ text: match[1], highlight: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < snippet.length) {
    parts.push({ text: snippet.slice(lastIndex), highlight: false });
  }
  return parts;
}
