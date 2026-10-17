import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

// A render error unmounts everything above it to the nearest boundary; with
// none, React leaves a blank page. The app wraps its routes in one, and the
// layout its routed content, so a page that throws (a malformed link, an
// answer of an unexpected shape) shows why and keeps the rail to leave by.
// `resetKey` (the path) clears it: navigating away is the way out.

type Props = { resetKey?: string; children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("render error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="callout error" role="alert" style={{ margin: 16 }}>
        <strong>This page could not be shown.</strong>
        <p>{error.message || "An unexpected error."}</p>
        <p style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <Link className="btn" to="/agents">
            Go to Agents
          </Link>
        </p>
      </div>
    );
  }
}
