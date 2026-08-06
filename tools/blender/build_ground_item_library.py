"""Build the compact B+C library used for physical items dropped on the ground.

Weapons and wearable equipment reuse their approved runtime GLBs.  This file
owns the remaining twenty-four inventory categories: ammunition, medicine,
materials, currency, food, water, trophies and the repair kit.  Every item is
an individually named child of one shared GLB so the browser downloads the
textures once and clones only the requested subtree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import atan2, cos, pi, sin
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector


ITEM_IDS = (
    "ammo9", "ammo556", "energyCell", "napalm", "shotgunShell", "rocketAmmo",
    "medkit", "stim", "doctorBag", "antibiotics", "ore", "wood", "scrap",
    "oil", "chemicals", "medicine", "electronics", "ammoParts", "food",
    "weaponParts", "silver", "trophy", "water", "repairKit",
)
LABELS_RU = {
    "ammo9": "Патроны 9 мм", "ammo556": "Патроны .223",
    "energyCell": "Энергозаряды", "napalm": "Напалм",
    "shotgunShell": "12 калибр", "rocketAmmo": "Ракета",
    "medkit": "Аптечка", "stim": "Стимулятор",
    "doctorBag": "Набор доктора", "antibiotics": "Антибиотики",
    "ore": "Железная руда", "wood": "Древесина", "scrap": "Металлолом",
    "oil": "Канистра нефти", "chemicals": "Химикаты",
    "medicine": "Медикаменты", "electronics": "Электроника",
    "ammoParts": "Детали патронов", "food": "Пища",
    "weaponParts": "Оружейные детали", "silver": "Крышки",
    "trophy": "Трофей", "water": "Фляга воды", "repairKit": "Ремкомплект",
}
TEXTURE_SIZE = 128


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--render", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    # Blender keeps orphaned datablocks and their internal creation order after
    # deleting scene objects.  The glTF exporter uses that order while writing
    # triangle buffers, so a second build in the same Blender session could
    # produce different bytes despite identical geometry.  Unlink everything
    # explicitly to keep review builds reproducible without resetting Blender
    # (which would also disconnect the MCP add-on).
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.materials,
        bpy.data.images,
    ):
        for item in list(collection):
            collection.remove(item)


def texture_image(
    name: str,
    base: tuple[float, float, float],
    kind: str,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=TEXTURE_SIZE, height=TEXTURE_SIZE, alpha=False)
    rng = random.Random(f"realm-ground-items-bc-v1:{name}:{kind}")
    pixels: list[float] = []
    for y in range(TEXTURE_SIZE):
        for x in range(TEXTURE_SIZE):
            broad = sin(x * 0.13 + y * 0.037) * 0.46
            streak = sin(y * 0.41 + sin(x * 0.079) * 1.9) * 0.28
            scratch = 1.0 if ((x * 17 + y * 31 + rng.randrange(0, 97)) % 191) < 2 else 0.0
            noise = (rng.random() - 0.5) * 0.19
            if kind == "albedo":
                variation = broad * 0.075 + streak * 0.045 + noise * 0.06
                values = tuple(max(0.015, min(0.96, c * (1.0 + variation) + scratch * 0.045)) for c in base)
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.24, min(0.99, base[0] + broad * 0.045 + scratch * 0.08))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + streak * 0.018, 0.5 + noise * 0.018, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, "roughness")
    rough.image.colorspace_settings.name = "Non-Color"
    normal_tex = nodes.new("ShaderNodeTexImage")
    normal_tex.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal")
    normal_tex.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.20
    links.new(albedo.outputs["Color"], shader.inputs["Base Color"])
    links.new(rough.outputs["Color"], shader.inputs["Roughness"])
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_materials() -> dict[str, bpy.types.Material]:
    return {
        "steel": pbr_material("ground_worn_gunmetal", (0.18, 0.20, 0.19), 0.68, 0.72),
        "dark": pbr_material("ground_charcoal_metal", (0.055, 0.060, 0.058), 0.74, 0.62),
        "rust": pbr_material("ground_oxidised_steel", (0.30, 0.12, 0.050), 0.88, 0.48),
        "brass": pbr_material("ground_tarnished_brass", (0.43, 0.285, 0.075), 0.58, 0.78),
        "wood": pbr_material("ground_dry_split_wood", (0.285, 0.145, 0.060), 0.94),
        "paper": pbr_material("ground_faded_cardboard", (0.39, 0.31, 0.19), 0.96),
        "olive": pbr_material("ground_chipped_olive_paint", (0.20, 0.25, 0.12), 0.83, 0.18),
        "red": pbr_material("ground_faded_warning_red", (0.43, 0.075, 0.045), 0.82, 0.10),
        "ivory": pbr_material("ground_medical_ivory", (0.68, 0.64, 0.51), 0.79),
        "teal": pbr_material("ground_energy_teal", (0.035, 0.40, 0.43), 0.47, 0.18),
        "amber": pbr_material("ground_amber_chemical_glass", (0.38, 0.19, 0.035), 0.36),
        "rubber": pbr_material("ground_old_black_rubber", (0.025, 0.028, 0.025), 0.97),
        "cloth": pbr_material("ground_dusty_field_cloth", (0.19, 0.175, 0.12), 0.98),
        "stone": pbr_material("ground_iron_ore", (0.16, 0.145, 0.13), 0.93, 0.22),
        "copper": pbr_material("ground_oxidised_copper", (0.30, 0.14, 0.055), 0.76, 0.70),
        "green": pbr_material("ground_circuit_green", (0.045, 0.22, 0.095), 0.70, 0.12),
        "blue": pbr_material("ground_chipped_tool_blue", (0.055, 0.14, 0.24), 0.84, 0.18),
        "bone": pbr_material("ground_weathered_bone", (0.58, 0.50, 0.31), 0.92),
    }


def finish_mesh(obj: bpy.types.Object, material: bpy.types.Material, bevel: float = 0.0) -> bpy.types.Object:
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("small_worn_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def box(parent, name, size, location, material, rotation=(0.0, 0.0, 0.0), bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish_mesh(obj, material, min(bevel, min(size) * 0.22))
    obj.parent = parent
    return obj


def cylinder(parent, name, radius, depth, location, material, rotation=(0.0, 0.0, 0.0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, min(0.008, radius * 0.16))
    obj.parent = parent
    return obj


def cone(parent, name, radius1, radius2, depth, location, material, rotation=(0.0, 0.0, 0.0), vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material)
    obj.parent = parent
    return obj


def sphere(parent, name, radius, location, material, scale=(1.0, 1.0, 1.0), subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish_mesh(obj, material)
    obj.parent = parent
    return obj


def torus(parent, name, major, minor, location, material, rotation=(0.0, 0.0, 0.0), segments=12):
    bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=6, major_radius=major, minor_radius=minor, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material)
    obj.parent = parent
    return obj


def rod(parent, name, start, end, radius, material, vertices=10):
    start_v = Vector(start)
    end_v = Vector(end)
    delta = end_v - start_v
    obj = cylinder(parent, name, radius, delta.length, (start_v + end_v) * 0.5, material, vertices=vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return obj


def root_for(item_id: str) -> bpy.types.Object:
    root = bpy.data.objects.new(f"ground_item_{item_id}", None)
    bpy.context.scene.collection.objects.link(root)
    root["realm_ground_item_id"] = item_id
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_physical_ground_item"] = True
    return root


def cross_mark(parent, center, material, scale=1.0, facing="top"):
    if facing == "top":
        box(parent, "medical_cross_vertical", (0.045*scale, 0.13*scale, 0.008), (center[0], center[1], center[2]), material, bevel=0.004)
        box(parent, "medical_cross_horizontal", (0.13*scale, 0.045*scale, 0.009), (center[0], center[1], center[2]+0.001), material, bevel=0.004)
    else:
        box(parent, "medical_cross_vertical", (0.045*scale, 0.008, 0.13*scale), center, material, bevel=0.004)
        box(parent, "medical_cross_horizontal", (0.13*scale, 0.009, 0.045*scale), center, material, bevel=0.004)


def build_ammo9(m):
    r = root_for("ammo9")
    box(r, "nine_millimetre_carton", (0.27,0.19,0.105), (0,0,0.057), m["paper"])
    box(r, "nine_millimetre_label", (0.14,0.09,0.008), (0,-0.097,0.065), m["red"], rotation=(pi/2,0,0), bevel=0.002)
    for i in range(4):
        x = -0.11 + i*0.072
        cylinder(r, f"nine_round_{i}", 0.012, 0.115, (x,0.14,0.035), m["brass"], rotation=(0,pi/2,0), vertices=10)
    return r


def build_ammo556(m):
    r = root_for("ammo556")
    box(r, "two_two_three_tin", (0.34,0.24,0.15), (0,0,0.08), m["olive"], bevel=0.018)
    box(r, "two_two_three_lid", (0.35,0.25,0.025), (0,0,0.163), m["steel"], bevel=0.006)
    box(r, "two_two_three_stencil", (0.17,0.012,0.055), (0,-0.127,0.095), m["ivory"], bevel=0.002)
    for i in range(3):
        cylinder(r, f"rifle_round_{i}", 0.013, 0.18, (-0.13+i*0.08,0.18,0.035), m["brass"], rotation=(0,pi/2,0), vertices=10)
        cone(r, f"rifle_tip_{i}", 0.013, 0.003, 0.045, (-0.035+i*0.08,0.18,0.035), m["copper"], rotation=(0,pi/2,0), vertices=10)
    return r


def build_energy_cell(m):
    r = root_for("energyCell")
    box(r, "energy_cell_cradle", (0.34,0.20,0.055), (0,0,0.035), m["dark"], bevel=0.012)
    for i, x in enumerate((-0.09,0.09)):
        cylinder(r, f"energy_cell_{i}", 0.06, 0.24, (x,0,0.105), m["teal"], rotation=(pi/2,0,0), vertices=12)
        cylinder(r, f"energy_contact_{i}", 0.04, 0.018, (x,-0.13,0.105), m["brass"], rotation=(pi/2,0,0), vertices=12)
    return r


def build_napalm(m):
    r = root_for("napalm")
    cylinder(r, "napalm_canister", 0.115, 0.28, (0,0,0.145), m["red"], vertices=12)
    cylinder(r, "napalm_cap", 0.055, 0.035, (0,0,0.305), m["dark"], vertices=10)
    box(r, "napalm_warning_band", (0.18,0.015,0.075), (0,-0.112,0.16), m["brass"], rotation=(pi/2,0,0), bevel=0.002)
    torus(r, "napalm_handle", 0.082, 0.014, (0,0,0.31), m["steel"], rotation=(pi/2,0,0))
    return r


def build_shells(m):
    r = root_for("shotgunShell")
    box(r, "shell_carton", (0.27,0.20,0.105), (0,0,0.055), m["red"], bevel=0.014)
    for i in range(4):
        x = -0.12 + i*0.08
        cylinder(r, f"red_shell_{i}", 0.022, 0.14, (x,0.15,0.035), m["red"], rotation=(0,pi/2,0), vertices=10)
        cylinder(r, f"shell_brass_{i}", 0.024, 0.025, (x-0.082,0.15,0.035), m["brass"], rotation=(0,pi/2,0), vertices=10)
    return r


def build_rocket(m):
    r = root_for("rocketAmmo")
    cylinder(r, "rocket_body", 0.067, 0.57, (0,0,0.11), m["olive"], rotation=(0,pi/2,0), vertices=12)
    cone(r, "rocket_nose", 0.067, 0.005, 0.18, (-0.375,0,0.11), m["rust"], rotation=(0,-pi/2,0), vertices=12)
    cylinder(r, "rocket_motor", 0.073, 0.10, (0.335,0,0.11), m["dark"], rotation=(0,pi/2,0), vertices=12)
    for sy in (-1,1):
        box(r, f"rocket_fin_{sy}", (0.16,0.012,0.13), (0.32,sy*0.07,0.08), m["steel"], rotation=(0,0,sy*0.12), bevel=0.003)
    return r


def build_medkit(m):
    r = root_for("medkit")
    box(r, "field_medkit", (0.40,0.27,0.18), (0,0,0.10), m["red"], bevel=0.025)
    box(r, "medkit_lid", (0.39,0.26,0.035), (0,0,0.20), m["cloth"], bevel=0.012)
    cross_mark(r, (0,0,0.22), m["ivory"], 1.0)
    torus(r, "medkit_handle", 0.10, 0.014, (0,0.11,0.23), m["dark"], rotation=(pi/2,0,0))
    return r


def build_stim(m):
    r = root_for("stim")
    cylinder(r, "stim_glass", 0.04, 0.24, (0,0,0.065), m["teal"], rotation=(0,pi/2,0), vertices=12)
    cylinder(r, "stim_plunger", 0.055, 0.055, (0.15,0,0.065), m["ivory"], rotation=(0,pi/2,0), vertices=12)
    rod(r, "stim_needle", (-0.16,0,0.065), (-0.31,0,0.065), 0.007, m["steel"], vertices=8)
    box(r, "stim_finger_rest", (0.025,0.16,0.025), (0.11,0,0.065), m["dark"], bevel=0.004)
    return r


def build_doctor_bag(m):
    r = root_for("doctorBag")
    box(r, "doctor_satchel", (0.48,0.25,0.28), (0,0,0.15), m["cloth"], bevel=0.035)
    box(r, "doctor_bag_frame", (0.44,0.27,0.045), (0,0,0.29), m["steel"], bevel=0.012)
    torus(r, "doctor_bag_handle", 0.13, 0.018, (0,0,0.37), m["rubber"], rotation=(pi/2,0,0), segments=16)
    cross_mark(r, (0,-0.13,0.16), m["ivory"], 0.85, facing="front")
    return r


def build_antibiotics(m):
    r = root_for("antibiotics")
    cylinder(r, "antibiotic_bottle", 0.075, 0.18, (-0.09,0,0.095), m["ivory"], vertices=12)
    cylinder(r, "antibiotic_cap", 0.08, 0.04, (-0.09,0,0.205), m["red"], vertices=12)
    box(r, "antibiotic_blister", (0.28,0.15,0.025), (0.10,0.02,0.035), m["steel"], rotation=(0.03,0.1,0.15), bevel=0.006)
    for x in (0.02,0.10,0.18):
        for y in (-0.025,0.055):
            sphere(r, "antibiotic_tablet", 0.024, (x,y,0.055), m["ivory"], scale=(1,0.7,0.35))
    return r


def build_ore(m):
    r = root_for("ore")
    for i, (x,y,z,s) in enumerate(((-.14,-.04,.09,.15),(.07,-.08,.12,.18),(.16,.10,.07,.12),(-.04,.13,.08,.14))):
        sphere(r, f"iron_ore_chunk_{i}", s, (x,y,z), m["stone"], scale=(1.15,0.85,0.70), subdivisions=1)
    box(r, "ore_rust_vein", (0.22,0.035,0.025), (0.01,-0.12,0.12), m["rust"], rotation=(0.3,0.15,-0.2), bevel=0.003)
    return r


def build_wood(m):
    r = root_for("wood")
    for i in range(5):
        y = (-0.12 + (i%3)*0.12)
        z = 0.05 + (i//3)*0.10
        cylinder(r, f"split_log_{i}", 0.045, 0.48, (0,y,z), m["wood"], rotation=(0,pi/2,0), vertices=9)
    for x in (-0.13,0.13):
        torus(r, "wood_binding", 0.105, 0.012, (x,0,0.12), m["cloth"], rotation=(0,pi/2,0), segments=12)
    return r


def build_scrap(m):
    r = root_for("scrap")
    box(r, "bent_scrap_plate", (0.43,0.24,0.045), (-0.02,0,0.055), m["rust"], rotation=(0.08,-0.18,0.22), bevel=0.008)
    cylinder(r, "scrap_pipe", 0.045, 0.42, (0.02,-0.10,0.11), m["steel"], rotation=(0,pi/2,0.35), vertices=10)
    torus(r, "scrap_gear", 0.105, 0.035, (0.12,0.08,0.105), m["dark"], rotation=(0.05,0.1,0.1), segments=10)
    box(r, "scrap_bracket", (0.12,0.07,0.10), (-0.18,0.06,0.115), m["steel"], rotation=(0,0.25,-0.35), bevel=0.008)
    return r


def build_oil(m):
    r = root_for("oil")
    box(r, "oil_jerrycan", (0.34,0.18,0.43), (0,0,0.22), m["olive"], bevel=0.025)
    box(r, "jerrycan_inset", (0.22,0.012,0.24), (0,-0.096,0.22), m["dark"], rotation=(pi/2,0,0), bevel=0.006)
    box(r, "jerrycan_handle", (0.19,0.07,0.055), (0,0,0.45), m["dark"], bevel=0.012)
    cylinder(r, "oil_cap", 0.045, 0.055, (0.13,0,0.47), m["rust"], vertices=10)
    return r


def build_chemicals(m):
    r = root_for("chemicals")
    box(r, "chemical_carrier", (0.38,0.25,0.07), (0,0,0.04), m["steel"], bevel=0.012)
    for i, x in enumerate((-0.11,0.11)):
        cylinder(r, f"chemical_bottle_{i}", 0.075, 0.23, (x,0,0.18), m["amber"], vertices=12)
        cylinder(r, f"chemical_bottle_cap_{i}", 0.048, 0.045, (x,0,0.32), m["red"] if i else m["dark"], vertices=10)
    return r


def build_medicine(m):
    r = root_for("medicine")
    box(r, "medicine_tin", (0.31,0.22,0.105), (-0.04,0,0.06), m["ivory"], bevel=0.018)
    cross_mark(r, (-0.04,0,0.12), m["red"], 0.7)
    cylinder(r, "bandage_roll", 0.072, 0.17, (0.16,0.12,0.075), m["cloth"], rotation=(0,pi/2,0), vertices=14)
    cylinder(r, "bandage_core", 0.025, 0.18, (0.16,0.12,0.075), m["dark"], rotation=(0,pi/2,0), vertices=10)
    return r


def build_electronics(m):
    r = root_for("electronics")
    box(r, "circuit_board", (0.42,0.28,0.025), (0,0,0.04), m["green"], rotation=(0.05,-0.08,0.12), bevel=0.006)
    for i, (x,y,h,mat) in enumerate(((-.13,-.06,.06,"copper"),(.02,-.04,.09,"dark"),(.13,.07,.055,"brass"),(-.03,.09,.04,"teal"))):
        box(r, f"electronic_component_{i}", (0.055,0.045,h), (x,y,0.055+h/2), m[mat], bevel=0.006)
    torus(r, "wire_coil", 0.09, 0.012, (0.20,-0.10,0.07), m["copper"], rotation=(0.1,0.2,0), segments=14)
    return r


def build_ammo_parts(m):
    r = root_for("ammoParts")
    box(r, "ammo_parts_tray", (0.38,0.27,0.055), (0,0,0.035), m["paper"], bevel=0.012)
    for i in range(7):
        x = -0.14 + (i%4)*0.09
        y = -0.07 + (i//4)*0.13
        cylinder(r, f"empty_case_{i}", 0.017, 0.12, (x,y,0.075), m["brass"], rotation=(0,pi/2,0.08*(i-3)), vertices=10)
    return r


def build_food(m):
    r = root_for("food")
    for i, x in enumerate((-0.11,0.11)):
        cylinder(r, f"ration_tin_{i}", 0.075, 0.17, (x,-0.03,0.09), m["steel"], vertices=12)
        box(r, f"ration_label_{i}", (0.11,0.012,0.07), (x,-0.09,0.09), m["paper"], rotation=(pi/2,0,0), bevel=0.002)
    box(r, "dry_ration_packet", (0.28,0.17,0.075), (0,0.12,0.055), m["cloth"], rotation=(0.06,0.03,-0.08), bevel=0.018)
    return r


def build_weapon_parts(m):
    r = root_for("weaponParts")
    box(r, "receiver_blank", (0.36,0.12,0.11), (-0.03,0,0.075), m["dark"], bevel=0.012)
    cylinder(r, "spare_barrel", 0.028, 0.55, (0,-0.12,0.055), m["steel"], rotation=(0,pi/2,0.12), vertices=10)
    torus(r, "weapon_part_gear", 0.085, 0.026, (0.18,0.08,0.085), m["rust"], rotation=(0.1,0.15,0), segments=10)
    rod(r, "weapon_part_spring", (-0.18,0.10,0.05), (0.11,0.10,0.05), 0.012, m["steel"], vertices=8)
    return r


def build_caps(m):
    r = root_for("silver")
    coords = ((-.12,-.06,.025),(-.03,-.08,.03),(.07,-.05,.025),(.14,.02,.03),(-.08,.05,.03),(.02,.06,.045),(.10,.09,.05),(-.01,.0,.07))
    for i, (x,y,z) in enumerate(coords):
        cylinder(r, f"bottle_cap_{i}", 0.045, 0.018, (x,y,z), m["brass"] if i%3 else m["rust"], rotation=(0.06*i,0.04*i,0.13*i), vertices=14)
        cylinder(r, f"cap_inset_{i}", 0.029, 0.020, (x,y,z+0.004), m["red"] if i%2 else m["blue"], rotation=(0.06*i,0.04*i,0.13*i), vertices=12)
    return r


def build_trophy(m):
    r = root_for("trophy")
    sphere(r, "mutant_trophy_skull", 0.14, (-0.05,0,0.12), m["bone"], scale=(0.88,0.72,0.82), subdivisions=2)
    cone(r, "trophy_horn_left", 0.055, 0.004, 0.28, (-0.18,0,0.20), m["bone"], rotation=(0,-0.48,-0.35), vertices=10)
    cone(r, "trophy_horn_right", 0.055, 0.004, 0.25, (0.09,0.01,0.20), m["bone"], rotation=(0,0.48,0.35), vertices=10)
    for x in (-0.09,-0.03,0.03,0.09):
        cone(r, "trophy_fang", 0.018, 0.002, 0.10, (x,-0.12,0.045), m["bone"], rotation=(pi/2,0,0), vertices=8)
    return r


def build_water(m):
    r = root_for("water")
    cylinder(r, "wasteland_canteen", 0.14, 0.11, (0,0,0.15), m["olive"], rotation=(pi/2,0,0), vertices=14)
    box(r, "canteen_flatten", (0.23,0.09,0.24), (0,0,0.15), m["olive"], bevel=0.045)
    cylinder(r, "canteen_neck", 0.045, 0.07, (0,0,0.305), m["steel"], vertices=10)
    cylinder(r, "canteen_cap", 0.052, 0.035, (0,0,0.355), m["dark"], vertices=10)
    torus(r, "canteen_strap", 0.18, 0.014, (0,0,0.17), m["cloth"], rotation=(pi/2,0,0), segments=16)
    return r


def build_repair_kit(m):
    r = root_for("repairKit")
    box(r, "repair_toolbox", (0.46,0.25,0.19), (0,0,0.105), m["blue"], bevel=0.026)
    box(r, "toolbox_lid", (0.45,0.24,0.045), (0,0,0.215), m["rust"], bevel=0.012)
    torus(r, "toolbox_handle", 0.12, 0.015, (0,0,0.30), m["dark"], rotation=(pi/2,0,0), segments=14)
    rod(r, "lid_wrench_handle", (-0.11,-0.13,0.245), (0.11,-0.13,0.245), 0.013, m["ivory"], vertices=8)
    torus(r, "lid_wrench_head", 0.038, 0.012, (0.13,-0.13,0.245), m["ivory"], rotation=(pi/2,0,0), segments=10)
    return r


BUILDERS = (
    build_ammo9, build_ammo556, build_energy_cell, build_napalm, build_shells,
    build_rocket, build_medkit, build_stim, build_doctor_bag, build_antibiotics,
    build_ore, build_wood, build_scrap, build_oil, build_chemicals, build_medicine,
    build_electronics, build_ammo_parts, build_food, build_weapon_parts, build_caps,
    build_trophy, build_water, build_repair_kit,
)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def bounds(root: bpy.types.Object) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    return (
        Vector(tuple(min(point[i] for point in points) for i in range(3))),
        Vector(tuple(max(point[i] for point in points) for i in range(3))),
    )


def geometry_stats(root: bpy.types.Object) -> dict[str, int]:
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    return {
        "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(obj.data.loop_triangles) for obj in meshes),
    }


def export_glb(output: Path, catalog_root: bpy.types.Object, roots: list[bpy.types.Object]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for root in roots:
        root.location = (0,0,0)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    catalog_root.select_set(True)
    for root in roots:
        root.select_set(True)
        for obj in descendants(root):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = catalog_root
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()), export_format="GLB", use_selection=True,
        export_extras=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="AUTO", export_cameras=False, export_lights=False,
        export_animations=False,
        export_copyright="Realm of Ashes original B+C physical ground item library.",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export ground item library: {result}")


def arrange_catalog(roots: list[bpy.types.Object]) -> None:
    for index, root in enumerate(roots):
        column = index % 6
        row = index // 6
        root.location = ((column - 2.5) * 1.05, (1.5 - row) * 0.92, 0)


def render_catalog(path: Path, roots: list[bpy.types.Object]) -> None:
    arrange_catalog(roots)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path.resolve())
    scene.world.color = (0.025,0.028,0.026)
    camera_data = bpy.data.cameras.new("ground_item_catalog_camera")
    camera = bpy.data.objects.new("ground_item_catalog_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 7.0
    camera.location = (5.8,-7.4,8.8)
    camera.rotation_euler = (Vector((0,0,0.25))-camera.location).to_track_quat("-Z","Y").to_euler()
    for name, location, energy, size in (
        ("catalog_key",(-4,-5,9),1500,5.0),
        ("catalog_fill",(5,-2,6),900,4.0),
        ("catalog_rim",(0,5,7),1100,3.5),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0,0,0))-light.location).to_track_quat("-Z","Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0,0,-0.015))
    ground = bpy.context.object
    ground.name = "catalog_ground"
    material = bpy.data.materials.new("catalog_ground_material")
    material.diffuse_color = (0.055,0.060,0.052,1)
    material.roughness = 0.94
    ground.data.materials.append(material)
    label_material = bpy.data.materials.new("catalog_label_material")
    label_material.diffuse_color = (0.03,0.035,0.03,1)
    label_material.roughness = 0.98
    for root in roots:
        item_id = root.name.removeprefix("ground_item_")
        curve = bpy.data.curves.new(f"label_{item_id}_curve", "FONT")
        curve.body = LABELS_RU[item_id]
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.size = 0.115
        curve.extrude = 0.001
        label = bpy.data.objects.new(f"label_{item_id}", curve)
        scene.collection.objects.link(label)
        label.location = (root.location.x, root.location.y - 0.33, 0.008)
        label.data.materials.append(label_material)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    materials = make_materials()
    catalog_root = bpy.data.objects.new("ground_item_library_bc_v1", None)
    scene.collection.objects.link(catalog_root)
    catalog_root["realm_schema"] = "realm.ground-item-library.v1"
    catalog_root["realm_style"] = "geometry_b_materials_c"
    catalog_root["realm_item_ids"] = list(ITEM_IDS)
    roots = [builder(materials) for builder in BUILDERS]
    if tuple(root.name.removeprefix("ground_item_") for root in roots) != ITEM_IDS:
        raise RuntimeError("Ground item builder order does not match ITEM_IDS")
    for root in roots:
        root.parent = catalog_root
    bpy.context.view_layer.update()
    item_report = {}
    for root in roots:
        minimum, maximum = bounds(root)
        size = maximum - minimum
        if min(minimum) < -0.65 or max(size) > 1.0 or minimum.z < -0.025:
            raise RuntimeError(f"Unsafe ground item bounds for {root.name}: {minimum} .. {maximum}")
        item_report[root.name.removeprefix("ground_item_")] = {
            **geometry_stats(root),
            "minimumMetres": [round(v,6) for v in minimum],
            "maximumMetres": [round(v,6) for v in maximum],
            "sizeMetres": [round(v,6) for v in size],
        }
    export_glb(args.output, catalog_root, roots)
    sha = hashlib.sha256(args.output.read_bytes()).hexdigest().upper()
    total = {
        key: sum(int(row[key]) for row in item_report.values())
        for key in ("meshes","vertices","triangles")
    }
    report = {
        "schema": "realm.ground-item-library-report.v1",
        "file": args.output.name,
        "sha256": sha,
        "style": "geometry_b_materials_c",
        "textureSize": TEXTURE_SIZE,
        "itemIds": list(ITEM_IDS),
        "items": item_report,
        "totals": total,
        "materials": len(materials),
        "embeddedTextureImages": len(materials) * 3,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    if args.render:
        render_catalog(args.render, roots)
    arrange_catalog(roots)
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print(json.dumps({"output": str(args.output), "sha256": sha, **total}, ensure_ascii=False))


if __name__ == "__main__":
    main()
