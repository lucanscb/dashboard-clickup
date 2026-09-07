> **Hi, I'm Lucas Bueno** technology and AI enthusiast, 10+ years of experience in the
> field. Have a look at my profile, and if you have questions about this project or just
> want to talk tech and AI, it would be a pleasure.
>
> **[Lucas Bueno — LinkedIn](https://www.linkedin.com/in/joaolucans/)**

# Dashboard ClickUp - Tracker

A live, read-only project dashboard for a single **ClickUp** list. It reads tasks, custom
fields and statuses straight from the ClickUp REST API and renders an executive view of
them in the browser: KPI strip, status distribution per area, a blocked-work board, task
filters, swimlanes, the real parent → subtask tree, a created-vs-closed timeline, an
automatic risk/inconsistency report and a Slack-oriented weekly-report module.

**Live:** <https://dashboard-clickup.vercel.app> · **Stack:** vanilla HTML/CSS/JS + one
Vercel serverless proxy · **Build step:** none.

The rest of this document is the technical description: architecture, data flow, HTTP
contracts, the front-end internals and the security model.

---

## 1. Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│  index.html  (single file, ~5.4k lines, no bundler, no framework)│
│                                                                 │
│  ┌───────────────────────┐      ┌────────────────────────────┐  │
│  │ bridge                │      │ application                │  │
│  │ window.cowork         │◄─────┤ fetchAllTasks() renderers  │  │
│  │   .callMcpTool(n,a)   │      │ Chart.js  SimplePDF  themes│  │
│  └──────────┬────────────┘      └────────────────────────────┘  │
└─────────────┼───────────────────────────────────────────────────┘
              │ fetch('/api/clickup?op=…')     fetch('/api/settings?ns=…')
              ▼                                          ▼
   ┌────────────────────────┐              ┌────────────────────────────┐
   │ api/clickup.js         │              │ api/settings.js            │
   │ GET-only, allow-listed │              │ GET/PUT, ns allow-listed   │
   │ adds Authorization     │              │ 256 KB cap                 │
   └──────────┬─────────────┘              └─────────────┬──────────────┘
              │ CLICKUP_API_TOKEN (server-side only)     │ Upstash Redis REST
              ▼                                          ▼   (optional)
      ClickUp REST API v2                        dashboard-clickup:weekly-reports
      — the configured list only
```

Two serverless functions, one static document. Nothing else runs on the server; there is
no session, no cookie, no user record and no write path back into ClickUp.

## 2. Boot sequence and data flow

1. `index.html` loads. The loading screen renders immediately (canvas backdrop + progress
   text) while the data layer starts.
2. `ensureFields()` calls the bridge, which hits `GET /api/clickup?op=fields`. The three
   `labels` custom fields (**Area**, **Feature**, **Assignee App**) come back with their
   `type_config.options`; the app builds an `optionId → label` map per field and caches it
   in `localStorage` (`dashboard-clickup_fielddefs_v2`).
3. `fetchAllTasksRaw()` pages through `GET /api/clickup?op=tasks&page=N`. The ClickUp list
   endpoint returns **100 tasks per page including `custom_fields` and `parent`**, so a
   full dataset costs `ceil(n/100)` requests instead of one request per task.
4. Every task is reduced by `webappMapTask()` to a slim record (§4) and, in the same pass,
   its custom-field values are resolved through the option map into `TASK_CF[id]`.
5. Statuses (order, colour, `type`) are read once from `GET /api/clickup?op=statuses`,
   which proxies `GET /list/{id}` — so the UI mirrors whatever the workspace defines
   rather than a hard-coded list.
6. `fetchAllTasks()` compares the result against the cached snapshot, writes the new one
   and returns an integrity verdict (§5). The app dispatches `dashboard-ready`, the
   backdrop fades out, the stored theme is applied and the tabs render.

Tabs render eagerly from the in-memory `ALL_TASKS` array except **Tree Tasks**, which
builds its hierarchy on first open.

## 3. HTTP contracts

### `GET /api/clickup`

GET-only (405 otherwise). Every response is JSON. Non-2xx from ClickUp is forwarded with
its status code; transport failures return 502.

| `op` | Proxies | Response | Notes |
|---|---|---|---|
| `tasks` | `GET /list/{id}/task?subtasks=true&include_closed=true&page=N` | `{ tasks: [], last_page: bool }` | `page` parsed as int and clamped to `0…500` |
| `fields` | `GET /list/{id}/field` | `{ fields: [] }` | used for the `labels` option maps |
| `statuses` \| `list` | `GET /list/{id}` | `{ statuses: [] }` | status order, colour and `type` |
| anything else | — | `400 {"error":"unknown op"}` | allow-list, not a pass-through |

Successful responses set `Cache-Control: s-maxage=30, stale-while-revalidate=120`, so the
Vercel edge absorbs reloads and shields the ClickUp rate limit.

The list is **never** taken from the query string. It comes from `CLICKUP_LIST_ID` on the
server, which is what makes the proxy safe to expose publicly: no other list, task or
endpoint of the account is reachable through it.

### `GET|PUT /api/settings?ns=weekly-reports`

Shared state for the Weekly Reports module.

```
GET  /api/settings?ns=weekly-reports   → 200 { value: <object|null> }
PUT  /api/settings?ns=weekly-reports   → 200 { ok: true }        body: { value: <object> }
```

- `ns` is checked against a hard-coded allow-list (`['weekly-reports']`) so the endpoint
  can never be used as an open key/value store — 400 otherwise.
- Payload capped at **256 KB**, enforced both while streaming the body and after
  serialisation (413).
- Backed by Upstash Redis over its REST interface with plain `fetch` — no SDK, no
  dependency. Key: `dashboard-clickup:weekly-reports`.
- Env vars are read under **either** naming scheme: `UPSTASH_REDIS_REST_URL/TOKEN`
  (database created directly on Upstash) or `KV_REST_API_URL/TOKEN` (injected by the
  Vercel Marketplace integration).
- With no store configured the endpoint answers `501 { error, fallback: "local" }` and the
  client falls back to `localStorage` with the same data shape. The UI shows a
  "Local settings (no store configured)" badge so the mode is never ambiguous.

## 4. The bridge, and why it exists

The dashboard was first built as a Claude Artifact, where it read ClickUp through an MCP
connector: `await window.cowork.callMcpTool(toolName, args)`. Porting it to the web meant
either rewriting ~4,000 lines of call sites, or re-implementing that one function.

`index.html` re-implements it. The bridge defines `window.cowork.callMcpTool` and maps the
three tool names the app uses onto proxy calls, returning the same
`{ content: [{ type: 'text', text: JSON.stringify(payload) }] }` envelope MCP produced:

| Tool name (substring match) | Bridge action |
|---|---|
| `clickup_get_custom_fields` | `op=fields` → `{ list_fields }` |
| `clickup_filter_tasks` | `op=tasks&page=N` → `{ tasks: tasks.map(webappMapTask) }` |
| `clickup_get_task` + `expand_statuses` | `op=statuses` → `{ available_statuses }` |

Two consequences worth knowing when reading the source:

- The app still runs a **tool-discovery handshake** (`TOOL_CANDIDATES`, retry-on-rate-limit,
  a diagnostic dump if nothing answers). It is inherited from the Artifact; the bridge
  answers the first candidate.
- `const LIST_ID` in the front-end and the `list_ids` argument passed to the bridge are
  vestigial. The effective list is the server-side `CLICKUP_LIST_ID`.

The migration reason is also a performance one. Over MCP, `custom_fields` and `parent` are
stripped from the bulk response, so Area/Feature/Assignee App had to be fetched one task at
a time — over a thousand extra calls against a 50-per-day beta quota. The REST list
endpoint returns them inline, which is why per-task enrichment is now a no-op.

### Task record

`webappMapTask()` reduces each ClickUp task to:

```js
{ id, name, url,
  status,            // raw lowercase string, e.g. "in progress"
  priority,          // "urgent" | "high" | "normal" | "low" | null
  assignees, tags,
  due_date, date_closed, date_created,   // epoch ms as strings
  parent, list }
```

Custom fields live outside that record, in `TASK_CF[id] = { vals: { area, feature,
'assignee app' }, parent, at }`. Statuses are kept **exactly as the API returns them** —
lowercase — and only prettified at render time. Comparisons against saved configurations
are therefore case-insensitive; the display label `To Do` never leaks into a filter.

## 5. Fetching, caching and the integrity check

The paging loop is deliberately defensive:

| Guard | Value / behaviour |
|---|---|
| Page size | 100 (ClickUp's fixed page size) |
| Safety cap | `maxPages = 60` → 6,000 tasks |
| Retries | 3 attempts per page, with the loader reporting rate-limit waits |
| Hard failure | a page that fails all retries **aborts the load** — a truncated dataset is never rendered as if it were complete |
| De-duplication | `Set` of task ids across pages; a full page of duplicates stops the loop |
| Termination | fewer than 100 rows, or an empty page |

The result is snapshotted to `localStorage` (`dashboard-clickup_task_cache_v1`) together
with fetch metadata (tool, pages, retries, elapsed ms). On the next load the fresh count is
compared against the cached one:

- `ok` — counts match, or the delta is shown as `Δ +12 vs last refresh (1543)`.
- `warning` — the count dropped by **≥ 10%**; the banner says so instead of quietly
  rendering a smaller project.
- `fallback` — the fetch failed entirely; the last snapshot is rendered with the timestamp
  it was taken.

That verdict is what the green/amber banner above the tabs reports.

### Client-side storage

| Key | Contents |
|---|---|
| `dashboard-clickup_task_cache_v1` | last successful task snapshot + fetch metadata |
| `dashboard-clickup_fields_cache_v2` | resolved custom-field values per task |
| `dashboard-clickup_fielddefs_v2` | field definitions and option maps |
| `dashboard-clickup_statuses_v1` | status order, colours and types |
| `dashboard-clickup_stfilter_*` | per-filter UI state |
| `dashboard-clickup_weekly_reports_v2` | Weekly Reports state when no server store is configured |
| `dashboard-clickup_theme` | `light` \| `dark` |

## 6. Modules

| Tab | What it computes |
|---|---|
| **Dashboard** | KPI strip (total, completion %, active, not started, done, complete, uncategorised) derived from ClickUp status `type`; overall doughnut; status distribution per Area; distribution by priority. Status chips act as filters and recompute the charts client-side. |
| **Tasks Filters** | Compound filter over assignee app, status (multi-select), area, due-date range and free text, plus quick chips (Blocked, Overdue, In Review, In Progress, Ready for Approval, Backlog, Complete, Unassigned App). Grouped by status, collapsible, with **Export PDF (with links)**. |
| **Blocked** | Everything scoped to `status = blocked`: totals, overdue share, missing-area and missing-assignee counters, distribution by area/feature/priority, and per-area / per-assignee bars. |
| **Risks & Inconsistencies** | Rule-based report: open defects, tasks on hold, tasks awaiting review, unassigned non-complete tasks, and **parent–child status inconsistencies** found by walking the tree (a parent marked complete over children that are not). |
| **Swimlanes** | Area × status matrix built from the live status list, with a completion bar per area. |
| **Status Breakdown** | Every ClickUp status with its `type` (open / custom / done / closed), count and share. |
| **Timeline** | Created (by `date_created`) vs closed (by `due_date`, status `complete`) bucketed by week/month, with cumulative net backlog on a second axis, and two independently filtered lists below. |
| **Tree Tasks** | Faithful mirror of the ClickUp parent → subtask hierarchy (up to three levels), same columns as the list views. Built on demand. |
| **Weekly Reports** | §7. |

## 7. Weekly Reports

Four configuration layers, each behind its own card and modal:

1. **Automatic Weekly Delivery** — day, time, timezone, default message (MSG), on/off.
2. **Report Configurations Filters** — reusable saved filters (statuses, area, assignee
   apps, overdue-only, per-configuration message). A live counter shows how many tasks the
   filter currently matches.
3. **Slack Channels** — name, channel ID, assigned configuration, weekly on/off.
4. **Slack Users** — one row per `Assignee App` value, each with its own configuration,
   destination and weekly on/off.

State goes through `WrStore`, which tries `/api/settings` first and falls back to
`localStorage`; `WrStore.mode` (`'server'` | `'local'`) drives the badge in the UI.

Matching is done by `wrMatches(task, cfg)` against the raw ClickUp strings, with
case-insensitive status comparison. `wrTasksFor(cfg)` returns the matched set, which feeds
both the counter and the PDF.

### What is real and what is simulated

Real: the filters, the task matching, the recipient model, the schedule evaluation
(current time vs day/hour/timezone), the generated PDF and the delivery console, which
walks the actual pipeline step by step — build PDF → compose the intro message → attach →
deliver.

Simulated: the **Slack transport**. The last step is stubbed and labelled `SIMULATED`;
nothing leaves the browser. The UI states this in both the schedule modal and the delivery
console. In the private original this leg is a real Slack API call, driven by an external
scheduler pinging an endpoint every few minutes; that endpoint (`/api/cron-reports`) is
**not implemented in this public repository** — see §12.

## 8. PDF engine

There is no PDF library. `SimplePDF` (~90 lines) writes PDF 1.4 objects by hand:

- A4 portrait, `595.28 × 841.89 pt`, 42 pt margins, base-14 Helvetica (no font embedding).
- Text, rules, filled rectangles, and doughnut charts drawn as Bézier-approximated wedges.
- **Link annotations** per page, so task names in the exported report open the task in
  ClickUp.
- Automatic pagination with a cursor (`this.y`) and per-page annotation buckets.
- Text is sanitised to Latin-1 and dates are formatted with a forced `en-US` locale, so the
  output is identical regardless of the viewer's browser locale.

Three exports use it: the Tasks Filters export, the per-configuration Weekly Report, and
the General Reports **Project Progress Report**.

## 9. Theming

A CSS custom-property system with two complete palettes:

- `:root` — dark, the default token set.
- `:root[data-theme="light"]` — light, designed rather than inverted.

Roughly 60 tokens cover surfaces, borders, text, accents, semantic states (ok / warn /
error), the delivery console, chart text and grid. **Shape is themed too**: the dark theme
follows a dope.security-style reference (`--radius-card: 19.2px`, `--radius-btn: 8px`,
pill `1584px`), the light theme an Apple-style one (`8px` cards, `980px` pills).

Two details that matter in the implementation:

- Chart.js reads its colours once at construction, so `syncChartTheme()` pushes
  `--chart-text` / `--chart-grid` into `Chart.defaults` and calls `update('none')` on every
  live instance in `Chart.instances`.
- The theme is applied on the `dashboard-ready` event (and once more after 1 s for
  late-mounted charts), never during boot — the loading screen is intentionally left in its
  own palette.

Default is **light**; the choice persists in `dashboard-clickup_theme`.

## 10. Security model

- **The API token never reaches the browser.** It exists only as a Vercel environment
  variable, read inside `api/clickup.js`.
- **The proxy is GET-only and allow-listed.** Four operations, one list, no pass-through
  parameter that could redirect it at another endpoint. `page` is parsed and clamped.
- **The settings endpoint is namespaced and capped**, so it cannot be turned into arbitrary
  storage.
- **No write path.** Nothing in this deployment can create, update or delete anything in
  ClickUp.
- **HTTP headers** are set in `vercel.json`: `Content-Security-Policy`, `X-Frame-Options:
  SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` (geolocation, microphone and
  camera disabled).
- **Chart.js is pinned and integrity-checked** —
  `chart.js@4.5.0` from jsDelivr with an SRI `sha384` hash and `crossorigin="anonymous"`;
  `connect-src` is `'self'`, so the page can only talk to its own functions.
- The deployment is public and read-only, so `CLICKUP_LIST_ID` should point at a list with
  non-sensitive or demo data. This one holds ~1,555 fictional tasks.

Current CSP caveat: `script-src` and `style-src` still allow `'unsafe-inline'`, because the
application is a single file with inline `<script>`/`<style>` blocks. Splitting it into
modules and moving to per-response nonces is on the roadmap.

## 11. Configuration, running and deploying

| Variable | Required | Description |
|---|---|---|
| `CLICKUP_API_TOKEN` | yes | ClickUp personal API token (`pk_…`). Server-side only. |
| `CLICKUP_LIST_ID` | yes | List ID to read — the digits at the end of `/li/<ID>`. |
| `UPSTASH_REDIS_REST_URL` | no | Settings store. `KV_REST_API_URL` is accepted too. |
| `UPSTASH_REDIS_REST_TOKEN` | no | Token for the store above (or `KV_REST_API_TOKEN`). |

```bash
cp .env.example .env      # fill in token + list id
npx vercel dev            # http://localhost:3000 — serves index.html and /api
```

Deploy: import the repository on Vercel (framework preset **Other**), add the environment
variables, deploy. `index.html` is served statically; `api/*.js` become Node functions
(`engines.node >= 18`, global `fetch`). There is no install and no build — `package.json`
has no dependencies.

### Repository layout

```
.
├── api/
│   ├── clickup.js      # GET-only proxy, allow-listed to one list
│   └── settings.js     # namespaced settings store (Upstash Redis REST)
├── index.html          # bridge + application + styles, single file
├── vercel.json         # HTTP security headers
├── package.json        # no dependencies; dev/deploy scripts only
├── .env.example
├── LICENSE             # MIT
└── README.md
```

## 12. Known limitations

- **`/api/cron-reports` is not implemented here.** The Weekly Reports UI describes the
  scheduled trigger and evaluates the schedule window, but this public replica has no cron
  endpoint and no Slack transport. Adding them means one more function plus a delivery-state
  record in the settings store to make the send idempotent.
- **No authentication.** The private original has login and a user database; this
  deployment is intentionally open and read-only.
- **Single file.** ~300 KB of HTML/CSS/JS in one document. It is deliberate (zero build,
  trivial deploy) but it is what keeps `'unsafe-inline'` in the CSP.
- **6,000-task ceiling** from the `maxPages = 60` safety cap.
- **Rate limits.** ClickUp's REST API allows 100 requests/minute per token on Free,
  Unlimited and Business. A full load of ~1,555 tasks is 16 task pages plus the field and
  status calls — 18 requests; the 30-second edge cache keeps concurrent visitors from
  multiplying that.

## 13. Roadmap

- Split the front-end into ES modules (`app.js`, `styles.css`, `bridge.js`) and drop
  `'unsafe-inline'` from the CSP with per-response nonces.
- Implement `/api/cron-reports` and a real Slack transport behind an environment flag.
- Delivery-state persistence for idempotent scheduled sends.
- Optional e-mail login for private deployments.
- A static-snapshot mode for a token-free, always-on demo.

## License

[MIT](./LICENSE) © 2026 Lucas B
