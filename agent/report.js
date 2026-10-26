// agent/report.js
// Self-contained HTML evidence report generator summarizing execution traces, audits, and screenshots.
// Creates an immutable, human-inspectable post-run audit document.

import fs from "fs";
import path from "path";

// Escape HTML utility
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateRunReport({
  runId,
  task,
  finalStatus,
  summary,
  verification,
  memory = {},
  steps = [],
  approvals = [],
  interactions = [],
  durationSeconds = 0,
  llmCalls = 0,
  runDir
}) {
  const isVerified = finalStatus.includes("VERIFIED") && !finalStatus.includes("NOT");
  const isBlocked = finalStatus.includes("BLOCKED");
  const isFailed = finalStatus.includes("FAILED") || finalStatus.includes("NOT VERIFIED");

  let badgeClass = "badge-verified";
  if (isBlocked) badgeClass = "badge-blocked";
  else if (isFailed) badgeClass = "badge-failed";

  // Verification section HTML
  let verificationHtml = "";
  if (verification) {
    const evidenceList = (verification.evidence || [])
      .map((e) => `<li style="color: #166534; margin-bottom: 0.35rem;">✓ ${escapeHtml(e)}</li>`)
      .join("");
    const problemsList = (verification.problems || [])
      .map((p) => `<li style="color: #991b1b; margin-bottom: 0.35rem;">✗ ${escapeHtml(p)}</li>`)
      .join("");

    verificationHtml = `
      <div class="card">
        <h2 class="section-title">🔍 Independent Verification Audit</h2>
        <div style="margin-bottom: 1rem;">
          <span class="badge ${verification.verified ? "badge-verified" : "badge-failed"}" style="font-size: 0.9rem;">
            ${verification.verified ? "AUDIT PASSED: Ground Truth Confirmed" : "AUDIT FAILED: Discrepancies Detected"}
          </span>
        </div>
        
        ${evidenceList ? `
          <div style="margin-bottom: 1rem;">
            <strong style="color: #166534; display: block; margin-bottom: 0.5rem;">Verified Facts:</strong>
            <ul style="list-style: none; padding-left: 0.5rem;">${evidenceList}</ul>
          </div>
        ` : ""}

        ${problemsList ? `
          <div style="margin-bottom: 1rem;">
            <strong style="color: #991b1b; display: block; margin-bottom: 0.5rem;">Discrepancies / Unmet Criteria:</strong>
            <ul style="list-style: none; padding-left: 0.5rem;">${problemsList}</ul>
          </div>
        ` : ""}

        ${verification.finalScreenshot ? `
          <div style="margin-top: 1rem;">
            <span style="font-size: 0.85rem; color: #64748b;">Final Verification Screenshot:</span><br>
            <a href="${verification.finalScreenshot}" target="_blank">
              <img src="${verification.finalScreenshot}" style="max-width: 320px; border: 1px solid #cbd5e1; border-radius: 4px; margin-top: 0.5rem;" alt="Verification Screenshot">
            </a>
          </div>
        ` : ""}
      </div>
    `;
  }

  // Working memory table
  const memoryRows = Object.entries(memory)
    .map(
      ([k, v]) => `
      <tr>
        <td style="font-weight: 600; font-family: monospace; width: 200px;">${escapeHtml(k)}</td>
        <td><code>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}</code></td>
      </tr>
    `
    )
    .join("");

  // Approvals & Interactions
  let approvalsHtml = "";
  if (approvals.length > 0 || interactions.length > 0) {
    const approvalRows = approvals
      .map(
        (a) => `
        <tr>
          <td>${escapeHtml(a.action)} ('${escapeHtml(a.label)}')</td>
          <td>${escapeHtml(a.thought)}</td>
          <td>
            <span class="badge ${a.approved ? "badge-verified" : "badge-failed"}">
              ${a.approved ? "APPROVED" : "DENIED"}
            </span>
          </td>
          <td style="font-size: 0.8rem; color: #64748b;">${escapeHtml(a.timestamp)}</td>
        </tr>
      `
      )
      .join("");

    const interactionRows = interactions
      .map(
        (q) => `
        <tr>
          <td>${escapeHtml(q.question)}</td>
          <td style="font-weight: 600; color: #1e40af;">"${escapeHtml(q.answer)}"</td>
          <td style="font-size: 0.8rem; color: #64748b;">${escapeHtml(q.timestamp)}</td>
        </tr>
      `
      )
      .join("");

    approvalsHtml = `
      <div class="card">
        <h2 class="section-title">🛡️ Human Interactions & Security Guardrails</h2>
        ${approvals.length > 0 ? `
          <h3 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: #475569;">Sensitive Action Approvals (Hard Guard):</h3>
          <table style="margin-bottom: 1.5rem;">
            <thead><tr><th>Action</th><th>Reason</th><th>Decision</th><th>Time</th></tr></thead>
            <tbody>${approvalRows}</tbody>
          </table>
        ` : ""}

        ${interactions.length > 0 ? `
          <h3 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: #475569;">Operator Clarifications (Soft Policy):</h3>
          <table>
            <thead><tr><th>Question</th><th>User Answer</th><th>Time</th></tr></thead>
            <tbody>${interactionRows}</tbody>
          </table>
        ` : ""}
      </div>
    `;
  }

  // Steps Timeline
  const stepsHtml = steps
    .map((s) => {
      const stepPadded = String(s.step).padStart(2, "0");
      const screenshotFilename = `step-${stepPadded}.png`;
      const screenshotExists = fs.existsSync(path.join(runDir, screenshotFilename));

      return `
      <div class="timeline-step">
        <div class="step-header">
          <span class="step-badge">Step ${s.step}</span>
          <span class="step-time">${escapeHtml(s.timestamp || "")}</span>
        </div>
        <div class="step-body">
          <div style="margin-bottom: 0.5rem;">
            <strong>🤔 Thought:</strong> ${escapeHtml(s.thought)}
          </div>
          <div style="margin-bottom: 0.5rem;">
            <strong>▶ Action:</strong> <code>${escapeHtml(s.action)}(${escapeHtml(JSON.stringify(s.args))})</code>
          </div>
          <div style="margin-bottom: 0.75rem;">
            <strong>${s.ok ? "✓" : "✗"} Result:</strong>
            <pre class="result-box">${escapeHtml(String(s.result || "").trim().slice(0, 400))}</pre>
          </div>
          ${
            screenshotExists
              ? `
            <div class="thumbnail-container">
              <a href="${screenshotFilename}" target="_blank">
                <img src="${screenshotFilename}" alt="Step ${s.step}" class="thumbnail">
              </a>
              <span style="font-size: 0.75rem; color: #64748b; margin-top: 0.25rem;">Click to view full screenshot</span>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Karya Execution Report - ${escapeHtml(runId)}</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --text: #0f172a;
      --border: #e2e8f0;
      --primary: #2563eb;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem 1rem;
      font-size: 14px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }
    .title { font-size: 1.6rem; font-weight: 700; color: #0f172a; }
    .meta { color: #64748b; font-size: 0.9rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .section-title {
      font-size: 1.15rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: #1e293b;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-verified { background: #dcfce7; color: #15803d; }
    .badge-blocked { background: #fef3c7; color: #b45309; }
    .badge-failed { background: #fee2e2; color: #b91c1c; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
    th { background: #f8fafc; padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
    td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); vertical-align: top; }
    .timeline-step {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 1rem;
      overflow: hidden;
    }
    .step-header {
      background: #f1f5f9;
      padding: 0.5rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .step-badge { font-weight: 700; color: #334155; }
    .step-time { font-size: 0.75rem; color: #64748b; }
    .step-body { padding: 1rem; }
    .result-box {
      background: #f8fafc;
      border: 1px solid var(--border);
      padding: 0.5rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: monospace;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .thumbnail-container { margin-top: 0.75rem; }
    .thumbnail {
      max-width: 240px;
      max-height: 150px;
      border: 1px solid var(--border);
      border-radius: 4px;
      display: block;
      transition: transform 0.15s;
    }
    .thumbnail:hover { transform: scale(1.02); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">Karya Execution Evidence Report</h1>
        <p class="meta">Run Identifier: <code>${escapeHtml(runId)}</code> &bull; Duration: ${durationSeconds.toFixed(1)}s &bull; LLM Calls: ${llmCalls}</p>
      </div>
      <div>
        <span class="badge ${badgeClass}" style="font-size: 1rem; padding: 0.4rem 1rem;">
          ${escapeHtml(finalStatus)}
        </span>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">📋 Task Specification & Summary</h2>
      <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.75rem; color: #1e3a8a;">
        "${escapeHtml(task)}"
      </div>
      <div>
        <strong>Agent Summary:</strong> ${escapeHtml(summary || "(No summary provided)")}
      </div>
    </div>

    ${verificationHtml}

    ${approvalsHtml}

    ${Object.keys(memory).length > 0 ? `
      <div class="card">
        <h2 class="section-title">🧠 Working Memory (Retained Facts)</h2>
        <table>
          <thead><tr><th>Attribute</th><th>Retained Value</th></tr></thead>
          <tbody>${memoryRows}</tbody>
        </table>
      </div>
    ` : ""}

    <div class="card">
      <h2 class="section-title">⏱️ Step-by-Step Execution Timeline (${steps.length} steps)</h2>
      ${stepsHtml}
    </div>
  </div>
</body>
</html>`;

  const reportPath = path.join(runDir, "report.html");
  fs.writeFileSync(reportPath, html, "utf-8");
  return reportPath;
}
