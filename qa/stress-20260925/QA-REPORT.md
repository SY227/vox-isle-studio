# Singing Fox v1.2.2 — stress QA and release-risk report

**Run:** 25 September 2026. **Build under test:** the delivered `singing-fox-v1.2.2.zip`, with relevant source files checked against `SY227/vox-isle-studio`.

**Recommendation: keep the current deployment available for controlled testing, but fix the newly reproduced defects before widening the rollout.** The existing regression suite passes; the additional adversarial tests do not. This is a QA report, not a claim that a new application build has been fixed or deployed.

## 1. What was actually tested

| Suite | Executed result | What it establishes |
|---|---:|---|
| Existing Node tests | 311 / 311 passed | Previously defined unit, provider, server, player, and deployment scenarios |
| Existing browser suites | 272 / 272 passed | Six explicit external-service-simulation suites, including real local WAV media time |
| New adversarial acceptance checks | 41 passed; **13 failed**, out of 54 | New edge cases, races, failure reporting, and load-handling conditions |
| New browser stress checks | 26 / 26 passed | 216 selection/filter gestures, 12 start/cancel cycles, native local-media recovery and layout |
| New live-test-helper self-tests | 8 / 8 passed | Strict URL selection, production preflight, failures and partial-state reporting |
| JavaScript syntax | 66 application modules passed | Syntax only, not service correctness |
| Deployment build | Passed | Static build and shared module packaging; not an online deployment |
| Original-source integrity | 127 / 127 files unchanged | QA did not modify the shipped app, `.env`, GitHub, or Vercel |

The 13 failed assertions group into **11 issues**: nine application/design/diagnostic issues and two problems in the old live QA helpers. Two assertions reproduce the same timing race at different levels; two exercise different forms of the same completion-status gap. They are not 13 independent production outages.

### Controlled load

The provider load scenario ran **200 synthetic jobs** through the real queue implementation. It made 500 simulated provider attempts, recovering from deterministic 429/502/503 failures, with a measured maximum of **three concurrent provider calls** and no remaining queue entries. The provider-matrix tests plus that scenario made **560 instrumented simulated attempts** in total.

A separate localhost HTTP run completed **120 analysis requests** with valid NDJSON results. It used eight fresh local server instances, 15 sequential requests each, to stay below the application's per-instance hourly request limit. This is resource-release and response-integrity evidence, not a 120-user production capacity benchmark.

An additional eight-request test deliberately delayed request bodies to expose the admission race described below.

## 2. The three requested recordings — live status

| Requested video | Playlist parsing | Actual hosted analysis | Actual YouTube playback | Listening-based sync/lyric accuracy |
|---|---|---|---|---|
| `eV9a5oUCbZQ` | Correct video selected | **Blocked before submission** | Not tested | Not measured |
| `J2uD1UXLTVs` | Correct video selected | **Blocked before submission** | Not tested | Not measured |
| `miBGaUagOz8` | Correct video selected | **Blocked before submission** | Not tested | Not measured |

The exact submitted radio-playlist URLs were canonicalized to their intended `v=` IDs. They were also used as source identifiers in isolated UI scenarios. **Those UI scenarios played the original local demo WAV through an explicitly labelled test player, not these YouTube songs.**

Direct DNS resolution failed for `vox-isle-studio.vercel.app`, `www.youtube.com`, and `generativelanguage.googleapis.com`, with `EAI_AGAIN` / temporary name-resolution failure. The web tool also could not fetch the requested YouTube pages. The new live command was executed with `--execute`; its production preflight failed, and its three reports correctly recorded `analysisSubmitted: false` and `result: blocked`. No real Google song-analysis requests were submitted by this session.

An attempt at direct localhost browser navigation also returned `ERR_BLOCKED_BY_ADMINISTRATOR`. Browser tests therefore use route-fulfilled first-party files and explicit external-service doubles. Node HTTP tests do use real localhost sockets. Neither limitation is being counted as an application failure.

## 3. Findings that need attention

### F01 — Late teaching data can collide with corrected timing
**Priority: P1. Reproduced at both function and full orchestration level.**

Timing review and teaching are allowed to run concurrently. A teaching batch captures a phrase's earlier time range. A review can replace that phrase before the teaching response returns. `normalizeWordDetails()` checks the captured batch bounds; `applyWordDetails()` then checks neighbouring words but does not revalidate against the current phrase's bounds.

The full-orchestrator reproduction delivered a usable first score, completed two agreeing line-only reviews that moved the first line from 1.0 to 1.4 seconds, then received a delayed teaching response with its old first-word start of 1.0 seconds. Final score normalization threw **`時間或音高超出合理範圍。`**. A lower-level test also reproduced this after changing a phrase start from 1.0 to 2.0 seconds.

The existing HTTP retention path can preserve the last valid score, so this need not erase the whole page. It can nevertheless stop refinement or leave older timing in place. This is a plausible class of cause for partial results; it does **not** identify the cause of any particular historical live failure.

**Correction:** version each phrase's timing; validate incoming boundaries against its current envelope immediately before application. Reject only stale timings, retain independent valid teaching labels, and construct/validate a candidate before mutating the active transcript.

**Acceptance:** run both callback orders and repeated interleavings; no invalid word/phrase envelope, no lost valid transcript, and no uncaught normalization failure.

Evidence: `new-stress/stress-results.json`, `WORD-CURRENT-BOUNDS` and `RACE-FULL-PIPELINE`. Source: `server/word-details.mjs`, `server/adaptive.mjs`.

### F02 — Three-job admission limit can be bypassed
**Priority: P1. Reproduced over real local HTTP.**

`inflight >= 3` is checked **before** `await body(req)`. The counter is incremented only after that await. Eight requests with overlapping incomplete bodies all passed the check, then all entered the runner: **eight HTTP 200 responses and eight active analysis jobs**.

The separate provider queue still limited its own provider work to three in the queue test. This finding is **not** a claim that eight simultaneous Google calls were observed. It means extra analysis jobs can be admitted, wait, occupy resources, and use up their deadlines.

**Correction:** atomically reserve/release an admission slot, including every validation, disconnect and cancellation path. Add bounded queuing or a retryable busy response with `Retry-After`.

**Acceptance:** repeat slow-body and ordinary simultaneous submissions; peak admitted work stays within the declared bound and rejected requests spend no provider calls.

Evidence: `ADMISSION-RACE`, measured `peakActiveJobs: 8`. Source: `server/index.mjs`.

### F03 — Processing completion can mask missing content
**Priority: P1 for readiness reporting. Two reproduced cases.**

One result returned `adaptive.state: complete` despite `completeScan: false`. Another returned `complete` with **12 of 12 annotations missing**, even after the one repair request. The API has other warnings/counters, and the UI says refinement has ended rather than certifying musical accuracy; nevertheless the completion field used by tools does not distinguish “jobs ended” from “requested content delivered.”

**Correction:** separate job completion, transcript completeness, teaching coverage and timing uncertainty. Unresolved missing entries or an incomplete transcript should not satisfy full-delivery acceptance. An explicitly reviewed `unknown` is different from an omitted entry and must not be forced into a voice classification.

Evidence: `INC-SCAN`, `INC-LABELS`. Source: `server/adaptive.mjs`, `shared/annotations.mjs`.

### F04 — `partial` loses the reason that matters
**Priority: P1 for diagnosis; does not by itself break playback.**

Three synthetic teaching requests returned unavailable analysis. The application correctly preserved its score and returned `partial` with three failed tasks. But the per-task `TEACHING_UNAVAILABLE` codes were not included in the returned summary. The old diagnostic helper records transport events and a final state, not those safe application failure details.

Consequently, HTTP transport “success” messages can coexist with an unexplained partial result. Successful HTTP is not the same as successful normalization, usable source content, or complete teaching.

**Correction:** preserve a whitelisted failure summary: stage, batch identifier, code, attempt count, elapsed time and request ID. Keep keys, full provider bodies and lyrics out of diagnostic logs.

Evidence: `WHY-PARTIAL`; source `server/adaptive.mjs`, `scripts/diagnose.mjs`.

### F05 — Malformed generated JSON bypasses recovery
**Priority: P2. Reproduced through the real `generate()` path with a controlled provider.**

Malformed JSON at the **HTTP envelope** level is retried successfully. But a valid HTTP 200 envelope containing malformed JSON in the generated text throws `INVALID_ANALYSIS` and exits after **one attempt**. The test's next response was valid but was never requested.

**Correction:** distinguish interrupted/invalid generated JSON from source refusal or terminal account failures. Give recoverable output-format failures a small, explicit repair/retry budget within the overall deadline. Do not retry safety refusals or bad credentials as format problems.

Evidence: `INNER-JSON` versus passing `BODYJSON`.

### F06 — Identical cold requests duplicate initial scanning
**Priority: P2, latency and cost.**

Three simultaneous requests for the same recording generated **three first-scan provider calls**. A subsequent warm request reused the cache. Thus the completed-result cache works, but it does not coalesce in-progress requests.

**Correction:** an in-flight result map with independent subscriber cancellation. One cancelled user must not cancel other subscribers. Per-instance reuse is not a durable multi-instance production cache.

Evidence: `CACHE-INFLIGHT`.

### F07 — Heartbeats can keep a stalled client waiting
**Priority: P2, resilience design.**

The client has header and idle-read deadlines but no independent total first-result deadline. A controlled heartbeat-only stream remained active for more than five idle-watchdog intervals and ended only when the test cancelled it.

The backend normally has its own finite deadline. This is a missing defence for a broken/proxied stream that continues sending heartbeats without useful progress, not a claim that an indefinite wait was observed in production.

**Correction:** an overall first-result limit and a separate refinement limit; preserve available lyrics on expiry and avoid blindly duplicating a possibly active paid POST.

Evidence: `BROWSER-ENDLESS`, plus source inspection of `public/modules/api.mjs`.

### F08 — App-generated rate-limit replies lack retry timing
**Priority: P2. Reproduced over local HTTP.**

The 21st request correctly returned HTTP 429, but no `Retry-After` header was supplied. The service-level backoff handler respects Google's retry timing; the app's own limits should provide similarly actionable retry timing.

Evidence: `LIMIT-RECOVERY`.

### F09 — Hosted upload capacity and UI promise disagree
**Priority: P2, upload-path usability.**

The UI advertises up to six minutes / 50 MB. Hosted requests are capped at 4,000,000 JSON bytes. At the app's 16 kHz, mono, 16-bit PCM conversion plus Base64, this is approximately **93 seconds** after allowing for envelope overhead. A two-minute synthetic WAV produced a request exceeding the cap and was correctly rejected without calling the provider.

The limit handling is safe; the expectation is wrong. Source compression does not remove the later PCM/Base64 expansion.

**Correction:** expose the true deployment-specific limit before decoding/submitting, or implement an authorized upload-storage path suited to longer audio. Do not simply increase a local constant above platform limits.

Evidence: passing `UPLOAD-CAP`, failing `UPLOAD-PROMISE`. Vercel's function-limit documentation was checked separately.

### F10 — Old live verifier rejects the current schema version
**Priority: P1 for QA reliability.**

The shipped `verify-live.mjs` checks for `adaptive-recording-v1`, whereas v1.2.2 emits `adaptive-recording-v2`. A valid current result can therefore fail the helper's adaptive-mode assertion.

**Correction:** import the supported version constant or validate supported schema versions explicitly. Do not treat a hard-coded old version assertion as a Google failure.

Evidence: `LIVE-VERIFIER-VERSION`. This is a helper defect, not a native YouTube playback measurement.

### F11 — Old diagnostic can silently test the wrong song
**Priority: P1 for QA integrity.**

The old diagnostic accepts the first argument starting with a plain HTTP URL; otherwise it silently substitutes `J2uD1UXLTVs`. A Markdown-wrapped link to `eV9a5oUCbZQ` therefore selects a different recording. The behaviour was reproduced by directly evaluating the diagnostic's argument-selection logic; no billable request was made for this check.

The new QA-only helper normalizes a Markdown-wrapped link, rejects invalid input, rejects duplicate video IDs, and prints the actual selected ID before submission.

Evidence: `LIVE-URL-STRICT`, `live-harness-selftest/selftest.json`.

## 4. What recovered correctly

The executed tests passed for bounded retries on transient 408/425/429/500/502/503/504 responses; immediate stopping on 401/402/403 and explicit permanent daily quota; Retry-After handling; response-body resets; stalled headers and bodies; cancellation; and secret-free whitelisted transport diagnostics.

The eighth teaching-batch failure preserved the entire 80-line synthetic transcript and the final verse's successful annotations. Browser stress preserved its existing player after 216 selection/filter gestures, maintained playback after simulated late provider failures, and completed 12 start/cancel cycles without an uncaught JavaScript exception. Hidden companion lessons were not charged automatically because no lesson requests were made by those gestures.

These results support particular recovery paths. They do not erase the newly reproduced timing race, prove all possible failures are handled, or establish production load capacity.

## 5. Additional visual observation

The 390-pixel mobile render puts the native video panel **after the complete lyric document**. When native playback needs a user gesture, reaching that control can require scrolling through all verses. This is a usability observation, separate from the automated failure count. A compact, reachable mobile source-control treatment should be considered without disturbing the desktop side-by-side layout.

Both supplied stress screenshots visibly label the media as local QA audio. They are not pictures of a successful analysis of the requested YouTube recordings.

## 6. Recommended release gates

First fix and reproduce F01/F02 in both event orders and under simultaneous submission. Then fix completion/failure reporting so a partial outcome is useful to diagnose. Address malformed output recovery and request coalescing before making new speed claims. Correct the old helpers before using their verdicts.

For each of the three real recordings, separately record production time to first usable lyrics, completion/partial reasons, the final verse's coverage, native YouTube Play/Pause/Seek behaviour, and a listening-verified sample of line/word boundaries spanning the beginning, middle and final chorus. A moving highlight is not a timing-accuracy measurement. No latency or acoustic-accuracy target is being claimed as achieved in this report.

## 7. Reproduce and finish the network-dependent checks

The ZIP is a **QA add-on only**, rooted at `vox-isle-studio/qa/stress-20260925/`. It does not replace application files, rotate keys, commit, or deploy anything.

To run the three real hosted processing checks from a network-enabled Mac:

```bash
cd "$HOME/Downloads"
unzip -o singing-fox-qa-20260925.zip
cd vox-isle-studio
node qa/stress-20260925/live-songs.mjs --execute
```

This submits **one request per recording, sequentially**, to the existing deployed app. The app's own provider retries still apply. Actual API usage can occur. It does not need the key pasted into Terminal or into chat. Without `--execute`, it performs only deployment preflight. Results go to `test-results/production-songs-20260925/`; reports contain counts, timings, digests and safe status codes, not full lyrics or keys.

A result of `processing-check-passed` covers HTTP processing and basic content-delivery checks only. It does **not** certify browser playback, audible pitch, vocal-register advice, or lyric alignment against listening ground truth. Network/auth/configuration failures are labelled blocked or failed, never relabelled as passes.

The new helper passed eight local canned-HTTP self-tests: success, missing key, required access code, wrong build, HTTP 503, partial result, missing labels, and Markdown URL selection.

Local isolated checks:

```bash
node qa/stress-20260925/run.mjs
python qa/stress-20260925/browser-stress.py
node qa/stress-20260925/test-live-harness.mjs
```

The first command intentionally returns a failing exit code on the unmodified v1.2.2 because the acceptance failures are real findings. The browser command additionally requires Python Playwright and Chromium. Normal application use and the live hosted-processing helper do not require these Python dependencies.

## 8. Evidence and reference notes

The bundle contains the executed baseline logs, all new JSON results, exact live-blocked reports, source-integrity hashes and the two stress renders. The original source ZIP SHA-256 and Git blob hashes are recorded in `source-integrity.json`; all 127 shipped files remain byte-for-byte unchanged.

External primary references checked: Google Gemini API troubleshooting (retry categories and backoff), Vercel Functions limits (payloads, durations and instance scaling), and YouTube IFrame Player API (media controls/time versus lyric timing). These references guide the acceptance conditions; they do not substitute for the unavailable live-song tests.

**Bottom line:** the UI and several recovery mechanisms held up, but the deeper pass found actionable failures. No new app release or production change has been made by this QA run.
