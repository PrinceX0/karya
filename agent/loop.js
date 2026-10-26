// agent/loop.js
// Autonomous task execution loop implementing the Sense -> Plan -> Act -> Observe cycle.
// Integrates failure detection, human-in-the-loop guardrails, independent verification, and report generation.

import fs from "fs";
import path from "path";
import readline from "readline";
import { chatJSON, getLLMCallCount } from "./llm.js";
import * as browser from "./browser.js";
import { getTool } from "./tools.js";
import { Guard } from "./guard.js";
import { verifyRun } from "./verifier.js";
import { generateRunReport } from "./report.js";
import {
  buildSystemPrompt,
  buildPlanningMessages,
  buildStepUserMessage
} from "./prompts.js";

// Terminal interaction helper for asking the user clarifications or approvals
export function askUserInTerminal(question) {
  return new Promise((resolve) => {
    // If not a TTY or running in non-interactive mode, check environment auto-replies
    if (!process.stdin.isTTY && !process.env.INTERACTIVE) {
      console.log(`\n❓ [Prompt to User]: ${question}`);
      const autoAnswer = process.env.AUTO_REPLY || "yes";
      console.log(`[Auto-Reply in non-interactive environment]: ${autoAnswer}`);
      return resolve(autoAnswer);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`\n❓ [Agent Question]: ${question}\nYour answer > `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Generate unique identifier for this run execution
function generateRunId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `run-${timestamp}`;
}

export async function runAgentLoop({
  task,
  companyContextPath = path.resolve(process.cwd(), "company/context.md"),
  maxSteps = 25,
  maxDurationMs = Number(process.env.MAX_DURATION_MS) || (6 * 60 * 1000), // 6 minutes default budget
  askHuman = askUserInTerminal
}) {
  const startTime = Date.now();
  const runId = generateRunId();
  const runDir = path.resolve(process.cwd(), "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\n======================================================`);
  console.log(`🚀 Starting Karya Agent [${runId}]`);
  console.log(`Task: "${task}"`);
  console.log(`======================================================\n`);

  // Load company context markdown
  if (!fs.existsSync(companyContextPath)) {
    throw new Error(`Company context file not found at ${companyContextPath}`);
  }
  const companyContext = fs.readFileSync(companyContextPath, "utf-8");

  // Initialize guardrails
  const guard = new Guard({
    askHuman: async (question) => {
      const answer = await askHuman(question);
      guard.recordInteraction(question, answer);
      return answer;
    }
  });

  // Step 1: UNDERSTAND + PLAN
  console.log("📋 Phase 1: Understanding task and formulating plan...");
  let planningMessages = buildPlanningMessages(task, companyContext);
  let planOutput = await chatJSON(planningMessages);

  // If information is missing, ask the user and replan
  while (planOutput.missing_info) {
    console.log(`\n⚠️ Missing Information Detected: ${planOutput.missing_info}`);
    const humanAnswer = await guard.askHuman(planOutput.missing_info);
    guard.recordInteraction(planOutput.missing_info, humanAnswer);
    const enrichedTask = `${task}\n(User clarification: "${humanAnswer}")`;
    planningMessages = buildPlanningMessages(enrichedTask, companyContext);
    planOutput = await chatJSON(planningMessages);
  }

  const { goal, success_criteria = [], plan = [] } = planOutput;

  console.log(`\n🎯 Objective Goal: ${goal}`);
  console.log(`✅ Success Criteria:`);
  success_criteria.forEach((crit, i) => console.log(`   ${i + 1}. ${crit}`));
  console.log(`📌 Operational Plan:`);
  plan.forEach((step, i) => console.log(`   ${i + 1}. ${step}`));
  console.log(`------------------------------------------------------\n`);

  // Launch the browser
  await browser.launchBrowser({ headless: false, slowMo: 250 });

  // Initialize loop state
  const systemPrompt = buildSystemPrompt(companyContext);
  const memory = {};
  const history = [];
  const trace = {
    runId,
    task,
    goal,
    successCriteria: success_criteria,
    plan,
    status: "in_progress",
    summary: "",
    result: null,
    memory,
    steps: [],
    approvals: [],
    interactions: []
  };

  const ctx = {
    memory,
    browser,
    askHuman: async (question) => {
      const answer = await guard.askHuman(question);
      guard.recordInteraction(question, answer);
      return answer;
    },
    finished: false,
    finishResult: null
  };

  let currentObservation = `Initial State: The browser is open. No page has been loaded yet.
To start your investigation, use the 'open_url' tool to navigate to one of the company apps:
- Accounts Payable Mail: http://localhost:4000/mail
- Finance ERP: http://localhost:4000/erp`;

  // Loop detection tracker
  let lastActionSignature = "";
  let repeatActionCount = 0;
  let loopWarning = false;

  let finalStatus = "FAILED ❌";
  let verificationData = null;
  let reVerificationAttempts = 0;

  // Step 2: ACT -> OBSERVE Loop
  let step = 1;

  try {
    for (step = 1; step <= maxSteps; step++) {
      // Check execution time budget (6 minutes)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxDurationMs) {
        console.warn(`\n⏱️ Execution budget exceeded: ${Math.round(elapsedMs / 1000)}s >= 360s limit.`);
        trace.status = "failed";
        trace.summary = `Exceeded maximum duration budget (6 minutes). Completed ${step - 1} steps before time expired.`;
        finalStatus = "FAILED ❌";
        break;
      }

      console.log(`\n--- Step ${step}/${maxSteps} ---`);

      // Build fresh single-turn prompt: [system message + one user message]
      const stepUserMessage = buildStepUserMessage({
        task,
        goal,
        successCriteria: success_criteria,
        plan,
        memory,
        history,
        observation: currentObservation,
        loopWarning
      });

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: stepUserMessage }
      ];

      // Call LLM for single action decision
      const decision = await chatJSON(messages);
      const thought = decision.thought || "(No thought provided)";
      const actionName = decision.action || "";
      const args = decision.args || {};

      console.log(`🤔 Thought: ${thought}`);
      console.log(`▶ Action: ${actionName}(${JSON.stringify(args)})`);

      // Loop detection tracking
      const actionSignature = `${actionName}:${JSON.stringify(args)}`;
      if (actionSignature === lastActionSignature) {
        repeatActionCount++;
      } else {
        lastActionSignature = actionSignature;
        repeatActionCount = 1;
      }
      loopWarning = repeatActionCount >= 3;

      let toolResult = "";
      let isOk = true;

      const tool = getTool(actionName);
      if (!tool) {
        isOk = false;
        toolResult = `ERROR: Tool '${actionName}' does not exist. Available tools: open_url, click, type_text, select_option, remember, ask_user, finish.`;
      } else {
        // Enforce Guardrails (URL allowlist & human-in-the-loop approval)
        const guardCheck = await guard.checkAction({
          actionName,
          args,
          thought,
          tool,
          browser
        });

        if (!guardCheck.allowed) {
          isOk = false;
          toolResult = guardCheck.observation;
        } else {
          try {
            toolResult = await tool.run(args, ctx);
            isOk = true;
          } catch (err) {
            isOk = false;
            // Failure recovery: tool errors never crash run, prefixed with ERROR:
            toolResult = `ERROR: ${err.message}`;
          }
        }
      }

      // Print first line preview of outcome
      const firstLine = String(toolResult).split("\n")[0] || "";
      console.log(`${isOk ? "✓" : "✗"} ${firstLine.slice(0, 100)}`);

      // Update observation for the next step
      if (
        typeof toolResult === "string" &&
        (actionName === "open_url" ||
          actionName === "click" ||
          actionName === "type_text" ||
          actionName === "select_option")
      ) {
        currentObservation = toolResult;
      } else if (actionName === "remember" || actionName === "ask_user" || !isOk) {
        // If a non-navigational tool executed or error occurred, append latest page view
        try {
          const pageObs = await browser.observe();
          currentObservation = `${toolResult}\n\nCURRENT PAGE VIEW:\n${pageObs}`;
        } catch {
          currentObservation = String(toolResult);
        }
      } else {
        currentObservation = String(toolResult);
      }

      // Save screenshot
      const stepPadded = String(step).padStart(2, "0");
      const screenshotPath = path.join(runDir, `step-${stepPadded}.png`);
      try {
        await browser.screenshot(screenshotPath);
      } catch (screenshotErr) {}

      // Append trace event
      const stepEvent = {
        step,
        thought,
        action: actionName,
        args,
        result: toolResult,
        ok: isOk,
        timestamp: new Date().toISOString()
      };

      history.push(stepEvent);
      trace.steps.push(stepEvent);
      trace.approvals = guard.getApprovalLog();
      trace.interactions = guard.getInteractionLog();

      // Persist trace after every step
      fs.writeFileSync(path.join(runDir, "trace.json"), JSON.stringify(trace, null, 2));

      // Handle finish invocation
      if (ctx.finished) {
        const claimedStatus = ctx.finishResult.status;

        if (claimedStatus === "done") {
          // Independent Verification against privileged ground truth
          verificationData = await verifyRun({
            task,
            successCriteria: success_criteria,
            claimedSummary: ctx.finishResult.summary,
            claimedResult: ctx.finishResult.result,
            browser,
            runDir
          });

          if (verificationData.verified) {
            finalStatus = "VERIFIED ✅";
            trace.status = "done";
            trace.summary = ctx.finishResult.summary;
            trace.result = ctx.finishResult.result;
            break;
          } else if (reVerificationAttempts < 1) {
            // Re-attempt loop once if verification failed
            reVerificationAttempts++;
            ctx.finished = false;
            console.log(`\n⚠️ Verification discrepancies found. Re-injecting into agent loop for correction...`);
            currentObservation = `ERROR: Independent verification failed: ${verificationData.problems.join("; ")}. Please correct the record or finish the missing work.`;
            continue;
          } else {
            finalStatus = "NOT VERIFIED ❌";
            trace.status = "failed";
            trace.summary = ctx.finishResult.summary;
            trace.result = ctx.finishResult.result;
            break;
          }
        } else if (claimedStatus === "blocked") {
          finalStatus = "BLOCKED ⏸";
          trace.status = "blocked";
          trace.summary = ctx.finishResult.summary;
          trace.result = ctx.finishResult.result;
          break;
        } else {
          finalStatus = "FAILED ❌";
          trace.status = "failed";
          trace.summary = ctx.finishResult.summary;
          trace.result = ctx.finishResult.result;
          break;
        }
      }
    }

    if (!ctx.finished && step > maxSteps) {
      finalStatus = "FAILED ❌";
      trace.status = "failed";
      trace.summary = `Exceeded maximum step budget of ${maxSteps} steps without finishing.`;
    }
  } finally {
    // Keep browser open for 1.5s before closing
    await new Promise((r) => setTimeout(r, 1500));
    await browser.closeBrowser();
  }

  const durationSeconds = (Date.now() - startTime) / 1000;
  trace.finalStatus = finalStatus;
  trace.durationSeconds = durationSeconds;
  trace.verification = verificationData;

  // Persist final trace
  fs.writeFileSync(path.join(runDir, "trace.json"), JSON.stringify(trace, null, 2));

  // Generate self-contained HTML evidence report
  const reportPath = generateRunReport({
    runId,
    task,
    finalStatus,
    summary: trace.summary,
    verification: verificationData,
    memory,
    steps: trace.steps,
    approvals: guard.getApprovalLog(),
    interactions: guard.getInteractionLog(),
    durationSeconds,
    llmCalls: getLLMCallCount(),
    runDir
  });

  console.log(`\n======================================================`);
  console.log(`🏁 Agent Execution Finished`);
  console.log(`Final Status: ${finalStatus}`);
  console.log(`Summary:      ${trace.summary}`);
  console.log(`Report:       ${reportPath}`);
  console.log(`======================================================\n`);

  return {
    runId,
    finalStatus,
    summary: trace.summary,
    result: trace.result,
    verification: verificationData,
    reportPath
  };
}
