// Shared wire types for the builder API. One source of truth so a backend field
// rename breaks the build, not runtime — pages previously redeclared these and
// drifted (e.g. Agent).

// Every builder response is a { success, data } envelope.
export type ApiResponse<T> = { success: boolean; data: T; detail?: string };

// Identity + tenancy (builder-api #29/#31/#33).
export type User = { id: string; email: string };
export type Role = "admin" | "editor" | "viewer";
export type Workspace = { id: string; name: string; role: Role };
export type Member = { user_id: string; email: string; role: Role };
export type Invite = { id: string; email: string; role: Role; token: string };

export type Backend = {
  port: number;
  status: string; // running | degraded | failed | stopped | generating | deleted
  browser_url?: string;
  logs?: string;
  error?: string;
};

export type Agent = {
  agent_id: string;
  name: string;
  port: number;
  status: string;
  browser_url?: string;
};

// Minimal agent shape for pickers (the /agents list without runtime fields).
export type AgentRef = { agent_id: string; name: string };

export type ToolStatuses = Record<string, "generated" | "stub" | "external">;

export type Call = {
  id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  provider_call_sid: string | null;
  status: string;
  started_at: string | null;
  duration_ms: number | null;
  recording_status: string;
  analysis: Record<string, unknown> | null;
};

export type Doc = {
  id: string;
  filename: string;
  content_type: string;
  char_count: number;
  chunk_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
};

export type Takeaway = {
  id: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  prompt: string | null;
  model: string | null;
};

export type PhoneNumber = {
  id: string;
  e164: string;
  routing_type: string;
  agent_id: string | null;
  server_url: string | null;
  sms_enabled: boolean;
};
