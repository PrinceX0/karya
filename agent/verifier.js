// agent/verifier.js
// Independent verification engine checking task outcomes against privileged ground-truth state.
// Conducts out-of-band audit without trusting the agent's self-reported claims.

import path from "path";
import { chatJSON } from "./llm.js";

// Queries privileged internal state and audits completion criteria
export async function verifyRun({
  task,
  successCriteria = [],
  claimedSummary = "",
  claimedResult = null,
  browser = null,
  runDir = ""
}) {
  console.log("\n🔍 Initiating Independent Verification Audit...");

  // 1. Capture privileged ground truth from sandbox API
  let groundTruth = null;
  try {
    const res = await fetch("http://localhost:4000/api/state");
    if (!res.ok) {
      throw new Error(`Privileged API returned status ${res.status}`);
    }
    groundTruth = await res.json();
  } catch (err) {
    console.error(`[Verifier] Failed to fetch ground truth from /api/state: ${err.message}`);
    return {
      verified: false,
      evidence: [],
      problems: [`Could not access privileged verification API: ${err.message}`]
    };
  }

  // 2. Take final verification screenshot
  let finalScreenshotPath = null;
  if (browser && runDir) {
    try {
      finalScreenshotPath = path.join(runDir, "final-verification.png");
      await browser.screenshot(finalScreenshotPath);
    } catch {}
  }

  // 3. Prepare independent auditor LLM evaluation
  const systemPrompt = `You are an independent quality auditor for Acme Corp. You independently verify whether an autonomous AI task worker actually accomplished its assigned task based STRICTLY on the privileged ground-truth company state and the task success criteria. Do not trust the agent's claims without concrete evidence in the ground truth.`;

  const criteriaText = successCriteria.length > 0
    ? successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "(No explicit criteria specified)";

  const userPrompt = `=== ASSIGNED TASK ===
"${task}"

=== SUCCESS CRITERIA ===
${criteriaText}

=== AGENT'S CLAIMED SUMMARY ===
"${claimedSummary}"

=== AGENT'S CLAIMED RESULT ===
${JSON.stringify(claimedResult, null, 2)}

=== PRIVILEGED GROUND-TRUTH STATE (FROM BACKEND STORE) ===
${JSON.stringify(groundTruth, null, 2)}

=== AUDITING INSTRUCTIONS ===
Evaluate whether the assigned task was genuinely and accurately completed:
- Verify that required ERP records were created with exact vendor, invoiceNumber, amount, and due date.
- Verify that no duplicate invoices were created.
- Verify that unauthorized actions were NOT performed (e.g. marking unpaid invoices as paid unless explicitly commanded).
- For informational/calculation tasks, verify that computed totals match the relevant ground-truth invoices.

Respond with valid JSON only:
{
  "verified": true or false,
  "evidence": [
    "Specific factual confirmations from ground truth (e.g., 'ERP contains INV-IT-1021 with amount ₹42,500 due 2026-11-20')"
  ],
  "problems": [
    "Discrepancies, missing records, or failure reasons if verified is false"
  ]
}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  try {
    const auditOutput = await chatJSON(messages);
    const verified = Boolean(auditOutput.verified);
    const evidence = Array.isArray(auditOutput.evidence) ? auditOutput.evidence : [];
    const problems = Array.isArray(auditOutput.problems) ? auditOutput.problems : [];

    console.log(`[Verifier] Audit Result: ${verified ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);
    if (evidence.length > 0) {
      console.log(`[Verifier] Evidence:`);
      evidence.forEach((e) => console.log(`   - ${e}`));
    }
    if (problems.length > 0) {
      console.log(`[Verifier] Issues:`);
      problems.forEach((p) => console.log(`   - ${p}`));
    }

    return {
      verified,
      evidence,
      problems,
      groundTruth,
      finalScreenshot: finalScreenshotPath ? path.basename(finalScreenshotPath) : null
    };
  } catch (llmErr) {
    console.error(`[Verifier] LLM audit failed: ${llmErr.message}`);
    return {
      verified: false,
      evidence: [],
      problems: [`Audit LLM evaluation failed: ${llmErr.message}`]
    };
  }
}
