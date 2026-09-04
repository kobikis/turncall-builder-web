export type ThemePref = "system" | "light" | "dark";

const KEY = "tc-theme";

export const getThemePref = (): ThemePref =>
  (localStorage.getItem(KEY) as ThemePref) || "system";

const resolve = (pref: ThemePref): "light" | "dark" =>
  pref === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : pref;

export function applyThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref);
  document.documentElement.dataset.theme = resolve(pref);
}

// Follow OS changes live while in "system" mode.
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (getThemePref() === "system") applyThemePref("system");
  });
