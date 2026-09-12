# CC0 asset source policy for Realm of Ashes

This patch adds a local asset pipeline for the wasteland visual pass. The bundled PNG files in `public/assets/textures/cc0/` are lightweight, optimized, procedural stand-ins created for this build. They are prepared to be replaced by full downloaded CC0 packs from the sources below.

Generated wasteland environment `.glb` props have been retired. The remaining files in `public/assets/models/wasteland/` are actor models; static location presentation is authored in Unity scenes.

Allowed external sources for future imported files:

- ambientCG — CC0/public-domain PBR materials, textures, HDRIs and models.
  - https://docs.ambientcg.com/license/
  - https://ambientcg.com/view?id=Asphalt022
  - https://ambientcg.com/view?id=Ground062S
- Poly Haven — CC0 textures, HDRIs and 3D models.
  - https://polyhaven.com/license
  - https://polyhaven.com/textures/terrain
- Quaternius — CC0 low-poly 3D game assets.
  - https://quaternius.com/
- Kenney — game assets are public-domain / CC0 according to the support page.
  - https://kenney.nl/support

Do not import original Fallout/Fallout 2 assets. The project may use the same design direction: isometric post-apocalyptic wasteland, rusty metal, dry cracked ground, ruined props and heavy analog HUD, but not the original game resources.
