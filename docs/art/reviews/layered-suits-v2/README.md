# Layered hazmat and energy suits

Current source catalog: `2-2392c3f1`; dependent worn utilities: `1-75bbf530`.
This is a local integration review, not evidence of production deployment.

## 2026-09-12: integrated attachment-weight repair

The current twelve suits were promoted byte-for-byte from candidate `2-2392c3f1`
after all 3,854,700 rest samples and 60 hand-inclusive bent-arm views passed.
Native runs `2c34f698c5454885aeb148ca4927a95f` and
`eb0d9f0de8fb4006bd94384de93c1500` passed consecutively in the already-open
editor, without a script/domain reload between them. The original scene was
restored after both. Desktop/mobile captures were inspected.

Retained garment attachments now inherit the fitted cloth's skin weights;
the hood/respirator retains anatomical head binding. In the recorded energy
suit walk/reload samples, separation growth decreased from about 36 mm to
under 16 mm. The frame-bound regression rejects the old sample and passes the
new one. This is not a zero-intersection or complete artistic-quality claim:
decorative trim still intersects the faceted cloth in close-up stress poses.

The repeat-run check also caught stale native resources in static GLB caches.
All model-loader caches now release previous-session imports on entering Play
mode when domain reload is disabled. The dedicated compile checker includes
the Unity.Scripting reference needed by these lifecycle attributes.

All 524 canonical GLBs now have linked native prefab counterparts. Both the
editor catalog probe and the Node exact-path/dependency check pass (15 runtime
entries). All 288 worn-utility variants were regenerated against these suits.
The final public-loader run and rebuilt-browser item checks pass; see
[integration status](../../ITEM_MODEL_INTEGRATION.md). No production deployment
has been performed.

## Previous isolated candidate: `2-70e2ace8`

All twelve variants pass the file audit, 3,854,700 full-body rest samples across
60 suit/body/boot combinations, and all 60 hand-inclusive bent-arm Blender
views. The views have zero bare-skin rays and zero magenta pixels. Original-leg
ownership, sealed glove slits, overlapping upper-arm inserts and the two female
source-arm closures address the defects in the superseded candidates below.
The 12,000-triangle ceiling remains unchanged. Exact evidence is archived in
`unity-client/Logs/SuitSealedUpperarmProof-2-70e2ace8/`; see
[upper-fit-progress.md](upper-fit-progress.md).

Native run `ee74a88739364fe6a5ae8448506554c5` subsequently loaded this revision,
but revealed attachment separation in walking/live reload. It was not promoted;
the attachment-weight repair above supersedes it.

## 2026-09-12: upper-body repair — isolated, not yet promoted

The [offhand capture correction](../offhand-v1/README.md) exposed a gap in this
review: the earlier coverage audit checked only legs and feet. Correctly timed
native captures show exposed torso/shoulders in both suits. See
`before-upper-energy.png`, `before-upper-hazmat.png` and
`upper-coverage-before.json`. For example, the current male-slim hazmat suit has
3,413 uncovered upper-body samples. The lower-leg audit is still valid for its
stated scope; it must not be presented as full-suit approval.

The generator's world-space skin transfer applied the imported rig's body-size
scale a second time. On female_large (scale 1.035) this lifted sleeves roughly
5 cm; repeated contact fitting then produced severe spikes. `transfer_skin`
now converts fitted vertices to rig-local space before parenting. A regression
test covers all six actual rigs, including translated/rotated parents: maximum
rest-position error is below 0.0000005 m.

Candidate fitting also aligns anatomical waist/shoulder/neck heights, avoids
incompatible clavicle pivots, welds material seams before deformation, preserves
plate/liner separation and prevents collar vertices projecting onto the face.
Both suits now use the pinned CC0 Quaternius SpaceSuit donor on all six bodies;
the exposed-joint female SciFi donor was unsuitable for a sealed full suit.
Existing material/retained-detail references and original approval files remain
untouched. This source choice is not evidence of successful animation fitting.

The old 32-point male-slim "central seam" diagnosis was a short-ray false
positive: a ray inside the trousers exited the cloth after 0.413 m. Further
diagnostics found analogous sleeve (0.336 m) and trouser (0.509 m) exits. The
shared enclosure check follows the garment's actual bounds. A distant inner
plate can be entered and exited before leaving the enclosing sleeve: oriented
crossing counts now handle that case. Regression fixtures reject an isolated
distant volume and an open outer coat even when an inner plate remains. Nearby
lining retains the original surface-cover contract; this is not a solid-volume
test of cloth material (the wearer is inside the garment's air space).

At this earlier checkpoint, all 12 variants had been generated, but full
coverage and visual review were incomplete; the latest results are above.
The upper mask now uses bone ownership: the previous neck-height cutoff missed
visibly exposed trapezius/shoulder skin. Earlier "10 of 12" coverage results are
not valid full-outfit approvals. Fitting and auditing now share the stronger mask.
The runtime catalog remains `2-9e8c2a4e`. No player's base mesh is hidden in
runtime assets (magenta body materials are diagnostic renders only).

The subsequent native Unity capture run loaded candidate `2-2a885f6c`
successfully, but **visual review rejected it**: the male-large energy suit
opens at the shoulders during live reload, and the retained strips/garment
surfaces still intersect. The probe's PASS is a loading/layer/capture result,
not an outfit approval. A generated articulated textile insert has since
closed elbow/underarm exposure in one male-large Blender stress-pose trial.
That is not yet an all-body or Unity fix; see the current checkpoint in
[upper-fit-progress.md](upper-fit-progress.md). Published assets remain unchanged.

Candidate work lives outside public assets in
`unity-client/Logs/UpperSuitCandidate/`. Reproduce using Blender:

```
--background --factory-startup --python-exit-code 1 --python tools/blender/build_layered_suit_models.py -- --candidate --joint-liner
--background --factory-startup --python-exit-code 1 --python tools/blender/check_layered_suit_fit.py -- --candidate --upper-body
```

The candidate audit is `unity-client/Logs/layered-suit-upper-candidate-coverage.json`.
Use `--upper-body` without `--candidate` to audit the current runtime catalog.
The default `npm run build:layered-suits` now generates a complete isolated
upper-fitted candidate, never public assets. Direct Python generation without
`--candidate` is refused. Promotion copies the reviewed GLB bytes rather than
regenerating an earlier lower-body-only fit; see the workflow below.
The newer candidate coherently refits the collar, removes obsolete collar/hip
fillers, mounts plates onto curved cloth, bends zipper/conduit strips and keeps
leg seals on their own leg. The surface audit now includes vertices and edge
midpoints; face-interior-only passes missed thin seams. See the progress file
for the exact current candidate and visual evidence. Verify all 12 variants
and animation fitting, then regenerate dependent
utilities and build/test WebGL. Do not launch another browser build before this
defect is fixed.

## What the visual review caught

The original lifecycle probe passed while the rear close-ups still showed
exposed calves and heels. `lifecycle-before-fit-report.json` is deliberately
retained with the two `before-*.png` images: binding/layer activity alone did
not establish a correct garment fit.

- Whole-body scaling did not align the donor's calf axes with the player's.
  Nearest-vertex projection could fold offset fabric rings into the body.
- The female modular Feet donor also includes shin protection. Hiding that
  entire donor removed part of the suit rather than only its shoes.
- Stripping the donor's flexible joint insert left holes around the knee.

## Implementation

Pinned Quaternius CC0 donors are refitted by the canonical leg landmarks,
then radially fitted around the actual body surface. The ankle shoe geometry
is separately fitted around the instep, toes and heel. Shin plates and the
retextured flexible joint insert stay with the suit. Skin weights are sampled
continuously from the body surface. No player's base feet are hidden.

`RoaEquipmentView` suppresses the generated `builtin_footwear` object only
after a separate boot model has actually loaded on the same character/body.
It restores the layer on removal or cancelled loading. Fog renderer toggles
cannot re-enable an intentionally inactive garment layer. Dropped suits keep
their own shoes. Both worn and dropped views use `RoaSuitModelCatalog`.

The original reviewed armor files and approval records are not overwritten.
The new manifest records source, retained-detail and base-body hashes. The
generator writes working reviews under `unity-client/Temp/LayeredSuitReview`.

## Reproduce and verify

1. `npm run build:layered-suits` generates all twelve isolated variants. Any
   geometry edit invalidates existing coverage, views and native evidence.
2. Run the full-body candidate coverage command above. For every body/item pair,
   render with Blender's `--python tools/blender/render_layered_suit_fit.py --
   --candidate --coverage-body --pose=arms-bent --include-hands --body=<body-id>
   --item=<item-id>`. Use all six body IDs and both suit IDs, then inspect the
   current-version views; do not reuse old reports.
3. Run the Unity candidate probe `RoaFreeItemProbe.RunSuitCandidateBatch` against
   a fresh `tools/serve-unity-assets.js --suit-candidate` host. Use the host's
   actual loopback origin through `ROA_UNITY_PROBE_ORIGIN`. Preserve other Unity
   sessions and obtain any required launch authorization. Use `-batchmode` with
   graphics enabled; omit `-quit` because this asynchronous probe exits after
   restoring the scene. Wait for normal probe
   completion/scene restoration and inspect desktop/mobile walking, live reload,
   death, wrists/attachments and hood/hair captures. An automated PASS alone is
   not visual approval.
4. Only after that inspection: `npm run build:layered-suits -- --promote-candidate`.
   This requires matching twelve-model, full-surface and native evidence plus
   unchanged client source. It copies exact GLBs, optimizes models-lite and
   updates the cache version. A recoverable `Logs/SuitPromotionBackup-<uuid>`
   captures previous public/lite/cache files; failures roll back these targets.
   `--sync-only` instead synchronizes existing public assets, not a candidate.
5. `npm run build:worn-utilities`, `npm run check:ground-items`,
   `npm run check:layered-suit-fit`, `unity-client/Tools/compile-check.ps1`,
   `npm run check:unity-parity` and the final public Unity item/equipment probe.
   Also regenerate the native model-prefab catalog with
   `RoaModelPrefabGenerator.RebuildAll` and run `RoaModelPrefabCatalogProbe`.
   The previously missing 383 prefab counterparts are now generated: both trees
   contain 524 entries. Checks require exact path
   coverage, and the generator/probe also compare imported models with the
   canonical files on disk. Failed/incomplete generation stops before stale
   prefab deletion or runtime-catalog replacement.
6. Run `npm run check`, build a fresh local WebGL client, verify its code/catalog
   fingerprints and inspect the actual desktop/mobile-landscape browser player.

`npm run check:layered-suit-promotion` tests exact-copy, stale/incomplete evidence
rejection, concurrent-edit protection and rollback in a synthetic temporary
project only. It is included in `check:layered-suits` and grants no native or
visual approval.

### Historical lower-leg verification (public `2-9e8c2a4e`)

The surface audit samples 659,440 points across two suits, six bodies and five
boot configurations (integrated plus four separate pairs): zero uncovered
samples for this revision. Feet/calves must be enclosed by the same leg's
garment; above the canonical knee, trousers may share a pelvis volume.
This is a rest-pose surface test, not proof of every animation or cloth seam.

The runtime probe additionally checks layer activity across 1,980 animation
poses, fog updates, removal races, two dropped suits, and the production-loader
local review UI. Run `310861f197624fb79bbe760a61711542` passed at
2026-09-09 00:29:57 UTC; see [runtime-report.json](runtime-report.json).
It also covers the other new equipment, 4,752 utility poses, medical cases,
ground items and artifact identity transitions. There are 96 extra walking/
death captures for the two suits with integrated and assault footwear.
Selected rear, walking and death captures were inspected and retained here.
The fixed poses no longer show the exposed calves/heels from the before images.
Selected evidence above is retained in this directory. New probe runs write
full captures to `unity-client/Logs/FreeItemReview/runtime/`; unlike Temp,
that directory survives Unity closing. Old unarchived Temp captures may be gone.
The [surface coverage report](coverage-report.json) records each tested model
hash, boot hash, body hash and foot/calf/thigh sample counts.

`RoaLocalModelReview` is available only on loopback HTTP(S) with the exact
query flag `?roaModelReview=1`, in a rebuilt WebGL player. It does not initialize
accounts, multiplayer or saves. It uses real body/equipment/item loaders and
has a feet close-up mode. An earlier local WebGL build completed, but lacks the
new offhand/font changes. Fresh build/browser verification is deferred by the
upper-body defect above. Read the current build
receipt in `unity-client/Logs/local-webgl-build.json` before treating it as ready.

The earlier retired-map and missing-prefab blockers are no longer present.
The current full suite (`integration-full-check.log`) passes the prefab audit
and stops in `check-crowded-room-performance.js`: its movement test harness lacks
`isArtifactStunned`. That unrelated server-test failure is not waived or fixed
by this asset integration. The full suite is not passing. This work does not
change maps or authoritative movement.
