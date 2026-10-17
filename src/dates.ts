/** How a timestamp reads in a table cell.
 *
 * One format for every list, because "when did this happen" is one question
 * and two lists answering it differently — `Sep 20, 01:10 PM` on Calls and
 * `9/20, 1:10 PM` on Evals — make a reader convert between them for no reason.
 *
 * No seconds and no year: a full locale string is the widest thing in these
 * tables and wraps every row into two. Seconds have never decided anything
 * here, and where they would, the cell carries an exact tooltip.
 */
const timeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const fmtTime = (iso: string | null | undefined): string =>
  iso ? timeFmt.format(new Date(iso)) : "—";

const stampFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `fmtTime` with the year, for a list that spans years: the audit log keeps
 *  entries for good by default, and "when did this happen" there is often
 *  "which year". A value that is not a date reads as given. */
export const fmtStamp = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : stampFmt.format(d);
};

/** A timestamp as a local `YYYY-MM-DD`, or "" when there is none.
 *
 * The format `<input type="date">` holds, so a range filter is two string
 * comparisons and no date arithmetic. **Local**, deliberately: a run queued at
 * 01:00 in Jerusalem is today to the person looking at it, and slicing on the
 * UTC day would file it under yesterday for half the world.
 *
 * Lives here rather than in a tab because two lists filter by day now, and the
 * one thing worse than a date helper is two of them that round differently.
 */
export const localDay = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

/** Whether a timestamp falls inside an inclusive `from`/`to` day range.
 *
 * An empty bound is open, so "" / "" accepts everything. A row with no
 * timestamp at all is **excluded once either bound is set**: it cannot be shown
 * to be in the range, and a queued run with no times yet appearing under "runs
 * from Tuesday" would be a claim the data does not support.
 */
export const inDayRange = (
  iso: string | null | undefined,
  from: string,
  to: string
): boolean => {
  if (!from && !to) return true;
  const day = localDay(iso);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
};
