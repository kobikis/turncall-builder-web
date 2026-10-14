// TurnCall's mark — an orange tile with two turns of a conversation — the same
// one turncall.io, the docs and public/favicon.svg carry.
// With a `label` it stands for the name on its own; without, it is decoration.
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 22 22" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <rect width="22" height="22" rx="6" fill="#e8702a" />
      <path d="M7 11a4 4 0 0 1 4-4M5 11a6 6 0 0 1 6-6M11 15a4 4 0 0 0 4-4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Mark + name, set in the page's own font so it follows the theme (turncall.io's nav brand).
export function Wordmark() {
  return (
    <span className="wordmark" role="img" aria-label="TurnCall">
      <BrandMark className="wordmark-mark" />
      TurnCall
    </span>
  );
}
