// agent/loop.js
// Autonomous task execution loop implementing the Sense -> Plan -> Act -> Observe cycle.
// Coordinates LLM decision-making, browser interactions, memory retention, and evidence logging.

import fs from "fs";
import path from "path";
import readline from "readline";
import { chatJSON } from "./llm.js";
import * as browser from "./browser.js";
import { getTool } from "./tools.js";
import {
  buildSystemPrompt,
  buildPlanningMessages,
  buildStepUserMessage
} from "./prompts.js";

// Terminal interaction helper for asking the user clarifications or approvals
export function askUserInTerminal(question) {
  return new Promise((resolve) => {
    // If not a TTY or running in non-interactive mode, provide safe default
    if (!process.stdin.isTTY && !process.env.INTERACTIVE) {
      console.log(`\n❓ [Prompt to User]: ${question}`);
      console.log(`[Auto-Reply in non-interactive environment]: Approved / Yes`);
      return resolve("Yes");
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
  askHuman = askUserInTerminal
}) {
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

  // Step 1: UNDERSTAND + PLAN
  console.log("📋 Phase 1: Understanding task and formulating plan...");
  let planningMessages = buildPlanningMessages(task, companyContext);
  let planOutput = await chatJSON(planningMessages);

  // If information is missing, ask the user and replan
  while (planOutput.missing_info) {
    console.log(`\n⚠️ Missing Information Detected: ${planOutput.missing_info}`);
    const humanAnswer = await askHuman(planOutput.missing_info);
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
    steps: []
  };

  const ctx = {
    memory,
    browser,
    askHuman,
    finished: false,
    finishResult: null
  };

  let currentObservation = `Initial State: The browser is open. No page has been loaded yet.
To start your investigation, use the 'open_url' tool to navigate to one of the company apps:
- Accounts Payable Mail: http://localhost:4000/mail
- Finance ERP: http://localhost:4000/erp`;

  // Step 2: ACT -> OBSERVE Loop
  let step = 1;

  try {
    for (step = 1; step <= maxSteps; step++) {
      console.log(`\n--- Step ${step}/${maxSteps} ---`);

      // Build fresh single-turn prompt: [system message + one user message]
      const stepUserMessage = buildStepUserMessage({
        task,
        goal,
        successCriteria: success_criteria,
        plan,
        memory,
        history,
        observation: currentObservation
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

      let toolResult = "";
      let isOk = true;

      const tool = getTool(actionName);
      if (!tool) {
        isOk = false;
        toolResult = `Error: Tool '${actionName}' does not exist. Available tools: open_url, click, type_text, select_option, remember, ask_user, finish.`;
      } else {
        try {
          toolResult = await tool.run(args, ctx);
          isOk = true;
        } catch (err) {
          isOk = false;
          toolResult = `Tool execution error: ${err.message}`;
        }
      }

      // Print first line preview of outcome
      const firstLine = String(toolResult).split("\n")[0] || "";
      console.log(`${isOk ? "✓" : "✗"} ${firstLine.slice(0, 100)}`);

      // Update observation for the next step
      if (typeof toolResult === "string" && (actionName === "open_url" || actionName === "click" || actionName === "type_text" || actionName === "select_option")) {
        currentObservation = toolResult;
      } else if (actionName === "remember" || actionName === "ask_user") {
        // If a non-navigational tool executed, append latest browser observation so agent retains visual context
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
      } catch (screenshotErr) {
        // Non-fatal if page was closed or navigating
      }

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

      // Persist trace after every step
      fs.writeFileSync(path.join(runDir, "trace.json"), JSON.stringify(trace, null, 2));

      // Stop if finish tool was invoked
      if (ctx.finished) {
        trace.status = ctx.finishResult.status;
        trace.summary = ctx.finishResult.summary;
        trace.result = ctx.finishResult.result;
        fs.writeFileSync(path.join(runDir, "trace.json"), JSON.stringify(trace, null, 2));
        break;
      }
    }

    if (!ctx.finished && step > maxSteps) {
      trace.status = "failed";
      trace.summary = `Exceeded maximum step budget of ${maxSteps} steps without finishing.`;
      fs.writeFileSync(path.join(runDir, "trace.json"), JSON.stringify(trace, null, 2));
    }
  } finally {
    // Keep browser open for 2 seconds so humans can see final state, then close
    await new Promise((r) => setTimeout(r, 2000));
    await browser.closeBrowser();
  }

  console.log(`\n======================================================`);
  console.log(`🏁 Agent Execution Finished`);
  console.log(`Status:  ${trace.status.toUpperCase()}`);
  console.log(`Summary: ${trace.summary}`);
  console.log(`Evidence saved to: runs/${runId}/`);
  console.log(`======================================================\n`);

  return trace;
}
