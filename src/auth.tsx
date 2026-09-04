import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, setActiveWorkspaceId } from "./api";
import type { ApiResponse, User, Workspace } from "./types";

// Auth + active-Workspace state for the whole app (builder-api #29/#31/#33). The
// session itself is an httpOnly cookie the browser can't read, so "am I logged
// in?" is answered by asking the server (GET /auth/me). No TurnCall key ever
// lives here — the browser only holds identity, never a provider credential.

const ACTIVE_WS_KEY = "tc.activeWorkspaceId";

type AuthState = {
  loading: boolean;
  user: User | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  // preferId activates that Workspace using the freshly-fetched list (avoids the
  // stale-closure trap where setActiveWorkspace can't yet see a just-joined one).
  refresh: (preferId?: string) => Promise<User | null>;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

// Pick which Workspace is active: the last-used one if it's still a membership,
// else the first. Push it into api() so every request carries X-Workspace-Id.
export function chooseActive(workspaces: Workspace[]): string | null {
  if (workspaces.length === 0) return null;
  const stored = localStorage.getItem(ACTIVE_WS_KEY);
  const valid = stored && workspaces.some((w) => w.id === stored);
  return valid ? stored : workspaces[0].id;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const applyActive = useCallback((id: string | null) => {
    setActiveId(id);
    setActiveWorkspaceId(id); // reaches the api() fetch wrapper
    // Clear on deactivation too, so a stale workspace UUID can't be re-selected
    // for a different user on a shared browser profile.
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
    else localStorage.removeItem(ACTIVE_WS_KEY);
  }, []);

  const refresh = useCallback(async (preferId?: string): Promise<User | null> => {
    try {
      const me = await api<ApiResponse<{ user: User }>>("/auth/me");
      const ws = await api<ApiResponse<{ workspaces: Workspace[] }>>("/workspaces");
      const list = ws.data.workspaces;
      setUser(me.data.user);
      setWorkspaces(list);
      // Prefer the just-joined/created Workspace if it's real, else last-used/first.
      const active = preferId && list.some((w) => w.id === preferId) ? preferId : chooseActive(list);
      applyActive(active);
      return me.data.user;
    } catch (e) {
      // 401 is the clean "not logged in" path. Anything else (5xx, network,
      // parse error) is unexpected — log it, but still clear session state so the
      // gate falls back to /login rather than a half-rendered app. Returning null
      // lets the caller (login submit) tell success from a transient failure.
      if (!(e instanceof ApiError && e.status === 401)) {
        console.error("[auth] session refresh failed", e);
      }
      setUser(null);
      setWorkspaces([]);
      applyActive(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyActive]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveWorkspace = useCallback(
    (id: string) => {
      if (workspaces.some((w) => w.id === id)) applyActive(id);
    },
    [workspaces, applyActive],
  );

  const createWorkspace = useCallback(
    async (name: string): Promise<Workspace> => {
      const res = await api<ApiResponse<Workspace>>("/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const ws = res.data; // { id, name, role: "admin" }
      // Append + switch atomically here (fresh data) rather than round-tripping
      // through refresh(), whose state update wouldn't be visible to a caller's
      // immediate setActiveWorkspace.
      setWorkspaces((prev) => [...prev, ws]);
      applyActive(ws.id);
      return ws;
    },
    [applyActive],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      // Always clear local state even if the POST fails — applyActive(null) also
      // removes the stored workspace id.
      setUser(null);
      setWorkspaces([]);
      applyActive(null);
    }
  }, [applyActive]);

  const value: AuthState = {
    loading,
    user,
    workspaces,
    activeWorkspaceId: activeId,
    activeWorkspace: workspaces.find((w) => w.id === activeId) ?? null,
    refresh,
    setActiveWorkspace,
    createWorkspace,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
