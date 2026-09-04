// An invite link (/invite?token=…) is login-gated, so clicking it while logged
// out bounces to /login and would otherwise lose the token. We stash the intended
// path before that redirect and resume it once authenticated — via localStorage so
// it survives even the full-page Google OAuth round-trip (react-router state would
// not). See RequireAuth + ResumePendingInvite in App.tsx.
const KEY = "tc.pendingInvite";

export function stashPendingInvite(path: string): void {
  localStorage.setItem(KEY, path);
}

// Read once and clear, so the resume happens exactly once.
export function takePendingInvite(): string | null {
  const path = localStorage.getItem(KEY);
  if (path) localStorage.removeItem(KEY);
  return path;
}
