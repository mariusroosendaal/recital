// Near matches, for "did you mean" hints.

/** Edit distance between two strings */
export function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** The items of `known` close to `word`, closest first */
export function closest(word, known, { limit = 1, slack = 4 } = {}) {
  const w = word.toLowerCase();
  return [...known]
    .map((k) => [k, distance(w, k.toLowerCase())])
    .filter(([, d]) => d <= Math.max(2, Math.floor(word.length / slack)))
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/** ` (did you mean "x"?)` for the closest of `known`, if it's close */
export function suggest(word, known) {
  const [best] = closest(word, known);
  return best ? ` (did you mean "${best}"?)` : "";
}
