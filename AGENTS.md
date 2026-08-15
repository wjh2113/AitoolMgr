# AGENTS.md — AitoolMgr

You are implementing **AitoolMgr** (repo folder: `toolMgr`): a cross macOS/Windows monitoring & command center for AI coding tools and OpenClaw Agents.

## Source of truth

1. Product/implementation plan: keep a copy under `docs/AITOOLMGR_PRODUCT_AND_IMPLEMENTATION_PLAN.md`
2. Staged prompts: `docs/prompts/`
3. Evidence matrix: `docs/research/evidence-matrix.md`
4. ADRs: `docs/adr/`

## Non-negotiable rules

- Confirmed events only for `supported` capabilities; otherwise `UNKNOWN` / `UNSUPPORTED` with reason.
- Separate **official** vs **inferred** signals; every state needs `source`, `confidence`, `timestamp`, `evidenceType`.
- No private DB reverse-engineering; no default OCR; no auto-click approve.
- Do not upload code bodies, full prompts, secrets, or screenshots by default.
- Implement **one stage at a time** (P0→P8). Do not fake later-stage adapters.

## Current codebase note

This repo began as a lighter `toolMgr` prototype (Node agent + React UI). Evolve toward the AitoolMgr architecture without deleting working paths; prefer additive packages under `packages/contracts`, `packages/adapter-sdk`, digital-office UI, and docs.

## Commands

```bash
npm install
npm run build
npm start
npm test
```
