// Helpers for walking the turn tree. Used by the server (history, validation)
// and the page (which path is on screen, where the branch switchers go).

export interface TreeTurn {
  id: string;
  parentTurnId: string | null;
  createdAt: string;
}

/** Turns from the first turn down to `leafId`, inclusive. Empty if the id is unknown. */
export function pathToTurn<T extends TreeTurn>(byId: ReadonlyMap<string, T>, leafId: string | null): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  let cur = leafId ? byId.get(leafId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentTurnId ? byId.get(cur.parentTurnId) : undefined;
  }
  return path;
}

/** Children keyed by parent id ("" for first turns), oldest first. */
export function childrenByParent<T extends TreeTurn>(turns: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const t of turns) {
    const key = t.parentTurnId ?? "";
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  return map;
}

/** Follows the newest child from `turnId` down to a leaf. */
export function deepestLeaf<T extends TreeTurn>(children: ReadonlyMap<string, T[]>, turnId: string): string {
  let id = turnId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(id)) return id;
    seen.add(id);
    const kids = children.get(id);
    const newest = kids?.[kids.length - 1];
    if (!newest) return id;
    id = newest.id;
  }
}
