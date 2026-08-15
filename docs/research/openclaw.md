# OpenClaw research (P0)

- Local CLI: `OpenClaw 2026.7.1-2 (0790d9f)`
- `openclaw gateway status --json` works; shows gateway port **18789**, Windows Scheduled Task not loaded at check time
- Docs: external apps via WebSocket/RPC; events not replayed → snapshot recovery required
- Do **not** hardcode `session.tool` / `session.approval` field schemas until captured fixtures from hello-ok / live events (P5)
- Multi-agent object model is a product requirement; wire format still unknown pending spike

Refs:
- https://docs.openclaw.ai/gateway/external-apps
- https://docs.openclaw.ai/gateway
- https://github.com/openclaw/openclaw/blob/main/docs/plugins/hooks.md
