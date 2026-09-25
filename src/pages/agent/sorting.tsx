import { useState, type ReactNode } from "react";

// Sorting a table by a column, and the header that drives it.
//
// Shared rather than written twice: the scenarios and the runs on the Evals tab
// are the same problem, and two implementations would drift into two
// behaviours — one where clicking a sorted column reverses it and one where it
// does not, which is the kind of difference nobody reports and everybody
// notices.

export type Dir = "asc" | "desc";

/** Compares what a table cell holds: numbers as numbers, everything else as
 *  text, with blanks last whichever way the column is pointing — an empty cell
 *  is "no answer", never the smallest answer. */
function compare(a: string | number, b: string | number): number {
  const blankA = a === "" || a === null || a === undefined;
  const blankB = b === "" || b === null || b === undefined;
  if (blankA || blankB) return blankA && blankB ? 0 : blankA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function useSort<T>(initialKey: string, initialDir: Dir = "desc") {
  const [key, setKey] = useState(initialKey);
  const [dir, setDir] = useState<Dir>(initialDir);

  // A new column starts ascending; the column already sorted reverses. Anything
  // else makes the second click feel like it did nothing.
  const toggle = (next: string) => {
    if (next === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setKey(next);
      setDir("asc");
    }
  };

  const sort = (rows: T[], cell: (row: T, key: string) => string | number) => {
    // A copy: sorting the state array in place is a mutation React cannot see,
    // and the table would go stale until something else re-rendered it.
    const blanksLast = [...rows].sort((a, b) => compare(cell(a, key), cell(b, key)));
    return dir === "asc" ? blanksLast : blanksLast.reverse();
  };

  return { key, dir, toggle, sort };
}

export function SortHeader({
  children,
  column,
  sort,
}: {
  children: ReactNode;
  column: string;
  sort: { key: string; dir: Dir; toggle: (k: string) => void };
}) {
  const active = sort.key === column;
  // The word the reader sees, not the key behind it — the Agent column sorts
  // on "model", and "Sort by model" is a label for a different control.
  const label = typeof children === "string" ? children : column;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      {/* `row-toggle` and a muted `caret` are what the Calls and Takeaways
          tables already use for exactly this. A second look for the same
          control is the kind of difference nobody reports and everybody
          notices — and inline styles are how that happens. */}
      <button
        type="button"
        className="row-toggle"
        onClick={() => sort.toggle(column)}
        aria-label={`Sort by ${label}, ${sort.dir === "asc" ? "ascending" : "descending"} — click to reverse`}
      >
        {children}
        {/* The caret only on the column actually in force: these tables sort by
            several, and an arrow on every header says nothing about which one
            is sorting. */}
        {active && (
          <span className="caret" aria-hidden="true">
            {sort.dir === "asc" ? "▴" : "▾"}
          </span>
        )}
      </button>
    </th>
  );
}
