// A lip-synced video avatar (#63) — TurnCall's `avatar` block. It taps the TTS
// stage, so it exists on cascade agents only, and shows on WebRTC calls (the
// console's voice test); a phone call has no video and skips it.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { PickControl, type Opt } from "./PickControl";
import { withField } from "./SettingFields";

type Provider = "heygen" | "tavus";

type AvatarValue = {
  enabled: boolean;
  provider: Provider;
  avatar_id?: string;
  is_sandbox?: boolean;
  replica_id?: string;
};

// Where each provider keeps its Avatar's ID, and what the section calls it:
// Tavus's ID field keeps its own word, replica.
const PROVIDERS: Record<Provider, { idKey: "avatar_id" | "replica_id"; label: string; anId: string }> = {
  heygen: { idKey: "avatar_id", label: "Avatar ID", anId: "an Avatar ID" },
  tavus: { idKey: "replica_id", label: "Replica ID", anId: "a replica ID" },
};

// LiveAvatar's sandbox serves this one Avatar and refuses a sandbox session
// with any other, so Sandbox fixes the ID rather than leaving it to choose.
export const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

// TurnCall reads an unset is_sandbox as on.
const inSandbox = (avatar: AvatarValue | undefined) =>
  avatar?.enabled && avatar.provider === "heygen" && avatar.is_sandbox !== false;

// Why this Avatar's ID cannot be saved, or "". TurnCall accepts a block with
// no ID, and a sandbox block with any ID, but neither Avatar starts, so the
// Console refuses them at Save (AgentPage) and says why here. A block stored
// before the Console fixed the sandbox ID can hold another one, or none; the
// section offers the sandbox Avatar back. Off is no block, and nothing to refuse.
export function avatarIdProblem(avatar: AvatarValue | undefined): string {
  if (!avatar?.enabled) return "";
  if (inSandbox(avatar) && avatar.avatar_id !== SANDBOX_AVATAR_ID) {
    return "The sandbox runs only its own Avatar — use it, or untick Sandbox to choose another.";
  }
  const { idKey, anId } = PROVIDERS[avatar.provider];
  if (avatar[idKey]?.trim()) return "";
  return `Choose ${anId} — an Avatar cannot be saved without one.`;
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
  const sandbox = !!inSandbox(value);
  const avatars = useAvatars(provider);
  const missing = avatarIdProblem(value);
  const set = (patch: Partial<AvatarValue>) =>
    onChange({ enabled: true, provider: value?.provider || "heygen", ...value, ...patch });
  const chooseSandboxAvatar = () => set({ is_sandbox: true, avatar_id: SANDBOX_AVATAR_ID });

  return (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-avatar-p">Video avatar</label>
          <select id="cfg-avatar-p" className="input" value={provider} disabled={!editable}
            onChange={(e) => {
              const p = e.target.value as Provider | "";
              // Absence is "off"; a switched provider starts from a clean block —
              // HeyGen's in the sandbox, which needs nothing but a key.
              if (!p) return onChange(undefined);
              onChange(p === "heygen"
                ? { enabled: true, provider: p, is_sandbox: true, avatar_id: SANDBOX_AVATAR_ID }
                : { enabled: true, provider: p });
            }}>
            <option value="">off</option>
            <option value="heygen">HeyGen (LiveAvatar)</option>
            <option value="tavus">Tavus</option>
          </select>
        </div>
        {provider && (
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cfg-avatar-id">{PROVIDERS[provider].label}</label>
            {sandbox ? (
              <input id="cfg-avatar-id" className="input" value={value?.avatar_id || ""} readOnly />
            ) : (
              <PickControl id="cfg-avatar-id" value={value?.[PROVIDERS[provider].idKey] || ""} options={avatars}
                disabled={!editable} placeholder={`Paste ${PROVIDERS[provider].anId}`}
                other={`Type ${PROVIDERS[provider].anId}…`}
                onChange={(v) => set({ [PROVIDERS[provider].idKey]: v.trim() || undefined })} />
            )}
          </div>
        )}
      </div>
      {provider === "heygen" && (
        <label>
          <input type="checkbox" checked={sandbox} disabled={!editable}
            onChange={(e) => {
              if (e.target.checked) return chooseSandboxAvatar();
              // The sandbox Avatar is refused outside the sandbox, so it goes with it.
              const kept = value?.avatar_id === SANDBOX_AVATAR_ID ? undefined : value?.avatar_id;
              onChange(withField<AvatarValue>({ ...value, enabled: true, provider: "heygen", is_sandbox: false }, "avatar_id", kept));
            }} />{" "}
          Sandbox
        </label>
      )}
      {missing && (
        <p className="error-text" style={{ margin: "4px 0 0" }}>
          {missing}
          {sandbox && editable && (
            <>{" "}<button type="button" className="btn" onClick={chooseSandboxAvatar}>Use the sandbox Avatar</button></>
          )}
        </p>
      )}
      <p className="hint" style={{ margin: "4px 0 0" }}>
        {sandbox && "A sandbox Avatar runs short, about a minute, on free sessions. "}
        An Avatar shows only on browser calls, such as this Console's voice test; phone calls have no
        video and skip it. It needs separate hearing, thinking and speaking stages, which a
        speech-to-speech Agent does not have.
      </p>
    </>
  );
}
