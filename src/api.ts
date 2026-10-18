// `reason` and `numbers` are a refusal's machine-readable parts, when the body
// has them (e.g. 409 `numbers_not_on_account`, builder-api#114); `message` is
// still the sentence every other caller shows.
export class ApiError extends Error {
  reason?: string;
  numbers?: string[];
  constructor(
    message: string,
    public status: number,
    extra?: { reason?: string; numbers?: string[] },
  ) {
    super(message);
    this.reason = extra?.reason;
    this.numbers = extra?.numbers;
  }
}

const refusalParts = (body: unknown): { reason?: string; numbers?: string[] } => {
  const b = (body ?? {}) as { reason?: unknown; numbers?: unknown };
  return {
    reason: typeof b.reason === "string" ? b.reason : undefined,
    numbers:
      Array.isArray(b.numbers) && b.numbers.every((n) => typeof n === "string")
        ? (b.numbers as string[])
        : undefined,
  };
};

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
    throw new ApiError(
      (body as { detail?: string })?.detail || `Request failed (${r.status})`,
      r.status,
      refusalParts(body),
    );
  return body as T;
};

// A builder turn, narrated. `api()` parses the whole body before returning, so
// it cannot show anything while a turn is still working — this is its sibling,
// not an option on it: same cookie, same workspace header, same ApiError, but
// the body is read as it arrives.
//
// The status code is checked before the first byte is consumed, which is where
// an expired session lands — so a 404 is still a real 404 the caller can retry.
export const streamEvents = async (
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> => {
  let r: Response;
  const workspaceHeader: Record<string, string> = activeWorkspaceId
    ? { "X-Workspace-Id": activeWorkspaceId }
    : {};
  try {
    r = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...workspaceHeader },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the builder API — is it running?", 0);
  }
  if (!r.ok || !r.body) {
    const failed = await r.json().catch(() => null);
    throw new ApiError(
      (failed as { detail?: string })?.detail || `Request failed (${r.status})`,
      r.status,
    );
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Frames are separated by a blank line. Whatever follows the last one is a
    // partial frame and waits for more bytes rather than being parsed.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
};
