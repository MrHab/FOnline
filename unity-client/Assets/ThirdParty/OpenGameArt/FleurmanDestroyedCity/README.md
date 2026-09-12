# Fleurman Destroyed City Assets

- Source: https://opengameart.org/content/destroyed-city-assets
- Author: Fleurman
- Published: 2017-02-26
- License: Creative Commons Zero (CC0 1.0)
- Original archive: `Destroyed_City_Assets.zip`
- Archive SHA-256: `3AEA810178FDF6235F82FC61C4569A7742E08588AE4390357EB991726F5610AC`
- Imported FBX SHA-256: `6FA9604C9B3832B3BBC3B3004BB255FC023055941BD257C63A655A0A664CBC10`

The single FBX file is copied unchanged from the source archive. It contains
three destroyed buildings, two damaged-road sections and six rubble pieces.
Iteration 03 of the outer nuclear wasteland uses selected source meshes as a
collapsed western city belt. The scenery remains beyond the playable contour,
has no enabled colliders and does not extend global-map routing.

The FBX contains material slots but no standalone colour textures. Unity imports
those slots as near-white legacy materials, so the scene authoring keeps the
source mesh hierarchy intact and remaps its six slots to project-owned URP Lit
materials: three concrete values, rusted metal, rubble rock and broken road.
