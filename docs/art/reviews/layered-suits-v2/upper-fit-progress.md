# Upper suit fitting: work in progress, not a runtime approval

The current game assets remain suits `2-9e8c2a4e` and utilities `1-eafb1fca`.
No new WebGL build or production deployment was made in this repair stage.

## Verified fixes

- World-space vertices are transformed once into the imported rig's local
  coordinates before parenting. `tools/blender/check_world_skin_binding.py`
  passed 12 cases (six bodies, actual and translated/rotated rig), 73 sampled
  vertices each; maximum error 0.00000044 m. The old helper incorrectly applied
  body-size scale again.
- Waist/shoulder/neck height mapping and the humerus-based shoulder frame avoid
  incompatible clavicle lengths. The downloaded source topology remains the
  visible garment; player geometry is neither hidden nor copied into it.
- The source remains the already pinned CC0 Quaternius SpaceSuit glTF, SHA-256
  `33E0E0FBC6140FFC936A099FD84A274BE406115C4B32AA0A697641710B67392A`.
  Energy suits now use this closed garment for both sexes; the original female
  SciFi file is retained on disk, not deleted or modified.
- Body-normal rays can legitimately travel beyond a short sleeve/trouser
  distance. The shared bounded-ray helper checks outward orientation on long
  hits. `check_suit_enclosure.py` passes inside-volume, other-volume entry and
  genuine-hole fixtures. Rest-pose surface checks are not an animation proof.

## History through candidate 2-0e76459c

The older candidate `2-1647bb0d` passed ten variants only under the old
height-sliced mask. New front/back renders showed exposed high shoulders above
the neck pivot. That result must **not** be called full-body coverage. With the
stronger skin-ownership mask, only the three female hazmat variants passed:
male hazmat had 53/90/108 failing samples, female energy 236/228/173, and male
energy 714/822/866 (slim/medium/large, per footwear configuration).

The mask now excludes face/hands by their bone weights, not a height plane;
raised shoulders and the neck remain included. The fitter uses this same
head-excluding body surface so a collar cannot jump onto a forehead while
genuine high shoulders still get fitted. A synthetic raised-shoulder regression
passes. Glove fitting retains hand geometry even though the coverage test does
not require bare hands to be hidden.

That complete rebuild was **`2-0e76459c`**, using `skin-ownership-v1`. Seven of
twelve variants pass the stricter sampled rest-pose audit. Remaining counts per
footwear configuration: hazmat male_medium 12; energy female_slim 4,
female_large 3, male_slim 4, male_medium 14. The small energy failures are at
the neck; the male-medium failures also include the armpit. Other variants have
zero sampled failures. The audit exits 1 and nothing was promoted.

The armpit diagnosis still needs care: a failing ray first enters a waist layer
after 0.427 m, while the nearest sleeve triangle is outside the body sample.
This could involve concavity or overlapping layers, not necessarily a visible
skin hole. Do not distort cloth merely to satisfy that ray. Independent masked
renders were added to cross-check actual exposed required skin.

- Candidate GLBs/manifest: `unity-client/Logs/UpperSuitCandidate/` (not public).
- Latest full build/audit logs: `upper-anatomical-gloves-build.log` and
  `upper-anatomical-gloves-audit.log` in `unity-client/Logs/`.
- Hash-bound coverage report: `layered-suit-upper-candidate-coverage.json`.
- World binding regression: `world-skin-binding-check.log`.
- Geometric ray diagnostics: `upper-arm-seam-diagnostic.log`,
  `upper-pelvis-seam-diagnostic.log`, `upper-male-contact-diagnostic.log`.
- `render_layered_suit_fit.py` renders a real body and suit in a common rest
  pose. `--highlight-body` changes only the temporary render's body material.
  It does not modify the model files. Existing `fit-*.png` outputs are working
  captures and must be matched to their logged model hash, not treated as the
  newest candidate automatically.

`--coverage-body` renders only the required skin magenta; face/hands remain
visible in grey. It captures full-body front/back/left/right/low-oblique views.
For latest energy male_medium the diagnostic counted 0/0/3/0/3 magenta pixels.
The side/low-oblique pictures show a tiny neck boundary issue, a visibly spiky
collar, an obsolete large pelvis yoke and front/back retained panels floating
away from the new cloth. They are **not visually approved**, regardless of
near-zero visible-skin counts. See `upper-coverage-visual-male.log` and
`coverage-fit-energySuit-male_medium-*.png` in Logs. These observations change
the next action to collar geometry and retained-detail mounting, not more
unbounded contact iterations.

`npm run check:ground-items` passes the unchanged runtime catalogs (including
60 free equipment variants, 288 utilities and 12 layered suits). That result
does not validate the new isolated candidate, which still fails as stated above.
`npm run check:layered-suit-fit` also passes its binding/enclosure/mask fixtures
and the unchanged runtime's **lower-body-only** coverage. The wrapper still
needs `--upper-body` enabled when the complete candidate is promoted.
The full `npm run check` was rerun and still stops at the unrelated retired
environment reference `tutorialCaravanYard.json: yard_cover_a`; see
`unity-client/Logs/upper-fit-full-check.log`. No authored location was edited to
silence that failure.

## Collar/detail follow-up and stronger seam checks

Current complete generated candidate: **`2-3bf95527`**. It is isolated in Logs;
public suits remain `2-9e8c2a4e`. No Unity source-client assets, build receipt or
approval file has been changed in this fitting stage.

- `refit_suit_collar.py` maps the downloaded collar by angular sector. The
  source's lower rear rim no longer uses the front's highest vertex as its
  height anchor; front and rear required skin heights are treated separately.
  Cap centres remain near the neck axis instead of turning into spikes.
- `refit_suit_details.py` removes obsolete pelvis/collar filler islands from
  generated copies, fits each leg seal only to its own leg, conforms rigid
  backing faces onto cloth, and subdivides/bends long zipper/conduit strips.
  The slim wrist gasket is a broad tube (about 88 mm axial width), not a thin
  bracelet or panel. The old classification translated it backwards by 11 cm;
  the new one fits its complete cross-section around the sleeve.
- Torso/sleeve ease is a continuous 3 mm body-normal offset, fading into
  the trousers and out before the collar. It does not replace or hide body
  geometry. The collar uses its own coherent radial clearance; blindly adding
  the same normal offset there flared the rim and worsened jaw-edge gaps.
- Sparse vertical collar intervals are subdivided before fitting. This follows
  the neck bulge between source rings instead of only increasing their radii.
  The controlled female_medium energy test (`2-9f7fbec3`) passed all five boot
  setups and had no bare camera rays in five views before the complete rebuild.
- `near-surface-layered-rays-v2` resolves the diagnosed armpit sequence of
  inner-plate entry/exit followed by outer-sleeve exit. Its regression cases
  retain isolated-volume/open-coat rejection; the near-surface contract is
  unchanged. A garment covers air space, not just its solid cloth thickness.
- `face-interior-vertex-edge-v2` now probes vertices and seam midpoints too.
  The earlier `2-e6efaf0d` passed 1,541,880 face-interior samples but not this
  stronger audit. After boundary fitting, `2-3513e241` passed ten variants;
  energy male_slim/male_large retained 12/2 boundary failures per boot setup.
  Collar margin candidate `2-edc20356` instead had 2/6 failures on energy
  male_medium/male_large. The subsequent all-over 3 mm ease trial `2-7d6cd275`
  had 1/2/2/16 failures on hazmat male_medium and energy male_slim/medium/large,
  respectively; it fixed the large sleeve gaps but worsened the neck rim.
  These trials were not promoted or called complete.
- Diagnostic renders check actual model/body hashes and log the true file
  fingerprint. Their per-view JSON compares camera-ray depths at magenta
  pixels; this separates visible skin through a visor from an open seam.
  Pixel/depth results remain diagnostics, not animation approval.
- `tools/build-suit-fit-contact-sheets.ps1` creates versioned six-body contact
  sheets and rejects mixed capture versions. Input captures remain untouched.

The isolated GLB file audit now supports `node tools/check-layered-suit-models.js
--candidate`. It passed all 12 current files: exact source/retained/body hashes,
65-joint skins, normalized weights, no animations, three separate layers and
10,032–11,440 triangles (under the 12,000 limit). It explicitly does not certify
runtime cache fingerprints or models-lite for isolated candidates.

Latest build log: `suit-refined-neck-full-build.log`. The corresponding full
audit is `suit-refined-neck-full-audit.log`; captures are recorded in
`collar-sector-render-<item>-<body>.log` and `coverage-fit-<item>-<body>.json`.
The complete current audit finished: **11/12 variants pass**, 60 footwear
configurations, 3,854,700 samples. Hazmat male_medium has one failing armpit
sample in each footwear configuration (five failures total); every energy
variant now passes the dense geometric audit. The command correctly exits 1.

The remaining hazmat sample is `(-0.21693435, 0.03592872, 1.43072796)`.
Its nearest sleeve face is 25.2 mm away on the outward side. Its normal ray
first enters a waist layer after 0.398 m, followed by crossings with signs
`- + - +`; other front/back/down rays exit the nearby sleeve. Five diagnostic
views show no bare skin on this body. This suggests another layered-air-space
ambiguity, not a proven hole, but it remains unresolved: do not weaken the
test or distort the sleeve solely to turn that counter green. See
`suit-final-armpit-diagnostic.log`.

All 60 current captures and all 12 visibility JSON files have matching hashes.
Eight variants have no bare camera rays in any of the five views. Remaining
diagnostic counts: hazmat female_slim/female_medium have 2/4 rear pixels around
torso height 1.32 m; energy male_medium/male_large have 1/15 front pixels at the
jaw/neck boundary. These still require a focused visual judgment/fix. The
large detached wrist loops and cross-leg seal bridges are gone in the current
front/side sheets, and the energy collar no longer has the old long spikes.
Versioned sheets are `suit-sheet-2-3bf95527-<item>-<view>.png` in Logs.

No generation/render/audit process remains live at this checkpoint. The
candidate is not a runtime, animation or browser approval. Next work should
target the remaining small jaw/rear seams and adjudicate that exact armpit ray,
then proceed to actual Unity motion validation; do not restart broad scaling
or blindly add more whole-collar normal padding.

The shared runtime lower-body regressions pass in
`suit-upper-ease-runtime-regressions.log`. The complete npm suite was rerun and
still fails at the unrelated `tutorialCaravanYard.json: yard_cover_a` reference
(`suit-collar-seal-full-check.log`). No authored map was changed to silence it.

## 2026-09-12: native motion evidence and articulated textile trial

Native candidate run `f0568ec0efc045e7a4c9df1b6653fe26` completed at
12:04:58 UTC and served exact candidate `2-2a885f6c` bytes through the isolated
loopback host. Its report is in `Logs/UpperSuitUnityReview/runtime/report.json`.
The run checks actual bone ownership, garment layers, walking/attack/death
captures and live procedural reload. Its PASS does **not** certify surface fit.
Inspection in the subsequent turn rejected the outfit: in
`suit-upper-male_large-energySuit-integrated-reload-live-desktop.png` the
shoulders open and expose the body. Wrists, hips and garment/details also have
intersections in native captures and in a separate Blender rest render.

The current panel fitter now starts a rigid panel's back plane outside the
furthest cloth sample, including its backing vertices, before conforming the
back. Previously the centre sample could place that back through the front of
a thin panel on a curved shoulder. The original reviewed models remain intact.
An attempted radial-thickness treatment of the seals was removed: these source
bands showed effectively zero separate radial depth, and that change did not
explain or fix their visible intersections. Do not repeat the unsupported
"collapsed solid gasket" diagnosis.

`render_layered_suit_fit.py --pose arms-bent` now reproduces an explicit,
identical world-space bend on the character and garment rigs. Its filenames
and JSON include the pose so it cannot overwrite or masquerade as rest-pose
coverage. This synthetic pose is not Unity's procedural reload.

The opt-in `--candidate --joint-liner` experiment creates real textile inserts
from the project's body surface, preserving vertex skin weights before bounded
LOD simplification. It never hides/edits the player's body and does not change
the downloaded outer plates, cuffs or shoes. Duplicate UV/normal-seam positions
are welded before the 8 mm normal offset; otherwise the insert itself splits
into separated facets. The template records body provenance, replaced inner
textile triangles, triangle counts and measured rest-space simplification error.
The existing 12,000-triangle asset ceiling and the 3 mm insert surface-error
limit remain enforced. A briefly tried 6 mm error bound did not protect the
posed shoulders and was rejected; the 3 mm guard was restored.

A complete-sleeve plus bounded side-chest prototype for **energy / male_large**
(`2-bc908773`, SHA `5d09f04ed49736fe05b07ffde63e471a9b51657b1120f4f52c0e3203ccbd93c4`)
has 11,844 triangles. All five stress views have zero magenta pixels and zero
bare-skin rays, and the underarm/back images were inspected. The exact GLB,
original partial manifest, visibility report and five images are preserved in
`unity-client/Logs/JointLinerProof-2-bc908773/`. The copied manifest retains its
original candidateFile path; use the archived basename and verify the SHA when
reading this historical proof. This is one-body Blender evidence only.

The side-chest selection initially lacked an outer x bound, inadvertently
including fingers at the same T-pose height. The bounded torso selection fixes
that. The current opt-in experiment restricts textile to shoulder/underarm/elbow
joint regions to leave the donor's ordinary sleeve spans intact and reduce cost.
Two female variants generated with this pattern, but the all-body trial stopped
at **hazmat / female_large**: 1,520 source insert triangles needed reduction to
682 under the complete-outfit budget, yielding 3.733 mm rest error. The generator
correctly rejected it. These joint-only variants are not yet pose-approved;
the archived successful proof above used the earlier complete-sleeve pattern.
Do not present it as proof for the newer pattern or other bodies.

`RoaSuitDeformationSnapshot` prepares frame-bound posed mesh/weight/bone dumps
for three diagnostic candidate captures. It compiles, but the attempted new
Unity launch command was rejected by the execution environment before a process
or log was created. No new native run or browser verification occurred in this
turn; do not reuse the old PASS as evidence for these code/geometry changes.

The default (no joint-liner flag) complete candidate was regenerated as
`2-686e9344` with the panel backing correction so the failed/partial experiment
does not leave the catalog mixing revisions. All 12 files pass the structure,
source-hash, bone/weight and triangle-budget checker. The immutable candidate
host test passes all 24 original/lite alias responses; it is not a models-lite
optimization or runtime approval. The new insert remains opt-in and unpublished.
This complete baseline still has the previously observed dynamic sleeve defect;
do not confuse it with the archived one-body liner proof.
Its fresh dense rest audit completed all 60 footwear configurations and
3,854,700 samples: 11/12 variants pass, with the same one male-medium hazmat
armpit sample failing once per footwear configuration (five total). The audit
correctly exits 1; see `Logs/suit-panel-backing-full-coverage.log`. No new Unity,
Blender generation or coverage process remains live at this checkpoint.
Compile-check and Unity parity pass (existing compiler warnings remain). The
full npm check still fails at `tutorialCaravanYard.json: yard_cover_a`, recorded
in `Logs/suit-articulated-joints-full-check.log`; no map data was changed.

## 2026-09-12: two-pose endpoint LOD, complete inserts and closed gloves

The new complete isolated catalog is **`2-be760740`**, generated with
`--candidate --joint-liner`. All twelve files pass the candidate checker, which
now validates the recorded rest/stress error budgets as well as hashes, source
references, 65-joint skins and the 12,000-triangle ceiling. Hazmat variants have
11,971–11,978 triangles; energy variants have 11,194–11,700 triangles. Public
suits remain `2-9e8c2a4e`; utilities and original approval artifacts are unchanged.

The earlier failed LOD experiments exposed two separate issues:

- BMesh/Decimate can change a non-planar quad's diagonal. `freeze_surface_triangles`
  retains the existing loop triangles and verifies exact topology/coordinates;
  its fixture also checks UVs, materials and skin groups. Surface measurements
  sample real triangles, not the off-surface mean of four non-planar corners.
- Rest-only collapse was not motion-safe: the male-medium insert's 2.48 mm rest
  error became 16.79 mm in the bent-arm pose, opening shoulders/elbows. Rebinding
  weights alone did not fix it; neither did decimating in the bent pose or masking
  broad joint areas. Those ineffective implementations have been removed.

`simplify_articulated_mesh.py` retains original endpoints/skin weights and uses
both poses for collapse costs, orientation and bounded surface checks. Original
samples follow the actual supporting triangle after every collapse. Tracking
only their original endpoints missed subsequent edits to neighbouring supporting
faces; the global audit caught a 1.094 mm glove error despite a 0.8 mm local bound.
Face-based dependency tracking fixes this. The final BMesh topology is compared
with the plan, and retained coordinates/weights are preserved. Callers still
reject excessive global error or geometry count; no tolerance was relaxed.
The stronger regression reduces a two-joint sleeve from 480 to 180 triangles
and verifies original endpoint weights/boundaries and a 2.91 mm bent-surface error.

The complete intermediate catalog `2-3e120f9d` first recovered enough detail/shell
budget to keep the full joint inserts. Its exact twelve GLBs, manifest and dense
audit are archived in `Logs/SuitEndpointProof-2-3e120f9d/` (manifest paths retain
their original locations; archived basenames plus SHA identify the historical
bytes). It is not an approval: hand-inclusive views exposed 147–189 bare rays
per variant, mostly fingertip/nail slits that the older hand-excluding mask missed.

The body-derived glove initially copied open nail/crease boundaries: the male
source had 310 open finger edges even after 1 micrometre welding. Bone-delta and
rigid-hand diagnostics ruled out separate finger rigs (residuals below 0.4
micrometres). The new glove closes boundary components fully owned by the hand,
preserving the forearm-weighted sleeve opening, before adding 3 mm cloth clearance.
There are 42–56 closed source boundary loops per body. Its endpoint LOD retains
the 1 mm global rest/stress guard. The base player hands are never edited/hidden.

Current evidence:

- `Logs/suit-closed-gloves-full-build.log`: complete `2-be760740` generation.
- `Logs/suit-closed-gloves-full-stress-render.log` and twelve
  `coverage-fit-arms-bent-hands-<item>-<body>.json` files: all sixty views have
  matching model/body hashes. Six male variants have zero bare rays; each female
  suit has 5/4/4 rays for slim/medium/large, respectively, at fingertips. These are
  not yet waived. Male-large hazmat has 14 magenta pixels but zero bare-depth rays.
- Version/pose-qualified front/back contact sheets for both suits were inspected.
  `build-suit-fit-contact-sheets.ps1` now checks both the capture log and matching
  pose/hand-mask JSON before composing a sheet; source captures are untouched.
- `Logs/suit-closed-gloves-full-coverage.log` and
  `Logs/layered-suit-upper-candidate-coverage.json`: all sixty boot configurations,
  3,854,700 rest samples, **60 failures**. Both suits' female-large bodies have four
  symmetric armpit samples per boot configuration, and male-large bodies have two.
  Eight of twelve variants pass this audit; all foot/calf/thigh/pelvis/torso zones
  pass. Expanding the side-chest insert from 0.65 to 0.55 shoulder-width did not
  resolve these exact armpit rays; diagnose the actual fold/lining crossings next.
- Surface/endpoint, world-binding and enclosure/mask fixtures pass. Compile-check
  and Unity parity pass with existing compiler warnings. The complete npm suite
  still fails at unrelated `tutorialCaravanYard.json: yard_cover_a`; see
  `Logs/suit-endpoint-full-check.log`. No map data was altered to silence it.

The generation, rendering and coverage commands above are terminal. Two new
Unity processes (17148/16344, started around 19:19 local time) briefly appeared
during the final read-only process check; both IDs were absent on the immediate
follow-up. They were not launched or controlled by this work and are not evidence
of a candidate probe. They were left untouched.
No new candidate-native validation, runtime promotion or WebGL/browser review
was completed by this work. The six-body improvements are genuine, but this candidate remains
unapproved until the remaining fingertip/armpit cases and real animations are
checked. Do not reuse old native PASS reports as evidence for these models.

## 2026-09-12: welded fingertip seams and stricter model-only coverage

The complete isolated candidate is now **`2-29eeba17`**. Its twelve GLBs pass
the source/hash, 65-joint binding and unchanged triangle-budget checks.
Hazmat variants contain 11,971–11,978 triangles; energy variants 11,190–11,692.
Runtime `2-9e8c2a4e`, models-lite, dependent utilities and approval assets are
unchanged. The former twelve GLBs, manifest, revised dense report and twelve
hand-inclusive view reports are archived in `Logs/SuitClosedGloveProof-2-be760740/`;
historical manifest paths are resolved by archived basename and SHA.

The remaining female fingertip openings were real source seams, not skinning
drift. `inspect_suit_glove_seams.py` found four-edge slits whose opposite
corners differ by only 0.045–0.127 mm. `holes_fill` cannot close those near-
coincident loops. One large-body seam also has a subdivided, five-edge side.
`seal_hand_boundaries` first fills ordinary hand-owned openings, then welds
only nonadjacent, same-bone corners of these remaining four/five-edge slits
within 0.2 mm and closes any residual cap. It never welds arbitrary nearby
fingers, changes base-body assets or closes the forearm-blended cuff.

`check_suit_glove_seams.py` verifies all six real body sources, zero remaining
hand-owned boundary edges, unchanged cuff vertices/edges and unchanged base
geometry/file hashes. Female slim/medium/large require 4/3/4 seam welds; male
slim/medium/large require 1/0/2. Both rest and bent-arm LOD remain within 1 mm.
The file checker now requires the closure evidence for joint-liner candidates.

Armpit diagnostics refined the earlier "missing patch" diagnosis. On female-
large shared boundary samples, a face normal starts inside adjacent body
geometry and the first nearby body crossing is an exit. Those rays can travel
inside the arm/garment and escape an open overlap without testing external
armpit skin. `exterior_boundary_normal` redirects only these boundary probes
using welded body normals; it never selects a direction from garment geometry
or drops a sample. A concave-prism fixture proves an actual hole still fails,
inward/back-facing alternatives and distant body exits are rejected, ordinary
face normals remain unchanged, and UV splits do not alter the normal.

Importer `Icosphere` bone-display objects are not GLB garment meshes. They are
now excluded from both dense coverage and rendered-image depth comparisons.
A regression fixture verifies that a large helper sphere cannot hide holes.
The previous render diagnostic could therefore report zero bare rays for real
magenta skin below one metre; that result is not reliable enclosure evidence.

Current evidence (all commands terminal):

- `Logs/suit-welded-gloves-full-build.log`: complete generation.
- `Logs/suit-welded-gloves-stress-render.log`: sixty current, hash-matched views
  with hands included. All fingertip exposures are gone. Eleven variants have
  zero bare rays; male-large hazmat has **12 rear crotch rays** (14 pink pixels),
  around x = +/-0.001 m, z = 0.792–0.802 m, source faces 2944/5929. This is not
  a glove regression; the previous fourteen-pixel result was obscured by the
  helper-inclusive depth check. It still requires a garment repair.
  `Logs/suit-render-helper-occlusion.log` repeats the exact twelve current pixel
  rays against both archived `2-be760740` and current GLB bytes: each exposes
  all twelve without helpers and incorrectly reports zero with the display
  sphere included. This directly confirms the earlier measurement error.
- All ten versioned contact sheets were generated with hash/pose/log checks;
  front/back sheets for both suits were inspected. Hair protrudes above the
  hazmat hood in these renders. `RoaCharacterView` currently hides hair only for
  the helmet slot; inspect and correct the loaded hood/hair lifecycle before
  claiming an in-game hood fit. Do not hide the base skin to mask coverage.
- `Logs/suit-welded-gloves-coverage.log`: 60 boot configurations and the original
  3,854,700 rest samples, **20 failures**, all at two symmetric male-large armpit
  points for each suit/boot choice. Ten of twelve variants pass. Male-large
  rays first enter another body surface about 45 mm away, unlike the female
  case; the normal correction deliberately does not waive them. The nearest
  finished garment boundary is about 40 mm away. See the archived ray-path
  diagnostic in `Logs/suit-male-armpit-boundary.log`.
- Surface metrics, two-pose endpoint simplification, world-space binding,
  enclosure/mask/helper and six-body glove-seam fixtures pass. Compile-check
  passes with existing warnings (`Logs/suit-seam-compile.log`); Unity parity
  passes. `Logs/suit-seam-full-check.log` still fails at the unrelated retired
  `tutorialCaravanYard.json: yard_cover_a` reference; no map work was changed.

No native Unity candidate probe, promotion or WebGL build was performed.
Unity processes observed during generation were not launched or controlled by
this work. The next work is the real rear crotch seam, male-large armpit
diagnosis and hood/hair presentation, followed by actual Unity animations.

## Source repairs, 2026-09-12

The complete `2-29eeba17` baseline and its coverage/visibility evidence are
archived in `unity-client/Logs/SuitWeldedGloveProof-2-29eeba17/`. Public/runtime
suits remain `2-9e8c2a4e`; the following source repairs are not a promotion.

- Trousers now preserve the donor's left/right leg ownership before fitting,
  through subdivision and final body-surface skin transfer. Previously 131
  male-large vertices crossed the centreline and were fitted/bound to the wrong
  leg. The first trial `2-70673e7c` had zero bare rays in five bent-arm views,
  but was superseded and is not evidence for later GLB bytes. The crossed-leg,
  unchanged-rest and opposite-leg-motion regression passes.
- The failed all-body build was rejected by the pre-export mesh gate. QEM's
  closed-tetrahedron duplicate-face case was already fixed; stage diagnostics
  then found a separate problem: neighbouring fitted cloth polygons could
  tessellate into exact opposite duplicate triangles. Their double-sided
  same-material coverage is now explicitly deduplicated before LOD reference
  measurement. Vertex positions/weights and the geometric surface are retained;
  differing/one-sided materials are rejected. Export is still forbidden from
  silently repairing topology. See `suit-female-triangle-validation.log` and
  `suit-duplicate-surface-regression.log` in `unity-client/Logs/`.
- Glove filling also concealed tiny slit defects behind duplicate triangles.
  Welding matching nonadjacent slit corners now precedes hole filling, rather
  than following it. The unchanged 0.2 mm limit and same-dominant-bone rule
  apply. All six body fixtures now verify the inflated, triangulated final
  glove: zero duplicates, zero unsealed hand-owned edges, preserved forearm
  boundaries and untouched base-body files. The source weld counts are
  female 16/14/14 and male 12/12/12; the maximum is 0.1984 mm. These replace
  the earlier post-fill-only counts. See `suit-prefill-glove-seams.log`.
- The male-large failing armpit ray actually exits the body at x=0.306 m,
  between the old shoulder insert ending at 0.294 m and elbow insert starting
  at 0.358 m. Shoulder/elbow selection now overlaps by at least 20 mm, with
  donor removal inset from the textile boundaries. The all-six-body span test
  includes that exact body-ray exit and passes. The original dense coverage
  sampling and body-only normal policy are unchanged.
- Unity source now derives hair coverage from a successfully loaded helmet or
  hazmat hood on the current character, and re-applies it after appearance,
  equipment-load and visibility changes. The editor probe checks these
  lifecycles. Compilation and parity pass, but the new hood behaviour has not
  been tested in native Unity; Blender previews still retain their own hair
  presentation and are not proof of that C# fix.

Current logs use the `unity-client/Logs/suit-continuous-sleeves-` prefix.
World binding, source-leg ownership, enclosure/helper and source-glove fixtures
pass; the later pre-fill glove fixture above is the current closure proof.
Compile-check passes with existing warnings; Unity parity passes (79 items,
48 recipes). The full npm check again fails at the unrelated retired collider
`tutorialCaravanYard.json: yard_cover_a`; no location data was changed here.
The first full generation stopped after three female variants when the new
glove guard exposed a male-slim slit; `clean-build.log` is the subsequent
all-body attempt. It needs a complete manifest, fresh file/coverage checks and
new hash-matched views before any readiness claim.

That complete attempt succeeded as `2-ec921afb`: all 12 file audits and all 24
immutable host aliases passed, without exporter repair. Hazmat variants have
11,979-11,980 triangles; energy variants 11,250-11,735. The complete catalog and
reports are archived in `Logs/SuitContinuousSleeveProof-2-ec921afb/` under the
Unity project. All 60 hand-inclusive bent-arm views have zero bare rays and
zero magenta pixels; the hazmat rear and energy front contact sheets were
inspected. The rear trouser defect and prior fingertip exposures are absent.
Blender still displays hair above the hood; it does not implement Unity's new
loaded-hood hair policy.

Dense coverage for these exact bytes is **not passed**: all six energy and
three male hazmat variants pass, but female hazmat slim/medium/large have
10/10/6 failed samples per boot choice (130 total). The original 20 male armpit
failures are gone. The new failures are real source creases, not grounds to
weaken sampling: each female body has two narrow five-edge openings under its
upper arms. The widened insert copied them and the older donor textile had
previously covered them. `suit-continuous-female-underarm.log` records the
original source boundaries and the finished liner edges about 8 mm below them.

`seal_upperarm_slits` now closes only those narrow, fully arm-owned internal
loops on a garment copy, before inflation. The six-body fixture passes: two
slits/six triangles added per female body, no male changes, no moved corners,
no other boundaries changed and no duplicate caps. This source repair is newer
than `2-ec921afb` and needs a new candidate build, dense coverage and renders.
The first female-slim hazmat trial is `2-faa78557`, archived in
`Logs/SuitSealedUnderarmTrial-2-faa78557/`: all 324,150 rest samples across five
boot choices pass, and all five hand-inclusive bent-arm views have zero bare
rays/magenta pixels. `suit-sealed-underarm-trial-coverage.log` and
`suit-sealed-underarm-trial-render.log` are the provenance. The subsequent
complete build is `suit-sealed-upperarm-full-build.log`; do not treat the
single-body trial as full-catalog approval.

The current local WebGL receipt is newer than the earlier September 9 build:
it finished on September 12 at 15:05 UTC and still references public suit
`2-9e8c2a4e`. Its receipt reports `Succeeded` with 600 errors; it is not visual
approval. `suit-current-webgl-receipt-check.log` fails the current-source hash
check (`9f306f47...` in the receipt versus `ba390911...` now), so the current
browser player cannot be claimed to contain the later hood/hair changes.

## Current complete candidate: `2-70e2ace8`

The subsequent all-body build and all of its verification processes completed.
The proof archive is `unity-client/Logs/SuitSealedUpperarmProof-2-70e2ace8/`:
12 GLBs, manifest, coverage report, all twelve visibility reports, all sixty
full-size PNGs, and build/file/host/coverage/render logs. The ordinary working
candidate directory also contains this complete version, not a partial trial.

- File and immutable-host audits pass: 12 exact model hashes, 65-bone skins,
  normalized weights, three mesh layers and 24 correct original/lite aliases.
  The aliases are review serving, not a production models-lite optimization.
- All **3,854,700** rest samples across 60 suit/body/boot combinations pass:
  zero uncovered samples, with the unchanged full-body boundary sampling.
- All **60** hand-inclusive bent-arm views match the current model hashes:
  zero bare rays and zero magenta pixels in every view. Both suits' six-body
  front and rear contact sheets were inspected. No residual trouser/fingertip
  exposure is visible in these views; source armpit creases are now closed.
- Hazmat variants contain 11,979-11,980 triangles; energy variants contain
  11,256-11,735, all below the 12,000 limit. No exporter mesh repair was needed.
- Surface/dedup, articulated LOD, leg/world binding, span, enclosure/helper,
  pre-fill glove closure and six-body upper-arm slit fixtures pass.

Logs have the `suit-sealed-upperarm-` prefix. Versioned contact sheets are
`suit-sheet-2-70e2ace8-arms-bent-hands-{itemId}-{view}.png` in Unity Logs.
This is Blender geometry/pose evidence, **not native Unity animation approval**.
Hair remains visible over the hazmat hood in Blender; the separate Unity hair
lifecycle change is compiled but has not been exercised in a native probe.
No native Unity launch, public promotion, utility regeneration or WebGL build
was performed in this repair turn. Public suits remain `2-9e8c2a4e`.

## Still required

1. Run the extended Unity candidate probe against these exact immutable GLBs.
   Inspect walking, attack/live reload and death at desktop and mobile sizes;
   confirm wrist gaskets/attachments stay assembled and the loaded-hood hair
   lifecycle works. A loading PASS alone is insufficient.
2. After native visual approval, promote exact reviewed bytes with
   `npm run build:layered-suits -- --promote-candidate`, synchronize models-lite
   and the Unity cache fingerprint, and regenerate all dependent worn utilities.
   Default generation now builds isolated upper-fitted candidates only; direct
   old public generation is refused. See the promotion checkpoint below.
3. Run compile-check, model checks, the relevant Unity runtime probes and Unity
   parity against final public bytes and regenerated utilities. Preserve the
   unrelated tutorial-map work and rerun the full suite; its earlier retired-map
   blocker was fixed by other work, which does not by itself prove a full PASS.
4. Build a fresh local WebGL client and verify the actual browser build at
   desktop and mobile-landscape sizes, including code/catalog fingerprints.
   Old source/Play checks do not prove the browser player was updated.

Any further geometry edits invalidate the current proof. Rebuild all twelve
variants and refresh matching coverage/views; partial trials rewrite the
working manifest to their subset even when older GLBs remain beside it.

## Reviewed-byte promotion workflow (candidate still `2-70e2ace8`)

`tools/layered-suit-promotion.js` checks all twelve model hashes, all sixty
full-surface coverage combinations, hand-inclusive bent-arm view metadata,
source/body/retained-reference hashes, and the exact native candidate run. Native
evidence must cover all six bodies, boot swaps, walking/attack/death, live reload,
visibility/restoration and loaded-hood hair. The probe now records matching
client-source fingerprints at start and finish; promotion rejects changed code.
The operator must still inspect native captures and observe successful scene
restoration and process completion. The automated gate is not artistic approval.

Promotion copies the reviewed bytes without regeneration, backs up all 26
public/lite/cache targets under `Logs/SuitPromotionBackup-<uuid>`, then runs the
existing targeted optimizer, cache synchronization and public file checker.
Failures restore previous bytes; concurrent edits before application are
rejected. No transaction has been applied to the real public assets yet.

The temporary-project regression fixture passes exact-copy, stale/incomplete
evidence rejection, changed client code, path protection, pre-apply concurrent
edits, rollback and commit. It is included in `npm run check:layered-suits` and
cannot create a report or approval in the real Unity project.

Current read-only refusal check confirms the real native report `2-2a885f6c`
is rejected for `2-70e2ace8`, with all 26 public/lite/cache hashes unchanged.
Candidate and public file audits, all 24 immutable candidate-host aliases,
`compile-check.ps1` (existing warnings) and `check:unity-parity` pass. Logs:
`suit-promotion-current-checks.log`, `suit-promotion-current-compile.log`,
`suit-promotion-current-parity.log`. No native run, promotion, worn-utility
regeneration or browser build has occurred at this checkpoint. The previous
native-launch rejection still requires fresh user authorization before retrying.

The new full suite run (`suit-promotion-full-check.log`, exit 1) gets past the
retired-map check but stops at `check-unity-model-prefabs.js`: 524 canonical GLBs
exist while its historical expected count and generated prefab tree are 141.
Read-only inventory identifies all 383 missing editor prefab counterparts as
the added catalogs: 23 items, 60 free equipment, 12 layered suits and 288 worn
utilities. Their direct runtime loading is a different path; prefab absence
does not prove a runtime download failed. Complete the native prefab generator
and catalog probe after final model promotion, preserving existing scene assets.
At discovery, the Node checker pinned 141 and the native catalog probe pinned
202. These stale expectations are replaced in the follow-up below; changing
them is not proof that the missing native assets were generated.

## Native catalog preparation — exact inventory, no regeneration yet

The Node prefab checker now requires one correctly named counterpart per
canonical GLB, rejects extras and case-colliding duplicates, and retains every
metadata/GUID/dependency/import-settings check. It no longer caps valid catalog
growth at a historical total. The pure inventory fixtures cover 524 and 525
complete entries, reject the real 141-entry/383-missing shape, the previous
202-entry shape, equal-count wrong paths, extras, duplicates and empty input.

`RoaModelPrefabGenerator.ValidateSourceInventory` compares Unity's imported
paths with all actual canonical files before generation and before cleanup.
Both generator and native probe use this guard; the native probe additionally
requires exact generated prefab paths. The generator now rejects failed saves,
incomplete imports and partial runtime entries before deleting stale prefabs or
replacing the runtime catalog. Successfully saved individual prefab updates
are not rolled back on later failures; this is not a whole-catalog transaction.

`check:unity-model-prefab-inventory`, compilation (existing warnings) and Unity
parity pass. The real narrow prefab audit still correctly FAILS: 524 canonical
GLBs, 141 prefabs, 383 missing and zero unexpected counterparts. Logs are
`prefab-inventory-current-check.log`, `prefab-inventory-compile.log` and
`prefab-inventory-parity.log`. Native generator/probe execution remains pending
launch authorization. No prefab, model, scene or browser build was regenerated.

The exact C# `ValidateSourceInventory` method was also extracted and compiled in
a read-only .NET harness, with only `Application.dataPath` supplied by a stub.
It accepts all 524 actual canonical paths and rejects missing (523), equal-count
wrong-path (524) and duplicated (525) imported inventories. The initial harness
array construction flattened test cases incorrectly; corrected named cases
pass without changing the C# implementation. This tests inventory logic only,
not Unity imports, prefab generation or runtime model appearance.

The subsequent full npm run (`prefab-inventory-full-check.log`, exit 1) confirms
the same actual unresolved catalog gap: 383 missing prefab counterparts. It
passes the retired-map check and reaches the stricter exact-path check; no
failure is waived. Once launch is authorized, the remaining order is native
candidate validation, suit promotion and utility refresh, catalog generation
and public native probes, then final WebGL verification as documented above.

## Authorized retry — execution environment still rejects Unity

The user explicitly authorized the local Unity retry. Candidate file checks
again passed for `2-70e2ace8`; an own loopback-only immutable asset host started
successfully (attempt `suit-authorized-1789231352524`). The subsequent Unity
launch command was rejected before execution with `blocked by policy`.
Read-only verification found zero Unity processes and no log for that launch.
The host was stopped after checking its exact PID, executable name and start
time. No native probe, public promotion, prefab regeneration or browser build
occurred; the last native report remains for `2-2a885f6c`.

User authorization is now present: do not ask for the same confirmation again
as if it were missing. The outstanding blocker is the execution environment's
policy rejecting Unity launch. Do not use an alternate launch path to bypass
that restriction or treat the earlier native report as current approval.

## 2026-09-12: existing-editor integration checkpoint

The user independently opened Unity. Its existing project-command gate was
used without launching another editor, modifying the gate, or weakening any
execution permission. Native generation and catalog validation now pass for
all 524 GLBs/prefab counterparts; the previous 383-entry gap is closed.

Native candidate run `ee74a88739364fe6a5ae8448506554c5` loaded `2-70e2ace8` but
showed retained energy-shoulder attachments separating during motion. The
frame-bound snapshot measured approximately 36 mm growth from a 2–3 mm rest
gap. `refit_suit_details.py` now transfers attachment weights from fitted cloth,
preserving anatomical head binding. Complete regenerated `2-2392c3f1` passes
all 3,854,700 rest samples and 60 hand-inclusive bent-arm views. The native
attachment regression rejects the old frames and passes the new frames with
growth under 16 mm. Residual decorative cloth/trim intersections remain visible
in close-up stress poses; this is not a flawless artistic-fit claim.

Sequential native runs exposed stale imported Unity objects when domain reload
is disabled. All shared GLB-loader caches now release previous-session imports
at SubsystemRegistration. Complete runs `2c34f698c5454885aeb148ca4927a95f` and
`eb0d9f0de8fb4006bd94384de93c1500` pass consecutively without a domain/script
reload between them and restore the original scene. The PS/C# compile check
now references Unity.Scripting for that lifecycle attribute.

Exact reviewed bytes were promoted to public suits `2-2392c3f1`; the recoverable
backup is `Logs/SuitPromotionBackup-534cdecf-b5da-494d-9f63-2cca27bc1b36`.
All 288 dependent utilities were rebuilt as `1-75bbf530`. File/lite/provenance,
suit fitting, compilation and parity checks pass. The first full npm run now
passes the prefab audit but fails an unrelated movement fixture because its
VM context lacks `isArtifactStunned`. Final full-suite/public/browser results
are tracked in [integration status](../../ITEM_MODEL_INTEGRATION.md).

Final public run `a9a5f55834254ae0903e88e6e060129a` passed. A fresh WebGL build
completed at 18:44 UTC with matching source/catalog fingerprints. The actual
browser player was inspected at 1440×900 and 960×540: new pistol/rifle/assault
rifle, reload action and medical case work without browser console errors.
The build still logs 600 missing environment-prefab errors in unrelated
authored scenes, and the repeated full npm suite stops at the same movement
fixture; neither is presented as a clean whole-project result. No production
deployment occurred. The read-only example remains on loopback port 3003;
the original gameplay port 3000 and temporary candidate port are released.
