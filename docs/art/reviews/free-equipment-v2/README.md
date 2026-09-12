# Downloaded equipment replacements — Unity runtime verified

The Unity source client now resolves ten equipment families to the separate
`public/assets/models/equipment/free-v2/` catalog, including dropped views:

- Backpack: downloaded Quaternius sack, existing fitted shoulder/chest harness.
- Steel, tactical, assault, pre-war and welded helmets.
- Army, scout, reinforced and assault boots.

Every family has six body variants. The old reviewed equipment files remain
intact; this catalog does not forge or overwrite their approval metadata.

## Sources

Pinned CC0 masters and license/source records are in
`source-assets/equipment/free-gear-v2/sources.json`; the backpack master remains
in `source-assets/items/free-catalog-v1/`. The sources are:

- [Quaternius modular men](https://quaternius.com/packs/ultimatemodularcharacters.html): SWAT and spacesuit equipment.
- [Quaternius modular women](https://quaternius.com/packs/ultimatemodularwomen.html): soldier and sci-fi boots.
- [Quaternius soldier](https://poly.pizza/m/PpLF4rt4ah): steel helmet donor.
- [Lucian Pavel bucket helmet](https://opengameart.org/content/bucket-helmet): welded helmet donor.
- [Quaternius backpack](https://poly.pizza/m/vF7TuXCPDH).

Only selected equipment geometry is retained from character donors. Neck/body
pieces are removed; all meshes use the player's existing 65-bone skeleton.

## Fitting corrections

The first AABB-only boot fitting squashed the donor's forefoot below the
player's instep. The generator now fits the forefoot height independently,
subdivides the donor surface and clears a convex toe envelope plus the actual
calf surface. It does not hide the base feet to conceal a bad fit. Skin weights
are interpolated over the nearest body triangle instead of jumping between
nearest vertices, preserving continuous ankle deformation.

The runtime import staging object is inactive from creation. Its unanimated
source skeleton must never appear beside the worn, rebound equipment while an
async import or deferred destruction spans a frame.

## Verification and reproducibility

- `npm run build:free-equipment` fetches pinned sources, generates all 60 models,
  updates models-lite and the Unity content fingerprint, then audits files.
- `npm run check:free-equipment` verifies every item/body mapping, provenance,
  model and fitting-reference hashes, normalized skin weights, all 65 joints,
  triangle budgets, original/lite geometry and the cache version.
- `tools/blender/check_free_gear_fit.py` checks 139,008 rest-pose skin surface
  samples across all 24 boot pairs. Latest completed run: zero uncovered
  samples. This does not prove animation clearance by itself.
- Unity menu **Realm of Ashes / Проверить новые предметы и аптечку** additionally
  tests actual worn/dropped loaders, skeletal ownership, sampled animations,
  ray-tested animated foot coverage, removal and hair restoration, all seven
  armor combinations and desktop/mobile landscape captures.

The completed [runtime report](runtime-report.json) is PASS for equipment
`2-a89d04ce`, items `1-e97f4e39`, utilities `1-7f172461`, run
`d5f84236f4074750ab41ca7df5f78728` (2026-09-08 23:25 UTC). It covers all six
bodies, five helmets, four boot families, seven armor combinations and 990
helmet/boot animation poses, plus the item/medical/utility checks. The
[static boot report](boot-coverage.json) records zero uncovered samples.

Two initial probe failures were measurement artifacts, not evidence of real
clipping: BakeMesh must include renderer scale before transforming baked
vertices to world space, and a ray leaving the open boot cuff must be tested
against the virtual cuff opening rather than called a hole in the boot wall.
Head-follow residuals are compared in world metres, not scaled bone-local units.
Desktop/mobile fronts and rear armor/backpack views are retained below.
New probe runs write captures to `unity-client/Logs/FreeItemReview/runtime/`.
The [visual follow-up](visual-follow-up.md) links the layered-suit work. Its
lower-leg repair passed, but the newer [suit review](../layered-suits-v2/README.md)
records upper-body coverage defects. Binding tests do not certify full fitting.

Compilation, ground-item audits and Unity parity passed. The broad `npm run
check` still fails at the unrelated `tutorialCaravanYard.json: yard_cover_a`
retired environment reference.

A local browser rebuild has finished with matching compiled asset revisions,
but 600 scene errors remain; see the [build evidence](../worn-utilities-v1/README.md).
Actual browser outfit verification is still pending. [Worn utilities](../worn-utilities-v1/README.md) and
the tutorial medical case now use downloaded models and passed the same run.
