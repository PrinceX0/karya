<!-- docs/LEARNING.md: Living project journal explaining architecture, implementation decisions, and interview concepts for Karya -->

# Karya — Learning Journal & Interview Guide

Karya is an autonomous AI task worker that navigates internal company web applications via Playwright to automate operational workflows (such as Accounts Payable invoice processing).

---

## Phase 1: Acme Corp Sandbox (Simulated Company Environment)

### 1. What Was Built
In Phase 1, we built **Acme Corp Sandbox**, a standalone Node.js and Express web application running on `http://localhost:4000` that simulates a real company's internal software systems.

It contains:
- **Accounts Payable Inbox (`/mail`)**: A shared company email inbox containing correspondence from vendors, invoice delivery emails (with attached structured invoice cards and line items), prompt-injection test emails, and general corporate notices.
- **Finance ERP (`/erp`)**: A secure internal system of record requiring login (`ap.clerk` / `sandbox123`). It lets users view existing invoices, register new bills through a validated form, prevent duplicate invoice numbers, and mark invoices as paid.
- **Chaos Controls (`/admin/chaos`)**: A presenter-facing tool to simulate real-world failure modes:
  - `flaky_save`: Simulates a transient 503 network/service error on the first invoice creation attempt.
  - `session_expiry`: Invalidates session state on the first attempt to open the New Invoice form, forcing a re-login.
  - `renamed_labels`: Dynamically renames button and input labels (e.g., "Add Bill" instead of "New Invoice") to test if automated workers adapt to UI changes.
- **Privileged Testing API (`/api`)**: Programmatic endpoints (`GET /api/state`, `POST /api/reset`, `POST /api/chaos`) used by evaluation suites to inspect state and reset the sandbox between runs.

---

### 2. How It Works
1. **Server-Side Rendering (SSR) with Template Strings (`sandbox/html.js`)**:
   Instead of using React or a frontend build step, HTML pages are generated dynamically on the server using JavaScript template literals. Clean vanilla CSS provides an authentic internal tool UI with responsive tables, form layouts, status badges, and alert banners.
2. **In-Memory Store (`sandbox/store.js`)**:
   All state (vendors, invoices, emails, auth sessions, and chaos flags) is kept in memory. When the application starts, it clones data from `sandbox/seed.js`. State can be reset instantly at any time via `POST /api/reset` or `npm run reset`.
3. **Session Authentication (`req.cookies.acme_session`)**:
   Logging in creates a secure random UUID token stored in a `Set` in `store.js` and sends it as an HTTP-only cookie. An Express middleware (`requireErpAuth`) guards all `/erp/*` routes except `/erp/login`.
4. **Resilience & Chaos Injection**:
   The store maintains one-time trigger flags (`flakySaveTriggered`, `sessionExpiryTriggered`). When enabled via environment variables or the chaos admin panel, the server injects realistic errors on the first encounter and then normalizes on subsequent attempts.

---

### 3. Key Files & Functions

| File | Primary Responsibility |
| :--- | :--- |
| [`sandbox/server.js`](file:///Users/prince/Desktop/Projects/karya/sandbox/server.js) | Express server configuration, route definitions (`/mail`, `/erp`, `/admin/chaos`, `/api`), authentication middleware, and input validation. |
| [`sandbox/store.js`](file:///Users/prince/Desktop/Projects/karya/sandbox/store.js) | In-memory data store class. Manages state mutation, session tracking, seed resetting, and chaos triggering logic. |
| [`sandbox/seed.js`](file:///Users/prince/Desktop/Projects/karya/sandbox/seed.js) | Immutable initial data sets: 6 vendor accounts, 3 baseline ERP invoices, and 8 realistic emails (including target invoice `INV-IT-1021`, noise emails, and prompt injection traps). |
| [`sandbox/html.js`](file:///Users/prince/Desktop/Projects/karya/sandbox/html.js) | Base layout template, shared CSS stylesheet, currency formatting (`formatINR`), and dynamic UI label mapping (`getLabels`). |

---

### 4. Technical Interview Questions & Answers

#### Q1: Why did we build an in-memory simulated sandbox rather than mocking HTTP requests or connecting to a real database?
**Answer:**
Autonomous AI agents interact with software through user interfaces (HTML DOM and browser actions), not just API calls. Having a real, live HTTP web server with session cookies, redirects, forms, and validation allows Playwright to test the agent end-to-end under realistic browser conditions. An in-memory store keeps test runs fast, deterministic, and trivially resettable with a single HTTP call without database migration overhead.

#### Q2: How does the server-side validation and duplicate invoice check work?
**Answer:**
When the user submits the New Invoice form via `POST /erp/invoices/new`, the server extracts `vendor`, `invoiceNumber`, `amount`, and `dueDate`. It validates that all required fields are present, that the amount is a positive number, and that the due date is valid. It then checks `store.getInvoiceByNumber(invoiceNumber)`. If an invoice with the same number already exists, the server returns status `400 Bad Request` and re-renders the form with the user's input intact along with a clear error banner.

#### Q3: Why is chaos testing (flaky saves, session expiry, renamed labels) important when developing an AI agent?
**Answer:**
Real enterprise web apps suffer from flaky connections, expiring authentication tokens, and frequent UI updates. Traditional scripts break when a button label changes from "New Invoice" to "Add Bill" or when a session times out. By baking chaos toggles directly into the sandbox, we can prove that our AI agent can detect error pages, re-authenticate when needed, retry transient failures, and locate UI elements by intent rather than hard-coded selectors.
