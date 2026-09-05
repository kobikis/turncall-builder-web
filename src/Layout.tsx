import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { isAdmin } from "./roles";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import { applyThemePref, getThemePref, ThemePref } from "./theme";

export default function Layout() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const { user, activeWorkspaceId, activeWorkspace, logout } = useAuth();

  function pickTheme(pref: ThemePref) {
    setTheme(pref);
    applyThemePref(pref);
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        {/* Orange text + icon — reads on both themes (docs.json does the same). */}
        <img className="wordmark" src="/wordmark.svg" alt="TurnCall" />
        <WorkspaceSwitcher />
        <div className="section-label">Builder</div>
        <NavLink to="/agents" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Agents
        </NavLink>
        <NavLink to="/phone-numbers" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Phone Numbers
        </NavLink>
        {isAdmin(activeWorkspace?.role) && (
          // Members is admin-only — hidden for non-admins (the route is gated too).
          <NavLink to="/members" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Members
          </NavLink>
        )}
        <div className="foot">
          {user && (
            <div className="account">
              <div className="muted account-email">{user.email}</div>
              {/* Per-user, so it sits with the account rather than the
                  workspace nav above — you can only connect your own. */}
              <NavLink to="/settings/github" className="link-btn">
                GitHub
              </NavLink>
              <button className="link-btn" type="button" onClick={() => void logout()}>
                Log out
              </button>
            </div>
          )}
          <label className="theme-picker">
            Theme
            <select
              aria-label="Color theme"
              value={theme}
              onChange={(e) => pickTheme(e.target.value as ThemePref)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <a href="https://docs.turncall.io" target="_blank" rel="noreferrer">Docs ↗</a>
        </div>
      </nav>
      {/* Remount the routed content when the active Workspace changes so pages
          re-fetch under the new X-Workspace-Id and never show stale, other-tenant
          data (#28). */}
      <main className="main" key={activeWorkspaceId ?? "none"}>
        <Outlet />
      </main>
    </div>
  );
}
