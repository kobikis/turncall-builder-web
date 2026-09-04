import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { ApiResponse } from "../types";

// Redeem an invite token (#28). Login-gated (inside RequireAuth), so the invitee
// signs in first, then this posts /invites/accept, re-bootstraps auth to pick up
// the new membership, switches into that Workspace, and lands on /agents. The
// server binds acceptance to the invited email, so a wrong account gets a 403.
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false); // StrictMode double-invokes effects; accept once

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setError("This invite link is missing its token.");
      return;
    }
    (async () => {
      try {
        const res = await api<ApiResponse<{ workspace_id: string }>>("/invites/accept", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        // Re-bootstrap and switch into the just-joined Workspace via preferId
        // (fresh list). A null return means the reload failed after a successful
        // accept — surface it rather than blindly navigating into a cleared session.
        const user = await refresh(res.data.workspace_id);
        if (!user) {
          setError("Invite accepted, but reloading your session failed — please sign in again.");
          return;
        }
        navigate("/agents", { replace: true });
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : "Could not accept this invite.",
        );
      }
    })();
  }, [token, refresh, navigate]);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Joining workspace…</h1>
        {error ? (
          <>
            <div className="callout error">{error}</div>
            <button className="btn" type="button" onClick={() => navigate("/agents")}>
              Go to app
            </button>
          </>
        ) : (
          <div className="muted">One moment.</div>
        )}
      </div>
    </div>
  );
}
