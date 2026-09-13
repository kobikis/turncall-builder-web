// One input of an end-of-call Action.
//
// A picker when the catalog says the value is chosen from a list, a text field
// otherwise — and a text field again whenever the list cannot be fetched, so a
// Workspace that has not connected the app yet, or a third party having a bad
// morning, loses the convenience and never the form.
//
// The picker exists because an opaque identifier typed by hand has no failure
// mode anyone can see. A Google calendar ID one character short of the right one
// is accepted here, refused by Google with a 404 nobody is watching, and shows
// up only as a calendar entry that never appears.

import { useEffect, useState } from "react";

import { ApiError, api } from "../../api";
import type { CatalogInput } from "../../apps";

type Option = { value: string; label: string };

type Props = {
  /** App slug — half of the options lookup, and part of the aria label. */
  app: string;
  appName: string;
  input: CatalogInput;
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
};

export function ArgumentField({ app, appName, input, value, editable, onChange }: Props) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState("");
  const label = `${appName}: ${input.label}`;

  useEffect(() => {
    if (!input.options) return;
    // Per connected account and not cached: which calendars exist belongs to
    // the Workspace and changes without telling us.
    let live = true;
    api<{ data: Option[] }>(`/integrations/${app}/options/${input.name}`)
      .then((r) => {
        if (live) setOptions(r.data || []);
      })
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof ApiError ? e.message : "Could not load the list.");
      });
    return () => {
      live = false;
    };
  }, [app, input.name, input.options]);

  // An empty list is not a list to choose from: "you have no channels" is not
  // something a Workspace can act on, and a dropdown with nothing in it strands
  // them. Fall through to typing.
  const usable = options && options.length > 0 ? options : null;

  if (!input.options || failed || (options !== null && !usable)) {
    return (
      <label style={{ display: "block", fontSize: 12.5, marginTop: 6 }}>
        {input.label}
        <input
          className="input"
          value={value}
          disabled={!editable}
          placeholder={input.placeholder}
          aria-label={label}
          style={{ display: "block", marginTop: 4 }}
          onChange={(e) => onChange(e.target.value)}
        />
        {input.options && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {failed || "Nothing to choose from — enter the ID."}
          </span>
        )}
      </label>
    );
  }

  if (!usable) {
    return (
      <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        Loading {input.label.toLowerCase()}…
      </p>
    );
  }

  // A stored value the list does not contain — an archived channel, a calendar
  // someone stopped sharing, or a value typed before there was a picker. Kept
  // as an option rather than dropped: a saved setting must not disappear
  // because a page rendered.
  const orphan = value && !usable.some((o) => o.value === value);

  return (
    <label style={{ display: "block", fontSize: 12.5, marginTop: 6 }}>
      {input.label}
      <select
        className="input"
        value={value}
        disabled={!editable}
        aria-label={label}
        style={{ display: "block", marginTop: 4 }}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {orphan && <option value={value}>{value} — no longer listed</option>}
        {usable.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
