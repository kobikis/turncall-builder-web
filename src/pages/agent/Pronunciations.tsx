// tts.pronunciations (#63): word -> IPA, one per line as `word: ipa`. TurnCall
// validates the IPA (a 422 naming the word) and reports, on the agent read,
// entries that will not take effect — a spelling instead of IPA, or a voice
// that cannot read the markup. Those warnings are shown here, next to the words.
import { useState } from "react";

type Map = Record<string, string>;

const toText = (m: Map | undefined) =>
  Object.entries(m || {}).map(([w, ipa]) => `${w}: ${ipa}`).join("\n");

/** Lines without a word or an IPA are skipped rather than sent half-written. */
export function parsePronunciations(text: string): Map | undefined {
  const entries = text
    .split("\n")
    .map((line) => {
      const at = line.indexOf(":");
      return at < 0 ? ["", ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    })
    .filter(([w, ipa]) => w && ipa);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function Pronunciations({ value, warnings, editable, onChange }: {
  value: Map | undefined;
  warnings: string[];
  editable: boolean;
  onChange: (next: Map | undefined) => void;
}) {
  // Local text, so a half-typed line is not reformatted away under the cursor.
  const [text, setText] = useState(() => toText(value));
  return (
    <div className="field">
      <label htmlFor="cfg-tts-pron">Pronunciations</label>
      <textarea
        id="cfg-tts-pron"
        className="input code"
        style={{ minHeight: 70 }}
        value={text}
        placeholder={"Metformin: mɛtˈfɔɹmɪn"}
        disabled={!editable}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parsePronunciations(e.target.value));
        }}
      />
      <p className="hint" style={{ margin: "4px 0 0" }}>
        One <code>word: IPA</code> per line. Not every voice can read it: ElevenLabs needs a phoneme-capable model, OpenAI has none.
      </p>
      {warnings.map((w) => <p key={w} className="callout warn">{w}</p>)}
    </div>
  );
}
