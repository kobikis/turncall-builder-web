// What a page shows when a call fails: the error's own sentence (builder-api's
// `detail`, carried by ApiError), or the page's fallback when there is none.
// Kept out of api.ts so tests that mock "../api" still get it.
export const errMsg = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;
