# Global map: floating-model repair pass, 2026-09-12

## Result

Checked 955 imported model instances against 42 terrain meshes in the saved
`KromkaGlobalMap` scene. The mesh-contact check found nine floating instances
that the earlier renderer-bounds check had missed. Lowered only those instances
to the terrain, with a small 0.012 world-unit contact overlap. Horizontal
placement, rotation, scale and source assets were preserved.

Corrected instances:

- `BrokenRoadBarrier_1`
- `BrokenRoadBarrier_3`
- `EchoPillar_12`
- `Burrower_RidgePiece_03`
- `KarstCollapse_1_2`
- `SecondHaven_WalkWest`
- `Zero_SealedGarage`
- `EchoPillar_14`
- `DestroyedUaz_Centre`

The fresh post-repair audit reported no floating instances. A second repair
pass changed zero objects. The scene is saved, and the targeted repair is
also called after global-map composition and incremental terrain rebuilding.
River geometry and authored location definitions were not changed in this pass.

## Method and scope

`KromkaGlobalMapMeshGroundingPass` samples the lower envelope of visible model
mesh vertices and measures their clearance from actual terrain geometry.
An instance is flagged when even its lowest sampled contact remains more than
0.015 world units above the ground. Automatic movement is restricted to the
nine reviewed instances; bridges and deliberately elevated assemblies are not
indiscriminately snapped to terrain. This is a sampled model-contact check,
not a guarantee of structural support for every disconnected mesh component.

## Verification

- Unity compile check: passed, 316 source files; existing warnings remain.
- Unity authoring and parity checks: passed.
- Surface-contact audit: passed.
- Final bridge, rail, sluice, basin and boundary probes: passed.
- Physical-scene and assembly-contact audits: no reported unsupported models
  or detached assembly parts.
- Before/after close-up captures: inspected for all nine corrected instances.
- Offline Unity Play Mode: completed 40 captures across the map at 1600x900
  and 960x540, using the game camera; selected final desktop/mobile views
  inspected.
- Full `npm run check`: blocked by the pre-existing retired-environment collider
  reference `yard_cover_a` in `tutorialCaravanYard.json`, outside this repair.

## Local evidence

- `Build/KromkaSceneCaptures/mesh-grounding-pass/before.json`: nine findings.
- `Build/KromkaSceneCaptures/mesh-grounding-pass/repair.json`: nine changes.
- `Build/KromkaSceneCaptures/mesh-grounding-pass/after.json`: zero findings.
- `Build/KromkaSceneCaptures/mesh-grounding-pass/idempotence.json`: zero changes.
- Matching before/after PNGs in the same directory.
- `Build/KromkaSceneCaptures/full-scene-play-review/play-mode-audit.txt`:
  successful 40-frame Play Mode capture run.
- `unity-client/Logs/mesh-grounding-before.log`, `mesh-grounding-repair.log`
  and `mesh-grounding-play.log`: batch execution logs.

No deployment, commits, production connections or account/save edits were made.
