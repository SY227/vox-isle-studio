# Singing Fox — non-destructive stress QA add-on

This folder is QA tooling and evidence only. It does not change or deploy app code.
Tested application: Singing Fox 1.2.2. See `QA-REPORT.md` for results and known failures.

## Real hosted processing for the three requested songs

```bash
node qa/stress-20260925/live-songs.mjs --execute
```

This uses the existing production app's configured server-side key. It does not read or print a local API key. It makes one request per song, sequentially; normal application retries remain in effect. It can produce real API usage. Default videos: `eV9a5oUCbZQ`, `J2uD1UXLTVs`, `miBGaUagOz8`.

Reports: `test-results/production-songs-20260925/`. This checks HTTP processing and delivery metrics, not native YouTube playback or listened lyric alignment. `blocked`, `partial` and `failed` are not passes. A different production version stops preflight because it has not been tested by this bundle.

## Isolated adversarial checks — no provider calls

```bash
node qa/stress-20260925/run.mjs
```

Expected on unmodified v1.2.2: 54 checks, 41 passing and 13 failing. Exit code 1 signals the reproduced acceptance defects, not a broken test installation. Source code is unchanged by the tests. Outputs: `test-results/stress-20260925/`.

## Browser checks

```bash
python qa/stress-20260925/browser-stress.py
```

Requires Python Playwright and Chromium. All first-party browser modules are fulfilled from the installed app, and Google/YouTube adapters are explicitly synthetic. The player uses real original local WAV media time. 26 checks passed in the delivered run. This is not a live YouTube playback test.

## Self-test the new hosted QA CLI without Google

```bash
node qa/stress-20260925/test-live-harness.mjs
```

Eight local canned-HTTP cases passed. No Google requests or credentials are used.

All full lyrics used in simulations are original QA/demo fixtures. No production transcript, `.env`, authentication token, or user API key is included in this add-on. The report and evidence were generated during this QA run, not copied as assumed passes from a previous build.
