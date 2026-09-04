import { useEffect, useRef } from "react";

/**
 * Poll `fn` every `intervalMs` while `enabled`. Two guards the ad-hoc
 * setInterval pollers lacked: it pauses while the browser tab is hidden (no
 * background churn), and it never starts a new call while the previous one is
 * still in flight (a slow response can't stack up overlapping requests).
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let inFlight = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!stopped && !inFlight && document.visibilityState === "visible") {
        inFlight = true;
        try {
          await fnRef.current();
        } finally {
          inFlight = false;
        }
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs, enabled]);
}
