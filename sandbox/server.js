// sandbox/server.js
// Express server hosting the simulated Acme Corp sandbox on port 4000.
// Houses Mail (/mail), Finance ERP (/erp), Chaos Panel (/admin/chaos), and Privileged APIs (/api).

import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { store } from "./store.js";
import {
  layout,
  formatINR,
  formatDate,
  formatDateTime,
  escapeHtml,
  getLabels
} from "./html.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware for parsing forms, JSON, and cookies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Authentication middleware protecting /erp routes (except login)
function requireErpAuth(req, res, next) {
  // Allow login GET and POST routes
  if (req.path === "/login") {
    return next();
  }

  const token = req.cookies.acme_session;
  if (!token || !store.isValidSession(token)) {
    return res.redirect("/erp/login");
  }

  next();
}

// -------------------------------------------------------------
// Home Route
// -------------------------------------------------------------
app.get("/", (req, res) => {
  const isRenamed = store.isChaosActive("renamed_labels");
  const labels = getLabels(isRenamed);

  const content = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Acme Corp Internal Portal</h1>
        <p class="page-subtitle">Sandbox environment for automated agent evaluation and task execution.</p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 1rem;">
      <div class="card">
        <h2 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #1e3a8a;">📬 Accounts Payable Mail</h2>
        <p style="color: var(--text-muted); margin-bottom: 1.25rem;">
          Shared AP inbox containing vendor correspondence, invoice statements, and general office announcements.
        </p>
        <a href="/mail" class="btn btn-primary" id="home-link-mail">Open AP Inbox &rarr;</a>
      </div>

      <div class="card">
        <h2 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #065f46;">💼 Finance ERP</h2>
        <p style="color: var(--text-muted); margin-bottom: 1.25rem;">
          Core financial record system for tracking vendor bills, approval workflows, and payment statuses.
        </p>
        <a href="/erp" class="btn btn-primary" id="home-link-erp">Launch Finance ERP &rarr;</a>
      </div>
    </div>

    <div class="card" style="margin-top: 1.5rem; border-style: dashed; background: #fafaf9;">
      <h3 style="font-size: 1rem; margin-bottom: 0.5rem; color: #44403c;">⚙️ Evaluator & Presenter Controls</h3>
      <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.85rem;">
        Inject edge-cases and simulated system failures (flaky network, expired sessions, changed UI labels).
      </p>
      <a href="/admin/chaos" class="btn btn-secondary">Open Chaos Panel</a>
    </div>
  `;

  res.send(layout({ title: "Home", activeNav: "home", content }));
});

// -------------------------------------------------------------
// App A: Mail (/mail)
// -------------------------------------------------------------
app.get("/mail", (req, res) => {
  const emails = store.getEmails();

  const rows = emails
    .map(
      (email) => `
      <tr style="cursor: pointer;" onclick="window.location='/mail/${email.id}'">
        <td style="font-weight: 600; white-space: nowrap;">
          <a href="/mail/${email.id}" style="text-decoration: none; color: inherit;" id="mail-link-${email.id}">
            ${escapeHtml(email.from)}
          </a>
        </td>
        <td>
          <a href="/mail/${email.id}" style="text-decoration: none; color: #1e293b; font-weight: 500;">
            ${escapeHtml(email.subject)}
          </a>
          ${
            email.invoice
              ? `<span class="badge badge-invoice" style="margin-left: 0.5rem;">Invoice Attached</span>`
              : ""
          }
        </td>
        <td style="color: var(--text-muted); white-space: nowrap; text-align: right;">
          ${formatDateTime(email.date)}
        </td>
      </tr>
    `
    )
    .join("");

  const content = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Accounts Payable Inbox</h1>
        <p class="page-subtitle">Showing ${emails.length} messages &bull; Shared inbox (ap@acme-corp.internal)</p>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 250px;">From</th>
            <th>Subject</th>
            <th style="width: 180px; text-align: right;">Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout({ title: "Mail Inbox", activeNav: "mail", content }));
});

app.get("/mail/:id", (req, res) => {
  const email = store.getEmailById(req.params.id);
  if (!email) {
    return res
      .status(404)
      .send(
        layout({
          title: "Message Not Found",
          activeNav: "mail",
          content: `<div class="alert alert-danger">The requested email was not found.</div><a href="/mail" class="btn btn-secondary">&larr; Back to Inbox</a>`
        })
      );
  }

  let invoiceBoxHtml = "";
  if (email.invoice) {
    const inv = email.invoice;
    const itemsHtml = inv.lineItems
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td style="text-align: center;">${item.quantity}</td>
          <td style="text-align: right;">${formatINR(item.unitPrice)}</td>
          <td style="text-align: right; font-weight: 600;">${formatINR(item.amount)}</td>
        </tr>
      `
      )
      .join("");

    invoiceBoxHtml = `
      <div class="invoice-box" id="attached-invoice-box">
        <div class="invoice-box-header">
          <div>
            <span style="font-weight: 700; color: #1e40af; font-size: 1.05rem;">📎 Attached Invoice Document</span>
          </div>
          <span class="badge badge-invoice">Verified Vendor Invoice</span>
        </div>

        <div class="invoice-grid">
          <div>
            <dt>Vendor</dt>
            <dd id="invoice-vendor">${escapeHtml(inv.vendor)}</dd>
          </div>
          <div>
            <dt>Invoice Number</dt>
            <dd id="invoice-number" style="font-family: monospace;">${escapeHtml(inv.invoiceNumber)}</dd>
          </div>
          <div>
            <dt>Issue Date</dt>
            <dd id="invoice-issue-date">${formatDate(inv.issueDate)}</dd>
          </div>
          <div>
            <dt>Due Date</dt>
            <dd id="invoice-due-date">${formatDate(inv.dueDate)}</dd>
          </div>
        </div>

        <div style="margin: 1rem 0 0.5rem 0;">
          <table style="background: #ffffff; border: 1px solid #bfdbfe; border-radius: 4px;">
            <thead>
              <tr style="background: #eff6ff;">
                <th>Description</th>
                <th style="width: 70px; text-align: center;">Qty</th>
                <th style="width: 120px; text-align: right;">Rate</th>
                <th style="width: 130px; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>

        <div style="display: flex; justify-content: flex-end; align-items: baseline; gap: 1rem; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #bfdbfe;">
          <span style="font-weight: 600; color: #334155;">Total Amount Due:</span>
          <span class="invoice-amount" id="invoice-amount">${formatINR(inv.amount)}</span>
        </div>
      </div>
    `;
  }

  const content = `
    <div style="margin-bottom: 1rem;">
      <a href="/mail" class="btn btn-secondary" style="font-size: 0.8rem;">&larr; Back to AP Inbox</a>
    </div>

    <div class="card">
      <h1 class="page-title" style="font-size: 1.3rem; margin-bottom: 1rem;">${escapeHtml(email.subject)}</h1>
      
      <div class="detail-list" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
        <div class="detail-label">From</div>
        <div class="detail-value" id="mail-from">${escapeHtml(email.from)}</div>
        <div class="detail-label">To</div>
        <div class="detail-value" id="mail-to">${escapeHtml(email.to)}</div>
        <div class="detail-label">Date</div>
        <div class="detail-value" id="mail-date">${formatDateTime(email.date)}</div>
      </div>

      <div style="white-space: pre-wrap; font-size: 0.95rem; color: #334155; line-height: 1.6;" id="mail-body">${escapeHtml(email.body)}</div>

      ${invoiceBoxHtml}
    </div>
  `;

  res.send(layout({ title: email.subject, activeNav: "mail", content }));
});

// -------------------------------------------------------------
// App B: Finance ERP (/erp)
// -------------------------------------------------------------
// ERP login screen
app.get("/erp/login", (req, res) => {
  const expired = req.query.error === "expired";
  const invalid = req.query.error === "invalid";

  let alertHtml = "";
  if (expired) {
    alertHtml = `<div class="alert alert-danger" id="login-error-alert">Your session expired. Please sign in again.</div>`;
  } else if (invalid) {
    alertHtml = `<div class="alert alert-danger" id="login-error-alert">Invalid credentials. Please use ap.clerk / sandbox123</div>`;
  }

  const content = `
    <div style="max-width: 420px; margin: 3rem auto;">
      <div class="card">
        <h1 class="page-title" style="font-size: 1.3rem; margin-bottom: 0.5rem; text-align: center;">Finance ERP Sign In</h1>
        <p class="page-subtitle" style="text-align: center; margin-bottom: 1.5rem;">Acme Corp Internal Accounts Payable Portal</p>

        ${alertHtml}

        <form method="POST" action="/erp/login">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" class="form-control" placeholder="ap.clerk" required autocomplete="username">
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" class="form-control" placeholder="••••••••" required autocomplete="current-password">
          </div>

          <button type="submit" class="btn btn-primary" id="btn-login" style="width: 100%; margin-top: 0.5rem;">Sign In</button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: var(--text-muted); text-align: center;">
          Sandbox credentials: <code>ap.clerk</code> / <code>sandbox123</code>
        </div>
      </div>
    </div>
  `;

  res.send(layout({ title: "ERP Sign In", activeNav: "erp", content }));
});

// ERP login POST handler
app.post("/erp/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "ap.clerk" && password === "sandbox123") {
    const sessionToken = store.createSession();
    res.cookie("acme_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });
    return res.redirect("/erp/invoices");
  }

  res.redirect("/erp/login?error=invalid");
});

// ERP logout handler
app.get("/erp/logout", (req, res) => {
  const token = req.cookies.acme_session;
  store.deleteSession(token);
  res.clearCookie("acme_session");
  res.redirect("/erp/login");
});

// Redirect /erp root to /erp/invoices (protected by auth middleware)
app.get("/erp", requireErpAuth, (req, res) => {
  res.redirect("/erp/invoices");
});

// ERP invoice list
app.get("/erp/invoices", requireErpAuth, (req, res) => {
  const isRenamed = store.isChaosActive("renamed_labels");
  const labels = getLabels(isRenamed);
  const invoices = store.getInvoices();

  const rows = invoices
    .map(
      (inv) => `
      <tr style="cursor: pointer;" onclick="window.location='/erp/invoices/${inv.id}'">
        <td style="font-weight: 600;">
          <a href="/erp/invoices/${inv.id}" style="text-decoration: none; color: inherit;">
            ${escapeHtml(inv.vendor)}
          </a>
        </td>
        <td style="font-family: monospace;">
          <a href="/erp/invoices/${inv.id}" style="text-decoration: none; color: var(--primary); font-weight: 600;" id="invoice-row-${inv.invoiceNumber}">
            ${escapeHtml(inv.invoiceNumber)}
          </a>
        </td>
        <td style="font-weight: 600;">${formatINR(inv.amount)}</td>
        <td style="color: #334155;">${formatDate(inv.dueDate)}</td>
        <td>
          <span class="badge ${inv.status === "Paid" ? "badge-paid" : "badge-unpaid"}">
            ${escapeHtml(inv.status)}
          </span>
        </td>
      </tr>
    `
    )
    .join("");

  const content = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Accounts Payable Invoices</h1>
        <p class="page-subtitle">Finance System of Record &bull; ${invoices.length} invoices registered</p>
      </div>
      <div>
        <a href="/erp/invoices/new" class="btn btn-primary" id="btn-new-invoice">${escapeHtml(labels.newInvoice)}</a>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Invoice No</th>
            <th>Amount</th>
            <th>Due Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div style="margin-top: 1.5rem; text-align: right;">
      <a href="/erp/logout" style="color: var(--text-muted); font-size: 0.85rem; text-decoration: none;">Sign out</a>
    </div>
  `;

  res.send(layout({ title: "ERP Invoices", activeNav: "erp", content }));
});

// ERP new invoice form (GET)
app.get("/erp/invoices/new", requireErpAuth, (req, res) => {
  // Check session_expiry chaos condition
  if (store.triggerSessionExpiry()) {
    const token = req.cookies.acme_session;
    store.deleteSession(token);
    res.clearCookie("acme_session");
    return res.redirect("/erp/login?error=expired");
  }

  const isRenamed = store.isChaosActive("renamed_labels");
  const labels = getLabels(isRenamed);
  const vendors = store.getVendors();

  const vendorOptions = vendors
    .map(
      (v) =>
        `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    )
    .join("");

  const content = `
    <div style="max-width: 600px; margin: 0 auto;">
      <div style="margin-bottom: 1rem;">
        <a href="/erp/invoices" class="btn btn-secondary" style="font-size: 0.8rem;">&larr; Back to Invoices</a>
      </div>

      <div class="card">
        <h1 class="page-title" style="font-size: 1.3rem; margin-bottom: 1.25rem;">Create New Invoice</h1>

        <form method="POST" action="/erp/invoices/new" id="form-new-invoice">
          <div class="form-group">
            <label for="vendor">Vendor</label>
            <select id="vendor" name="vendor" class="form-control" required>
              <option value="">-- Select Vendor --</option>
              ${vendorOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="invoiceNumber">Invoice Number</label>
            <input type="text" id="invoiceNumber" name="invoiceNumber" class="form-control" placeholder="e.g. INV-IT-1021" required>
          </div>

          <div class="form-group">
            <label for="amount">${escapeHtml(labels.amount)}</label>
            <input type="number" step="0.01" min="0.01" id="amount" name="amount" class="form-control" placeholder="e.g. 42500" required>
          </div>

          <div class="form-group">
            <label for="dueDate">${escapeHtml(labels.dueDate)}</label>
            <input type="date" id="dueDate" name="dueDate" class="form-control" required>
          </div>

          <div class="form-group">
            <label for="notes">Notes</label>
            <textarea id="notes" name="notes" class="form-control" rows="3" placeholder="Optional reference notes"></textarea>
          </div>

          <button type="submit" class="btn btn-primary" id="btn-save-invoice" style="width: 100%;">
            ${escapeHtml(labels.saveInvoice)}
          </button>
        </form>
      </div>
    </div>
  `;

  res.send(layout({ title: "New Invoice", activeNav: "erp", content }));
});

// ERP new invoice submit (POST)
app.post("/erp/invoices/new", requireErpAuth, (req, res) => {
  // Check flaky_save chaos condition
  if (store.triggerFlakySave()) {
    return res.status(503).send(
      layout({
        title: "Service Unavailable",
        activeNav: "erp",
        content: `
          <div class="alert alert-danger" style="margin-top: 2rem; font-size: 1.1rem; padding: 1.5rem;" id="flaky-error-box">
            <strong>HTTP 503:</strong> Service temporarily unavailable — please try again.
          </div>
          <div style="margin-top: 1rem;">
            <p style="color: var(--text-muted); margin-bottom: 1rem;">The ERP gateway experienced a momentary timeout while communicating with the ledger service.</p>
            <button onclick="window.history.back()" class="btn btn-secondary">Go Back &amp; Try Again</button>
          </div>
        `
      })
    );
  }

  const { vendor, invoiceNumber, amount, dueDate, notes } = req.body;
  const isRenamed = store.isChaosActive("renamed_labels");
  const labels = getLabels(isRenamed);
  const vendors = store.getVendors();

  const errors = [];

  // Validation rules
  if (!vendor || !vendor.trim()) {
    errors.push("Vendor is required.");
  }
  if (!invoiceNumber || !invoiceNumber.trim()) {
    errors.push("Invoice Number is required.");
  }

  const numAmount = Number(amount);
  if (!amount || isNaN(numAmount) || numAmount <= 0) {
    errors.push("Amount must be a valid number greater than 0.");
  }

  if (!dueDate || isNaN(Date.parse(dueDate))) {
    errors.push("Due Date must be a valid date.");
  }

  // Check duplicate invoice number
  if (invoiceNumber && store.getInvoiceByNumber(invoiceNumber)) {
    errors.push(`Invoice number ${invoiceNumber.trim()} already exists in the ERP.`);
  }

  // If validation errors exist, refill form and show red box at top
  if (errors.length > 0) {
    const vendorOptions = vendors
      .map(
        (v) =>
          `<option value="${escapeHtml(v)}" ${v === vendor ? "selected" : ""}>${escapeHtml(v)}</option>`
      )
      .join("");

    const errorListHtml = errors
      .map((err) => `<li>${escapeHtml(err)}</li>`)
      .join("");

    const content = `
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="margin-bottom: 1rem;">
          <a href="/erp/invoices" class="btn btn-secondary" style="font-size: 0.8rem;">&larr; Back to Invoices</a>
        </div>

        <div class="alert alert-danger" id="form-errors-box">
          <strong style="display: block; margin-bottom: 0.25rem;">Please correct the following errors:</strong>
          <ul style="margin-left: 1.25rem;">
            ${errorListHtml}
          </ul>
        </div>

        <div class="card">
          <h1 class="page-title" style="font-size: 1.3rem; margin-bottom: 1.25rem;">Create New Invoice</h1>

          <form method="POST" action="/erp/invoices/new" id="form-new-invoice">
            <div class="form-group">
              <label for="vendor">Vendor</label>
              <select id="vendor" name="vendor" class="form-control" required>
                <option value="">-- Select Vendor --</option>
                ${vendorOptions}
              </select>
            </div>

            <div class="form-group">
              <label for="invoiceNumber">Invoice Number</label>
              <input type="text" id="invoiceNumber" name="invoiceNumber" class="form-control" value="${escapeHtml(invoiceNumber || "")}" required>
            </div>

            <div class="form-group">
              <label for="amount">${escapeHtml(labels.amount)}</label>
              <input type="number" step="0.01" min="0.01" id="amount" name="amount" class="form-control" value="${escapeHtml(amount || "")}" required>
            </div>

            <div class="form-group">
              <label for="dueDate">${escapeHtml(labels.dueDate)}</label>
              <input type="date" id="dueDate" name="dueDate" class="form-control" value="${escapeHtml(dueDate || "")}" required>
            </div>

            <div class="form-group">
              <label for="notes">Notes</label>
              <textarea id="notes" name="notes" class="form-control" rows="3">${escapeHtml(notes || "")}</textarea>
            </div>

            <button type="submit" class="btn btn-primary" id="btn-save-invoice" style="width: 100%;">
              ${escapeHtml(labels.saveInvoice)}
            </button>
          </form>
        </div>
      </div>
    `;

    return res.status(400).send(layout({ title: "New Invoice", activeNav: "erp", content }));
  }

  // Create invoice and redirect to detail page with green saved banner
  const newInvoice = store.createInvoice({
    vendor,
    invoiceNumber,
    amount: numAmount,
    dueDate,
    notes
  });

  res.redirect(`/erp/invoices/${newInvoice.id}?saved=true`);
});

// ERP invoice detail page
app.get("/erp/invoices/:id", requireErpAuth, (req, res) => {
  const invoice = store.getInvoiceById(req.params.id);
  if (!invoice) {
    return res
      .status(404)
      .send(
        layout({
          title: "Invoice Not Found",
          activeNav: "erp",
          content: `<div class="alert alert-danger">Invoice not found in the ERP system.</div><a href="/erp/invoices" class="btn btn-secondary">&larr; Back to Invoices</a>`
        })
      );
  }

  const isSavedBanner = req.query.saved === "true";
  const content = `
    <div style="max-width: 650px; margin: 0 auto;">
      <div style="margin-bottom: 1rem;">
        <a href="/erp/invoices" class="btn btn-secondary" style="font-size: 0.8rem;">&larr; Back to Invoices</a>
      </div>

      ${
        isSavedBanner
          ? `<div class="alert alert-success" id="banner-invoice-saved">Invoice saved successfully.</div>`
          : ""
      }

      <div class="card">
        <div class="page-header" style="margin-bottom: 1.25rem;">
          <div>
            <h1 class="page-title" style="font-size: 1.4rem;">Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
            <p class="page-subtitle">${escapeHtml(invoice.vendor)}</p>
          </div>
          <div>
            <span class="badge ${invoice.status === "Paid" ? "badge-paid" : "badge-unpaid"}" style="font-size: 0.9rem; padding: 0.35rem 0.8rem;">
              ${escapeHtml(invoice.status)}
            </span>
          </div>
        </div>

        <div class="detail-list" style="margin-bottom: 1.5rem;">
          <div class="detail-label">Vendor</div>
          <div class="detail-value" id="detail-vendor" style="font-weight: 600;">${escapeHtml(invoice.vendor)}</div>

          <div class="detail-label">Invoice Number</div>
          <div class="detail-value" id="detail-invoice-number" style="font-family: monospace;">${escapeHtml(invoice.invoiceNumber)}</div>

          <div class="detail-label">Amount Due</div>
          <div class="detail-value" id="detail-amount" style="font-size: 1.2rem; font-weight: 700; color: #1e3a8a;">${formatINR(invoice.amount)}</div>

          <div class="detail-label">Due Date</div>
          <div class="detail-value" id="detail-due-date">${formatDate(invoice.dueDate)}</div>

          <div class="detail-label">Status</div>
          <div class="detail-value" id="detail-status">${escapeHtml(invoice.status)}</div>

          <div class="detail-label">Notes</div>
          <div class="detail-value" id="detail-notes">${escapeHtml(invoice.notes || "None")}</div>
        </div>

        <div style="display: flex; gap: 1rem; border-top: 1px solid var(--border); padding-top: 1.25rem;">
          ${
            invoice.status !== "Paid"
              ? `
            <form method="POST" action="/erp/invoices/${invoice.id}/pay" style="display: inline;">
              <button type="submit" class="btn btn-success" id="btn-mark-paid">Mark as Paid</button>
            </form>
          `
              : `<button class="btn btn-secondary" disabled>Status: Paid</button>`
          }
        </div>
      </div>
    </div>
  `;

  res.send(layout({ title: `Invoice ${invoice.invoiceNumber}`, activeNav: "erp", content }));
});

// ERP invoice pay POST action
app.post("/erp/invoices/:id/pay", requireErpAuth, (req, res) => {
  store.updateInvoiceStatus(req.params.id, "Paid");
  res.redirect(`/erp/invoices/${req.params.id}`);
});

// -------------------------------------------------------------
// Chaos Panel (/admin/chaos) — Presenter / Human only
// -------------------------------------------------------------
app.get("/admin/chaos", (req, res) => {
  const chaos = store.getChaosState();
  const flags = chaos.flags;
  const isReset = req.query.reset === "true";
  const isUpdated = req.query.updated === "true";

  let notificationHtml = "";
  if (isReset) {
    notificationHtml = `<div class="alert alert-success">All data and chaos counters have been reset to initial seed values.</div>`;
  } else if (isUpdated) {
    notificationHtml = `<div class="alert alert-success">Chaos settings updated successfully. Counters reset.</div>`;
  }

  const content = `
    <div style="max-width: 650px; margin: 0 auto;">
      <div class="page-header">
        <div>
          <h1 class="page-title">Chaos Engineering Controls</h1>
          <p class="page-subtitle">Inject runtime failures and interface adaptations for agent resilience testing.</p>
        </div>
      </div>

      ${notificationHtml}

      <div class="card">
        <form method="POST" action="/admin/chaos">
          <div style="margin-bottom: 1.5rem;">
            <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; margin-bottom: 1rem;">
              <input type="checkbox" name="flags" value="flaky_save" ${flags.includes("flaky_save") ? "checked" : ""} style="margin-top: 0.25rem;">
              <div>
                <strong>flaky_save</strong>
                <p style="color: var(--text-muted); font-size: 0.85rem; font-weight: normal;">
                  The first POST that creates an invoice returns HTTP 503 with "Service temporarily unavailable &mdash; please try again." Subsequent attempts succeed.
                </p>
                <span style="font-size: 0.75rem; color: #475569;">Triggered: <code>${chaos.flakySaveTriggered}</code></span>
              </div>
            </label>

            <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; margin-bottom: 1rem;">
              <input type="checkbox" name="flags" value="session_expiry" ${flags.includes("session_expiry") ? "checked" : ""} style="margin-top: 0.25rem;">
              <div>
                <strong>session_expiry</strong>
                <p style="color: var(--text-muted); font-size: 0.85rem; font-weight: normal;">
                  The first time the New Invoice form is opened after login, the session is invalidated and user is redirected to login with "Your session expired. Please sign in again."
                </p>
                <span style="font-size: 0.75rem; color: #475569;">Triggered: <code>${chaos.sessionExpiryTriggered}</code></span>
              </div>
            </label>

            <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer;">
              <input type="checkbox" name="flags" value="renamed_labels" ${flags.includes("renamed_labels") ? "checked" : ""} style="margin-top: 0.25rem;">
              <div>
                <strong>renamed_labels</strong>
                <p style="color: var(--text-muted); font-size: 0.85rem; font-weight: normal;">
                  Changes UI labels dynamically: "New Invoice" &rarr; "Add Bill", "Save Invoice" &rarr; "Submit Record", "Amount" &rarr; "Total payable (INR)", "Due Date" &rarr; "Payment deadline".
                </p>
              </div>
            </label>
          </div>

          <button type="submit" class="btn btn-primary" id="btn-save-chaos">Apply Chaos Settings</button>
        </form>
      </div>

      <div class="card" style="border-color: #fecaca; background: #fffaf0;">
        <h3 style="font-size: 1rem; color: #991b1b; margin-bottom: 0.5rem;">Reset Sandbox State</h3>
        <p style="color: #78350f; font-size: 0.85rem; margin-bottom: 1rem;">
          Restores original seed vendors, emails, and ERP invoices while resetting chaos counters.
        </p>
        <form method="POST" action="/admin/reset">
          <button type="submit" class="btn btn-danger" id="btn-admin-reset">Reset All Data</button>
        </form>
      </div>
    </div>
  `;

  res.send(layout({ title: "Chaos Panel", activeNav: "chaos", content }));
});

app.post("/admin/chaos", (req, res) => {
  const flags = Array.isArray(req.body.flags)
    ? req.body.flags
    : req.body.flags
    ? [req.body.flags]
    : [];

  store.setChaosFlags(flags);
  res.redirect("/admin/chaos?updated=true");
});

app.post("/admin/reset", (req, res) => {
  store.reset(true);
  res.redirect("/admin/chaos?reset=true");
});

// -------------------------------------------------------------
// Privileged JSON API — Evaluator / Verifier only
// -------------------------------------------------------------
app.get("/api/state", (req, res) => {
  res.json({
    vendors: store.getVendors(),
    erpInvoices: store.getInvoices(),
    emails: store.getEmails(),
    chaos: store.getChaosState()
  });
});

app.post("/api/reset", (req, res) => {
  const keepFlags = req.body && typeof req.body.keepFlags === "boolean" ? req.body.keepFlags : true;
  store.reset(keepFlags);
  res.json({
    success: true,
    message: "Sandbox state reset successfully to seed values.",
    state: {
      vendors: store.getVendors().length,
      erpInvoices: store.getInvoices().length,
      emails: store.getEmails().length,
      chaos: store.getChaosState()
    }
  });
});

app.post("/api/chaos", (req, res) => {
  const flags = req.body?.flags || [];
  store.setChaosFlags(flags);
  res.json({
    success: true,
    chaos: store.getChaosState()
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[Acme Corp Sandbox] Running on http://localhost:${PORT}`);
});
