# Personal Finance Management Web Application

A production-ready web app to manage daily expenses, multiple bank accounts, loans, and
investments in one place. All amounts are stored in **integer paise** (INR) for precision-safe
arithmetic.

- **Frontend:** React + Vite, React Router, Axios, Bootstrap
- **Backend:** Node.js, Express, REST API, Mongoose
- **Database:** MongoDB (collections for users, bank accounts, transactions, loans, investments)

> **Status:** Phase 7 complete + **authentication migrated to secure HttpOnly cookie sessions
> with CSRF protection** (no more localStorage tokens). **217 automated tests pass (179 backend
> + 38 frontend).** See "Authentication", "Production readiness & deployment checklist", and
> "Known limitations" below. Honest assessment: **ready for staging**; production requires the
> documented prerequisites (replica set, strong secrets, HTTPS, explicit CORS).

## Investments (Phase 6)

All endpoints require auth and are user-scoped. Money is rupee JSON numbers in/out, integer
paise internally.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/investments/summary` | Portfolio: cost basis, known value, realized/unrealized gain, income, fees, allocation |
| GET | `/api/investments/transactions` | Investment activity history (filters/pagination) |
| POST | `/api/investments/transactions/:txnId/reverse` | Reverse an activity once |
| GET/POST | `/api/investments` | List / create a profile (no money moves) |
| GET/PATCH | `/api/investments/:id` | Get / update safe metadata |
| POST | `/api/investments/:id/purchase` | Record a purchase |
| POST | `/api/investments/:id/sale` | Record a sale |
| POST | `/api/investments/:id/income` | Record dividend/interest (paid to a bank) |
| POST | `/api/investments/:id/fee` | Record a standalone fee |
| POST | `/api/investments/:id/valuation` | Add a manual valuation (with history) |

### Accounting rules
- **Purchase:** bank debit = amount + fee; the whole amount+fee is added to cost basis. A
  purchase is never an ordinary expense (dashboard expense totals are unaffected).
- **Sale:** net proceeds = gross − fee, credited to the bank. Cost basis removed uses
  **weighted-average cost** (unitized) or the full remaining basis (non-unitized liquidation).
  Realized gain = net proceeds − cost basis removed. Sale proceeds are never ordinary income.
  If unit cost is unknown, no realized gain is fabricated (returned as null).
- **Income (dividend/interest):** credits the bank and increases `totalIncome`; it does not
  change cost basis or market value.
- **Standalone fee:** debits the bank and **is** recorded as an ordinary expense
  (`investment_fee`). Purchase/sale fees are handled inline and are not double-counted.
- **Valuation:** manual only, nonnegative, recorded with history; never moves money or changes
  cost basis. Unknown valuation stays `null` (never a verified zero). The app does not fetch
  live market prices.
- **Portfolio summary:** cost basis, known current value, unrealized gain (only over
  known-valuation holdings), realized gain, income, and fees are reported separately — never
  merged into one misleading profit number. When some holdings lack a valuation,
  `valuationComplete` is false and the known value is clearly a partial subtotal.
- **Reversal:** atomic across bank, holdings, cost basis, income/fee totals, realized gain, and
  any linked expense; single-use (409 on repeat) and idempotent; originals preserved.

## Loans (Phase 5)

All loan endpoints require auth and are user-scoped. Money is rupee JSON numbers in/out,
integer paise internally.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/loans/calculate-emi` | Estimate EMI/total/interest (no side effects) |
| GET | `/api/loans/summary` | Totals, active count, upcoming/overdue counts |
| GET | `/api/loans/upcoming-payments` | Upcoming vs overdue installments |
| GET | `/api/loans` | List (search/type/status/pagination/sort) |
| POST | `/api/loans` | Create a loan (records liability only) |
| GET/PATCH | `/api/loans/:id` | Get / update safe metadata |
| POST | `/api/loans/:id/adjustment` | Audited outstanding-principal adjustment |
| POST | `/api/loans/:id/close` | Close (only when outstanding is zero) |
| GET | `/api/loans/:id/schedule` | Estimated amortization schedule + status |
| POST/GET | `/api/loans/:id/payments` | Record / list payments |
| GET | `/api/loans/:id/payments/:paymentId` | One payment |
| POST | `/api/loans/:id/payments/:paymentId/reverse` | Reverse a payment once |

### EMI calculation assumptions
Reducing-balance method with monthly compounding; `monthly rate = annual / 12 / 100`. Zero
interest is handled as `P / n`. Results are **estimates** that exclude fees, insurance, GST, and
lender-specific rounding — prefer a lender-provided EMI when the user has one. The schedule is
computed in integer paise; the final installment absorbs rounding so the balance closes at
exactly zero (never negative).

### Principal/interest accounting
A loan payment debits the bank by the **total**, reduces outstanding principal by the
**principal** component, and records the **interest** component as an expense. Principal is
never counted as an ordinary expense (no double counting). `paymentAmount` must equal
`principalPaid + interestPaid`; the split is taken from the user (never guessed). Registering a
loan records the liability only and moves no money. Payments on a closed loan are rejected;
closing requires a zero balance (settle the remainder with an audited adjustment first).

### Reversal
Loan-payment reversal is atomic across bank, loan, LoanPayment, ledger transaction, and the
interest-expense effect: it credits the bank back, restores outstanding principal (reopening a
closed loan), marks the original transaction/payment `reversed`, and writes reversing records.
Reversal is single-use (a second attempt returns 409) and idempotent; originals are preserved.

## REST API (Phase 4)

All endpoints below require authentication (`Authorization: Bearer <token>`), derive the user
from the verified JWT, and scope every query to that user. Monetary values in requests and
responses are **rupee JSON numbers**; the server converts to/from integer paise internally.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bank-accounts` | List the user's accounts |
| POST | `/api/bank-accounts` | Create an account (atomic opening-balance ledger entry) |
| GET | `/api/bank-accounts/:id` | Get one owned account |
| GET | `/api/bank-accounts/:id/transactions` | Account transactions (pagination/date/type/sort) |
| PATCH | `/api/bank-accounts/:id` | Update safe metadata only (never balances) |
| DELETE | `/api/bank-accounts/:id` | Deactivate (never hard-delete) |
| POST | `/api/expenses` | Record an expense (atomic; idempotency key) |
| GET | `/api/expenses` | List with filters + total + pagination |
| GET | `/api/expenses/:id` | Get an expense + its transaction |
| PATCH | `/api/expenses/:id` | Correct (reverse + replace, atomic) |
| DELETE | `/api/expenses/:id` | Controlled reversal (no physical delete) |
| POST | `/api/expenses/:id/reverse` | Reverse once; restores balance |
| GET | `/api/transactions` | History (pagination/date/type/account/amount/sort) |
| GET | `/api/dashboard/summary` | Totals, accounts, recent txns, category + daily breakdowns |

### Example: create an account
```http
POST /api/bank-accounts
{ "bankName": "HDFC Bank", "accountName": "Salary Account",
  "accountType": "savings", "currency": "INR", "openingBalance": 50000 }

201 → { "success": true, "data": { "account": { "id": "...", "currentBalance": 50000, ... } },
        "message": "Bank account created" }
```

### Example: record an expense
```http
POST /api/expenses
Idempotency-Key: 1f2e...            # optional; safe retries
{ "amount": 250.5, "category": "Food", "accountId": "<id>",
  "description": "Lunch", "expenseDate": "2026-10-23" }

201 → { "success": true,
        "data": { "expense": { "amount": 250.5, ... },
                  "account": { "currentBalance": 49749.5 }, "idempotentReplay": false } }
```

### Example: dashboard summary
```json
{
  "totals": {
    "totalBankBalance": 49749.5, "todayExpenses": 250.5, "monthExpenses": 250.5,
    "outstandingLoanPrincipal": 0, "totalInvestmentCostBasis": 0,
    "investmentCurrentValue": null
  },
  "accounts": [ ... ], "recentTransactions": [ ... ],
  "expenseCategoryBreakdown": [ ... ], "dailyExpenseTotals": [ ... ]
}
```
`investmentCurrentValue` is `null` when any holding lacks a market price — unknown is never
reported as a verified zero.

### Opening balance, corrections, and serialization
- **Opening balance** is stored on the account AND recorded atomically as an `income` ledger
  entry (`category: "opening_balance"`), never as an ordinary expense.
- **Correction** (`PATCH /api/expenses/:id`) atomically reverses the original and records the
  corrected expense; the original is preserved (marked `reversed`). Correcting an
  already-reversed expense is rejected, so a correction cannot be processed twice.
- **Delete** reverses rather than physically deleting; records stay for audit.
- **Money serialization**: rupee JSON numbers are safe up to `Number.MAX_SAFE_INTEGER` paise
  (~₹90 trillion); beyond that the serializer throws rather than silently losing precision.

## Financial architecture (Phase 3)

### Money storage
All monetary values are **integer paise** (1 INR = 100 paise). Example: ₹1,250.50 = `125050`.
No floating-point money is ever stored. Model validators reject non-integer amounts.

### Data model relationships
```
User 1───* BankAccount
User 1───* Transaction        (the central ledger; one entry per balance change)
User 1───* Expense            Expense 1───1 Transaction (transactionId)
User 1───* Loan               Loan 1───* LoanPayment
User 1───* LoanPayment        LoanPayment 1───1 Transaction
User 1───* Investment         Investment 1───* InvestmentTransaction
User 1───* InvestmentTransaction  InvestmentTransaction 1───1 Transaction
```
Every financial document carries `userId`. Ownership is always derived from the verified JWT,
never from the request body. Queries and service loads filter by `userId`; a resource owned by
another user is reported as "not found" (never leaking its existence).

### Transaction processing
All balance changes go through `services/transaction.service.js`. For each operation the service:
validates the user and amount, loads the affected account(s) scoped to the user, checks funds
(unless overdraft is enabled), applies balance deltas, writes the `Transaction` plus any linked
domain record, and **commits atomically** inside a MongoDB multi-document transaction. Any
failure rolls everything back.

**Transaction types:** `expense`, `income`, `transfer`, `loan_payment`, `investment_purchase`,
`investment_sale`, `adjustment`. Positive `amountPaise`; direction comes from the type plus the
source/destination account fields.

### MongoDB replica-set requirement (important)
Financial writes **require** a replica set (multi-document transactions). On a standalone server
the service refuses the write with a clear configuration error — it never silently performs
unsafe, non-atomic balance updates. Local single-node replica set:
```bash
mongod --dbpath /your/data/path --replSet rs0
# once, in mongosh:
rs.initiate()
# then set MONGODB_URI, e.g. mongodb://127.0.0.1:27017/finance_app?replicaSet=rs0
```
The health endpoint reports `database.transactionsSupported` so you can confirm.

### Idempotency
Financial writes accept an optional `idempotencyKey`. A unique partial index on
`(userId, idempotencyKey)` guarantees a given key posts at most one transaction per user.
Retrying with the same key returns the original result (replay); reusing a key with a
**different** payload is rejected (409). This protects against duplicate submissions and is not
an in-memory lock.

### Reversal strategy
Posted transactions are **never deleted**. To undo one, `reverseTransaction` restores the exact
balance effects, marks the original `status: 'reversed'` (linked via `reversedById`), and writes
a paired reversing `Transaction` (linked via `reversalOfId`). A transaction can be reversed at
most once, and a reversal cannot itself be reversed. The original is preserved for audit.
Future expense edits/deletes use controlled reverse-and-replace, not physical deletion.

### Loan payment accounting
Recording a payment atomically: debits the bank by the **total** payment, reduces the loan's
**outstanding principal** by the principal component, and records the **interest** component as
an `Expense`. Principal repayment is never counted as an expense (no double counting);
`paymentAmountPaise` must equal `principalPaidPaise + interestPaidPaise`.

### Investment accounting
A **purchase** debits the funding bank and increases cost basis (`totalInvestedPaise`) and
quantity — it is never an expense. A **sale** credits the bank with proceeds, reduces quantity
and cost basis (average-cost method), and reports realized gain/loss. Current market value
(`currentValuePaise`) is **optional**: `null` means UNKNOWN and is never treated as zero.

### Dashboard calculation rules (Asia/Kolkata)
Day/month boundaries use the **Asia/Kolkata** timezone (fixed UTC+05:30).
- **Total bank balance:** sum of active accounts' `currentBalancePaise`.
- **Expenses today / this month:** sum of `Expense.amountPaise` whose linked transaction is
  still `posted` (reversed expenses are excluded). Includes loan **interest**; excludes
  principal, transfers, and investment purchases.
- **Outstanding loan principal:** sum of active loans' `outstandingPrincipalPaise`.
- **Investment cost basis:** sum of `totalInvestedPaise`.
- **Investment valuation:** sum of **known** `currentValuePaise` only, with counts of holdings
  that have known vs. unknown values so unknowns are never shown as zero.
- Transfers net to zero across a user's accounts and never count as income or expense;
  adjustments are reflected directly in account balances.

## Authentication

The API uses **cookie-based sessions** backed by a JWT (migrated from the earlier
localStorage bearer-token scheme).

- `POST /api/auth/register` — creates the account **and** establishes a session (sets cookies)
- `POST /api/auth/login` — verifies credentials and sets session cookies; one generic error for bad email/password
- `GET /api/auth/me` — protected; returns the authenticated user's profile
- `POST /api/auth/logout` — clears the session cookies

### How sessions work
On login/register the server sets two cookies:
- **`access_token` (HttpOnly, SameSite, Secure in production)** — the signed JWT. Being HttpOnly,
  it is **never readable by JavaScript**, so it is not exposed to XSS the way localStorage was.
  The browser sends it automatically with every request (`withCredentials`).
- **`csrf_token` (readable)** — a random value for CSRF defence (see below).

`requireAuth` reads the JWT from the cookie first, with an `Authorization: Bearer` header accepted
as a fallback for non-browser API clients. Identity always comes from the verified `sub` claim —
never from the request body. Inactive/deleted users and invalid/expired tokens are rejected with
a 401. The frontend keeps **no token in JavaScript/localStorage**; it tracks only the in-memory
user object and relies on `/auth/me` at startup to restore the session.

### CSRF protection
State-changing requests (POST/PUT/PATCH/DELETE) on a cookie session use the **double-submit
cookie** pattern: the SPA reads the readable `csrf_token` cookie and echoes it in an
`X-CSRF-Token` header, which the server compares (constant-time) to the cookie. Safe methods
(GET/HEAD/OPTIONS) are exempt, as are pure bearer-token requests (an attacker cannot set a custom
`Authorization` header cross-site). A missing/mismatched token yields **403**.

### CORS & cookies
`CORS_ORIGIN` must list the exact frontend origin(s) — wildcards are incompatible with credentialed
requests. `COOKIE_SAMESITE` defaults to `lax` (same-site SPA); use `none` (which forces `Secure`,
i.e. HTTPS) only for a cross-site frontend. In production the auth cookie is always `Secure`.

**Residual limitation:** JWTs remain stateless, so logout clears the cookie but a token copied
before logout stays valid until it expires. Keep `JWT_EXPIRES_IN` modest; add refresh-token
rotation or a denylist if hard revocation is required.

---

## Repository Structure

```
Daily Expence app/
├── backend/            # Express REST API
│   ├── src/
│   │   ├── config/     # env + database connection
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── app.js      # Express app (no listen) — importable for tests
│   │   └── server.js   # bootstraps DB + starts HTTP server
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── frontend/           # React + Vite SPA
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.example
│   └── package.json
└── README.md
```

---

## Prerequisites

- Node.js 18+ (tested on Node 23)
- npm 9+
- MongoDB 6+ running locally, or a MongoDB Atlas connection string

### MongoDB transactions note

Multi-document transactions require MongoDB to run as a **replica set**. For local development
you can start a single-node replica set:

```bash
mongod --dbpath /your/data/path --replSet rs0
# then once, in mongosh:
rs.initiate()
```

The backend detects whether transactions are available (`health.database.transactionsSupported`).
Read-only endpoints work on a standalone server, but **financial writes require a replica set**
and are refused with a clear configuration error on standalone deployments — the service never
performs unsafe, non-atomic balance updates. Always use a replica set for anything beyond
read-only local exploration. See "Financial architecture → MongoDB replica-set requirement".

---

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env     # then edit values as needed
npm install
npm run dev              # starts on http://localhost:5000
```

Health check:

```bash
curl http://localhost:5000/api/health
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env     # VITE_API_URL defaults to http://localhost:5000/api
npm install
npm run dev              # starts on http://localhost:5173
```

---

## Scripts

### Backend
- `npm run dev` — start with auto-reload (node --watch)
- `npm start` — start the server
- `npm test` — run the test suite (Vitest). Financial/transaction tests spin up an in-memory
  MongoDB **replica set** (`mongodb-memory-server`) so real multi-document transaction behavior
  (atomic commit + rollback) is exercised, not simulated on standalone.

### Frontend
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production build

---

## Environment Variables

See `backend/.env.example` and `frontend/.env.example`. Never commit real secrets.

---

## Currency & Precision

All monetary values are persisted as **integer paise** (1 INR = 100 paise) to avoid
floating-point rounding errors. Formatting helpers convert to `₹` for display.

---

## Architecture overview

```
Client (React/Vite SPA)  ──HTTPS/JSON──►  Express REST API  ──►  MongoDB (replica set)
   AuthContext (JWT)                         requireAuth middleware
   Axios (single instance, bearer token)     controllers → services → models
   Toast + DashboardRefresh contexts         atomic withTransaction() for all money writes
```

- **Layered backend:** `routes → controllers → services → models`. Controllers validate input
  and shape responses (rupees); services own business rules and all balance mutations inside
  MongoDB transactions; models enforce schema/validation and integer-paise storage.
- **One ledger:** every balance change is a `Transaction` row. Domain rows (`Expense`,
  `LoanPayment`, `InvestmentTransaction`) link 1:1 to a ledger transaction. Posted transactions
  are never physically deleted — corrections and deletions use reversal + replacement.
- **Money:** stored and computed as integer paise; converted to rupee JSON numbers only at the
  API boundary (`paiseToRupeesNumber`, which refuses values beyond `Number.MAX_SAFE_INTEGER`).

## Project structure

```
backend/src/
  config/       env.js (validated config), database.js (connect + withTransaction)
  controllers/  auth, account, expense, transaction, dashboard, loan, investment
  middleware/   auth.js (requireAuth), errorHandler.js
  models/       User, BankAccount, Transaction, Expense, Loan, LoanPayment, Investment, InvestmentTransaction
  routes/       one router per module, mounted under /api
  services/     account, transaction, expense, transactionQuery, dashboard, loan, loanSchedule, investment
  utils/        money, parseAmount, emi, datetime, serialize, token, password, validators, ApiError, apiResponse, asyncHandler, logger
backend/tests/  money, health, auth, models, transaction/loan/investment service, api.phase4, loan.api, investment.api, phase7.integration, phase7.concurrency
frontend/src/
  api/          client.js (single Axios) + per-module modules
  context/      AuthContext, ToastContext, DashboardRefreshContext
  components/   Layout, Sidebar, route guards, forms, modals, Spinner/EmptyState/ErrorState/ConfirmModal, BarChart
  pages/        Login, Register, Dashboard, BankAccounts, Expenses, Transactions, Loans, Investments
  test/         routing, bankAccounts, expenses, dashboard, loans, investments
```

## MongoDB: development vs production

Financial writes require a **replica set** (multi-document transactions). On a standalone server
the API refuses money-moving writes with a clear 400 rather than performing unsafe non-atomic
updates. Read-only endpoints still work on standalone.

**Do not modify or stop a system MongoDB service without authorization.** For local development,
run a *separate* single-node replica set on an unused port so it never touches a system instance:

```bash
mkdir -p /tmp/finance-rs
mongod --dbpath /tmp/finance-rs --port 27018 --replSet rs0 --unixSocketPrefix /tmp/finance-rs
# once, in another shell:
mongosh --port 27018 --eval 'rs.initiate()'
# point the backend at it:
#   MONGODB_URI=mongodb://127.0.0.1:27018/finance_app?replicaSet=rs0
```

Production should use a managed replica set (e.g. MongoDB Atlas) or a 3-node self-managed set.

## Test commands

```bash
cd backend  && npm test     # Vitest; financial tests spin up an in-memory replica set
cd frontend && npm test     # Vitest + Testing Library (jsdom)
cd frontend && npm run build
```

## Backup & recovery

- **Backup:** `mongodump --uri "$MONGODB_URI" --out /backups/$(date +%F)` on a schedule (e.g.
  nightly cron). Store backups off-host and encrypted. On Atlas, enable continuous/cloud backups.
- **Restore:** `mongorestore --uri "$MONGODB_URI" /backups/<date>`. Always restore into a staging
  database first and verify dashboard totals reconcile against the ledger before promoting.
- Because posted transactions are immutable (reversal, not deletion), point-in-time ledger
  history is preserved and auditable; backups capture the full corrective trail.

## Production readiness & deployment checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` set to a strong unique value (≥32 chars; the server refuses to start otherwise)
- [ ] `MONGODB_URI` points at a **replica set**; connection verified via `/api/health`
      (`database.transactionsSupported: true`)
- [ ] `CORS_ORIGIN` set explicitly to the production frontend origin(s)
- [ ] Served over **HTTPS** (required so the Secure auth cookie is transmitted; mandatory if `COOKIE_SAMESITE=none`)
- [ ] `.env` present on the server and git-ignored; `.env.example` contains placeholders only
- [ ] No backend secret exposed through `VITE_*` variables (frontend only reads `VITE_API_URL`)
- [ ] Production 5xx responses return a generic message with no stack trace (verified in errorHandler)
- [ ] Rate limiting active (global API limiter + stricter auth limiter)
- [ ] Database backups scheduled and a restore tested
- [ ] Process manager / orchestrator handles graceful shutdown (SIGINT/SIGTERM close server + DB)
- [ ] `npm audit --omit=dev` is clean for both `backend/` and `frontend/` (currently 0 production
      vulnerabilities; frontend uses React Router v7, which patches advisories GHSA-wrjc-x8rr-h8h6
      and GHSA-337j-9hxr-rhxg). Remaining advisories are dev-only tooling (vitest/vite) and do not ship.

## Known limitations & residual risk

- **Token storage (resolved):** authentication now uses an **HttpOnly, SameSite, Secure-in-prod**
  cookie for the JWT, so the token is no longer exposed to JavaScript/XSS. CSRF is handled with a
  double-submit token. A bearer-header fallback remains for non-browser API clients.
- **No token revocation:** JWTs remain stateless, so logout clears the cookie but a token copied
  before logout is valid until it expires. Mitigate with a short `JWT_EXPIRES_IN` + refresh-token
  rotation or a denylist if hard revocation is required.
- **Single cookie / no refresh token:** there is one access-token cookie and no sliding refresh;
  sessions end at the JWT's expiry. A refresh-token flow is a reasonable future enhancement.
- **Investment reversal policy:** a purchase/sale can only be reversed when it is the most recent
  cost-basis-affecting activity for that investment; otherwise the API returns 409 and asks the
  user to reverse later activity first or record a compensating transaction. This prevents
  inconsistent weighted-average cost basis rather than silently applying an unsafe inverse.
- **No public transfer endpoint:** the transfer *service* exists and is tested, but no HTTP route
  exposes it yet (transfers are an internal/future UI feature).
- **EMI/valuation are estimates:** EMI uses reducing-balance with no lender fees; valuations are
  manual — the app never fetches live market prices.
- **Single-process rate limiting:** the in-memory limiter is per-instance; use a shared store
  (e.g. Redis) behind multiple instances.
