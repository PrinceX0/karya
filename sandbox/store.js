// sandbox/store.js
// In-memory data store holding Acme Corp sandbox state.
// Manages vendors, ERP invoices, mail inbox, authentication sessions, and chaos experiment flags.

import crypto from "crypto";
import { initialVendors, initialErpInvoices, initialEmails } from "./seed.js";

// Helper to deep clone seed objects so mutations don't touch original seeds
function deepClone(item) {
  return JSON.parse(JSON.stringify(item));
}

// Parse initial chaos flags from environment variable (e.g., CHAOS=flaky_save,session_expiry)
function parseEnvChaosFlags() {
  const envChaos = process.env.CHAOS;
  if (!envChaos) return [];
  return envChaos
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);
}

class Store {
  constructor() {
    this.reset(true);
  }

  // Restore seed data and reset chaos trigger counters
  reset(keepFlags = true) {
    this.vendors = deepClone(initialVendors);
    this.erpInvoices = deepClone(initialErpInvoices);
    this.emails = deepClone(initialEmails);
    this.sessions = new Set();

    const existingFlags = this.chaos?.flags || parseEnvChaosFlags();
    this.chaos = {
      flags: keepFlags ? existingFlags : [],
      flakySaveTriggered: false,
      sessionExpiryTriggered: false
    };
  }

  // Vendors
  getVendors() {
    return [...this.vendors];
  }

  // ERP Invoices
  getInvoices() {
    return [...this.erpInvoices];
  }

  getInvoiceById(id) {
    return this.erpInvoices.find((inv) => inv.id === id) || null;
  }

  getInvoiceByNumber(invoiceNumber) {
    if (!invoiceNumber) return null;
    const cleanNumber = invoiceNumber.trim().toUpperCase();
    return (
      this.erpInvoices.find(
        (inv) => inv.invoiceNumber.trim().toUpperCase() === cleanNumber
      ) || null
    );
  }

  createInvoice({ vendor, invoiceNumber, amount, dueDate, notes }) {
    const newInvoice = {
      id: "inv-" + Date.now(),
      invoiceNumber: invoiceNumber.trim(),
      vendor: vendor.trim(),
      amount: Number(amount),
      dueDate: dueDate.trim(),
      status: "Unpaid",
      notes: (notes || "").trim()
    };
    this.erpInvoices.push(newInvoice);
    return newInvoice;
  }

  updateInvoiceStatus(id, status) {
    const invoice = this.getInvoiceById(id);
    if (invoice) {
      invoice.status = status;
      return invoice;
    }
    return null;
  }

  // Mail
  getEmails() {
    // Return sorted newest first by date descending
    return [...this.emails].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  getEmailById(id) {
    return this.emails.find((email) => email.id === id) || null;
  }

  // Authentication Sessions
  createSession() {
    const token = crypto.randomUUID();
    this.sessions.add(token);
    return token;
  }

  isValidSession(token) {
    if (!token) return false;
    return this.sessions.has(token);
  }

  deleteSession(token) {
    if (token) {
      this.sessions.delete(token);
    }
  }

  // Chaos settings
  getChaosState() {
    return {
      flags: [...this.chaos.flags],
      flakySaveTriggered: this.chaos.flakySaveTriggered,
      sessionExpiryTriggered: this.chaos.sessionExpiryTriggered
    };
  }

  setChaosFlags(flags = []) {
    const cleanFlags = Array.isArray(flags)
      ? flags.map((f) => String(f).trim()).filter(Boolean)
      : [];
    this.chaos.flags = cleanFlags;
    this.chaos.flakySaveTriggered = false;
    this.chaos.sessionExpiryTriggered = false;
  }

  isChaosActive(flagName) {
    return this.chaos.flags.includes(flagName);
  }

  // Evaluates flaky_save: triggers 503 on first attempt only
  triggerFlakySave() {
    if (this.isChaosActive("flaky_save") && !this.chaos.flakySaveTriggered) {
      this.chaos.flakySaveTriggered = true;
      return true;
    }
    return false;
  }

  // Evaluates session_expiry: triggers session invalidation on first form view only
  triggerSessionExpiry() {
    if (this.isChaosActive("session_expiry") && !this.chaos.sessionExpiryTriggered) {
      this.chaos.sessionExpiryTriggered = true;
      return true;
    }
    return false;
  }
}

export const store = new Store();
