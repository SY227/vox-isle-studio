# v1.3.0 — Key, original performance, and practice advice

## Data flow

```
Exact recording → fast-scan → lyrics + line time → READY (studio opens)
                                ↓
      bounded shared provider queue (at most 3 active calls)
      ├─ key-window × up to 5 → evidence gates → tonality
      ├─ vocal-observation → phrase/source regions → observedVoice
      ├─ light-teaching → practiceTechnique + existing note/word details
      └─ selective timing reviews (existing logic)
                                ↓
              optional vocal-review × at most 3
                                ↓
                 final or useful partial result
```

The new work never occurs before READY. The compact first-result schema is unchanged. Initial latency is not benchmarked against a live provider in this run.

## Runtime integration

`generate()` enables `VocalIntelligenceSession` by default. The lower-level `analyzeAdaptive()` retains an explicit optional feature switch for legacy component tests and alternate embedders. Tests cover the real `generate()` default rather than relying only on the lower-level switch.

`server/intelligence-prompts.mjs` uses independent system instructions for key and original-performance observations. The latter contains no teaching recommendation. `shared/intelligence-schema.mjs` defines strict key/window/phrase/segment schemas. Actual requests use the existing Gemini provider transport, key, URL normalization, silent bounded retry and cancellation facilities.

`server/vocal-intelligence.mjs` owns separate key samples and voice-region results. Its results do not modify the lyric text, occurrence IDs or established lyric clocks. `shared/vocal-intelligence.mjs` provides browser/server normalizers, coverage calculation and display labels. `shared/schema.mjs` preserves these fields on updates/export/import.

## Key evidence

Up to five recording intervals are evenly spread, non-overlapping, and no longer than 28 seconds. Key evidence must explicitly mention audible harmonic/accompaniment context. The estimate is not inferred from the singer's highest note or a teaching batch.

A stable estimate requires three non-overlapping agreeing primary keys and no contrary credible primary estimate. An alternative key lowers displayed confidence. Each sample's tonic is normalized for enharmonic equivalents. Import recomputes consensus and rejects duplicate sample IDs; forged `accuracyVerified` flags cannot pass through.

Possible modulation requires at least two consecutive samples on each side and no unsampled/unknown intermediary result pretending to be evidence. The display gives a bracket that includes the uncertain change location, not a precise modulation time. One different ending sample becomes ambiguity, not a declared modulation. Unsupported modes and insufficient harmonic context remain uncertain.

## Original performance

Phrase batches have a core audio-span bound of 32 seconds, with two seconds of external context. Very long phrases become source-time fragments with the same occurrence identity. Returned phrase IDs/text, window ID, coordinate system and intervals must match the request. `clip_seconds` receives one source offset; `source_seconds` receives none.

An observation records `voice`, `confidence`, `evidence`, independent audible `qualities`, and optional `transitionEvidence`. These are estimates of sound, not physiology. Missing evidence or low confidence cannot produce a definite displayed class. Breathiness does not imply falsetto, nor does a high note. Unsupported rapid changes become uncertainty; explicit evidence-backed transitions are allowed.

Timing refinement can move a phrase envelope after the voice job was requested. Observations remain attached to fixed source seconds, with only their intersection with the current phrase displayed. They are never shifted to fit new lyric text. Existing late-word timing guards remain.

Verification is blind to the previous class and advice. The highest-priority uncertain/transition regions are reviewed after the initial coverage, at most three windows, each with at most eight seconds core plus one second context. Disagreeing classes are marked conflict; a higher self-rated confidence cannot silently win. Outside the actually re-listened interval the original regions are preserved.

## Word display and coverage

The original/practice switch changes display semantics and filters, not the media source. When word boundaries exist, source-region overlap maps original observation to that word. Without word boundaries, only coherent whole-phrase evidence maps to the text and it stays described as phrase-level. The overlap threshold is a heuristic, not measured accuracy.

`vocalCoverage()` includes recognised untimed text in the denominator. It separates identified, actual uncertainty/conflict, pending, missing/unavailable, and untimed words. Omitted model output does not become a reviewed uncertainty. All original text remains visible.

The existing `technique` remains a compatibility alias for `practiceTechnique`. Old scores without original evidence open the practice view; they never acquire observed labels merely by being imported. New outputs include both datasets. Editing a phrase's text or bounds invalidates obsolete original evidence for that phrase.

## Failure and concurrency

The first useful scan is retained after any optional-stage failure. Independent successful practice data survives a missing original observation. Key/voice failures have sanitized stage IDs/codes, never prompts or provider text. The analysis slot is reserved before asynchronous body reading and released in finally. Repeated exhausted connection tasks stop additional optional work instead of traversing all remaining batches during an outage. No cross-instance admission/queue guarantee is made.

## References used for transport compatibility

- Google Gemini Interactions API: https://ai.google.dev/api/interactions-api
- Gemini video input: https://ai.google.dev/gemini-api/docs/video-understanding
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Vercel function duration: https://vercel.com/docs/functions/configuring-functions/duration

These documents support transport/configuration decisions, not the musical accuracy of the app's classifications.
