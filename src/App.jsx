import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Timeline from "./components/Timeline";
import Summary from "./components/Summary";
import SplashScreen from "./components/SplashScreen";
import logo from "./assets/trace_favicon.png"

const PROVIDERS = [
  { id: "anthropic", label: "Claude",  company: "Anthropic", model: "claude-sonnet-4-6",   placeholder: "sk-ant-api03-…" },
  { id: "openai",    label: "GPT-4o",  company: "OpenAI",    model: "gpt-4o",               placeholder: "sk-proj-…" },
  { id: "gemini",    label: "Gemini",  company: "Google",    model: "gemini-2.0-flash",     placeholder: "AIzaSy…" },
  { id: "grok",      label: "Grok",    company: "xAI",       model: "grok-2-1212",          placeholder: "xai-…" },
  { id: "mistral",   label: "Mistral", company: "Mistral",   model: "mistral-small-latest", placeholder: "…" },
];

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

const POST_INTERVALS = [
  { label: "1 minute",   minutes: 1 },
  { label: "5 minutes",  minutes: 5 },
  { label: "10 minutes", minutes: 10 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour",     minutes: 60 },
  { label: "2 hours",    minutes: 120 },
  { label: "4 hours",    minutes: 240 },
  { label: "6 hours",    minutes: 360 },
  { label: "8 hours",    minutes: 480 },
  { label: "12 hours",   minutes: 720 },
  { label: "Daily",      minutes: 1440 },
];

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
    id: "legal",
    label: "Legal & Government",
    icon: "⚖️",
    domains: ["irs.gov","ssa.gov","dmv.org","legalzoom.com","court.gov"],
  },
];

export default function App() {
  // ── Async functions ──────────────────────────────────────────────────────────

  async function fetchEvents() {
    setLoading(true);
    setError("");
    try {
      const days = [];
      for (let offset = 0; offset < 7; offset++) {
        const dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - offset);
        days.push(dateObj.toISOString().slice(0, 10));
      }
      const results = await Promise.all(days.map((dateStr) => invoke("get_events", { date: dateStr })));
      const eventMap = {};
      days.forEach((dateStr, index) => { if (results[index].length > 0) eventMap[dateStr] = results[index]; });
      setEventsByDate(eventMap);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function doPost(text) {
    setXPosting(true);
    setXPostError("");
    try {
      await invoke("post_to_x", {
        text,
        consumerKey: xConsumerKey,
        consumerSecret: xConsumerSecret,
        accessToken: xAccessToken,
        accessTokenSecret: xAccessTokenSecret,
        communityId: xSelectedCommunityId || null,
      });
      setShowReview(false);
      if (composerRef.current) { setComposerText(""); composerRef.current = false; }
      setXPostSuccess(true);
      setTimeout(() => setXPostSuccess(false), 3000);
    } catch (error) {
      setXPostError(String(error));
    } finally {
      setXPosting(false);
      pendingRef.current = false;
    }
  }

  async function doPostThread(texts, communityId) {
    setXThreadPosting(true);
    setXPostError("");
    try {
      await invoke("post_thread_to_x", {
        texts,
        consumerKey: xConsumerKey,
        consumerSecret: xConsumerSecret,
        accessToken: xAccessToken,
        accessTokenSecret: xAccessTokenSecret,
        communityId: communityId || null,
      });
      setShowThreadReview(false);
      setXPostSuccess(true);
      setTimeout(() => setXPostSuccess(false), 3000);
    } catch (error) {
      setXPostError(String(error));
    } finally {
      setXThreadPosting(false);
    }
  }

  async function handlePostCard(text) {
    if (!xCredentialsOk) {
      setShowSettings(true);
      setSettingsTab("social");
      throw new Error("No X credentials — add them in Settings → Social.");
    }
    setPendingText(text);
    setXSelectedCommunityId(xDefaultCommunityId);
    setXPostError("");
    if (xRequireReview) {
      setShowReview(true);
      return "queued";
    }
    pendingRef.current = true;
    try {
      await invoke("post_to_x", {
        text,
        consumerKey: xConsumerKey,
        consumerSecret: xConsumerSecret,
        accessToken: xAccessToken,
        accessTokenSecret: xAccessTokenSecret,
        communityId: xDefaultCommunityId || null,
      });
      pendingRef.current = false;
      return "posted";
    } catch (error) {
      pendingRef.current = false;
      throw error;
    }
  }

  async function handlePostThread() {
    if (!xCredentialsOk) {
      setShowSettings(true);
      setSettingsTab("social");
      throw new Error("No X credentials — add them in Settings → Social.");
    }
    if (!currentKey) { setShowSettings(true); throw new Error("No AI key — add one in Settings → AI."); }
    setXSelectedCommunityId(xDefaultCommunityId);
    setXPostError("");
    const threadTexts = await invoke("get_thread_posts", {
      date, apiKey: currentKey, style: summaryStyle, provider,
    });
    setPendingThreadTexts(threadTexts);
    if (xRequireReview) {
      setShowThreadReview(true);
      return;
    }
    await doPostThread(threadTexts, xDefaultCommunityId);
  }

  async function handlePostComposer() {
    const text = composerText.trim();
    if (!text || !xCredentialsOk) return;
    setXSelectedCommunityId(xDefaultCommunityId);
    setXPostError("");
    if (xRequireReview) {
      composerRef.current = true;
      setPendingText(text);
      setShowReview(true);
      return;
    }
    try {
      await invoke("post_to_x", {
        text,
        consumerKey: xConsumerKey,
        consumerSecret: xConsumerSecret,
        accessToken: xAccessToken,
        accessTokenSecret: xAccessTokenSecret,
        communityId: xDefaultCommunityId || null,
      });
      setComposerText("");
      setXPostSuccess(true);
      setTimeout(() => setXPostSuccess(false), 3000);
    } catch (error) {
      setXPostError(String(error));
    }
  }

  async function generateSummary() {
    if (!currentKey) { setSettingsTab("ai"); setShowSettings(true); return; }
    setSummaryLoading(true); setSummary([]); setError("");
    try {
      setSummary(await invoke("get_daily_summary", {
        date, apiKey: currentKey, style: summaryStyle, provider,
      }));
    } catch (error) { setError(String(error)); }
    finally { setSummaryLoading(false); }
  }

  async function handleClearConfirm() {
    if (!clearConfirm) return;
    try { await invoke("clear_recent", { minutes: clearConfirm.minutes }); await fetchEvents(); }
    catch (error) { setError(String(error)); }
    setClearMenu(false); setClearConfirm(null);
  }

  // ── useState ─────────────────────────────────────────────────────────────────

  const [date, setDate] = useState(todayStr());
  const [eventsByDate, setEventsByDate] = useState({});
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState(() => localStorage.getItem("trace_provider") ?? "anthropic");
  const [apiKeys, setApiKeys] = useState(loadKeys);
  const [summaryStyle, setSummaryStyle] = useState(() => localStorage.getItem("trace_summary_style") ?? "");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("ai");
  const [clearMenu, setClearMenu] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(null);
  const [autoClearMinutes, setAutoClearMinutes] = useState(() => Number(localStorage.getItem("trace_auto_clear") ?? "0"));
  const [isPaused, setIsPaused] = useState(() => localStorage.getItem("trace_paused") === "true");
  const [scheduleStart, setScheduleStart] = useState(() => localStorage.getItem("trace_schedule_start") ?? "");
  const [scheduleEnd, setScheduleEnd] = useState(() => localStorage.getItem("trace_schedule_end") ?? "");
  const [xClientId, setXClientId] = useState(() => localStorage.getItem("trace_x_cid") ?? "");
  const [xClientSecret, setXClientSecret] = useState(() => localStorage.getItem("trace_x_cse") ?? "");
  const [xBearerToken, setXBearerToken] = useState(() => localStorage.getItem("trace_x_bt") ?? "");
  const [xConsumerKey, setXConsumerKey] = useState(() => localStorage.getItem("trace_x_ck") ?? "");
  const [xConsumerSecret, setXConsumerSecret] = useState(() => localStorage.getItem("trace_x_cs") ?? "");
  const [xAccessToken, setXAccessToken] = useState(() => localStorage.getItem("trace_x_at") ?? "");
  const [xAccessTokenSecret, setXAccessTokenSecret] = useState(() => localStorage.getItem("trace_x_ats") ?? "");
  const [xAutoPost, setXAutoPost] = useState(() => localStorage.getItem("trace_x_auto") === "true");
  const [xIntervalMinutes, setXIntervalMinutes] = useState(() => Number(localStorage.getItem("trace_x_interval") ?? "60"));
  const [xRequireReview, setXRequireReview] = useState(() => localStorage.getItem("trace_x_review") !== "false");
  const [xCommunities, setXCommunities] = useState(() => loadJson("trace_x_communities", []));
  const [xDefaultCommunityId, setXDefaultCommunityId] = useState(() => localStorage.getItem("trace_x_default_community") ?? "");
  const [xCommunityNameInput, setXCommunityNameInput] = useState("");
  const [xCommunityIdInput, setXCommunityIdInput] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [xSelectedCommunityId, setXSelectedCommunityId] = useState("");
  const [showThreadReview, setShowThreadReview] = useState(false);
  const [pendingThreadTexts, setPendingThreadTexts] = useState([]);
  const [xPosting, setXPosting] = useState(false);
  const [xThreadPosting, setXThreadPosting] = useState(false);
  const [xPostError, setXPostError] = useState("");
  const [xPostSuccess, setXPostSuccess] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const pendingRef = useRef(false);
  const composerRef = useRef(false);
  const [activeCategories, setActiveCategories] = useState(() => new Set(loadJson("trace_excl_categories", [])));
  const [categoryAdditions, setCategoryAdditions] = useState(() => {
    const result = {};
    for (const cat of EXCLUSION_CATEGORIES) result[cat.id] = loadJson(`trace_excl_add_${cat.id}`, []);
    return result;
  });
  const [categoryRemovals, setCategoryRemovals] = useState(() => {
    const result = {};
    for (const cat of EXCLUSION_CATEGORIES) result[cat.id] = loadJson(`trace_excl_rm_${cat.id}`, []);
    return result;
  });
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [categoryInputs, setCategoryInputs] = useState({});

  // ── Derived values ───────────────────────────────────────────────────────────

  const currentProvider = PROVIDERS.find((providerOption) => providerOption.id === provider);
  const currentKey = apiKeys[provider] ?? "";
  const xCredentialsOk = !!(xConsumerKey && xConsumerSecret && xAccessToken && xAccessTokenSecret);
  const todayEvents = eventsByDate[todayStr()] ?? [];
  const desktopCount = todayEvents.filter((event) => event.source === "desktop").length;
  const browserCount = todayEvents.filter((event) => event.source === "chrome").length;
  const activeExclCount = activeCategories.size;

  // ── Utility functions ────────────────────────────────────────────────────────

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function loadKeys() {
    const keys = {};
    for (const providerOption of PROVIDERS) {
      if (providerOption.id === "anthropic" && !localStorage.getItem("trace_api_key_anthropic")) {
        const legacy = localStorage.getItem("trace_api_key") ?? localStorage.getItem("mason_api_key");
        if (legacy) localStorage.setItem("trace_api_key_anthropic", legacy);
      }
      keys[providerOption.id] = localStorage.getItem(`trace_api_key_${providerOption.id}`) ?? "";
    }
    return keys;
  }

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
    catch { return fallback; }
  }

  function saveKey(pid, val) {
    setApiKeys((prev) => ({ ...prev, [pid]: val }));
    localStorage.setItem(`trace_api_key_${pid}`, val);
  }

  function saveProvider(pid) {
    setProvider(pid); localStorage.setItem("trace_provider", pid);
  }

  function saveSummaryStyle(val) {
    setSummaryStyle(val); localStorage.setItem("trace_summary_style", val);
  }

  function saveAutoClear(minutes) {
    setAutoClearMinutes(minutes); localStorage.setItem("trace_auto_clear", String(minutes));
  }

  function saveXField(storageKey, setter, val) {
    setter(val); localStorage.setItem(storageKey, val);
  }

  function saveXAutoPost(val) {
    setXAutoPost(val); localStorage.setItem("trace_x_auto", String(val));
  }

  function saveXInterval(val) {
    setXIntervalMinutes(val); localStorage.setItem("trace_x_interval", String(val));
  }

  function saveXRequireReview(val) {
    setXRequireReview(val); localStorage.setItem("trace_x_review", String(val));
  }

  function saveXCommunities(val) {
    setXCommunities(val); localStorage.setItem("trace_x_communities", JSON.stringify(val));
  }

  function saveXDefaultCommunity(id) {
    setXDefaultCommunityId(id); localStorage.setItem("trace_x_default_community", id);
  }

  function togglePause() {
    const next = !isPaused;
    setIsPaused(next);
    localStorage.setItem("trace_paused", String(next));
  }

  function saveSchedule(start, end) {
    setScheduleStart(start); localStorage.setItem("trace_schedule_start", start);
    setScheduleEnd(end);     localStorage.setItem("trace_schedule_end", end);
  }

  function toggleCategory(id) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("trace_excl_categories", JSON.stringify([...next]));
      return next;
    });
  }

  function toggleExpand(id) {
    setExpandedCategory((prev) => (prev === id ? null : id));
  }

  function addDomain(catId) {
    const raw = (categoryInputs[catId] ?? "").trim().toLowerCase().replace(/^www\./, "");
    if (!raw) return;
    setCategoryAdditions((prev) => {
      const list = prev[catId] ?? [];
      if (list.includes(raw)) return prev;
      const next = { ...prev, [catId]: [...list, raw] };
      localStorage.setItem(`trace_excl_add_${catId}`, JSON.stringify(next[catId]));
      return next;
    });
    setCategoryInputs((prev) => ({ ...prev, [catId]: "" }));
  }

  function removeDomain(catId, domain, kind) {
    if (kind === "added") {
      setCategoryAdditions((prev) => {
        const next = { ...prev, [catId]: (prev[catId] ?? []).filter((existingDomain) => existingDomain !== domain) };
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

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const fadeTimer   = setTimeout(() => setSplashFading(true),  2000);
    const removeTimer = setTimeout(() => setSplashVisible(false), 2550);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setSummary([]); }, [date]);

  useEffect(() => {
    const id = setInterval(fetchEvents, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    invoke("set_tracking_paused", { paused: isPaused }).catch(console.error);
  }, [isPaused]);

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
    if (!xAutoPost || !xCredentialsOk || !currentKey) return;
    const id = setInterval(async () => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      try {
        const cards = await invoke("get_daily_summary", {
          date: todayStr(), apiKey: currentKey, style: summaryStyle, provider,
        });
        if (!cards.length) return;
        const text = cards[0];
        if (xRequireReview) {
          setPendingText(text);
          setShowReview(true);
          pendingRef.current = false;
        } else {
          await doPost(text);
        }
      } catch {
        pendingRef.current = false;
      }
    }, xIntervalMinutes * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xAutoPost, xIntervalMinutes, xRequireReview, xCredentialsOk, currentKey, summaryStyle, provider]);

  useEffect(() => {
    const patterns = [];
    for (const cat of EXCLUSION_CATEGORIES) {
      if (!activeCategories.has(cat.id)) continue;
      const removals = new Set(categoryRemovals[cat.id] ?? []);
      patterns.push(
        ...cat.domains.filter((domain) => !removals.has(domain)),
        ...(categoryAdditions[cat.id] ?? []),
      );
    }
    invoke("set_exclusions", { patterns: [...new Set(patterns)] }).catch(console.error);
  }, [activeCategories, categoryAdditions, categoryRemovals]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="root">
      {splashVisible && <SplashScreen fading={splashFading} />}
      <header className="header">
        <div style={{display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '.5rem'}}>
          <img src={logo} alt={''} style={{height: 30}} />
          <h2>Trace</h2>
        </div>

        <div className="headerRight">
          {activeExclCount > 0 && (
            <span className="shieldBadge" title={`${activeExclCount} exclusion group(s) active`}>
              🛡 {activeExclCount}
            </span>
          )}
          <div className="activeProvider">
            {currentProvider.company} · {currentProvider.model}
          </div>
          <button
            className={`trackingPill${isPaused ? ' trackingPillPaused' : ''}`}
            onClick={togglePause}
            title={isPaused ? "Click to resume tracking" : "Click to pause tracking"}
          >
            <span className="trackingDot" style={{background: isPaused ? "#ef4444" : "#22c55e"}} />
            {isPaused ? "Paused" : "Tracking"}
          </button>
          <button className="settingsBtn" onClick={() => setShowSettings((prev) => !prev)}>
            Settings
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settingsPanel">
          <div className="settingsTabs">
            {["ai", "privacy", "data", "social"].map((tab) => (
              <button
                key={tab}
                className={`settingsTab${settingsTab === tab ? ' settingsTabActive' : ''}`}
                onClick={() => setSettingsTab(tab)}
              >
                {{ ai: "AI", privacy: "Privacy", data: "Data", social: "Social" }[tab]}
              </button>
            ))}
          </div>

          {settingsTab === "ai" && (
            <div className="tabContent">
              <div className="settingsRow">
                <span className="settingsLabel">Provider</span>
                <div className="providerTabs">
                  {PROVIDERS.map((providerOption) => (
                    <button key={providerOption.id} onClick={() => saveProvider(providerOption.id)}
                      className={`providerTab${providerOption.id === provider ? ' providerTabActive' : ''}`}>
                      {providerOption.company}
                      {apiKeys[providerOption.id] && <span className="keyDot" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settingsRow">
                <span className="settingsLabel">API key</span>
                <input className="settingsInput" type="password"
                  placeholder={currentProvider.placeholder} value={currentKey}
                  onChange={(e) => saveKey(provider, e.target.value)} />
              </div>
              <div className="settingsRow">
                <span className="settingsLabel">Summary style</span>
                <textarea className="styleInput" rows={4} value={summaryStyle}
                  placeholder={"How should the summary be written?\n\nExamples:\n• Write like a dev journal — terse, technical, first person.\n• Bullet points only, no prose."}
                  onChange={(e) => saveSummaryStyle(e.target.value)} />
              </div>
            </div>
          )}

          {settingsTab === "privacy" && (
            <div className="tabContent">
              <p className="tabHint">
                Excluded domains are dropped at ingestion — never written to the database.
                Toggle a group on/off, expand to edit its domain list, or add your own.
              </p>

              {EXCLUSION_CATEGORIES.map((cat) => {
                const isEnabled = activeCategories.has(cat.id);
                const isExpanded = expandedCategory === cat.id;
                const removals = new Set(categoryRemovals[cat.id] ?? []);
                const additions = categoryAdditions[cat.id] ?? [];
                const visibleDefaults = cat.domains.filter((domain) => !removals.has(domain));
                const totalCount = visibleDefaults.length + additions.length;

                return (
                  <div key={cat.id} className="catBlock">
                    <div className="catHeader">
                      <button className="expandArrow" onClick={() => toggleExpand(cat.id)}>
                        {isExpanded ? "▾" : "▸"}
                      </button>
                      <span className="catIcon">{cat.icon}</span>
                      <span className="catLabel">{cat.label}</span>
                      <span className="catCount">{totalCount} domains</span>
                      <button
                        className={`toggle${isEnabled ? ' toggleOn' : ''}`}
                        style={{marginLeft: "auto"}}
                        onClick={() => toggleCategory(cat.id)}
                      >
                        <span className={`toggleThumb${isEnabled ? ' toggleThumbOn' : ''}`} />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="catBody">
                        <div className="domainGrid">
                          {visibleDefaults.map((domain) => (
                            <span key={domain} className="chipDefault">
                              {domain}
                              <button className="chipX" onClick={() => removeDomain(cat.id, domain, "default")} title="Remove">×</button>
                            </span>
                          ))}
                          {additions.map((domain) => (
                            <span key={domain} className="chipAdded">
                              {domain}
                              <button className="chipX" onClick={() => removeDomain(cat.id, domain, "added")} title="Remove">×</button>
                            </span>
                          ))}
                        </div>

                        <div className="addRow">
                          <input
                            className="domainInput"
                            placeholder="Add domain, e.g. mint.com"
                            value={categoryInputs[cat.id] ?? ""}
                            onChange={(e) =>
                              setCategoryInputs((prev) => ({ ...prev, [cat.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && addDomain(cat.id)}
                          />
                          <button className="addBtn" onClick={() => addDomain(cat.id)}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {settingsTab === "data" && (
            <div className="tabContent">
              <div className="settingsRow">
                <span className="settingsLabel">Auto-clear</span>
                <div className="autoClearGroup">
                  <select className="appSelect" value={autoClearMinutes}
                    onChange={(e) => saveAutoClear(Number(e.target.value))}>
                    {AUTO_CLEAR_OPTIONS.map((option) => (
                      <option key={option.minutes} value={option.minutes}>{option.label}</option>
                    ))}
                  </select>
                  <span className="autoClearHint">
                    {autoClearMinutes === 0
                      ? "History is kept indefinitely."
                      : `Data older than ${AUTO_CLEAR_OPTIONS.find((option) => option.minutes === autoClearMinutes)?.label} is deleted automatically.`}
                  </span>
                </div>
              </div>

              <div className="settingsRow">
                <span className="settingsLabel">Schedule</span>
                <div className="scheduleGroup">
                  <div className="scheduleInputRow">
                    <span className="scheduleLabel">From</span>
                    <input
                      type="time"
                      className="timeInput"
                      value={scheduleStart}
                      onChange={(e) => saveSchedule(e.target.value, scheduleEnd)}
                    />
                    <span className="scheduleLabel">to</span>
                    <input
                      type="time"
                      className="timeInput"
                      value={scheduleEnd}
                      onChange={(e) => saveSchedule(scheduleStart, e.target.value)}
                    />
                    {(scheduleStart || scheduleEnd) && (
                      <button className="clearScheduleBtn" onClick={() => saveSchedule("", "")}>
                        Clear
                      </button>
                    )}
                  </div>
                  <span className="autoClearHint">
                    {scheduleStart && scheduleEnd
                      ? `Only track between ${scheduleStart} and ${scheduleEnd}.`
                      : "No schedule — tracking runs whenever the app is open."}
                  </span>
                </div>
              </div>
            </div>
          )}

          {settingsTab === "social" && (
            <div className="tabContent">
              <p className="tabHint">
                Post activity summaries to X. Requires a developer app at developer.x.com with Read &amp; Write permissions. Generate access tokens for your own account in the developer portal.
              </p>

              {([
                { label: "Client ID",           storageKey: "trace_x_cid", value: xClientId,             setter: setXClientId },
                { label: "Client Secret",       storageKey: "trace_x_cse", value: xClientSecret,         setter: setXClientSecret },
                { label: "Bearer Token",        storageKey: "trace_x_bt",  value: xBearerToken,          setter: setXBearerToken },
                { label: "Consumer Key",        storageKey: "trace_x_ck",  value: xConsumerKey,          setter: setXConsumerKey },
                { label: "Consumer Secret",     storageKey: "trace_x_cs",  value: xConsumerSecret,       setter: setXConsumerSecret },
                { label: "Access Token",        storageKey: "trace_x_at",  value: xAccessToken,          setter: setXAccessToken },
                { label: "Access Token Secret", storageKey: "trace_x_ats", value: xAccessTokenSecret,    setter: setXAccessTokenSecret },
              ]).map(({ label, storageKey, value, setter }) => (
                <div key={storageKey} className="settingsRow">
                  <span className="settingsLabel">{label}</span>
                  <input
                    className="settingsInput"
                    type="password"
                    value={value}
                    onChange={(e) => saveXField(storageKey, setter, e.target.value)}
                  />
                </div>
              ))}

              <div className="settingsRow">
                <span className="settingsLabel">Auto-post</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    className={`toggle${xAutoPost ? ' toggleOn' : ''}`}
                    onClick={() => saveXAutoPost(!xAutoPost)}
                  >
                    <span className={`toggleThumb${xAutoPost ? ' toggleThumbOn' : ''}`} />
                  </button>
                  {xAutoPost && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="autoClearHint">Post every</span>
                      <select
                        className="appSelect"
                        style={{width: "auto"}}
                        value={xIntervalMinutes}
                        onChange={(e) => saveXInterval(Number(e.target.value))}
                      >
                        {POST_INTERVALS.map((interval) => (
                          <option key={interval.minutes} value={interval.minutes}>{interval.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="settingsRow">
                <span className="settingsLabel">Require review</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    className={`toggle${xRequireReview ? ' toggleOn' : ''}`}
                    onClick={() => saveXRequireReview(!xRequireReview)}
                  >
                    <span className={`toggleThumb${xRequireReview ? ' toggleThumbOn' : ''}`} />
                  </button>
                  <span className="autoClearHint">
                    {xRequireReview
                      ? "You'll approve each post before it goes live."
                      : "Trace posts automatically without approval."}
                  </span>
                </div>
              </div>

              <div className="settingsRow">
                <span className="settingsLabel">Communities</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  {xCommunities.map((community, index) => (
                    <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>{community.name}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{community.id}</span>
                      <button
                        className="chipX"
                        onClick={() => {
                          const next = xCommunities.filter((_, filterIndex) => filterIndex !== index);
                          saveXCommunities(next);
                          if (xDefaultCommunityId === community.id) saveXDefaultCommunity("");
                        }}
                      >×</button>
                    </div>
                  ))}
                  <div className="addRow">
                    <input
                      className="domainInput"
                      style={{flex: 1}}
                      placeholder="Name"
                      value={xCommunityNameInput}
                      onChange={(e) => setXCommunityNameInput(e.target.value)}
                    />
                    <input
                      className="domainInput"
                      style={{width: 130}}
                      placeholder="Community ID"
                      value={xCommunityIdInput}
                      onChange={(e) => setXCommunityIdInput(e.target.value)}
                    />
                    <button
                      className="addBtn"
                      onClick={() => {
                        const name = xCommunityNameInput.trim();
                        const id   = xCommunityIdInput.trim();
                        if (!name || !id) return;
                        saveXCommunities([...xCommunities, { name, id }]);
                        setXCommunityNameInput("");
                        setXCommunityIdInput("");
                      }}
                    >Add</button>
                  </div>
                </div>
              </div>

              {xCommunities.length > 0 && (
                <div className="settingsRow">
                  <span className="settingsLabel">Default</span>
                  <select
                    className="appSelect"
                    style={{width: "auto"}}
                    value={xDefaultCommunityId}
                    onChange={(e) => saveXDefaultCommunity(e.target.value)}
                  >
                    <option value="">Timeline</option>
                    {xCommunities.map((community, index) => (
                      <option key={index} value={community.id}>{community.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <button className="doneBtn" onClick={() => setShowSettings(false)}>Done</button>
        </div>
      )}

      <main className="main">
        <div className="controls">
          <input type="date" value={date} max={todayStr()}
            onChange={(e) => setDate(e.target.value)} className="datePicker" />
          <button onClick={fetchEvents} disabled={loading} className="btn btnGhost">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <div className="stats">
            <span className="statChip" data-type="desktop">{desktopCount} desktop</span>
            <span className="statChip" data-type="browser">{browserCount} browser</span>
          </div>

          <div style={{ position: "relative" }}>
            <button onClick={() => { setClearMenu((prev) => !prev); setClearConfirm(null); }}
              className="btn btnGhost" style={{color: "var(--text-muted)"}}>
              Clear
            </button>
            {clearMenu && (
              <>
                <div className="backdrop" onClick={() => { setClearMenu(false); setClearConfirm(null); }} />
                <div className="clearDropdown">
                  {clearConfirm ? (
                    <div className="confirmBox">
                      <p className="confirmText">
                        Delete events from the last <strong>{clearConfirm.label}</strong>?
                      </p>
                      <div className="confirmBtns">
                        <button className="confirmCancel" onClick={() => setClearConfirm(null)}>Cancel</button>
                        <button className="confirmDelete" onClick={handleClearConfirm}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="dropdownHeader">Clear last…</div>
                      {CLEAR_RANGES.map((range) => (
                        <button key={range.minutes} className="dropdownItem" onClick={() => setClearConfirm(range)}>
                          {range.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <button onClick={generateSummary} disabled={summaryLoading || todayEvents.length === 0}
            className="btn btnDarkAccent" style={{marginLeft: "auto"}}>
            {summaryLoading ? "Generating…" : "Generate Summary"}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {xCredentialsOk && !(summary.length > 0 || summaryLoading) && (
          <section className="section">
            <h2 className="sectionTitle">Compose</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                className="styleInput"
                style={{minHeight: 80, width: "100%", boxSizing: "border-box"}}
                placeholder="Write a post…"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                rows={3}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: composerText.length > 280 ? "#ef4444" : "var(--text-muted)" }}>
                  {composerText.length > 0 ? `${composerText.length} / 280` : ""}
                </span>
                <button
                  className="btn btnDarkAccent"
                  disabled={!composerText.trim() || composerText.length > 280}
                  onClick={handlePostComposer}
                >
                  Post to X
                </button>
              </div>
            </div>
          </section>
        )}

        {(summary.length > 0 || summaryLoading) && (
          <section className="section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 className="sectionTitle">Summary</h2>
              {!summaryLoading && (
                <button
                  onClick={() => setSummary([])}
                  style={{
                    background: "none", border: "none", color: "var(--text-muted)",
                    fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 2px",
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              )}
            </div>
            <Summary
              cards={summary}
              loading={summaryLoading}
              onPost={handlePostCard}
              onPostThread={handlePostThread}
              xEnabled={true}
            />
          </section>
        )}

        <section className="section">
          <h2 className="sectionTitle">Activity</h2>
          <Timeline eventsByDate={eventsByDate} today={todayStr()} />
        </section>
      </main>

      {showReview && (
        <div className="modalBackdrop">
          <div className="modal">
            <h3 className="modalTitle">Review post</h3>
            <div className="charCount" data-over={pendingText.length > 280}>
              {pendingText.length} / 280
            </div>
            <textarea
              className="styleInput"
              style={{minHeight: 100, width: "100%", boxSizing: "border-box"}}
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
            />
            {xCommunities.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>Post to</span>
                <select
                  className="appSelect"
                  style={{flex: 1, width: "auto"}}
                  value={xSelectedCommunityId}
                  onChange={(e) => setXSelectedCommunityId(e.target.value)}
                >
                  <option value="">Timeline</option>
                  {xCommunities.map((community, index) => (
                    <option key={index} value={community.id}>{community.name}</option>
                  ))}
                </select>
              </div>
            )}
            {xPostError && <div className="xError">{xPostError}</div>}
            <div className="modalBtns">
              <button
                className="confirmCancel"
                onClick={() => { setShowReview(false); setXPostError(""); pendingRef.current = false; }}
              >
                Skip
              </button>
              <button
                className="btn btnDarkAccent"
                disabled={xPosting || pendingText.length === 0 || pendingText.length > 280}
                onClick={() => doPost(pendingText)}
              >
                {xPosting ? "Posting…" : "Post to X"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showThreadReview && (
        <div className="modalBackdrop">
          <div className="modal" style={{width: 500}}>
            <h3 className="modalTitle">Review thread</h3>
            {pendingThreadTexts.map((text, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {index === 0 ? "Post" : `Reply ${index}`}
                  </span>
                  <span className="charCount" data-over={text.length > 280}>
                    {text.length} / 280
                  </span>
                </div>
                <textarea
                  className="styleInput"
                  style={{minHeight: 80, width: "100%", boxSizing: "border-box"}}
                  value={text}
                  onChange={(e) => {
                    const next = [...pendingThreadTexts];
                    next[index] = e.target.value;
                    setPendingThreadTexts(next);
                  }}
                />
              </div>
            ))}
            {xCommunities.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>Post to</span>
                <select
                  className="appSelect"
                  style={{flex: 1, width: "auto"}}
                  value={xSelectedCommunityId}
                  onChange={(e) => setXSelectedCommunityId(e.target.value)}
                >
                  <option value="">Timeline</option>
                  {xCommunities.map((community, index) => (
                    <option key={index} value={community.id}>{community.name}</option>
                  ))}
                </select>
              </div>
            )}
            {xPostError && <div className="xError">{xPostError}</div>}
            <div className="modalBtns">
              <button
                className="confirmCancel"
                onClick={() => { setShowThreadReview(false); setXPostError(""); }}
              >
                Skip
              </button>
              <button
                className="btn btnDarkAccent"
                disabled={xThreadPosting || pendingThreadTexts.some((text) => text.length === 0 || text.length > 280)}
                onClick={() => doPostThread(pendingThreadTexts, xSelectedCommunityId)}
              >
                {xThreadPosting ? "Posting…" : "Post thread"}
              </button>
            </div>
          </div>
        </div>
      )}

      {xPostSuccess && (
        <div className="successToast">Posted to X</div>
      )}
    </div>
  );
}
