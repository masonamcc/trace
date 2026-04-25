# Trace

A local-first AI activity tracker. Watches your active windows and browser tabs, stores a timeline of events in a local SQLite database, and uses an AI model to generate daily summaries.

---

## Prerequisites

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) 18+
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) — on Windows, WebView2 is usually already installed

## First-time setup

```bash
# 1. Install JS dependencies
npm install

# 2. Generate the required Windows icon (run once)
node scripts/gen-icons.mjs

# 3. Start the dev server
npm run tauri dev
```

## Build for production

```bash
npm run tauri build
```

---

## Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Trace must be running — the extension posts events to `localhost:7734`

The extension filters a hardcoded list of sensitive domains (banking, medical, adult content) before anything is sent, as a first line of defense.

---

## Architecture

```
Trace (Tauri v2 desktop app)
  ├── Rust — polls the active window every 5s → SQLite
  ├── Rust — axum HTTP server on localhost:7734 (receives Chrome extension events)
  ├── Rust — OAuth 1.0a signing + X API v2 posting
  └── React — timeline UI + AI summary cards + X post controls

Chrome Extension (Manifest V3)
  └── Listens for tab changes → POST /event to localhost:7734
```

**Data path (Windows):** `%LOCALAPPDATA%\Trace\events.db`

---

## Features

### Timeline
Displays the day's activity grouped into sessions. Switch dates with the date picker. Auto-refreshes every 30 seconds when viewing today.

### AI Summaries
Generates 3 social-media-post-sized summary cards from the day's activity log. Supports multiple providers:

| Provider  | Model                | Key prefix      |
|-----------|----------------------|-----------------|
| Anthropic | claude-sonnet-4-6    | `sk-ant-api03-` |
| OpenAI    | gpt-4o               | `sk-proj-`      |
| Google    | gemini-2.0-flash     | `AIzaSy`        |
| xAI       | grok-2-1212          | `xai-`          |
| Mistral   | mistral-small-latest | —               |

API keys are stored in `localStorage` and never leave the machine except when calling the chosen provider.

A **summary style** field lets you define how the summaries should be written (tone, format, focus).

The prompt includes the current local time so relative phrases in generated summaries ("this morning", "tonight") are accurate to your timezone.

### X / Social
Post summary cards directly to X (Twitter) from Settings → Social. Requires a developer app at [developer.x.com](https://developer.x.com) with **Read & Write** permissions.

**Credentials required** (all stored in `localStorage`):
- Consumer Key & Consumer Secret
- Access Token & Access Token Secret

**Manual posting** — each summary card has a "Post to X" button. Click it to post that card immediately (or queue it for review).

**Auto-post** — Settings → Social → Auto-post. Generates a fresh summary on a configurable interval (15 min – 24 h) and posts the first card automatically.

**Require review** — when enabled (default), a confirmation dialog appears before anything is published. Disable it to post without approval.

### Privacy & Exclusions
Settings → **Privacy** tab. Each category can be expanded to view and edit its domain list.

| Category            | Behavior |
|---------------------|----------|
| Banking & Finance   | Blocks 19 domains by default |
| Medical & Health    | Blocks 13 domains by default |
| Adult Content       | Blocks 7 domains by default  |
| Legal & Government  | Blocks 5 domains by default  |

- Toggle entire categories on/off
- Expand a category to see all domains, remove individual ones, or add your own
- User additions are stored per-category in `localStorage`
- Exclusions are enforced at ingestion — matching events are dropped before touching the database
- The Chrome extension also hard-blocks sensitive domains client-side as a second layer

### Tracking Controls
- **Pause / Resume** — the pill in the header header instantly stops all event ingestion. Persists across restarts.
- **Schedule** — Settings → Data tab. Set a daily time window (e.g. 06:00–21:00). Events outside the window are silently dropped. Overnight windows (e.g. 22:00–06:00) are supported.

### History Management
- **Clear** button in the toolbar — drops events from the last 30 min, 1h, 2h, 5h, 12h, 1 day, 1 week, or 1 month with a confirmation step.
- **Auto-clear** — Settings → Data tab. Sets a rolling retention window; anything older is deleted automatically on startup and every 30 minutes.

---

## Settings reference

| Setting | Where | Stored |
|---|---|---|
| AI provider | Settings → AI | `localStorage` |
| API key (per provider) | Settings → AI | `localStorage` |
| Summary style | Settings → AI | `localStorage` |
| Exclusion categories | Settings → Privacy | `localStorage` |
| Custom domains (per category) | Settings → Privacy | `localStorage` |
| Auto-clear interval | Settings → Data | `localStorage` |
| Tracking schedule | Settings → Data | `localStorage` |
| Pause state | Header pill | `localStorage` |
| X credentials | Settings → Social | `localStorage` |
| X auto-post interval | Settings → Social | `localStorage` |
| X require review | Settings → Social | `localStorage` |
