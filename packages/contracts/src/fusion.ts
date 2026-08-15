import type { EvidenceSource, SeatSnapshot, TelemetryEvent, UnifiedState } from "./types.js";

const OFFICIAL: EvidenceSource[] = [
  "official_event",
  "cli_structured",
  "ide_extension",
  "hook",
  "simulated",
];

function isOfficial(source: EvidenceSource): boolean {
  return OFFICIAL.includes(source);
}

function attentionStates(state: UnifiedState): boolean {
  return (
    state === "WAITING_APPROVAL" ||
    state === "WAITING_INPUT" ||
    state === "FAILED" ||
    state === "STALLED"
  );
}

export interface FusionOptions {
  debounceMs?: number;
  stallMs?: number;
  now?: number;
}

/** Merge a telemetry event into a seat snapshot with trust rules. */
export function fuseEvent(
  current: SeatSnapshot | undefined,
  event: TelemetryEvent,
  opts: FusionOptions = {},
): SeatSnapshot {
  const now = opts.now ?? Date.parse(event.timestamp);
  const debounceMs = opts.debounceMs ?? 400;
  const stallMs = opts.stallMs ?? 120_000;

  const base: SeatSnapshot = current ?? {
    seatId: event.agentId
      ? `${event.toolInstanceId}:${event.agentId}`
      : event.toolInstanceId,
    machineId: event.machineId,
    toolInstanceId: event.toolInstanceId,
    agentId: event.agentId,
    toolType: event.toolType,
    title: event.agentId ?? event.toolInstanceId,
    state: "UNKNOWN",
    confidence: 0,
    evidenceSource: "unknown",
    evidenceType: "none",
    needsAttention: false,
    since: event.timestamp,
    updatedAt: event.timestamp,
    durationMs: 0,
    capabilities: {
      monitor: true,
      streamEvents: false,
      startTask: false,
      continueTask: false,
      approve: false,
      cancel: false,
      windowObservation: false,
    },
    simulated: event.simulated,
  };

  const incomingOfficial = isOfficial(event.evidenceSource);
  const currentOfficial = isOfficial(base.evidenceSource);
  const age = now - Date.parse(base.updatedAt);

  // Inferred must not overwrite newer official
  if (!incomingOfficial && currentOfficial && age < stallMs) {
    return {
      ...base,
      durationMs: now - Date.parse(base.since),
    };
  }

  // Debounce non-attention chatter
  if (
    current &&
    current.state === event.state &&
    age < debounceMs &&
    !attentionStates(event.state)
  ) {
    return {
      ...current,
      durationMs: now - Date.parse(current.since),
    };
  }

  const stateChanged = !current || current.state !== event.state;
  return {
    ...base,
    state: event.state,
    confidence: event.confidence,
    evidenceSource: event.evidenceSource,
    evidenceType: event.evidenceType,
    evidenceSummary: event.evidenceSummary,
    summary: event.summary ?? base.summary,
    needsAttention: Boolean(event.needsAttention ?? attentionStates(event.state)),
    since: stateChanged ? event.timestamp : base.since,
    updatedAt: event.timestamp,
    durationMs: now - Date.parse(stateChanged ? event.timestamp : base.since),
    simulated: event.simulated ?? base.simulated,
    agentId: event.agentId ?? base.agentId,
    title: event.agentId
      ? `${event.toolType} / ${event.agentId}`
      : base.title,
  };
}

export function maybeMarkStalled(
  seat: SeatSnapshot,
  nowMs: number,
  stallMs = 120_000,
): SeatSnapshot {
  if (
    seat.state === "THINKING" ||
    seat.state === "EXECUTING" ||
    seat.state === "STARTING"
  ) {
    const silent = nowMs - Date.parse(seat.updatedAt);
    if (silent >= stallMs) {
      return {
        ...seat,
        state: "STALLED",
        confidence: Math.min(seat.confidence, 0.7),
        evidenceSource: "inferred",
        evidenceType: "stall_timeout",
        evidenceSummary: `No progress for ${Math.round(silent / 1000)}s`,
        needsAttention: true,
        updatedAt: new Date(nowMs).toISOString(),
      };
    }
  }
  return { ...seat, durationMs: nowMs - Date.parse(seat.since) };
}
