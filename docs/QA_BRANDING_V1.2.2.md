# Singing Fox v1.2.2 — branding/UI touch-up QA

Scope: UI-only branding pass. Analysis, playback, provider, retry, synchronization and backend coaching routes remain packaged.

Changes:
- Product UI renamed to 聲狐 / Singing Fox.
- Removed the visible studio companion panel (澄 / YOUR VOCAL COMPANION / 逐句陪練).
- Removed the home 「分析說明」 control.
- Word selection no longer triggers an invisible detailed-lesson request while the companion UI is absent.
- Non-YouTube/demo score uses the full score width after removing the side panel; YouTube retains the right-side source player.
- Internal project/repository folder name remains `vox-isle-studio` for deployment continuity.

Executed checks:
- Node automated tests: 311 / 311 passed.
- Focused browser smoke checks: 33 / 33 passed.
- JavaScript syntax validation: 66 modules passed.
- Vercel build: passed.
- Responsive checks in smoke suite: 390 px and 768 px home/studio with no horizontal overflow.

No live Google/YouTube analysis was required for this branding-only release.
