import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { stashPendingInvite, takePendingInvite } from "./pendingInvite";
import { atLeast } from "./roles";
import type { Role } from "./types";
import Layout from "./Layout";
import Login from "./pages/Login";
import AcceptInvite from "./pages/AcceptInvite";
import Members from "./pages/Members";
import AgentsList from "./pages/AgentsList";
import NewAgent from "./pages/NewAgent";
import AgentPage from "./pages/agent/AgentPage";
import ConfigTab from "./pages/agent/ConfigTab";
import TestTab from "./pages/agent/TestTab";
import CallsTab from "./pages/agent/CallsTab";
import KnowledgeTab from "./pages/agent/KnowledgeTab";
import TakeawaysTab from "./pages/agent/TakeawaysTab";
import CodeTab from "./pages/agent/CodeTab";
import GitHubSettings from "./pages/GitHubSettings";
import PhoneNumbersList from "./pages/PhoneNumbersList";
import AddPhoneNumber from "./pages/AddPhoneNumber";
import EditPhoneNumber from "./pages/EditPhoneNumber";

// Redirect unauthenticated users to /login; hold rendering until the initial
// /auth/me bootstrap resolves so we don't flash the app or the login screen.
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  // Remember an invite link so it's resumed after login instead of lost. Done in
  // an effect (not render) to keep render pure; the write persists across the
  // redirect that follows.
  const stash = !loading && !user && location.pathname === "/invite";
  useEffect(() => {
    if (stash) stashPendingInvite(location.pathname + location.search);
  }, [stash, location]);
  if (loading) return <div className="auth-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Once authenticated, resume a stashed invite link (from a click made while logged
// out). Mounted at the app root so it also fires when Google login lands on "/".
export function ResumePendingInvite() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (loading || !user) return;
    const pending = takePendingInvite();
    if (pending && pending !== location.pathname + location.search) {
      navigate(pending, { replace: true });
    }
  }, [loading, user, navigate, location]);
  return null;
}

// Route gate on the active Workspace role (#28). A viewer can't reach the
// create/edit forms; only an admin reaches Members. Bounces to /agents rather
// than erroring — the server also enforces this, so it's a UX guard, not the
// security boundary.
export function RequireRole({ min, children }: { min: Role; children: React.ReactNode }) {
  const { loading, activeWorkspace } = useAuth();
  // Don't decide while auth is still resolving (activeWorkspace starts null) —
  // safe today under RequireAuth, but guards a future top-level use.
  if (loading) return null;
  if (!atLeast(activeWorkspace?.role, min)) return <Navigate to="/agents" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <ResumePendingInvite />
      <Routes>
        <Route path="/login" element={<Login />} />
      <Route
        path="/invite"
        element={
          <RequireAuth>
            <AcceptInvite />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/agents" replace />} />
        <Route path="agents" element={<AgentsList />} />
        <Route
          path="agents/new"
          element={
            <RequireRole min="editor">
              <NewAgent />
            </RequireRole>
          }
        />
        <Route
          path="agents/:id/edit"
          element={
            <RequireRole min="editor">
              <NewAgent />
            </RequireRole>
          }
        />
        <Route path="agents/:id" element={<AgentPage />}>
          <Route index element={<ConfigTab />} />
          <Route path="test" element={<TestTab />} />
          <Route path="calls" element={<CallsTab />} />
          <Route path="knowledge" element={<KnowledgeTab />} />
          <Route path="takeaways" element={<TakeawaysTab />} />
          <Route path="code" element={<CodeTab />} />
        </Route>
        {/* Per-user, not workspace-scoped: you can only connect your own. */}
        <Route path="settings/github" element={<GitHubSettings />} />
        <Route path="phone-numbers" element={<PhoneNumbersList />} />
        <Route
          path="phone-numbers/new"
          element={
            <RequireRole min="editor">
              <AddPhoneNumber />
            </RequireRole>
          }
        />
        <Route
          path="phone-numbers/:id/edit"
          element={
            <RequireRole min="editor">
              <EditPhoneNumber />
            </RequireRole>
          }
        />
        <Route
          path="members"
          element={
            <RequireRole min="admin">
              <Members />
            </RequireRole>
          }
        />
      </Route>
      </Routes>
    </>
  );
}
