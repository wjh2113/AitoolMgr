import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MachineInfo, Task, ToolSession } from "@toolmgr/core";
import { TOOL_LABELS } from "@toolmgr/core";

const stateColor: Record<string, string> = {
  idle: "#3ecf8e",
  busy: "#4db6ff",
  needs_attention: "#f0b429",
  error: "#ef6b6b",
  offline: "#6b7c74",
};

export function FleetGraph(props: {
  machines: MachineInfo[];
  sessions: ToolSession[];
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    props.machines.forEach((m, mi) => {
      nodes.push({
        id: `m:${m.id}`,
        position: { x: 40 + mi * 280, y: 30 },
        data: { label: `${m.name}${m.online ? "" : " (offline)"}` },
        style: {
          background: m.online ? "#1a2e26" : "#222",
          color: "#e7f3ec",
          border: `1px solid ${m.online ? "#3ecf8e" : "#555"}`,
          borderRadius: 12,
          padding: 8,
          fontSize: 12,
          minWidth: 140,
        },
      });
    });

    props.sessions.forEach((s, si) => {
      const machineIndex = Math.max(
        0,
        props.machines.findIndex((m) => m.id === s.machineId),
      );
      nodes.push({
        id: `s:${s.id}`,
        position: {
          x: 20 + machineIndex * 280 + (si % 3) * 20,
          y: 140 + (si % 6) * 70,
        },
        data: {
          label: `${TOOL_LABELS[s.tool] ?? s.tool}\n${s.state}`,
        },
        style: {
          background: "#12201b",
          color: "#e7f3ec",
          border: `2px solid ${
            props.selectedId === s.id
              ? "#fff"
              : stateColor[s.state] ?? "#6b7c74"
          }`,
          borderRadius: 12,
          padding: 8,
          fontSize: 11,
          whiteSpace: "pre-line",
          minWidth: 120,
        },
      });
      edges.push({
        id: `e-m-s-${s.id}`,
        source: `m:${s.machineId}`,
        target: `s:${s.id}`,
        style: { stroke: "rgba(180,220,200,0.25)" },
      });
    });

    for (const t of props.tasks.filter((x) => x.sourceTaskId && x.assignedSessionId)) {
      const sourceTask = props.tasks.find((x) => x.id === t.sourceTaskId);
      const fromSession = sourceTask?.assignedSessionId;
      const toSession = t.assignedSessionId;
      if (!fromSession || !toSession) continue;
      edges.push({
        id: `handoff-${t.id}`,
        source: `s:${fromSession}`,
        target: `s:${toSession}`,
        animated: true,
        label: "handoff",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#f0b429" },
      });
    }

    return { nodes, edges };
  }, [props.machines, props.sessions, props.tasks, props.selectedId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, node) => {
        if (node.id.startsWith("s:")) props.onSelect(node.id.slice(2));
      }}
    >
      <Background gap={18} size={1} color="rgba(180,220,200,0.08)" />
    </ReactFlow>
  );
}
