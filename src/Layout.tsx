import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { isAdmin } from "./roles";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import { applyThemePref, getThemePref, ThemePref } from "./theme";

const icon = (paths: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

const ICONS = {
  // A bot in a headset: an AI agent that takes calls. (A person read as
  // Members' twin; a waveform said voice but not agent; a sparkle sat next to
  // Skills' star.)
  agents: icon(<>
    <rect x="3.5" y="4.5" width="9" height="9" rx="2.4" />
    <path d="M8 4.5V2.2M6.3 8v.4M9.7 8v.4M6.5 11h3M1.5 7.5v3M14.5 7.5v3" />
  </>),
  phone: icon(<path d="M4 2.5h2l1 3-1.4 1a7 7 0 0 0 3.9 3.9l1-1.4 3 1v2a1.5 1.5 0 0 1-1.6 1.5A11 11 0 0 1 2.5 4.1 1.5 1.5 0 0 1 4 2.5Z" />),
  integrations: icon(<>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </>),
  members: icon(<>
    <circle cx="6" cy="6" r="2.2" /><circle cx="11.5" cy="7" r="1.7" />
    <path d="M2 13c.6-2 2.1-3 4-3s3.4 1 4 3M10.5 10.2c1.6 0 2.8.9 3.3 2.6" />
  </>),
  skills: icon(<path d="M8 2.5 9.6 6l3.9.4-2.9 2.6.8 3.8L8 10.9l-3.4 1.9.8-3.8-2.9-2.6L6.4 6 8 2.5Z" />),
};

function RailLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <NavLink to={to} aria-label={label} title={label} className={({ isActive }) => `rail-link${isActive ? " active" : ""}`}>
      {children}
    </NavLink>
  );
}

// A 56px icon rail: the agent page needs the width for its three panes, and
// global nav is five places you go, not something you read.
export default function Layout() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const { user, activeWorkspaceId, activeWorkspace, logout } = useAuth();

  function pickTheme(pref: ThemePref) {
    setTheme(pref);
    applyThemePref(pref);
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <svg className="rail-logo" viewBox="0 0 22 22" role="img" aria-label="TurnCall">
          <rect width="22" height="22" rx="6" fill="#e8702a" />
          <path d="M7 11a4 4 0 0 1 4-4M5 11a6 6 0 0 1 6-6M11 15a4 4 0 0 0 4-4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
        <RailLink to="/agents" label="Agents">{ICONS.agents}</RailLink>
        <RailLink to="/phone-numbers" label="Phone numbers">{ICONS.phone}</RailLink>
        <RailLink to="/integrations" label="Integrations">{ICONS.integrations}</RailLink>
        {isAdmin(activeWorkspace?.role) && (
          // Members is admin-only — hidden for non-admins (the route is gated too).
          <RailLink to="/members" label="Members">{ICONS.members}</RailLink>
        )}
        {isAdmin(activeWorkspace?.role) && (
          // A skill is prompt text in the builder that holds the deployment's
          // LLM key — authoring one is an admin's, like membership.
          <RailLink to="/skills" label="Skills">{ICONS.skills}</RailLink>
        )}
        {/* Workspace, account and theme: per-user, so they sit together behind
            the account button rather than in the nav above. */}
        <details className="rail-account">
          <summary aria-label="Account" title={user?.email}>
            {(user?.email || "?").slice(0, 2).toUpperCase()}
          </summary>
          <div className="menu-pop">
            {user && <div className="muted account-email">{user.email}</div>}
            <WorkspaceSwitcher />
            <NavLink to="/settings/github" className="link-btn">GitHub</NavLink>
            <label className="theme-picker">
              Theme
              <select aria-label="Color theme" value={theme} onChange={(e) => pickTheme(e.target.value as ThemePref)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <a href="https://docs.turncall.io" target="_blank" rel="noreferrer">Docs ↗</a>
            {user && (
              <button className="link-btn" type="button" onClick={() => void logout()}>
                Log out
              </button>
            )}
          </div>
        </details>
      </nav>
      {/* Remount the routed content when the active Workspace changes so pages
          re-fetch under the new X-Workspace-Id and never show stale, other-tenant
          data (#28). */}
      <main className="main" key={activeWorkspaceId ?? "none"}>
        <div className="main-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
