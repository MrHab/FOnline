# Weapon audio pilot

This pilot replaces the runtime-generated placeholders used for weapon fire,
melee contact, reloads, projectile impacts and dry fire. The compact processed
OGG files live in `unity-client/Assets/Resources/Audio/Weapons/`; full upstream
archives are deliberately not vendored.

The Unity client loads all 17 clips synchronously from `Resources` and keeps
the existing deterministic generated clips as fallbacks. Every shipped clip is
mono, 44.1 kHz Vorbis and shorter than 1.7 seconds so spatial playback and the
WebGL memory budget remain predictable.

See `manifest.json` for exact source files, hashes, transformations and runtime
mappings. See `LICENSES.md` for the required attribution and license links.
