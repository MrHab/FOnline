# Free armor replacements v1

This review set replaces the seven runtime armor families with geometry derived from pinned free Internet sources.

- Six fitted variants are generated for every armor family.
- Every GLB uses the current 65-bone player rig.
- Every variant has a hard budget of 12,000 triangles.
- Runtime materials remain the existing Realm of Ashes B+C material sets.
- Source provenance and license data are embedded in every report and GLB.

Rebuild workflow:

1. `node tools/fetch-free-armor-sources.js`
2. Run Blender with `tools/blender/build_free_armor_replacements.py`.
3. `node tools/check-free-armor-replacements.js`
4. `node tools/build-approved-humanoid-assets.js`

License and attribution details are recorded in `public/assets/licenses/FREE_ARMOR_REPLACEMENTS.md`.
