# ADR-002: State trust model

## Decision

Three trust levels:

1. **Confirmed** — official API / structured CLI / hooks / extension events (`confidence ≈ 1.0`)
2. **Inferred** — process, window text, log growth (`confidence < 1`, must show %)
3. **Unknown** — insufficient evidence; display `UNKNOWN`, never invent precision

Official events always beat older inferred events. Inferred must never overwrite newer official state.

## Consequences

TelemetryEvent requires: `source`, `confidence`, `timestamp`, `evidenceType`, optional `evidenceSummary`.
