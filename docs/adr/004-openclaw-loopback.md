# ADR-004: OpenClaw Gateway loopback

## Decision

OpenClaw Gateway remains reachable only on localhost (e.g. port 18789 on this host). AitoolMgr Host Agent connects locally and forwards **desensitized metadata** only.

## Local evidence (2026-08-15)

`openclaw gateway status --json` reports CLI `2026.7.1-2` and configured `--port 18789`; scheduled task was `loaded: false` at check time.

## Consequences

Never bind Gateway to `0.0.0.0` for AitoolMgr. Do not claim agent/session event field names until hello-ok fixtures exist (P5).
