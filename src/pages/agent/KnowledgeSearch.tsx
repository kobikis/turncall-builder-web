import { useState } from "react";
import { api } from "../../api";
import { useAgent } from "./AgentPage";

type SearchResult = { content: string; similarity: number; document_id: string };

// Check a topic is covered and findable — across every document. Lives in the
// Build page's right rail while the Knowledge section is open.
export default function KnowledgeSearch() {
  const { agentId } = useAgent();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setResults(null);
    setError("");
    try {
      const r = await api(`/agents/${agentId}/knowledge/search`, {
        method: "POST",
        body: JSON.stringify({ query: query.trim() }),
      });
      setResults(r.data.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Search the documents to check a topic is covered and findable.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Search the knowledge base"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) search();
          }}
          placeholder="e.g. what are your opening hours?"
        />
        <button className="btn" onClick={search} disabled={searching || !query.trim()}>
          {searching ? "…" : "Search"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div style={{ flex: 1, overflowY: "auto", marginTop: 4 }}>
        {results?.length === 0 && <p className="muted">No matches — nothing in the documents is similar to this.</p>}
        {(results || []).map((r, idx) => (
          <div key={idx} className="search-result">
            <div className="score">similarity {r.similarity.toFixed(3)}</div>
            {r.content}
          </div>
        ))}
      </div>
    </div>
  );
}
