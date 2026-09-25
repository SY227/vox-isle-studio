# Singing Fox v1.3.0 — Release QA and limitations

**Candidate:** full application v1.3.0, based on supplied v1.2.3.  
**Executed:** 2026-09-25 UTC.  
**Delivery status:** automated/component/browser/build checks passed. **Live musical accuracy is unmeasured; live Google/YouTube validation is blocked.** The app has not been pushed to GitHub or deployed by this delivery.

## Scope and implemented changes

Dedicated multi-window key estimates replace the first-teaching-batch key selection. Original-performance auditory observations and practice suggestions have separate prompts, schemas, aggregation, statuses, UI views, filters, and export fields. Phrase/source regions replace per-character original-register guesses. Targeted blind re-listens are limited and occur only after primary coverage.

The first compact lyrics/line-timing response still opens the studio before these optional tasks. The existing visual system, first-only navigation, top transport, full recognised lyrics, YouTube sidecar, hidden companion panel, and hidden developer setup remain. Normalized original observations are estimates, never physiological or acoustically verified assertions.

## Executed totals

| Group | Result | Evidence |
|---|---|---|
| Node unit/integration/provider/player/HTTP checks | **380 passed; 0 failed; 0 skipped** | `qa/v130/node-tests.txt` |
| New intelligence-related Node checks | **65** (included in 380) | `tests/vocal-intelligence.test.mjs` |
| Inherited browser checks | **272 passed** | Six `qa/v130/browser-*.json` reports |
| New original/key/playback/browser checks | **38 passed** | `qa/v130/browser-intelligence.json` |
| Browser total | **310 passed** | Inherited 272 + new 38 |
| JavaScript syntax | **74 modules passed** | `qa/v130/syntax.txt` |
| Vercel static/shared-module build | **Passed** | `qa/v130/build.txt` |
| Clean ZIP startup and preservation | **30 passed** | `qa/v130/fresh-package.json` |
| Actual Google/YouTube recording `62VyD_SVS40` | **Blocked at preflight; zero provider calls** | `qa/v130/live-preflight.json` |

No inherited count is added twice. Two inherited tests use an explicit legacy-mode switch so their old exact request-count assertions continue to test their original transport case. New tests also exercise the **actual production `generate()` default with intelligence enabled**, verifying first scan, key/voice request shapes, playback-ready order, returned fields and model identity.

## New key-analysis gates

Tests cover five disjoint windows, enharmonic equivalence, three-window support, no stable declaration from a single phrase, relative-major/minor ambiguity, incomplete evidence, five-window conflicts, duplicate IDs, failed windows, unsupported modes, invalid duration, and sample sanitization on import. A C/C/C/D/D synthetic sequence produces **possible modulation** with a time bracket. C/C/C/C/D remains uncertain rather than inventing a modulation. A teaching result containing a contradictory key cannot overwrite the dedicated estimate.

These tests validate decision rules. They do not prove the synthetic key labels were inferred from audio by Gemini: the model responses are controlled fixtures.

## Original observation versus advice

Tests verify that audible original chest-like evidence can coexist with a mix practice suggestion; neither overwrites the other. A missing original reply stays missing even when every practice label is valid. Low self-confidence or absent evidence cannot display a definite class. Fake original observations cannot be created from a legacy score or from its pitch values.

Phrase IDs/text, duplicate IDs, clip/source coordinates, out-of-window segments, source-time changes, unsupported rapid alternation, preserved evidence-backed short transitions, bounded voice batch spans, targeted re-listens, genuine conflicts and partial response gaps are exercised. Missing information is not silently interpolated. Original and practice data survive export/re-import independently.

## Concurrency, deadlines and partial results

The new all-lanes orchestration tests demonstrate that READY is emitted before key/voice/practice work, no more than three provider tasks execute concurrently, initial coverage is spread through the song, and verification is capped at three small regions. Optional failures preserve the lyric score and successful advice. Repeated exhausted provider failures stop further optional scheduling.

A real localhost HTTP integration test sends eight staggered partial request bodies; three admitted jobs are the maximum, with five rejected 429s and a retry header. Another real localhost HTTP test confirms READY is flushed before optional results through the new actual adaptive pipeline. Existing stalled-header/body, corruption, cancellation, quota, partial retention and callback-race tests remain in the 380 total.

This is per-process correctness, not a sustained public load test or distributed Vercel admission guarantee.

## Browser method and checks

Browser navigation to localhost is blocked by policy in this environment. The suites therefore load **the actual production HTML/CSS/modules through in-memory route fulfilment**. The new suite additionally runs a real Node HTTP server and consumes its real NDJSON response over localhost through an aiohttp-to-browser test bridge. The AI responder is controlled synthetic data. The video-controller adapter drives a **real HTMLAudioElement playing the bundled original WAV inside an iframe**; it is not a synthetic advancing timer and is not a YouTube stream.

The new browser checks exercise native media Play before app Play, source-clock advancement, Pause/Resume, forward seek, played/current states, original/practice switch, evidence tooltips, exact current timing counters, key-card/pitch-label updates, key evidence expansion, 40 rapid view changes, previous/next phrase, loop, playback rate, lyric offset, romanization, exports, late missing observations, and preserved iframe identity during updates. There are no uncaught page exceptions in these checks.

Widths: 1440, 1024, 768, 390 and 320 pixels. The interface has one visible main tab and one top app Play control, no developer/API controls and no restored companion side panel. CSS stays embedded in the HTML. Screenshots explicitly display **QA · REAL LOCAL AUDIO / 非 YouTube 實際串流** and use original synthetic demo text, not commercial song lyrics.

Visual QA caught stale word-time counters and a pitch-panel key label that did not refresh after enrichment. Both were corrected and added to the browser assertions before the final 38-check run.

## Live attempt

`npm run verify:music -- --execute "https://www.youtube.com/watch?v=62VyD_SVS40&list=RD62VyD_SVS40&start_radio=1"`

The key was not configured in this working environment. DNS resolution for `www.youtube.com` and `generativelanguage.googleapis.com` failed with `EAI_AGAIN`. The command saved a **blocked** report and submitted **zero song analysis calls**. No claim of live pitch, lyric, timing, key, register accuracy, or new-song latency follows from this run.

On the user's configured Mac the command runs one real provider job and records separate original/practice coverage, key support, times and error categories without the key or full lyrics. It does not automatically repeat the job or certify original vocal physiology. See README for the exact CLI.

## Remaining release gates and limits

1. **Accuracy benchmark:** independently listened references for original performance, tonal centre and key changes are not available in this run. Confidence and agreement thresholds are heuristics, not calibrated probabilities; a repeated model can agree with itself incorrectly.
2. **Same exact recording:** original/cover/live/remaster versions must not be pooled. Reanalyse old scores; legacy practice advice cannot be rebranded as original evidence.
3. **Sampling:** at most five harmonic windows cannot establish every short modulation. A modulation bracket must not be described as an exact transition second.
4. **No DSP addition:** pitch/timing continue using the existing AI estimators. There is no new source separator, signal-level key estimator, forced aligner or physiological measurement.
5. **Latency/cost:** the first response has no new blocking work, but added background key/voice requests may increase total duration/usage. No measured live speedup is claimed.
6. **Infrastructure:** finite-request streaming, in-memory caching/admission and rate limits remain. There is no durable retry job system or distributed authentication/spend-control redesign. Existing hosted-upload size limits still apply.
7. **Devices:** Chromium responsive simulation is not real iPhone/Safari, screen-reader, thermal, or audio-device certification.
8. **Undefined information:** original observation may remain missing or uncertain. The application accounts for it honestly and preserves working advice rather than manufacturing a class to reach 100%.

## Reproduction

```
npm run check
npm test
npm run build
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_smoke.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_regression.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_listening.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_native_media.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_adaptive.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_stability.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/ui_intelligence.py
```

Python Playwright/aiohttp/Chromium are development QA dependencies only. The app itself retains zero third-party runtime npm dependencies. Node 22.16.0 and Chromium on Linux were used in this run.

## Final clean-package check

The candidate ZIP was extracted into a separate empty directory, then overlaid onto deliberately created local `.env`, `.git` and `.vercel` sentinels. All three remained unchanged. The extracted application reran all 380 Node tests, 74 syntax checks and the Vercel build. Real localhost HTTP served the branded page, current version and required modules, while denying server/config and dotenv files. Static output excluded server sources/secrets. The release manifest matched all 93 runtime/test-source files. All **30 package/startup checks passed**. The dummy preservation key was not a provider credential and no provider call was made.
