# Codex research (P0)

- Local version: `codex-cli 0.130.0`
- Commands observed: `exec`, `app-server` (**experimental**), `mcp-server`, `resume`, …
- Plan preference: App Server stdio JSONL for deep integration; do not require experimental remote WebSocket for production.
- Prototype: existing `@toolmgr/adapters` CodexAdapter uses `codex exec` only → mark as inferred/partial until P4 fixtures.

Refs: https://developers.openai.com/codex/app-server
