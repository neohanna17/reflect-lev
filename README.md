# Reflect-LEV

An internal, self-hosted clone of [reflect.run](https://reflect.run): record browser
flows with a Chrome extension, store them as test cases, and replay them
automatically with Playwright. Built to test **lev.charity**.

- **Frontend / dashboard** → React + Vite + Tailwind, hosted on **Netlify**
- **Database + auth + screenshots** → **Firebase** (Firestore, Google sign-in, Storage)
- **Recorder** → **Chrome extension** (MV3, no build step)
- **Execution** → **Playwright in GitHub Actions** (self-healing playback)
- **Glue** → a Netlify function that dispatches GitHub Actions runs

```
┌──────────────┐   record    ┌──────────────┐  save (#import)  ┌─────────────┐
│ Chrome ext   │ ──────────► │  recording   │ ───────────────► │  Dashboard  │
│ (recorder)   │             │  (steps[])   │                  │  (Netlify)  │
└──────────────┘             └──────────────┘                  └──────┬──────┘
                                                                       │ writes tests/runs
                                                                       ▼
                                                                ┌─────────────┐
                                                                │  Firestore  │
                                                                └──────┬──────┘
   ┌──────────────────────────┐   repository_dispatch                 │ reads test
   │ Netlify fn: trigger-run   │ ◄──── "Run" click ── Dashboard        │ writes results
   └─────────────┬────────────┘                                       ▼
                 │ GitHub API                                  ┌──────────────┐
                 ▼                                             │   Runner     │
        ┌──────────────────┐   executes via Playwright         │ (GH Actions) │
        │  GitHub Actions  │ ────────────────────────────────► │  playback.js │
        └──────────────────┘                                   └──────────────┘
```

## Repository layout

| Path | What it is |
|------|------------|
| `app/` | React dashboard (Vite). Deployed to Netlify. |
| `extension/` | Chrome MV3 recorder. Load unpacked. |
| `runner/` | Node + Playwright runner. Runs in GitHub Actions. |
| `netlify/functions/` | `trigger-run` — dispatches a GitHub Actions run. |
| `firebase/` | Firestore + Storage security rules and indexes. |
| `.github/workflows/run-tests.yml` | The execution workflow. |

---

## 0. Prerequisites

This machine does **not** have Node.js. Install **Node 20+** first:

```bash
# macOS (Homebrew)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@20
# or download the installer from https://nodejs.org (LTS)
node --version   # should print v20.x or newer
```

Also create accounts / install CLIs as needed: a **Firebase** project, a
**Netlify** account, a **GitHub** repo, and optionally the
`firebase-tools` and `netlify-cli` packages.

---

## 1. Firebase

1. Create a Firebase project at <https://console.firebase.google.com>.
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → create (production mode).
4. **Storage** → enable (for screenshots).
5. **Project settings → General → Your apps → Web app**: register a web app and
   copy the config values into `app/.env` (see step 2).
6. Deploy the security rules and indexes from `firebase/`:
   ```bash
   npm i -g firebase-tools
   firebase login
   cd firebase
   firebase use <your-project-id>
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
7. **Add yourself as a member.** Access is gated on a `members/{uid}` document.
   Sign in to the dashboard once (you'll see an "Access pending" screen showing
   your UID), then in the Firestore console create collection **`members`** with
   a document whose **ID = your UID** (any fields). Reload — you're in.
8. **Service account** (for the runner): Project settings → Service accounts →
   *Generate new private key*. Keep the JSON safe; it goes into a GitHub secret.

## 2. Dashboard (local dev)

```bash
cd app
cp .env.example .env      # fill in the VITE_FIREBASE_* values from step 1.5
npm install
npm run dev               # http://localhost:5173
```

Sign in with Google. If you see "Access pending", do step 1.7.

## 3. Deploy the dashboard to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from GitHub**, pick the repo.
   `netlify.toml` already sets the build command, publish dir, and functions dir.
3. **Site settings → Environment variables** — add:
   - all `VITE_FIREBASE_*` values (same as `app/.env`)
   - `VITE_TRIGGER_FUNCTION_URL` = `/.netlify/functions/trigger-run`
   - `GH_REPO` = `your-org/your-repo`
   - `GH_TOKEN` = a GitHub token with **Actions: write** (fine-grained) or
     classic `repo` scope
   - `FIREBASE_PROJECT_ID` (optional, enables ID-token sanity check on the fn)
4. Add your Netlify domain under Firebase Auth → Settings → **Authorized domains**.
5. Deploy.

## 4. GitHub Actions (the runner)

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | the full service-account JSON (one line, or base64) |
| `FIREBASE_STORAGE_BUCKET` | `<project-id>.appspot.com` |
| `FIREBASE_PROJECT_ID` | your project id |

The workflow `.github/workflows/run-tests.yml` runs when:
- the dashboard dispatches a run (via the Netlify function),
- you trigger it manually (Actions tab → *Run workflow*),
- the daily `cron` sweep drains any queued runs.

## 5. Chrome extension (recorder)

1. Chrome → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select the `extension/` folder.
2. Open the extension's **Settings** (popup → *Settings*) and set the
   **Dashboard URL** to your Netlify site (e.g. `https://reflect-lev.netlify.app`).
3. Go to `lev.charity`, click the extension → **Start recording**, interact with
   the page. Use the on-page toolbar to add **Assert text** / **Assert visible**.
4. Click **Stop**, then **Send to dashboard →**. A tab opens on the dashboard,
   imports the recording, and drops you into the test editor.

---

## End-to-end flow

1. Record a flow on lev.charity → it lands as a **test** in Firestore.
2. Click **Run** (dashboard) → a `runs` doc is created (`queued`) and the Netlify
   function fires a `repository_dispatch`.
3. GitHub Actions installs Playwright, runs `runner/run.js` with `RUN_ID`.
4. The runner replays each step, **self-healing** through the recorded selector
   list, screenshots every step to Storage, and streams results back to the
   `runs` doc.
5. The dashboard updates live: per-step pass/fail, durations, screenshots, and a
   note when a step self-healed to a fallback selector.

## Self-healing

Every recorded element carries an ordered list of selectors (test-id → id →
name → aria-label → text → unique CSS path). At replay the runner tries them in
order and records which one matched. If the site changes and the primary
selector breaks, a fallback keeps the test green and the run flags
`self-healed via: <selector>` so you can update it later.

## Data model (Firestore)

```
tests/{id}    { name, description, startUrl, steps[], tags[], status,
                createdAt, updatedAt, createdBy }
  step        { id, type, value, selectors[], target:{label} }
              type ∈ navigate | click | type | press | select | hover | wait
                      | assertText | assertVisible | assertUrl
runs/{id}     { testId, testName, status, startedAt, finishedAt, triggeredBy,
                durationMs, browser, error, steps[] }
  stepResult  { stepId, type, label, status, message, healedWith,
                screenshotUrl, durationMs }
suites/{id}   { name, testIds[], schedule(cron), createdAt, updatedAt }
members/{uid} { } // presence = access
```

## Running the runner locally (optional)

```bash
cd runner
cp .env.example .env       # add FIREBASE_SERVICE_ACCOUNT, bucket, project id
npm install
npm run start              # drains queued runs; set RUN_ID=<id> for one run
```

## Notes & limitations

- Time-based suite schedules: the daily cron drains the queue; for per-suite
  schedules, enqueue from the dashboard or add more `cron` entries to the
  workflow. Full per-suite cron evaluation is a future enhancement.
- The Netlify function does a lightweight ID-token check (audience + expiry).
  For stronger auth, replace `authorized()` with `firebase-admin`'s
  `verifyIdToken()`.
- Recordings are handed off via a URL fragment; very long recordings can also be
  exported with **Copy JSON** / **Download**.
```
