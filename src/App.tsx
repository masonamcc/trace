import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Timeline from "./components/Timeline";
import Summary from "./components/Summary";
import { Event } from "./types";

// ── Constants ──────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { id: "anthropic", label: "Claude",  company: "Anthropic", model: "claude-sonnet-4-6",   placeholder: "sk-ant-api03-…" },
  { id: "openai",    label: "GPT-4o",  company: "OpenAI",    model: "gpt-4o",               placeholder: "sk-proj-…" },
  { id: "gemini",    label: "Gemini",  company: "Google",    model: "gemini-2.0-flash",     placeholder: "AIzaSy…" },
  { id: "grok",      label: "Grok",    company: "xAI",       model: "grok-2-1212",          placeholder: "xai-…" },
  { id: "mistral",   label: "Mistral", company: "Mistral",   model: "mistral-small-latest", placeholder: "…" },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

const CLEAR_RANGES = [
  { label: "30 min",   minutes: 30 },
  { label: "1 hour",   minutes: 60 },
  { label: "2 hours",  minutes: 120 },
  { label: "5 hours",  minutes: 300 },
  { label: "12 hours", minutes: 720 },
  { label: "1 day",    minutes: 1440 },
  { label: "1 week",   minutes: 10080 },
  { label: "1 month",  minutes: 43200 },
];

const AUTO_CLEAR_OPTIONS = [{ label: "Off", minutes: 0 }, ...CLEAR_RANGES];

const EXCLUSION_CATEGORIES = [
  {
    id: "banking",
    label: "Banking & Finance",
    icon: "🏦",
    domains: [
      "paypal.com","chase.com","bankofamerica.com","wellsfargo.com","citibank.com",
      "usbank.com","capitalone.com","discover.com","americanexpress.com","venmo.com",
      "cashapp.com","robinhood.com","fidelity.com","schwab.com","etrade.com",
      "coinbase.com","binance.com","kraken.com","stripe.com",
    ],
  },
  {
    id: "medical",
    label: "Medical & Health",
    icon: "🏥",
    domains: [
      "webmd.com","mayoclinic.org","healthline.com","medscape.com","drugs.com",
      "rxlist.com","medlineplus.gov","nih.gov","mychart.com","zocdoc.com",
      "goodrx.com","everydayhealth.com","patient.co.uk",
    ],
  },
  {
    id: "nsfw",
    label: "Adult Content",
    icon: "🔞",
    domains: [
      "pornhub.com","xvideos.com","xnxx.com","redtube.com","youporn.com",
      "onlyfans.com","fansly.com",
    ],
  },
  {
    id: "legal",
    label: "Legal & Government",
    icon: "⚖️",
    domains: ["irs.gov","ssa.gov","dmv.org","legalzoom.com","court.gov"],
  },
] as const;

type CategoryId = typeof EXCLUSION_CATEGORIES[number]["id"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadKeys(): Record<ProviderId, string> {
  const keys = {} as Record<ProviderId, string>;
  for (const p of PROVIDERS) {
    if (p.id === "anthropic" && !localStorage.getItem("trace_api_key_anthropic")) {
      const legacy = localStorage.getItem("trace_api_key") ?? localStorage.getItem("mason_api_key");
      if (legacy) localStorage.setItem("trace_api_key_anthropic", legacy);
    }
    keys[p.id] = localStorage.getItem(`trace_api_key_${p.id}`) ?? "";
  }
  return keys;
}

function loadJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function App() {
  const [date, setDate] = useState(todayStr());
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");

  const [provider, setProvider] = useState<ProviderId>(
    () => (localStorage.getItem("trace_provider") as ProviderId) ?? "anthropic"
  );
  const [apiKeys, setApiKeys] = useState<Record<ProviderId, string>>(loadKeys);
  const [summaryStyle, setSummaryStyle] = useState(
    () => localStorage.getItem("trace_summary_style") ?? ""
  );

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "privacy" | "data">("ai");

  const [clearMenu, setClearMenu] = useState(false);
  const [clearConfirm, setClearConfirm] = useState<{ label: string; minutes: number } | null>(null);
  const [autoClearMinutes, setAutoClearMinutes] = useState(
    () => Number(localStorage.getItem("trace_auto_clear") ?? "0")
  );
  const [isPaused, setIsPaused] = useState(
    () => localStorage.getItem("trace_paused") === "true"
  );
  const [scheduleStart, setScheduleStart] = useState(
    () => localStorage.getItem("trace_schedule_start") ?? ""
  );
  const [scheduleEnd, setScheduleEnd] = useState(
    () => localStorage.getItem("trace_schedule_end") ?? ""
  );

  // Exclusions
  const [activeCategories, setActiveCategories] = useState<Set<CategoryId>>(
    () => new Set(loadJson<CategoryId[]>("trace_excl_categories", []))
  );
  const [categoryAdditions, setCategoryAdditions] = useState<Record<string, string[]>>(() => {
    const r: Record<string, string[]> = {};
    for (const c of EXCLUSION_CATEGORIES) r[c.id] = loadJson(`trace_excl_add_${c.id}`, []);
    return r;
  });
  const [categoryRemovals, setCategoryRemovals] = useState<Record<string, string[]>>(() => {
    const r: Record<string, string[]> = {};
    for (const c of EXCLUSION_CATEGORIES) r[c.id] = loadJson(`trace_excl_rm_${c.id}`, []);
    return r;
  });
  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(null);
  const [categoryInputs, setCategoryInputs] = useState<Record<string, string>>({});

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;
  const currentKey = apiKeys[provider] ?? "";

  // ── Effects ──────────────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEvents(await invoke<Event[]>("get_events", { date }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { setSummary([]); fetchEvents(); }, [fetchEvents]);

  useEffect(() => {
    if (date !== todayStr()) return;
    const id = setInterval(fetchEvents, 30_000);
    return () => clearInterval(id);
  }, [date, fetchEvents]);

  // Sync pause state to Rust on mount and change
  useEffect(() => {
    invoke("set_tracking_paused", { paused: isPaused }).catch(console.error);
  }, [isPaused]);

  // Sync schedule to Rust on mount and change
  useEffect(() => {
    invoke("set_tracking_schedule", {
      start: scheduleStart || null,
      end: scheduleEnd || null,
    }).catch(console.error);
  }, [scheduleStart, scheduleEnd]);

  useEffect(() => {
    if (autoClearMinutes === 0) return;
    const run = () => invoke("clear_older_than", { minutes: autoClearMinutes }).catch(console.error);
    run();
    const id = setInterval(run, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoClearMinutes]);

  useEffect(() => {
    const patterns: string[] = [];
    for (const cat of EXCLUSION_CATEGORIES) {
      if (!activeCategories.has(cat.id)) continue;
      const removals = new Set(categoryRemovals[cat.id] ?? []);
      patterns.push(
        ...cat.domains.filter((d) => !removals.has(d)),
        ...(categoryAdditions[cat.id] ?? []),
      );
    }
    invoke("set_exclusions", { patterns: [...new Set(patterns)] }).catch(console.error);
  }, [activeCategories, categoryAdditions, categoryRemovals]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function generateSummary() {
    if (!currentKey) { setShowSettings(true); return; }
    setSummaryLoading(true); setSummary([]); setError("");
    try {
      setSummary(await invoke<string[]>("get_daily_summary", {
        date, apiKey: currentKey, style: summaryStyle, provider,
      }));
    } catch (e) { setError(String(e)); }
    finally { setSummaryLoading(false); }
  }

  async function handleClearConfirm() {
    if (!clearConfirm) return;
    try { await invoke("clear_recent", { minutes: clearConfirm.minutes }); await fetchEvents(); }
    catch (e) { setError(String(e)); }
    setClearMenu(false); setClearConfirm(null);
  }

  function saveKey(pid: ProviderId, val: string) {
    setApiKeys((k) => ({ ...k, [pid]: val }));
    localStorage.setItem(`trace_api_key_${pid}`, val);
  }
  function saveProvider(pid: ProviderId) {
    setProvider(pid); localStorage.setItem("trace_provider", pid);
  }
  function saveSummaryStyle(val: string) {
    setSummaryStyle(val); localStorage.setItem("trace_summary_style", val);
  }
  function saveAutoClear(m: number) {
    setAutoClearMinutes(m); localStorage.setItem("trace_auto_clear", String(m));
  }

  function togglePause() {
    const next = !isPaused;
    setIsPaused(next);
    localStorage.setItem("trace_paused", String(next));
  }

  function saveSchedule(start: string, end: string) {
    setScheduleStart(start); localStorage.setItem("trace_schedule_start", start);
    setScheduleEnd(end);     localStorage.setItem("trace_schedule_end", end);
  }

  function toggleCategory(id: CategoryId) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("trace_excl_categories", JSON.stringify([...next]));
      return next;
    });
  }

  function toggleExpand(id: CategoryId) {
    setExpandedCategory((prev) => (prev === id ? null : id));
  }

  function addDomain(catId: string) {
    const raw = (categoryInputs[catId] ?? "").trim().toLowerCase().replace(/^www\./, "");
    if (!raw) return;
    setCategoryAdditions((prev) => {
      const list = prev[catId] ?? [];
      if (list.includes(raw)) return prev;
      const next = { ...prev, [catId]: [...list, raw] };
      localStorage.setItem(`trace_excl_add_${catId}`, JSON.stringify(next[catId]));
      return next;
    });
    setCategoryInputs((p) => ({ ...p, [catId]: "" }));
  }

  function removeDomain(catId: string, domain: string, kind: "default" | "added") {
    if (kind === "added") {
      setCategoryAdditions((prev) => {
        const next = { ...prev, [catId]: (prev[catId] ?? []).filter((d) => d !== domain) };
        localStorage.setItem(`trace_excl_add_${catId}`, JSON.stringify(next[catId]));
        return next;
      });
    } else {
      setCategoryRemovals((prev) => {
        const list = prev[catId] ?? [];
        if (list.includes(domain)) return prev;
        const next = { ...prev, [catId]: [...list, domain] };
        localStorage.setItem(`trace_excl_rm_${catId}`, JSON.stringify(next[catId]));
        return next;
      });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const desktopCount = events.filter((e) => e.source === "desktop").length;
  const browserCount = events.filter((e) => e.source === "chrome").length;
  const activeExclCount = activeCategories.size;

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>T</span>
          <span style={styles.logoText}>Trace</span>
        </div>
        <div style={styles.headerRight}>
          {activeExclCount > 0 && (
            <span style={styles.shieldBadge} title={`${activeExclCount} exclusion group(s) active`}>
              🛡 {activeExclCount}
            </span>
          )}
          <div style={styles.activeProvider}>
            {currentProvider.company} · {currentProvider.model}
          </div>
          <button
            style={{ ...styles.trackingPill, ...(isPaused ? styles.trackingPillPaused : {}) }}
            onClick={togglePause}
            title={isPaused ? "Click to resume tracking" : "Click to pause tracking"}
          >
            <span style={{
              ...styles.trackingDot,
              background: isPaused ? "#ef4444" : "#22c55e",
            }} />
            {isPaused ? "Paused" : "Tracking"}
          </button>
          <button style={styles.settingsBtn} onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
        </div>
      </header>

      {showSettings && (
        <div style={styles.settingsPanel}>
          <div style={styles.settingsTabs}>
            {(["ai", "privacy", "data"] as const).map((tab) => (
              <button
                key={tab}
                style={{ ...styles.settingsTab, ...(settingsTab === tab ? styles.settingsTabActive : {}) }}
                onClick={() => setSettingsTab(tab)}
              >
                {{ ai: "AI", privacy: "Privacy", data: "Data" }[tab]}
              </button>
            ))}
          </div>

          {/* ── AI tab ── */}
          {settingsTab === "ai" && (
            <div style={styles.tabContent}>
              <div style={styles.settingsRow}>
                <span style={styles.settingsLabel}>Provider</span>
                <div style={styles.providerTabs}>
                  {PROVIDERS.map((p) => (
                    <button key={p.id} onClick={() => saveProvider(p.id)}
                      style={{ ...styles.providerTab, ...(p.id === provider ? styles.providerTabActive : {}) }}>
                      {p.company}
                      {apiKeys[p.id] && <span style={styles.keyDot} />}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.settingsRow}>
                <span style={styles.settingsLabel}>API key</span>
                <input style={styles.settingsInput} type="password"
                  placeholder={currentProvider.placeholder} value={currentKey}
                  onChange={(e) => saveKey(provider, e.target.value)} />
              </div>
              <div style={styles.settingsRow}>
                <span style={styles.settingsLabel}>Summary style</span>
                <textarea style={styles.styleInput} rows={4} value={summaryStyle}
                  placeholder={"How should the summary be written?\n\nExamples:\n• Write like a dev journal — terse, technical, first person.\n• Bullet points only, no prose."}
                  onChange={(e) => saveSummaryStyle(e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Privacy tab ── */}
          {settingsTab === "privacy" && (
            <div style={styles.tabContent}>
              <p style={styles.tabHint}>
                Excluded domains are dropped at ingestion — never written to the database.
                Toggle a group on/off, expand to edit its domain list, or add your own.
              </p>

              {EXCLUSION_CATEGORIES.map((cat) => {
                const isEnabled = activeCategories.has(cat.id);
                const isExpanded = expandedCategory === cat.id;
                const removals = new Set(categoryRemovals[cat.id] ?? []);
                const additions = categoryAdditions[cat.id] ?? [];
                const visibleDefaults = cat.domains.filter((d) => !removals.has(d));
                const totalCount = visibleDefaults.length + additions.length;

                return (
                  <div key={cat.id} style={styles.catBlock}>
                    {/* Category header row */}
                    <div style={styles.catHeader}>
                      <button style={styles.expandArrow} onClick={() => toggleExpand(cat.id)}>
                        {isExpanded ? "▾" : "▸"}
                      </button>
                      <span style={styles.catIcon}>{cat.icon}</span>
                      <span style={styles.catLabel}>{cat.label}</span>
                      <span style={styles.catCount}>{totalCount} domains</span>
                      <button
                        style={{ ...styles.toggle, ...(isEnabled ? styles.toggleOn : {}), marginLeft: "auto" }}
                        onClick={() => toggleCategory(cat.id)}
                      >
                        <span style={{ ...styles.toggleThumb, ...(isEnabled ? styles.toggleThumbOn : {}) }} />
                      </button>
                    </div>

                    {/* Expanded domain list */}
                    {isExpanded && (
                      <div style={styles.catBody}>
                        <div style={styles.domainGrid}>
                          {visibleDefaults.map((d) => (
                            <span key={d} style={styles.chipDefault}>
                              {d}
                              <button style={styles.chipX} onClick={() => removeDomain(cat.id, d, "default")} title="Remove">×</button>
                            </span>
                          ))}
                          {additions.map((d) => (
                            <span key={d} style={styles.chipAdded}>
                              {d}
                              <button style={styles.chipX} onClick={() => removeDomain(cat.id, d, "added")} title="Remove">×</button>
                            </span>
                          ))}
                        </div>

                        <div style={styles.addRow}>
                          <input
                            style={styles.domainInput}
                            placeholder="Add domain, e.g. mint.com"
                            value={categoryInputs[cat.id] ?? ""}
                            onChange={(e) =>
                              setCategoryInputs((p) => ({ ...p, [cat.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && addDomain(cat.id)}
                          />
                          <button style={styles.addBtn} onClick={() => addDomain(cat.id)}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Data tab ── */}
          {settingsTab === "data" && (
            <div style={styles.tabContent}>
              <div style={styles.settingsRow}>
                <span style={styles.settingsLabel}>Auto-clear</span>
                <div style={styles.autoClearGroup}>
                  <select style={styles.select} value={autoClearMinutes}
                    onChange={(e) => saveAutoClear(Number(e.target.value))}>
                    {AUTO_CLEAR_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>{o.label}</option>
                    ))}
                  </select>
                  <span style={styles.autoClearHint}>
                    {autoClearMinutes === 0
                      ? "History is kept indefinitely."
                      : `Data older than ${AUTO_CLEAR_OPTIONS.find((o) => o.minutes === autoClearMinutes)?.label} is deleted automatically.`}
                  </span>
                </div>
              </div>

              <div style={styles.settingsRow}>
                <span style={styles.settingsLabel}>Schedule</span>
                <div style={styles.scheduleGroup}>
                  <div style={styles.scheduleInputRow}>
                    <span style={styles.scheduleLabel}>From</span>
                    <input
                      type="time"
                      style={styles.timeInput}
                      value={scheduleStart}
                      onChange={(e) => saveSchedule(e.target.value, scheduleEnd)}
                    />
                    <span style={styles.scheduleLabel}>to</span>
                    <input
                      type="time"
                      style={styles.timeInput}
                      value={scheduleEnd}
                      onChange={(e) => saveSchedule(scheduleStart, e.target.value)}
                    />
                    {(scheduleStart || scheduleEnd) && (
                      <button style={styles.clearScheduleBtn} onClick={() => saveSchedule("", "")}>
                        Clear
                      </button>
                    )}
                  </div>
                  <span style={styles.autoClearHint}>
                    {scheduleStart && scheduleEnd
                      ? `Only track between ${scheduleStart} and ${scheduleEnd}.`
                      : "No schedule — tracking runs whenever the app is open."}
                  </span>
                </div>
              </div>
            </div>
          )}

          <button style={styles.doneBtn} onClick={() => setShowSettings(false)}>Done</button>
        </div>
      )}

      <main style={styles.main}>
        <div style={styles.controls}>
          <input type="date" value={date} max={todayStr()}
            onChange={(e) => setDate(e.target.value)} style={styles.datePicker} />
          <button onClick={fetchEvents} disabled={loading}
            style={{ ...styles.btn, ...styles.btnGhost }}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <div style={styles.stats}>
            <span style={styles.statChip} data-type="desktop">{desktopCount} desktop</span>
            <span style={styles.statChip} data-type="browser">{browserCount} browser</span>
          </div>

          <div style={{ position: "relative" }}>
            <button onClick={() => { setClearMenu((v) => !v); setClearConfirm(null); }}
              style={{ ...styles.btn, ...styles.btnGhost, color: "var(--text-muted)" }}>
              Clear
            </button>
            {clearMenu && (
              <>
                <div style={styles.backdrop} onClick={() => { setClearMenu(false); setClearConfirm(null); }} />
                <div style={styles.clearDropdown}>
                  {clearConfirm ? (
                    <div style={styles.confirmBox}>
                      <p style={styles.confirmText}>
                        Delete events from the last <strong>{clearConfirm.label}</strong>?
                      </p>
                      <div style={styles.confirmBtns}>
                        <button style={styles.confirmCancel} onClick={() => setClearConfirm(null)}>Cancel</button>
                        <button style={styles.confirmDelete} onClick={handleClearConfirm}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={styles.dropdownHeader}>Clear last…</div>
                      {CLEAR_RANGES.map((r) => (
                        <button key={r.minutes} style={styles.dropdownItem} onClick={() => setClearConfirm(r)}>
                          {r.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <button onClick={generateSummary} disabled={summaryLoading || events.length === 0}
            style={{ ...styles.btn, ...styles.btnAccent, marginLeft: "auto" }}>
            {summaryLoading ? "Generating…" : "Generate Summary"}
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {(summary.length > 0 || summaryLoading) && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Summary</h2>
            <Summary cards={summary} loading={summaryLoading} />
          </section>
        )}

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>
            Activity —{" "}
            {new Date(date + "T12:00:00").toLocaleDateString([], {
              weekday: "long", month: "long", day: "numeric",
            })}
          </h2>
          <Timeline events={events} />
        </section>
      </main>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        [data-type="desktop"] { background: var(--desktop-dim); color: var(--desktop); }
        [data-type="browser"] { background: var(--browser-dim); color: var(--browser); }
        button:disabled { opacity: 0.45; cursor: default; }
      `}</style>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", display: "flex", flexDirection: "column" },

  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 24px", height: 52,
    borderBottom: "1px solid var(--border)", background: "var(--surface)",
    position: "sticky", top: 0, zIndex: 10,
  },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: {
    width: 28, height: 28, background: "var(--accent)", color: "#fff",
    borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: 15,
  },
  logoText: { fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  shieldBadge: { fontSize: 11, color: "var(--text-muted)" },
  activeProvider: { fontSize: 11, color: "var(--text-muted)" },
  trackingPill: {
    display: "flex", alignItems: "center", gap: 5,
    background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
    borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 500,
    color: "#22c55e", cursor: "pointer",
  } as React.CSSProperties,
  trackingPillPaused: {
    background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#ef4444",
  },
  trackingDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  settingsBtn: {
    background: "none", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text-muted)", fontSize: 12, padding: "4px 12px", cursor: "pointer",
  },

  settingsPanel: {
    display: "flex", flexDirection: "column",
    background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
    maxHeight: "65vh", overflowY: "auto",
  },
  settingsTabs: { display: "flex", padding: "0 24px", borderBottom: "1px solid var(--border)" },
  settingsTab: {
    background: "none", border: "none", borderBottom: "2px solid transparent",
    color: "var(--text-muted)", fontSize: 12, fontWeight: 500,
    padding: "10px 16px", cursor: "pointer", marginBottom: -1,
  },
  settingsTabActive: { color: "var(--text)", borderBottomColor: "var(--accent)" },
  tabContent: { display: "flex", flexDirection: "column", gap: 14, padding: "16px 24px" },
  tabHint: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 },

  settingsRow: { display: "flex", alignItems: "flex-start", gap: 16 },
  settingsLabel: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0, width: 110, paddingTop: 7 },
  providerTabs: { display: "flex", gap: 6, flexWrap: "wrap" },
  providerTab: {
    position: "relative", background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-muted)", fontSize: 12, padding: "5px 12px", cursor: "pointer",
  } as React.CSSProperties,
  providerTabActive: { background: "var(--accent-dim)", borderColor: "var(--accent)", color: "#fff" },
  keyDot: {
    position: "absolute", top: 4, right: 4, width: 5, height: 5,
    borderRadius: "50%", background: "#22c55e",
  } as React.CSSProperties,
  settingsInput: {
    flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", padding: "6px 10px",
    outline: "none", fontSize: 13, fontFamily: "inherit",
  },
  styleInput: {
    flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", padding: "8px 10px",
    outline: "none", resize: "vertical", lineHeight: 1.5,
    fontFamily: "inherit", fontSize: 13,
  } as React.CSSProperties,

  // Privacy
  catBlock: {
    border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
  },
  catHeader: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px", background: "var(--surface)",
  },
  expandArrow: {
    background: "none", border: "none", color: "var(--text-muted)",
    fontSize: 12, cursor: "pointer", padding: 0, width: 14, flexShrink: 0,
  },
  catIcon: { fontSize: 16, flexShrink: 0 },
  catLabel: { fontSize: 13, fontWeight: 500, color: "var(--text)" },
  catCount: { fontSize: 11, color: "var(--text-muted)" },
  toggle: {
    width: 36, height: 20, borderRadius: 10, background: "var(--border)",
    border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0,
  } as React.CSSProperties,
  toggleOn: { background: "var(--accent)" },
  toggleThumb: {
    position: "absolute", top: 3, left: 3, width: 14, height: 14,
    borderRadius: "50%", background: "#fff", transition: "left 0.2s",
  } as React.CSSProperties,
  toggleThumbOn: { left: 19 },
  catBody: {
    padding: "12px 14px", borderTop: "1px solid var(--border)",
    display: "flex", flexDirection: "column", gap: 10,
    background: "var(--bg)",
  },
  domainGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  chipDefault: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "var(--surface-2)", border: "1px solid var(--border)",
    borderRadius: 20, padding: "2px 8px 2px 10px", fontSize: 11, color: "var(--text-muted)",
  },
  chipAdded: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "var(--accent-dim)", border: "1px solid var(--accent)",
    borderRadius: 20, padding: "2px 8px 2px 10px", fontSize: 11, color: "#a5b4fc",
  },
  chipX: {
    background: "none", border: "none", color: "inherit",
    opacity: 0.6, fontSize: 13, cursor: "pointer", padding: 0, lineHeight: 1,
  },
  addRow: { display: "flex", gap: 8 },
  domainInput: {
    flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", padding: "5px 10px",
    outline: "none", fontSize: 12, fontFamily: "inherit",
  },
  addBtn: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", padding: "5px 12px",
    fontSize: 12, cursor: "pointer",
  },

  // Data tab
  autoClearGroup: { display: "flex", flexDirection: "column", gap: 6 },
  scheduleGroup: { display: "flex", flexDirection: "column", gap: 6 },
  scheduleInputRow: { display: "flex", alignItems: "center", gap: 8 },
  scheduleLabel: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 },
  timeInput: {
    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text)", padding: "5px 8px", fontSize: 12, fontFamily: "inherit",
    outline: "none", colorScheme: "dark",
  } as React.CSSProperties,
  clearScheduleBtn: {
    background: "none", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text-muted)", fontSize: 11, padding: "4px 10px", cursor: "pointer",
  },
  select: {
    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text)", padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
    outline: "none", colorScheme: "dark", width: 180,
  } as React.CSSProperties,
  autoClearHint: { fontSize: 11, color: "var(--text-muted)" },

  doneBtn: {
    alignSelf: "flex-end", margin: "0 24px 16px",
    background: "var(--accent)", color: "#fff", padding: "6px 18px",
    borderRadius: 6, fontWeight: 500, fontSize: 13, cursor: "pointer", border: "none",
  },

  main: {
    flex: 1, padding: "24px", maxWidth: 860,
    margin: "0 auto", width: "100%",
    display: "flex", flexDirection: "column", gap: 24,
  },
  controls: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  datePicker: {
    background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text)", padding: "6px 10px", colorScheme: "dark",
    outline: "none", fontSize: 13, fontFamily: "inherit",
  },
  btn: { padding: "6px 14px", borderRadius: 6, fontWeight: 500, cursor: "pointer", border: "none" },
  btnGhost: { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" },
  btnAccent: { background: "var(--accent)", color: "#fff" },
  stats: { display: "flex", gap: 6 },
  statChip: { fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20 },

  backdrop: { position: "fixed", inset: 0, zIndex: 19 } as React.CSSProperties,
  clearDropdown: {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
    background: "var(--surface-2)", border: "1px solid var(--border)",
    borderRadius: 8, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden",
  } as React.CSSProperties,
  dropdownHeader: {
    padding: "8px 14px 4px", fontSize: 11, fontWeight: 600,
    color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
  },
  dropdownItem: {
    display: "block", width: "100%", textAlign: "left",
    background: "none", border: "none", color: "var(--text)",
    padding: "8px 14px", fontSize: 13, cursor: "pointer",
  } as React.CSSProperties,
  confirmBox: { padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  confirmText: { fontSize: 13, color: "var(--text)", lineHeight: 1.4 },
  confirmBtns: { display: "flex", gap: 8, justifyContent: "flex-end" },
  confirmCancel: {
    background: "none", border: "1px solid var(--border)", borderRadius: 6,
    color: "var(--text-muted)", padding: "5px 12px", fontSize: 12, cursor: "pointer",
  },
  confirmDelete: {
    background: "#dc2626", border: "none", borderRadius: 6,
    color: "#fff", padding: "5px 12px", fontSize: 12, cursor: "pointer",
  },

  error: {
    background: "#2a0a0a", border: "1px solid #5a1a1a",
    borderRadius: 6, color: "#f87171", padding: "10px 14px", fontSize: 13,
  },
  section: { display: "flex", flexDirection: "column", gap: 14 },
  sectionTitle: {
    fontSize: 13, fontWeight: 600, color: "var(--text-muted)",
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
};
