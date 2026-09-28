// Placeholder rows for a table that is still loading.
//
// "Loading…" in one cell collapses the table to a single line and then throws
// the layout when the data lands. Rows of the right height hold the shape, so
// the page arrives in one movement instead of two — which is most of what
// "finished" means in a list view.

export default function SkeletonRows({
  rows = 3,
  columns,
}: {
  rows?: number;
  columns: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        // `aria-hidden`: a screen reader is told the table is busy by the
        // caller, and reading out three rows of nothing is worse than silence.
        <tr key={row} aria-hidden="true" className="skeleton-row">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              {/* Varying widths, because a column of identical grey bars reads
                  as a rendering fault rather than as text that has not
                  arrived. */}
              <span className="skeleton" style={{ width: `${45 + ((row + column) % 3) * 18}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
