import { api } from "../api";
import type { ApprovalRequest } from "../types";

export function ApprovalsPanel({ approvals }: { approvals: ApprovalRequest[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Action Approvals</h2>
        <span className="count-chip">{approvals.length} pending</span>
      </div>
      <div className="card-body">
        {approvals.length === 0 && (
          <div className="empty">No actions awaiting approval.</div>
        )}
        {approvals.map((a) => (
          <div className="approval" key={a.id}>
            <h3>{a.toolName} needs approval</h3>
            <div className="reason">{a.reason}</div>
            <div className="args">{JSON.stringify(a.args, null, 2)}</div>
            <div className="btns">
              <button
                className="btn approve"
                onClick={() => api.resolveApproval(a.id, true)}
              >
                Approve
              </button>
              <button
                className="btn deny"
                onClick={() => api.resolveApproval(a.id, false)}
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
