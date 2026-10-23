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

// LiveAvatar's sandbox serves this one Avatar and refuses a sandbox session
// with any other, so Sandbox fixes the ID rather than leaving it to choose.
export const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

// Why this Avatar cannot be saved, or "". TurnCall accepts a block with no ID,
// but no Avatar starts without one, so the Console refuses it at Save
// (AgentPage) and says why here. Off is no block, and nothing to refuse.
export function avatarIdMissing(avatar: AvatarValue | undefined): string {
  if (!avatar?.enabled) return "";
  const tavus = avatar.provider === "tavus";
  if ((tavus ? avatar.replica_id : avatar.avatar_id)?.trim()) return "";
  return `Choose ${tavus ? "a replica ID" : "an Avatar ID"} — an Avatar cannot be saved without one.`;
}

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
  // TurnCall reads an unset is_sandbox as on.
  const sandbox = provider === "heygen" && value?.is_sandbox !== false;
  const avatars = useAvatars(provider);
  const missing = avatarIdMissing(value);
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
              // Absence is "off"; a switched provider starts from a clean block —
              // HeyGen's in the sandbox, which needs nothing but a key.
              onChange(p === "heygen" ? { enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR_ID }
                : p ? { enabled: true, provider: p as AvatarValue["provider"] } : undefined);
            }}>
            <option value="">off</option>
            <option value="heygen">HeyGen (LiveAvatar)</option>
            <option value="tavus">Tavus</option>
          </select>
        </div>
        {provider && (
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cfg-avatar-id">{provider === "tavus" ? "Replica ID" : "Avatar ID"}</label>
            {sandbox ? (
              <input id="cfg-avatar-id" className="input" value={value?.avatar_id || ""} readOnly />
            ) : (
              <PickControl id="cfg-avatar-id" value={value?.[idKey] || ""} options={avatars} disabled={!editable}
                placeholder={provider === "tavus" ? "Paste a replica ID" : "Paste an Avatar ID"}
                onChange={(v) => set({ [idKey]: v.trim() || undefined })} />
            )}
          </div>
        )}
      </div>
      {provider === "heygen" && (
        <label>
          <input type="checkbox" checked={sandbox} disabled={!editable}
            onChange={(e) => {
              if (e.target.checked) return set({ is_sandbox: true, avatar_id: SANDBOX_AVATAR_ID });
              // The sandbox Avatar is refused outside the sandbox, so it goes with it.
              const { avatar_id, ...rest } = value!;
              onChange(avatar_id === SANDBOX_AVATAR_ID ? { ...rest, is_sandbox: false } : { ...value!, is_sandbox: false });
            }} />{" "}
          Sandbox
        </label>
      )}
      {missing && <p className="error-text" style={{ margin: "4px 0 0" }}>{missing}</p>}
      <p className="hint" style={{ margin: "4px 0 0" }}>
        {sandbox && "A sandbox Avatar runs short, about a minute, on free sessions. "}
        An Avatar shows only on browser calls, such as this Console's voice test; phone calls have no
        video and skip it. It needs separate hearing, thinking and speaking stages, which a
        speech-to-speech Agent does not have.
      </p>
    </>
  );
}
