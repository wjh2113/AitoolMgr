# ADR-001: Overall architecture

## Decision

Use **Control Plane + Host Agent + Tool Adapters**. Host Agents dial out to the Control Plane (WebSocket). OpenClaw Gateway stays on loopback; Host Agent normalizes events before forwarding.

## Why

- Matches AitoolMgr plan: see / judge / alert / command
- Avoids scanning machines or exposing gateway ports on LAN
- Isolates vendor protocol differences behind adapters

## Consequences

- Existing Node `packages/agent` acts as interim Control Plane + Host Agent for P1
- Go Host Agent and mTLS deferred to P2/P6
- SimulatorAdapter is allowed only when `TOOLMGR_SIMULATOR=true` (default true in development)
