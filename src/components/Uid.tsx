import { useState } from "react";

// Copyable entity id. Shows the first 8 chars (or the whole id when `full`);
// click (or Enter/Space) copies the full id. Used across lists + detail headers.
export default function Uid({ id, label = "id", full = false }: { id?: string | null; label?: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="muted">—</span>;

  async function copy(e: React.SyntheticEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      /* clipboard blocked (non-https / permissions) — the title still shows the full id */
    }
  }

  return (
    <code
      className="uid"
      role="button"
      tabIndex={0}
      title={`${label}: ${id}\nclick to copy`}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          copy(e);
        }
      }}
    >
      {copied ? "copied" : full ? id : id.slice(0, 8)}
    </code>
  );
}
