// A collapsible section of the agent's Configuration tab.
//
// The tab is one long scroll of fields, and most of a settled agent's config is
// something nobody looks at twice. A <details>/<summary> is the native answer —
// keyboard-accessible disclosure with no state machine of its own.
//
// The one piece of state is whether it is open, remembered in localStorage: a
// preference re-asked on every page load is not a preference, and ConfigTab
// unmounts on every tab switch. Kept per section but not per agent — whether
// someone cares about MCP servers is a fact about them, not about the agent
// they happen to have open.

import { useState, type ReactNode } from "react";

const key = (id: string) => `turncall.section.${id}`;

function remembered(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key(id));
    return stored === null ? fallback : stored !== "0";
  } catch {
    // Private mode throws. A collapsed section is not worth a blank page.
    return fallback;
  }
}

function remember(id: string, open: boolean): void {
  try {
    localStorage.setItem(key(id), open ? "1" : "0");
  } catch {
    /* the toggle still works, it just will not be remembered */
  }
}

type Props = {
  /** Stable id — the localStorage key. Renaming one forgets its state once. */
  id: string;
  title: string;
  /**
   * What the section still says when it is shut: a count, a chosen mode. Without
   * one, minimizing is a choice between seeing the fields and knowing whether
   * anything is set in them.
   */
  hint?: ReactNode;
  /** Open on first visit. Everything defaults open — a Console that hides its
   *  own form until you find the toggles is worse than a long one. */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Section({ id, title, hint, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  return (
    <details
      open={open}
      style={{ margin: "0 0 16px" }}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        remember(id, next);
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 500, fontSize: 13 }}>
        {title}
        {hint != null && hint !== "" && (
          <span className="muted" style={{ fontWeight: 400 }}>
            {" "}
            · {hint}
          </span>
        )}
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}
