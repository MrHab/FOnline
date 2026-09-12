# Worn detectors and artifact belts

Current update, 2026-09-09: utilities were refitted against the repaired layered
suits. Current catalog is `1-eafb1fca`; all 288 source/fitting hashes pass.
The latest matching Unity report is in
[layered-suits-v2](../layered-suits-v2/README.md), including 4,752 utility poses.
The build receipt and evidence below belong to the earlier `1-7f172461` stage,
not this new source revision. A fresh local WebGL build is in progress.

The Unity equipment loader now handles `detector` and `artifactBelt` alongside
armor, helmet, boots and backpack. All three detector tiers and belt capacities
2/3/4 use the downloaded CC0 donors already documented in
`source-assets/items/free-catalog-v1/sources.json` (Kenney radio, machine,
computer and container parts). No additional gameplay items or server rules
were introduced. Unidentified artifacts still do not reveal their type.

## Fitting and lifecycle

`tools/blender/build_worn_utility_models.py` produces 288 compact GLBs: six
items × six bodies × eight clothing fits (bare and seven armor families).
The authored strap changes circumference while the downloaded canisters retain
their dimensions. The detector sits at the hip; all visible utility vertices
are rigidly attached to the player's pelvis on the same canonical 65-bone rig.
The fitting band excludes distant armor arm plates. Each output records exact
source-item and body/armor reference hashes. Catalog version: `1-7f172461`.

Changing armor invalidates the cached slot fit even if the utility item does
not change. Superseded renderers are hidden immediately; asynchronous requests
cannot restore an old body, outfit or removed item. Import staging rigs and
new output objects remain inactive until binding and the owner's visibility
gate are applied, preventing hidden entities from flashing their equipment.

`RoaTutorialProps.Build("medkit")` now uses `RoaItemPropView` and the same
downloaded case as hands and ground drops. It preserves the authored handle
anchor, cancels late loads on disable, and does not generate substitute cubes.

## Reproduction and evidence

- `npm run build:worn-utilities`: generate, optimize, synchronize the cache
  fingerprint and audit. Requires the current free-item catalog and armor files.
- `npm run check:worn-utilities`: exact 288 mappings, source/fitting hashes,
  65 joints, pelvis-only weights, geometry budgets and original/lite agreement.
  Included in `npm run check:ground-items`.
- Unity menu **Realm of Ashes / Проверить новые предметы и аптечку**: run
  `d5f84236f4074750ab41ca7df5f78728`, PASS at 2026-09-08 23:25 UTC. See
  [runtime-report.json](runtime-report.json). All 6 bodies × 8 outfits × 3
  utility pairs × 33 poses = 4,752 poses; all parts follow the pelvis. Hidden
  owners, armor/item changes during loading, and removal are checked too.
- Desktop 1440×900 and mobile-landscape 960×540 captures cover every pairing.
  Selected actual Unity images are retained here; these are not donor renders.
- Unity source compilation, ground-item audits, fog checks and Unity parity
  passed. Full `npm run check` still fails on the unrelated retired environment
  reference `tutorialCaravanYard.json: yard_cover_a`.

The local WebGL rebuild finished at 2026-09-08 23:43 UTC (891 seconds).
[Build receipt](local-webgl-build.json) and [compiled-content check](local-equipment-build-check.json)
confirm that the compressed player contains all four current asset revisions.
The content check deliberately exits nonzero: Unity returned `Succeeded` but
also reported 600 scene errors (556 missing prefab instances and 44 scene-open
messages), plus 3 warnings. These are separate from the successful equipment
probe; this is not a clean full-project build. The production Brotli setting
was restored after the local Gzip build. No VPS deployment was performed.

The rebuilt player was reloaded at `http://127.0.0.1:3000/` in the in-app
browser. It reached the login screen at 1440×900 and 960×540, with no captured
browser console errors. The page references WASM
`5a25fdd599429c3e0755273baa0067c6.wasm.unityweb`, data
`a06576479bae58490997962eb6f3179c.data.unityweb`, and framework cache revision
`gzip-1-7f172461`, matching the compiled-content check. No account was created
or signed in; login-screen startup is not an in-world outfit test.

Actual browser outfit verification and the [integrated-footwear overlap](../free-equipment-v2/visual-follow-up.md)
remain unfinished; the overall model replacement goal is still active.
