// agent/browser.js
// Playwright wrapper automating a visible Chromium browser with "Set-of-Marks" visual text tagging.
// Translates DOM elements into labeled interactive indices ([1], [2]...) for LLM planning.

import fs from "fs";
import path from "path";
import { chromium } from "playwright";

let browserInstance = null;
let contextInstance = null;
let pageInstance = null;

// Initialize Playwright Chromium browser
export async function launchBrowser({ headless = false, slowMo = 250 } = {}) {
  if (browserInstance) {
    return pageInstance;
  }

  // Allow env override if specified, otherwise respect default false / 250
  const isHeadless = process.env.HEADLESS === "true" ? true : headless;
  const speed = process.env.SLOWMO ? Number(process.env.SLOWMO) : slowMo;

  browserInstance = await chromium.launch({
    headless: isHeadless,
    slowMo: speed
  });

  contextInstance = await browserInstance.newContext({
    viewport: { width: 1280, height: 800 }
  });

  pageInstance = await contextInstance.newPage();
  return pageInstance;
}

// Close browser on finish or shutdown
export async function closeBrowser() {
  if (pageInstance) {
    try {
      await pageInstance.close();
    } catch {}
    pageInstance = null;
  }
  if (contextInstance) {
    try {
      await contextInstance.close();
    } catch {}
    contextInstance = null;
  }
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}

// Extract current page state, visible text, and numbered interactive elements
export async function observe() {
  if (!pageInstance) {
    throw new Error("Browser has not been launched yet. Call launchBrowser() first.");
  }

  // Ensure DOM is loaded before evaluating
  await pageInstance.waitForLoadState("domcontentloaded").catch(() => {});
  await pageInstance.waitForTimeout(100);

  // Tag all visible interactive elements with data-agent-id="N" and collect their attributes
  const elementsData = await pageInstance.evaluate(() => {
    // Clean up any previously assigned agent IDs
    document.querySelectorAll("[data-agent-id]").forEach((el) => {
      el.removeAttribute("data-agent-id");
    });

    const isVisible = (elem) => {
      const rect = elem.getBoundingClientRect();
      const style = window.getComputedStyle(elem);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0 &&
        elem.type !== "hidden"
      );
    };

    const selector = "a[href], button, input, select, textarea";
    const candidates = Array.from(document.querySelectorAll(selector));
    const items = [];
    let counter = 1;

    for (const el of candidates) {
      if (!isVisible(el)) continue;

      const agentId = String(counter++);
      el.setAttribute("data-agent-id", agentId);

      const tag = el.tagName.toLowerCase();
      let label = "";

      // 1. Label by explicit <label for="id">
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) label = labelEl.innerText.trim();
      }

      // 2. Label by wrapping <label>
      if (!label) {
        const parentLabel = el.closest("label");
        if (parentLabel) {
          label = parentLabel.innerText.trim();
        }
      }

      // 3. Label by aria-label or placeholder
      if (!label) {
        label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
      }

      // 4. Label by button/link inner text or value
      if (!label && (tag === "a" || tag === "button")) {
        label = el.innerText.trim();
      }

      if (!label && el.name) {
        label = el.name;
      }

      // Clean extra whitespace from label
      label = label.replace(/\s+/g, " ").trim();

      if (tag === "a") {
        items.push(`[${agentId}] link "${label}"`);
      } else if (tag === "button") {
        items.push(`[${agentId}] button "${label}"`);
      } else if (tag === "input") {
        const inputType = (el.getAttribute("type") || "text").toLowerCase();
        const value = el.value || "";
        items.push(`[${agentId}] input(${inputType}) label="${label}" value="${value}"`);
      } else if (tag === "select") {
        const options = Array.from(el.options).map((o) => o.text.trim());
        const selected = el.options[el.selectedIndex]?.text.trim() || "";
        items.push(`[${agentId}] select label="${label}" options=${JSON.stringify(options)} selected="${selected}"`);
      } else if (tag === "textarea") {
        const val = el.value || "";
        items.push(`[${agentId}] textarea label="${label}" value="${val}"`);
      }
    }

    // Capture visible body text up to 3000 characters
    const rawBodyText = document.body ? document.body.innerText : "";
    const cleanBodyText = rawBodyText
      .replace(/\r\n/g, "\n")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim()
      .slice(0, 3000);

    return {
      items,
      cleanBodyText
    };
  });

  const url = pageInstance.url();
  const title = await pageInstance.title();

  const formattedOutput = [
    `URL: ${url}`,
    `TITLE: ${title}`,
    `PAGE TEXT:`,
    elementsData.cleanBodyText,
    `INTERACTIVE ELEMENTS:`,
    elementsData.items.length > 0 ? elementsData.items.join("\n") : "(No interactive elements found)"
  ].join("\n");

  return formattedOutput;
}

// Navigate to a URL
export async function goto(url) {
  if (!pageInstance) throw new Error("Browser not launched");
  await pageInstance.goto(url, { waitUntil: "domcontentloaded" });
  await pageInstance.waitForTimeout(300);
  return await observe();
}

// Click on an interactive element by its [id] tag
export async function click(id) {
  if (!pageInstance) throw new Error("Browser not launched");
  const selector = `[data-agent-id="${String(id).trim()}"]`;
  const element = pageInstance.locator(selector).first();

  const count = await element.count();
  if (count === 0) {
    throw new Error(`Element with id [${id}] was not found on the page.`);
  }

  await Promise.all([
    pageInstance.waitForLoadState("domcontentloaded").catch(() => {}),
    element.click()
  ]);

  await pageInstance.waitForTimeout(300);
  return await observe();
}

// Type into an input or textarea element (clears existing content first)
export async function type(id, text) {
  if (!pageInstance) throw new Error("Browser not launched");
  const selector = `[data-agent-id="${String(id).trim()}"]`;
  const element = pageInstance.locator(selector).first();

  const count = await element.count();
  if (count === 0) {
    throw new Error(`Element with id [${id}] was not found on the page.`);
  }

  await element.fill("");
  await element.fill(String(text));
  await pageInstance.waitForTimeout(300);
  return await observe();
}

// Select an option in a <select> element by label or value
export async function select(id, optionLabel) {
  if (!pageInstance) throw new Error("Browser not launched");
  const selector = `[data-agent-id="${String(id).trim()}"]`;
  const element = pageInstance.locator(selector).first();

  const count = await element.count();
  if (count === 0) {
    throw new Error(`Element with id [${id}] was not found on the page.`);
  }

  const cleanOption = typeof optionLabel === "object"
    ? String(optionLabel.label || optionLabel.value || "")
    : String(optionLabel);

  try {
    await element.selectOption({ label: cleanOption });
  } catch {
    // Fallback to value match
    await element.selectOption({ value: cleanOption });
  }

  await pageInstance.waitForTimeout(300);
  return await observe();
}

// Take a full-page screenshot and save to designated file path
export async function screenshot(filePath) {
  if (!pageInstance) throw new Error("Browser not launched");
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await pageInstance.screenshot({ path: filePath, fullPage: true });
  return `Screenshot saved to ${filePath}`;
}
