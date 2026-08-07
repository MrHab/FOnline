"""Build the complete Realm of Ashes runtime weapon library.

The models are authored procedurally so every shipped GLB can be reproduced
without editing binary assets by hand. Blender coordinates use +Y as the
weapon's forward axis; the glTF exporter converts that to the client's -Z axis.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector


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
    ("knife", "melee_light", "combat knife"),
    ("pickaxe", "melee_heavy", "pickaxe"),
    ("axe", "melee_heavy", "axe"),
    ("handPump", "melee_heavy", "hand pump"),
)

WEAPON_RUNTIME_SCALES = {
    "pistol": 0.34,
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

WEAPON_INTERACTION_PROFILES = {
    "pistol": {"grip_r": (0, -0.04, -0.17), "grip_l": (-0.10, -0.015, -0.13), "reload": (0, -0.04, -0.28), "reload_kind": "magazine", "reload_part": "magazine"},
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
    "brass": ((0.34, 0.22, 0.075, 1.0), (0.68, 0.49, 0.19, 1.0), 0.48, 0.68),
    "rust": ((0.25, 0.07, 0.025, 1.0), (0.55, 0.19, 0.055, 1.0), 0.9, 0.06),
    "bone": ((0.45, 0.40, 0.31, 1.0), (0.71, 0.66, 0.52, 1.0), 0.88, 0.0),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--texture-size", type=int, default=96)
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
    vertices=10,
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
    vertices=10,
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


def build_pistol(root, m):
    add_box(root, m, "receiver", (0, 0.22, 0.08), (0.22, 0.48, 0.18), "dark_metal", bevel=0.025)
    add_box(root, m, "slide", (0, 0.25, 0.19), (0.19, 0.53, 0.12), "metal", bevel=0.018)
    add_cylinder(root, m, "muzzle", (0, 0.55, 0.18), 0.055, 0.18, "dark_metal")
    add_box(root, m, "grip", (0, -0.04, -0.17), (0.18, 0.30, 0.39), "leather", rotation=(0.20, 0, 0), bevel=0.025)
    add_box(root, m, "magazine", (0, -0.055, -0.245), (0.105, 0.19, 0.24), "dark_metal", rotation=(0.20, 0, 0), bevel=0.012)
    add_torus(root, m, "trigger_guard", (0, 0.12, -0.06), 0.09, 0.018, "brass")
    add_box(root, m, "front_sight", (0, 0.46, 0.28), (0.035, 0.055, 0.065), "brass", bevel=0.005)
    add_screws(root, m, "pistol", [(-0.112, 0.05, 0.10), (0.112, 0.34, 0.10)])


def build_rifle(root, m):
    add_prism(root, m, "stock", [(-0.15, -0.52), (-0.19, -0.16), (-0.10, 0.08), (0.10, 0.08), (0.15, -0.52)], 0.20, "wood")
    add_box(root, m, "receiver", (0, 0.20, 0.10), (0.20, 0.48, 0.20), "dark_metal", bevel=0.022)
    add_cylinder(root, m, "barrel", (0, 0.92, 0.12), 0.045, 1.05, "metal", vertices=10)
    add_cylinder(root, m, "muzzle", (0, 1.49, 0.12), 0.065, 0.14, "dark_metal")
    add_box(root, m, "grip", (0, 0.04, -0.13), (0.15, 0.24, 0.32), "wood", rotation=(0.18, 0, 0), bevel=0.018)
    add_cylinder(root, m, "scope", (0, 0.48, 0.30), 0.055, 0.46, "dark_metal")
    add_cylinder(root, m, "scope_lens", (0, 0.73, 0.30), 0.061, 0.025, "energy_blue")
    add_box(root, m, "bolt", (0.14, 0.25, 0.16), (0.18, 0.055, 0.055), "brass", bevel=0.009)
    add_box(root, m, "cartridge_clip", (0, 0.18, 0.235), (0.11, 0.09, 0.12), "brass", bevel=0.008)
    add_wear(root, m, "rifle", [((0, 0.32, 0.211), (0.10, 0.16, 0.012))])


def build_assault_rifle(root, m):
    add_prism(root, m, "stock", [(-0.13, -0.48), (-0.17, -0.05), (-0.08, 0.04), (0.08, 0.04), (0.13, -0.48)], 0.17, "wood")
    add_box(root, m, "receiver", (0, 0.22, 0.09), (0.24, 0.62, 0.24), "dark_metal", bevel=0.026)
    add_box(root, m, "dust_cover", (0, 0.24, 0.225), (0.20, 0.52, 0.07), "paint_olive", bevel=0.012)
    add_cylinder(root, m, "barrel", (0, 0.86, 0.10), 0.046, 0.74, "metal")
    add_cylinder(root, m, "muzzle", (0, 1.27, 0.10), 0.074, 0.15, "dark_metal")
    add_box(root, m, "handguard", (0, 0.69, 0.07), (0.22, 0.38, 0.21), "wood", bevel=0.025)
    add_box(root, m, "grip", (0, -0.02, -0.16), (0.15, 0.24, 0.34), "leather", rotation=(0.18, 0, 0), bevel=0.02)
    magazine = add_prism(root, m, "magazine", [(-0.09, 0.04), (-0.105, 0.34), (-0.05, 0.48), (0.08, 0.43), (0.095, 0.08)], 0.18, "dark_metal")
    magazine.rotation_euler.x = math.pi / 2
    magazine.location = (0, 0.08, -0.15)
    add_screws(root, m, "assault", [(-0.125, 0.04, 0.12), (0.125, 0.35, 0.12)])
    add_wear(root, m, "assault", [((0, 0.16, 0.255), (0.13, 0.18, 0.015)), ((0, 0.72, 0.181), (0.12, 0.16, 0.012))])


def build_machine_gun(root, m):
    add_prism(root, m, "stock", [(-0.16, -0.56), (-0.20, -0.12), (-0.11, 0.02), (0.11, 0.02), (0.16, -0.56)], 0.22, "wood")
    add_box(root, m, "receiver", (0, 0.25, 0.11), (0.30, 0.76, 0.31), "dark_metal", bevel=0.032)
    add_box(root, m, "receiver_cover", (0, 0.22, 0.29), (0.27, 0.57, 0.08), "paint_olive", bevel=0.015)
    add_cylinder(root, m, "barrel_shroud", (0, 0.96, 0.13), 0.085, 0.82, "metal", vertices=12)
    add_cylinder(root, m, "muzzle", (0, 1.42, 0.13), 0.10, 0.17, "dark_metal")
    add_box(root, m, "ammo_box", (0.20, 0.20, -0.14), (0.28, 0.34, 0.37), "paint_olive", bevel=0.025)
    add_box(root, m, "grip", (0, -0.04, -0.19), (0.17, 0.25, 0.38), "leather", rotation=(0.18, 0, 0), bevel=0.02)
    add_box(root, m, "carry_handle", (0, 0.43, 0.42), (0.055, 0.38, 0.055), "brass", rotation=(0, 0.08, 0), bevel=0.01)
    add_box(root, m, "bipod_left", (-0.12, 0.82, -0.16), (0.035, 0.44, 0.035), "metal", rotation=(0.20, 0.05, 0.12), bevel=0.006)
    add_box(root, m, "bipod_right", (0.12, 0.82, -0.16), (0.035, 0.44, 0.035), "metal", rotation=(0.20, -0.05, -0.12), bevel=0.006)
    add_wear(root, m, "machinegun", [((0, 0.25, 0.338), (0.17, 0.24, 0.012))])


def build_laser_pistol(root, m):
    add_box(root, m, "frame", (0, 0.23, 0.10), (0.28, 0.58, 0.27), "paint_teal", bevel=0.045)
    add_cone(root, m, "emitter", (0, 0.61, 0.10), (0.13, 0.085), 0.22, "dark_metal")
    add_cylinder(root, m, "muzzle", (0, 0.75, 0.10), 0.075, 0.09, "energy_red")
    add_box(root, m, "grip", (0, -0.03, -0.18), (0.19, 0.27, 0.40), "rubber", rotation=(0.20, 0, 0), bevel=0.03)
    core = add_cylinder(root, m, "energy_core", (0, 0.18, 0.28), 0.075, 0.30, "energy_blue")
    core.scale.x = 1.25
    for offset in (-0.17, 0.17):
        add_box(root, m, f"emitter_fin_{'l' if offset < 0 else 'r'}", (offset, 0.50, 0.11), (0.055, 0.28, 0.24), "metal", rotation=(0, 0, -offset * 0.35), bevel=0.01)
    add_screws(root, m, "laser", [(-0.147, 0.12, 0.14), (0.147, 0.36, 0.14)])


def build_flamethrower(root, m):
    add_box(root, m, "frame", (0, 0.26, 0.08), (0.26, 0.72, 0.24), "dark_metal", bevel=0.028)
    add_cylinder(root, m, "fuel_tank", (0, -0.18, 0.12), 0.15, 0.62, "paint_olive")
    add_cylinder(root, m, "pressure_tank", (0.20, 0.12, 0.09), 0.08, 0.48, "brass")
    add_cylinder(root, m, "nozzle", (0, 0.88, 0.10), 0.055, 0.78, "metal")
    add_cone(root, m, "muzzle", (0, 1.31, 0.10), (0.11, 0.06), 0.15, "dark_metal")
    add_cylinder(root, m, "pilot", (0, 1.40, 0.10), 0.035, 0.07, "flame")
    add_box(root, m, "grip", (0, 0.01, -0.18), (0.16, 0.27, 0.38), "leather", rotation=(0.18, 0, 0), bevel=0.02)
    add_torus(root, m, "hose", (0.14, 0.28, 0.02), 0.17, 0.022, "rubber", rotation=(0, math.pi / 2, 0))
    add_wear(root, m, "flame", [((0, 0.27, 0.207), (0.13, 0.23, 0.012))])


def build_plasma_rifle(root, m):
    add_prism(root, m, "stock", [(-0.14, -0.48), (-0.19, -0.09), (-0.10, 0.02), (0.10, 0.02), (0.14, -0.48)], 0.20, "rubber")
    add_box(root, m, "receiver", (0, 0.28, 0.12), (0.34, 0.79, 0.36), "paint_teal", bevel=0.055)
    add_cylinder(root, m, "energy_core", (0, 0.25, 0.17), 0.13, 0.40, "energy_green", vertices=12)
    for offset in (-0.12, 0, 0.12):
        add_cylinder(root, m, f"barrel_{offset:+.2f}", (offset, 0.96, 0.12), 0.045, 0.74, "metal")
    add_cone(root, m, "muzzle", (0, 1.37, 0.12), (0.15, 0.10), 0.16, "dark_metal")
    add_box(root, m, "grip", (0, -0.02, -0.19), (0.17, 0.25, 0.40), "rubber", rotation=(0.18, 0, 0), bevel=0.025)
    for offset in (-0.20, 0.20):
        add_box(root, m, f"coil_guard_{'l' if offset < 0 else 'r'}", (offset, 0.27, 0.17), (0.055, 0.49, 0.29), "brass", bevel=0.012)
    add_wear(root, m, "plasma", [((0, 0.16, 0.306), (0.18, 0.21, 0.012))])


def build_shotgun(root, m):
    add_prism(root, m, "stock", [(-0.15, -0.54), (-0.19, -0.12), (-0.10, 0.06), (0.10, 0.06), (0.15, -0.54)], 0.21, "wood")
    add_box(root, m, "receiver", (0, 0.22, 0.10), (0.23, 0.50, 0.23), "dark_metal", bevel=0.025)
    add_cylinder(root, m, "barrel", (0, 0.91, 0.16), 0.052, 1.03, "metal")
    add_cylinder(root, m, "magazine_tube", (0, 0.88, 0.035), 0.045, 0.86, "dark_metal")
    add_cylinder(root, m, "muzzle", (0, 1.47, 0.16), 0.068, 0.09, "dark_metal")
    add_box(root, m, "pump", (0, 0.70, 0.06), (0.25, 0.36, 0.21), "wood", bevel=0.028)
    add_box(root, m, "grip", (0, 0.01, -0.15), (0.16, 0.24, 0.34), "leather", rotation=(0.18, 0, 0), bevel=0.02)
    add_cylinder(root, m, "reload_shell", (-0.13, 0.24, -0.02), 0.035, 0.15, "brass", direction="Y", vertices=10)
    add_screws(root, m, "shotgun", [(-0.125, 0.08, 0.13), (0.125, 0.33, 0.13)])


def build_rocket_launcher(root, m):
    add_cylinder(root, m, "launcher_tube", (0, 0.48, 0.16), 0.15, 1.52, "paint_olive", vertices=14)
    add_cone(root, m, "muzzle", (0, 1.30, 0.16), (0.23, 0.15), 0.20, "metal", vertices=14)
    add_cone(root, m, "rear_vent", (0, -0.35, 0.16), (0.19, 0.25), 0.18, "dark_metal", vertices=14)
    add_box(root, m, "grip", (0, 0.14, -0.19), (0.18, 0.27, 0.41), "leather", rotation=(0.18, 0, 0), bevel=0.022)
    add_box(root, m, "sight", (-0.17, 0.51, 0.35), (0.13, 0.38, 0.15), "dark_metal", bevel=0.018)
    add_cylinder(root, m, "sight_lens", (-0.17, 0.73, 0.35), 0.048, 0.035, "energy_red")
    add_box(root, m, "shoulder_pad", (0, -0.49, 0.16), (0.28, 0.08, 0.36), "rubber", bevel=0.022)
    add_cylinder(root, m, "rocket_round", (0, -0.05, 0.16), 0.105, 0.96, "dark_metal", vertices=12)
    add_wear(root, m, "launcher", [((0, 0.33, 0.312), (0.11, 0.30, 0.012)), ((0, 0.83, 0.312), (0.09, 0.19, 0.012))])


def build_knife(root, m):
    add_prism(root, m, "blade", [(0, 0.02), (-0.11, 0.18), (-0.09, 0.72), (0, 0.92), (0.09, 0.72), (0.11, 0.18)], 0.045, "metal")
    add_box(root, m, "guard", (0, -0.02, 0), (0.31, 0.08, 0.09), "brass", bevel=0.012)
    add_box(root, m, "grip", (0, -0.23, 0), (0.17, 0.40, 0.15), "leather", bevel=0.025)
    for y in (-0.34, -0.26, -0.18, -0.10):
        add_box(root, m, f"grip_wrap_{y:+.2f}", (0, y, 0), (0.19, 0.035, 0.17), "rubber", bevel=0.006)
    add_cylinder(root, m, "pommel", (0, -0.46, 0), 0.09, 0.08, "dark_metal")


def build_pickaxe(root, m):
    add_cylinder(root, m, "handle", (0, 0.30, 0), 0.055, 1.52, "wood", vertices=10)
    add_cylinder(root, m, "grip", (0, -0.38, 0), 0.068, 0.39, "leather", vertices=10)
    add_box(root, m, "head_socket", (0, 1.08, 0), (0.18, 0.18, 0.18), "dark_metal", bevel=0.025)
    add_cone(root, m, "pick_left", (-0.38, 1.08, 0), (0.12, 0.015), 0.68, "metal", direction="X", vertices=8)
    add_cone(root, m, "pick_right", (0.38, 1.08, 0), (0.12, 0.025), 0.68, "metal", direction="X", vertices=8)
    add_box(root, m, "handle_wear", (0, 0.12, 0.056), (0.04, 0.24, 0.012), "bone", bevel=0.004)


def build_axe(root, m):
    add_cylinder(root, m, "handle", (0, 0.26, 0), 0.058, 1.42, "wood", vertices=10)
    add_cylinder(root, m, "grip", (0, -0.37, 0), 0.071, 0.42, "leather", vertices=10)
    add_box(root, m, "head_socket", (0, 1.01, 0), (0.20, 0.21, 0.20), "dark_metal", bevel=0.025)
    add_prism(root, m, "blade", [(0.0, 0.86), (0.42, 0.88), (0.52, 1.03), (0.43, 1.22), (0.0, 1.16)], 0.09, "metal")
    add_box(root, m, "rear_hammer", (-0.25, 1.02, 0), (0.33, 0.17, 0.15), "dark_metal", bevel=0.018)
    add_wear(root, m, "axe", [((0.29, 1.03, 0.052), (0.18, 0.12, 0.012))])


def build_hand_pump(root, m):
    add_cylinder(root, m, "pump_tube", (0, 0.29, 0.03), 0.072, 1.20, "metal", vertices=10)
    add_cylinder(root, m, "nozzle", (0, 0.96, 0.03), 0.046, 0.22, "dark_metal", vertices=10)
    add_box(root, m, "pump_handle", (0, -0.35, 0.03), (0.52, 0.13, 0.15), "wood", bevel=0.025)
    add_box(root, m, "side_grip", (0.13, 0.12, -0.15), (0.14, 0.27, 0.40), "leather", rotation=(0.16, 0, 0), bevel=0.022)
    add_cylinder(root, m, "pressure_ring", (0, 0.72, 0.03), 0.095, 0.08, "brass", vertices=10)
    add_box(root, m, "foot_plate", (0, 0.89, -0.10), (0.42, 0.15, 0.08), "dark_metal", bevel=0.015)
    add_wear(root, m, "pump", [((0, 0.34, 0.105), (0.05, 0.22, 0.012))])


BUILDERS = {
    "pistol": build_pistol,
    "rifle": build_rifle,
    "assaultRifle": build_assault_rifle,
    "machineGun": build_machine_gun,
    "laserPistol": build_laser_pistol,
    "flamethrower": build_flamethrower,
    "plasmaRifle": build_plasma_rifle,
    "shotgun": build_shotgun,
    "rocketLauncher": build_rocket_launcher,
    "knife": build_knife,
    "pickaxe": build_pickaxe,
    "axe": build_axe,
    "handPump": build_hand_pump,
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
        "pistol": (0.0, -0.03, -0.30),
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


def scene_bounds() -> tuple[list[float], list[float]]:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return [round(value, 6) for value in minimum], [round(value, 6) for value in maximum]


def export_weapon(output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_copyright="Realm of Ashes original B+C weapon library.",
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
    root["realm_animation_family"] = family
    root["realm_art_direction"] = "geometry_b_materials_c"
    root["realm_interaction_profile"] = "physical_grips_reload_v2"
    runtime_scale = WEAPON_RUNTIME_SCALES[weapon_id]
    root["realm_runtime_scale"] = runtime_scale
    root.scale = (runtime_scale, runtime_scale, runtime_scale)
    BUILDERS[weapon_id](root, materials)
    interaction = add_weapon_interaction_sockets(root, weapon_id)
    root["realm_reload_kind"] = interaction["reloadKind"]
    animate_weapon(root, weapon_id, family)
    bpy.context.view_layer.update()
    minimum, maximum = scene_bounds()
    export_weapon(output.resolve())
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
    }


def main():
    args = parse_args()
    output_directory = args.output_directory.resolve()
    texture_size = max(32, min(256, int(args.texture_size)))
    reports = []
    for weapon_id, family, label in WEAPONS:
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
