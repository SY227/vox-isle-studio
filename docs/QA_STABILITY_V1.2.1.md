# VOX ISLE v1.2.1 — stability and latency evidence

Date: 2026-09-25 UTC. Baseline: delivered v1.2.0. This is an offline-tested release candidate with a deployment adapter; **live Google/YouTube and a real Vercel deployment are not certified**.

## Findings and changes

The old provider code used a 75-second response-header timeout, did not include the complete response-body read in that retry boundary, and allowed multiple compatibility routes each with its own retry loop. Those are concrete implementation weaknesses consistent with long waits and a generic network error. They do **not prove the precise cause of the user's four-minute failure** without that invocation's live trace.

The new transport applies one bounded budget across all attempts/fallbacks. The response body is timed and retryable when truncated or disconnected. Retry-After and shared process cooldown apply to temporary quota responses. Credential, permission, policy and persistent-quota errors stop; errors do not automatically blame the user's Wi-Fi. A request ID and whitelisted diagnostics distinguish these failures without logging credentials or lyrics.

The initial scan now returns full line text and line boundaries without word details. This is still recording-first AI, not a lyric database or a separate forced aligner. Background teaching also returns word timing and romanization. Returned words must match occurrence-specific IDs and fit the phrase boundaries; invalid observations remain unknown.

The existing application preserves usable results through optional failures and now stops scheduling further optional work after repeated exhausted connection failures. The browser's stream watchdog also preserves a ready result on a dead connection. A completed packet no longer waits indefinitely for EOF/cancel cleanup. A status-check/loading race discovered in browser testing was fixed so a new submission takes ownership immediately.

Vercel packaging now contains a real Node API adapter and copies the shared browser imports into the output. It includes a 300-second function setting, a 260-second application deadline, safe request-body handling and exact deployment host checking. Those packaging/handler behaviors are tested locally; they are not evidence that the uploaded cloud project has been deployed successfully.

## Execution results

| Suite | Result |
|---|---:|
| Node unit, provider fault, HTTP, adaptive, client-stream and deployment tests | 310 passed; 0 failed; 0 skipped |
| JavaScript syntax | 66 modules passed |
| Browser smoke and layout | 33 passed |
| Browser regression | 58 passed |
| Recording-first listening UI | 30 passed |
| Native local-media and long-score UI | 50 passed |
| Adaptive progressive UI | 74 passed |
| New line-first / deployment-shaped UI | 28 passed |
| Total isolated browser checks | 273 passed |
| Fresh ZIP extraction, settings preservation, local HTTP and static build | 26 passed |
| Live provider checks: all three supplied IDs | Blocked, not passed |
| Existing public deployment GET check | Blocked, not passed |

Evidence is copied under `qa/v121/`. `fresh-package-check.json` records 26 executed checks after assembly, including a second 310-test Node run, settings preservation, imports, HTTP routes and static output.

## Fault matrix exercised

- Headers never arrive; full response body stalls; TCP body closes after partial JSON.
- Transient 408/429/500/502/503/504; Retry-After seconds/date/retry info; daily quota; credentials; denied permissions; leaked/invalid-key-style errors.
- Four-attempt total budget across retries and schema compatibility fallbacks. Aggregate deadlines, timeout during wait, cancelled backoff, shared cooldown, successful transport reuse.
- Complete result with no network EOF; dead browser stream before/after ready; never-resolving stream cancellation; split UTF-8 Chinese; malformed NDJSON; heartbeat liveness.
- A failed eighth teaching batch preserves earlier, later and complete lyric content (inherited adaptive regression).
- First-scan cache reuse, no failed scan caching, no fake evenly spaced word timing, valid word details progressing without resetting playback.
- Pre-parsed platform JSON body, lazy JSON parse failures, upload cap, untrusted hostname rejection, API rewrite-handler invocation, all browser import files present and no server/env files in static output.
- First result opens while refinement remains active. Native iframe media control starts the clock; line highlighting works before word details; exact word highlight appears after a validated detail update; the iframe does not move or restart. The embedded content is actual local WAV audio behind a clearly labeled test adapter, **not YouTube**.
- Missing `/shared/music.mjs` produces a visible reload recovery message, not a blank gradient. Embedded CSS, all 8 demo phrases, one top transport, hidden provider controls, responsive widths up to the inherited 320px checks remain covered.

## What the timing evidence establishes

The compact demo response is less than 40% of the earlier word-heavy fixture's serialized byte size. The output-token ceiling is reduced from 49,152 to 12,288 for the first scan. These facts show reduced requested work, **not an observed real-song speedup**. No 20-second, one-minute, percentage speedup, or word-timing-accuracy SLA was measured. The initial pass is bounded at 150 seconds with per-attempt bounds; a budget expiring does not mean successful analysis.

## Real-link attempts

Executed `npm run diagnose` for:

- `J2uD1UXLTVs` (latest reported failure)
- `YaJ_lYFgr6c`
- `4ULVNHHqbew`

Each report records `keyConfigured:false`, `EAI_AGAIN` for YouTube/Google DNS and `result:blocked`. Zero live recordings were analyzed. The public Vercel GET checker also records DNS failures; no deployment or paid provider call was made. Screenshots use original test lyrics and visibly labeled local-audio controls, not commercial song lyrics or real external playback.

## Remaining acceptance and operational risks

1. Real account/model access, real YouTube readability, first-result latency and hearing-verified lyric timing require a connected live run. The reference ID now makes an actual failure actionable.
2. Model output can be incomplete or inaccurate; line-level sync may initially be all that is available. It is never promoted to word sync by interpolation.
3. The ten-minute first-scan cache, limiter, queue and optional access-code sessions are per-process. This is not persistent background execution, distributed auth/rate limiting or a horizontally scaled production security audit. Apply appropriate deployment protection and account spend limits before broad public access.
4. Vercel has finite invocation and payload limits. In this release a deadline returns partial work; no durable worker resumes after process termination. A stopped job can be retried, and a surviving warm first-scan cache can save the largest call, but a cold restart cannot.
5. Real Safari/iOS microphone devices, real WebGL hardware rendering, hearing health coaching and music-production correctness were not certified. Browser screenshots may use the packaged SVG companion fallback.

## Reproduce

```bash
npm run check
npm test
npm run build
python tests/ui_smoke.py
python tests/ui_regression.py
python tests/ui_listening.py
python tests/ui_native_media.py
python tests/ui_adaptive.py
python tests/ui_stability.py
npm run diagnose -- "https://www.youtube.com/watch?v=J2uD1UXLTVs"
```

The last command uses real locally configured credentials and may incur API charges. Diagnostic reports contain no key or full transcript. Do not ship or paste `.env`.
