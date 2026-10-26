// agent/guard.js
// Security guardrails and human-in-the-loop authorization module.
// Enforces hard execution boundaries, URL allowlists, and operator approvals for sensitive actions.

// URL Allowlist regex: only /mail and /erp on port 4000 are permitted
const ALLOWED_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):4000\/(mail|erp)($|\/|\?|#)/i;

// Sensitive keyword pattern for actions requiring human confirmation
const SENSITIVE_ACTION_PATTERN = /(pay|paid|delete|remove|approve|reject)/i;

export class Guard {
  constructor({ askHuman }) {
    this.askHuman = askHuman;
    this.approvalLog = [];
    this.interactionLog = [];
  }

  // Validates target URL against allowlist
  checkUrl(url) {
    if (!url) {
      return {
        allowed: false,
        reason: "Navigation URL was empty."
      };
    }

    const isAllowed = ALLOWED_URL_PATTERN.test(url.trim());
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `ERROR: URL blocked by security policy. You may only navigate to http://localhost:4000/mail* and http://localhost:4000/erp*. Access to /admin, /api, or external domains is strictly prohibited.`
      };
    }

    return { allowed: true };
  }

  // Inspects actions before execution to enforce human approval on irreversible/critical actions
  async checkAction({ actionName, args, thought, tool, browser }) {
    // 1. URL Allowlist check for open_url
    if (actionName === "open_url") {
      const urlCheck = this.checkUrl(args?.url);
      if (!urlCheck.allowed) {
        return {
          allowed: false,
          observation: urlCheck.reason
        };
      }
    }

    // 2. Hard Guard check: tool risk "irreversible" OR sensitive click labels
    let isSensitive = false;
    let targetLabel = "";

    if (tool && tool.risk === "irreversible") {
      isSensitive = true;
      targetLabel = tool.name;
    } else if (actionName === "click" && args?.id !== undefined) {
      // Determine label of target element
      targetLabel = await browser.getElementLabel(args.id);
      if (SENSITIVE_ACTION_PATTERN.test(targetLabel)) {
        isSensitive = true;
      }
    }

    if (isSensitive) {
      const promptText = `⚠ APPROVAL NEEDED — the agent wants to ${actionName} '${targetLabel || args.id}'. Its reason: ${thought}. Approve? (y/n)`;
      
      const humanResponse = await this.askHuman(promptText);
      const isApproved = /^(y|yes)$/i.test(String(humanResponse).trim());

      const approvalEntry = {
        action: actionName,
        label: targetLabel || String(args.id),
        thought,
        approved: isApproved,
        userResponse: humanResponse,
        timestamp: new Date().toISOString()
      };
      this.approvalLog.push(approvalEntry);

      if (!isApproved) {
        return {
          allowed: false,
          observation: "User DENIED this action. Do not retry it; continue without it or finish."
        };
      }
    }

    return { allowed: true };
  }

  // Record human-in-the-loop Q&A (from ask_user tool or planning clarifications)
  recordInteraction(question, answer) {
    this.interactionLog.push({
      question,
      answer,
      timestamp: new Date().toISOString()
    });
  }

  getApprovalLog() {
    return [...this.approvalLog];
  }

  getInteractionLog() {
    return [...this.interactionLog];
  }
}
