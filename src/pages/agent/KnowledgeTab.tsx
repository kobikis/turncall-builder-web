import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import Uid from "../../components/Uid";
import { usePoll } from "../../usePoll";
import { useAgent } from "./AgentPage";
import { Doc } from "../../types";
import DocumentRetrieval from "./Retrieval";

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function KnowledgeTab() {
  const { agentId, draft } = useAgent();
  const { activeWorkspace } = useAuth();
  const [docs, setDocs] = useState<Doc[] | null>(null);

  const [error, setError] = useState("");
  const [busyDoc, setBusyDoc] = useState<string | null>(null); // doc id, or "upload"
  const [docQuery, setDocQuery] = useState(""); // filter the document list by name/id
  const [docSortDesc, setDocSortDesc] = useState(false); // by filename, ascending default
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<Doc | null>(null);

  const load = () =>
    api(`/agents/${agentId}/knowledge/documents`)
      .then((r) => setDocs(r.data.documents))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [agentId]);

  // Ingestion (extract/chunk/embed) runs in the background after upload, so a
  // fresh doc is 'processing' — poll until nothing is still processing.
  usePoll(load, 2000, !!docs?.some((d) => d.status === "processing"));

  // Filter by filename or id, then sort by filename.
  const visibleDocs = (docs || [])
    .filter((d) => {
      const s = docQuery.trim().toLowerCase();
      return !s || (d.filename || "").toLowerCase().includes(s) || d.id.toLowerCase().includes(s);
    })
    .sort((a, b) => (docSortDesc ? -1 : 1) * (a.filename || "").localeCompare(b.filename || ""));

  async function upload(file: File) {
    setError("");
    setBusyDoc("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", "prompt");
      await api(`/agents/${agentId}/knowledge/documents`, { method: "POST", body: form });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusyDoc(null);
    }
  }

  async function replaceDoc(doc: Doc, file: File) {
    setError("");
    setBusyDoc(doc.id);
    try {
      // Upload the new document FIRST; only delete the old one once it succeeds.
      // Deleting first would destroy the live document if the upload (the
      // failure-prone extract/chunk/embed leg) then failed.
      const form = new FormData();
      form.append("file", file);
      // The new version is read the way the old one was.
      form.append("mode", doc.retrieval?.mode ?? "prompt");
      await api(`/agents/${agentId}/knowledge/documents`, { method: "POST", body: form });
      await api(`/agents/${agentId}/knowledge/documents/${doc.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Replace failed.");
      await load(); // reflect whatever actually persisted
    } finally {
      setBusyDoc(null);
    }
  }

  async function deleteDoc(doc: Doc) {
    if (!confirm(`Delete "${doc.filename}"? The agent stops knowing its contents.`)) return;
    setError("");
    setBusyDoc(doc.id);
    try {
      await api(`/agents/${agentId}/knowledge/documents/${doc.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusyDoc(null);
    }
  }

  return (
    <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            Documents the agent answers from — menus, FAQs, policies.
          </p>
          <button className="btn btn-primary" onClick={() => uploadRef.current?.click()} disabled={busyDoc !== null}>
            {busyDoc === "upload" ? "Uploading…" : "+ Upload document"}
          </button>
          <input
            ref={uploadRef}
            type="file"
            hidden
            accept=".pdf,.txt,.md,.docx,.csv,.json,.yaml,.yml,.xml,.tsv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </div>
        {error && <p role="alert" className="error-text">{error}</p>}
        <input
          className="input"
          style={{ marginBottom: 10, maxWidth: 360 }}
          aria-label="Search documents by name or id"
          value={docQuery}
          onChange={(e) => setDocQuery(e.target.value)}
          placeholder="Search by document name or id"
        />
        <table className="list">
          <thead>
            <tr>
              <th>
                <button
                  className="row-toggle"
                  onClick={() => setDocSortDesc((v) => !v)}
                  aria-label={`Sort by document name, ${docSortDesc ? "descending" : "ascending"} — click to reverse`}
                >
                  Document <span className="caret" aria-hidden="true">{docSortDesc ? "▾" : "▴"}</span>
                </button>
              </th>
              <th>Read as</th><th>Size</th><th>ID</th><th>Status</th><th>Added</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleDocs.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
                  {d.filename}
                  {d.error_message && <div className="error-text">{d.error_message}</div>}
                </td>
                <td>
                  <DocumentRetrieval
                    agentId={agentId}
                    doc={d}
                    speechToSpeech={(draft?.pipeline_mode || "cascade") === "s2s"}
                    editable={canEdit(activeWorkspace?.role)}
                    onChange={(retrieval) =>
                      setDocs((all) => (all || []).map((x) => (x.id === d.id ? { ...x, retrieval } : x)))
                    }
                  />
                </td>
                <td className="num" title={`${d.chunk_count} chunks`}>
                  {d.char_count ? d.char_count.toLocaleString() : "—"}
                </td>
                <td><Uid id={d.id} label="document_id" /></td>
                <td><span className={`badge ${d.status === "ready" ? "running" : d.status === "failed" ? "failed" : d.status === "processing" ? "generating" : ""}`}>{d.status}</span></td>
                <td className="num">{dateFmt.format(new Date(d.created_at))}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    className="btn"
                    style={{ padding: "3px 10px" }}
                    disabled={busyDoc !== null}
                    onClick={() => {
                      replaceTarget.current = d;
                      replaceRef.current?.click();
                    }}
                  >
                    {busyDoc === d.id ? "…" : "replace"}
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ padding: "3px 10px", marginLeft: 8 }}
                    disabled={busyDoc !== null}
                    onClick={() => deleteDoc(d)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
            {docs === null && !error && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
            )}
            {docs?.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No documents yet — upload FAQs, policies, product docs.</td></tr>
            )}
            {docs && docs.length > 0 && visibleDocs.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No documents match “{docQuery}”.</td></tr>
            )}
          </tbody>
        </table>
        <input
          ref={replaceRef}
          type="file"
          hidden
          accept=".pdf,.txt,.md,.docx,.csv,.json,.yaml,.yml,.xml,.tsv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && replaceTarget.current) replaceDoc(replaceTarget.current, f);
          }}
        />
      </div>

    </div>
  );
}
