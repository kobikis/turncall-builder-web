import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { takePendingInvite } from "../pendingInvite";
import type { ApiResponse, User } from "../types";

// Login / signup front door (builder-api #29/#32). Email+password and a "Sign in
// with Google" button. The browser never receives a TurnCall key here — only a
// session cookie the server sets; identity comes from /auth/me afterwards.

type Mode = "login" | "signup";

export default function Login() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api<ApiResponse<{ user: User }>>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      // The cookie is set now; pull the session + workspaces. Only advance once
      // refresh actually resolves a user — otherwise (e.g. /workspaces 5xx) we'd
      // bounce silently back to /login despite a valid session.
      const user = await refresh();
      if (!user) {
        setError("Signed in, but couldn't load your workspaces — please retry.");
        setBusy(false);
        return;
      }
      // navigate + refresh's setState land in one React 18 batched render, so
      // RequireAuth sees the authenticated user (don't wrap either in flushSync).
      // Resume an invite link clicked before login (else land on the app root) —
      // consuming it here avoids a flash of "/" before ResumePendingInvite fires.
      navigate(takePendingInvite() ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  // Full-page redirect into the OIDC flow; the callback sets the cookie and
  // returns to the app, where AuthProvider re-bootstraps from /auth/me.
  function google() {
    window.location.href = "/api/auth/google/login";
  }

  return (
    <div className="auth-screen">
      <aside className="auth-brand">
        <img className="wordmark" src="/wordmark.svg" alt="TurnCall" />
        <p className="auth-tagline">Voice AI infrastructure you can self-host</p>
      </aside>
      <div className="auth-main">
      <form className="auth-card" onSubmit={submit}>
        <img className="wordmark" src="/wordmark.svg" alt="TurnCall" />
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>

        {error && <div className="callout error">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            {...(mode === "login" ? {} : { minLength: 8 })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
        </button>

        <div className="auth-divider">or</div>
        <button className="btn" type="button" onClick={google}>
          <GoogleIcon />
          Sign in with Google
        </button>

        <button
          className="link-btn"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </form>
      </div>
    </div>
  );
}

// Official Google "G" mark for the sign-in button.
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
