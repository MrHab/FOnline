# Free weapon sources

The initial eight-model family pilot has been expanded to every firearm.
`catalog-replacements.json` pins six additional FBX sources, their hashes,
download IDs, fit anchors and moving-part selections. In particular, `rifle`
is a separate item from `assaultRifle` and requires its own replacement.
The rifle's source scope is removed so optics remain an equipment modification.
The machine gun adapts the second assault-rifle donor with its own ammunition box.
The pickaxe and hand pump use new project-authored geometry in the generator;
they are not claimed as third-party CC0 models.

This directory contains only the selected authoring files used by the catalog.
The complete upstream archives are deliberately not
vendored. Runtime GLBs in `public/assets/models/weapons/` are generated from
these files by `tools/build-weapon-runtime-models.js`.

All selected models are released under CC0 1.0. The original license files
and download-page provenance are kept beside the sources and in
`manifest.json`.

The original pilot covered one representative of every runtime weapon family:

- `sidearm`: pistol
- `long_gun`: assault rifle (the already approved Quaternius donor)
- `heavy`: flamethrower
- `energy_sidearm`: laser pistol
- `energy_long_gun`: plasma rifle
- `launcher`: rocket launcher
- `melee_light`: knife
- `melee_heavy`: axe

The imported geometry is normalized to the Realm of Ashes `+Y` authoring
axis and aligned to the existing `socket_grip_r`, `socket_grip_l`,
`socket_muzzle`, and reload-part contract. Small project-authored interaction
parts remain in the generated GLBs where an upstream mesh does not expose a
separate reloadable component.

## Rebuild and verify

Run `node tools/build-weapon-runtime-models.js` with the configured Blender
installation. This rebuilds the originals, restores the approved assault rifle,
refreshes the `models-lite` copies used by Unity, and updates both clients' cache
fingerprints. Rebuild WebGL after the Unity fingerprint changes.

Run `npm run check:weapons` to verify all 16 items, source provenance, cache
fingerprints, moving parts and grips. The Unity editor menu
`Realm of Ashes/Проверить все модели оружия` equips all 16 items and captures
desktop and mobile-landscape views under `Temp/WeaponPilotReview/`.

The generator also runs `tools/blender/check_weapon_attachments.py`: visible
parts must form a connected rest-pose assembly within 2 mm, and child details
must remain attached throughout sampled idle, attack and reload poses.
`attachment-report.json` is pinned to the actual GLB hashes and checked by
`check:weapons`. Moving lids/latches, the bolt handle and tank accessories are
parented to their mechanical assembly. Redundant old battery bases and rocket
launcher decorations are not retained on the replacement bodies.
