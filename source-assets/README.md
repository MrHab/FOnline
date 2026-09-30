# Source assets

This directory contains authoring masters and visual references that are kept
in the repository but are not shipped by the production static server.

Optimized runtime derivatives belong in `public/assets/`. Do not reference
files from this directory in browser code.

Current masters:

- `wasteland/wasteland_ground_albedo_v777.png` — source for the optimized
  runtime ground WebP;
- `wasteland/trader_yard_ground_v757.png` and
  `wasteland/wasteland_ground_reference.png` — historical visual references;
- `psx-buildings/T_Buildings_Textures.png` — source atlas retained with its
  upload/license notice;
- `ground-textures/sources.json` — CC0 ground sets from Poly Haven for the zone
  ground shader: pages, authors, pinned map URLs and md5. The maps themselves are
  not stored here: `npm run build:ground-textures` downloads them into
  `Build/SourceDownloads/ground-textures` and writes the Unity textures.
