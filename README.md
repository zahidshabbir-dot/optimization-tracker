# Optimization Tracker

Working build of the "Client Optimization Tracker" design. Every screen reads live data and updates instantly in every open browser.

| Screen | Route | What works |
|---|---|---|
| Projects | `/` | Live list, search, status filters (Improving / Needs attention / Onboarding), conversion lift, mobile speed gain |
| Project detail | `/projects/:id` | Key dates, before/after cards (CVR, speed, desktop, LCP, AOV, RPV, custom metrics), history. New entries flash in live |
| Add data · Type it in | `/add?tab=manual` | Pick a project and date, before/after per metric, add or remove metrics, add your own metric, note |
| Add data · Upload Excel | `/add?tab=excel` | Drag-drop or choose an `.xlsx` or `.csv` file, preview with row-level checks, import, download the template |
| Add data · New project | `/add?tab=new` | Create a client with optional starting numbers, then open its page |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. By default the app uses the **Supabase** project `optimization-tracker` (URL and publishable key in `.env`).

### Local backend (no Supabase)

```bash
npm run server      # SQLite + live updates on :8787
npm run dev:local   # app uses the local server via /api
```

## Data model

`projects` → `entries` (one history row per save or import) → `metric_values` (`metric_key`, `phase` before/after, `value`).

- **Before** = the earliest "before" value; **After** = the latest "after" value.
- **Status:** conversion lift ≥ 15% → Improving; below 15% → Needs attention; no "after" value yet → Onboarding.
- Lower load time (LCP) counts as an improvement.
- Writes go through the Postgres functions `add_entry` and `create_project`, so each save is all-or-nothing.
- Realtime uses Supabase `postgres_changes` on all three tables (Server-Sent Events in local mode).

## Excel format

Columns: `Project, Date, Metric, Before/After, Value`. The header names are flexible ("Client", "Phase", etc. also work), and so are the metric names ("CVR", "Conversion rate", "AOV", "Mobile speed", "LCP"). Any other metric name becomes a custom metric. Project names must match an existing project. Old `.xls` files need to be re-saved as `.xlsx`.

## Security note

The design has no login, so row-level security currently lets anyone holding the public key **read and add** data. Nobody can update or delete metric values through that key. Before sharing the app publicly, add Supabase Auth and limit the policies to `authenticated` users.
