import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { ApiResponse, Invite, Member, Role } from "../types";

const ROLES: Role[] = ["admin", "editor", "viewer"];

// Admin-only team management (#28): invite by email+role, list members, change a
// role, remove a member. The route is role-gated (RequireRole "admin") so a
// non-admin never reaches this; the server enforces the same on every call.
export default function Members() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // a mutation is in flight
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [lastInvite, setLastInvite] = useState<Invite | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<ApiResponse<{ members: Member[] }>>("/members");
      setMembers(res.data.members);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<ApiResponse<Invite>>("/members/invites", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setLastInvite(res.data);
      setInviteEmail("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create invite");
    }
  }

  const isSelf = (m: Member) => m.user_id === user?.id;

  async function changeRole(m: Member, role: Role) {
    if (role === m.role) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/members/${m.user_id}`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      });
      // Changing your own role must refresh the auth context, or the sidebar/route
      // gate would keep treating you as admin (stale) until a reload.
      if (isSelf(m)) await refresh();
      else await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change role");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Member) {
    const self = isSelf(m);
    const who = self ? "yourself" : m.email;
    if (!window.confirm(`Remove ${who} from this workspace?`)) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/members/${m.user_id}`, { method: "DELETE" });
      if (self) {
        // No longer a member here — reloading /members would 403. Re-bootstrap
        // (drops this workspace) and leave the page.
        await refresh();
        navigate("/agents", { replace: true });
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  }

  const inviteLink = lastInvite
    ? `${window.location.origin}/invite?token=${lastInvite.token}`
    : "";

  return (
    <div className="page">
      <h1>Members</h1>
      {error && <div className="callout error">{error}</div>}

      <section className="block">
        <h2>Invite a teammate</h2>
        <form className="invite-form" onSubmit={invite}>
          <input
            className="input"
            type="email"
            required
            placeholder="teammate@example.com"
            aria-label="Invite email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            className="input"
            aria-label="Invite role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">
            Send invite
          </button>
        </form>
        {lastInvite && (
          <div className="callout info">
            Invite created for <strong>{lastInvite.email}</strong> ({lastInvite.role}).
            Share this link — it works only for that email:
            <input className="input code" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
          </div>
        )}
      </section>

      <section className="block">
        <h2>Team</h2>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    {m.email}
                    {user?.id === m.user_id && <span className="muted"> (you)</span>}
                  </td>
                  <td>
                    <select
                      className="input"
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => remove(m)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
