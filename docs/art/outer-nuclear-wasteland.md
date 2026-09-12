# Outer nuclear wasteland — authored Unity exterior

The playable world, global IDs, route definitions and authoritative multiplayer state are unchanged. The exterior is presentation-only under `WorldEdge_AUTHORED/OuterNuclearWasteland_AUTHORED` in `Assets/Scenes/Kromka/KromkaGlobalMap.unity`.

## Reproduction and incremental authoring

`KromkaGlobalMapOuterWastelandPerimeterAuthoring` owns stages 04–20. The first three source authoring passes remain in their original files. `Assets/Art/Kromka/OuterWastelandProgress.json` records the number of completed 18-degree sectors. The full scene composer honours this count.

Use **Realm of Ashes → Authoring → Outer wasteland → Add next 5 percent** to add exactly one sector. It refuses Play Mode and unsaved scenes, preserves the existing map, validates geometry, and saves the scene and stage count only after passing checks. Do not rebuild the whole map from seed just to add an exterior sector.

The full low-poly ash horizon is foundational geometry created at stage 04. Near detail and scorch passes are still added one sector at a time. Its outer radius is over 300 world units, beyond the strategic linear-fog end; the outer boundary is not intended to be visited. No new scripts execute on the server or during normal gameplay.

All meshes are generated through the authoring code and persisted as Unity assets. Do not manually edit generated vertex data. **Repair terrain joins** deterministically re-seats the near apron joins and crater surface overlays for completed sectors.

## Visual construction

- Twenty connected near sectors surrounding the existing irregular playable outline.
- Actual concave blast bowls with raised rims, plus surface-conforming scorch.
- Larger impact basins and wind-eroded ash ridges in the distant terrain.
- Ruined urban fragments, rusted industrial remnants, wrecked evacuation vehicles, dead trees and scattered concrete.
- All exterior colliders disabled; no source LOD groups that can silently hide fitted strategic-scale models.
- Existing Majadroid and UAZ texture materials retained. Selected Kenney industrial pieces use the existing exterior rust/concrete palette.
- Only the first exterior terrain rows are welded to the pre-existing apron. The playable terrain and boundary line are not modified.

## Online model sources

These sources were checked against their public asset pages; source archives, licenses and hashes are retained in the corresponding ThirdParty READMEs.

| Source | Use | License |
| --- | --- | --- |
| [Majadroid: Apocalyptic Buildings](https://opengameart.org/content/3d-apocalyptic-building-city-cc0) | Seven broken building shells and masonry wreckage | CC0 |
| [Mehozavr: UAZ-452](https://opengameart.org/content/uaz-452-utility-van-lowpoly) | Destroyed evacuation vehicles | CC0 |
| [Fleurman: Destroyed City Assets](https://opengameart.org/content/destroyed-city-assets) | Original western collapsed-city sector | CC0 |
| [Kenney: City Kit Industrial](https://kenney.nl/assets/city-kit-industrial) | Industrial shells | CC0 |
| [Kenney: Factory Kit](https://kenney.nl/assets/factory-kit) | Hoppers, conveyors and crane remnants | CC0 |

Broken dead trees reuse the project's existing MEP pack. MEP is not reclassified as CC0. No AtomicRealm assets or separately licensed third-party assets were added for these perimeter stages.

## Verification

**Realm of Ashes → Checks → Outer wasteland → Validate completed perimeter** checks persisted meshes, near seams, the closed horizon, near/horizon joins, playable-outline exclusion for every prop mesh vertex, and disabled colliders. At stage 20 it also checks the final closing seam to stage 01.

**Play Mode desktop and mobile** performs an offline visual audit in the loaded authored map using the production `RoaCameraRig`. It captures four cardinal rim targets at the legal minimum pitch/maximum strategic zoom and four closer views at 1600×900 and 960×540. It automatically exits its own Play Mode run. It does not log in, connect to a server, or test server-driven map transitions. Review the captured images; a generated report is not a substitute for visual review.

Reports and screenshots go to `Build/KromkaSceneCaptures/outer-wasteland-perimeter/` (ignored generated output).

