# Free item integration — work in progress

## Implemented in the Unity source client

- 21 formerly unmapped items: cassette of blue, three detectors, three artifact
  belts, lead container, and all thirteen authored artifact types.
- Downloaded medical case replaces the old procedural held case in either hand
  and overrides the old ground-library medkit. Its authored handle is mounted
  in the palm, with the case below the wrist in the idle pose.
- Artifact fields load the corresponding model only when the server reveals
  `typeId`. Mk1/Mk2 continue showing a neutral, unidentified model. No artifact
  identity/proximity rules or authoritative gameplay data were changed.
- Requests are invalidated on pickup, room clear, and identity changes. A known
  shape is hidden immediately when the detector no longer identifies it.
- New ground items preserve metre-scale geometry, not the loading marker's
  flattened scale. Original and models-lite catalogs share a content revision.

The additional `artifactUnknown` model is presentation-only, not a new item.
There are 79 gameplay entries; fists intentionally have no physical GLB.

## Sources and reproducibility

Pinned masters and copied license notices are in
`source-assets/items/free-catalog-v1/`; `sources.json` records exact SHA-256,
author, page, download URL, archive member, and external texture dependencies.
All item donors are CC0. Adaptations include static skin baking, orientation,
metre-scale fitting, worn materials, utility housings, and authored belt straps.
The detectors are adapted device housings, not claimed to be original detector
assets from the source packs.

- [Kenney Space Kit](https://kenney.nl/assets/space-kit)
- [Kenney Space Station Kit](https://kenney.nl/assets/space-station-kit)
- [Kenney Survival Kit](https://kenney.nl/assets/survival-kit)
- [Quaternius medical pickup](https://poly.pizza/m/ijqVDSeIM5)
- [Quaternius spring](https://poly.pizza/m/vKySckBbyb)
- [Quaternius heart](https://poly.pizza/m/1yCRUwFnwX)
- [Quaternius Pirate Kit, anchor](https://quaternius.com/packs/piratekit.html)

Run `npm run build:free-items`. This fetches pinned donors, generates the GLBs,
refreshes models-lite, updates the Unity cache version, and runs the file audit.
`--sync-only` skips regenerating geometry and synchronizes an existing build.

## Verification

- `npm run check:free-items`: all 23 model IDs; authoritative inventory coverage;
  source hashes, provenance, static geometry, triangle/download budgets,
  sockets, no importer helper meshes, lite geometry, cache fingerprint.
- `unity-client/Tools/compile-check.ps1` and `npm run check:unity-parity`.
- Unity menu **Realm of Ashes / Проверить новые предметы и аптечку** invokes
  `RoaFreeItemProbe.Run`: temporary Play scene, original scene restored, no test
  account or server gameplay writes. Exercises production ground, artifact,
  medical and equipment loaders. Captures desktop 1440×900 and landscape
  mobile 960×540. Live results are in `unity-client/Logs/FreeItemReview/runtime/`
  (retained when Unity clears its Temp directory on exit).
- The first visual inspection caught a case attached by its bottom despite a
  passing bone-distance check. The generator orientation and palm mount were
  corrected; the probe now also checks idle forearm clearance.

The broad `npm run check` currently stops at the pre-existing retired-collider
reference `tutorialCaravanYard.json: yard_cover_a`. Do not treat that full suite
as passed or change unrelated location work to silence it.

## Equipment stage and remaining work

A new [Quaternius backpack](https://poly.pizza/m/vF7TuXCPDH) (CC0) replaces the
complete visible sack, preserving the body-fitted shoulder/chest harness.
The backpack's six generated variants live in `public/assets/models/equipment/free-v2/`.
Their generator records source and retained-reference hashes; it does not
overwrite or forge the existing v1 approval artifacts.

Run `npm run build:free-equipment`, `npm run check:free-equipment`, and the same
Unity probe. Runtime code selects the new backpack for worn and dropped views.
Review candidate flags alone are not proof of successful Unity fitting; inspect
the versioned runtime report and screenshots for the exact build.

The subsequent [equipment stage](../free-equipment-v2/README.md) replaced all
five helmets and four boot families, with all-six-body Unity checks and rear
armor/backpack captures. [Worn utilities](../worn-utilities-v1/README.md) now
implement the three detector and three artifact-belt slots, including armor
changes, visibility and load races. The tutorial medkit no longer builds cubes.
The latest versioned runtime report is in the equipment-stage review; the older
report in this directory is retained as evidence of the initial item stage only.

The earlier local WebGL rebuild and its scene errors are recorded in the utility
review. The subsequent [layered suit repair](../layered-suits-v2/README.md) fixes
double footwear and protruding calves/heels, with a newer utility revision.
Its Unity checks pass; a fresh browser build and actual outfit verification
are tracked there. Source/Play-mode success is not a production replacement.
The 23 legacy ground-library items remain a lower-priority visual refresh queue,
not missing item lookups.
