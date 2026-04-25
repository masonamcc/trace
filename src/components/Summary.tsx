import { useState, useEffect } from "react";

interface Props {
  cards: string[];
  loading: boolean;
  onPost?: (text: string) => Promise<"posted" | "queued">;
  onPostThread?: () => Promise<void>;
  xEnabled?: boolean;
}

const CARD_ACCENTS = [
  { border: "#4f46e5", glow: "rgba(79,70,229,0.12)" },
  { border: "#0891b2", glow: "rgba(8,145,178,0.12)" },
  { border: "#7c3aed", glow: "rgba(124,58,237,0.12)" },
];

const X_LIMIT = 280;

type CardStatus =
  | { type: "idle" }
  | { type: "posting" }
  | { type: "success" }
  | { type: "queued" }
  | { type: "error"; message: string };

export default function Summary({ cards, loading, onPost, onPostThread, xEnabled }: Props) {
  const [texts, setTexts] = useState<string[]>(cards);
  const [statuses, setStatuses] = useState<CardStatus[]>(cards.map(() => ({ type: "idle" })));
  const [threadPosting, setThreadPosting] = useState(false);

  useEffect(() => {
    setTexts(cards);
    setStatuses(cards.map(() => ({ type: "idle" })));
  }, [cards]);

  function setStatus(index: number, status: CardStatus) {
    setStatuses((prev) => prev.map((s, i) => (i === index ? status : s)));
  }

  async function handlePost(text: string, index: number) {
    if (!onPost) return;
    setStatus(index, { type: "posting" });
    try {
      const result = await onPost(text);
      if (result === "queued") {
        setStatus(index, { type: "queued" });
        setTimeout(() => setStatus(index, { type: "idle" }), 2000);
      } else {
        setStatus(index, { type: "success" });
        setTimeout(() => setStatus(index, { type: "idle" }), 3000);
      }
    } catch (e) {
      setStatus(index, { type: "error", message: String(e) });
      setTimeout(() => setStatus(index, { type: "idle" }), 6000);
    }
  }

  if (loading) {
    return (
      <div style={styles.grid}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...styles.card, ...styles.skeleton }}>
            <div style={styles.skeletonLine} />
            <div style={{ ...styles.skeletonLine, width: "80%" }} />
            <div style={{ ...styles.skeletonLine, width: "60%" }} />
          </div>
        ))}
      </div>
    );
  }

  async function handlePostThread() {
    if (!onPostThread) return;
    setThreadPosting(true);
    try {
      await onPostThread();
    } finally {
      setThreadPosting(false);
    }
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={styles.grid}>
      {texts.map((text, i) => {
        const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
        const over = text.length > X_LIMIT;
        const status = statuses[i] ?? { type: "idle" };
        const busy = status.type === "posting";

        return (
          <div
            key={i}
            style={{
              ...styles.card,
              borderColor: accent.border,
              boxShadow: `0 0 0 1px ${accent.border}22, 0 4px 24px ${accent.glow}`,
            }}
          >
            <textarea
              style={styles.textarea}
              value={text}
              onChange={(e) => {
                const next = [...texts];
                next[i] = e.target.value;
                setTexts(next);
              }}
              rows={5}
            />

            {status.type === "error" && (
              <div style={styles.errorBanner}>{status.message}</div>
            )}

            <div style={styles.footer}>
              <span style={{ ...styles.counter, ...(over ? styles.counterOver : {}) }}>
                {text.length} / {X_LIMIT}
              </span>
              <div style={styles.actions}>
                <button
                  style={styles.actionBtn}
                  onClick={() => navigator.clipboard.writeText(text)}
                >
                  Copy
                </button>
                {xEnabled && onPost && (
                  <button
                    style={{
                      ...styles.actionBtn,
                      ...styles.postBtn,
                      ...(status.type === "success" ? styles.postBtnSuccess : {}),
                      ...(status.type === "queued"  ? styles.postBtnQueued  : {}),
                      ...(status.type === "error"   ? styles.postBtnError   : {}),
                      ...((busy || over)            ? styles.postBtnDisabled : {}),
                    }}
                    disabled={busy || over}
                    onClick={() => handlePost(text, i)}
                  >
                    {status.type === "posting" && "Posting…"}
                    {status.type === "success" && "✓ Posted"}
                    {status.type === "queued"  && "Queued"}
                    {status.type === "error"   && "Failed"}
                    {status.type === "idle"    && "Post to X"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
    {xEnabled && onPostThread && texts.length > 1 && (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          style={styles.threadBtn}
          disabled={threadPosting || texts.some((t) => t.length === 0 || t.length > X_LIMIT)}
          onClick={handlePostThread}
        >
          {threadPosting ? "Posting…" : "Post as thread"}
        </button>
      </div>
    )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 14,
  },
  card: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 14px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    transition: "box-shadow 0.2s",
  },
  textarea: {
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "vertical",
    color: "var(--text)",
    fontSize: 14,
    lineHeight: 1.65,
    fontFamily: "inherit",
    width: "100%",
    padding: 0,
    minHeight: 80,
  } as React.CSSProperties,
  errorBanner: {
    background: "#2a0a0a",
    border: "1px solid #5a1a1a",
    borderRadius: 6,
    color: "#f87171",
    padding: "7px 10px",
    fontSize: 12,
    lineHeight: 1.4,
    wordBreak: "break-word",
  } as React.CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  counter: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 },
  counterOver: { color: "#ef4444", fontWeight: 600 },
  actions: { display: "flex", gap: 6 },
  actionBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "3px 10px",
    cursor: "pointer",
  },
  postBtn: { borderColor: "rgba(29,161,242,0.4)", color: "#1da1f2" },
  postBtnSuccess: { borderColor: "rgba(34,197,94,0.4)", color: "#22c55e" },
  postBtnQueued:  { borderColor: "rgba(234,179,8,0.4)",  color: "#eab308" },
  postBtnError:   { borderColor: "rgba(239,68,68,0.4)",  color: "#ef4444" },
  postBtnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  threadBtn: {
    background: "none",
    border: "1px solid rgba(29,161,242,0.4)",
    borderRadius: 6,
    color: "#1da1f2",
    fontSize: 12,
    padding: "5px 14px",
    cursor: "pointer",
  },
  skeleton: { gap: 10, pointerEvents: "none" },
  skeletonLine: {
    height: 13,
    borderRadius: 4,
    background: "var(--border)",
    width: "100%",
    animation: "pulse 1.4s ease-in-out infinite",
  },
};
