export type DiffLine = {
  type: "same" | "add" | "del" | "gap";
  text: string;
};

/**
 * Line diff via an LCS table.
 *
 * ponytail: O(n*m) table — a few hundred lines squared is nothing. Swap in a
 * Myers diff only if this ever runs on something much larger than a resume.
 */
export const lineDiff = (before: string, after: string): DiffLine[] => {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });

  return out;
};

export const diffStat = (lines: DiffLine[]) => ({
  added: lines.filter((l) => l.type === "add").length,
  removed: lines.filter((l) => l.type === "del").length
});

/**
 * Replace long unchanged runs with a single "gap" line, so a two-line edit in
 * a long resume reviews as a two-line edit.
 */
export const collapseUnchanged = (lines: DiffLine[], context = 2): DiffLine[] => {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, i) => {
    if (line.type === "same") return;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  });

  const out: DiffLine[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden) out.push({ type: "gap", text: `${hidden}` });
    hidden = 0;
  };

  lines.forEach((line, i) => {
    if (keep[i]) {
      flush();
      out.push(line);
    } else hidden++;
  });
  flush();

  return out;
};

/** "+3 −1", or "" when nothing changed. */
export const diffSummary = (before: string, after: string): string => {
  const { added, removed } = diffStat(lineDiff(before, after));
  if (!added && !removed) return "";
  return [added ? `+${added}` : "", removed ? `−${removed}` : ""]
    .filter(Boolean)
    .join(" ");
};
