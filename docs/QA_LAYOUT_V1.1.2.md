# VOX ISLE v1.1.2 — layout delivery hotfix QA

## Root cause observed from the user screenshot

The screenshot showed the skip-link in normal document flow plus native browser inputs/buttons. Those elements are styled by the production stylesheet, so the page logic had rendered while the production CSS was effectively absent in the user's browser session.

The v1.1.1 stylesheet itself renders correctly in isolated browser QA, which means the recurring failure was the page's dependency on a separate `/styles.css` request rather than the visual rules themselves.

## v1.1.2 fix

- The complete production skin is embedded directly in `public/index.html` as `#vox-production-style`.
- `public/styles.css` remains as the editable/source copy, but the page no longer depends on fetching it at runtime.
- Executable browser asset URLs were cache-bumped to v1.1.2.
- Existing AI listening, YouTube provider fallbacks, lyric sync, and developer configuration behavior are unchanged.

## Release evidence

- JavaScript syntax: 46 modules passed.
- Node unit/server/provider/player tests: 209/209 passed.
- Focused browser smoke/layout checks: 33/33 passed.
- Extended browser regression checks: 58/58 passed.
- Recording-first listening UI checks: 30/30 passed.
- Native-media playback/sync/long-score checks: 50/50 passed.
- A dedicated browser render was executed with all `.css` network requests intentionally returning 404. The page still rendered the full production grid, panels, typography and responsive layout because the skin is embedded in the HTML.

## Scope note

This hotfix addresses the recurring raw/unformatted layout failure. It does not claim live Google/YouTube network certification in this environment.
