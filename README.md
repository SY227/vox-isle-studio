# 聲嶼 VOX ISLE v1.2.1

Traditional Chinese music practice studio. One top transport, full lyrics, a side-by-side original YouTube player, an animated companion, and progressive teaching. The backend remains Gemini 3.8 Flash (`gemini-3.8-flash`). No provider keys or developer setup controls are exposed in the app.

## This release

This is a stability/latency and deployment update based on v1.2.0, not a visual redesign.

- The first AI response requests the complete lyrics with **line boundaries only**. Individual word boundaries, romanization, pitch and singing suggestions are added later. No evenly spaced word timings are manufactured. Shortening the response is a latency optimization, **not a measured live speed guarantee**.
- Provider retries cover response headers, the entire response body, and decoding. There are at most **four HTTP attempts per logical operation**, including compatibility fallback attempts, and a finite total time budget. Temporary failures are silent; credentials, permissions and permanent quota failures stop rather than being retried blindly.
- Retry-After/backoff is honored. A per-process cooldown limits repeat requests while rate-limited. No public/global rate-limit or durable queue is claimed.
- A usable first scan is preserved when optional work fails. Three consecutive exhausted connection-task failures stop further optional scheduling. Isolated failures do not erase later successful work.
- The browser watches for dead streaming connections, retains ready lyrics when possible, and never automatically repeats an entire POST job. Each request has a safe reference ID for diagnosis.
- A complete first scan may be reused for ten minutes in the **same warm process** (up to eight recordings). This is not a persistent, cross-user or cross-instance cache. It does not cache keys or audio files.
- Vercel now has an actual API function, build configuration and copied `/shared/` modules. A separate startup guard prevents another silent blank background when an app import is missing.

## Local use

Use Node.js 22 for the tested environment. There are no third-party runtime npm dependencies.

```bash
cd "$HOME/Downloads/vox-isle-studio"
npm run setup
npm run check:api
npm run dev
```

Setup is only needed when `.env` is absent or the key changes. Key entry is hidden. Never commit `.env` or paste keys into a support conversation. Open `http://localhost:3000`.

An update ZIP never contains `.env`, `.git` or `.vercel`; overwriting files in the same folder preserves those local settings. Stop the old server before updating. A separate new folder will not inherit the old key.

## Vercel

`vercel.json` builds a `dist/` containing the static UI and browser-safe shared modules. `/api/*` is rewritten to `api/index.mjs`, which invokes the same server handler without opening a listening port. Set `GEMINI_API_KEY` in the Vercel project's Production environment, not in source control. Production/preview hostnames are read from Vercel's system variables; a custom domain can additionally use `APP_ORIGIN=https://your-domain`.

```bash
npm run build
vercel --prod
npm run verify:deployment -- https://vox-isle-studio.vercel.app
```

Keep the existing `.vercel` directory to deploy to the same project. Do not create another repo or project for this update. `verify:deployment` is GET-only and does not incur a song-analysis call.

The function is configured for **300 seconds** (Fluid Compute). The application ends at **260 seconds** on Vercel to leave room for a clean partial response. The initial listening pass has its own 150-second budget and 70-second attempt timeout. Optional operations have a 90-second budget and 45-second attempt timeout, bounded by the overall job deadline. Local jobs default to 420 seconds. These are **limits, not target load times**. Returning sooner with an error is not equivalent to completing a song faster.

The Node handler uses streaming NDJSON and fifteen-second heartbeats. Intermediate network failure or platform termination can still interrupt it. No job continues durably after the request ends. Public deployment should use Vercel deployment protection/firewall and spend limits appropriate to the account. Local access-code sessions and rate limits are in-memory; they are not distributed authentication or abuse protection across Vercel instances. Do not treat this release as an unaudited public paid-API security boundary.

Vercel requests are capped in the application at 4,000,000 bytes, below the platform payload limit. The browser checks converted audio size before sending; long local audio should be tested locally or on an appropriately sized persistent server. YouTube URL requests are small and do not upload the recording through this function.

## Diagnose the reported recording

```bash
npm run diagnose -- "https://www.youtube.com/watch?v=J2uD1UXLTVs"
```

This command uses your local key and can generate **billable AI requests**. It performs DNS checks, a model-access check, then the real analysis pipeline. It writes `test-results/provider/J2uD1UXLTVs.json` with attempt times, safe failure categories and first-result timing, but no API key, prompts, provider response text or complete lyrics. It does not measure actual singing synchronization accuracy or browser playback. `completed` means the analysis pipeline completed, not that every lyric boundary is correct.

For the separate real-browser test on a machine with Chrome and a working API key:

```bash
npm run verify:links
```

The supplied recordings are `J2uD1UXLTVs`, `YaJ_lYFgr6c`, and `4ULVNHHqbew`. Reports remain explicitly blocked when external access is unavailable. Set `VOX_DIAGNOSTICS=1` in the backend environment to include whitelisted provider attempt diagnostics in server logs. Normal error events already include a reference ID. Do not enable raw request logging.

## QA

```bash
npm run check
npm test
npm run build
python tests/ui_stability.py
```

Browser QA requires Python Playwright and Chromium; normal app use does not. `docs/QA_STABILITY_V1.2.1.md` records the executed suites, faults, deployment-shaped checks and limitations. The inherited test doubles are explicitly labeled. Actual local WAV playback is tested; live YouTube/Gemini could not run in the delivery environment because DNS failed and no usable local API key was configured.

## Accuracy and limits

Lyrics, line boundaries, word boundaries, pitch and voice-register suggestions remain AI estimates. A line-only scan initially highlights the whole line; word highlighting starts only for returned, valid word boundaries. Two AI passes agreeing is not an independent accuracy measurement. Full lyrics are requested and retained, but completeness is not guaranteed by a model's `complete` flag.

YouTube remains the playback source through the official embedded player; there is no downloader or DRM/login bypass. Private, restricted or non-embeddable sources are not guaranteed. The supported input bounds remain fifteen minutes for a public single-song YouTube recording and the existing local-audio bounds, with tighter cloud payload limits. No song covers or hidden secondary tabs were reintroduced.

## Developer knobs

`VOX_ATTEMPT_TIMEOUT_MS`, `VOX_PASS_BUDGET_MS`, and `VOX_JOB_TIMEOUT_MS` can override local timing budgets. Excessive values increase waiting and possible usage. Vercel's application job budget stays capped at 260 seconds. `GEMINI_MODEL` is server-only; its default is unchanged. Backend runtime settings are not shown to end users.
