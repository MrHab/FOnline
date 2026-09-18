# Priority environment B+C v1

> **Retired.** The set no longer ships. Its runtime GLBs and
> `priority-environment-manifest.json` are gone from
> `public/assets/models/wasteland/`, the eight model ids are listed in
> `src/server/retired-environment-models.js`, and `npm run check:assets` fails
> if a retired GLB or the manifest comes back. The Unity prefabs with the same
> names in `unity-client/Assets/Prefabs/Kromka/RecoveredEnvironment/` use MEP
> and OpenGameArt meshes, not these files.

The first B+C (geometry B, materials C) replacement set for the silhouettes seen
on almost every local map: the car wreck, three dead trees, a dry bush, a rubble
rock, a scrap heap and a wasteland shack.

## What is left here

The `*_bc_v1.glb` exports, `priority_environment_bc_v1.blend`, `catalog.png` and
`technical-report.json` (size, triangle count and SHA-256 of every GLB) stay as
art history. Their generator, `tools/blender/build_priority_environment_review.py`,
and `tools/build-priority-environment-models.js`, which copied the approved GLBs
into the runtime folder, are no longer in the tree;
`git log --diff-filter=D -- tools/build-priority-environment-models.js` finds the
commit that removed them.
