# Dashboard ClickUp

A live, read-only project dashboard for a **ClickUp** list. It turns raw tasks into
an executive view: status distribution by area, a blocked-work board, powerful task
filters, weekly-report tooling, swimlanes, a real task hierarchy, and a timeline —
all rendered in the browser and refreshed live from the ClickUp REST API.

> **Live demo:** _add your Vercel URL here, e.g._ `https://dashboard-clickup.vercel.app`

---

## Highlights

- **Zero build step.** A single static front-end plus one serverless function.
- **Token never leaves the server.** The browser only talks to `/api/clickup`; the
  ClickUp token lives in a Vercel environment variable and is used only server-side.
- **Fast by design.** The ClickUp REST list endpoint returns custom fields and
  parent links in bulk, so the whole dataset loads in a handful of requests instead
  of one call per task.
- **Dynamic to the workspace.** Statuses, colours, custom-field options and the task
  tree are read from ClickUp at load time — rename a status or add an area and the
  dashboard follows automatically.

## Features

**Dashboard** — overall status doughnut, status distribution per Area, and a
data-quality panel that flags tasks missing a required field (Assignee App, Priority,
Area, Feature) with direct links to fix them in ClickUp.

**Tasks Filters** — filter by Assignee App, status, area, due-date range and free text;
quick theme chips (Blocked, Overdue, In Review, Ready for Approval, …); grouped by
status with a PDF export.

**Weekly Reports** — a card-based module that models automated report delivery to
Slack end to end: a weekly **schedule** (day/time/timezone + the MSG intro message),
reusable **report configurations** (status, area, assignee app, tags, overdue),
**Slack channels** and **Slack users** as recipients, each with PDF / preview / test
actions. Running a delivery opens a console that walks the real pipeline — build the
PDF, compose the intro, attach it, deliver — with the Slack transport stubbed
(`SIMULATED`); nothing leaves the browser. Settings persist through `/api/settings`
when a store is configured, otherwise per-browser.

**General Reports** — executive overview: summary cards, status/priority/area donuts,
status-, priority- and tag-breakdowns per area, a top-users bar chart, and a sortable
recent-activity table with date filters, plus its own multi-page **Generate Report PDF**.

**Blocked** — a dedicated board for blocked tasks: distribution by Area and Priority,
by-area and by-assignee-app breakdowns, and a full list with links.

**Swimlanes** — Area × real ClickUp status matrix with a per-area completion bar.

**Tree Tasks** — a faithful mirror of the ClickUp parent → subtask hierarchy with the
same columns (Assignee App, Priority, Area, Feature, Due date), loaded on demand.

**Status Breakdown / Timeline / Risks** — status table by ClickUp type, a stacked
"due by month" chart with a cumulative completion trend and a date-range filter, and
an automatic list of inconsistencies.

## Tech stack

- **Front-end:** vanilla HTML/CSS/JS, [Chart.js](https://www.chartjs.org/) for charts
  (loaded from a pinned CDN with SRI). No framework, no bundler.
- **Backend:** a single Node serverless function on **[Vercel](https://vercel.com/)**.
- **Data source:** the **ClickUp REST API v2**.

## Architecture

```
Browser (index.html)
  │  fetch('/api/clickup?op=tasks|fields|statuses')
  ▼
Vercel serverless function (api/clickup.js)
  │  adds Authorization: <CLICKUP_API_TOKEN>   ← server-side only
  ▼
ClickUp REST API  →  the configured list only
```

The front-end never sees the token or the ClickUp endpoints. A thin bridge in
`index.html` adapts the app's data calls to the proxy and normalises the responses;
custom fields, parent links and statuses are read once, in bulk, and cached in memory.

## Project structure

```
.
├── api/
│   ├── clickup.js      # serverless proxy: GET-only, whitelisted to this list
│   └── settings.js     # shared settings store for the Weekly Reports module
├── index.html          # the dashboard (bridge + application)
├── vercel.json         # HTTP security headers (CSP, X-Frame-Options, …)
├── package.json
├── .env.example        # required environment variables
├── LICENSE             # MIT
└── README.md
```

## Configuration

| Variable | Description |
|---|---|
| `CLICKUP_API_TOKEN` | ClickUp personal API token (`pk_…`). Stored only in Vercel. |
| `CLICKUP_LIST_ID`   | The ClickUp List ID to read (the number at the end of `/li/<ID>`). |
| `UPSTASH_REDIS_REST_URL` | _Optional._ Settings store for the Weekly Reports module. `KV_REST_API_URL` (injected by the Vercel Marketplace integration) is accepted too. |
| `UPSTASH_REDIS_REST_TOKEN` | _Optional._ Token for the store above (or `KV_REST_API_TOKEN`). Omit to keep settings per-browser. |

## Run locally

```bash
cp .env.example .env      # fill in your token + list id
npx vercel dev            # http://localhost:3000 (serves index.html + /api)
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. On Vercel, **Add New → Project → Import** the repo (framework preset: **Other**).
3. Add the two environment variables above.
4. Deploy — Vercel serves `index.html` statically and `api/clickup.js` as a function.

## Security

- The API token is **server-side only** — never shipped to the browser and excluded
  from version control via `.gitignore`.
- The proxy is **GET-only** and **whitelisted**: it can read only this list's tasks,
  fields and statuses — no other endpoint of the account is reachable.
- HTTP security headers are set in `vercel.json` (Content-Security-Policy,
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- The deployment is public and **read-only**, so point `CLICKUP_LIST_ID` at a list with
  non-sensitive / demo data.

## Roadmap

- Split the front-end into ES modules (`app.js`, `styles.css`, `bridge.js`) and drop
  `'unsafe-inline'` from the CSP using per-response nonces.
- Optional e-mail login for private deployments.
- A static-snapshot mode for a token-free, always-on demo.

## License

[MIT](./LICENSE) © 2026 Lucas B
