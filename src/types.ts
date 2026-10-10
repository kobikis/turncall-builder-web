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

// What an agent has been doing, fetched after the list so a slow or absent
// TurnCall never delays the page's first paint (builder-api /agents/activity).
export type AgentActivity = {
  agent_id: string;
  number: string | null;
  hours: number[];
  calls_24h: number;
  truncated: boolean;
  available: boolean;
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
  // Derived by TurnCall on every read (turncall#175, #179); null while live,
  // and the agent pair is null for an inline agent.
  ended_reason?: string | null;
  agent_name?: string | null;
  agent_version?: number | null;
  latency_summary?: LatencySummary | null;
};

export type Spread = { p50_ms: number; p95_ms: number; count: number };

export type LatencySummary = {
  turns: number;
  user_to_bot: Spread;
  stages: Partial<Record<"stt" | "llm" | "tts", Spread>>;
  slowest_turn: { turn: number; user_to_bot_ms: number };
};

// How the agent reads a document: whole in every reply, searched each turn,
// or searched when the model decides (TurnCall's knowledge-base link modes).
export type RetrievalMode = "prompt" | "auto" | "tool";
export type RetrievalSetting = { mode: RetrievalMode; top_k?: number; tool_description?: string | null };

export type Doc = {
  id: string;
  knowledge_base_id?: string;
  retrieval?: RetrievalSetting | null;
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
  label?: string | null;
  // "twilio" | "telnyx" | "asterisk"; a row from before #65 reads as twilio.
  carrier?: string;
  id: string;
  e164: string;
  routing_type: string;
  agent_id: string | null;
  server_url: string | null;
  sms_enabled: boolean;
};
