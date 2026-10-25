# Tests, deploys and rollbacks

How a change gets from a branch to the live site, and what to do when
something goes wrong.

## How it works

1. Work happens on a branch. Every push runs the tests on GitHub
   (`.github/workflows/ci.yml`): nine jobs at once, about 12 minutes.
   They cover types, lint, translations, both builds, every PDF engine
   suite, hostile files, the browser tests in Chromium, Firefox and
   WebKit, and every tool in English, Arabic and Japanese.
2. Each branch push also gets its own Cloudflare preview address
   (`<hash>.nopload.pages.dev`), to try the change by hand.
3. When the run is green, the branch goes to main through a pull request.
   Main only accepts it once the tests have passed (the ruleset below).
4. Cloudflare deploys main to the live site. About five minutes later it's
   live.

You don't need to run anything. The result shows next to each commit and
pull request on GitHub: a green tick, or a red cross that links to what
failed. The weekly live-site check (`.github/workflows/live.yml`) tests the
real site and emails you if it breaks.

## One-time setup: main only takes tested changes

In the repository on GitHub:

1. Settings → General → Pull Requests: tick **Allow auto-merge**.
2. Settings → Rules → Rulesets → **New ruleset** → **New branch ruleset**.
   - Name: `main`. Enforcement status: **Active**.
   - Target branches: **Add target** → **Include default branch**.
   - Tick **Restrict deletions** and **Block force pushes**.
   - Tick **Require a pull request before merging**, with required
     approvals set to 0.
   - Tick **Require status checks to pass**. Then **Add checks** and add
     each of these, as they're named after a run:
     - Typecheck, lint, translations, builds
     - PDF engine tests
     - Hostile inputs
     - End-to-end (chromium)
     - End-to-end (firefox)
     - End-to-end (webkit)
     - Every tool (en)
     - Every tool (ar)
     - Every tool (ja)
   - Leave **Bypass list** empty, or add yourself to be able to override
     in an emergency.
   - **Create**.

From then on, a change reaches main (and the site) only through a pull
request whose tests all passed. A pull request with auto-merge on merges
by itself the moment they do.

## When something breaks

- **A red cross on a branch or pull request:** nothing reached the site.
  Open the run to see which test failed and why; the failing step repeats
  its last lines as a note at the top of the run page.
- **The live site is broken:** Cloudflare dashboard → Workers & Pages →
  the project → **Deployments** → the last good deployment → **⋯** →
  **Rollback to this deployment**. It takes seconds. Then fix forward on a
  branch as usual.
- **A test fails on GitHub but passes locally (or the other way round):**
  usually timing or fonts on the runner. Fix the test so it doesn't depend
  on them. Don't skip it.

## Running tests locally

Not needed for a change to ship; GitHub runs everything. To check one area
while working:

```sh
npm run test:editcontent              # one unit suite
npm run build:static && npm run serve:static &
node tests/e2e/edittools.mjs chromium  # one browser spec
node tests/e2e/tools/run.mjs --only "^edit-pdf$" --browser chromium
```

The full suite on a small machine takes over an hour, and its timing checks
(cancel, 1,500-page files) need a machine as fast as GitHub's runners.
