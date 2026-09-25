# VOX ISLE v1.2.0 — adaptive/progressive analysis QA

Build: **1.2.0**. Execution date: **2026-09-25 UTC**.

**Implemented and tested:** first-pass studio entry; bounded selective review; progressive lightweight teaching; manual-click-only detailed lesson; preservation of usable results after later errors. The bright v1.1.2 interface and embedded-style fail-safe are retained.

**Not certified:** live Google/YouTube input, real-song latency, or lyric timing accuracy on the two requested recordings. Both real-network commands were attempted and explicitly reported **blocked**, not passed.

## Final execution totals

| Suite | Result | Evidence |
|---|---:|---|
| Node unit/server/provider/player/schema tests | **250 / 250 passed**, no skips | `qa/node-test-report.txt` |
| JavaScript syntax checks | **54 / 54 modules** | `qa/syntax-check.txt` |
| Browser: general studio/layout | **33 / 33** | `qa/ui-smoke-report.json` |
| Browser: inherited error/playback regressions | **58 / 58** | `qa/ui-regression-report.json` |
| Browser: recording/timing compatibility | **30 / 30** | `qa/listening-ui-report.json` |
| Browser: native local-media / long-score | **50 / 50** | `qa/native-media-report.json` |
| Browser: new progressive/adaptive workflow | **74 / 74** | `qa/adaptive-ui-report.json` |
| Total isolated browser assertions | **245 passed** | Five browser reports above |
| Fresh ZIP extraction / actual local server / configuration preservation | **22 / 22** | `qa/fresh-package-check.json` |
| Live link `YaJ_lYFgr6c` | **Blocked** | `qa/live-links/YaJ_lYFgr6c.json` |
| Live link `4ULVNHHqbew` | **Blocked** | `qa/live-links/4ULVNHHqbew.json` |

250 Node tests include 41 new adaptive tests. Fresh extraction also reran the complete Node and syntax suites. These are software checks, not 250 songs or 245 real YouTube playback sessions.

## First useful result no longer waits for verification

The actual orchestrator is instrumented with a controlled provider. It emits `ready` after one normalized full-song scan **before scheduling any optional request**. A high-confidence synthetic eight-line score uses one scan and one compact teaching batch, with no forced timing re-listen. This demonstrates call scheduling, not real Google latency.

An actual loopback HTTP test reads the `ready` packet while a later task is deliberately unresolved, proving the server does not buffer everything until `done`. UTF-8 split packets, async rendering order, source cancellation and a failure after this point are exercised. The first scan itself must finish; this implementation is not token-by-token streaming of incomplete JSON.

The browser opens the complete available first transcript, shows pending labels, and starts real native local audio while the analysis stream is still open. Labels arrive through later packets. The top transport and iframe remain the identical objects. The media clock continues advancing, and lyrics follow that clock across updates. App control, native media control, seek, pause, playback rate and late callbacks are covered by the combined suites.

## Selective verification and budgets

Tests cover high confidence with clean timing, medium confidence, low confidence, missing boundaries, overlapping lines, long phrases and unclear text. Structural problems can override a high self-score. Review allocation is bounded at 30% / 12 lines; deep follow-up at 10% / 3 lines. The accepted/reviewed proportions are not hardcoded performance claims.

Tests verify exact nearby ±2-second windows, stable occurrence identity for repeated text, chronological coordinates, no invented timestamps, contradictory reviews remaining unverified, and no timing mutation from lightweight technique output. The shared provider queue never exceeds three active calls; aborted waiters are removed. Existing transient transport retries remain three after the original request and are invisible to the UI.

## The reported “part 8” failure

A synthetic **80-line / ten-batch** teaching run injects an error in batch index7 (the eighth batch). The initial transcript, all80lines, earlier labels and later successful batches survive. The final state is partial, not an empty home page or a false complete success.

Browser checks separately inject an optional-stage error, a terminal error packet after `ready`, premature EOF, and a network stream interruption. Each preserves all lines, existing annotations and playable media. A stopped operation changes unfinished labels to 待補上 instead of leaving them indefinitely marked 分析中. Cancelling before the first usable result remains a normal cancellation with no fabricated score.

This diagnoses the failure-handling weakness, not the precise historical Google error from the user's screenshot; no provider error payload from that real failure was available.

## Detailed lessons only when requested

Tests ensure opening a score and playback-driven word selection issue **zero** lesson calls. A manual word click triggers a debounced one-phrase request; clicking another word in the same phrase uses its cache. Pending lesson cancellation, input validation, source restrictions and stale-result protection are covered. Progressive updates preserve returned lessons and manual note/technique edits.

Manual correction provenance remains visible after later snapshots. If a manual timing edit reorders phrase occurrences, optional work stops rather than applying older IDs to different lines. Teaching derived from the source singer is not presented as a physiological diagnosis of the user.

## Browser / packaging details

Browser tests load the real production HTML, inline CSS and JavaScript through an in-memory route harness. External AI/YouTube adapters are clearly marked; the native-media suite uses a real HTMLAudioElement playing the original bundled WAV inside an iframe. It is **not** a captured YouTube audio track. WebGL may use the existing SVG fallback in this headless environment.

Desktop and320/390/768/1024pixel variants remain usable; adaptive tests also check1440pixel layout. All CSS network requests can fail without stripping the design, because the complete production stylesheet remains embedded in HTML. No new model/configuration UI, rights checkbox, cover image or hidden secondary tab was exposed.

Fresh ZIP checks start the actual server from an unrelated working directory, verify `X-Vox-Build: 1.2.0`, no-store behavior, all executable assets, seekable WAV byte ranges, and denial of `.env` over HTTP. The archive contains no `.env`, dependency directories or caches. Overlay extraction preserves an existing dummy `.env` byte-for-byte and its0600 mode; no real API key is involved.

Testing uncovered and corrected edited-provenance refresh and stale pending-label behavior. Two inherited fixed-delay media assertions were changed to wait for actual lyric-state transitions rather than assuming the first word had finished after a wall-clock sleep; final reruns passed. No failure was reclassified as a pass without correction/rerun.

## The two actual requested links

Commands attempted:

```text
https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2
https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1
```

Both live runs encountered DNS `EAI_AGAIN` for `www.youtube.com` and `generativelanguage.googleapis.com`. There is no configured local API key in this environment. The validator stopped before remote inference or playback. **Zero live songs were analyzed.** Offline tests confirm both URLs select their intended video IDs and discard radio/playlist parameters; that is not evidence of live playback or transcription.

`npm run verify:links` repeats the real acceptance flow on a connected machine using its local `.env`, real Chrome and real provider. It opens the studio from the first result, attempts native YouTube-first playback, checks the top transport/media time, observes final refinement state, and writes separate reports per source. It can produce billable API usage. A passed transport result still does not establish music-timing accuracy without an independently checked reference.

## Remaining acceptance gates

- Live source availability and first-result latency for both recordings.
- Actual complete lyric transcription and line/word boundaries assessed by listening, not confidence score alone.
- Real mobile Safari/Chrome hardware, screen-reader use, sustained background/foreground behavior and GPU rendering.
- Production HTTPS/origin/access-code, quotas and load testing before public hosting.

The former mandatory every-segment verification is removed. That reduces required pre-play work by construction; it is **not** a measured claim of a particular speedup, five-second startup, or more accurate synchronization.
