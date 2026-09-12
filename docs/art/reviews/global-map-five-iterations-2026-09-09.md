# Global map visual review — five iterations

Requested scope: inspect the complete Kromka global-map scene, correct visual
defects and inaccuracies, consider better suitable environment models, and verify
five successive iterations. Preserve a single Tesma river channel and its downhill
flow from the northern mountain slope.

## Current state

- All five review iterations are complete. Final saved-scene structural probes
  passed at 2026-09-08 23:45 UTC; offline Play Mode completed 40 frames at 23:47 UTC.
  The saved global map remains open in Unity, outside Play Mode and not dirty.
- Review started 2026-09-09 against the existing dirty workspace and saved
  `unity-client/Assets/Scenes/Kromka/KromkaGlobalMap.unity`.
- Unity process 25528 was actively packaging a separately started WebGL build.
  No build was restarted or interrupted.
- The current water layer has 651 vertices: one 453-vertex Tesma profile and
  three 66-vertex reservoirs. Redundant reservoir-interior river triangles are
  omitted by the latest source so there is only one visible surface there.
- Previous source checks and editor probes passed. The general repository check
  was blocked by `tutorialCaravanYard.json: yard_cover_a`; that is not evidence of
  scene visual quality.

## Iterations

1. Water, shoreline and actual rendered-terrain contact — completed (evidence below).
2. Road crossings, approaches, river discharge and roadside contact — completed.
3. Remaining structures, all eight regions and outer-map transitions — completed.
4. Materials, light, atmosphere and close-view readability — completed.
5. Full-scene regression review, desktop and mobile landscape Play Mode — completed.

Each completed iteration includes inspected captures, concrete defects fixed,
and verification evidence. Earlier intermediate findings below are retained as
history; the final iteration records the current acceptance results.

### Physical-placement acceptance criterion (user clarification)

All environment objects must read as real physical objects: supported foundations,
continuous usable bridge approaches, clear road/water corridors, and no arbitrary
interpenetration of buildings, bridges or industrial equipment. This applies to
the entire scene, including procedural geometry and the outer wasteland.

### Iteration 3 — structural assemblies (completed)

- Moved the three Northern Sluices dam groups from the southern basin to their
  named northern reservoirs. The Crown Dam opening aligns with the one channel.
- Fixed a missed hydraulic defect: the Crown reservoir was up to 0.353 units
  above the river passing through it. Matched the whole overlap to one level and
  excavated its actual basin. Saved-mesh audit: zero uphill/submerged/floating
  samples, Crown seam 0.001, mouth seam 0.002. Re-seated the affected windfall.
- Replaced three disconnected dry-land MEP viaducts with one supported freight
  bridge; repurposed four surviving native timber panels as loading platforms.
- Rebuilt R-12 cells with floors and four retaining walls, reduced the ring radii
  to avoid the adjacent factory buildings, and connected both landmark columns'
  braces to ground. Separated hangars, generators and a residential block.
- Inspected the Crown, freight bridge, R-12 close views, southern exterior,
  Glasslands and Silent Ring mobile views, and native ruin detail. This exposed a
  station building on the new rail bridge and additional rail corridor conflicts.
  Applied the revised continuous freight route, four nearby building relocations,
  track-end buffers and full ground-supported ballast. The track terminates in
  the western science service yard rather than crossing sealed laboratories.
  The actual-mesh loading-gauge audit reports zero imported-object rail blockers
  (2026-09-08 23:28 UTC), after moving the last conflicting river fence.
- Assembly diagnostic found 87 unsupported components. Added an idempotent final
  assembly pass repairing the Gloom tower, signal markers, tank caps/bands/supports,
  warning lights, surgical arms, switchgear hinges and ground-bound rings/cracks.
  Applied audit (2026-09-08 22:35 UTC): 955 imported objects and 2,071 individual
  assembly parts against 42 actual terrain meshes, zero unsupported candidates.
  This is bounding-box connectivity, not a blanket collision/engineering proof.
- Separated all four fuel tanks into parallel rows, fitted end caps and bands to
  their actual axes, grounded both supports per tank and seated rack warning lamps.
- Refreshed close tower, tank, rail, Crown and R-12 views confirm the repairs.
  Final structural probes also pass for Northern Sluices, Middle Vein, Soviet
  placements, both road crossings, freight crossing, Zero Core/Outer, Silent Ring,
  inner terrain join and completed outer perimeter.

### Iteration 4 — surface finish and terrain seam (completed)

- Isolation captures show the thin grey perimeter line persists without the
  yellow boundary line, but becomes an open gap without the apron. The old apron
  used 192 vertices per ring against 320 on the landmass, plus an outward/downward
  offset. Source now shares the exact 320 edge positions and validates every pair.
- Added local roughness variants for Majadroid ruins and Mehozavr wrecks. They
  retain all source textures/colours; no third-party model or texture is edited.
  Applied and captured local roughness variants; compared the native ruin detail
  against the earlier shiny surface. Source texture, mesh, scale and colour are
  preserved. Corrected the local material asset names as well.
- Applied the terrain join repair and verified coincident edge vertices. The
  thin open seam is absent in the refreshed Silent Ring view.
- Captured 31 views under `Build/KromkaSceneCaptures/visual-review-5/04`.
  Inspected all eight regional mobile landscapes, all four exterior desktop views,
  the close ruin and industrial details. No additional material or terrain-join
  defect was found. Final water/placement regression is tracked separately below.

### Iteration 5 — final regression (completed)

- Expanded the actual saved-mesh audit to every perimeter sample of all thirteen
  water bodies. Found exposed edges on several old isolated pools, and the sixth
  karst window wholly outside the rendered interior terrain.
- Each isolated water body now derives one level from its lowest uncarved rim and
  cuts a matching bowl in both the visible terrain and runtime height field.
  Moved the sixth karst window inside the landmass and moved/reduced the western
  toxic pond away from the tank farm. On 2026-09-08 23:32 UTC, all thirteen pool
  perimeters had zero exposed/missing-ground samples; 301 river samples still had
  zero uphill/submerged/excessive-clearance findings. Strict mode now asserts the
  lake perimeter checks too.
- The changed basins exposed fourteen old-height native props and eight assembly
  contact candidates. Added a scoped, idempotent natural-prop seating pass and
  reduced the southern pond's eastward extent to keep the Balance facility dry.
- Applied this last adjustment after the unrelated WebGL build completed, without
  interrupting that build. Fresh actual-mesh contact audit (23:45 UTC): 955 imported
  models, 2,069 assembly parts, 42 ground meshes; zero unsupported candidates and
  zero confirmed rail loading-gauge blockers. All final structural probes passed.
  These diagnostics plus visual review are not a dynamic engineering simulation.
- Strict saved-water audit passes after the final pond resize: one channel, 301
  river samples, zero missing ground/uphill/submerged/excessive-clearance samples;
  all thirteen pool perimeters have zero exposed or missing-ground samples.
  River clearance range is 0.01349–0.06351 Unity units; Crown seam 0.001 and mouth
  seam 0.002 remain connected without a reverse grade.
- Captured the final 31-view editor set under `visual-review-5/05`. Inspected all
  eight regional mobile views and five structural close-ups. Inspected the four
  boundary directions again in the subsequent running-client audit.
- Full offline Play Mode completed 40 fresh images at 1600×900 and 960×540 under
  `Build/KromkaSceneCaptures/full-scene-play-review`. Inspected all twenty mobile
  views (eight regions, both road bridges, mouth, freight bridge, Crown, tower,
  tanks, R-12 and all four outer boundaries), plus all eight regional desktop
  views. Play Mode exited normally, leaving the saved map open and clean.
- Fresh compile check passes with 309 project sources (pre-existing warnings
  remain); `check:kromka-unity-authoring` and `check:unity-parity` pass.
  Full repository check again stops at the unrelated retired collider
  `tutorialCaravanYard.json: yard_cover_a`; it has not been modified for this map task.

### Iteration 2 — road and river corridors

- Corrected both concrete bridges to the intersections of the actual smoothed
  road and river meshes, not sparse control-point segments. Added four persistent
  ground-supported curved approaches, exact deck seams and route-endpoint checks.
- Separated the Middle Vein rail corridor from the road crossing and moved the
  obstructing Keys workshop, water tower and three residential buildings.
- Inspected all eight region desktop captures and all four exterior views. Added
  close desktop/mobile bridge captures (26 views per review set).
- New actual-mesh contact inventory covers 973 imported objects and 42 terrain
  meshes, including unpacked exterior ruins. Twelve old MEP bridge deck pieces
  remain flagged for support review. This audit is not a general collision proof.
- Close R-12 capture revealed a missed major defect: its bridge and river ran
  through the procedural regenerator column and buildings. Moved the service
  crossing upstream (map 206.7,114.8) and rerouted the road around the industrial
  facilities. The one river now skirts R-12 and discharges into the existing eastern
  settling lake at 248,74. No global location IDs or server definitions changed.
- Matched the lake plane to the outlet and cut its basin into the rendered terrain
  and runtime height field. Strict saved-mesh audit: 301 samples, zero submerged,
  missing-ground, excessive-clearance or uphill samples. Clearance 0.02542–0.06351;
  outlet/lake height difference 0.002, outlet inside lake. Clean water: 651 vertices
  (one channel, three northern reservoirs).
- Extended crossing clearance from Keys centreline checks to the full width of
  both decks and four ramps, including procedural obstacles. This caught the
  market hall and north market fence, which were moved to the southern market site.
  All updated bridge, Middle Vein and Soviet placement probes pass.
- Grounded all six roadside lamp assemblies directly on their signs, embedded
  their bollards, and moved TesmaDispatch to the dry bank. Re-seated four existing
  lake-edge props after the basin height change, preserving their source/scale/XZ.
- Expanded river audit: 1,318 structures, zero non-hydraulic blockers. Ten bridge
  parts are classified as hydraulic, not certified as structurally supported.
- Offline full-scene Play Mode captured 22 frames: all eight regions, both road
  bridges and the mouth at 1600×900 and 960×540. Inspected all eight regional mobile
  views, main bridge desktop, R-12 bridge mobile and mouth desktop. Play Mode exited
  normally; saved map remains open, not dirty. Images are under
  `Build/KromkaSceneCaptures/full-scene-play-review`.
- Fresh compile check passes (303 project sources; concurrent unrelated development
  changes that total). Authoring/parity and hydrology probes pass. Full npm check
  still fails only at the previously recorded unrelated retired-collider assertion.
- At the end of iteration 2, iterations 3–5 remained open: the twelve old MEP walk/rail panels and their furniture
  need physical support/continuity repairs; three dam groups named NorthernSluices
  are authored in the southern basin and require geography review. Close R-12 ring,
  pipe and brace construction still needs review. Exterior specular glitter and
  terrain-apron seam diagnosis are also pending. Do not treat the water or contact
  audit as proof that the entire environment is physically correct.

### Iteration 1 — single-channel water contact

- Inspected baseline whole-map overview, northern sluices and Middle Vein views.
  The river disappeared into ground at several points despite its analytic grade
  check passing. The saved triangle-mesh diagnostic found 18 submerged centre
  samples, with worst penetration 0.05250 Unity units.
- Cut a continuous bed from the same downhill profile used by the water, updating
  both the visible relief mesh and the runtime height field. Rebuilt only generated
  water, bank and route layers; other scene placements were preserved.
- Fresh mesh audit: 281 samples, zero missing ground, zero submerged centres,
  zero excessive clearance; clearance range 0.02298–0.06351 units. One river and
  three separate northern reservoirs remain. No side canal is rendered.
- Editor water, shoreline, route, boundary and two road-bridge probes passed;
  river clearance: 437 structures checked, zero blockers.
- Captured all 22 iteration-1 views under `Build/KromkaSceneCaptures/visual-review-5/01`.
  Inspected the refreshed northern desktop view, headwaters low-angle view and
  single-channel mobile landscape view. These confirm removal of the old broken
  river sections. The other regional captures are not yet claimed as inspected.
- Remaining planned iterations 2–5 are still pending; this is not a completed
  whole-scene five-iteration review.
- Offline Play Mode audit completed: six frames using the production camera rig,
  covering headwaters, middle and lower reaches at 1600×900 and 960×540. Inspected
  middle-reach desktop and upper/lower mobile captures. Audit exited Play Mode
  normally and left the saved map open in Unity.
- Fresh Unity compile check: 299 source files, no errors (existing unrelated
  warnings remain). Authoring and Unity parity checks passed. Strict rendered
  river audit also reports zero uphill rows.
- Full `npm run check` rerun still stops at the unrelated retired-environment
  collider assertion for `tutorialCaravanYard.json: yard_cover_a`.
