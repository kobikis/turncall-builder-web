// Twenty-four hours of an agent, one bar per hour, now at the right edge.
//
// The list used to say what an agent *is* — a port, a key, a container state.
// This is the first thing on it that says what the agent has been *doing*, and
// it answers the question an operator actually arrives with: has this gone
// quiet. A number alone cannot answer that. "38 calls" reads the same whether
// they arrived steadily all day or all before nine and none since.
//
// Drawn as divs rather than a chart library: twenty-four rectangles do not
// need three hundred kilobytes and an axis model.

// Each bar is scaled against the agent's own busiest hour, not against the
// other agents': the shape of one agent's day is the subject, and a quiet
// agent beside a busy one would otherwise be a flat line saying nothing.
const MIN_BAR = 0.08;

export default function Ribbon({
  hours,
  total,
  available,
  truncated,
}: {
  hours: number[];
  total: number;
  available: boolean;
  truncated: boolean;
}) {
  if (!available) {
    // Not zero. "Nobody rang" and "we could not ask" are different facts, and
    // a flat ribbon would state the first while meaning the second.
    return <span className="muted ribbon-empty">no data</span>;
  }

  const peak = Math.max(...hours, 1);
  const label = `${truncated ? "at least " : ""}${total} call${total === 1 ? "" : "s"} in the last 24 hours`;

  return (
    <span className="ribbon" title={label}>
      <span className="ribbon-bars" role="img" aria-label={label}>
        {hours.map((count, hour) => (
          <span
            key={hour}
            className={`ribbon-bar${hour === hours.length - 1 ? " now" : ""}`}
            // A zero hour keeps a hairline rather than disappearing: the gap
            // between bars already means "hour", so a missing bar would read
            // as missing data instead of as no calls.
            style={{ height: `${Math.max(count / peak, MIN_BAR) * 100}%` }}
          />
        ))}
      </span>
      <span className="ribbon-total">
        {truncated ? "+" : ""}
        {total}
      </span>
    </span>
  );
}
