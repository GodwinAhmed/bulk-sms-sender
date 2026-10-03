# BulkSMS Sender — Ultrand.Tech

A bulk SMS sender with XLSX import, message personalization, and BulkSMS JSON API v1
integration. It runs on Cloudflare Pages.

## Stack
| Piece | Service | What it does |
|-------|---------|--------------|
| Hosting + API | **Cloudflare Pages** (+ Pages Functions) | Serves `public/` and the `/api/*` routes in `functions/` |
| Sign-in | **Clerk** | Only signed-in users can reach the app and API |
| Database | **Neon** (Postgres) | Campaign history and a record of every message sent |
| File storage | **Cloudflare R2** | Archives each uploaded spreadsheet and the delivery report CSV |
| Email | **Resend** | Emails the delivery report to the user when a campaign finishes |

BulkSMS credentials are still entered in the UI for each session. They are never stored.

## Project layout
```
public/                 static frontend (vanilla JS SPA)
functions/api/          Pages Functions (one file per route)
  _middleware.js        Clerk session check for every /api route except /api/config
  config.js             GET  /api/config                  public Clerk key
  balance.js            POST /api/balance                 BulkSMS credit balance
  campaigns/index.js    GET/POST /api/campaigns           history / create (+ R2 upload)
  campaigns/[id]/send.js      POST  send one chunk (≤20 contacts)
  campaigns/[id]/complete.js  POST  save report to R2 + email via Resend
  campaigns/[id]/report.js    GET   download report CSV
server/                 shared helpers (BulkSMS, Neon, Resend)
db/schema.sql           database schema
wrangler.toml           Pages config: R2 binding + public vars
```

---

## Deploy: one-time setup

You need accounts on Cloudflare, Neon, Clerk and Resend. Run every command from the
project root, after `npm install`.

### 1. Neon (database)
1. Create a project at <https://console.neon.tech>.
2. Open **Connect**, and copy the **pooled** connection string (`postgresql://…?sslmode=require`).
3. Create the tables:
   ```bash
   # PowerShell:  $env:DATABASE_URL="postgresql://..."; npm run db:migrate
   DATABASE_URL="postgresql://..." npm run db:migrate
   ```
   You can also paste `db/schema.sql` into Neon's SQL Editor and run it there.

### 2. Clerk (sign-in)
1. Create an application at <https://dashboard.clerk.com> and choose the sign-in methods you want (for example, Email).
2. Under **API Keys**, copy the **Publishable key** (`pk_…`) and the **Secret key** (`sk_…`).
3. **Lock it down.** This app sends paid SMS, so don't leave sign-up open. Go to
   **Configure → Restrictions** and turn on **Restricted** mode (invite only) or an
   **Allowlist** of your email addresses.
4. For production, a Clerk *production* instance needs a domain you own, which you add
   under **Domains**. The *development* keys (`pk_test_`) work on `*.pages.dev`
   for testing.

### 3. Resend (email)
1. At <https://resend.com/domains>, add and verify your sending domain. If the domain uses
   Cloudflare DNS, Resend can add the DNS records for you.
2. Create an API key with **Sending access** (`re_…`).

### 4. Cloudflare R2 (file storage)
```bash
npx wrangler login
npx wrangler r2 bucket create bulksms-sender-files
```
Keep the bucket private. The app reads and writes it through the `FILES` binding, so it
needs no public URL or access keys.

### 5. Cloudflare Pages (hosting)
1. Fill in the public values in `wrangler.toml`:
   ```toml
   CLERK_PUBLISHABLE_KEY = "pk_live_..."   # or pk_test_...
   EMAIL_FROM = "BulkSMS Sender <reports@yourdomain.com>"   # domain verified in Resend
   ```
2. Create the project and add the secrets:
   ```bash
   npx wrangler pages project create bulksms-sender --production-branch main
   npx wrangler pages secret put CLERK_SECRET_KEY --project-name bulksms-sender
   npx wrangler pages secret put DATABASE_URL     --project-name bulksms-sender
   npx wrangler pages secret put RESEND_API_KEY   --project-name bulksms-sender
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
   Wrangler prints your URL, for example `https://bulksms-sender.pages.dev`.

**Optional: deploy on every push.** In the Cloudflare dashboard, go to **Workers & Pages → bulksms-sender →
Settings → Builds** and connect the GitHub repo. Leave the build command empty and set
the output directory to `public`. Pages installs `package.json` dependencies and picks
up `functions/` and `wrangler.toml` automatically.

**Custom domain:** In the Pages project, go to **Custom domains** and add your domain. Then add
that domain in Clerk (step 2.4).

---

## Local development
```bash
cp .dev.vars.example .dev.vars   # fill in CLERK_SECRET_KEY, DATABASE_URL, RESEND_API_KEY
npm run dev                      # http://localhost:8788
```
`wrangler pages dev` simulates R2 locally, and reads `CLERK_PUBLISHABLE_KEY` and
`EMAIL_FROM` from `wrangler.toml`.

## Workflow
1. **Sign in** with Clerk.
2. **Credentials**: paste your BulkSMS Token ID and Token Secret.
3. **Import File**: upload an .xlsx, .xls or .csv contact list. It's parsed in the browser.
4. **Map Columns**: pick the column that holds the phone numbers.
5. **Compose**: write the message, using `{{ColumnName}}` variables.
6. **Preview & Send**: review the batch. Test mode runs only in the browser and uses no credits.
7. **Results**: download the delivery CSV. The report is also saved to R2 and emailed to you.
8. **Dashboard**: campaign statistics, with PDF and Excel export.
9. **History**: every live campaign, with its stored report.

Live sends go out in chunks of 20 contacts per request, which keeps each request inside
Cloudflare's free-plan limit of 50 subrequests per request. The progress bar shows real
progress.

## XLSX Format
| Name       | Phone       | Company    | Date       |
|------------|-------------|------------|------------|
| Sipho Dube | 0821234567  | Acme Ltd   | 15 Apr     |

Message: `Hi {{Name}}, your meeting at {{Company}} is on {{Date}}.`

## Phone Numbers
- South African numbers that start with `0` are converted to `+27XXXXXXXXX`.
- Numbers that start with `+` are used as-is (E.164).
- You can change the country prefix for each session with the country prefix selector.

## BulkSMS API Docs
https://www.bulksms.com/developer/json/v1/

---
Built by Ultrand.Tech · AutomataCore
