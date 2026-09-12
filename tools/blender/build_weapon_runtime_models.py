"""Build the complete Realm of Ashes runtime weapon library.

The models are authored procedurally so every shipped GLB can be reproduced
without editing binary assets by hand. Blender coordinates use +Y as the
weapon's forward axis; the glTF exporter converts that to the client's -Z axis.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree


WEAPONS = (
    ("pistol", "sidearm", "9mm pistol"),
    ("rifle", "long_gun", "hunting rifle"),
    ("assaultRifle", "long_gun", "rusty assault rifle"),
    ("machineGun", "heavy", "improvised machine gun"),
    ("laserPistol", "energy_sidearm", "laser pistol"),
    ("flamethrower", "heavy", "flamethrower"),
    ("plasmaRifle", "energy_long_gun", "plasma rifle"),
    ("shotgun", "long_gun", "pump shotgun"),
    ("rocketLauncher", "launcher", "rocket launcher"),
    ("revolver", "sidearm", "rusty revolver"),
    ("sawedOffShotgun", "sidearm", "sawed-off shotgun"),
    ("smg", "long_gun", "makeshift smg"),
    ("knife", "melee_light", "combat knife"),
    ("pickaxe", "melee_heavy", "pickaxe"),
    ("axe", "melee_heavy", "axe"),
    ("handPump", "melee_heavy", "hand pump"),
)

WEAPON_RUNTIME_SCALES = {
    "pistol": 0.34,
    "revolver": 0.36,
    "sawedOffShotgun": 0.42,
    "smg": 0.48,
    "rifle": 0.52,
    "assaultRifle": 0.52,
    "machineGun": 0.56,
    "laserPistol": 0.40,
    "flamethrower": 0.55,
    "plasmaRifle": 0.54,
    "shotgun": 0.52,
    "rocketLauncher": 0.58,
    "knife": 0.22,
    "pickaxe": 0.45,
    "axe": 0.44,
    "handPump": 0.50,
}

# Child details must follow their moving assembly, not remain on the root
# while the magazine/tank/bolt moves away. All transforms are kept in place.
PART_ATTACHMENTS = {
    "laserPistol": {"emitter_ring": "muzzle"},
    "rifle": {"bolt_knob": "bolt"},
    "machineGun": {"ammo_box_lid": "ammo_box", "ammo_box_latch": "ammo_box"},
    "smg": {"magazine_base": "magazine"},
    "flamethrower": {"pressure_gauge": "fuel_tank", "gauge_face": "pressure_gauge",
                     "fuel_valve": "fuel_tank", "pilot": "muzzle"},
}

# Retained functional details whose old mounting surface vanished with the
# procedural body. Re-seat them on the real replacement, in model space.
SURFACE_MOUNTS = {
    "laserPistol": {"rear_sight": "pilot_laser_pistol_cc0"},
    "plasmaRifle": {"rear_sight": "pilot_plasma_rifle_cc0"},
    "rocketLauncher": {"sight": "launcher_tube"},
    "flamethrower": {"pressure_gauge": "fuel_tank", "fuel_valve": "fuel_tank"},
}

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]

# One CC0 donor per gameplay family is enough for the first fit pass. The
# complete upstream packs stay out of the repository until the representatives
# have passed the in-character review. Coordinates below are measured in the
# unmodified source files; the importer normalizes them to the generator's +Y
# forward axis and aligns their primary handhold with the runtime grip socket.
PILOT_DONORS = {
    "pistol": {
        "path": "quaternius/ultimate-guns/Pistol_1.fbx",
        "creator": "Quaternius",
        "pack": "Ultimate Guns Pack",
        "page": "https://quaternius.com/packs/ultimategun.html",
        "sha256": "4a1f77b488f23e1758a4e9a5289cf076c876e3455a176dc8e0f4abea613aae1d",
        "rotation": ("Z", math.pi / 2),
        "anchor": (-0.05, 0.0, -0.15),
        "runtime_length": 0.32,
        "body_name": "pilot_pistol_cc0",
        "keep": {"breech_cap", "muzzle", "joint_clamp", "grip_tape_top", "spare_round"},
    },
    "laserPistol": {
        "path": "quaternius/sci-fi-modular/Pistol_1.fbx",
        "creator": "Quaternius",
        "pack": "Sci-Fi Modular Gun Pack",
        "page": "https://quaternius.com/packs/scifimodularguns.html",
        "sha256": "900e5eaf56065b2fe9870057f3ac01a74e5eba0e9d2193f05883200387c65617",
        "rotation": ("Z", math.pi / 2),
        "anchor": (0.0, 0.0, -0.05),
        "runtime_length": 0.40,
        "body_name": "pilot_laser_pistol_cc0",
        "keep": {"energy_core", "muzzle", "emitter_ring", "rear_sight"},
    },
    "flamethrower": {
        "path": "opengameart/flamethrower/Flamethrower.fbx",
        "creator": "Alexandr Mischenko",
        "pack": "Flamethrower PBR/Unity CC0",
        "page": "https://opengameart.org/content/flamethrower-pbrunity-cc0",
        "sha256": "954ad0ea00d83aaff4245a89ad378108f61cbf21d1c5c1fd2532865e43e6cc02",
        "rotation": ("Z", math.pi / 2),
        "anchor": (-1.15, 0.0, -0.38),
        "runtime_length": 1.06,
        "body_name": "pilot_flamethrower_cc0",
        "keep": {"fuel_tank", "muzzle", "pilot", "hose", "pressure_gauge", "gauge_face", "fuel_valve"},
    },
    "plasmaRifle": {
        "path": "quaternius/sci-fi-modular/AR_1.fbx",
        "creator": "Quaternius",
        "pack": "Sci-Fi Modular Gun Pack",
        "page": "https://quaternius.com/packs/scifimodularguns.html",
        "sha256": "3d2e58f6d89a9aedf2e25f769ca4c3dfd3981d0fa5ecbf0ebbd37c6c2da196b7",
        "rotation": ("Z", math.pi / 2),
        "anchor": (-0.16, 0.0, -0.10),
        "runtime_length": 1.03,
        "body_name": "pilot_plasma_rifle_cc0",
        "keep": {"energy_core", "muzzle", "plasma_core_ring_01", "rear_sight"},
    },
    "rocketLauncher": {
        "path": "opengameart/rocket-launcher/rocket_launcher.blend",
        "creator": "KennyNL",
        "pack": "Low Poly Rocket Launcher",
        "page": "https://opengameart.org/content/low-poly-rocket-launcher",
        "sha256": "763251a23c9a43e0560075d093c91057d331c9c3ca8cbf578a844f9dcdad5563",
        "rotation": ("Z", -math.pi / 2),
        "anchor": (1.20, 0.0, -0.55),
        "runtime_length": 1.12,
        "body_names": {"launcher": "launcher_tube", "rocket": "rocket_round"},
        "keep": {"muzzle", "grip", "sight", "shoulder_pad"},
    },
    "knife": {
        "path": "quaternius/survival/Knife.fbx",
        "creator": "Quaternius",
        "pack": "Survival Pack",
        "page": "https://quaternius.com/packs/survival.html",
        "sha256": "6a2d5250870ebc62aef8dc1c5bd6de88e921d36f976d06f61c2e9f190f7ec030",
        "rotation": ("X", -math.pi / 2),
        "anchor": (0.0, 0.0, -0.10),
        "runtime_length": 0.31,
        "body_name": "blade",
        "keep": {"grip", "guard", "pommel", "lanyard_ring", "grip_wrap_-0.34"},
    },
    "axe": {
        "path": "quaternius/survival/Axe.fbx",
        "creator": "Quaternius",
        "pack": "Survival Pack",
        "page": "https://quaternius.com/packs/survival.html",
        "sha256": "41537fbef651a0931b42b1786658ea1ef116dbe4a2315a38d12644251e4c52f4",
        "rotation": ("X", -math.pi / 2),
        "anchor": (0.0, 0.0, -0.40),
        "runtime_length": 0.79,
        "body_name": "blade",
        "keep": {"handle", "grip", "head_socket", "head_wedge", "axe_lashing"},
    },
}

# Complete the original family pilot with a distinct donor for each remaining
# firearm. These entries are source-pinned, including the mesh-part selections.
CATALOG_REPLACEMENTS = json.loads((REPOSITORY_ROOT / "source-assets/weapons/pilot/catalog-replacements.json").read_text(encoding="utf-8"))
for donor_id, donor_config in CATALOG_REPLACEMENTS["weapons"].items():
    PILOT_DONORS[donor_id] = {
        **{key: CATALOG_REPLACEMENTS[key] for key in ("creator", "pack", "page")},
        **donor_config,
        "sha256": donor_config["sha256"].lower(),
        "rotation": ("Z", math.pi / 2),
        "body_name": f"catalog_{donor_id}_cc0",
    }

WEAPON_INTERACTION_PROFILES = {
    # Пистолет — однозарядный самопал: перезарядка открывает казённую крышку
    # сзади, никакого магазина у него нет.
    "pistol": {"grip_r": (0, -0.04, -0.17), "grip_l": (-0.10, -0.015, -0.13), "reload": (0, -0.18, 0.19), "reload_kind": "shells", "reload_part": "breech_cap"},
    "revolver": {"grip_r": (0, -0.04, -0.17), "grip_l": (-0.10, -0.015, -0.13), "reload": (0, 0.075, 0.115), "reload_kind": "shells", "reload_part": "cylinder"},
    "sawedOffShotgun": {"grip_r": (0, -0.16, -0.09), "grip_l": (-0.10, -0.08, -0.08), "reload": (0.05, -0.02, 0.235), "reload_kind": "shells", "reload_part": "reload_shell"},
    "smg": {"grip_r": (0, -0.155, -0.10), "grip_l": (0, 0.145, -0.09), "reload": (0, 0.12, -0.18), "reload_kind": "magazine", "reload_part": "magazine"},
    "rifle": {"grip_r": (0, 0.04, -0.13), "grip_l": (-0.01, 0.58, 0.08), "reload": (0.13, 0.25, 0.16), "reload_kind": "bolt_clip", "reload_part": "cartridge_clip"},
    "assaultRifle": {"grip_r": (0.03, -0.025, -0.02), "grip_l": (-0.01, 0.33, 0.105), "reload": (0, 0.08, -0.22), "reload_kind": "magazine", "reload_part": "magazine"},
    "machineGun": {"grip_r": (0, -0.04, -0.19), "grip_l": (-0.02, 0.57, 0.12), "reload": (0.20, 0.20, -0.14), "reload_kind": "ammo_box", "reload_part": "ammo_box"},
    "laserPistol": {"grip_r": (0, -0.03, -0.18), "grip_l": (-0.11, 0.00, -0.13), "reload": (0, 0.18, 0.28), "reload_kind": "energy_cell", "reload_part": "energy_core"},
    "flamethrower": {"grip_r": (0, 0.01, -0.18), "grip_l": (-0.02, 0.56, 0.09), "reload": (0, -0.18, 0.12), "reload_kind": "fuel_tank", "reload_part": "fuel_tank"},
    "plasmaRifle": {"grip_r": (0, -0.02, -0.19), "grip_l": (-0.02, 0.61, 0.10), "reload": (0, 0.25, 0.17), "reload_kind": "energy_cell", "reload_part": "energy_core"},
    "shotgun": {"grip_r": (0, 0.01, -0.15), "grip_l": (-0.01, 0.70, 0.06), "reload": (-0.13, 0.24, -0.02), "reload_kind": "shells", "reload_part": "reload_shell"},
    "rocketLauncher": {"grip_r": (0, 0.14, -0.19), "grip_l": (-0.02, 0.70, 0.16), "reload": (0, -0.35, 0.16), "reload_kind": "rocket", "reload_part": "rocket_round"},
    "knife": {"grip_r": (0, -0.23, 0), "grip_l": None, "reload": None, "reload_kind": "none", "reload_part": None},
    "pickaxe": {"grip_r": (0, -0.38, 0), "grip_l": (0, 0.25, 0), "reload": None, "reload_kind": "none", "reload_part": None},
    "axe": {"grip_r": (0, -0.37, 0), "grip_l": (0, 0.23, 0), "reload": None, "reload_kind": "none", "reload_part": None},
    "handPump": {"grip_r": (0.13, 0.12, -0.15), "grip_l": (0, 0.48, 0.03), "reload": None, "reload_kind": "none", "reload_part": None},
}

PALETTE = {
    "metal": ((0.19, 0.22, 0.22, 1.0), (0.34, 0.37, 0.36, 1.0), 0.62, 0.62),
    "dark_metal": ((0.075, 0.085, 0.085, 1.0), (0.19, 0.20, 0.19, 1.0), 0.7, 0.48),
    "paint_olive": ((0.19, 0.24, 0.19, 1.0), (0.37, 0.42, 0.31, 1.0), 0.76, 0.2),
    "paint_teal": ((0.12, 0.27, 0.28, 1.0), (0.27, 0.43, 0.42, 1.0), 0.63, 0.28),
    "wood": ((0.22, 0.105, 0.052, 1.0), (0.48, 0.27, 0.13, 1.0), 0.86, 0.02),
    "leather": ((0.12, 0.07, 0.045, 1.0), (0.31, 0.18, 0.095, 1.0), 0.9, 0.01),
    "rubber": ((0.035, 0.04, 0.038, 1.0), (0.12, 0.13, 0.12, 1.0), 0.92, 0.0),
    # Синяя изолента: чуть глянцевая, заметно светлее к блику — фирменная
    # деталь самодельного оружия.
    "tape_blue": ((0.045, 0.10, 0.34, 1.0), (0.13, 0.24, 0.58, 1.0), 0.55, 0.0),
    "brass": ((0.34, 0.22, 0.075, 1.0), (0.68, 0.49, 0.19, 1.0), 0.48, 0.68),
    "rust": ((0.25, 0.07, 0.025, 1.0), (0.55, 0.19, 0.055, 1.0), 0.9, 0.06),
    "bone": ((0.45, 0.40, 0.31, 1.0), (0.71, 0.66, 0.52, 1.0), 0.88, 0.0),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--texture-size", type=int, default=96)
    parser.add_argument("--weapon", choices=[row[0] for row in WEAPONS], action="append")
    parser.add_argument("--report", type=Path)
    return parser.parse_args(argv)


def clean_name(value: str) -> str:
    out = []
    for char in value:
        out.append("_" if char.isupper() else char.upper())
    return "".join(out).strip("_")


def clear_weapon_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.actions,
    ):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    bpy.ops.outliner.orphans_purge(do_recursive=True)


def make_texture(name: str, low: tuple[float, ...], high: tuple[float, ...], size: int):
    image = bpy.data.images.new(f"WPN_TEX_{name.upper()}", width=size, height=size, alpha=True)
    rng = random.Random(f"realm-weapon-{name}")
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            grain = 0.5 + 0.22 * math.sin(x * 0.37 + y * 0.11)
            grain += 0.16 * math.sin(x * 0.08 - y * 0.41)
            grain += (rng.random() - 0.5) * 0.18
            if name == "wood":
                grain += 0.18 * math.sin(y * 0.76 + math.sin(x * 0.13) * 2.0)
            elif "metal" in name or name in {"brass", "rust"}:
                grain += 0.12 if (x * 7 + y * 11) % 53 < 3 else 0.0
                grain -= 0.17 if (x * 13 + y * 5) % 71 < 2 else 0.0
            elif name in {"leather", "rubber"}:
                grain += 0.08 * math.sin((x + y) * 0.63)
            factor = max(0.0, min(1.0, grain))
            pixels.extend(
                low[channel] + (high[channel] - low[channel]) * factor
                for channel in range(3)
            )
            pixels.append(1.0)
    image.pixels = pixels
    image.pack()
    return image


def make_materials(texture_size: int) -> dict[str, bpy.types.Material]:
    materials: dict[str, bpy.types.Material] = {}
    for key, (low, high, roughness, metallic) in PALETTE.items():
        material = bpy.data.materials.new(f"WPN_{key.upper()}_WORN")
        material.use_nodes = True
        material.diffuse_color = high
        nodes = material.node_tree.nodes
        principled = nodes.get("Principled BSDF")
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = f"{key}_wear_texture"
        texture.interpolation = "Closest"
        texture.image = make_texture(key, low, high, texture_size)
        material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = metallic
        materials[key] = material
    for key, color, emission in (
        ("energy_red", (0.88, 0.07, 0.055, 1.0), (1.0, 0.015, 0.005, 1.0)),
        ("energy_blue", (0.08, 0.48, 0.83, 1.0), (0.015, 0.26, 1.0, 1.0)),
        ("energy_green", (0.08, 0.78, 0.36, 1.0), (0.015, 1.0, 0.22, 1.0)),
        ("flame", (1.0, 0.25, 0.035, 1.0), (1.0, 0.035, 0.0, 1.0)),
    ):
        material = bpy.data.materials.new(f"WPN_{key.upper()}")
        material.use_nodes = True
        material.diffuse_color = color
        principled = material.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = 0.22
        principled.inputs["Metallic"].default_value = 0.16
        principled.inputs["Emission Color"].default_value = emission
        principled.inputs["Emission Strength"].default_value = 4.2
        materials[key] = material
    return materials


def attach(obj: bpy.types.Object, root: bpy.types.Object, material=None) -> bpy.types.Object:
    obj.parent = root
    if material is not None:
        obj.data.materials.append(material)
    obj["realm_weapon_part"] = obj.name.lower()
    return obj


def add_interaction_socket(
    root: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    socket_kind: str,
) -> bpy.types.Object:
    socket = bpy.data.objects.new(name, None)
    socket.empty_display_type = "ARROWS"
    socket.empty_display_size = 0.035
    socket.location = location
    socket.parent = root
    socket["realm_weapon_socket"] = socket_kind
    bpy.context.collection.objects.link(socket)
    return socket


MUZZLE_PART_KEYS = ("muzzle", "nozzle", "emitter", "launcher_tube", "barrel_shroud", "barrel")


def weapon_muzzle_location(root: bpy.types.Object):
    """Derive the flash socket from the real barrel tip.

    Hand-tuned muzzle offsets drift the moment a weapon is reshaped, which is
    how the shot effect ended up detached from the barrel. Measuring the
    forward-most point of the barrel geometry keeps the socket correct for
    every rebuild.
    """
    best = None
    for child in root.children:
        if child.type != "MESH":
            continue
        name = str(child.get("realm_weapon_part") or child.name).lower()
        rank = next((index for index, key in enumerate(MUZZLE_PART_KEYS) if key in name), None)
        if rank is None:
            continue
        corners = [child.matrix_local @ Vector(corner) for corner in child.bound_box]
        tip = max(corner.y for corner in corners)
        centre_x = sum(corner.x for corner in corners) / len(corners)
        centre_z = sum(corner.z for corner in corners) / len(corners)
        candidate = (rank, -tip)
        if best is None or candidate < best[0]:
            best = (candidate, (centre_x, tip, centre_z))
    return best[1] if best else None


def add_weapon_interaction_sockets(root: bpy.types.Object, weapon_id: str) -> dict[str, object]:
    profile = WEAPON_INTERACTION_PROFILES[weapon_id]
    names = []
    add_interaction_socket(root, "socket_grip_r", profile["grip_r"], "primary_grip")
    names.append("socket_grip_r")
    if profile["grip_l"] is not None:
        add_interaction_socket(root, "socket_grip_l", profile["grip_l"], "support_grip")
        names.append("socket_grip_l")
    if profile["reload"] is not None:
        add_interaction_socket(root, "socket_reload", profile["reload"], "reload_service")
        names.append("socket_reload")
    # Ranged weapons carry a muzzle socket so the client can spawn the flash and
    # tracer at the barrel instead of a hardcoded per-weapon offset. Melee
    # weapons never fire, so they stay without one.
    muzzle = weapon_muzzle_location(root) if profile["reload"] is not None else None
    if muzzle is not None:
        add_interaction_socket(root, "socket_muzzle", muzzle, "muzzle_flash")
    return {
        "sockets": names,
        "reloadKind": profile["reload_kind"],
        "reloadPart": profile["reload_part"],
        "muzzle": list(muzzle) if muzzle is not None else None,
    }


def add_box(
    root,
    materials,
    name: str,
    location,
    dimensions,
    material: str,
    rotation=(0.0, 0.0, 0.0),
    bevel=0.014,
):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("edge_wear_bevel", "BEVEL")
        modifier.width = min(bevel, min(dimensions) * 0.22)
        modifier.segments = 1
        modifier.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return attach(obj, root, materials[material])


def add_cylinder(
    root,
    materials,
    name: str,
    location,
    radius: float,
    depth: float,
    material: str,
    direction="Y",
    vertices=16,
    bevel=0.0,
):
    rotation = (math.pi / 2, 0.0, 0.0) if direction == "Y" else (0.0, math.pi / 2, 0.0) if direction == "X" else (0.0, 0.0, 0.0)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        end_fill_type="NGON",
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    # Фаска по умолчанию выключена, поэтому простые вызовы не меняются. Она
    # нужна детализированной геометрии: без неё кромки выглядят рублеными.
    if bevel > 0:
        bevel_mesh(obj, min(bevel, radius * 0.24), segments=2)
    smooth_by_angle(obj)
    return attach(obj, root, materials[material])


def add_cone(
    root,
    materials,
    name: str,
    location,
    radii,
    depth: float,
    material: str,
    direction="Y",
    vertices=16,
):
    rotation = (math.pi / 2, 0.0, 0.0) if direction == "Y" else (0.0, math.pi / 2, 0.0) if direction == "X" else (0.0, 0.0, 0.0)
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radii[0],
        radius2=radii[1],
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    smooth_by_angle(obj)
    return attach(obj, root, materials[material])


def add_torus(
    root,
    materials,
    name: str,
    location,
    major_radius: float,
    minor_radius: float,
    material: str,
    rotation=(math.pi / 2, 0.0, 0.0),
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=10,
        minor_segments=4,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    smooth_by_angle(obj)
    return attach(obj, root, materials[material])


def add_prism(
    root,
    materials,
    name: str,
    outline: list[tuple[float, float]],
    thickness: float,
    material: str,
):
    vertices = [(x, y, -thickness / 2) for x, y in outline]
    vertices += [(x, y, thickness / 2) for x, y in outline]
    count = len(outline)
    faces = [tuple(range(count)), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return attach(obj, root, materials[material])


def add_screws(root, materials, prefix: str, positions):
    for index, location in enumerate(positions, start=1):
        add_cylinder(
            root,
            materials,
            f"{prefix}_screw_{index:02d}",
            location,
            0.018,
            0.012,
            "brass",
            direction="Z",
            vertices=8,
        )


def add_wear(root, materials, prefix: str, positions):
    for index, (location, dimensions) in enumerate(positions, start=1):
        add_box(
            root,
            materials,
            f"{prefix}_wear_{index:02d}",
            location,
            dimensions,
            "rust",
            bevel=0.004,
        )


def smooth_curved_mesh(obj: bpy.types.Object):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def smooth_by_angle(obj: bpy.types.Object, degrees: float = 40.0):
    # Гладкая заливка с порогом по углу: бока цилиндра сливаются в круглую
    # поверхность, а торцы и фаски остаются резкими. Без этого стволы и трубы
    # читаются как многогранники.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(degrees))



# --- Геометрические помощники, перенесённые из ветки детализированных моделей.
# Они дают лофты, сферы, гнутые трубки, насечку хвата, спусковую группу,
# кольца ствола и вентиляционные прорези — из них и складывается детализация.

def bevel_mesh(obj: bpy.types.Object, width: float, segments=3):
    if width <= 0:
        return
    modifier = obj.modifiers.new("edge_wear_bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.affect = "EDGES"
    modifier.harden_normals = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def smart_uv(obj: bpy.types.Object):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def deterministic_planar_uv(obj: bpy.types.Object):
    """Assign stable per-face UVs to a beveled box without threaded packing."""
    mesh = obj.data
    layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    minimum = [min(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)]
    maximum = [max(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)]
    for polygon in mesh.polygons:
        dropped = max(range(3), key=lambda axis: abs(polygon.normal[axis]))
        axes = [axis for axis in range(3) if axis != dropped]
        for loop_index in polygon.loop_indices:
            coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            values = []
            for axis in axes:
                span = maximum[axis] - minimum[axis]
                values.append(0.5 if span <= 1e-9 else (coordinate[axis] - minimum[axis]) / span)
            layer.data[loop_index].uv = values



def add_loft(
    root,
    materials,
    name: str,
    sections,
    material: str,
    bevel=0.018,
):
    vertices = []
    for y, half_width, bottom, top in sections:
        vertices.extend((
            (-half_width, y, bottom),
            (half_width, y, bottom),
            (half_width, y, top),
            (-half_width, y, top),
        ))
    faces = [(0, 3, 2, 1)]
    for index in range(len(sections) - 1):
        current = index * 4
        nxt = (index + 1) * 4
        faces.extend((
            (current, current + 1, nxt + 1, nxt),
            (current + 1, current + 2, nxt + 2, nxt + 1),
            (current + 2, current + 3, nxt + 3, nxt + 2),
            (current + 3, current, nxt, nxt + 3),
        ))
    last = (len(sections) - 1) * 4
    faces.append((last, last + 1, last + 2, last + 3))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if bevel > 0:
        bevel_mesh(obj, bevel, segments=3)
    smart_uv(obj)
    return attach(obj, root, materials[material])


def add_sphere(
    root,
    materials,
    name: str,
    location,
    radius: float,
    material: str,
    scale=(1.0, 1.0, 1.0),
    segments=24,
    rings=12,
):
    # Сфера строится вручную, а не оператором primitive_uv_sphere_add: тот
    # выдавал недетерминированный порядок треугольников, и все семь стволов со
    # сферами не сходились байт в байт между пересборками одинаковых исходников.
    # Ручная решётка с фиксированным обходом детерминирована полностью; сфере
    # не нужно сглаживание по углу — она гладкая целиком.
    vertices = [(0.0, 0.0, radius)]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        z = math.cos(phi) * radius
        band = math.sin(phi) * radius
        for column in range(segments):
            theta = 2.0 * math.pi * column / segments
            vertices.append((math.cos(theta) * band, math.sin(theta) * band, z))
    vertices.append((0.0, 0.0, -radius))
    last = len(vertices) - 1
    faces = []
    for column in range(segments):
        faces.append((0, 1 + column, 1 + (column + 1) % segments))
    for ring in range(rings - 2):
        top = 1 + ring * segments
        bottom = 1 + (ring + 1) * segments
        for column in range(segments):
            following = (column + 1) % segments
            faces.append((top + column, bottom + column, bottom + following, top + following))
    base = 1 + (rings - 2) * segments
    for column in range(segments):
        faces.append((last, base + (column + 1) % segments, base + column))
    sx, sy, sz = scale
    lx, ly, lz = location
    vertices = [(x * sx + lx, y * sy + ly, z * sz + lz) for x, y, z in vertices]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    smooth_curved_mesh(obj)
    return attach(obj, root, materials[material])


def add_curve_tube(
    root,
    materials,
    name: str,
    points,
    radius: float,
    material: str,
    cyclic=False,
):
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    smooth_curved_mesh(obj)
    return attach(obj, root, materials[material])


def add_grip_ribs(
    root,
    materials,
    prefix: str,
    center,
    dimensions,
    material="rubber",
    count=6,
    axis="Y",
):
    width, length, height = dimensions
    for index in range(count):
        amount = (index + 0.5) / count - 0.5
        location = list(center)
        rib_dimensions = [width * 1.06, max(0.018, length / count * 0.32), height * 1.04]
        if axis == "Z":
            location[2] += amount * height
            rib_dimensions = [width * 1.06, length * 1.04, max(0.018, height / count * 0.32)]
        else:
            location[1] += amount * length
        add_box(
            root,
            materials,
            f"{prefix}_rib_{index + 1:02d}",
            tuple(location),
            tuple(rib_dimensions),
            material,
            bevel=0.006,
        )


def add_trigger_group(root, materials, center, scale=1.0):
    x, y, z = center
    add_curve_tube(
        root,
        materials,
        "trigger_guard",
        [
            (-0.09 * scale + x, y, z + 0.025 * scale),
            (-0.075 * scale + x, y, z - 0.07 * scale),
            (x, y, z - 0.105 * scale),
            (0.075 * scale + x, y, z - 0.07 * scale),
            (0.09 * scale + x, y, z + 0.025 * scale),
        ],
        0.014 * scale,
        "dark_metal",
    )
    add_curve_tube(
        root,
        materials,
        "trigger",
        [
            (x, y + 0.01 * scale, z + 0.01 * scale),
            (x, y - 0.015 * scale, z - 0.035 * scale),
            (x, y - 0.035 * scale, z - 0.065 * scale),
        ],
        0.012 * scale,
        "brass",
    )


def add_barrel_rings(root, materials, prefix, y_values, radius, z, material="dark_metal"):
    for index, y in enumerate(y_values, start=1):
        add_torus(
            root,
            materials,
            f"{prefix}_ring_{index:02d}",
            (0, y, z),
            radius,
            max(0.008, radius * 0.14),
            material,
        )


def add_heat_vents(root, materials, prefix, y_values, z, width, material="dark_metal"):
    for index, y in enumerate(y_values, start=1):
        add_box(
            root,
            materials,
            f"{prefix}_vent_{index:02d}",
            (0, y, z),
            (width, 0.025, 0.028),
            material,
            bevel=0.004,
        )


def build_pistol(root, m):
    # Однозарядный самопал — оружие новичка, собрано с нуля по референсу
    # «handmade pistols». Две трубы: ствол вставлен в ствольную коробку
    # большего диаметра, сзади шестигранная казённая крышка с ударником-кнопкой.
    # Рама — гнутые полосы, рукоять — строганая доска на шурупах, запасной
    # патрон примотан к рукояти изолентой. Крышка (breech_cap) — часть
    # перезарядки: анимация оттягивает её назад, стрелок вкладывает патрон.
    # Ствол в коробке: тонкая труба в толстой, стык стянут хомутом.
    add_cylinder(root, m, "receiver_tube", (0, -0.03, 0.19), 0.052, 0.26, "rust", vertices=20, bevel=0.005)
    add_cylinder(root, m, "barrel", (0, 0.315, 0.19), 0.036, 0.53, "metal", vertices=20, bevel=0.003)
    add_cylinder(root, m, "muzzle", (0, 0.60, 0.19), 0.042, 0.05, "dark_metal", vertices=20, bevel=0.004)
    add_torus(root, m, "muzzle_burr", (0.009, 0.625, 0.19), 0.041, 0.005, "rust")
    add_torus(root, m, "joint_clamp", (0, 0.085, 0.19), 0.055, 0.010, "brass")
    add_cylinder(root, m, "joint_tape", (0, 0.13, 0.19), 0.047, 0.05, "tape_blue", vertices=20, bevel=0.003)
    add_box(root, m, "joint_clamp_screw", (0.064, 0.085, 0.235), (0.018, 0.028, 0.042), "brass", bevel=0.003)
    # Казённая крышка: шестигранник, за ним кнопка ударника на штоке с пружиной.
    add_cylinder(root, m, "breech_cap", (0, -0.185, 0.19), 0.058, 0.05, "dark_metal", vertices=6, bevel=0.005)
    add_cylinder(root, m, "striker_rod", (0, -0.225, 0.19), 0.008, 0.05, "metal", vertices=10)
    add_sphere(root, m, "striker_knob", (0, -0.258, 0.19), 0.021, "brass")
    spring = []
    for i in range(8):
        a = i * math.pi / 1.7
        spring.append((0.014 * math.cos(a), -0.204 - i * 0.005, 0.19 + 0.014 * math.sin(a)))
    add_curve_tube(root, m, "striker_spring", spring, 0.004, "metal")
    # Рама из двух гнутых полос: передняя к спуску, задняя в рукоять.
    add_curve_tube(root, m, "frame_strap_front", [
        (0, 0.075, 0.24), (0, 0.105, 0.05), (0, 0.065, -0.045),
    ], 0.011, "dark_metal")
    add_curve_tube(root, m, "frame_strap_rear", [
        (0, -0.135, 0.235), (0, -0.17, 0.06), (0, -0.11, -0.03),
    ], 0.010, "dark_metal")
    # Тяга от спуска к ударнику — снаружи, по правому боку.
    add_curve_tube(root, m, "trigger_linkage", [
        (0.046, 0.055, -0.015), (0.052, -0.06, 0.115), (0.046, -0.16, 0.155),
    ], 0.006, "metal")
    # Проволочная вязка на стыке коробки и рукояти, хвост скруткой.
    add_curve_tube(root, m, "lashing", [
        (0.0, -0.065, 0.248), (0.058, -0.065, 0.19), (0.062, -0.065, 0.05),
        (0.045, -0.065, -0.012), (-0.045, -0.065, -0.012), (-0.062, -0.065, 0.05),
        (-0.058, -0.065, 0.19),
    ], 0.005, "metal", cyclic=True)
    add_curve_tube(root, m, "lashing_tail", [
        (0.05, -0.05, 0.235), (0.082, -0.038, 0.262), (0.068, -0.02, 0.285),
    ], 0.0045, "metal")
    # Рукоять: строганая доска, пятка, два шурупа, стальная стяжка сверху.
    add_box(root, m, "grip", (0, -0.045, -0.17), (0.17, 0.28, 0.40), "wood", rotation=(0.20, 0, 0.02), bevel=0.03)
    add_box(root, m, "grip_tape_top", (0, -0.018, -0.035), (0.186, 0.29, 0.06), "tape_blue", rotation=(0.20, 0, 0.02), bevel=0.006)
    add_box(root, m, "grip_tape_mid", (0, -0.062, -0.255), (0.182, 0.295, 0.07), "tape_blue", rotation=(0.20, 0.08, 0.02), bevel=0.006)
    add_box(root, m, "grip_tape_tail", (0.085, -0.012, -0.005), (0.018, 0.09, 0.045), "tape_blue", rotation=(0.35, 0.2, 0.1), bevel=0.003)
    add_box(root, m, "grip_butt", (0, -0.105, -0.365), (0.19, 0.30, 0.05), "wood", rotation=(0.20, 0, 0.02), bevel=0.012)
    add_screws(root, m, "grip", [(-0.09, -0.035, -0.12), (0.09, -0.08, -0.245)])
    # Запасной патрон, примотанный изолентой к левой щеке рукояти.
    add_cylinder(root, m, "spare_round", (-0.098, -0.055, -0.155), 0.012, 0.06, "brass", direction="Z", vertices=10)
    add_box(root, m, "spare_round_tape", (-0.096, -0.055, -0.155), (0.018, 0.05, 0.028), "tape_blue", rotation=(0.20, 0, 0), bevel=0.003)
    add_trigger_group(root, m, (0, 0.095, -0.04), 0.92)
    # Прицельные: гвоздь-мушка со шляпкой и гнутый язычок целика на коробке.
    add_cylinder(root, m, "front_sight", (0.003, 0.545, 0.235), 0.008, 0.065, "metal", direction="Z", vertices=8)
    add_sphere(root, m, "front_sight_head", (0.003, 0.545, 0.272), 0.012, "rust")
    add_box(root, m, "rear_sight", (0, -0.115, 0.252), (0.048, 0.026, 0.034), "rust", rotation=(0, 0, 0.05), bevel=0.004)
    # Подпалины: коробка у казны и доска у стяжки.
    add_wear(root, m, "pistol", [
        ((0.049, -0.06, 0.205), (0.01, 0.11, 0.045)),
        ((-0.086, -0.03, -0.06), (0.011, 0.09, 0.05)),
    ])

def build_rifle(root, m):
    add_loft(root, m, "stock", [
        (-0.54, 0.16, -0.16, 0.11),
        (-0.33, 0.19, -0.15, 0.14),
        (-0.12, 0.15, -0.11, 0.13),
        (0.09, 0.10, -0.07, 0.11),
    ], "wood", bevel=0.022)
    add_box(root, m, "butt_plate", (0, -0.535, 0.0), (0.23, 0.045, 0.34), "dark_metal", bevel=0.012)
    add_box(root, m, "cheek_rest", (0, -0.24, 0.13), (0.20, 0.34, 0.09), "leather", rotation=(-0.05, 0, 0), bevel=0.02)
    add_box(root, m, "receiver", (0, 0.20, 0.10), (0.22, 0.49, 0.22), "dark_metal", bevel=0.026)
    add_box(root, m, "ejection_port", (0.116, 0.25, 0.14), (0.014, 0.18, 0.095), "rubber", bevel=0.003)
    add_box(root, m, "forearm", (0, 0.58, 0.05), (0.20, 0.46, 0.19), "wood", bevel=0.032)
    add_grip_ribs(root, m, "rifle_forearm", (0, 0.60, 0.05), (0.21, 0.38, 0.20), material="leather", count=6)
    add_cylinder(root, m, "barrel", (0, 1.01, 0.12), 0.047, 0.95, "metal", vertices=24, bevel=0.004)
    add_cylinder(root, m, "muzzle", (0, 1.49, 0.12), 0.066, 0.14, "dark_metal", vertices=24, bevel=0.006)
    add_cylinder(root, m, "barrel_crown", (0, 1.565, 0.12), 0.038, 0.012, "rubber", vertices=24)
    add_barrel_rings(root, m, "rifle_barrel", (0.78, 1.24), 0.061, 0.12)
    add_box(root, m, "grip", (0, 0.035, -0.14), (0.155, 0.25, 0.33), "wood", rotation=(0.18, 0, 0), bevel=0.022)
    add_trigger_group(root, m, (0, 0.12, -0.02), 0.95)
    add_box(root, m, "bolt", (0.14, 0.25, 0.16), (0.19, 0.055, 0.055), "brass", bevel=0.01)
    add_sphere(root, m, "bolt_knob", (0.245, 0.25, 0.16), 0.052, "dark_metal")
    add_box(root, m, "cartridge_clip", (0, 0.18, 0.235), (0.11, 0.09, 0.12), "brass", bevel=0.008)
    # Оптику модель не несёт: прицел ставится через мастерскую модификаций.
    # Вместо неё штатные механические прицельные и планка, на которую
    # модификация и садится.
    add_box(root, m, "scope_rail", (0, 0.44, 0.222), (0.075, 0.30, 0.022), "dark_metal", bevel=0.004)
    add_box(root, m, "rear_sight", (0, 0.315, 0.245), (0.070, 0.030, 0.038), "dark_metal", bevel=0.005)
    add_box(root, m, "front_sight", (0, 1.30, 0.22), (0.035, 0.055, 0.13), "dark_metal", bevel=0.005)
    add_screws(root, m, "rifle", [(-0.116, 0.10, 0.12), (0.116, 0.34, 0.12)])
    add_wear(root, m, "rifle", [((0, 0.32, 0.216), (0.10, 0.16, 0.012))])


def build_assault_rifle(root, m):
    add_loft(root, m, "stock", [
        (-0.49, 0.14, -0.14, 0.10),
        (-0.29, 0.18, -0.13, 0.12),
        (-0.08, 0.13, -0.09, 0.11),
        (0.05, 0.08, -0.06, 0.09),
    ], "wood", bevel=0.020)
    add_box(root, m, "stock_butt", (0, -0.485, 0.0), (0.20, 0.045, 0.31), "dark_metal", bevel=0.012)
    add_box(root, m, "receiver", (0, 0.22, 0.09), (0.25, 0.62, 0.25), "dark_metal", bevel=0.028)
    add_box(root, m, "dust_cover", (0, 0.22, 0.225), (0.215, 0.51, 0.075), "paint_olive", bevel=0.016)
    add_box(root, m, "ejection_port", (0.132, 0.29, 0.15), (0.014, 0.20, 0.10), "rubber", bevel=0.003)
    add_cylinder(root, m, "gas_tube", (0, 0.75, 0.20), 0.048, 0.63, "dark_metal", vertices=24)
    add_cylinder(root, m, "barrel", (0, 0.91, 0.10), 0.047, 0.68, "metal", vertices=24)
    add_cylinder(root, m, "muzzle", (0, 1.28, 0.10), 0.075, 0.16, "dark_metal", vertices=24, bevel=0.007)
    for index, z in enumerate((0.06, 0.10, 0.14), start=1):
        add_box(root, m, f"muzzle_slot_{index:02d}", (0, 1.36, z), (0.16, 0.035, 0.018), "rubber", bevel=0.002)
    add_box(root, m, "handguard", (0, 0.68, 0.07), (0.235, 0.39, 0.22), "wood", bevel=0.030)
    add_grip_ribs(root, m, "assault_handguard", (0, 0.69, 0.07), (0.24, 0.34, 0.22), material="dark_metal", count=6)
    add_box(root, m, "grip", (0, -0.02, -0.16), (0.16, 0.25, 0.35), "leather", rotation=(0.18, 0, 0), bevel=0.024)
    add_grip_ribs(root, m, "assault_grip", (0, -0.02, -0.16), (0.165, 0.22, 0.30), count=6, axis="Z")
    add_trigger_group(root, m, (0, 0.10, -0.035), 0.94)
    magazine = add_prism(root, m, "magazine", [(-0.09, 0.04), (-0.105, 0.34), (-0.05, 0.48), (0.08, 0.43), (0.095, 0.08)], 0.18, "dark_metal")
    magazine.rotation_euler.x = math.pi / 2
    magazine.location = (0, 0.08, -0.15)
    for index in range(4):
        add_box(root, m, f"magazine_rib_{index + 1:02d}", (0, 0.025 + index * 0.045, -0.29 - index * 0.015), (0.19, 0.018, 0.22), "metal", rotation=(0.10, 0, 0), bevel=0.004)
    add_box(root, m, "charging_handle", (0.16, 0.12, 0.23), (0.16, 0.045, 0.045), "brass", bevel=0.008)
    add_sphere(root, m, "charging_handle_knob", (0.25, 0.12, 0.23), 0.038, "dark_metal")
    add_box(root, m, "rear_sight", (0, 0.03, 0.34), (0.12, 0.11, 0.09), "dark_metal", bevel=0.012)
    add_box(root, m, "front_sight", (0, 1.05, 0.27), (0.12, 0.07, 0.23), "dark_metal", bevel=0.012)
    add_sphere(root, m, "front_sight_post", (0, 1.05, 0.32), 0.018, "brass", scale=(0.65, 0.65, 1.8))
    add_barrel_rings(root, m, "assault_barrel", (0.92, 1.16), 0.061, 0.10)
    add_screws(root, m, "assault", [(-0.125, 0.04, 0.12), (0.125, 0.35, 0.12)])
    add_wear(root, m, "assault", [((0, 0.16, 0.255), (0.13, 0.18, 0.015)), ((0, 0.72, 0.181), (0.12, 0.16, 0.012))])


def build_machine_gun(root, m):
    # Сошки в модель не входят: это модификация слота цевья («Складные сошки»),
    # её навешивает мастерская, а не базовая геометрия.
    add_loft(root, m, "stock", [
        (-0.57, 0.17, -0.18, 0.12),
        (-0.34, 0.21, -0.17, 0.15),
        (-0.11, 0.17, -0.12, 0.14),
        (0.03, 0.11, -0.08, 0.11),
    ], "wood", bevel=0.023)
    add_box(root, m, "stock_butt", (0, -0.565, 0.0), (0.24, 0.05, 0.36), "dark_metal", bevel=0.014)
    add_box(root, m, "receiver", (0, 0.25, 0.11), (0.31, 0.76, 0.32), "dark_metal", bevel=0.035)
    add_box(root, m, "receiver_cover", (0, 0.21, 0.30), (0.285, 0.59, 0.095), "paint_olive", bevel=0.018)
    add_box(root, m, "feed_tray", (0.17, 0.20, 0.22), (0.065, 0.36, 0.13), "metal", bevel=0.012)
    add_cylinder(root, m, "barrel_shroud", (0, 0.96, 0.13), 0.09, 0.82, "metal", vertices=28, bevel=0.006)
    add_cylinder(root, m, "barrel_core", (0, 1.04, 0.13), 0.042, 0.96, "dark_metal", vertices=24)
    add_cylinder(root, m, "muzzle", (0, 1.43, 0.13), 0.105, 0.18, "dark_metal", vertices=24, bevel=0.008)
    add_barrel_rings(root, m, "machine_barrel", (0.66, 0.82, 1.02, 1.22), 0.108, 0.13)
    for side in (-1, 1):
        for index, y in enumerate((0.73, 0.87, 1.01, 1.15), start=1):
            add_cylinder(
                root,
                m,
                f"shroud_vent_{'l' if side < 0 else 'r'}_{index:02d}",
                (side * 0.085, y, 0.13),
                0.018,
                0.02,
                "rubber",
                direction="X",
                vertices=16,
            )
    add_box(root, m, "ammo_box", (0.21, 0.18, -0.14), (0.30, 0.36, 0.39), "paint_olive", bevel=0.03)
    add_box(root, m, "ammo_box_lid", (0.21, 0.18, 0.07), (0.31, 0.37, 0.045), "dark_metal", bevel=0.008)
    add_box(root, m, "ammo_box_latch", (0.365, 0.18, -0.02), (0.025, 0.09, 0.12), "brass", bevel=0.005)
    for index, y in enumerate((0.09, 0.15, 0.21, 0.27, 0.33), start=1):
        add_cylinder(root, m, f"ammo_belt_{index:02d}", (0.16, y, 0.10), 0.018, 0.11, "brass", direction="X", vertices=16)
    add_box(root, m, "grip", (0, -0.04, -0.19), (0.18, 0.26, 0.39), "leather", rotation=(0.18, 0, 0), bevel=0.024)
    add_grip_ribs(root, m, "machine_grip", (0, -0.04, -0.19), (0.19, 0.23, 0.34), count=6, axis="Z")
    add_trigger_group(root, m, (0, 0.07, -0.05), 1.0)
    add_curve_tube(
        root,
        m,
        "carry_handle",
        [(-0.13, 0.28, 0.36), (-0.15, 0.43, 0.52), (0.15, 0.43, 0.52), (0.13, 0.58, 0.36)],
        0.026,
        "brass",
    )
    add_box(root, m, "rear_sight", (0, 0.03, 0.41), (0.13, 0.12, 0.10), "dark_metal", bevel=0.012)
    add_box(root, m, "front_sight", (0, 1.18, 0.27), (0.12, 0.07, 0.21), "dark_metal", bevel=0.012)
    add_screws(root, m, "machinegun", [(-0.16, 0.04, 0.13), (-0.16, 0.40, 0.13)])
    add_wear(root, m, "machinegun", [((0, 0.25, 0.338), (0.17, 0.24, 0.012))])


def build_laser_pistol(root, m):
    add_box(root, m, "frame", (0, 0.23, 0.10), (0.30, 0.58, 0.28), "paint_teal", bevel=0.05)
    add_box(root, m, "frame_spine", (0, 0.20, 0.27), (0.21, 0.44, 0.10), "dark_metal", bevel=0.024)
    add_cone(root, m, "emitter", (0, 0.61, 0.10), (0.135, 0.085), 0.22, "dark_metal", vertices=28)
    add_torus(root, m, "emitter_ring", (0, 0.70, 0.10), 0.105, 0.024, "brass")
    add_cylinder(root, m, "muzzle", (0, 0.75, 0.10), 0.077, 0.09, "energy_red", vertices=24)
    add_cylinder(root, m, "muzzle_aperture", (0, 0.798, 0.10), 0.045, 0.012, "rubber", vertices=24)
    add_box(root, m, "grip", (0, -0.03, -0.18), (0.20, 0.28, 0.41), "rubber", rotation=(0.20, 0, 0), bevel=0.034)
    add_box(root, m, "grip_insert_left", (-0.105, -0.03, -0.18), (0.018, 0.22, 0.31), "leather", rotation=(0.20, 0, 0), bevel=0.007)
    add_box(root, m, "grip_insert_right", (0.105, -0.03, -0.18), (0.018, 0.22, 0.31), "leather", rotation=(0.20, 0, 0), bevel=0.007)
    add_grip_ribs(root, m, "laser_grip", (0, -0.03, -0.18), (0.205, 0.23, 0.34), count=7, axis="Z")
    add_trigger_group(root, m, (0, 0.075, -0.055), 0.95)
    core = add_cylinder(root, m, "energy_core", (0, 0.18, 0.29), 0.078, 0.31, "energy_blue", vertices=28)
    core.scale.x = 1.25
    add_barrel_rings(root, m, "core_collar", (0.04, 0.18, 0.32), 0.102, 0.29, material="brass")
    for offset in (-0.17, 0.17):
        add_box(root, m, f"emitter_fin_{'l' if offset < 0 else 'r'}", (offset, 0.50, 0.11), (0.06, 0.29, 0.25), "metal", rotation=(0, 0, -offset * 0.35), bevel=0.014)
        for index, y in enumerate((0.42, 0.50, 0.58), start=1):
            add_box(root, m, f"fin_vent_{'l' if offset < 0 else 'r'}_{index:02d}", (offset * 1.02, y, 0.12), (0.067, 0.028, 0.12), "rubber", bevel=0.004)
    add_curve_tube(root, m, "core_wire_left", [(-0.10, 0.08, 0.22), (-0.17, 0.18, 0.18), (-0.17, 0.34, 0.12)], 0.014, "brass")
    add_curve_tube(root, m, "core_wire_right", [(0.10, 0.08, 0.22), (0.17, 0.18, 0.18), (0.17, 0.34, 0.12)], 0.014, "brass")
    add_box(root, m, "power_cell_base", (0, -0.08, -0.39), (0.22, 0.14, 0.045), "brass", rotation=(0.20, 0, 0), bevel=0.010)
    add_box(root, m, "rear_sight", (0, 0.0, 0.37), (0.12, 0.07, 0.055), "dark_metal", bevel=0.007)
    add_screws(root, m, "laser", [(-0.147, 0.12, 0.14), (0.147, 0.36, 0.14)])


def build_flamethrower(root, m):
    add_box(root, m, "frame", (0, 0.26, 0.08), (0.28, 0.72, 0.25), "dark_metal", bevel=0.032)
    add_box(root, m, "frame_rail_left", (-0.16, 0.28, 0.08), (0.045, 0.66, 0.18), "metal", bevel=0.010)
    add_box(root, m, "frame_rail_right", (0.16, 0.28, 0.08), (0.045, 0.66, 0.18), "metal", bevel=0.010)
    add_cylinder(root, m, "fuel_tank", (0, -0.18, 0.12), 0.155, 0.62, "paint_olive", vertices=28, bevel=0.007)
    add_cone(root, m, "fuel_tank_cap_front", (0, 0.145, 0.12), (0.125, 0.155), 0.06, "dark_metal", vertices=28)
    add_cone(root, m, "fuel_tank_cap_rear", (0, -0.505, 0.12), (0.155, 0.125), 0.06, "dark_metal", vertices=28)
    add_barrel_rings(root, m, "fuel_strap", (-0.34, -0.02), 0.172, 0.12, material="brass")
    add_cylinder(root, m, "pressure_tank", (0.205, 0.10, 0.09), 0.082, 0.48, "brass", vertices=24, bevel=0.006)
    add_cylinder(root, m, "nozzle", (0, 0.88, 0.10), 0.058, 0.78, "metal", vertices=24, bevel=0.004)
    add_cylinder(root, m, "nozzle_jacket", (0, 0.88, 0.10), 0.082, 0.42, "dark_metal", vertices=24)
    add_heat_vents(root, m, "flame_nozzle", (0.72, 0.82, 0.92, 1.02), 0.185, 0.12, material="metal")
    add_cone(root, m, "muzzle", (0, 1.31, 0.10), (0.115, 0.062), 0.15, "dark_metal", vertices=24)
    add_cylinder(root, m, "pilot", (0, 1.40, 0.10), 0.036, 0.07, "flame", vertices=20)
    add_box(root, m, "pilot_guard_left", (-0.055, 1.39, 0.10), (0.018, 0.12, 0.12), "brass", bevel=0.004)
    add_box(root, m, "pilot_guard_right", (0.055, 1.39, 0.10), (0.018, 0.12, 0.12), "brass", bevel=0.004)
    add_box(root, m, "grip", (0, 0.01, -0.18), (0.17, 0.28, 0.39), "leather", rotation=(0.18, 0, 0), bevel=0.024)
    add_grip_ribs(root, m, "flame_grip", (0, 0.01, -0.18), (0.18, 0.24, 0.34), count=6, axis="Z")
    add_trigger_group(root, m, (0, 0.12, -0.04), 0.95)
    add_curve_tube(root, m, "hose", [(0.14, -0.20, 0.02), (0.28, -0.02, -0.02), (0.23, 0.30, 0.00), (0.12, 0.52, 0.06)], 0.026, "rubber")
    add_sphere(root, m, "pressure_gauge", (-0.19, 0.12, 0.25), 0.075, "dark_metal", scale=(0.32, 1.0, 1.0))
    add_cylinder(root, m, "gauge_face", (-0.215, 0.12, 0.25), 0.055, 0.015, "bone", direction="X", vertices=24)
    add_box(root, m, "gauge_needle", (-0.226, 0.12, 0.25), (0.008, 0.065, 0.012), "energy_red", rotation=(0.45, 0, 0), bevel=0.002)
    add_sphere(root, m, "fuel_valve", (0.19, -0.18, 0.25), 0.055, "brass", scale=(1.0, 0.45, 1.0))
    add_wear(root, m, "flame", [((0, 0.27, 0.207), (0.13, 0.23, 0.012))])


def build_plasma_rifle(root, m):
    add_loft(root, m, "stock", [
        (-0.49, 0.15, -0.17, 0.12),
        (-0.29, 0.20, -0.16, 0.15),
        (-0.08, 0.18, -0.11, 0.13),
        (0.03, 0.10, -0.07, 0.11),
    ], "rubber", bevel=0.024)
    add_box(root, m, "stock_frame", (0, -0.24, 0.02), (0.28, 0.45, 0.25), "dark_metal", bevel=0.03)
    add_box(root, m, "stock_butt", (0, -0.485, 0.02), (0.24, 0.055, 0.34), "rubber", bevel=0.016)
    add_box(root, m, "receiver", (0, 0.28, 0.12), (0.35, 0.79, 0.37), "paint_teal", bevel=0.06)
    add_box(root, m, "receiver_spine", (0, 0.23, 0.34), (0.26, 0.56, 0.10), "dark_metal", bevel=0.025)
    add_cylinder(root, m, "energy_core", (0, 0.25, 0.17), 0.132, 0.40, "energy_green", vertices=28)
    add_barrel_rings(root, m, "plasma_core", (0.04, 0.25, 0.45), 0.154, 0.17, material="brass")
    for offset in (-0.12, 0, 0.12):
        add_cylinder(root, m, f"barrel_{offset:+.2f}", (offset, 0.96, 0.12), 0.046, 0.74, "metal", vertices=24)
        add_torus(root, m, f"barrel_coil_{offset:+.2f}_rear", (offset, 0.72, 0.12), 0.059, 0.012, "brass")
        add_torus(root, m, f"barrel_coil_{offset:+.2f}_front", (offset, 1.15, 0.12), 0.059, 0.012, "brass")
    add_cone(root, m, "muzzle", (0, 1.37, 0.12), (0.16, 0.10), 0.16, "dark_metal", vertices=28)
    add_cylinder(root, m, "muzzle_aperture", (0, 1.455, 0.12), 0.078, 0.018, "energy_green", vertices=24)
    add_box(root, m, "grip", (0, -0.02, -0.19), (0.18, 0.26, 0.41), "rubber", rotation=(0.18, 0, 0), bevel=0.028)
    add_grip_ribs(root, m, "plasma_grip", (0, -0.02, -0.19), (0.19, 0.23, 0.35), count=7, axis="Z")
    add_trigger_group(root, m, (0, 0.10, -0.05), 1.0)
    for offset in (-0.20, 0.20):
        add_box(root, m, f"coil_guard_{'l' if offset < 0 else 'r'}", (offset, 0.27, 0.17), (0.06, 0.50, 0.30), "brass", bevel=0.016)
        for index, y in enumerate((0.11, 0.22, 0.33, 0.44), start=1):
            add_box(root, m, f"guard_insulator_{'l' if offset < 0 else 'r'}_{index:02d}", (offset, y, 0.17), (0.07, 0.032, 0.20), "rubber", bevel=0.005)
    add_curve_tube(root, m, "plasma_wire_left", [(-0.16, 0.03, 0.26), (-0.24, 0.28, 0.33), (-0.18, 0.58, 0.22)], 0.016, "energy_green")
    add_curve_tube(root, m, "plasma_wire_right", [(0.16, 0.03, 0.26), (0.24, 0.28, 0.33), (0.18, 0.58, 0.22)], 0.016, "energy_green")
    add_box(root, m, "rear_sight", (0, -0.02, 0.42), (0.16, 0.10, 0.08), "dark_metal", bevel=0.012)
    add_box(root, m, "front_sight", (0, 1.18, 0.29), (0.14, 0.07, 0.18), "dark_metal", bevel=0.012)
    add_box(root, m, "power_cell", (0, 0.05, -0.30), (0.22, 0.24, 0.20), "brass", rotation=(0.12, 0, 0), bevel=0.026)
    add_box(root, m, "power_cell_window", (0, 0.04, -0.405), (0.12, 0.13, 0.018), "energy_green", rotation=(0.12, 0, 0), bevel=0.005)
    add_screws(root, m, "plasma", [(-0.18, 0.04, 0.16), (0.18, 0.48, 0.16)])
    add_wear(root, m, "plasma", [((0, 0.16, 0.306), (0.18, 0.21, 0.012))])


def build_shotgun(root, m):
    add_loft(root, m, "stock", [
        (-0.55, 0.16, -0.17, 0.11),
        (-0.34, 0.20, -0.16, 0.14),
        (-0.12, 0.17, -0.11, 0.13),
        (0.07, 0.10, -0.07, 0.11),
    ], "wood", bevel=0.022)
    add_box(root, m, "butt_plate", (0, -0.545, 0.0), (0.23, 0.045, 0.35), "rubber", bevel=0.014)
    add_box(root, m, "cheek_rest", (0, -0.25, 0.13), (0.20, 0.34, 0.085), "leather", bevel=0.018)
    add_box(root, m, "receiver", (0, 0.22, 0.10), (0.24, 0.51, 0.24), "dark_metal", bevel=0.029)
    add_box(root, m, "ejection_port", (0.126, 0.28, 0.15), (0.014, 0.18, 0.105), "rubber", bevel=0.003)
    add_box(root, m, "loading_gate", (0, 0.17, -0.027), (0.13, 0.19, 0.014), "metal", bevel=0.004)
    add_cylinder(root, m, "barrel", (0, 0.91, 0.16), 0.054, 1.03, "metal", vertices=28, bevel=0.004)
    add_cylinder(root, m, "magazine_tube", (0, 0.88, 0.035), 0.047, 0.86, "dark_metal", vertices=24, bevel=0.004)
    add_cylinder(root, m, "muzzle", (0, 1.47, 0.16), 0.070, 0.09, "dark_metal", vertices=28, bevel=0.006)
    add_cylinder(root, m, "muzzle_bore", (0, 1.518, 0.16), 0.040, 0.012, "rubber", vertices=28)
    add_box(root, m, "pump", (0, 0.70, 0.06), (0.26, 0.37, 0.22), "wood", bevel=0.032)
    add_grip_ribs(root, m, "shotgun_pump", (0, 0.70, 0.06), (0.27, 0.34, 0.22), material="rubber", count=8)
    add_box(root, m, "grip", (0, 0.01, -0.15), (0.17, 0.25, 0.35), "leather", rotation=(0.18, 0, 0), bevel=0.024)
    add_grip_ribs(root, m, "shotgun_grip", (0, 0.01, -0.15), (0.18, 0.22, 0.30), count=6, axis="Z")
    add_trigger_group(root, m, (0, 0.10, -0.03), 0.96)
    add_barrel_rings(root, m, "shotgun_band", (0.57, 1.19), 0.074, 0.095)
    add_box(root, m, "front_sight", (0, 1.34, 0.235), (0.025, 0.045, 0.055), "brass", bevel=0.004)
    add_box(root, m, "safety", (0.13, 0.09, 0.15), (0.035, 0.06, 0.035), "brass", bevel=0.007)
    add_screws(root, m, "shotgun", [(-0.125, 0.08, 0.13), (0.125, 0.33, 0.13)])
    add_cylinder(root, m, "reload_shell", (-0.13, 0.24, -0.02), 0.035, 0.15, "brass", direction="Y", vertices=10)


def build_rocket_launcher(root, m):
    add_cylinder(root, m, "launcher_tube", (0, 0.48, 0.16), 0.152, 1.52, "paint_olive", vertices=32, bevel=0.006)
    add_cylinder(root, m, "inner_tube", (0, 0.48, 0.16), 0.122, 1.58, "dark_metal", vertices=28)
    add_cone(root, m, "muzzle", (0, 1.30, 0.16), (0.235, 0.152), 0.20, "metal", vertices=32)
    add_torus(root, m, "muzzle_ring", (0, 1.385, 0.16), 0.205, 0.030, "dark_metal")
    add_cone(root, m, "rear_vent", (0, -0.35, 0.16), (0.19, 0.25), 0.18, "dark_metal", vertices=32)
    add_torus(root, m, "rear_vent_ring", (0, -0.43, 0.16), 0.225, 0.027, "metal")
    add_barrel_rings(root, m, "launcher_strap", (-0.10, 0.46, 0.90), 0.174, 0.16, material="brass")
    add_box(root, m, "grip", (0, 0.14, -0.19), (0.19, 0.28, 0.42), "leather", rotation=(0.18, 0, 0), bevel=0.026)
    add_grip_ribs(root, m, "launcher_grip", (0, 0.14, -0.19), (0.20, 0.24, 0.36), count=7, axis="Z")
    add_trigger_group(root, m, (0, 0.25, -0.045), 1.0)
    add_box(root, m, "sight", (-0.19, 0.51, 0.36), (0.14, 0.39, 0.16), "dark_metal", bevel=0.022)
    add_box(root, m, "shoulder_pad", (0, -0.49, 0.16), (0.29, 0.09, 0.37), "rubber", bevel=0.026)
    add_box(root, m, "warning_plate", (0, 0.62, 0.315), (0.12, 0.30, 0.012), "rust", bevel=0.004)
    add_curve_tube(root, m, "launcher_wire", [(0.14, 0.18, 0.20), (0.22, 0.38, 0.25), (0.18, 0.70, 0.26)], 0.014, "rubber")
    add_sphere(root, m, "arming_switch", (0.17, 0.18, 0.29), 0.045, "energy_red", scale=(0.45, 1.0, 1.0))
    add_wear(root, m, "launcher", [((0, 0.33, 0.312), (0.11, 0.30, 0.012)), ((0, 0.83, 0.312), (0.09, 0.19, 0.012))])
    add_cylinder(root, m, "rocket_round", (0, -0.05, 0.16), 0.105, 0.96, "dark_metal", vertices=12)


def build_revolver(root, m):
    # Ржавый револьвер (Т2): трубчатая коробка, открытый барабан с каморами,
    # рама из гнутых полос, курок со шпорой, деревянная рукоять на болтах.
    # Барабан назван cylinder — его двигает анимация перезарядки.
    add_cylinder(root, m, "receiver_tube", (0, 0.05, 0.20), 0.055, 0.38, "dark_metal", vertices=20, bevel=0.005)
    add_cylinder(root, m, "receiver_collar", (0, 0.225, 0.20), 0.061, 0.05, "rust", vertices=20, bevel=0.005)
    add_cylinder(root, m, "barrel", (0, 0.42, 0.20), 0.040, 0.40, "metal", vertices=20, bevel=0.003)
    add_cylinder(root, m, "muzzle", (0, 0.645, 0.20), 0.047, 0.055, "dark_metal", vertices=20, bevel=0.004)
    add_torus(root, m, "barrel_band", (0, 0.315, 0.20), 0.049, 0.010, "brass")
    add_box(root, m, "barrel_band_screw", (0.058, 0.315, 0.245), (0.018, 0.03, 0.045), "brass", bevel=0.003)
    add_cylinder(root, m, "cylinder", (0, 0.075, 0.115), 0.088, 0.15, "metal", vertices=12, bevel=0.006)
    for index in range(5):
        a = index * math.pi * 2 / 5
        add_cylinder(root, m, f"chamber_{index + 1:02d}",
                     (0.05 * math.cos(a), 0.155, 0.115 + 0.05 * math.sin(a)),
                     0.017, 0.014, "dark_metal", vertices=10)
    for index in range(6):
        a = index * math.pi / 3
        add_box(root, m, f"drum_rib_{index + 1:02d}",
                (0.085 * math.cos(a), 0.075, 0.115 + 0.085 * math.sin(a)),
                (0.014, 0.13, 0.02), "dark_metal", rotation=(a, 0, 0), bevel=0.003)
    add_cylinder(root, m, "drum_axis", (0, 0.09, 0.115), 0.014, 0.20, "brass", vertices=10)
    add_curve_tube(root, m, "frame_strap_front", [
        (0, 0.185, 0.245), (0, 0.215, 0.10), (0, 0.185, -0.005), (0, 0.06, -0.05),
    ], 0.012, "dark_metal")
    add_curve_tube(root, m, "frame_strap_rear", [
        (0, -0.125, 0.235), (0, -0.165, 0.10), (0, -0.115, -0.02),
    ], 0.011, "dark_metal")
    add_box(root, m, "hammer", (0, -0.20, 0.225), (0.04, 0.10, 0.042), "metal", rotation=(0.55, 0, 0), bevel=0.005)
    add_box(root, m, "hammer_spur", (0, -0.245, 0.262), (0.055, 0.045, 0.018), "rust", rotation=(0.25, 0, 0), bevel=0.004)
    add_box(root, m, "grip", (0, -0.045, -0.17), (0.17, 0.28, 0.40), "wood", rotation=(0.20, 0, 0.02), bevel=0.03)
    add_box(root, m, "grip_panel_left", (-0.092, -0.05, -0.16), (0.016, 0.22, 0.28), "leather", rotation=(0.20, 0, 0.02), bevel=0.006)
    add_box(root, m, "grip_panel_right", (0.092, -0.05, -0.16), (0.016, 0.22, 0.28), "leather", rotation=(0.20, 0, 0.02), bevel=0.006)
    add_box(root, m, "grip_butt", (0, -0.105, -0.365), (0.19, 0.30, 0.05), "wood", rotation=(0.20, 0, 0.02), bevel=0.012)
    add_screws(root, m, "grip", [(-0.102, -0.03, -0.10), (0.102, -0.075, -0.23)])
    add_trigger_group(root, m, (0, 0.095, -0.04), 0.92)
    add_box(root, m, "front_sight", (0, 0.60, 0.258), (0.026, 0.04, 0.05), "metal", bevel=0.003)
    add_box(root, m, "rear_sight", (0, -0.095, 0.262), (0.05, 0.028, 0.034), "rust", rotation=(0, 0, 0.05), bevel=0.004)
    add_wear(root, m, "revolver", [
        ((0.052, -0.02, 0.215), (0.01, 0.12, 0.05)),
        ((0.062, 0.075, 0.155), (0.012, 0.08, 0.05)),
    ])


def build_sawed_off_shotgun(root, m):
    # Обрез двустволки (Т2): два ствола бок о бок, грубо спиленные, наружные
    # курки, рукоять-пистолетка из приклада. Оружие ближнего разговора.
    for side, name in ((-1, "barrel"), (1, "barrel_right")):
        add_cylinder(root, m, name, (side * 0.046, 0.20, 0.16), 0.041, 0.50, "metal", vertices=18, bevel=0.003)
    add_box(root, m, "muzzle", (0, 0.44, 0.16), (0.19, 0.045, 0.105), "dark_metal", bevel=0.006)
    add_box(root, m, "barrel_rib", (0, 0.19, 0.208), (0.02, 0.46, 0.018), "dark_metal", bevel=0.003)
    add_torus(root, m, "barrel_wrap", (0, 0.07, 0.16), 0.095, 0.009, "metal", rotation=(math.pi / 2, 0, 0))
    add_box(root, m, "breech_block", (0, -0.05, 0.15), (0.20, 0.17, 0.17), "rust", bevel=0.012)
    add_cylinder(root, m, "hinge_pin", (0, 0.035, 0.085), 0.022, 0.22, "brass", direction="X", vertices=10)
    for side, name in ((-1, "hammer_left"), (1, "hammer_right")):
        add_box(root, m, name, (side * 0.055, -0.145, 0.215), (0.032, 0.085, 0.038), "metal", rotation=(0.55, 0, 0), bevel=0.004)
    add_box(root, m, "forend", (0, 0.14, 0.075), (0.16, 0.24, 0.09), "wood", bevel=0.02)
    add_box(root, m, "grip", (0, -0.16, -0.075), (0.16, 0.24, 0.28), "wood", rotation=(0.42, 0, 0.02), bevel=0.028)
    add_box(root, m, "grip_butt", (0, -0.235, -0.20), (0.18, 0.26, 0.05), "wood", rotation=(0.42, 0, 0.02), bevel=0.012)
    add_grip_ribs(root, m, "sawed_grip", (0, -0.165, -0.09), (0.17, 0.20, 0.20), material="leather", count=4, axis="Z")
    add_screws(root, m, "sawed", [(-0.095, -0.14, -0.05), (0.095, -0.19, -0.14)])
    add_trigger_group(root, m, (0, -0.05, -0.045), 0.9)
    add_sphere(root, m, "front_bead", (0, 0.455, 0.222), 0.013, "brass")
    add_cylinder(root, m, "reload_shell", (0.05, -0.02, 0.235), 0.030, 0.075, "brass", direction="Y", vertices=12)
    add_wear(root, m, "sawedOff", [
        ((-0.085, 0.20, 0.185), (0.01, 0.16, 0.04)),
        ((0.096, -0.05, 0.15), (0.012, 0.09, 0.06)),
    ])


def build_smg(root, m):
    # Самодельный пистолет-пулемёт (Т3): коробка из гнутого листа, кожух с
    # прорезями, рожок вниз, приклад из гнутого прутка. Трещотка пустоши.
    add_box(root, m, "receiver", (0, 0.05, 0.14), (0.155, 0.55, 0.15), "dark_metal", bevel=0.012)
    add_box(root, m, "ejection_port", (0.081, 0.10, 0.155), (0.012, 0.14, 0.07), "rubber", bevel=0.003)
    add_cylinder(root, m, "barrel", (0, 0.44, 0.15), 0.032, 0.36, "metal", vertices=18, bevel=0.003)
    add_cylinder(root, m, "shroud", (0, 0.40, 0.15), 0.050, 0.28, "rust", vertices=18, bevel=0.004)
    add_heat_vents(root, m, "smg_shroud", (0.32, 0.40, 0.48), 0.203, 0.11, material="dark_metal")
    add_cylinder(root, m, "muzzle", (0, 0.635, 0.15), 0.038, 0.045, "dark_metal", vertices=16, bevel=0.004)
    add_box(root, m, "magazine", (0, 0.145, -0.06), (0.085, 0.15, 0.34), "dark_metal", rotation=(0.07, 0, 0), bevel=0.01)
    add_box(root, m, "magazine_base", (0, 0.125, -0.235), (0.10, 0.17, 0.03), "rubber", rotation=(0.07, 0, 0), bevel=0.006)
    add_box(root, m, "charging_handle", (0.095, -0.06, 0.16), (0.045, 0.04, 0.035), "brass", bevel=0.004)
    add_box(root, m, "grip", (0, -0.16, -0.10), (0.15, 0.22, 0.30), "wood", rotation=(0.25, 0, 0.015), bevel=0.026)
    add_grip_ribs(root, m, "smg_grip", (0, -0.155, -0.09), (0.16, 0.18, 0.18), material="leather", count=4, axis="Z")
    add_trigger_group(root, m, (0, -0.015, -0.03), 0.9)
    add_curve_tube(root, m, "wire_stock", [
        (0.05, -0.30, 0.10), (0.05, -0.46, 0.075), (0.05, -0.485, -0.03),
        (-0.05, -0.485, -0.03), (-0.05, -0.46, 0.075), (-0.05, -0.30, 0.10),
    ], 0.012, "metal")
    add_box(root, m, "stock_plate", (0, -0.49, 0.02), (0.115, 0.028, 0.13), "rust", bevel=0.005)
    add_screws(root, m, "smg", [(-0.083, 0.02, 0.14), (0.083, 0.16, 0.10)])
    add_box(root, m, "front_sight", (0, 0.58, 0.20), (0.024, 0.035, 0.05), "metal", bevel=0.003)
    add_box(root, m, "rear_sight", (0, -0.17, 0.225), (0.05, 0.026, 0.036), "rust", bevel=0.004)
    add_wear(root, m, "smg", [
        ((0.079, 0.05, 0.145), (0.01, 0.13, 0.05)),
        ((-0.045, 0.40, 0.202), (0.03, 0.10, 0.01)),
    ])


def build_knife(root, m):
    add_prism(root, m, "blade", [(0, 0.02), (-0.085, 0.18), (-0.074, 0.68), (-0.045, 0.81), (0, 0.92), (0.074, 0.70), (0.084, 0.18)], 0.048, "metal")
    add_prism(root, m, "blade_fuller_left", [(-0.043, 0.18), (-0.040, 0.66), (-0.020, 0.76), (-0.015, 0.20)], 0.052, "dark_metal")
    add_prism(root, m, "blade_fuller_right", [(0.043, 0.18), (0.040, 0.66), (0.020, 0.76), (0.015, 0.20)], 0.052, "dark_metal")
    for index, y in enumerate((0.58, 0.64, 0.70, 0.76), start=1):
        add_prism(root, m, f"spine_serration_{index:02d}", [(-0.075, y), (-0.105, y + 0.025), (-0.075, y + 0.05)], 0.05, "dark_metal")
    add_box(root, m, "guard", (0, -0.02, 0), (0.32, 0.085, 0.10), "brass", bevel=0.014)
    add_box(root, m, "guard_tip_left", (-0.17, -0.02, 0), (0.055, 0.07, 0.12), "dark_metal", rotation=(0, 0, -0.20), bevel=0.010)
    add_box(root, m, "guard_tip_right", (0.17, -0.02, 0), (0.055, 0.07, 0.12), "dark_metal", rotation=(0, 0, 0.20), bevel=0.010)
    add_box(root, m, "grip", (0, -0.23, 0), (0.18, 0.40, 0.16), "leather", bevel=0.028)
    for y in (-0.34, -0.26, -0.18, -0.10):
        add_box(root, m, f"grip_wrap_{y:+.2f}", (0, y, 0), (0.195, 0.040, 0.175), "rubber", rotation=(0.05, 0, 0.06), bevel=0.007)
    add_cylinder(root, m, "pommel", (0, -0.46, 0), 0.095, 0.085, "dark_metal", vertices=24, bevel=0.006)
    add_torus(root, m, "lanyard_ring", (0, -0.51, 0), 0.060, 0.012, "brass", rotation=(0, math.pi / 2, 0))


def build_pickaxe(root, m):
    add_cone(root, m, "handle", (0, 0.30, 0), (0.050, 0.063), 1.52, "wood", vertices=20)
    add_cylinder(root, m, "grip", (0, -0.38, 0), 0.070, 0.40, "leather", vertices=20, bevel=0.005)
    add_grip_ribs(root, m, "pickaxe_grip", (0, -0.38, 0), (0.145, 0.36, 0.145), count=7)
    add_box(root, m, "head_socket", (0, 1.08, 0), (0.20, 0.19, 0.19), "dark_metal", bevel=0.028)
    add_cone(root, m, "pick_left", (-0.38, 1.08, 0), (0.125, 0.012), 0.68, "metal", direction="X", vertices=16)
    add_cone(root, m, "pick_right", (0.38, 1.08, 0), (0.125, 0.024), 0.68, "metal", direction="X", vertices=16)
    add_box(root, m, "pick_wedge", (0, 1.18, 0), (0.15, 0.06, 0.21), "brass", bevel=0.010)
    add_box(root, m, "head_collar_front", (0, 0.96, 0), (0.14, 0.12, 0.14), "metal", bevel=0.018)
    add_curve_tube(root, m, "head_lashing", [(-0.075, 0.88, 0.07), (0.075, 0.96, 0.07), (-0.075, 1.04, 0.07), (0.075, 1.12, 0.07)], 0.014, "leather")
    add_box(root, m, "handle_wear", (0, 0.12, 0.062), (0.045, 0.25, 0.014), "bone", bevel=0.004)


def build_axe(root, m):
    add_cone(root, m, "handle", (0, 0.26, 0), (0.052, 0.066), 1.42, "wood", vertices=20)
    add_cylinder(root, m, "grip", (0, -0.37, 0), 0.073, 0.43, "leather", vertices=20, bevel=0.005)
    add_grip_ribs(root, m, "axe_grip", (0, -0.37, 0), (0.15, 0.39, 0.15), count=7)
    add_box(root, m, "head_socket", (0, 1.01, 0), (0.21, 0.22, 0.21), "dark_metal", bevel=0.03)
    add_prism(root, m, "blade", [(0.0, 0.85), (0.36, 0.86), (0.49, 0.94), (0.54, 1.04), (0.48, 1.16), (0.38, 1.24), (0.0, 1.17)], 0.095, "metal")
    add_prism(root, m, "blade_bevel", [(0.30, 0.89), (0.49, 0.96), (0.52, 1.04), (0.46, 1.14), (0.31, 1.20)], 0.102, "bone")
    add_box(root, m, "rear_hammer", (-0.25, 1.02, 0), (0.34, 0.18, 0.16), "dark_metal", bevel=0.021)
    add_box(root, m, "head_wedge", (0, 1.14, 0), (0.16, 0.07, 0.22), "brass", bevel=0.010)
    add_curve_tube(root, m, "axe_lashing", [(-0.075, 0.82, 0.07), (0.075, 0.90, 0.07), (-0.075, 0.98, 0.07), (0.075, 1.06, 0.07)], 0.014, "leather")
    add_wear(root, m, "axe", [((0.29, 1.03, 0.052), (0.18, 0.12, 0.012))])


def build_hand_pump(root, m):
    add_cylinder(root, m, "pump_tube", (0, 0.29, 0.03), 0.074, 1.20, "metal", vertices=24, bevel=0.006)
    add_cylinder(root, m, "inner_rod", (0, -0.18, 0.03), 0.035, 0.55, "dark_metal", vertices=20)
    add_cylinder(root, m, "nozzle", (0, 0.96, 0.03), 0.047, 0.22, "dark_metal", vertices=24, bevel=0.005)
    add_cone(root, m, "nozzle_tip", (0, 1.09, 0.03), (0.045, 0.025), 0.08, "brass", vertices=20)
    add_box(root, m, "pump_handle", (0, -0.35, 0.03), (0.54, 0.14, 0.16), "wood", bevel=0.030)
    add_cylinder(root, m, "handle_grip_left", (-0.20, -0.35, 0.03), 0.075, 0.22, "leather", direction="X", vertices=20, bevel=0.005)
    add_cylinder(root, m, "handle_grip_right", (0.20, -0.35, 0.03), 0.075, 0.22, "leather", direction="X", vertices=20, bevel=0.005)
    add_box(root, m, "side_grip", (0.14, 0.12, -0.15), (0.15, 0.28, 0.41), "leather", rotation=(0.16, 0, 0), bevel=0.026)
    add_grip_ribs(root, m, "pump_side_grip", (0.14, 0.12, -0.15), (0.16, 0.24, 0.35), count=6, axis="Z")
    add_cylinder(root, m, "pressure_ring", (0, 0.72, 0.03), 0.098, 0.085, "brass", vertices=24, bevel=0.005)
    add_box(root, m, "foot_plate", (0, 0.89, -0.10), (0.44, 0.16, 0.085), "dark_metal", bevel=0.018)
    foot_pad = add_box(root, m, "foot_pad", (0, 0.89, -0.15), (0.38, 0.14, 0.035), "rubber", bevel=0.009)
    deterministic_planar_uv(foot_pad)
    add_curve_tube(root, m, "pump_hose", [(0.07, 0.70, 0.05), (0.18, 0.78, 0.10), (0.22, 0.93, 0.03), (0.11, 1.03, 0.03)], 0.020, "rubber")
    add_sphere(root, m, "pressure_gauge", (-0.12, 0.65, 0.13), 0.075, "dark_metal", scale=(0.35, 1.0, 1.0))
    add_cylinder(root, m, "gauge_face", (-0.148, 0.65, 0.13), 0.055, 0.015, "bone", direction="X", vertices=24)
    add_box(root, m, "gauge_needle", (-0.158, 0.65, 0.13), (0.008, 0.060, 0.012), "energy_red", rotation=(0.35, 0, 0), bevel=0.002)
    add_wear(root, m, "pump", [((0, 0.34, 0.105), (0.05, 0.22, 0.012))])


def build_catalog_pickaxe(root, m):
    # A forged, asymmetric mattock head and a curved timber haft replace the
    # old pair of straight cones. Keep the gameplay sockets and length.
    add_loft(root, m, "handle", [(-0.55, 0.05, -0.055, 0.055),
        (-0.05, 0.06, -0.04, 0.07), (0.60, 0.07, -0.025, 0.08),
        (1.03, 0.08, -0.035, 0.08)], "wood", bevel=0.012)
    add_cylinder(root, m, "grip", (0, -0.39, 0.01), 0.073, 0.40, "rubber", vertices=12)
    add_box(root, m, "head_socket", (0, 1.03, 0.02), (0.26, 0.24, 0.22), "paint_olive", bevel=0.025)
    add_prism(root, m, "pick_left", [(-0.07,1.15),(-0.32,1.16),(-0.55,1.07),
        (-0.73,0.82),(-0.46,0.96),(-0.20,0.98),(-0.07,0.98)], 0.105, "metal")
    add_prism(root, m, "mattock_adze", [(0.07,1.14),(0.35,1.14),(0.58,1.04),
        (0.64,0.90),(0.44,0.89),(0.25,0.99),(0.07,0.98)], 0.19, "dark_metal")
    add_box(root, m, "head_wedge", (0, 1.155, 0.02), (0.13, 0.04, 0.13), "brass", bevel=0.006)
    for y in (-0.50,-0.37,-0.24):
        add_box(root, m, f"pickaxe_safety_band_{y}", (0,y,0.01), (0.15,0.06,0.15), "rust", bevel=0.015)


def build_catalog_hand_pump(root, m):
    # A red workshop floor pump: broad foot, offset hose and an enclosed gauge.
    add_cylinder(root, m, "pump_tube", (0,0.34,0.02), 0.105, 1.02, "rust", vertices=16, bevel=0.01)
    add_cylinder(root, m, "inner_rod", (0,-0.22,0.02), 0.033, 0.40, "metal", vertices=12)
    add_box(root, m, "pump_handle", (0,-0.40,0.02), (0.59,0.16,0.15), "rubber", bevel=0.025)
    add_cylinder(root, m, "nozzle", (0,0.93,0.02), 0.042, 0.19, "brass", vertices=12)
    add_box(root, m, "foot_plate", (0,0.87,-0.10), (0.58,0.22,0.10), "dark_metal", bevel=0.018)
    add_box(root, m, "side_grip", (0.13,0.10,-0.12), (0.13,0.27,0.35), "rubber", bevel=0.026)
    add_cylinder(root, m, "pump_collar", (0,-0.13,0.02), 0.13, 0.09, "metal", vertices=16)
    add_curve_tube(root,m,"pump_hose", [(0.10,0.68,0.02),(0.28,0.60,0.02),
        (0.29,0.13,0.02),(0.24,-0.03,0.02),(0.18,0.02,0.02)],0.023,"rubber")
    add_cylinder(root,m,"pressure_gauge",(0,0.58,0.15),0.13,0.055,"dark_metal",direction="Z",vertices=16)
    add_cylinder(root,m,"gauge_face",(0,0.58,0.182),0.103,0.012,"bone",direction="Z",vertices=16)
    add_box(root,m,"gauge_needle",(0.025,0.61,0.194),(0.018,0.12,0.007),"brass",rotation=(0,0,-0.50),bevel=0.001)
    add_box(root,m,"service_label",(0,0.24,0.127),(0.10,0.25,0.012),"bone",bevel=0.004)


BUILDERS = {
    "pistol": build_pistol,
    "revolver": build_revolver,
    "sawedOffShotgun": build_sawed_off_shotgun,
    "smg": build_smg,
    "rifle": build_rifle,
    "assaultRifle": build_assault_rifle,
    "machineGun": build_machine_gun,
    "laserPistol": build_laser_pistol,
    "flamethrower": build_flamethrower,
    "plasmaRifle": build_plasma_rifle,
    "shotgun": build_shotgun,
    "rocketLauncher": build_rocket_launcher,
    "knife": build_knife,
    "pickaxe": build_catalog_pickaxe,
    "axe": build_axe,
    "handPump": build_catalog_hand_pump,
}


def add_action_track(
    obj: bpy.types.Object,
    clip_name: str,
    keyframes: list[tuple[int, tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]],
):
    action = bpy.data.actions.new(f"{obj.name}_{clip_name}")
    obj.animation_data_create()
    obj.animation_data.action = action
    for frame, location, rotation, scale in keyframes:
        obj.location = location
        obj.rotation_euler = rotation
        obj.scale = scale
        obj.keyframe_insert("location", frame=frame, group=clip_name)
        obj.keyframe_insert("rotation_euler", frame=frame, group=clip_name)
        obj.keyframe_insert("scale", frame=frame, group=clip_name)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, int(action.frame_range[0]), action)
    strip.name = clip_name
    strip.action_frame_start = action.frame_range[0]
    strip.action_frame_end = action.frame_range[1]


def animate_weapon(root: bpy.types.Object, weapon_id: str, family: str):
    zero = tuple(root.location)
    scale = tuple(root.scale)
    add_action_track(root, "idle", [
        (1, zero, (0, 0, 0), scale),
        (30, (0, 0, 0.006), (0.003, 0, 0), scale),
        (60, zero, (0, 0, 0), scale),
    ])
    kick = 0.11 if family in {"sidearm", "energy_sidearm"} else 0.18 if family in {"long_gun", "energy_long_gun"} else 0.24
    if family.startswith("melee"):
        add_action_track(root, "attack", [
            (1, zero, (-0.22, 0, 0.22), scale),
            (5, (0, 0.10, 0.04), (0.48, 0, -0.44), scale),
            (11, zero, (0, 0, 0), scale),
        ])
    else:
        add_action_track(root, "attack", [
            (1, zero, (0, 0, 0), scale),
            (3, (0, -kick, 0.025), (-kick * 0.6, 0, 0), scale),
            (9, zero, (0, 0, 0), scale),
        ])
    if family in {"sidearm", "energy_sidearm"}:
        reload_pose = ((0.015, -0.018, 0.045), (0.10, -0.10, 0.28))
    elif family in {"long_gun", "energy_long_gun"}:
        reload_pose = ((0.020, -0.025, 0.055), (0.09, -0.18, 0.22))
    elif family == "launcher":
        reload_pose = ((0.025, -0.035, 0.080), (0.12, -0.22, 0.14))
    else:
        reload_pose = ((0.030, -0.040, 0.065), (0.12, -0.16, 0.18))
    if not family.startswith("melee"):
        add_action_track(root, "reload", [
            (1, zero, (0, 0, 0), scale),
            (9, reload_pose[0], reload_pose[1], scale),
            (31, reload_pose[0], reload_pose[1], scale),
            (42, zero, (0, 0, 0), scale),
        ])

    bolt = bpy.data.objects.get("bolt") or bpy.data.objects.get("slide")
    if bolt is not None:
        base = tuple(bolt.location)
        add_action_track(bolt, "attack", [
            (1, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
            (3, (base[0], base[1] - 0.13, base[2]), tuple(bolt.rotation_euler), tuple(bolt.scale)),
            (8, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
        ])
        if weapon_id == "rifle":
            add_action_track(bolt, "reload", [
                (1, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
                (25, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
                (29, (base[0], base[1] - 0.13, base[2]), tuple(bolt.rotation_euler), tuple(bolt.scale)),
                (35, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
                (42, base, tuple(bolt.rotation_euler), tuple(bolt.scale)),
            ])
    pump = bpy.data.objects.get("pump")
    if pump is not None and weapon_id == "shotgun":
        base = tuple(pump.location)
        add_action_track(pump, "reload", [
            (1, base, tuple(pump.rotation_euler), tuple(pump.scale)),
            (29, base, tuple(pump.rotation_euler), tuple(pump.scale)),
            (33, (base[0], base[1] - 0.24, base[2]), tuple(pump.rotation_euler), tuple(pump.scale)),
            (38, base, tuple(pump.rotation_euler), tuple(pump.scale)),
            (42, base, tuple(pump.rotation_euler), tuple(pump.scale)),
        ])
    profile = WEAPON_INTERACTION_PROFILES[weapon_id]
    reload_part = bpy.data.objects.get(profile["reload_part"]) if profile["reload_part"] else None
    reload_motions = {
        # Однозарядка: казённая крышка отходит назад, стрелок вкладывает патрон.
        "pistol": (0.0, -0.22, 0.0),
        "revolver": (0.16, -0.03, -0.05),
        "sawedOffShotgun": (-0.20, -0.06, -0.05),
        "smg": (0.0, -0.04, -0.30),
        "rifle": (0.0, -0.02, 0.22),
        "assaultRifle": (0.0, -0.03, -0.30),
        "machineGun": (0.34, -0.03, -0.10),
        "laserPistol": (0.26, -0.02, 0.08),
        "flamethrower": (0.0, -0.30, -0.20),
        "plasmaRifle": (0.30, -0.02, 0.06),
        "shotgun": (-0.22, -0.10, -0.08),
        "rocketLauncher": (0.0, -0.72, 0.0),
    }
    if reload_part is not None:
        base = tuple(reload_part.location)
        base_rotation = tuple(reload_part.rotation_euler)
        base_scale = tuple(reload_part.scale)
        motion = reload_motions[weapon_id]
        service = tuple(base[index] + motion[index] for index in range(3))
        if weapon_id == "shotgun":
            hidden_scale = tuple(max(0.001, value * 0.001) for value in base_scale)
            add_action_track(reload_part, "reload", [
                (1, service, base_rotation, hidden_scale),
                (8, service, base_rotation, base_scale),
                (19, base, base_rotation, base_scale),
                (25, base, base_rotation, hidden_scale),
                (42, service, base_rotation, hidden_scale),
            ])
            reload_part.location = service
            reload_part.scale = hidden_scale
        else:
            add_action_track(reload_part, "reload", [
                (1, base, base_rotation, base_scale),
                (9, base, base_rotation, base_scale),
                (18, service, base_rotation, base_scale),
                (27, service, base_rotation, base_scale),
                (34, base, base_rotation, base_scale),
                (42, base, base_rotation, base_scale),
            ])
    core = bpy.data.objects.get("energy_core") or bpy.data.objects.get("pilot")
    if core is not None:
        base_scale = tuple(core.scale)
        add_action_track(core, "attack", [
            (1, tuple(core.location), tuple(core.rotation_euler), base_scale),
            (3, tuple(core.location), tuple(core.rotation_euler), tuple(value * 1.28 for value in base_scale)),
            (9, tuple(core.location), tuple(core.rotation_euler), base_scale),
        ])


def glb_scene_bounds(path: Path) -> tuple[list[float], list[float]]:
    """Measure the actual exported rest pose, including serialized root scale."""
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise RuntimeError(f"Invalid GLB while measuring bounds: {path}")
    json_chunk = None
    offset = 12
    while offset + 8 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], "little")
        chunk_type = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        if chunk_type == b"JSON":
            json_chunk = json.loads(chunk.rstrip(b"\0 \t\r\n").decode("utf-8"))
            break
        offset += 8 + length
    if json_chunk is None:
        raise RuntimeError(f"GLB has no JSON chunk: {path}")

    def local_matrix(node: dict[str, object]) -> Matrix:
        if "matrix" in node:
            values = node["matrix"]
            return Matrix((
                values[0:4], values[4:8], values[8:12], values[12:16]
            )).transposed()
        translation = Vector(node.get("translation", (0.0, 0.0, 0.0)))
        rotation_values = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
        rotation = Quaternion((
            rotation_values[3], rotation_values[0], rotation_values[1], rotation_values[2]
        )).to_matrix().to_4x4()
        scale_values = node.get("scale", (1.0, 1.0, 1.0))
        scale = Matrix.Diagonal(Vector((*scale_values, 1.0)))
        return Matrix.Translation(translation) @ rotation @ scale

    nodes = json_chunk.get("nodes", [])
    meshes = json_chunk.get("meshes", [])
    accessors = json_chunk.get("accessors", [])
    points: list[Vector] = []

    def visit(node_index: int, parent_matrix: Matrix):
        node = nodes[node_index]
        world = parent_matrix @ local_matrix(node)
        mesh_index = node.get("mesh")
        if mesh_index is not None:
            for primitive in meshes[mesh_index].get("primitives", []):
                accessor_index = primitive.get("attributes", {}).get("POSITION")
                if accessor_index is None:
                    continue
                accessor = accessors[accessor_index]
                minimum = accessor.get("min")
                maximum = accessor.get("max")
                if minimum is None or maximum is None:
                    continue
                for x in (minimum[0], maximum[0]):
                    for y in (minimum[1], maximum[1]):
                        for z in (minimum[2], maximum[2]):
                            gltf_point = world @ Vector((x, y, z))
                            # glTF is Y-up/-Z-forward; reports keep the
                            # generator's Blender +Y-forward convention.
                            points.append(Vector((gltf_point.x, -gltf_point.z, gltf_point.y)))
        for child_index in node.get("children", []):
            visit(child_index, world)

    scene_index = int(json_chunk.get("scene", 0))
    scenes = json_chunk.get("scenes", [])
    for root_index in scenes[scene_index].get("nodes", []):
        visit(root_index, Matrix.Identity(4))
    if not points:
        raise RuntimeError(f"GLB has no measurable mesh bounds: {path}")
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return [round(value, 6) for value in minimum], [round(value, 6) for value in maximum]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pilot_material(material_name: str, materials: dict[str, bpy.types.Material]):
    name = material_name.lower().replace("_", "").replace(" ", "")
    if "green" in name:
        return materials["paint_olive"]
    if "darkwood" in name or name == "wood":
        return materials["wood"]
    if "darkmetal" in name or "black" in name:
        return materials["dark_metal"]
    if "lightgrey" in name or "lightmetal" in name or "white" in name:
        return materials["bone"]
    if "yellow" in name:
        return materials["brass"]
    if "red" in name:
        return materials["rust"]
    if "main" in name:
        return materials["paint_teal"]
    if "flamethrower" in name:
        return materials["paint_olive"]
    if "grey" in name or "metal" in name or name.startswith("material"):
        return materials["metal"]
    return materials["dark_metal"]


def import_pilot_source(path: Path, config: dict[str, object]) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    if path.suffix.lower() == ".fbx":
        result = bpy.ops.import_scene.fbx(filepath=str(path))
        if "FINISHED" not in result:
            raise RuntimeError(f"Cannot import pilot FBX {path}: {result}")
        imported = [obj for obj in bpy.data.objects if obj not in before]
    elif path.suffix.lower() == ".blend":
        requested = set(config.get("body_names", {}).keys())
        with bpy.data.libraries.load(str(path), link=False) as (source, target):
            target.objects = [name for name in source.objects if name in requested]
        imported = []
        for obj in target.objects:
            if obj is None:
                continue
            bpy.context.collection.objects.link(obj)
            imported.append(obj)
    else:
        raise RuntimeError(f"Unsupported pilot source format: {path}")

    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"Pilot source has no mesh objects: {path}")
    return meshes


def move_muzzle_to_donor(root: bpy.types.Object, donor_objects: list[bpy.types.Object]):
    muzzle = bpy.data.objects.get("muzzle")
    if muzzle is None:
        return
    points = [
        obj.matrix_basis @ vertex.co
        for obj in donor_objects
        for vertex in obj.data.vertices
    ]
    if not points:
        return
    minimum_y = min(point.y for point in points)
    maximum_y = max(point.y for point in points)
    front_band = max(0.012, (maximum_y - minimum_y) * 0.035)
    front = [point for point in points if point.y >= maximum_y - front_band]
    front_x = sum(point.x for point in front) / len(front)
    front_z = sum(point.z for point in front) / len(front)
    muzzle_corners = [muzzle.matrix_basis @ Vector(corner) for corner in muzzle.bound_box]
    muzzle_tip = max(point.y for point in muzzle_corners)
    muzzle_x = sum(point.x for point in muzzle_corners) / len(muzzle_corners)
    muzzle_z = sum(point.z for point in muzzle_corners) / len(muzzle_corners)
    muzzle.location += Vector((front_x - muzzle_x, maximum_y - muzzle_tip, front_z - muzzle_z))


def apply_pilot_donor(
    root: bpy.types.Object,
    weapon_id: str,
    materials: dict[str, bpy.types.Material],
) -> dict[str, object] | None:
    config = PILOT_DONORS.get(weapon_id)
    if config is None:
        return None
    source_root = REPOSITORY_ROOT / "source-assets" / "weapons" / "pilot"
    relative_path = Path(str(config["path"]))
    source = source_root / relative_path
    if not source.is_file():
        raise RuntimeError(f"Pilot source is missing: {source}")
    actual_hash = file_sha256(source)
    if actual_hash != config["sha256"]:
        raise RuntimeError(
            f"Pilot source hash drifted for {weapon_id}: {actual_hash} != {config['sha256']}"
        )

    keep = set(config["keep"])
    for child in list(root.children):
        if child.name not in keep:
            bpy.data.objects.remove(child, do_unlink=True)

    donor_objects = import_pilot_source(source, config)
    # Split connected source parts before normalizing the donor. Reloading must
    # move the visible magazine/cylinder/pump rather than an overlapping old part.
    separated = []
    for obj in donor_objects:
        if not config.get("parts"):
            continue
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.animation_data_clear()
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        unseen = set(bm.verts)
        selections = {index: set() for index in range(len(config["parts"]))}
        while unseen:
            seed = min(unseen, key=lambda v: v.index)
            todo, island = [seed], {seed}
            while todo:
                for edge in todo.pop().link_edges:
                    for vertex in edge.verts:
                        if vertex not in island:
                            island.add(vertex)
                            todo.append(vertex)
            unseen -= island
            for index, part in enumerate(config["parts"]):
                if all(all(part["min"][axis] <= v.co[axis] <= part["max"][axis]
                           for axis in range(3)) for v in island):
                    selections[index].update(island)
                    break
        removed = set()
        for index, selected in selections.items():
            if not selected:
                raise RuntimeError(f"{weapon_id}: source part selection {index} is empty")
            part_name = config["parts"][index]["name"]
            if part_name:
                part_bm = bm.copy()
                selected_indices = {v.index for v in selected}
                bmesh.ops.delete(part_bm, geom=[v for v in part_bm.verts if v.index not in selected_indices], context="VERTS")
                mesh = bpy.data.meshes.new(f"{weapon_id}_{part_name}_CC0")
                part_bm.to_mesh(mesh)
                part_bm.free()
                for material in obj.data.materials:
                    mesh.materials.append(material)
                part_obj = bpy.data.objects.new(f"source_{part_name}", mesh)
                bpy.context.collection.objects.link(part_obj)
                part_obj["runtime_part_name"] = part_name
                separated.append(part_obj)
            removed.update(selected)
        bmesh.ops.delete(bm, geom=list(removed), context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
    donor_objects.extend(separated)
    axis, angle = config["rotation"]
    rotation = Matrix.Rotation(float(angle), 4, str(axis))
    raw_points = [
        rotation @ (obj.matrix_world @ vertex.co)
        for obj in donor_objects
        for vertex in obj.data.vertices
    ]
    raw_length = max(point.y for point in raw_points) - min(point.y for point in raw_points)
    runtime_scale = WEAPON_RUNTIME_SCALES[weapon_id]
    geometry_scale = float(config["runtime_length"]) / runtime_scale / raw_length
    source_anchor = rotation @ Vector(config["anchor"])
    target_anchor = Vector(WEAPON_INTERACTION_PROFILES[weapon_id]["grip_r"])
    translation = target_anchor - source_anchor * geometry_scale
    transform_scale = Matrix.Scale(geometry_scale, 4)

    for obj in donor_objects:
        baked = obj.data.copy()
        baked.name = f"{clean_name(weapon_id)}_{obj.data.name}_CC0"
        baked.transform(
            Matrix.Translation(translation)
            @ transform_scale
            @ rotation
            @ obj.matrix_world
        )
        obj.data = baked
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        obj.animation_data_clear()
        obj.hide_render = False
        for index, slot in enumerate(obj.material_slots):
            source_name = slot.material.name if slot.material else ""
            override = config.get("material_overrides", {}).get(source_name.split(".")[0])
            obj.data.materials[index] = materials[override] if override else pilot_material(source_name, materials)

    for obj in separated:
        part_name = obj["runtime_part_name"]
        previous = bpy.data.objects.get(part_name)
        if previous is not None:
            bpy.data.objects.remove(previous, do_unlink=True)
        center = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
        obj.data.transform(Matrix.Translation(-center))
        obj.location = center
        obj.name = part_name
        obj["realm_weapon_part"] = part_name

    def donor_point(point):
        return translation + rotation @ Vector(point) * geometry_scale

    bpy.context.view_layer.update()
    for part_name, point in config.get("detail_anchors", {}).items():
        detail = bpy.data.objects.get(part_name)
        if detail is not None:
            # Some authored parts (curves and baked spheres) carry their offset
            # in vertices rather than the object origin. Align the visible part.
            corners = [detail.matrix_basis @ Vector(corner) for corner in detail.bound_box]
            center = sum(corners, Vector()) / len(corners)
            detail.location += donor_point(point) - center
    if config.get("support_anchor"):
        WEAPON_INTERACTION_PROFILES[weapon_id]["grip_l"] = tuple(donor_point(config["support_anchor"]))

    body_names = config.get("body_names")
    if body_names:
        for obj in donor_objects:
            source_name = obj.name
            obj.name = str(body_names.get(source_name, f"pilot_{weapon_id}_{source_name}_cc0"))
            obj["realm_weapon_part"] = obj.name.lower()
            if obj.name == "rocket_round":
                # The source projectile is a separate mesh, but its authored
                # origin sits at the file origin. Keep the visible geometry in
                # place while restoring the reachable reload pivot used by the
                # character rig and reload animation.
                reload_origin = Vector((0.0, -0.05, 0.16))
                obj.data.transform(Matrix.Translation(-reload_origin))
                obj.location = reload_origin
    else:
        donor_objects[0].name = str(config["body_name"])
        donor_objects[0]["realm_weapon_part"] = "pilot_donor_body"
        for index, obj in enumerate([o for o in donor_objects[1:] if o not in separated], start=2):
            obj.name = f"pilot_{weapon_id}_part_{index:02d}_cc0"
            obj["realm_weapon_part"] = "pilot_donor_body"

    muzzle_donors = [obj for obj in donor_objects if obj.name != "rocket_round"]
    if weapon_id in CATALOG_REPLACEMENTS["weapons"]:
        # The imported barrel already has its full silhouette; the old large
        # muzzle sleeve is only a small bore cap on these donors.
        muzzle_part = bpy.data.objects.get("muzzle")
        if muzzle_part is not None:
            muzzle_part.scale *= 0.55
    move_muzzle_to_donor(root, muzzle_donors)
    root["realm_source_license"] = "CC0-1.0"
    root["realm_source_creator"] = config["creator"]
    root["realm_source_pack"] = config["pack"]
    root["realm_source_page"] = config["page"]
    root["realm_source_file"] = relative_path.as_posix()
    root["realm_source_sha256"] = actual_hash
    root["realm_model_revision"] = 3
    root["realm_pilot_family"] = next(family for wid, family, _label in WEAPONS if wid == weapon_id)
    return {
        "creator": config["creator"],
        "pack": config["pack"],
        "page": config["page"],
        "license": "CC0-1.0",
        "file": relative_path.as_posix(),
        "sha256": actual_hash,
    }


def mount_retained_details(root, weapon_id):
    """Repair actual surface contact and preserve coherent moving assemblies."""
    bpy.context.view_layer.update()
    root_inverse = root.matrix_world.inverted()

    def mesh_points(obj):
        mesh = obj.to_mesh()
        mesh.calc_loop_triangles()
        transform = root_inverse @ obj.matrix_world
        points = [transform @ v.co for v in mesh.vertices]
        triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
        obj.to_mesh_clear()
        return points, triangles

    # Seat the gauge face on its existing housing before moving the whole
    # gauge assembly to the fuel bottle.
    if weapon_id == "flamethrower":
        housing = bpy.data.objects.get("pressure_gauge")
        face = bpy.data.objects.get("gauge_face")
        if housing is not None and face is not None:
            matrix = face.matrix_world.copy()
            face.parent = housing
            face.matrix_world = matrix

    for detail_name, surface_name in SURFACE_MOUNTS.get(weapon_id, {}).items():
        detail = bpy.data.objects.get(detail_name)
        surface = bpy.data.objects.get(surface_name)
        if detail is None or surface is None:
            raise RuntimeError(f"{weapon_id}: mounting pair missing: {detail_name}/{surface_name}")
        surface_points, surface_triangles = mesh_points(surface)
        detail_points, detail_triangles = mesh_points(detail)
        target = BVHTree.FromPolygons(surface_points, surface_triangles, all_triangles=True)
        source = BVHTree.FromPolygons(detail_points, detail_triangles, all_triangles=True)
        if not source.overlap(target):
            best = None
            for point in detail_points:
                hit, normal, index, distance = target.find_nearest(point)
                if hit is not None and (best is None or distance < best[0]):
                    best = distance, hit - point
            if best is None:
                raise RuntimeError(f"{weapon_id}: no mounting surface for {detail_name}")
            if best[0] > 0.0001:
                # Half a millimetre of seating avoids a hairline gap after
                # GLB compression. Move in root space, not in scaled bone space.
                offset = best[1] + best[1].normalized() * (0.0005 / WEAPON_RUNTIME_SCALES[weapon_id])
                detail.matrix_world.translation += root.matrix_world.to_3x3() @ offset
                bpy.context.view_layer.update()
        detail["realm_mount_surface"] = surface_name

    if weapon_id == "laserPistol":
        # The focusing collar must be coaxial with the imported muzzle, not
        # hang below the new emitter at the procedural barrel's old height.
        ring = bpy.data.objects.get("emitter_ring")
        muzzle = bpy.data.objects.get("muzzle")
        ring_points, _ = mesh_points(ring)
        muzzle_points, _ = mesh_points(muzzle)
        def center(points):
            return (Vector([min(p[a] for p in points) for a in range(3)])
                    + Vector([max(p[a] for p in points) for a in range(3)])) * 0.5
        ring.matrix_world.translation += root.matrix_world.to_3x3() @ (center(muzzle_points) - center(ring_points))
        bpy.context.view_layer.update()

    if weapon_id == "flamethrower":
        pilot = bpy.data.objects.get("pilot")
        muzzle = bpy.data.objects.get("muzzle")
        points, _ = mesh_points(muzzle)
        target = Vector((sum(p.x for p in points) / len(points),
                         max(p.y for p in points) - 0.02,
                         sum(p.z for p in points) / len(points)))
        points, _ = mesh_points(pilot)
        center = (Vector([min(p[a] for p in points) for a in range(3)])
                  + Vector([max(p[a] for p in points) for a in range(3)])) * 0.5
        pilot.location += target - center
        bpy.context.view_layer.update()

    for child_name, parent_name in PART_ATTACHMENTS.get(weapon_id, {}).items():
        child = bpy.data.objects.get(child_name)
        parent = bpy.data.objects.get(parent_name)
        if child is None or parent is None:
            raise RuntimeError(f"{weapon_id}: attachment missing: {child_name}/{parent_name}")
        world = child.matrix_world.copy()
        child.parent = parent
        child.matrix_world = world
        child["realm_attachment_parent"] = parent_name
        if child_name == "pilot":
            child["realm_attachment_allow_scale"] = True  # ignition glow, not hardware
    root["realm_attachment_revision"] = 1
    bpy.context.view_layer.update()


def quantize_uv_layers(step: float = 1.0 / 8192.0):
    # Упаковка островов в smart_project многопоточна и оставляет в UV дрожь
    # последнего бита float32 (~1.2e-7): одинаковые исходники давали разные
    # байты GLB, и отпечаток библиотеки не сходился между пересборками.
    # Квантование с шагом 1/8192 стирает дрожь; на текстурах 256px этот шаг
    # невидим. После него сборка детерминирована байт в байт.
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.uv_layers:
            continue
        for layer in obj.data.uv_layers:
            for item in layer.data:
                # floor со смещённой границей вместо round: упаковщик любит
                # класть координаты ровно на половину шага, и дрожь последнего
                # бита перекидывала округление туда-сюда между прогонами.
                item.uv.x = math.floor(item.uv.x / step + 0.5 + 1e-3) * step
                item.uv.y = math.floor(item.uv.y / step + 0.5 + 1e-3) * step


def export_weapon(output: Path):
    quantize_uv_layers()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_copyright="Realm of Ashes runtime weapon catalog; CC0 pilot donors are listed in the manifest.",
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=False,
        export_morph=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {output}: {result}")


def build_one(weapon_id: str, family: str, label: str, output: Path, texture_size: int) -> dict[str, object]:
    clear_weapon_scene()
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.render.fps = 30
    materials = make_materials(texture_size)
    root = bpy.data.objects.new(f"WEAPON_{clean_name(weapon_id)}", None)
    bpy.context.collection.objects.link(root)
    root["realm_schema"] = "realm.weapon-runtime.v1"
    root["realm_weapon_id"] = weapon_id
    root["realm_model_revision"] = 3
    root["realm_animation_family"] = family
    root["realm_art_direction"] = "geometry_b_materials_c"
    root["realm_interaction_profile"] = "physical_grips_reload_v2"
    runtime_scale = WEAPON_RUNTIME_SCALES[weapon_id]
    root["realm_runtime_scale"] = runtime_scale
    root.scale = (runtime_scale, runtime_scale, runtime_scale)
    BUILDERS[weapon_id](root, materials)
    pilot_source = apply_pilot_donor(root, weapon_id, materials)
    mount_retained_details(root, weapon_id)
    interaction = add_weapon_interaction_sockets(root, weapon_id)
    root["realm_reload_kind"] = interaction["reloadKind"]
    animate_weapon(root, weapon_id, family)
    bpy.context.view_layer.update()
    export_weapon(output.resolve())
    minimum, maximum = glb_scene_bounds(output.resolve())
    return {
        "id": weapon_id,
        "label": label,
        "family": family,
        "runtimeScale": runtime_scale,
        "output": str(output.resolve()),
        "meshes": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
        "materials": len(bpy.data.materials),
        "animations": ["idle", "attack"] + ([] if family.startswith("melee") else ["reload"]),
        "gripSockets": interaction["sockets"],
        "reloadKind": interaction["reloadKind"],
        "reloadPart": interaction["reloadPart"],
        "boundsBlender": {"min": minimum, "max": maximum},
        "pilotFamily": family if pilot_source else None,
        "modelRevision": 3,
        "source": pilot_source,
    }


def main():
    args = parse_args()
    output_directory = args.output_directory.resolve()
    texture_size = max(32, min(256, int(args.texture_size)))
    reports = []
    for weapon_id, family, label in WEAPONS:
        if args.weapon and weapon_id not in args.weapon:
            continue
        reports.append(
            build_one(
                weapon_id,
                family,
                label,
                output_directory / f"weapon_{weapon_id}.glb",
                texture_size,
            )
        )
    report = {
        "schema": "realm.weapon-runtime-build.v2",
        "textureSize": texture_size,
        "models": reports,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        "REALM_WEAPON_BUILD="
        + json.dumps(report, ensure_ascii=False, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
