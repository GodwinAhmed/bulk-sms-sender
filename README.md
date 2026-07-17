# BulkSMS Sender — Ultrand.Tech

A production-grade SMS bulk sender with XLSX import, message personalization,
and BulkSMS JSON API v1 integration.

## Stack
- **Backend**: Node.js + Express
- **XLSX Parsing**: SheetJS (xlsx)
- **HTTP Client**: Axios
- **Frontend**: Vanilla JS SPA (dark industrial UI)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env config
cp .env.example .env

# 3. Run
node server.js

# Open → http://localhost:3500
```

## Workflow
1. **Credentials** — Paste your BulkSMS Token ID + Token Secret
2. **Import File** — Upload .xlsx / .csv with contacts
3. **Map Columns** — Select which column = phone numbers
4. **Compose** — Write your message with `{{ColumnName}}` variables
5. **Preview & Send** — Review batch, toggle test mode, fire
6. **Results** — Download delivery CSV report
7. **Dashboard** — Review campaign statistics and export the report as PDF or Excel

## Dashboard Exports
- **PDF** and **Excel** exports are generated in the browser from the current imported batch and latest send result.
- The export libraries are bundled locally in `public/vendor/`, so the dashboard works without a CDN connection.
- Dashboard statistics always reflect the current file and template shown in the app.

## XLSX Format
| Name       | Phone       | Company    | Date       |
|------------|-------------|------------|------------|
| Sipho Dube | 0821234567  | Acme Ltd   | 15 Apr     |

Message: `Hi {{Name}}, your meeting at {{Company}} is on {{Date}}.`

## Phone Numbers
- South African numbers starting with `0` auto-convert to `+27XXXXXXXXX`
- Numbers with `+` prefix are used as-is (E.164)
- Configurable per-session via the country prefix selector

## Deploy to Railway
```bash
railway login
railway init
railway up
```

## API Endpoints
| Method | Path          | Description                         |
|--------|---------------|-------------------------------------|
| POST   | /api/parse    | Upload + parse XLSX → return rows   |
| POST   | /api/send     | Send batch via BulkSMS API          |
| POST   | /api/balance  | Check BulkSMS credit balance        |

## BulkSMS API Docs
https://www.bulksms.com/developer/json/v1/

---
Built by Ultrand.Tech · AutomataCore
