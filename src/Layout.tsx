import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { isAdmin } from "./roles";
import ErrorBoundary from "./components/ErrorBoundary";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import { BrandMark } from "./components/BrandMark";
import { applyThemePref, getThemePref, ThemePref } from "./theme";

// `box` lets a 24-unit icon (Lucide's grid) sit beside the 16-unit ones at the
// same stroke weight.
const icon = (paths: ReactNode, box = 16) => (
  <svg width="18" height="18" viewBox={`0 0 ${box} ${box}`} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth={(1.3 * box) / 16} strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

const ICONS = {
  // A bot in a headset: an AI agent that takes calls. (A person read as
  // Members' twin; a waveform said voice but not agent; a sparkle sat next to
  // Builder skills' star.)
  agents: icon(<>
    <rect x="3.5" y="4.5" width="9" height="9" rx="2.4" />
    <path d="M8 4.5V2.2M6.3 8v.4M9.7 8v.4M6.5 11h3M1.5 7.5v3M14.5 7.5v3" />
  </>),
  phone: icon(<path d="M4 2.5h2l1 3-1.4 1a7 7 0 0 0 3.9 3.9l1-1.4 3 1v2a1.5 1.5 0 0 1-1.6 1.5A11 11 0 0 1 2.5 4.1 1.5 1.5 0 0 1 4 2.5Z" />),
  integrations: icon(<>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </>),
  // Stacked layers (Lucide layers): versioned pieces an agent stacks on itself
  // mid-call. Not Builder skills' scroll — those are the Builder's own guidance.
  skills: icon(<>
    <path d="m12 2 9 5-9 5-9-5Z" />
    <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
  </>, 24),
  members: icon(<>
    <circle cx="6" cy="6" r="2.2" /><circle cx="11.5" cy="7" r="1.7" />
    <path d="M2 13c.6-2 2.1-3 4-3s3.4 1 4 3M10.5 10.2c1.6 0 2.8.9 3.3 2.6" />
  </>),
  // A scroll (Lucide scroll-text): the icon Claude gives Skills, where the
  // SKILL.md format comes from — written instructions the model reads.
  builderSkills: icon(<>
    <path d="M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
  </>, 24),
  // A shield: the Workspace's redaction and retention policy.
  compliance: icon(<path d="M8 1.8 13 3.6v4.1c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.6Z" />),
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
  const { pathname } = useLocation();

  function pickTheme(pref: ThemePref) {
    setTheme(pref);
    applyThemePref(pref);
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <BrandMark className="rail-logo" label="TurnCall" />
        <RailLink to="/agents" label="Agents">{ICONS.agents}</RailLink>
        <RailLink to="/phone-numbers" label="Phone numbers">{ICONS.phone}</RailLink>
        <RailLink to="/integrations" label="Integrations">{ICONS.integrations}</RailLink>
        <RailLink to="/skills" label="Skills">{ICONS.skills}</RailLink>
        {isAdmin(activeWorkspace?.role) && (
          // Members is admin-only — hidden for non-admins (the route is gated too).
          <RailLink to="/members" label="Members">{ICONS.members}</RailLink>
        )}
        {isAdmin(activeWorkspace?.role) && (
          // A builder skill is prompt text in the builder that holds the deployment's
          // LLM key — authoring one is an admin's, like membership.
          <RailLink to="/builder-skills" label="Builder skills">{ICONS.builderSkills}</RailLink>
        )}
        {isAdmin(activeWorkspace?.role) && (
          // Even reading it is an admin's: it lists every agent's state.
          <RailLink to="/compliance" label="Compliance">{ICONS.compliance}</RailLink>
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
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
