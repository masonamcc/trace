import { useState } from "react";
import { Event, Session } from "../types";

function buildSessions(events: Event[]): Session[] {
  if (events.length === 0) return [];

  const sessions: Session[] = [];
  let current: Session | null = null;

  for (const ev of events) {
    const label =
      ev.source === "chrome"
        ? (ev.page_title ?? ev.url ?? "Browser")
        : (ev.app ?? "Unknown");

    const detail =
      ev.source === "chrome"
        ? (ev.url ?? "")
        : (ev.window_title ?? "");

    const key = ev.source === "chrome"
      ? getDomain(ev.url)
      : ev.app ?? "Unknown";

    if (current && current.label.split(" — ")[0] === key) {
      current.end = formatTime(ev.timestamp);
      current.eventCount++;
      current.detail = detail || current.detail;
    } else {
      if (current) sessions.push(current);
      current = {
        start: formatTime(ev.timestamp),
        end: formatTime(ev.timestamp),
        label,
        detail,
        source: ev.source as "desktop" | "chrome",
        eventCount: 1,
      };
    }
  }

  if (current) sessions.push(current);
  return sessions;
}

function getDomain(url?: string): string {
  if (!url) return "Browser";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Browser";
  }
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(dateStr: string, today: string): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  if (dateStr === today) return "Today";
  if (dateStr === yStr) return "Yesterday";

  return new Date(dateStr + "T12:00:00").toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
  });
}

interface Props {
  eventsByDate: Record<string, Event[]>;
  today: string;
}

export default function Timeline({ eventsByDate, today }: Props) {
  const dates = Object.keys(eventsByDate).sort((a, b) => b.localeCompare(a));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([today]));

  const toggle = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  if (dates.length === 0) {
    return <div style={styles.empty}>No activity recorded.</div>;
  }

  return (
    <div style={styles.container}>
      {dates.map((date) => {
        const events = eventsByDate[date] ?? [];
        const sessions = buildSessions(events);
        const isExpanded = expanded.has(date);
        const label = formatDayLabel(date, today);
        const isToday = date === today;

        return (
          <div key={date} style={styles.dayGroup}>
            <button style={{ ...styles.dayHeader, ...(isToday ? styles.dayHeaderToday : {}) }} onClick={() => toggle(date)}>
              <span style={styles.dayChevron}>{isExpanded ? "▾" : "▸"}</span>
              <span style={{ ...styles.dayLabel, ...(isToday ? styles.dayLabelToday : {}) }}>{label}</span>
              <span style={styles.dayCount}>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
            </button>

            {isExpanded && (
              <div style={styles.list}>
                {sessions.length === 0 ? (
                  <div style={styles.emptyDay}>No activity recorded.</div>
                ) : (
                  sessions.map((s, i) => (
                    <div key={i} style={styles.session}>
                      <div style={styles.timeCol}>
                        <span style={styles.timeStart}>{s.start}</span>
                        {s.start !== s.end && (
                          <>
                            <span style={styles.timeSep}>–</span>
                            <span style={styles.timeEnd}>{s.end}</span>
                          </>
                        )}
                      </div>
                      <div
                        style={{
                          ...styles.dot,
                          background: s.source === "chrome" ? "var(--browser)" : "var(--desktop)",
                        }}
                      />
                      <div style={styles.content}>
                        <div style={styles.badge}>
                          <span
                            style={{
                              ...styles.badgeInner,
                              background: s.source === "chrome" ? "var(--browser-dim)" : "var(--desktop-dim)",
                              color: s.source === "chrome" ? "var(--browser)" : "var(--desktop)",
                            }}
                          >
                            {s.source === "chrome" ? "Browser" : "App"}
                          </span>
                        </div>
                        <div style={styles.label}>{s.label}</div>
                        {s.detail && s.detail !== s.label && (
                          <div style={styles.detail} title={s.detail}>
                            {s.detail.length > 80 ? s.detail.slice(0, 80) + "…" : s.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  empty: {
    color: "var(--text-muted)",
    textAlign: "center",
    padding: "48px 0",
    fontSize: 15,
  },
  emptyDay: {
    color: "var(--text-muted)",
    fontSize: 13,
    padding: "12px 0 8px",
  },
  dayGroup: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  dayHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 14px",
    background: "var(--surface-2)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } as React.CSSProperties,
  dayHeaderToday: {
    background: "var(--surface)",
  },
  dayChevron: {
    color: "var(--text-muted)",
    fontSize: 12,
    flexShrink: 0,
    width: 12,
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
    flex: 1,
  },
  dayLabelToday: {
    color: "var(--text)",
  },
  dayCount: {
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "0 14px",
  },
  session: {
    display: "grid",
    gridTemplateColumns: "80px 12px 1fr",
    alignItems: "start",
    gap: "0 12px",
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  },
  timeCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    paddingTop: 2,
    gap: 2,
  },
  timeStart: { color: "var(--text)", fontVariantNumeric: "tabular-nums", fontSize: 12 },
  timeSep: { color: "var(--text-muted)", fontSize: 10 },
  timeEnd: { color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", fontSize: 11 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    marginTop: 4,
    flexShrink: 0,
  },
  content: { display: "flex", flexDirection: "column", gap: 3 },
  badge: { display: "flex" },
  badgeInner: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "1px 6px",
    borderRadius: 4,
  },
  label: { fontWeight: 500, fontSize: 14, color: "var(--text)" },
  detail: { fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all" },
};
