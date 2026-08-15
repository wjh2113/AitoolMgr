# Evidence Matrix (P0)

Access date: 2026-08-15  
Host: Windows (current workspace machine)

## Installed versions (local check)

| Tool | Version / note | Evidence |
|------|----------------|----------|
| Codex CLI | `codex-cli 0.130.0` | `codex --version` |
| Claude Code | `2.1.187` | `claude --version` |
| Cursor | `3.14.7` | `cursor --version` |
| OpenClaw | `2026.7.1-2 (0790d9f)` | `openclaw --version` |
| VS Code / code bin | present via Cursor `codeBin` and Microsoft VS Code | `where code` |
| Cursor `agent` CLI | unavailable on PATH | `agent` not found |

## Capability matrix

Legend: `confirmed` = local version + docs/sample; `inferred` = process/window only; `unsupported` / `unknown` / `unavailable`.

### Codex

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| discover | confirmed | CLI on PATH | Instance = local CLI |
| read status | unknown | Need App Server event samples | Do not invent event names |
| stream events | unknown | Docs: App Server stdio JSONL | Spike required before P4 |
| startTask | inferred | `codex exec` used in existing adapter | Structured mapping TBD |
| continueTask | unknown | — | |
| cancel | inferred | process kill in prototype | |
| approve | unknown | App Server approvals claimed in docs | Need fixtures |
| sessions | unknown | — | |
| agents/subagents | unsupported | N/A for Codex CLI model | |

Docs: https://developers.openai.com/codex/app-server (accessed 2026-08-15)

### Cursor

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| discover | confirmed | Cursor IDE + version | |
| CLI startTask | unknown | Docs: Cursor CLI overview | `agent` binary missing here |
| IDE stream events | unsupported | No public approval lifecycle API confirmed | Show UNKNOWN/inferred only |
| hooks observe | inferred | Community/hooks docs; prototype hooks exist | Heuristic |
| Background Agents API | unknown | Official API docs exist; needs key + spike | |
| approve/cancel IDE | unsupported | Must not fake | |

Docs: https://docs.cursor.com/en/cli/overview (accessed 2026-08-15)

### VS Code

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Extension API tasks/terminal/test/debug | confirmed (docs) | Official Extension API | Implement in P3 extension |
| Workbench DOM scrape | unsupported | Explicitly forbidden by plan | |
| discover workspace/git | confirmed (docs) | Extension API | P3 |

Docs: https://code.visualstudio.com/api/ (accessed 2026-08-15)

### OpenClaw

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| discover CLI | confirmed | `openclaw --version` 2026.7.1-2 | Installed |
| Gateway connect / hello | unknown | Docs: external apps WS/RPC | Need live gateway + fixtures |
| health / presence | unknown | Docs + `gateway status --json` spike | |
| multi-agent list | unknown | Object model in product plan | Must not invent field names |
| agent + agent.wait | unknown | Docs | P5 |
| session.tool / session.approval | unknown | Docs list these categories | Confirm via hello-ok events |
| plugin hooks metadata | unknown | Plugin hooks docs | Optional observer plugin P5 |
| expose gateway to LAN | unsupported (policy) | Plan: loopback only | Host Agent forwards metadata |

Docs:
- https://docs.openclaw.ai/gateway/external-apps
- https://docs.openclaw.ai/gateway
- https://github.com/openclaw/openclaw/blob/main/docs/plugins/hooks.md

## Prototype note

Existing `toolMgr` adapters (fake/codex/cursor/claude/coze) are **prototype** paths. They must not claim AitoolMgr `confirmed` production capabilities until fixtures land.
