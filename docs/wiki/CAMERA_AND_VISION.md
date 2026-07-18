# Камера, обзор и fog-of-war

## Единая функция видимости

Главный источник видимости для всей игры:

```js
isPointVisibleForGameplay(worldX, worldZ, options)
```

Эта функция используется для:

- крыши торговца;
- NPC;
- других игроков;
- врагов;
- лута;
- интерактивных объектов;
- совместимого alias `isWorldPointVisibleByRtsFog()`.

Здание торговца не должно иметь отдельную indoor-систему обзора. В помещении и вне помещения применяется один perception/fog-of-war бюджет и одна логика line-of-sight.

## Крыша и видимость

Крыша торговца не решает сама, что видно внутри здания. Каждый логический квадрат крыши совпадает с мировой `TILE`-ячейкой fog-of-war. Его центр переводится в world-координаты и спрашивает `isPointVisibleForGameplay()`. У крыши нет своей более мелкой сетки обзора.

- Если точка крыши в тумане войны — квадрат крыши непрозрачный.
- Если точка крыши в зоне обзора — квадрат крыши почти прозрачный.
- Геометрия крыши не удаляется, не двигается и не масштабируется.
- Маска крыши использует nearest-фильтрацию и world-tile bounds, поэтому прозрачность меняется теми же клетками, что и основная игровая видимость.

## Что скрывает fog-of-war

Fog-of-war скрывает динамические и интерактивные сущности:

- NPC;
- других игроков;
- врагов;
- лут;
- контейнеры и интерактивные предметы.

Статическое окружение под крышей не скрывается отдельной логикой. Его закрывает сама непрозрачная крыша, пока соответствующие квадраты не попали в обзор.

## Инициализация

`rtsFog` и `rtsFogVisibilityVersion` объявляются на этапе bootstrap до создания мира и крыши. Это позволяет безопасно вызывать `isPointVisibleForGameplay()` даже во время ранней сборки локации.


## v7.74.95: tile-sized trader building blocks

The trader building shell is now rebuilt on the same `TILE` grid used by gameplay visibility. Wall visuals, wall collision, roof-mask cells and LOS blockers use matching 2m modules. The roof remains a simple two-slope shell; no separate ridge mesh is used. Static interior props remain rendered under the roof while dynamic/interactable objects use `isPointVisibleForGameplay()`.


## v7.74.96: square wall blocks and transparent window LOS

Trader wall modules now use a square `TILE x TILE` footprint in top-down space, not a thin wall strip. Collision follows the same square block footprint. Window cells remain physical wall/window modules for movement, but they are excluded from `traderBuildingVisionWalls()` so windows do not block the single gameplay visibility function. The roof mask, NPCs, players, loot and interactable objects continue to ask `isPointVisibleForGameplay()`.

## Trader building grid visibility v7.74.97

The trader building uses one gameplay visibility source for everything: `isPointVisibleForGameplay(worldX, worldZ, options)`. The building footprint is now exactly **10 × 8 world tiles**. Wall modules, collision, roof transparency mask and LOS blockers all use full `TILE × TILE` squares. Windows are physical window/wall modules for movement collision, but they are intentionally excluded from LOS blockers, so they never block vision. The roof mask samples the same world-tile centers as normal fog-of-war; no separate indoor visibility grid is used.

## Trader grid alignment v7.74.98

The trader building perimeter is snapped to the main world tile grid with no half-tile offsets. The footprint is still 10 x 8 tiles, but wall cells now occupy exact tile centers inside that footprint: front/back rows use 10 cells each, side rows use the inner 6 cells, and the four corner cells belong to the front/back rows. Windows remain transparent for LOS.

## Trader wall transparency v7.74.99

Trader wall blocks now fade per block when the player is behind them relative to the camera. This uses the same world grid alignment as the building shell. Windows still do not block LOS. The fade is visual only and does not change collision or gameplay visibility.

## Trader wall fade fix v7.75.00

Fixed the wall fade runtime call so it uses the existing `traderBuildingWorldToLocal()` helper. Wall block fading remains visual-only: it does not change collision or line-of-sight rules.

## Trader occluder fade v7.75.01

Trader wall fade opacity is doubled (faded blocks are now about twice as transparent). The same occluder fade rule now also applies to trader interior objects such as shelves, crates, counters and similar meshes, both from inside and outside the building, while floors remain fully visible.

## Trader roof exterior fade v7.75.02

When the player is outside the trader building, roof transparency now follows the same camera-occluder mechanic as the wall fade instead of the gameplay-visibility mask. Indoors, roof cells still use the main gameplay visibility. This keeps outside roof fade localized around the player/camera overlap, matching wall behavior.

## Screen-space occluder fade v7.75.03

Trader roof, wall and interior-object fading now uses screen-space overlap with the player. An object fades only when it is between the camera and the player and its projected position overlaps the player on screen. Nearby building parts that do not visually cover the player remain opaque.

## Occluder sample fade v7.75.04

Wall blocks, roof cells and trader interior objects now use multi-sample screen-space overlap instead of a single center point. Large roof strips and chunky wall blocks fade whenever any meaningful part of the occluder actually covers the player on screen, both inside and outside the building.

## Raycast occluder fade v7.75.05

Trader roof, wall and interior-object fading now uses a strict camera-to-player ray intersection against the real bounding volume. Objects no longer fade merely because they are near the player or in a wide screen corridor; they fade only when the camera ray to the player passes through their volume before reaching the player.

## Vision-area occluder fade v7.75.06

Trader roof, wall and interior-object fading now follows the character's gameplay vision area instead of only the camera-to-player ray. If a roof cell, wall-back sample, or static interior object covers an area that `isPointVisibleForGameplay()` says the character can see, that visual occluder fades so the player can see the same information.

## Vision shell fixes v7.75.07

Fixed three issues in trader building visibility: NPCs are excluded from occluder fading, roof cells can also fade from outside via the exterior supplement, and wall/roof visibility sampling now covers corners and partial edge cells more robustly so corner wall blocks and roof fragments react with the same gameplay-vision logic.

## Exterior full vision shell v7.75.08

Outside the trader building, the roof and wall-shell fade now use the full character perception radius, not only the camera ray or a local near-player patch. This makes exterior roof cutaway cover the whole area the character can perceive around the building while keeping NPCs excluded from transparency fading.

## Fog-free shell v7.75.09

Outside the trader building, roof and wall shell transparency now follows the true fog-of-war free area via the shared gameplay visibility function, instead of using the raw perception radius. A shell fragment opens only if the underlying area is actually unfogged for the character.

## Visible-tiles shell v7.75.10

Trader roof, wall-shell and static interior occluder fading now uses the exact fog-of-war visible tile set (`rtsFog.visibleTiles`). This matches the floor overlay: if the area is free from fog, the building shell may fade; if the tile is still fogged, it remains opaque. This avoids the extra `hasStrictTileLineOfSight()` check from `isPointVisibleForGameplay()` hiding roof/wall parts over already-unfogged tiles.

## Fog-version shell refresh v7.75.11

Trader roof/wall shell alpha now refreshes whenever `rtsFogVisibilityVersion` changes. The shell no longer has a second distance/context gate that can keep visible floor tiles covered, and wall transparency is updated even when the roof mask itself is not rebuilt.

## Roof cutaway margin v7.75.12

Roof alpha now uses a one-tile fog-free margin around visible floor cells because the sloped roof visually overlaps neighbouring tiles. This prevents roof strips from covering areas that are already free from fog-of-war. Open roof opacity was also reduced so transparent roof cells no longer obscure gameplay information.

## Floor fog overlay fix v7.75.13

Fog-of-war tile overlay is raised above the trader building floor mesh, so fog squares remain visible on interior floor tiles. The trader block floor is also forced to be opaque, depth-writing and non-culled to prevent intermittent floor disappearance while roof/wall shell alpha updates.

## Readable floor grid v7.75.14

The trader building floor now uses a brighter dedicated material and an explicit tile grid overlay, so floor cells remain readable under the roof/fog shell. The fog overlay height over the building floor was raised to avoid z-fighting with the floor and grid layers.

## Wood floor no-grid v7.75.15

Removed the separate trader floor grid overlay. The trader floor uses the existing wood texture again, with a slightly lighter material tint and stable opaque/depth-writing settings. Fog-of-war remains the only grid overlay.

## Shell-only occlusion v7.75.16

Trader interior objects no longer fade or hide as part of the cutaway system. Only the building shell itself — roof cells and wall blocks — participates in transparency, while counters, shelves, crates and other interior props remain fully visible.

## Window and interior low cover v7.75.17

Trader windows and low-height interior props now behave like low cover (rocks/ore): they do not become part of shell transparency, but they can block crouched fog-of-war rays and crouched ballistic/vision checks. Tall interior pieces are excluded, so only objects that do not fully block height are treated as cover.

## Flat roof fog cells v7.75.18

Trader roof is now a single flat plane aligned to the building footprint and fog-of-war tile grid. The old two-slope roof halves and ridge overlap are removed. Roof cutaway no longer uses the one-tile expanded margin: a roof cell becomes transparent only when its own area maps to fog-free `rtsFog.visibleTiles`.

## Roof screen overlap v7.75.19

Flat roof cutaway now has a screen-projection check: a roof cell becomes transparent if its projected screen area covers a ground point whose tile is already free from fog-of-war. This keeps exact fog-cell logic but also removes roof fragments that visually obstruct visible gameplay cells from the current camera angle.

## Wall fog-behind cells v7.75.20

Wall transparency now uses only the fog-of-war state of sampled cells behind the wall. The old camera-to-player occlusion fallback was removed for walls, so a wall stays opaque if the space behind it is still fogged and fades only when that behind-wall area is already in `rtsFog.visibleTiles`. Interior props remain fully visible and are not part of shell transparency.

## Strict wall behind fog v7.75.21

Wall transparency now samples only the concrete cell behind each wall block relative to the player. It no longer samples the wall cell itself, the player/camera side, neighbouring wide areas, or fallback camera occlusion. If the behind-cell is fogged, the wall remains opaque; if that behind-cell is in `rtsFog.visibleTiles`, the wall fades.

## Wall screen overlap v7.75.22

Wall cutaway now uses two checks: the wall fades when its behind-wall cell is in `rtsFog.visibleTiles`, and also when the wall's current screen projection covers a fog-free ground cell from the camera angle. This prevents walls from blocking the user's camera view of cells already visible to the character.

## Wall base stable v7.75.23

The bottom row of trader wall blocks is treated as a stable plinth/foundation and no longer participates in wall cutaway transparency. Upper wall rows still fade when their behind-cell or screen projection covers fog-free ground. This prevents the low base strip from disappearing even though it does not meaningfully block the camera view.

## Conditional wall base cutaway v7.75.24

The lower wall row is no longer excluded from cutaway. It uses a stricter projection test: only the upper lip of the base is sampled, and projection onto the player-side ground is ignored. The base fades only when it actually blocks a fog-free cell behind/through the wall, while accidental floor contact no longer hides it.

## Wall base screen bounds v7.75.25

Lower wall blocks now use a reverse screen-overlap test against nearby fog-free floor tiles. Instead of relying only on projecting the block lip down to the floor, the visible floor tile is projected to screen and compared against the wall block silhouette. This keeps the plinth stable when it only touches the foreground floor, but fades it when it actually covers a visible cell behind the wall.

## Wall floor-ray occlusion v7.75.26

Wall base fading now uses a direct camera-to-floor ray test. For each fog-free floor tile behind a wall block, the cutaway checks whether the camera ray to that visible floor point intersects the wall block first. This makes lower wall blocks fade only when they really hide visible floor cells, while still keeping them solid when they only touch the near-side floor.

## Floor-surface occlusion v7.75.27

Wall/base occlusion rays now target the real floor surface instead of the raised fog-of-war visual overlay. The overlay remains slightly above the floor only for rendering and uses polygon offset to avoid z-fighting. This prevents lower wall blocks from missing occlusion checks because the target point was artificially too high.

## Wall base visible-floor ray v7.75.28

Lower wall blocks now use camera rays to nearby fog-free floor tiles on either side of the wall. This fixes base blocks that visually cover player-visible floor on the camera side while the previous behind-wall-only filter kept them opaque. Upper wall blocks still use strict behind-wall fog-free logic.

## Wall base follows column v7.75.29

Bottom wall blocks no longer decide cutaway independently from the rest of the wall. A bottom block now follows the cutaway state of the same wall column when the upper blocks hide visible floor/interior cells, with its own floor-ray test kept only as a fallback. This avoids treating the base as a separate floor/shadow strip while still allowing it to hide when the wall column obstructs view.

## One-meter building block rule v7.75.30

Trader building construction now follows a fixed scale rule: one visible construction block is 1 x 1 x 1 meter and the building height is 4 meters. The 20 x 16 m trader footprint is rebuilt from one-meter wall cubes; windows are 2 x 2 m openings and the front door is 2 x 3 m. Wall cutaway no longer has a special lower-row rule because every wall cube has the same 1 m height. Collision and LOS wall blockers are aligned to the same one-meter grid.

## Camera ray wall cutaway v7.75.31

Wall cutaway now follows the 1 x 1 x 1 m block rule directly: fog-free floor cells are the source of truth. For each visible floor cell near the trader building, the camera casts rays to the actual floor surface; any wall block intersected before the floor point becomes transparent. Blocks no longer decide visibility from their own local behind-cell guesses, and there is no separate lower-row rule.

## Two-meter block rule v7.75.32

Building shell blocks now use the project rule `2 x 2 x 1 meters`: 2 meters wide, 2 meters deep, 1 meter high. Trader building height remains 4 meters, so walls have 4 vertical rows. Windows are one block wide and two rows high; the front door is two blocks wide and three rows high. LOS/collision wall blockers use the same 2 x 2 meter footprint.

## Brick wall 3m rule v7.75.33

Trader building walls now use the project rule `2 x 2 x 1 meters` with a total shell height of `3 meters`. Wall blocks use brick materials only. Roof cutaway sits directly on top of the third wall row. Windows are inset into the wall opening, and trader wall collision footprints use the same 2 x 2 meter layout with door/window openings preserved. Brick texture placement is normalized to about 0.6 m horizontal brick length.

## Roof shader fix v7.75.34

Roof cutaway shader no longer injects a custom vertex varying. The mask is sampled from normalized roof UVs instead, preventing WebGL shader compilation failures on WebGL2/GLSL300 while preserving fog-of-war roof alpha.

## Roof and brick stability v7.75.35

Roof cutaway shader uses local roof coordinates for the mask and keeps texture UVs independent, preventing shader compile failures and wrong mask sampling. Trader wall brick faces now use procedural ready-to-render canvas textures, avoiding cloned async textures with undefined images while preserving the 60 cm brick length rule.

## Open door / no interior v7.75.36

Trader building now keeps a simple open doorway with no door leaf meshes, no interior furniture, and no building light fixtures. Settlement extra lamp and trader backdrop dead trees are removed. Window openings no longer act as passable holes: collision is restored on all window wall cells, while the front doorway remains the only walking opening.

## Wall ballistics and window cutaway v7.75.37

Static wall/window collision boxes now also block ballistic rays and combat line-of-sight. Window glass and frames are registered as wall cutaway blocks, so they fade when they occlude fog-free visible floor just like wall blocks. Player weapon visuals pull back near static wall collision to prevent the weapon model from clipping into walls.

## Close wall FX and collision v7.75.38

Window glass remains semi-transparent at rest while still fading with wall cutaway. Player movement keeps a larger clearance from static wall collision so the character model no longer sinks into wall textures. Shot effects are clipped against static non-shoot-through collision; when a shot starts too close to a wall, no sideways tracer/flame is drawn past the obstacle.

## Clean building entrance v7.75.39

Removed the front entrance porch/mat, step strip, and trader building sign meshes. The front doorway stays as a clean open wall opening with no door model and no extra entrance dressing.

## Window occluder anchor v7.75.40

Window openings no longer register every glass/frame piece as a separate wall block. Each window now uses one clean occluder anchor matching the opening, and that anchor drives cutaway opacity for the linked glass and frame meshes. This makes window openings behave like ordinary wall blocks instead of several overlapping pseudo-walls.

## Glass wall window blocks v7.75.41

Window openings now use the exact same cutaway logic as ordinary wall blocks. Instead of a separate window occluder anchor and linked frame pieces, each window cell is built directly as 2 x 2 x 1 meter glass wall blocks on the same wall rows, with always-translucent glass material. This makes windows behave exactly like wall blocks for visibility and cutaway.

## Glass behind roof fix v7.75.42

Always-translucent window glass now renders below the roof cutaway layer instead of above it. Glass wall blocks keep depth testing enabled, stay transparent, and use a lower render order than the roof, so they no longer show through the roof surface.

## Close blocked shot FX v7.75.43

When a shot is blocked by a non-shoot-through static object closer than 0.82 m, no tracer/flame line is drawn and no long shoot FX packet is sent. The weapon still recoils and may show a small muzzle flash. This prevents short close-range blocked shots from drawing diagonal sideways effects from an offset muzzle to a wall impact point.

## Centered shot FX axis v7.75.44

Shot visuals no longer draw the tracer from the laterally offset weapon muzzle to the hit point. The gameplay ray now owns the visual axis: tracer/flame start and end points are projected onto the same centered shot ray, while the muzzle is used only for height and local flash. Multiplayer shot packets carry origin, direction and end distance so remote shot FX use the same stable axis.

## Muzzle parallel shot FX v7.75.45

Shot effects now start at the actual muzzle point, but their direction is parallel to the gameplay shot axis. The tracer no longer starts from the character centre and no longer draws a sideways diagonal from an offset muzzle to a centre-line wall hit. Remote player shot FX uses the same rule.

## No model stroke textures v7.75.46

Procedural noise materials used on models no longer draw dark bezier stroke/hatching overlays. The texture generator now allows a true zero stroke alpha, and character/prop materials that used leather, cloth, enemy hide, leaves, and dark metal disable model strokes. Ground/detail textures keep their normal environmental grain.

## Flat noise-free textures v7.75.47

Global procedural noise was disabled at the source. `makeNoiseTexture()` now generates flat color textures instead of grain, specks, or hatch lines, so terrain, props, player materials, enemy materials, and other procedural surfaces render without noise across the whole game.

## Ground border backplate v7.75.48

Stage 1 of the empty-map-corner cleanup: the wasteland backplate now extends far beyond the playable grid, especially in the settlement, so the camera no longer reveals plain scene background in diagonal corners. This is a cheap decorative-only ground extension; edge dressing and atmosphere can be added in later stages.

## Edge buffer dressing v7.75.49

Stage 2 of the empty-map-corner cleanup: the settlement now adds a sparse non-playable edge buffer on top of the enlarged backplate. Outside the playable grid, broad sand/crack layers, pebble clusters, dry grass tufts, and occasional scrap are spawned around the map perimeter so diagonal corners read as surrounding wasteland instead of a bare cutoff.

## Sand haze border v7.75.50

Stage 3 of the trader-yard background cleanup removes the decorative edge clutter from the previous iteration. The outside-of-map filler now uses only broad sand-haze layers. These layers are cosmetic only: they sit outside the playable footprint, have no collision, do not affect fog-of-war, line-of-sight, roof cutaway or interactions, and animate only through slow UV drift plus a tiny positional sway.

## Visible sand haze v7.75.51

The edge sand haze placement bug is fixed. Haze bands now convert tile coordinates through `tileToWorld()`, so they sit at the actual map border. The effect uses visible dark edge bands plus animated light sand bands. Haze textures are generated as ready CanvasTextures instead of cloning async image textures, avoiding undefined-image texture warnings from the haze system.

## Sandstorm fog border v7.75.52

The flat ground haze bands were replaced with a fog-like sandstorm border. The map edge now uses large translucent billboard sprites placed outside the playable area. They soften the world boundary without projecting hard diagonal planes across the ground, and animate with slow drift, opacity pulsing, and scale breathing.

## No edge fog v7.75.53

The sandstorm/fog border was removed. The settlement keeps the enlarged decorative ground backplate outside the playable area, but there are no moving haze sprites, no edge fog overlays, and no decorative edge dressing.


## Effective SPECIAL derived stats v7.75.54

Character-derived stats now use effective SPECIAL values, including `SPECIAL +1` perk ranks. Agility perks therefore correctly affect max AP and movement speed through the same `derivedFromStats()` path used by base SPECIAL values.

## STAT_DEFS TDZ fix v7.75.55

Fixed early-startup TDZ crash caused by `effectiveSpecialStats()` referencing `STAT_DEFS` before the character-creation chunk completed initialization. The derived SPECIAL calculation now uses a local stable key list for early calls.

## Radial use open fix v7.75.57

The quick-use radial menu no longer depends on mobile-control mode. Mobile CSS now keeps the `Исп.` button visible in landscape mode, and desktop quickbar rendering exposes a dedicated hold-to-use radial button. Empty quick-slot state still opens a visible radial with a placeholder, so the control can be tested even before items are assigned.

## Hold E radial menu v7.75.58

Desktop quick-use radial is controlled by holding `E` instead of a separate UI button. Short `E` performs normal interact, while long `E` opens the quick item wheel at the current pointer position. Mobile radial is bound to the visible use button and includes pointer/touch fallbacks.

## Radial assign mobile fix v7.75.59

Quick access slot buttons are no longer rendered as a HUD bar. The slots remain as data for the radial menu. Desktop assignment is done from the inventory item context menu. Mobile opening uses document-level touch/pointer capture by screen coordinates of the visible `Исп.` button, following the same robust approach as the mobile remote-player interaction menu.

## Radial assign wheel mobile capture v7.75.60

Inventory item context assignment now uses one `В быстрый доступ` action that opens a radial slot picker instead of listing all 8 slots. Mobile quick-use hold detection uses a document-level coordinate capture similar to the remote-player tap menu, checking both visible `Исп.` buttons before move/aim overlays can swallow the event.

## Separate mobile radial button v7.75.61

Desktop radial use remains on E-hold. Mobile radial use now has its own `touch-radial` HUD button in the right combat cluster instead of reusing `touch-loot` or `touch-interact`. The combat buttons are explicitly positioned to avoid overlaps.

## Mobile radial tap layout v7.75.62

The mobile quick access radial is opened by tapping the dedicated lightning button, not by holding it. The right combat cluster is laid out as five non-overlapping circular buttons: target/action on the left, reload/quick access on the right, and attack in the center.

## Mobile radial clean tap v7.75.65

The mobile quick radial button now opens on tap-end rather than touchstart/pointerdown. The capture logic mirrors the remote-player interaction menu: remember a tap that starts on the button, reject drags, then open on pointerup/touchend. The radial overlay z-index is above mobile HUD buttons and the combat cluster uses one final compact CSS layout.

## Mobile radial rewrite v7.75.66

The broken mobile radial button stack was removed and replaced with a clean tap-only mobile quick access menu. The desktop E-hold radial remains unchanged; mobile now uses `touch-quick-access` and a separate `mobile-quick-access-menu` implementation.

## Stable mobile quickbar v7.75.68

The broken mobile radial button/menu was removed. Mobile devices now use the old stable quickbar slots again. The desktop E-hold radial remains unchanged.


## Mobile UI assets v7.75.70

Mobile HUD buttons now use optimized WebP assets from `/assets/ui/mobile`, rebuilt from the uploaded UI archive.


## UI clean weapon panel v7.75.71

Mobile UI icons were converted to transparent WebP assets. The old generated weapon HUD is disabled; weapon/readout information is now positioned over the imported weapon UI background. Desktop menu and fullscreen buttons also use the imported icons.
