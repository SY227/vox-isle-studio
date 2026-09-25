# Singing Fox v1.2.3 — whole-song singing-style coverage QA

Scope: fix late-song singing-style labels without changing the fast initial lyric/timing pass.

## Production changes

- Teaching batches are scheduled breadth-first across the song. The first three teaching jobs cover the beginning, ending, and middle instead of only the earliest sections.
- A non-fatal teaching-batch failure no longer stops later independent batches from running.
- Each successful batch keeps one targeted missing-ID repair. If a word still cannot be classified, it becomes explicit `待確認` (`technique=unknown`, `annotationStatus=uncertain`) instead of a blank/missing label.
- If refinement has to stop early because of a fatal service/configuration error, every never-run teaching batch is finalized as `待確認`; the score remains usable and the overall refinement state remains partial.
- Late word timing returned from an older teaching batch is rejected when it falls outside the phrase's current reviewed timing envelope. Its valid singing-style label is still retained.
- Initial loading behavior is unchanged: the studio still opens after the fast lyrics/timing result; singing-style enrichment remains background work.

## Verification

- Node/backend regression: **315/315 passed**.
- JavaScript syntax: **66 modules passed**.
- Vercel build: **passed**.
- Browser suites: **272/272 passed** across smoke, regression, adaptive/progressive, listening, native-media, and stability suites.
- Targeted 80-line synthetic stress (`qa/v123/whole-song-coverage-stress.json`): first teaching batch deliberately fails; final quarter remains fully identified; failed first batch becomes `待確認`; `missing=0`.
- Prior adversarial stress pack improved from **41/54** to **44/54** after this scoped change. The three acceptance failures fixed by this release are: incomplete teaching entries, stale word timing after timing review, and the full-pipeline timing/teaching race. Ten previously documented unrelated stress findings remain outside this release's scope.

## Limitations

This QA uses controlled provider responses and local browser media for deterministic fault injection. It does not certify live Google/YouTube availability, the correctness of any real singer's register, or acoustic lyric-timing accuracy on a commercial recording.
