// agent/index.js
// Command-line entry point for the Karya autonomous task worker.
// Reads CLI input arguments and initiates the autonomous loop.

import { runAgentLoop } from "./loop.js";

// Extract task string from command line arguments
const args = process.argv.slice(2);
const taskArgument = args.join(" ").trim();

const task =
  taskArgument ||
  "Find the latest invoice from Initech, extract the amount and due date, enter it into our ERP, and tell me once it is done.";

async function main() {
  try {
    await runAgentLoop({ task });
  } catch (error) {
    console.error("\n❌ Fatal Agent Execution Error:", error.message);
    process.exit(1);
  }
}

main();
