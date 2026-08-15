import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fuseEvent, maybeMarkStalled } from "./fusion.js";
import type { TelemetryEvent } from "./types.js";

function evt(partial: Partial<TelemetryEvent> & Pick<TelemetryEvent, "state" | "evidenceSource">): TelemetryEvent {
  return {
    eventId: "e1",
    timestamp: partial.timestamp ?? "2026-08-15T12:00:00.000Z",
    machineId: "m1",
    toolType: "openclaw",
    toolInstanceId: "gw1",
    agentId: "researcher",
    confidence: partial.confidence ?? 1,
    evidenceType: partial.evidenceType ?? "test",
    sensitivity: "metadata_only",
    ...partial,
    state: partial.state,
    evidenceSource: partial.evidenceSource,
  };
}

describe("fuseEvent", () => {
  it("applies official event", () => {
    const seat = fuseEvent(
      undefined,
      evt({ state: "EXECUTING", evidenceSource: "official_event" }),
    );
    assert.equal(seat.state, "EXECUTING");
    assert.equal(seat.confidence, 1);
  });

  it("does not let inferred overwrite fresh official", () => {
    const official = fuseEvent(
      undefined,
      evt({
        state: "EXECUTING",
        evidenceSource: "official_event",
        timestamp: "2026-08-15T12:00:00.000Z",
      }),
    );
    const next = fuseEvent(
      official,
      evt({
        state: "IDLE",
        evidenceSource: "inferred",
        confidence: 0.4,
        timestamp: "2026-08-15T12:00:01.000Z",
      }),
      { now: Date.parse("2026-08-15T12:00:01.000Z") },
    );
    assert.equal(next.state, "EXECUTING");
  });

  it("marks stalled after silence", () => {
    const seat = fuseEvent(
      undefined,
      evt({
        state: "THINKING",
        evidenceSource: "simulated",
        timestamp: "2026-08-15T12:00:00.000Z",
      }),
    );
    const stalled = maybeMarkStalled(seat, Date.parse("2026-08-15T12:03:00.000Z"), 120_000);
    assert.equal(stalled.state, "STALLED");
    assert.equal(stalled.needsAttention, true);
  });
});
