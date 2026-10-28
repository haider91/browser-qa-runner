# browser-qa-runner

Generic real-browser page QA (Playwright/Chromium) run by GitHub Actions `workflow_dispatch`; results are
POSTed to the caller's `callback_url`. Repo: https://github.com/haider91/browser-qa-runner (**public**).

Caller: the n8n project `../voila-auditing-automation` (Stage 4 "Real-browser QA"), replacing Apify
`apify/playwright-scraper`. Other site workflows may call it too, so nothing site-specific goes here:
everything comes from the job JSON.

The user writes in Levantine Arabic; reply in Arabic.

## Layout

- `run.mjs` — reads the job (`--job file` or `QA_JOB`), runs a worker pool, writes `results.json`.
- `src/qa-hooks.js` — listeners attached before navigation (port of `src/apify/pre-navigation-hooks.js`).
- `src/check-page.js` — DOM/perf checks after navigation (port of `src/apify/page-function.js`).
- `src/robots.js` — minimal robots.txt check (Apify had `respectRobotsTxtFile: true`).
- `callback.mjs` — posts results (or `{status:"failed"}`) to `CALLBACK_URL`, header `x-qa-secret`.
- `.github/workflows/browser-qa.yml` — the dispatchable workflow.

## Rules

- Item shape must stay compatible with the Apify dataset (`#error`, `#debug.errorMessages`): the n8n node
  `analyze-browser-results.js` reads it. Change both sides together.
- Public repo, public logs: never print the callback URL, page content or secrets; never upload artifacts.
  Inputs reach scripts only through `env:`, never `${{ inputs.* }}` inside `run:`.
- Keep `concurrency` ≤ 5 for voila.digital (Cloudflare + Laravel origin overloaded at 10).

## Local run

Default `node` here is v10; use Node 24: `"/c/Users/ASUS/AppData/Local/Author Software/nvm/installs/v24.15/node.exe"`.

```bash
npm ci && npx playwright install chromium
node run.mjs --job examples/job.json --out results.json
```
