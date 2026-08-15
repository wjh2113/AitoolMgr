# ToolMgr

Desktop programming-tool orchestrator for **Cursor**, **Codex**, **Claude Code**, and **Coze**.

Supports **Windows** and **macOS** (same codebase). Linux works for the agent/UI in browser mode.

## Quick start (Windows / macOS)

```bash
npm install
cp .env.example .env   # on Windows: copy .env.example .env
npm run build
npm start              # agent + UI (cross-platform)
```

Platform-specific launchers:

| OS | Command |
|----|---------|
| Windows | `scripts\start-windows.cmd` or `npm run start:win` |
| macOS | `chmod +x scripts/start-macos.sh && ./scripts/start-macos.sh` or `npm run start:mac` |

Separate processes:

```bash
npm run start:agent    # http://127.0.0.1:7788
npm run dev:desktop    # http://127.0.0.1:5173
```

## Data directories (per OS)

| OS | Default data dir |
|----|------------------|
| Windows | `%LOCALAPPDATA%\ToolMgr` |
| macOS | `~/Library/Application Support/ToolMgr` |
| Linux | `~/.local/share/toolmgr` |

Override with `TOOLMGR_DATA_DIR`.

**Database:** SQLite file `aitoolmgr.sqlite` inside the data dir (Node built-in `node:sqlite`).  
Legacy `toolmgr.json` is auto-migrated once then renamed to `toolmgr.json.migrated`.  
Inspect: `GET /api/db/stats`.

## Build installers

```bash
# Optional once: install Electron pack tooling
npm run pack:deps

# On a Windows machine (or Windows CI):
npm run pack:win
# → apps/desktop/release/ToolMgr-Setup-*-win-x64.exe (+ portable)

# On a macOS machine (Intel or Apple Silicon):
npm run pack:mac
# → apps/desktop/release/ToolMgr-*-mac-*.dmg
```

Notes:

- macOS `.dmg` / `.app` must be built **on macOS**.
- Windows `.exe` must be built **on Windows** (or a Windows CI runner).
- Packaged app embeds the local agent and uses OS-native title bar (traffic lights on macOS).
- `pack:*` scripts can also pull `electron-builder` via `npx` if you skip `pack:deps`.

## Multi-machine (Win + Mac together)

1. Hub (e.g. Windows): `TOOLMGR_IS_HUB=true`, `TOOLMGR_HOST=0.0.0.0`, set `TOOLMGR_PAIRING_TOKEN`.
2. Worker (e.g. MacBook): `TOOLMGR_IS_HUB=false`, `TOOLMGR_HUB_URL=http://<hub-ip>:7788`, same token.
3. Prefer Tailscale / LAN so both OSes can reach the hub.

## Feishu

```
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
FEISHU_WEBHOOK_SECRET=optional
```

## Hooks

```bash
node scripts/install-hooks/install-claude-hooks.mjs http://127.0.0.1:7788
node scripts/install-hooks/install-cursor-hooks.mjs . http://127.0.0.1:7788
```

## Packages

| Path | Role |
|------|------|
| `packages/core` | Shared types / handoff helpers |
| `packages/adapters` | Tool adapters + Win/macOS platform helpers |
| `packages/notify-feishu` | Feishu webhook cards |
| `packages/agent` | Local agent + hub |
| `apps/desktop` | React UI + Electron shell |
| `scripts/` | Cross-platform start + hook installers |
