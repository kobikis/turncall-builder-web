// A lip-synced video avatar (#63) — TurnCall's `avatar` block. It taps the TTS
// stage, so it exists on cascade agents only, and shows on WebRTC calls (the
// console's voice test); a phone call has no video and skips it.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { PickControl, type Opt } from "./PickControl";

type AvatarValue = {
  enabled: boolean;
  provider: "heygen" | "tavus";
  avatar_id?: string;
  is_sandbox?: boolean;
  replica_id?: string;
};

// The Avatars the Workspace's account has, by name. Empty with no key or a
// refused one, which leaves the ID free to type. The list is kept with the
// provider it came from, so a switched provider never offers the other
// account's Avatars while its own list loads.
function useAvatars(provider: string): Opt[] {
  const [list, setList] = useState<{ provider: string; avatars: Opt[] }>({ provider: "", avatars: [] });
  useEffect(() => {
    if (!provider) return;
    let ok = true;
    api(`/providers/avatar/${provider}/avatars`)
      .then((r) => ok && setList({ provider, avatars: r.data.avatars || [] }))
      .catch(() => ok && setList({ provider, avatars: [] }));
    return () => {
      ok = false;
    };
  }, [provider]);
  return list.provider === provider ? list.avatars : [];
}

export function Avatar({ value, editable, onChange }: {
  value: AvatarValue | undefined;
  editable: boolean;
  onChange: (next: AvatarValue | undefined) => void;
}) {
  const provider = value?.enabled ? value.provider : "";
  const idKey = provider === "tavus" ? "replica_id" : "avatar_id";
  const avatars = useAvatars(provider);
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
            <PickControl id="cfg-avatar-id" value={value?.[idKey] || ""} options={avatars} disabled={!editable}
              placeholder={provider === "tavus" ? "Paste a replica ID" : "Paste an Avatar ID"}
              onChange={(v) => set({ [idKey]: v.trim() || undefined })} />
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
