# Tutorial cover replacement — 2026-09-12

Replaced the visual children of `yard_cover_a` in the authored tutorial scene
with the existing Atomic Realm `Starter/Models/wall_concrete_metal.fbx` asset.
The chosen model is a solid metal panel on a concrete base, not the lightweight
road sign barrier evaluated during the first visual pass.

The scene marker and `data/locations/tutorialCaravanYard.json` now use
`tutorialRoadBarrier` instead of the retired `roadblockBarricade` key.
The object ID, position `(0, 0, 14)`, rotation, scale, quest tags, movement and
vision flags are preserved. The imported visual is fitted and grounded inside
the existing 3.2 × 1.16 × 0.8 envelope; the solid BoxCollider and server
footprint are unchanged. Source FBX and atlas files were not modified.

`RoaTutorialYardAuthoring.ComposeGameplay` now uses the imported replacement,
so rebuilding the yard does not restore the primitive proxy or retired key.
Only the target cover was replaced in the saved scene; the rest of the yard
was not rebuilt. Its existing blue ground material was left unchanged.

## Verification

- Retired-environment check: PASS; `yard_cover_a` no longer fails.
- Onboarding regression check: PASS, including the current model key,
  stable objective position, solid collision and vision flags.
- Unity compilation: PASS, 317 source files; existing warnings remain.
- Unity parity: PASS.
- Focused offline Unity Play Mode cover probe: PASS. Imported mesh source,
  grounded visual bounds, collider and server definition agree. Final captures
  at 1920×1080 and 844×390 were inspected.
- Isolated live server journey: all 12 tutorial stages passed, including actual
  crouching behind the cover and dialogue turn-in; the first mission also passed.

## Separate failures encountered, not changed here

- Full `npm run check` now gets past the retired-environment failure, but stops
  at the existing GLB library count assertion: expected 141, found 524.
- The full tutorial presentation probe stops at its held-medkit attachment
  assertion. The focused cover probe passes independently.
- The isolated live journey later fails to reach `story-keys-filter-inspection`
  in Keys, after successfully completing the tutorial and first mission.

## Local evidence

- `unity-client/Library/PracticalTutorialAudit/cover-result.txt`
- `unity-client/Library/PracticalTutorialAudit/cover-desktop.png`
- `unity-client/Library/PracticalTutorialAudit/cover-mobile.png`
- `unity-client/Logs/tutorial-cover-replace.log`
- `unity-client/Logs/tutorial-cover-focused-play.log`
- `unity-client/Logs/tutorial-cover-play.log`
- `unity-client/Logs/tutorial-cover-project-check.log`
- `unity-client/Logs/tutorial-cover-live-journey.log`

No production data, deployment or commits were involved. The live journey used
the existing isolated local-server harness and its temporary test data.

## Follow-up 2026-09-18: tracked prefab

The saved scene instanced the FBX itself. Atomic Realm payloads are not
committed, so every clean checkout, CI included, failed
`check:unity-local-prefabs` on the unresolved GUID of
`wall_concrete_metal.fbx`, and `npm run check` stopped there.
`RoaTutorialCoverAuthoring` now saves the fitted mesh and its material as the
tracked native prefab `Assets/Prefabs/Kromka/TutorialRoadBarrier.prefab`, and
`yard_cover_a` instances that prefab. Mesh, material, fitted transform,
collider, stable ID and the server row are unchanged; renders of the cover
before and after the swap are pixel-identical. The existing tracked barrier
prefabs were not used: `roadblock_barricade`, `fence_segment` and
`scrap_wall_segment` are see-through MEP rail fences, and `concrete_wall` is a
wooden palisade. Rendering still needs the local Atomic Realm import, just as
the recovered environment prefabs need MEP.
