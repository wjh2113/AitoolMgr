import { useEffect, useMemo, useState } from "react";

export type UnifiedState =
  | "OFFLINE"
  | "IDLE"
  | "STARTING"
  | "THINKING"
  | "EXECUTING"
  | "WAITING_APPROVAL"
  | "WAITING_INPUT"
  | "SUCCEEDED"
  | "FAILED"
  | "STALLED"
  | "UNKNOWN";

export interface OfficeSeat {
  seatId: string;
  machineId: string;
  toolInstanceId: string;
  agentId?: string;
  toolType: string;
  title: string;
  state: UnifiedState;
  confidence: number;
  evidenceSource: string;
  evidenceType: string;
  evidenceSummary?: string;
  summary?: string;
  needsAttention: boolean;
  since: string;
  updatedAt: string;
  durationMs: number;
  simulated?: boolean;
  capabilities: Record<string, boolean>;
}

export interface OfficeSnapshot {
  generatedAt: string;
  simulatedMode: boolean;
  machines: Array<{ id: string; name: string; os: string; online: boolean }>;
  tools: Array<{
    id: string;
    machineId?: string;
    displayName: string;
    toolType: string;
    simulated?: boolean;
  }>;
  agents: Array<{
    id: string;
    agentKey: string;
    toolInstanceId: string;
    displayName: string;
  }>;
  seats: OfficeSeat[];
  alerts: Array<{
    id: string;
    severity: string;
    title: string;
    body: string;
    evidenceSummary: string;
    objectId?: string;
  }>;
}

type StatusFilter = "all" | "busy" | "attention" | "idle" | "abnormal";

const BUSY: UnifiedState[] = [
  "STARTING",
  "THINKING",
  "EXECUTING",
  "WAITING_APPROVAL",
  "WAITING_INPUT",
];
const ABNORMAL: UnifiedState[] = ["FAILED", "STALLED", "OFFLINE", "UNKNOWN"];

function screenClass(state: UnifiedState): string {
  switch (state) {
    case "IDLE":
      return "screen-off";
    case "THINKING":
    case "STARTING":
    case "EXECUTING":
    case "SUCCEEDED":
      return "screen-on";
    case "WAITING_APPROVAL":
      return "screen-yellow";
    case "WAITING_INPUT":
      return "screen-wait";
    case "FAILED":
      return "screen-red";
    case "STALLED":
      return "screen-stall";
    case "OFFLINE":
      return "screen-offline";
    default:
      return "screen-unknown";
  }
}

function roleLabel(state: UnifiedState): string {
  switch (state) {
    case "IDLE":
      return "休息中";
    case "THINKING":
      return "思考中…";
    case "EXECUTING":
      return "执行工具";
    case "WAITING_APPROVAL":
      return "举手等待审批";
    case "WAITING_INPUT":
      return "等待输入";
    case "FAILED":
      return "故障";
    case "STALLED":
      return "卡住";
    case "OFFLINE":
      return "离线";
    case "UNKNOWN":
      return "未知";
    case "SUCCEEDED":
      return "完成";
    case "STARTING":
      return "启动中";
    default:
      return state;
  }
}

function machineSeatStats(seats: OfficeSeat[]) {
  return {
    total: seats.length,
    busy: seats.filter((s) => BUSY.includes(s.state)).length,
    attention: seats.filter((s) => s.needsAttention).length,
  };
}

export function DigitalOffice(props: {
  office: OfficeSnapshot | null;
  onRefresh: () => void;
}) {
  const [machineId, setMachineId] = useState<string | null>(null);
  const [toolInstanceId, setToolInstanceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);

  const machines = props.office?.machines ?? [];
  const tools = props.office?.tools ?? [];
  const allSeats = props.office?.seats ?? [];

  // Auto-select sole machine for convenience, but still show PC step if multiple.
  useEffect(() => {
    if (!machineId && machines.length === 1) {
      setMachineId(machines[0]!.id);
    }
  }, [machines, machineId]);

  useEffect(() => {
    if (machineId && !machines.some((m) => m.id === machineId)) {
      setMachineId(null);
      setToolInstanceId(null);
      setSelectedSeatId(null);
    }
  }, [machines, machineId]);

  const toolsOnMachine = useMemo(() => {
    if (!machineId) return [];
    const fromTools = tools.filter(
      (t) => t.machineId === machineId || (!t.machineId && tools.length),
    );
    if (fromTools.length) {
      // Prefer tools that declare machineId; if missing, infer from seats
      return fromTools.filter((t) => {
        if (t.machineId) return t.machineId === machineId;
        return allSeats.some(
          (s) => s.toolInstanceId === t.id && s.machineId === machineId,
        );
      });
    }
    // Fallback: derive tool cards from seats on this machine
    const map = new Map<string, { id: string; displayName: string; toolType: string }>();
    for (const s of allSeats.filter((x) => x.machineId === machineId)) {
      if (!map.has(s.toolInstanceId)) {
        map.set(s.toolInstanceId, {
          id: s.toolInstanceId,
          displayName: s.title.split(" / ")[0] || s.toolType,
          toolType: s.toolType,
        });
      }
    }
    return [...map.values()];
  }, [machineId, tools, allSeats]);

  useEffect(() => {
    if (
      toolInstanceId &&
      !toolsOnMachine.some((t) => t.id === toolInstanceId)
    ) {
      setToolInstanceId(null);
      setSelectedSeatId(null);
    }
  }, [toolsOnMachine, toolInstanceId]);

  const seats = useMemo(() => {
    if (!machineId || !toolInstanceId) return [];
    return allSeats.filter((s) => {
      if (s.machineId !== machineId) return false;
      if (s.toolInstanceId !== toolInstanceId) return false;
      if (statusFilter === "busy") return BUSY.includes(s.state);
      if (statusFilter === "attention") return s.needsAttention;
      if (statusFilter === "idle")
        return s.state === "IDLE" || s.state === "SUCCEEDED";
      if (statusFilter === "abnormal") return ABNORMAL.includes(s.state);
      return true;
    });
  }, [allSeats, machineId, toolInstanceId, statusFilter]);

  const selected = seats.find((s) => s.seatId === selectedSeatId) ?? null;

  useEffect(() => {
    if (selectedSeatId && !seats.some((s) => s.seatId === selectedSeatId)) {
      setSelectedSeatId(null);
    }
  }, [seats, selectedSeatId]);

  const selectedMachine = machines.find((m) => m.id === machineId) ?? null;
  const selectedTool = toolsOnMachine.find((t) => t.id === toolInstanceId) ?? null;

  function selectMachine(id: string) {
    setMachineId(id);
    setToolInstanceId(null);
    setSelectedSeatId(null);
    setStatusFilter("all");
  }

  function selectTool(id: string) {
    setToolInstanceId(id);
    setSelectedSeatId(null);
    setStatusFilter("all");
  }

  function clearMachine() {
    setMachineId(null);
    setToolInstanceId(null);
    setSelectedSeatId(null);
  }

  function clearTool() {
    setToolInstanceId(null);
    setSelectedSeatId(null);
  }

  return (
    <section className="panel office-panel">
      <div className="panel-head">
        <h2>数字办公室 {props.office?.simulatedMode ? "· SIMULATED" : ""}</h2>
        <button className="btn" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      {props.office?.simulatedMode ? (
        <p className="sim-banner">
          流程：先选监控 PC → 再选该机上的工具 → 查看工位。当前为模拟数据。
        </p>
      ) : (
        <p className="sim-banner">流程：先选监控 PC → 再选该机上的工具 → 查看工位。</p>
      )}

      <nav className="breadcrumb-row" aria-label="监控路径">
        <button type="button" className="crumb" onClick={clearMachine}>
          全部 PC
        </button>
        {selectedMachine ? (
          <>
            <span className="crumb-sep">/</span>
            <button type="button" className="crumb" onClick={clearTool}>
              {selectedMachine.name}
            </button>
          </>
        ) : null}
        {selectedTool ? (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb current">{selectedTool.displayName}</span>
          </>
        ) : null}
      </nav>

      {/* Step 1: pick PC */}
      {!machineId ? (
        <div className="picker-block">
          <h3 className="step-title">
            <span className="step-num">1</span> 选择要监控的 PC
          </h3>
          <div className="pc-grid">
            {machines.map((m) => {
              const stats = machineSeatStats(
                allSeats.filter((s) => s.machineId === m.id),
              );
              const toolCount = tools.filter(
                (t) =>
                  t.machineId === m.id ||
                  allSeats.some(
                    (s) => s.machineId === m.id && s.toolInstanceId === t.id,
                  ),
              ).length;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`pc-card ${m.online ? "" : "offline"}`}
                  onClick={() => selectMachine(m.id)}
                >
                  <strong>{m.name}</strong>
                  <small>
                    {m.os} · {m.online ? "在线" : "离线"}
                  </small>
                  <small>
                    工具约 {toolCount || "—"} · 工位 {stats.total}
                    {stats.attention ? ` · 待处理 ${stats.attention}` : ""}
                  </small>
                </button>
              );
            })}
            {!machines.length ? (
              <p className="empty">暂无机器。请先启动 Host Agent / 接入节点。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Step 2: pick tool on that PC */}
      {machineId && !toolInstanceId ? (
        <div className="picker-block">
          <h3 className="step-title">
            <span className="step-num">2</span> 选择「{selectedMachine?.name}」上的工具
          </h3>
          <div className="tool-grid">
            {toolsOnMachine.map((t) => {
              const toolSeats = allSeats.filter(
                (s) =>
                  s.machineId === machineId && s.toolInstanceId === t.id,
              );
              const stats = machineSeatStats(toolSeats);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tool-card"
                  onClick={() => selectTool(t.id)}
                >
                  <strong>{t.displayName}</strong>
                  <small>{t.toolType}</small>
                  <small>
                    工位 {stats.total}
                    {stats.busy ? ` · 忙碌 ${stats.busy}` : ""}
                    {stats.attention ? ` · 需处理 ${stats.attention}` : ""}
                  </small>
                </button>
              );
            })}
            {!toolsOnMachine.length ? (
              <p className="empty">这台 PC 上还没有可监控工具。</p>
            ) : null}
          </div>
          <button type="button" className="btn" onClick={clearMachine}>
            ← 返回选 PC
          </button>
        </div>
      ) : null}

      {/* Step 3: seats for PC + tool */}
      {machineId && toolInstanceId ? (
        <>
          <div className="filter-row">
            <button type="button" className="btn" onClick={clearTool}>
              ← 换工具
            </button>
            {(
              [
                ["all", "全部"],
                ["busy", "忙碌"],
                ["attention", "需处理"],
                ["idle", "空闲"],
                ["abnormal", "异常"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn ${statusFilter === id ? "primary" : ""}`}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="office-floor">
            <div className="office-room">
              <h3>
                {selectedMachine?.name} · {selectedTool?.displayName}
              </h3>
              <div className="seat-grid">
                {seats.map((seat) => (
                  <button
                    type="button"
                    key={seat.seatId}
                    className={`seat ${selectedSeatId === seat.seatId ? "active" : ""}`}
                    onClick={() => setSelectedSeatId(seat.seatId)}
                  >
                    <div className={`monitor ${screenClass(seat.state)}`}>
                      <span>{roleLabel(seat.state)}</span>
                    </div>
                    <div className="seat-meta">
                      <strong>{seat.title}</strong>
                      <small>
                        {seat.state}
                        {seat.evidenceSource === "simulated" ||
                        seat.evidenceSource === "official_event"
                          ? " · 已确认/模拟"
                          : ` · 置信度 ${Math.round(seat.confidence * 100)}%`}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
              {!seats.length ? <p className="empty">该工具下没有匹配工位。</p> : null}
            </div>
          </div>
        </>
      ) : null}

      {selected ? (
        <div className="seat-detail">
          <h3>工位详情</h3>
          <p>
            <strong>{selected.title}</strong> · {selected.toolType}
          </p>
          <p>
            PC：{selectedMachine?.name} · 工具：{selectedTool?.displayName}
          </p>
          <p>
            状态 {selected.state} · 持续 {Math.round(selected.durationMs / 1000)}s
          </p>
          <p>摘要：{selected.summary || "—"}</p>
          <p>
            证据：{selected.evidenceSource} / {selected.evidenceType}
            {selected.evidenceSummary ? ` — ${selected.evidenceSummary}` : ""}
          </p>
          <div className="actions">
            <button
              className="btn"
              type="button"
              disabled={!selected.capabilities.approve}
            >
              审批
            </button>
            <button
              className="btn"
              type="button"
              disabled={!selected.capabilities.cancel}
            >
              取消
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!selected.capabilities.startTask}
              onClick={() => {
                void fetch("/api/office/sim/start", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    toolInstanceId: selected.toolInstanceId,
                    agentId: selected.agentId,
                    task: "Simulated desk task",
                  }),
                }).then(props.onRefresh);
              }}
            >
              模拟派发
            </button>
          </div>
        </div>
      ) : null}

      {(props.office?.alerts?.length ?? 0) > 0 && machineId ? (
        <div className="alert-strip">
          <h3>待处理（当前 PC）</h3>
          {props.office!.alerts
            .filter((a) =>
              allSeats.some(
                (s) =>
                  s.machineId === machineId &&
                  (a.objectId === s.seatId || a.title.includes(s.title)),
              ),
            )
            .map((a) => (
              <div key={a.id} className="row">
                <div className="state-dot state-needs_attention" />
                <div>
                  <h3>{a.title}</h3>
                  <p>
                    {a.body} · {a.evidenceSummary}
                  </p>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
