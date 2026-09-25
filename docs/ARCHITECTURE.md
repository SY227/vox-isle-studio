> Historical design/checklist retained from the v1.2.0 baseline. Current deployment, retry budgets and line-first pipeline are documented in `README.md` and `QA_STABILITY_V1.2.1.md`. Historical checklist items are not a new live certification.

# VOX ISLE 1.2.0 — adaptive, progressive analysis

## Production path

`POST /api/analyze` -> `generate` -> `analyzeAdaptive`. The retained legacy `analyzeByListening` remains in the repository for regression helpers, but is no longer invoked by the normal analysis route.

1. `fast-scan`: full recording attached, complete text plus first-pass timing and self-reported confidence. No initial survey call. `normalizeFastScan` retains untimed text, rejects oversized/truncated structures, prevents invented per-word interpolation, and explicitly marks all timing as provisional.
2. Emit NDJSON `ready` before starting any optional calls. Normalization is not a musical-accuracy check. Frontend `api.analyze(..., onResult)` consumes packets in order; `activate` runs once.
3. `planTimingReview` prioritizes structural problems or self-confidence below .85. It selects up to min(12, ceil(30% of lines)); all other uncertain lines remain unverified. Medium .65–.85 gets one listen; lower confidence or disagreement can get another within a budget of min(3, ceil(10% of lines)). Self-confidence is not calibrated probability.
4. `light-teaching` by stable occurrence IDs, max120 words/8lines, contains only compact technique/pitch/ornament data, not a detailed lesson for every phrase. One missing-ID repair is permitted.
5. Interleaved timing/teaching tasks, max3 workers. `ProviderQueue` enforces a shared max3 across jobs and on-demand lessons. Retries remain within the same slot.
6. Every completed task emits an `update` snapshot with monotonically increasing revision and task counts. A failed batch does not invalidate the first transcript. Auth failures stop new scheduling; already received results survive.
7. Return `done` as complete/partial. HTTP failure after ready and frontend EOF/network interruption both preserve the last usable snapshot. Cancellation preserves the current studio.

## Accuracy and coordinate ownership

The first scan returns absolute recording seconds. Review clips use the existing explicit `source_seconds`/`clip_seconds` contract. WAV snippets are actual PCM slices. The primary YouTube request uses static source offsets; official compatibility fallbacks may instead navigate the full source with absolute-time instructions. Media stays attached; no lyric-site or text-only invention route is introduced.

Reviews match exact ordered text within that occurrence's ±2-second window, with neighboring-boundary checks. A different lyric or contradictory observation is not silently swapped into the first transcript or averaged. It is left unverified. This conservatively preserves stable IDs but may retain a first-pass transcription error; perfect transcription is not claimed.

`accuracyVerified` remains false. Phrase and token metadata distinguish provisional, reviewed and unverified observations. Missing word boundaries use line-only synchronization. A source-confidence score cannot certify acoustic alignment. The first-scan pitch range is provisional, separately stored from measured/annotated notes.

## Detail on demand

Only a deliberate word click invokes `/api/lesson`, after300ms debounce. Playback-driven selection never does. It sends the exact source and selected phrase ±2sec; returns bounded Chinese instructional text. No user voice recording is sent implicitly. Same-phrase results cache only in page memory; stale or cancelled responses cannot overwrite a different song/phrase. Student-personalized diagnosis is not inferred from the original singer.

## Render and state preservation

The persistent source controller and iframe stay mounted. `applyProgressive` patches lyrics, range, quality, pitch map and textual coach. It preserves scroll/focus, current media time, phrase loop, manually edited phrases and cached lessons. The top transport remains the only app transport. Different media always uses a new analysisRun guard.

Reordering phrases through manual time editing invalidates occurrence indices; the app cancels optional refinement and retains the user edit instead of merging stale IDs. Simple note/technique edits survive snapshots. A cancelled/partial label uses 待補上, never an indefinitely spinning 分析中 state.

## Limits and security

Max15min YouTube, 6min prepared upload, 600lines/8000words. Whole job15min deadline, HTTP attempts75sec, original+3 retries on transient faults. `ready` means usable provisional content, not every requested field exists. First pass may still be slow; there is no 5sec guarantee. Three workers limit this process, not every instance of a distributed deployment.

Keys stay server-only in `.env`. Public deployment requires configured origin/access code. NDJSON cache disabled. `index.html` embeds the complete stylesheet; no externalCSS request is necessary. No schema/API/backend setup controls are added to user-facing navigation.

## Test evidence

`docs/QA_REPORT.md`, `qa/` and `docs/previews/` distinguish real local-media playback, explicit provider/player substitutes, and two real-network runs blocked by DNS/missing local credentials. Synthetic first-result timings do not establish real Google latency or singing synchronization accuracy.
