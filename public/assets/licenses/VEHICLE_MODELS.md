# Vehicle model sources

The rideable vehicles are derived from freely licensed models. The source
download is reproducible with `npm run build:vehicles`
(`tools/build-vehicle-models.js`): the downloader pins the file by SHA-256 and
keeps it under the ignored `Build/SourceDownloads` directory, and
`tools/blender/build_vehicle_models.py` turns it into the runtime GLB in
`public/assets/models/vehicles/`.

## Zsky — Creative Commons Attribution 3.0

Title: Military Motorbike  
Creator: Zsky  
Source: [Military Motorbike on Poly Pizza](https://poly.pizza/m/9SwnIlPjNv)  
License: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)  
Downloaded GLB SHA-256: `CD49EA6E852B313B6C6F6F0448F5EFDD1E464C97D2F1AE8F716046606B3ADA0E`

Used for: `vehicle_motorcycle.glb`, the «Армейский мотоцикл». Changes: the
single mesh is split into the body, the steering assembly and two wheels, the
bike is scaled to the game's 1.8 m rider, the glossy colours are replaced by
matte paint, rubber, leather and rust, and empty anchor nodes are added for the
rider's seat, grips and foot pegs.

Attribution: **“Military Motorbike” by Zsky, downloaded from Poly Pizza, licensed under Creative Commons Attribution 3.0.**
