# Weapon catalog replacement v3

Catalog fingerprint: `3-678f6409`.

The previous replacement covered only eight family representatives. The
separate `rifle`, `machineGun`, `shotgun`, `revolver`, `sawedOffShotgun`, `smg`,
`pickaxe` and `handPump` items still used their old procedural bodies. NPCs
equipped with `rifle` therefore did not benefit from the approved `assaultRifle`.

All firearms now have imported CC0 replacement geometry; the knife and axe
retain their CC0 donors. Pickaxe and hand pump use new project-authored models.
Source attribution and reproducible build instructions are in
`source-assets/weapons/pilot/README.md`.

## Visual evidence

- `catalog.png`: all 16 generated models, independently scaled to fit each cell.
- `rifle-unity-desktop.png`: the replacement rifle held by the runtime Unity
  character, captured in Play mode at 1280 × 720.
- `shotgun-unity-mobile.png`: the replacement shotgun captured in Play mode at
  896 × 414.
- `fit-report.json`: actual Unity measurements for all 16 equipped items.
  Original temporary capture paths identify the full 48-frame probe output.

Maximum measured primary-grip deviation: 0.00127 metres. Melee hand placement
now uses a rigid grip transform so the model's mesh scale cannot shrink the
calibrated hand offset.

## Verification

- `npm run check:weapons`: passed, including all 16 originals and 16 lite copies,
  source geometry/provenance, cache fingerprint and grips across six body types.
- `unity-client/Tools/compile-check.ps1`: passed.
- `node tools/check-unity-csharp.js`: passed.
- `npm run check:unity-parity`: passed.
- `npm run check:unity-weapon-readiness`: passed.
- Unity `RoaWeaponPilotProbe.Run()`: all 16 items passed in Play mode, with
  desktop and mobile-landscape captures.
- WebGL build: succeeded locally on 2026-09-09 at 01:30 (Asia/Yekaterinburg),
  277 MB. The generated metadata includes catalog fingerprint `3-678f6409`.
  The local root page serves the new data/wasm filenames and the browser
  reaches the Unity login screen successfully. No production deployment was
  performed.
- Full `npm run check`: blocked by the unrelated retired-environment collider
  reference `tutorialCaravanYard.json: yard_cover_a`; no location data was
  changed for this weapon replacement.
