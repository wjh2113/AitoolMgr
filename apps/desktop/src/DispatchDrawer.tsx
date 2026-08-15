import { useEffect, useMemo, useState } from "react";
import type { MachineInfo, ToolKind } from "@toolmgr/core";
import { TOOL_LABELS } from "@toolmgr/core";

export function DispatchDrawer(props: {
  machines: MachineInfo[];
  adapters: Array<{ kind: ToolKind; capabilities: Record<string, boolean> }>;
  busy: boolean;
  onDispatch: (input: {
    prompt: string;
    tool: ToolKind;
    cwd?: string;
    machineId?: string;
  }) => Promise<void> | void;
}) {
  const tools = props.adapters
    .filter((a) => a.capabilities.dispatch)
    .map((a) => a.kind);

  const onlineMachines = useMemo(
    () => props.machines.filter((m) => m.online),
    [props.machines],
  );

  const [machineId, setMachineId] = useState("");
  const [tool, setTool] = useState<ToolKind | "">("");
  const [prompt, setPrompt] = useState(
    "Summarize the current repo structure in 5 bullets.",
  );
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    if (!machineId && onlineMachines.length === 1) {
      setMachineId(onlineMachines[0]!.id);
    }
  }, [onlineMachines, machineId]);

  useEffect(() => {
    // Reset tool when machine changes — must pick PC first, then tool.
    setTool("");
  }, [machineId]);

  const canPickTool = Boolean(machineId);
  const canSubmit = Boolean(machineId && tool && prompt.trim());

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Dispatch</h2>
      </div>
      <p className="empty" style={{ marginTop: 0 }}>
        先选 PC，再选工具，然后填写任务。
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!machineId || !tool) return;
          void props.onDispatch({
            prompt,
            tool,
            cwd: cwd || undefined,
            machineId,
          });
        }}
      >
        <label>
          1. 监控 / 目标 PC
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            required
          >
            <option value="">请先选择 PC…</option>
            {props.machines.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.online}>
                {m.name} {m.online ? "" : "(offline)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          2. 工具
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as ToolKind)}
            disabled={!canPickTool}
            required
          >
            <option value="">
              {canPickTool ? "请选择工具…" : "请先选择 PC"}
            </option>
            {tools.map((t) => (
              <option key={t} value={t}>
                {TOOL_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label>
          3. Prompt
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!canPickTool}
          />
        </label>
        <label>
          Working directory
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Leave empty for agent cwd"
            disabled={!canPickTool}
          />
        </label>
        <button
          className="btn primary"
          type="submit"
          disabled={props.busy || !canSubmit}
        >
          {props.busy ? "Sending…" : "Send task"}
        </button>
      </form>
    </section>
  );
}
