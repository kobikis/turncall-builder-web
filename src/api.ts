export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// The active Workspace, sent as X-Workspace-Id on every builder call so the
// backend scopes the request (RBAC gate, builder-api #31). AuthProvider owns
// this and pushes it here; api() is a plain function, not a hook, so a module
// variable is the simplest way to reach it from every caller.
let activeWorkspaceId: string | null = null;
export const setActiveWorkspaceId = (id: string | null): void => {
  activeWorkspaceId = id;
};
// For callers that bypass api() but still need to scope a request — e.g. the
// WebRTC transport builds its own fetch (see webrtc.ts).
export const getActiveWorkspaceId = (): string | null => activeWorkspaceId;

// Single fetch wrapper: non-2xx and network failures become thrown ApiErrors
// carrying the server's `detail`, so pages can show real messages. Generic so
// callers can annotate the response shape (see src/types.ts); defaults to `any`
// so existing untyped callers keep working while new ones opt into types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api = async <T = any>(path: string, init?: RequestInit): Promise<T> => {
  let r: Response;
  // FormData bodies set their own multipart boundary — don't force JSON.
  const jsonHeaders: Record<string, string> =
    init?.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const workspaceHeader: Record<string, string> = activeWorkspaceId
    ? { "X-Workspace-Id": activeWorkspaceId }
    : {};
  try {
    r = await fetch(`/api${path}`, {
      ...init,
      // same-origin (via the /api proxy) so the httpOnly session cookie is sent.
      credentials: "same-origin",
      headers: { ...jsonHeaders, ...workspaceHeader, ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the builder API — is it running?", 0);
  }
  const body = await r.json().catch(() => null);
  if (!r.ok)
    throw new ApiError((body as { detail?: string })?.detail || `Request failed (${r.status})`, r.status);
  return body as T;
};
