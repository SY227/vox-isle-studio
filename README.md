# 聲狐 · Singing Fox v1.3.0

Full application update based on v1.2.3. Traditional Chinese remains the default. Existing local directory, GitHub repository and Vercel project remain `vox-isle-studio`.

## What changed

The key and original-performance analyses are now separate from singing advice. This is a working pipeline/UI update, **not a claim of measured improvement in musical accuracy**.

**調性**: up to five non-overlapping recording windows are listened to in dedicated key requests. Teaching batches cannot set the song key. A stable-key estimate needs three agreeing non-overlapping observations with accompaniment evidence and no contrary credible primary key. Relative-key alternatives stay visible. A possible modulation needs at least two consecutive observations on each side; its location is a bracket between sampled windows, not an invented exact second.

**原唱聽感（估計）**: phrase-level time regions describe the audible original performance, with evidence and separate uncertainty. Labels are 偏真聲感 / 偏混聲感 / 偏頭聲感 / 偏假聲感. Breathiness and other audible qualities are not substitutes for a registration class. This is not an examination of the singer's vocal folds.

**建議練法**: the existing learner-facing chest/mix/head/falsetto suggestions are retained in a separate view. They may legitimately differ from the original sound. They never supply a missing original-performance observation.

The lyric panel has a small view switch. Original-observation regions are mapped to existing source/lyric times, rather than independently assigning a new vocal category to every character. Unsupported rapid category changes are marked uncertain; explicit evidence-backed transitions are retained. Up to three targeted re-listens follow the primary whole-song coverage. Disagreeing observations remain uncertain; the model's own confidence is not used as proof of correctness.

The first compact lyrics/line-timing response still opens the studio **before** key analysis, original observations or practice annotation requests. Optional work is bounded to three concurrent provider calls. New key/voice requests can increase background analysis time and API usage; no new five-second load-time promise is made.

Missing and unavailable entries remain unfinished work rather than being counted as reviewed uncertainty. Untimed recognised text remains readable and is counted in coverage; it is not assigned fabricated timings or original-style labels. A late failure preserves the playable score and successful suggestions. The update also reserves HTTP analysis slots before request-body reading and stops optional work after repeated exhausted provider failures.

## Preserved

One visible main navigation tab; one top playback bar; complete recognised lyrics in page flow; YouTube beside the score on desktop; responsive stacking on narrow screens; existing sync/player controller; bright visual identity; embedded production stylesheet; no visible developer setup/model controls; no song cover or companion coaching side panel. Backend coaching/recording code remains for future use.

## Install locally

Use Node.js 22.x (tested with 22.16.0). No runtime npm package installation is required.

```bash
cd "$HOME/Downloads"
unzip -o singing-fox-v1.3.0.zip
cd vox-isle-studio
npm run dev
```

Open `http://localhost:3000`. Stop the previous server before updating. The ZIP contains no `.env`, `.git`, `.vercel` or `node_modules`. Unzipping into the **same folder** preserves those settings; a separate new folder does not inherit the key.

On a first installation only, run `npm run setup` to enter the Gemini API key with hidden input, then `npm run check:api`. Never paste keys in chat or commit `.env`. The default backend model stays `gemini-3.8-flash`; it has not been silently substituted. Environment variables override only on the server.

**Reanalyze existing songs after updating.** Old exported results remain readable but cannot acquire original-performance evidence that was never generated. Their legacy `technique` values remain practice suggestions, not original observations.

## Update the existing GitHub / Vercel project

```bash
(
set -e
cd "$HOME/Downloads"
unzip -o singing-fox-v1.3.0.zip
cd vox-isle-studio
git check-ignore -q .env
npm run check
npm test
npm run build
git add -A public server shared api scripts tests docs package.json package-lock.json vercel.json README.md Dockerfile .gitignore .vercelignore .env.example
if ! git diff --cached --quiet; then
  git commit -m "Separate key and original voice analysis from practice advice"
fi
git push origin main
vercel --prod --yes --scope tyuiop
npm run verify:deployment -- https://vox-isle-studio.vercel.app
)
```

This changes the existing project, not its domain or repository name. The deployment verifier uses GET requests only. It checks version, app modules including the new shared module, and key presence; it does not certify live song processing.

## QA and live validation

```bash
npm run check
npm test
npm run build
```

`tests/ui_intelligence.py` adds phrase/key/observation/recommendation, native local-audio, error-preservation, export and responsive checks. It requires Python Playwright, aiohttp, and Chromium, **only for QA**, not for application use. Set `CHROMIUM_PATH` when Chromium is not at `/usr/bin/chromium`.

The new optional command performs one real provider analysis of exactly the supplied recording:

```bash
npm run verify:music -- --execute "https://www.youtube.com/watch?v=62VyD_SVS40&list=RD62VyD_SVS40&start_radio=1"
```

Without `--execute`, it performs a dry run. With no URL it uses four previously requested recordings sequentially. Each job can incur multiple billable provider calls and normal bounded retries. It never automatically repeats an entire job. Reports go into a timestamped folder under `test-results/v130-music/` and contain metrics/failure categories, not the key or full lyrics. `pipeline-integrity-passed` means structural processing checks passed; it is **not** musical accuracy or browser playback certification.

The real `62VyD_SVS40` attempt in this delivery environment stopped at preflight: YouTube and Google DNS failed, and no API key was configured. **Zero live songs were analysed here.** Browser testing used labelled synthetic AI responses and a local-audio-backed YouTube controller. See `docs/QA_VOCAL_INTELLIGENCE_V1.3.0.md` and `qa/v130/` for evidence. Older `qa/v121` and coverage reports are historical, not this release's result totals.

## Limits and interpretation

- Tonality is sampled across the recording. Short/local key changes can fall between samples. At most five windows and strict support gates are not a complete harmonic transcription.
- Observations and advice are both model-generated estimates. Multi-window agreement and blind re-listening by the same model are not independent acoustic verification or calibrated probabilities.
- Note pitches, lyric text and word/line timing still use the existing AI estimation. No new DSP pitch estimator, source separator, forced aligner or vocal-fold measurement was added.
- The phrase/word overlap gate and rapid-transition thresholds are explicit heuristics, tested for consistency but not fitted on an independent singing dataset.
- Original observation can remain partial while practice suggestions are available. A legitimate uncertainty is not the same as a failed/missing analysis. Unknown is not silently filled with a practice label.
- The app still uses the official YouTube player and URL-analysis route, with no downloader, login bypass or DRM removal. Restrictions and provider-preview behaviour can still prevent a source from working.
- The Vercel function remains configured for 300 seconds and the application's Vercel work budget is 260 seconds. Optional work stops at that budget and keeps available results. This is not a durable background job system and does not continue after a terminated request.
- Memory caches, request admission and rate limits are per process, not a distributed queue/authentication/spend-control solution. Configure deployment protection and account spending controls before a wider public rollout.
- Local WAV uploads are still subject to the existing limits and the tighter hosted JSON payload cap. This scoped release is not an upload-pipeline redesign.

## Development architecture

See `docs/VOCAL_INTELLIGENCE_V1.3.0.md` for schemas, timing coordinate handling, aggregation, compatibility and failure semantics.
