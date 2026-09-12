# Weapon attachment repair — 2026-09-09

Catalog: `3-e5d409ce`; attachment revision: `1`.

## Cause and correction

Some retained procedural details still used the old body coordinates after the
CC0 body replacement. A mesh-surface contact audit found detached parts on seven
models: assault rifle, flamethrower, hand pump, laser pistol, pickaxe, plasma
rifle and rocket launcher. The largest rest-pose gap was approximately 110 mm.
Several magazine, bolt and tank details also belonged to the weapon root instead
of their moving assembly.

- Seated retained sights, stock plates, gauge housing, valve, wedge and nozzle
  against their actual new surfaces.
- Aligned the laser emitter collar with its muzzle and the flamethrower ignition
  glow with the muzzle tip.
- Attached the rifle bolt knob, machine-gun box lid/latch, SMG magazine base,
  flamethrower gauge/valve and laser collar to the matching moving parts.
- Removed four obsolete decorative pieces already superseded by the new bodies:
  laser battery base, plasma battery, launcher warning plate and arming orb.
- Applied the assault-rifle stock seating correction in the runtime adapter;
  the approved source model and its approval hashes remain unchanged.
- Regenerated full and lite GLBs and updated the content fingerprint so clients
  request the corrected assets rather than cached predecessors.

## Verification

- `npm run check:weapons`: passed; 16 models, 103 meshes, 108 animation channels,
  2,998,372 bytes in the full catalog.
- Generator-integrated Blender audit: all 16 assemblies connected within a
  2 mm contact tolerance; 352 sampled animation poses passed. Attachment children
  preserve their local transforms during idle, attack and reload clips (except
  the deliberately scaling ignition glow).
- Unity compile check: passed (pre-existing warnings remain).
- Unity Play-mode weapon probe: all 16 actual runtime models loaded and passed;
  264 samples from imported Unity animation clips preserve attachment transforms.
  Maximum measured primary-grip error: 1.96 mm. No console errors were reported
  during the probe.
- Visual captures: every model at 1280×720 and 896×414, plus close-ups. Selected
  final captures and the Unity report are retained alongside this review.
- `npm run check:unity-parity`: passed.
- Full `npm run check`: blocked by the unrelated existing retired-environment
  reference `tutorialCaravanYard.json: yard_cover_a` in
  `tools/check-retired-environment-glbs.js`. No world-data changes were made to
  silence this failure.

The geometry audit checks connectivity between visible mesh objects in the rest
pose, not disconnected islands inside a single donor mesh. The animation checks
sample imported clips; they are not a claim of a complete multiplayer combat
playthrough. The catalog and in-hand captures were inspected separately.

## Local browser build

WebGL build completed with Unity result `Succeeded` at 02:06 on 2026-09-09
(10 minutes 56.9 seconds). The compiled metadata contains `3-e5d409ce`.
This validation build temporarily used Gzip with decompression fallback; editor
settings were restored to Brotli with fallback enabled. Unity is back in Edit
mode and the previously open `KromkaGlobalMap.unity` scene remains clean.

The build is **not a clean whole-project validation**: Unity reported 600
environment diagnostics (556 missing-prefab messages and 44 associated scene-open
messages) plus 3 warnings. The same missing environment prefab GUIDs occur in the
editor log before this repair's build. No other error categories occurred in the
build report. These scene problems were not modified as part of the weapon fix.

Local output:

- Data: `ca0ac077f6e48c10504e16419e5e44b1.data.unityweb`
- Wasm: `d4bc875b9d4960bca354c01dbdb41999.wasm.unityweb`
- Loader: `2910727b45078e2b4de0604bb352b6d7.loader.js`

The framework's Unity filename stayed unchanged across the compression switch,
so the first browser run reused the old Brotli file with the new Gzip loader.
The generated local `public/unity/index.html` now appends
`?v=local-gzip-e5d409ce` to the framework URL. After that cache-key correction,
the browser loaded the new client to the Unity account/quick-start screen at
`http://127.0.0.1:3000/`. No account was created and no production service was
accessed. The normal Brotli build generator is unchanged.

## Evidence

- [Complete corrected catalog](catalog.png)
- [Laser pistol in Unity, desktop](laser-pistol-unity-desktop.png)
- [Rocket launcher in Unity, mobile landscape](rocket-launcher-unity-mobile.png)
- [Unity runtime fit and animation report](unity-fit-report.json)
- Generated rest-pose/contact report:
  `public/assets/models/weapons/attachment-report.json` (contains the SHA-256
  of each tested GLB; `check:weapons` rejects stale reports).

Only local assets and the local client are in scope. Production is not deployed
by this repair.
