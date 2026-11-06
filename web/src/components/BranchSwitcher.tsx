import type { Turn } from "@mmc/shared";

interface Props {
  /** Turns that share a parent: the alternatives at this point, oldest first. */
  siblings: Turn[];
  currentId: string;
  labelFor: (turn: Turn) => string;
  onSelect: (turnId: string) => void;
}

/** Shown wherever paths split: ‹ 2 / 3 Claude Sonnet only › */
export function BranchSwitcher({ siblings, currentId, labelFor, onSelect }: Props) {
  const index = siblings.findIndex((t) => t.id === currentId);
  const current = siblings[index];
  if (siblings.length < 2 || !current) return null;
  const prev = siblings[index - 1];
  const next = siblings[index + 1];
  return (
    <nav className="switcher" aria-label="Switch branch">
      <button type="button" disabled={!prev} onClick={() => prev && onSelect(prev.id)} aria-label="Previous branch">
        ‹
      </button>
      <span>
        {index + 1} / {siblings.length}
      </span>
      <span className="switch-label" title={current.userText}>
        {labelFor(current)}
      </span>
      <button type="button" disabled={!next} onClick={() => next && onSelect(next.id)} aria-label="Next branch">
        ›
      </button>
    </nav>
  );
}
