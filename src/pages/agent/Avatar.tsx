// A lip-synced video avatar (#63) — TurnCall's `avatar` block. It taps the TTS
// stage, so it exists on cascade agents only, and shows on WebRTC calls (the
// console's voice test); a phone call has no video and skips it.
type AvatarValue = {
  enabled: boolean;
  provider: "heygen" | "tavus";
  avatar_id?: string;
  is_sandbox?: boolean;
  replica_id?: string;
};

export function Avatar({ value, editable, onChange }: {
  value: AvatarValue | undefined;
  editable: boolean;
  onChange: (next: AvatarValue | undefined) => void;
}) {
  const provider = value?.enabled ? value.provider : "";
  const idKey = provider === "tavus" ? "replica_id" : "avatar_id";
  const set = (patch: Partial<AvatarValue>) =>
    onChange({ enabled: true, provider: value?.provider || "heygen", ...value, ...patch });

  return (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-avatar-p">Video avatar</label>
          <select id="cfg-avatar-p" className="input" value={provider} disabled={!editable}
            onChange={(e) => {
              const p = e.target.value;
              // Absence is "off"; a switched provider starts from a clean block.
              onChange(p ? { enabled: true, provider: p as AvatarValue["provider"] } : undefined);
            }}>
            <option value="">off</option>
            <option value="heygen">HeyGen (LiveAvatar)</option>
            <option value="tavus">Tavus</option>
          </select>
        </div>
        {provider && (
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cfg-avatar-id">{provider === "tavus" ? "Replica ID" : "Avatar ID"}</label>
            <input id="cfg-avatar-id" className="input" value={value?.[idKey] || ""} disabled={!editable}
              onChange={(e) => set({ [idKey]: e.target.value.trim() || undefined })} />
          </div>
        )}
      </div>
      {provider === "heygen" && (
        <label>
          <input type="checkbox" checked={value?.is_sandbox !== false} disabled={!editable}
            onChange={(e) => set({ is_sandbox: e.target.checked })} />{" "}
          Sandbox
        </label>
      )}
      <p className="hint" style={{ margin: "4px 0 0" }}>
        Shows on WebRTC calls — this console's voice test. Phone calls have no video and skip it.
      </p>
    </>
  );
}
