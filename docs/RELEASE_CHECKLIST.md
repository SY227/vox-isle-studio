> Historical design/checklist retained from the v1.2.0 baseline. Current deployment, retry budgets and line-first pipeline are documented in `README.md` and `QA_STABILITY_V1.2.1.md`. Historical checklist items are not a new live certification.

# v1.2.0 acceptance checklist

Completed automated checks are in QA_REPORT.md. Before public rollout, separately verify:

- Both supplied video URLs using `npm run verify:links` on a connected machine with a locally configured key.
- First-pass studio entry before optional work finishes; record real first-result latency and provider usage.
- Native YouTube play, top play/pause, seek, buffering, speed and lyric follow during progressive updates.
- Listen to the actual song and compare line/word times against a reference; model confidence is not sufficient.
- Observe low-confidence, missing-text and partial-state disclosure. Later failures cannot clear usable lyrics.
- Actual iPhone/Safari/Chrome hardware, accessibility, WebGL, long-running tabs and embedded video restrictions.
- Set quota/cost limits, origin/access code/HTTPS before deploying beyond loopback.

Current package is tested for local behavior, not certified for live YouTube musical accuracy.
