# Offhand item integration — local source verification

The authoritative inventory allows pistol, revolver, sawed-off shotgun, laser
pistol, knife and medkit in the offhand slot. All six now load existing new
models in Unity. Fists remain intrinsic, with no physical model. No combat
rules, item definitions, accounts or production saves were changed.

Revolver and sawed-off shotgun use the existing mirrored firearm grip. Knife
uses a left-hand grip without firearm muzzle/aim/dual-gun semantics. Loading is
staged invisibly until the current request is mounted and the owner's visibility
gate applied. Removal immediately hides the old model, including during loading.

## Evidence

`runtime-report.json`: run `f1ee2fe86bfa4aa09cfd17a86fede87b`, PASS at
2026-09-12 09:26:41 UTC. Six bodies, 1,188 sampled offhand animation poses,
36 additional ordinary live-frame captures, visibility and removal races.
Selected captures: `knife-desktop.png`, `sawed-off-mobile.png`, `revolver-live.png`.

The previous pose capture was misleading: rigid weapons used new transforms
while the rendered body still used the prior skinning frame. See
`before-stale-pose.png` and `before-capture-fix-report.json`. Merely forcing skin
matrix recalculation did not fix this. The sampled-pose capture now freezes
animation/pose writers, waits two native skinning frames, verifies unchanged
bone transforms, and restores every affected setting afterwards. Independent
live captures do not freeze or manually apply the pose. Both show the grip.

Probe output now survives editor shutdown in
`unity-client/Logs/FreeItemReview/runtime/`. For an idle editor use the existing
Realm of Ashes item-probe menu. For a closed editor use `-batchmode
-executeMethod RealmOfAshes.EditorTools.RoaFreeItemProbe.RunBatch` with graphics
enabled (no `-nographics` or `-quit`). The batch entry point restores even an
initially empty scene setup and exits itself. Check both progress and report;
restoration failures must not be mistaken for a successful run.

Compilation, `check:weapons`, `check:ground-items` and `check:unity-parity` pass.
The full npm check still fails on the existing retired map collider
`tutorialCaravanYard.json: yard_cover_a`.

## Not yet established

This is not evidence of a new WebGL build or production deployment. The local
review UI now has an offhand selector and uses the bundled Cyrillic font; the
new binary still needs browser verification. Building is deferred because the
corrected captures exposed upper-body fitting defects in the two layered suits.
See the [suit review](../layered-suits-v2/README.md). A passing attachment probe
does not certify complete garment coverage.
