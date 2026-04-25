# CLAUDE.md — Project Conventions

This file defines the coding style and conventions for Tauri + React projects. Follow these rules precisely when generating or modifying any code.

---

## Stack

- **Frontend:** React (JavaScript, not TypeScript), Vite
- **Desktop shell:** Tauri v2
- **Rust backend:** Tauri commands in `src-tauri/src/`
- **Package manager:** npm
- **Styling:** Plain CSS with utility classes (no CSS frameworks like Tailwind)

---

## Project Structure

```
project-root/
  index.html          — Vite entry point (at root, not public/)
  vite.config.js      — Vite config
  package.json        — scripts use "vite" / "vite build", not react-scripts
  src/
    main.jsx          — ReactDOM.createRoot entry
    App.jsx           — root component
    index.css         — global CSS
    App.css           — app-level CSS
    components/       — child components (.jsx)
    assets/           — images, icons
  src-tauri/
    tauri.conf.json
    src/
      main.rs
      lib.rs
      command.rs
```

---

## JavaScript / React

### Language

- Use **JavaScript** (`.js`, `.jsx`), not TypeScript.
- Use `async/await` for all asynchronous code — never `.then()` chains.

### Variable and function naming

- Use **full, descriptive names** everywhere — no single-character abbreviations.
  - `entry`, not `e` (unless it is an event parameter in an inline handler)
  - `fileName`, not `fn`
  - `directory`, not `d`
  - `index`, not `i` (prefer named keys over array index variables when possible)
- Exception: inline React event handler arrow functions may use `e` for the event object (`onChange={(e) => setValue(e.target.value)}`).

### Function declarations

- Define all functions with the `function` keyword, not arrow functions assigned to `const`.

```js
// Correct
async function saveCode() { ... }
function getFileIcon(fileName) { ... }

// Wrong
const saveCode = async () => { ... }
const getFileIcon = (fileName) => { ... }
```

- All functions must be declared **inside the component**, **before the `return` statement**.
- Local helper functions that are only used by one parent function can be nested inside that parent function.

```js
async function saveCode() {
    async function determineSave() {
        // local helper
    }
    const filePath = await determineSave();
}
```

### Component structure

Follow this order inside every React component:

1. `async function` definitions (Tauri/API calls, data logic)
2. Constants (`const MY_CONST = ...`)
3. `useState` declarations
4. Other `const` values derived from state or props
5. Regular/utility function definitions
6. `useEffect` hooks
7. `return (...)` — JSX

### State

- Use `useState` for all local state.
- State variable names are descriptive nouns or noun phrases: `folderName`, `backedUpFiles`, `fileExtension`.

### useEffect

- Suppress the exhaustive-deps lint warning with a comment when the empty-dep array is intentional:

```js
useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

---

## JSX / HTML

### Classes vs inline styles

- Use **`className`** for styles that apply to a repeated pattern or reusable concept.
- Use **inline `style={{}}`** for one-off layout adjustments or values that don't warrant a class.
- It is normal and expected to mix both on the same element:

```jsx
<div className={'menu'} style={{padding: '2rem'}}>
```

### Class naming

- Component/block classes: PascalCase or camelCase noun (`fileListing`, `menuContainer`, `App`)
- Utility classes: lowercase with hyphens (`text-white`, `mb-1`, `gap-half`, `flex`)

### Utility classes to use (already defined in CSS)

| Class | Purpose |
|---|---|
| `.flex` | `display: flex` |
| `.gap-quarter` | `gap: .25rem` |
| `.gap-half` | `gap: .5rem` |
| `.gap1` | `gap: 1rem` |
| `.mb-0` | `margin-bottom: 0` |
| `.mb-quarter` | `margin-bottom: .25rem` |
| `.mb-half` | `margin-bottom: .5rem` |
| `.mb-1` | `margin-bottom: 1rem` |
| `.text-white` | `color: white` |
| `.text-left` | `text-align: left` |
| `.text-light` | faint white (`rgba(255,255,255,.4)`) |
| `.faint-text` | `opacity: .25`, small font |
| `.dark` | dark background + white text input style |
| `.scrollable` | `overflow: auto` + custom scrollbar |
| `.button` | primary action button (red accent) |
| `.dark-button` | secondary dark button |
| `.input` | standalone text input |
| `.select` | full-width select element |
| `.inputWithButton` | input + button pair (fused) |
| `.inputWithDropdown` | input + select pair (fused) |
| `.span-2-col` | `grid-column: span 2` |
| `.child-hover-underline` | underlines child elements on hover |

### Images

- Always include `alt={''}` for decorative images.
- Pass `width` as a string with a unit when using `px`: `width={'50px'}`, or as a bare number for small icon widths: `width="15"`.

### Quotes in JSX

- Use double quotes for HTML attributes: `className="foo"`
- Use single quotes inside JSX expression braces: `className={'foo'}`
- Both forms are acceptable; be consistent within a file.

---

## CSS

### Theme

- Dark backgrounds: `#222222` (sidebar), `#333333`–`#404040` (body gradient), `#141414` (controls)
- Text: white or `rgba(255,255,255,N)` for opacity variants
- Accent / primary action color: `#f55541` (red-orange)
- Borders: `1px solid rgba(255,255,255,.2)` or `.3`
- Border radius: `6px` for cards/inputs, `.5rem` for buttons, `5rem` for pill shapes (file listings)

### Transitions

Add smooth transitions on all interactive elements:

```css
transition: background .15s ease-in-out;
```

### Scrollbar

Style scrollbars on `.scrollable` containers using `::-webkit-scrollbar` with a transparent track and `rgba(255,255,255,0.25)` thumb that brightens on hover.

### Section comments

Group CSS rules with section comments:

```css
/*Button Classes ----------------*/
/*Text Classes ------------------*/
/*Margin Classes ---------------*/
```

### Spacing

Use `rem` units throughout. Standard scale: `.25rem`, `.5rem`, `1rem`, `2rem`.

---

## Rust / Tauri Backend

### File structure

```
src-tauri/
  src/
    main.rs       — entry point, calls lib::run()
    lib.rs        — Tauri builder, plugin registration, invoke_handler
    command.rs    — all #[tauri::command] functions
```

### Commands

- All Tauri commands live in `command.rs`.
- Mark each with `#[tauri::command]` and `pub fn`.
- Use full snake_case names: `get_file_contents`, not `get_fc`.
- Register every command in `lib.rs` inside `tauri::generate_handler![]`.

```rust
// command.rs
#[tauri::command]
pub fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}

// lib.rs
.invoke_handler(tauri::generate_handler![greet])
```

### Plugins (register in `lib.rs`)

Standard plugins for most projects:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![...])
```

### Cargo.toml dependencies (typical baseline)

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2", features = [] }
tauri-plugin-log = "2"
tauri-plugin-fs = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

---

## Vite Configuration (`vite.config.js`)

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

- Dev server runs on **port 1420** (not 3000).
- `clearScreen: false` keeps Tauri CLI output visible.
- `watch.ignored` prevents Rust recompiles from triggering Vite HMR.

---

## Tauri Configuration (`tauri.conf.json`)

Baseline config shape:

```json
{
  "productName": "AppName",
  "version": "1.0.0",
  "identifier": "com.masonamcc.appname",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "AppName",
        "width": 900,
        "height": 720,
        "resizable": false,
        "fullscreen": false,
        "label": "main"
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

Key differences from CRA:
- `frontendDist` is `"../dist"` (Vite output), not `"../build"`
- `devUrl` is `"http://localhost:1420"` (Vite port), not 3000
- `beforeDevCommand` / `beforeBuildCommand` are required — Tauri uses these to start/build the frontend automatically

---

## package.json

```json
{
  "name": "appname",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "vite",
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@vitejs/plugin-react": "^4",
    "vite": "^5"
  }
}
```

- `"type": "module"` is required for Vite ES module builds.
- No `react-scripts`, no `typescript`, no `@types/*` packages.

---

## Entry Point (`src/main.jsx`)

```jsx
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

## Root HTML (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AppName</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- `index.html` lives at the **project root**, not inside `public/`.
- The script tag points to `src/main.jsx` directly.

---

## Common Tauri Frontend Imports

```js
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { writeTextFile, mkdir, exists, readDir, readFile, remove, copyFile } from "@tauri-apps/plugin-fs";
import { appDataDir, basename, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
```

---

## Migrating from TypeScript (TSX → JSX)

When converting an existing TypeScript/CRA project to JavaScript/Vite, follow these steps in order.

### 1. Swap dependencies

Remove:
```
typescript  @types/react  @types/react-dom  @types/node  react-scripts
```

Add:
```
vite  @vitejs/plugin-react  @tauri-apps/cli
```

Add `"type": "module"` to `package.json`.

### 2. Replace config files

- Delete `tsconfig.json` (and `tsconfig.node.json` if present).
- Delete `react-app-env.d.ts` or any `.d.ts` shim files.
- Add `vite.config.js` (see template above).
- Update `package.json` scripts to use `vite` / `vite build`.

### 3. Rename files

- `*.tsx` → `*.jsx`
- `*.ts` → `*.js`
- `vite.config.ts` → `vite.config.js`
- Move `index.html` from `public/` to the project root and update the script tag to `<script type="module" src="/src/main.jsx"></script>`.

### 4. Strip TypeScript from source files

For each `.jsx` / `.js` file:

- **Remove interface and type declarations** — `interface Props { ... }`, `type Foo = ...`
- **Remove generic type parameters** — `useState<string>("")` → `useState("")`, `useRef<HTMLDivElement>(null)` → `useRef(null)`
- **Remove type annotations** — `const name: string = ""` → `const name = ""`, function parameters like `(value: number)` → `(value)`
- **Remove return type annotations** — `function foo(): void { }` → `function foo() { }`
- **Remove `as` casts** — `value as string` → `value`
- **Remove non-null assertions** — `element!.focus()` → `element.focus()`
- **Remove `React.FC<Props>`** — `const App: React.FC<Props> = (props) =>` → just `export default function App(props)`
- **Replace enums** — TypeScript `enum Direction { Up, Down }` → plain object `const DIRECTION = { Up: "Up", Down: "Down" }`
- **Remove event type annotations** — `(e: React.ChangeEvent<HTMLInputElement>)` → `(e)`

### 5. Update tauri.conf.json

- Change `frontendDist` from `"../build"` to `"../dist"`
- Change `devUrl` from `"http://localhost:3000"` to `"http://localhost:1420"`
- Add `"beforeDevCommand": "npm run dev"` and `"beforeBuildCommand": "npm run build"`

### 6. Verify

```bash
npm install
npm run tauri dev
```

Fix any remaining errors — they are almost always leftover type syntax or a missing `vite.config.js` field.

---

## General Rules

- No TypeScript. JavaScript only.
- No CSS frameworks. Write plain CSS utility classes.
- No single-letter variable names except `e` for inline event handlers.
- All named functions use the `function` keyword, declared before `return`.
- Async operations always use `await`.
- Dark UI theme by default.
- Keep Rust commands thin — do logic in `command.rs`, register in `lib.rs`, keep `main.rs` minimal.
- Build tool is **Vite**, not Create React App. Never use `react-scripts`.
