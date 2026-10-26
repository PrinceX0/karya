// sandbox/html.js
// Shared HTML layout, CSS styling, and server-side rendering helpers.
// Produces a clean, functional internal tool aesthetic without client-side frameworks.

// Format number into standard Indian Rupee currency format (e.g. ₹42,500.00)
export function formatINR(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

// Format ISO date string into readable format (e.g., Oct 21, 2026, 11:45 AM)
export function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Format simple date (e.g., 2026-10-21)
export function formatDate(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// Basic HTML entity escaping to prevent accidental HTML injection
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Dynamic label dictionary supporting the 'renamed_labels' chaos mode
export function getLabels(isRenamed = false) {
  if (isRenamed) {
    return {
      newInvoice: "Add Bill",
      saveInvoice: "Submit Record",
      amount: "Total payable (INR)",
      dueDate: "Payment deadline"
    };
  }
  return {
    newInvoice: "New Invoice",
    saveInvoice: "Save Invoice",
    amount: "Amount",
    dueDate: "Due Date"
  };
}

// Base page template wrapping every sandbox screen
export function layout({ title, activeNav = "", chaosActive = false, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Acme Corp Sandbox</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger: #ef4444;
      --danger-bg: #fef2f2;
      --danger-border: #fecaca;
      --success: #16a34a;
      --success-bg: #f0fdf4;
      --success-border: #bbf7d0;
      --warning: #d97706;
      --warning-bg: #fffbeb;
      --warning-border: #fef3c7;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      font-size: 14px;
    }

    /* Top Navigation */
    .navbar {
      background: #1e293b;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 2rem;
      border-bottom: 1px solid #0f172a;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: #ffffff;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }

    .nav-brand .badge-env {
      background: #3b82f6;
      color: #ffffff;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      list-style: none;
    }

    .nav-links a {
      color: #94a3b8;
      text-decoration: none;
      font-weight: 500;
      padding: 0.35rem 0.65rem;
      border-radius: 4px;
      transition: all 0.15s ease-in-out;
    }

    .nav-links a:hover,
    .nav-links a.active {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }

    .nav-links .chaos-link {
      color: #fbbf24;
      border: 1px dashed #d97706;
      font-size: 0.8rem;
    }

    .nav-links .chaos-link:hover {
      background: rgba(217, 119, 6, 0.2);
      color: #fef08a;
    }

    /* Main Container */
    .main-container {
      max-width: 1040px;
      margin: 2rem auto;
      padding: 0 1.5rem;
    }

    /* Headings & Actions */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
    }

    .page-subtitle {
      color: var(--text-muted);
      margin-top: 0.25rem;
      font-size: 0.9rem;
    }

    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    /* Buttons & Links */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background-color 0.15s;
    }

    .btn-primary {
      background: var(--primary);
      color: #ffffff;
    }

    .btn-primary:hover {
      background: var(--primary-hover);
    }

    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border-color: #cbd5e1;
    }

    .btn-secondary:hover {
      background: #e2e8f0;
    }

    .btn-success {
      background: var(--success);
      color: #ffffff;
    }

    .btn-success:hover {
      background: #15803d;
    }

    .btn-danger {
      background: var(--danger);
      color: #ffffff;
    }

    .btn-danger:hover {
      background: #dc2626;
    }

    /* Alerts */
    .alert {
      padding: 0.85rem 1rem;
      border-radius: 4px;
      margin-bottom: 1.25rem;
      font-size: 0.9rem;
      font-weight: 500;
      border: 1px solid;
    }

    .alert-danger {
      background: var(--danger-bg);
      color: #991b1b;
      border-color: var(--danger-border);
    }

    .alert-success {
      background: var(--success-bg);
      color: #166534;
      border-color: var(--success-border);
    }

    .alert-warning {
      background: var(--warning-bg);
      color: #92400e;
      border-color: var(--warning-border);
    }

    /* Tables */
    .table-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      background: #f8fafc;
      color: #475569;
      font-weight: 600;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border);
      color: #1e293b;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: #f8fafc;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .badge-paid {
      background: #dcfce7;
      color: #15803d;
    }

    .badge-unpaid {
      background: #fef3c7;
      color: #b45309;
    }

    .badge-invoice {
      background: #e0f2fe;
      color: #0369a1;
    }

    /* Forms */
    .form-group {
      margin-bottom: 1.25rem;
    }

    label {
      display: block;
      margin-bottom: 0.35rem;
      font-weight: 600;
      color: #334155;
    }

    .form-control {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 0.9rem;
      color: #0f172a;
      background: #ffffff;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .form-control:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }

    /* Invoice Details Box */
    .invoice-box {
      border: 2px dashed #93c5fd;
      background: #f0f7ff;
      border-radius: 6px;
      padding: 1.25rem;
      margin-top: 1.5rem;
    }

    .invoice-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      border-bottom: 1px solid #bfdbfe;
      padding-bottom: 0.5rem;
    }

    .invoice-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .invoice-grid div dt {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 600;
    }

    .invoice-grid div dd {
      font-size: 1rem;
      font-weight: 600;
      color: #0f172a;
    }

    .invoice-amount {
      font-size: 1.4rem;
      color: #1e3a8a;
      font-weight: 700;
    }

    /* Detail Grid */
    .detail-list {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 0.75rem 1rem;
      font-size: 0.95rem;
    }

    .detail-label {
      color: var(--text-muted);
      font-weight: 600;
    }

    .detail-value {
      color: #0f172a;
    }

    /* Footer */
    footer {
      text-align: center;
      margin-top: 3rem;
      padding: 1.5rem 0;
      color: var(--text-muted);
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="nav-brand">
      <span>Acme Corp</span>
      <span class="badge-env">Sandbox</span>
    </a>
    <ul class="nav-links">
      <li><a href="/" class="${activeNav === "home" ? "active" : ""}">Home</a></li>
      <li><a href="/mail" class="${activeNav === "mail" ? "active" : ""}">Mail</a></li>
      <li><a href="/erp" class="${activeNav === "erp" ? "active" : ""}">Finance ERP</a></li>
      <li><a href="/admin/chaos" class="chaos-link ${activeNav === "chaos" ? "active" : ""}">Chaos Panel</a></li>
    </ul>
  </nav>

  <main class="main-container">
    ${content}
  </main>

  <footer>
    Acme Corp Internal Operations Sandbox &bull; For simulated automated agent workflows
  </footer>
</body>
</html>`;
}
