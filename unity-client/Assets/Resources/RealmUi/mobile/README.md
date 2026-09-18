# Mobile UI assets

Touch-control icons of the Unity client. `RoaMobileControls` and `RoaMobileControlsCanvas`
load the 256x256 PNG files from `left/`, `right/` and `top/` through `Resources.Load`, by path
without extension (for example `RealmUi/mobile/right/attack`).

The `.webp` files next to them are not imported by Unity as textures and no script references
them. The weapon console art of the HUD is `RealmUi/weapon_ui.png`, one folder up.
