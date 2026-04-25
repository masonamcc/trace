const TRACE_URL = "http://localhost:7734/event";

// Hardcoded sensitive domains — never sent to Trace regardless of settings.
const ALWAYS_BLOCK = new Set([
  // Banking
  "paypal.com","chase.com","bankofamerica.com","wellsfargo.com","citibank.com",
  "usbank.com","capitalone.com","discover.com","americanexpress.com","venmo.com",
  "cashapp.com","robinhood.com","fidelity.com","schwab.com","etrade.com",
  "coinbase.com","binance.com","kraken.com",
  // Medical
  "webmd.com","mayoclinic.org","healthline.com","medscape.com","drugs.com",
  "rxlist.com","medlineplus.gov","nih.gov","mychart.com","zocdoc.com","goodrx.com",
  // Adult
  "pornhub.com","xvideos.com","xnxx.com","redtube.com","youporn.com",
  "onlyfans.com","fansly.com",
]);

function getDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

function isSensitive(url) {
  if (!url) return true;
  const host = getDomain(url);
  if (!host) return true;
  return [...ALWAYS_BLOCK].some((d) => host === d || host.endsWith("." + d));
}

function send(event) {
  if (isSensitive(event.url)) return; // block before sending
  fetch(TRACE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {});
}

function eventFromTab(tab) {
  if (!tab?.url) return null;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return null;
  return {
    timestamp: new Date().toISOString(),
    source: "chrome",
    url: tab.url,
    page_title: tab.title ?? null,
    app: null,
    window_title: null,
  };
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const ev = eventFromTab(tab);
    if (ev) send(ev);
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    const ev = eventFromTab(tab);
    if (ev) send(ev);
  }
});
