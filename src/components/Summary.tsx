interface Props {
  cards: string[];
  loading: boolean;
}

const CARD_ACCENTS = [
  { border: "#4f46e5", glow: "rgba(79,70,229,0.12)" },
  { border: "#0891b2", glow: "rgba(8,145,178,0.12)" },
  { border: "#7c3aed", glow: "rgba(124,58,237,0.12)" },
];

export default function Summary({ cards, loading }: Props) {
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

  if (cards.length === 0) return null;

  return (
    <div style={styles.grid}>
      {cards.map((text, i) => {
        const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
        return (
          <div
            key={i}
            style={{
              ...styles.card,
              borderColor: accent.border,
              boxShadow: `0 0 0 1px ${accent.border}22, 0 4px 24px ${accent.glow}`,
            }}
          >
            <p style={styles.text}>{text}</p>
            <button
              style={styles.copy}
              onClick={() => navigator.clipboard.writeText(text)}
              title="Copy to clipboard"
            >
              Copy
            </button>
          </div>
        );
      })}
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
    padding: "18px 18px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    transition: "box-shadow 0.2s",
  },
  text: {
    fontSize: 14,
    lineHeight: 1.65,
    color: "var(--text)",
    flex: 1,
  },
  copy: {
    alignSelf: "flex-end",
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "3px 10px",
    cursor: "pointer",
  },
  skeleton: {
    gap: 10,
    pointerEvents: "none",
  },
  skeletonLine: {
    height: 13,
    borderRadius: 4,
    background: "var(--border)",
    width: "100%",
    animation: "pulse 1.4s ease-in-out infinite",
  },
};
