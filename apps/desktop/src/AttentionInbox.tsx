import { useState } from "react";
import type { ToolSession } from "@toolmgr/core";
import { TOOL_LABELS } from "@toolmgr/core";

export function AttentionInbox(props: {
  sessions: ToolSession[];
  onSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onReply: (id: string, text: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [active, setActive] = useState<string | null>(null);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Attention inbox</h2>
        <span className="pill">{props.sessions.length}</span>
      </div>
      <div className="inbox-list">
        {props.sessions.map((s) => (
          <div key={s.id} className="row" onClick={() => props.onSelect(s.id)}>
            <div className="state-dot state-needs_attention" />
            <div>
              <h3>
                {TOOL_LABELS[s.tool]} · {s.attentionReason ?? "attention"}
              </h3>
              <p>{s.summary}</p>
              {active === s.id ? (
                <div className="form" style={{ marginTop: 8 }}>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply / follow-up prompt"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    className="btn primary"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onReply(s.id, reply);
                      setReply("");
                      setActive(null);
                    }}
                  >
                    Send reply
                  </button>
                </div>
              ) : null}
            </div>
            <div className="actions">
              <button
                className="btn primary"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onApprove(s.id);
                }}
              >
                Approve
              </button>
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive(s.id);
                }}
              >
                Reply
              </button>
            </div>
          </div>
        ))}
        {!props.sessions.length ? (
          <p className="empty">Nothing needs you right now.</p>
        ) : null}
      </div>
    </section>
  );
}
