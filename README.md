# Dashboard ClickUp — Web App

A live project dashboard for a ClickUp list: status distribution by Area, a Blocked
control board, Tasks Filters, Weekly Reports, Swimlanes (Area × status), a real
task-hierarchy tree, Status Breakdown, and a Timeline. Fully **independent** project
(its own repo + its own Vercel deployment).

## How it works
- **Front-end:** a single static `index.html` (charts via Chart.js).
- **Data:** the browser calls `/api/clickup?op=...`, a small **Vercel serverless
  function** (`api/clickup.js`) that talks to the **ClickUp REST API** with a token kept
  **server-side** (never shipped to the browser).
- The REST list endpoint returns custom fields + parent in bulk, so the whole dashboard
  loads in ~18 API calls — no per-task fan-out.

## Prerequisites
- A **GitHub** account and a **Vercel** account (free) — you can reuse the ones you already have.
- **Node.js 18+** and **Git** installed (only needed for the CLI steps / local run).
- A **ClickUp API token**: ClickUp → your avatar (bottom-left) → **Settings** → **Apps**
  → **API Token** → **Generate/Copy** (it starts with `pk_`).
- The **List ID** to read: open the list in ClickUp; the URL ends in `/li/<NUMBERS>` —
  that number. (This project defaults to `901417662317`.)

## Environment variables (set these in Vercel)
| Name | Value |
|------|-------|
| `CLICKUP_API_TOKEN` | your `pk_...` token |
| `CLICKUP_LIST_ID`   | the list id (e.g. `901417662317`) |

## Deploy (independent from any other project)

### Option A — Vercel dashboard (no CLI)
1. Create a **new GitHub repository** (e.g. `dashboard-clickup`), private or public.
2. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Dashboard ClickUp web app"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
3. On **vercel.com → Add New… → Project → Import** your repo. Framework preset: **Other**
   (no build step needed).
4. In the project's **Settings → Environment Variables**, add `CLICKUP_API_TOKEN` and
   `CLICKUP_LIST_ID` (values above). Redeploy.
5. Open the generated URL — the dashboard loads live from your ClickUp list.

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --yes                     # first deploy (creates a NEW project)
vercel env add CLICKUP_API_TOKEN # paste your pk_ token
vercel env add CLICKUP_LIST_ID   # e.g. 901417662317
vercel --prod                    # publish
```

## Run locally
```bash
cp .env.example .env      # fill in your token + list id
npx vercel dev            # serves index.html + /api on http://localhost:3000
```

## Notes
- Public, no login — anyone with the link can view (read-only).
- To point it at a different list, just change `CLICKUP_LIST_ID` and redeploy.
- The token is only ever used inside the serverless function; it is never exposed to the browser.
