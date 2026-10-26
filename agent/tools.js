// agent/tools.js
// Tool registry defining all actions the agent can perform.
// Decouples tool execution and schemas from the main agent loop.

import * as browser from "./browser.js";

// Tool Registry: list of available capabilities exposed to the LLM planner
export const tools = [
  {
    name: "open_url",
    description: "Navigate the browser to a specific URL and return the page observation.",
    args: {
      url: "string - Full web URL to open (e.g., 'http://localhost:4000/mail')"
    },
    risk: "read",
    run: async (args, ctx) => {
      if (!args.url) throw new Error("open_url requires a 'url' argument.");
      return await (ctx.browser || browser).goto(args.url);
    }
  },
  {
    name: "click",
    description: "Click an interactive element identified by its [id] tag in the latest observation.",
    args: {
      id: "string | number - The numeric agent ID of the element to click (e.g., 3)"
    },
    risk: "write",
    run: async (args, ctx) => {
      if (args.id === undefined || args.id === null) throw new Error("click requires an 'id' argument.");
      return await (ctx.browser || browser).click(args.id);
    }
  },
  {
    name: "type_text",
    description: "Clear and type text into an input or textarea element by its [id] tag.",
    args: {
      id: "string | number - The numeric agent ID of the input field",
      text: "string | number - The text to type into the field"
    },
    risk: "write",
    run: async (args, ctx) => {
      if (args.id === undefined || args.id === null) throw new Error("type_text requires an 'id' argument.");
      if (args.text === undefined || args.text === null) throw new Error("type_text requires a 'text' argument.");
      return await (ctx.browser || browser).type(args.id, args.text);
    }
  },
  {
    name: "select_option",
    description: "Select an option in a dropdown <select> element by its [id] tag.",
    args: {
      id: "string | number - The numeric agent ID of the select dropdown",
      option: "string - The label or value of the option to select"
    },
    risk: "write",
    run: async (args, ctx) => {
      if (args.id === undefined || args.id === null) throw new Error("select_option requires an 'id' argument.");
      if (!args.option) throw new Error("select_option requires an 'option' argument.");
      return await (ctx.browser || browser).select(args.id, args.option);
    }
  },
  {
    name: "remember",
    description: "Store extracted data (amount, invoiceNumber, dueDate, vendor, etc.) into working memory. You can store multiple facts at once with { facts: { amount, dueDate, invoiceNumber, vendor } } or a single { key, value }.",
    args: {
      facts: "optional object - Multiple key-value pairs to store simultaneously (e.g. { amount: 42500, dueDate: '2026-11-20', invoiceNumber: 'INV-IT-1021' })",
      key: "optional string - The attribute name if storing a single fact",
      value: "optional any - The extracted value if storing a single fact"
    },
    risk: "read",
    run: async (args, ctx) => {
      if (args.facts && typeof args.facts === "object") {
        Object.assign(ctx.memory, args.facts);
        return `Stored in working memory: ${JSON.stringify(args.facts)}`;
      }
      if (!args.key) throw new Error("remember requires 'facts' object or 'key' argument.");
      if (args.value === undefined) throw new Error("remember requires a 'value' argument.");

      ctx.memory[args.key] = args.value;
      return `Stored in working memory: ${args.key} = ${JSON.stringify(args.value)}`;
    }
  },
  {
    name: "ask_user",
    description: "Ask the human operator a clarification question or request required approval in the terminal.",
    args: {
      question: "string - The plain English question or approval request to present to the user"
    },
    risk: "read",
    run: async (args, ctx) => {
      if (!args.question) throw new Error("ask_user requires a 'question' argument.");
      if (typeof ctx.askHuman !== "function") {
        throw new Error("Human interaction callback is not configured in ctx.");
      }
      const answer = await ctx.askHuman(args.question);
      ctx.memory[`user_answer_${Date.now()}`] = { question: args.question, answer };
      return `User responded: "${answer}"`;
    }
  },
  {
    name: "finish",
    description: "Conclude task execution once all success criteria are met or if permanently blocked.",
    args: {
      status: "'done' | 'failed' | 'blocked' - Final execution outcome",
      summary: "string - Human-readable summary of what was accomplished or reason for stopping",
      result: "any - Structured result details (e.g. created invoice number, amount)"
    },
    risk: "read",
    run: async (args, ctx) => {
      ctx.finished = true;
      ctx.finishResult = {
        status: args.status || "done",
        summary: args.summary || "Task completed.",
        result: args.result || null
      };
      return `Task finished with status [${ctx.finishResult.status}]: ${ctx.finishResult.summary}`;
    }
  }
];

// Lookup a tool definition by name
export function getTool(name) {
  return tools.find((t) => t.name === name) || null;
}

// Generate formatted tool specifications for system prompts
export function formatToolList() {
  return tools
    .map((t) => {
      const argsSchema = Object.entries(t.args)
        .map(([argName, desc]) => `    - ${argName}: ${desc}`)
        .join("\n");
      return `- ${t.name}: ${t.description} (risk: ${t.risk})\n  Arguments:\n${argsSchema}`;
    })
    .join("\n\n");
}
