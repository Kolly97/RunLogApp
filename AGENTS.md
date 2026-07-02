AGENTS.md — RunLogApp Coding Agent Instructions

You are the coding agent for RunLogApp, a local training-planning and analytics app for endurance running.

The user is Kolja Hildenbrand. He wants precise, careful, token-efficient programming1 support with strong engineering judgment. Prioritize correctness, data safety, maintainability, and small controlled changes over broad rewrites.

⸻

1. Project identity

RunLogApp is a local desktop-oriented training analytics application.

Current stack:

* Backend: Express + Node + TypeScript + node:sqlite
* Frontend: Vite + React + TypeScript
* Charts: Recharts
* Database: SQLite
* Local-first: no cloud backend
* Main purpose: training planning, tracking, TSS/PMC analysis, Strava import, weekly reports, long-term analytics

Current app version context: v0.14.0.

Important product values:

* clean, clinical, data-analytical design
* serious sport-science/training-analysis feel
* no playful “fitness toy” UI
* preserve existing app behavior unless explicitly changing it
* avoid unnecessary visual redesign unless requested

⸻

2. Working style

Use a token-efficient coding workflow.

Always follow these rules:

* Inspect only the files necessary for the current task.
* Do not read the whole repository unless absolutely necessary.
* Do not print full files unless explicitly requested.
* Prefer direct file edits and minimal patches.
* Make the smallest safe change.
* Do not refactor unrelated code.
* Do not rewrite working code for style reasons.
* Do not change Kolja’s chart spacing, visual tuning, or CSS cosmetics unless the task is explicitly about that.
* If a task is ambiguous, ask one targeted question instead of guessing.
* If a problem becomes messy, stop and explain the risk instead of forcing a fragile fix.
* Do not spawn multiple parallel agents or expensive background work unless explicitly requested.
* Work sequentially and inline.

After each implementation, answer with only:

1. changed files
2. verification result
3. risks/open questions

Keep the summary short.

Maximum normal response length after coding: 6 bullets.

⸻

3. Planning mode

Before starting a new larger workstream, use a short planning step.

A larger workstream includes:

* Electron desktop migration
* Strava sync architecture changes
* database schema changes
* TSS/PMC model changes
* new major page or chart
* data import/export changes
* anything touching many files

Plan format:

Plan:
1. ...
2. ...
3. ...
Files likely touched:
- ...
Risks:
- ...
Verification:
- ...

Wait for approval before implementation if the change is large or risky.

For small, clearly specified tasks, implement directly.

⸻

4. Repository basics

Project path on Kolja’s Mac:

/Applications/RunLogApp/

Important:

* The path has no spaces.
* The project folder is called RunLogApp.

Common commands:

npm install
npm run dev
npm run build
npm start
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p client/tsconfig.json

Development:

* Vite client usually runs on localhost:5173
* Express server usually runs on localhost:3000
* A watcher may already be running
* Do not kill Kolja’s running processes unless explicitly asked

⸻

5. Verification routine

For normal code changes, run:

npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p client/tsconfig.json

At the end of a larger workstream, also run:

npm run build

Do not rely on broad server smoke tests. They have historically been unreliable.

For DB checks, create a temporary runner script inside the project folder, for example:

_x.ts

Run it with:

npx tsx _x.ts

Then delete it:

rm _x.ts

Do not put runner scripts in /tmp.

Important tsx gotcha:

* import.meta.url === file://argv[1] main-block checks are unreliable because of the iCloud path.
* Use a runner script inside the project folder instead.

⸻

6. Database safety rules

The SQLite database contains valuable training history and Strava imports.

Treat existing data as sacred.

Rules:

* Never delete or rewrite existing user data unless explicitly requested.
* Before mass updates, create or request a backup.
* Migrations must be additive.
* Prefer ALTER TABLE ADD COLUMN guarded by schema checks.
* If a schema change is more complex, create a new table and copy data once.
* Do not destructively modify activities, planned_sessions, daily_log_v2, season_weeks_v2, races, or zone_sets.

Current data location:

data/training.db

The database is gitignored.

Environment override:

RUNLOG_DB

Legacy root training.db may be migrated into data/ on first start.

⸻

7. Architecture map

Backend files:

* server/db.ts
    * schema, migrations, profiles, settings, default zones
* server/load.ts
    * TSS, PMC, NGP, NP, pace/HF zone splits, best efforts, critical-speed helpers
* server/analysis.ts
    * weekly analysis, planned TSS, intensity distribution, session completion, plan adherence
* server/zones.ts
    * effective zone sets by date/profile
* server/strava.ts
    * Strava OAuth, sync, details/streams enrichment, rate-limit handling, Strava zones import
* server/index.ts
    * Express API routes, static hosting, race sync, TSS recompute, plan-adherence endpoint

Frontend files:

* client/src/lib/api.ts
    * central API client and shared types
* client/src/lib/util.ts
    * formatters and utility helpers
* client/src/lib/options.ts
    * option cache, labels, colors, intensity types
* client/src/pages/
    * main app pages
* client/src/charts/
    * Recharts-based charts
* client/src/components/
    * shared components
* client/src/styles.css
    * global styling

Important pages:

* Dashboard
* Wochenplanung
* Tracking
* Wochenbericht
* Langzeit
* Races
* Bestzeiten
* Saisonplan
* Profil
* Einstellungen
* Auswahllisten

⸻

8. Training model rules

Preserve the current sport-science logic unless the task explicitly changes it.

TSS model:

* Running:
    * rTSS from NGP/pace vs threshold pace
    * planned rTSS from zone allocation
* Cycling:
    * Power-TSS from NP/FTP if available
    * fallback estimate if no power
* Other/general:
    * estimated from HR/zones when possible
* Manual TSS overrides must remain respected

PMC:

* CTL = 42-day EWMA
* ATL = 7-day EWMA
* TSB = yesterday’s CTL minus yesterday’s ATL
* Planned sessions project future PMC

Plan adherence:

* sessionCompletion() is the single source of truth
* combines TSS match and pace-zone overlap when available
* falls back to TSS-only when pace-zone data is missing

Do not reintroduce COROS Training Load as TSS.

⸻

9. Strava rules

Strava sync must never overwrite manually edited data unless explicitly requested.

Current behavior to preserve:

* import by strava_id
* do not overwrite existing activities
* details and streams are enriched budget-aware
* rate-limit headers distinguish:
    * 15-minute limit
    * daily read limit
* stop before daily limit instead of blindly firing requests
* Strava best efforts fill PB/Critical-Speed model over time
* streams provide NGP/NP, zone splits, pace-zone minutes and race splits

Strava rate limits matter:

* 100 reads per 15 minutes
* approximately 1000 reads per day
* daily reset at 00:00 UTC

When touching server/strava.ts, be conservative.

⸻

10. UI/design rules

Default UI direction:

* clean
* analytical
* clinical
* premium
* data-first
* not playful
* not overanimated
* not “PowerPoint 2008”
* no large redesign unless explicitly requested

Kolja may manually tune CSS, chart spacing, font sizes, margins and visual layout.

Do not undo his visual tweaks unless the current task requires it.

For charts:

* keep labels readable
* avoid overlapping text
* respect existing phase bands, race markers and year markers
* do not add clutter
* keep data interpretation clear

For future v2.0 redesign:

* do not start unless explicitly requested
* may involve GSAP/Three.js later
* should be a separate folder and branch
* should feel polished and award-worthy but still professional

⸻

11. Current major open workstreams

Immediate/near-term:

1. Electron desktop app
    * launch app from desktop icon
    * must work on macOS and Windows
    * preserve existing local-first model
    * likely safest architecture: Electron shell + existing Express backend + React renderer
    * SQLite should move to a stable user-data path for packaged app

Future, not now unless requested:

* Readiness state
* Dashboard training suggestion
* VO2max estimate
* Pace/HR distribution histogram
* Race prediction diagram
* PDF watermark
* Intensity trend
* training-plan drag/copy/template features
* interval label refinements
* better tracking assignment of planned vs real sessions
* weekly TSS recommendation
* separate cycling HR zones
* better split-sync logic
* v2.0 visual redesign

Do not implement future items unless Kolja explicitly asks.

⸻

13. Git and commits

Do not commit unless Kolja explicitly asks.

Before suggesting a commit, verify:

npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p client/tsconfig.json
npm run build

Then summarize:

* changed files
* test results
* remaining risks

⸻

14. Response format after coding

Use this format:

Done.
Changed:
- ...
Checks:
- ...
Risks:
- ...

Do not include long explanations unless asked.

Do not paste large code blocks unless asked.

Do not include full file contents unless asked.

⸻

15. Default model strategy

For most implementation tasks, Sonnet is sufficient.

Use Sonnet for:

* small/medium code changes
* endpoints
* UI changes
* chart changes
* TypeScript fixes
* CSS/layout refinements
* Strava fixes with clear scope
* Electron implementation steps after architecture is decided

Use Opus only for:

* architecture planning
* difficult cross-file debugging
* final review of high-risk changes
* data model redesign
* major migration strategy
* subtle correctness review

Default workflow:

Opus: plan/review if needed
Sonnet: implement

⸻

16. High-priority instruction

Always optimize for:

1. correctness
2. data safety
3. small patches
4. clear verification
5. low token output
6. preserving current product behavior

When uncertain, ask Kolja one precise question.