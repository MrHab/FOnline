# Old Klim environment kit v1

This review set turns the `old-klim-caravan-yard-v1` concept into an original,
runtime-ready GLB kit for the Old Klim vertical slice.

## Contents

- Trade hall shell plus a separately loadable/hideable roof group.
- Straight, inside-corner and tapered-end slate cliff modules.
- Loading-yard canopy and a compact caravan prop.
- Three scrub clusters and three rock clusters intended for repeated placement.

All models use only PBR material factors and authored geometry. There are no
embedded or external raster textures. Source pieces are merged by material
before export: repeated scatter assets are one mesh/one material, medium props
use at most three primitives, and the hero structure uses three plus two for its
separate roof.

The authoritative location collision remains unchanged. The GLB roots declare
`realm_collision_policy=authored_location_unchanged`; these assets are visual
replacements for the vertical slice, not a new navigation layout.

## Rebuild and verify

```powershell
npm run build:old-klim-environment
npm run check:old-klim-environment
```

Set `REALM_BLENDER_EXE` or pass `--blender <path>` if Blender 4.5 is installed
outside the bundled tool-cache location. `catalog.png` shows the complete hero
structure; `cutaway.png` renders the same kit with its roof group hidden.
