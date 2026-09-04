import type { Role } from "./types";

// Role rank mirrors the backend gate (builder-api #31): admin > editor > viewer.
// A dependency admits any role at or above its threshold.
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export const atLeast = (role: Role | undefined, min: Role): boolean =>
  role !== undefined && RANK[role] >= RANK[min];

// UI mirrors of the server checks — hide/disable what the server would 403 anyway.
export const canEdit = (role: Role | undefined): boolean => atLeast(role, "editor");
export const isAdmin = (role: Role | undefined): boolean => atLeast(role, "admin");
