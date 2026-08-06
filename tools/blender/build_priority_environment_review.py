"""Build the first high-frequency B+C environment replacement set.

The set deliberately targets silhouettes seen on almost every local map:
the car wreck, three dead-tree variants, dry bush, rubble rock, scrap heap and
wasteland shack.  Each review root is exported as a standalone GLB so the
existing data-driven static-model catalogue can use it without runtime forks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import pi, sin
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector


MODEL_IDS = (
    "car_wreck", "dead_tree_a", "dead_tree_b", "dead_tree_c",
    "dry_bush", "rubble_rock", "scrap_heap", "wasteland_shack",
)
LABELS_RU = {
    "car_wreck": "Ржавый автомобиль",
    "dead_tree_a": "Мёртвое дерево A",
    "dead_tree_b": "Мёртвое дерево B",
    "dead_tree_c": "Мёртвое дерево C",
    "dry_bush": "Сухой куст",
    "rubble_rock": "Каменная осыпь",
    "scrap_heap": "Груда металлолома",
    "wasteland_shack": "Пустошный сарай",
}
TEXTURE_SIZE = 128
GROUND_LIFT_METRES = {
    "dead_tree_a": 0.04,
    "dead_tree_b": 0.04,
    "dead_tree_c": 0.04,
    "scrap_heap": 0.04,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--render", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.cameras,
        bpy.data.lights, bpy.data.materials, bpy.data.images,
    ):
        for item in list(collection):
            collection.remove(item)


def texture_image(name: str, base: tuple[float, float, float], kind: str) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=TEXTURE_SIZE, height=TEXTURE_SIZE, alpha=False)
    rng = random.Random(f"realm-priority-environment-bc-v1:{name}:{kind}")
    pixels: list[float] = []
    for y in range(TEXTURE_SIZE):
        for x in range(TEXTURE_SIZE):
            broad = sin(x * 0.113 + y * 0.043) * 0.43
            streak = sin(y * 0.37 + sin(x * 0.071) * 2.1) * 0.31
            scratch = 1.0 if ((x * 19 + y * 29 + rng.randrange(0, 113)) % 223) < 3 else 0.0
            noise = (rng.random() - 0.5) * 0.22
            if kind == "albedo":
                variation = broad * 0.10 + streak * 0.052 + noise * 0.075
                values = tuple(max(0.012, min(0.94, c * (1 + variation) + scratch * 0.055)) for c in base)
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.26, min(0.99, base[0] + broad * 0.05 + scratch * 0.075))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + streak * 0.022, 0.5 + noise * 0.019, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(name, base, roughness, metallic=0.0, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*base, alpha)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        material.surface_render_method = "DITHERED"
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, "roughness")
    rough.image.colorspace_settings.name = "Non-Color"
    normal_tex = nodes.new("ShaderNodeTexImage")
    normal_tex.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal")
    normal_tex.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.23
    links.new(albedo.outputs["Color"], shader.inputs["Base Color"])
    links.new(rough.outputs["Color"], shader.inputs["Roughness"])
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_materials():
    return {
        "rust": pbr_material("environment_oxidised_rust_metal", (0.32, 0.115, 0.042), 0.88, 0.58),
        "dark": pbr_material("environment_blackened_scrap_metal", (0.045, 0.047, 0.043), 0.77, 0.70),
        "steel": pbr_material("environment_scraped_gunmetal", (0.22, 0.225, 0.205), 0.63, 0.76),
        "paint": pbr_material("environment_faded_prewar_paint", (0.075, 0.245, 0.215), 0.81, 0.28),
        "yellow": pbr_material("environment_faded_warning_yellow", (0.52, 0.31, 0.055), 0.86, 0.19),
        "wood": pbr_material("environment_dead_dry_wood", (0.255, 0.135, 0.065), 0.96),
        "wood_dark": pbr_material("environment_charred_split_wood", (0.095, 0.057, 0.037), 0.98),
        "stone": pbr_material("environment_sun_baked_rubble_rock", (0.275, 0.25, 0.205), 0.97, 0.07),
        "concrete": pbr_material("environment_cracked_concrete", (0.39, 0.37, 0.31), 0.98, 0.02),
        "rubber": pbr_material("environment_old_cracked_rubber", (0.023, 0.024, 0.021), 0.99),
        "glass": pbr_material("environment_dirty_broken_glass", (0.075, 0.125, 0.13), 0.34, 0.04, 0.58),
        "cloth": pbr_material("environment_torn_dusty_canvas", (0.29, 0.22, 0.13), 0.99),
        "shadow": pbr_material("environment_soft_contact_shadow", (0.012, 0.010, 0.008), 1.0, 0.0, 0.22),
    }


def finish(obj, material, bevel=0.0):
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("worn_bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    for face in obj.data.polygons:
        face.use_smooth = False
    return obj


def root_for(model_id):
    root = bpy.data.objects.new(f"environment_{model_id}_bc_v1", None)
    bpy.context.scene.collection.objects.link(root)
    root["realm_schema"] = "realm.priority-environment-model.v1"
    root["realm_model_id"] = model_id
    root["realm_style"] = "geometry_b_materials_c"
    return root


def box(parent, name, size, location, material, rotation=(0, 0, 0), bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, material, min(bevel, min(size) * 0.2))
    obj.parent = parent
    return obj


def cylinder(parent, name, radius, depth, location, material, rotation=(0, 0, 0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    finish(obj, material, 0.006)
    obj.parent = parent
    return obj


def torus(parent, name, major, minor, location, material, rotation=(pi / 2, 0, 0), segments=16):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=segments,
        minor_segments=6, location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    finish(obj, material)
    obj.parent = parent
    return obj


def rock(parent, name, location, scale, material, rotation=(0, 0, 0), subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, material)
    obj.parent = parent
    return obj


def branch(parent, name, start, end, radius, material, vertices=9):
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    midpoint = (a + b) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius, radius2=radius * 0.68,
        depth=direction.length, location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    finish(obj, material)
    obj.parent = parent
    return obj


def irregular_panel(parent, name, points, depth, material, location=(0, 0, 0), rotation=(0, 0, 0)):
    vertices = [(x, y, -depth * 0.5) for x, y in points] + [(x, y, depth * 0.5) for x, y in points]
    count = len(points)
    faces = [tuple(range(count)), tuple(range(count, count * 2))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    finish(obj, material, 0.012)
    obj.parent = parent
    return obj


def contact_shadow(parent, radius_x, radius_y, material):
    bpy.ops.mesh.primitive_circle_add(vertices=32, radius=1, fill_type="NGON", location=(0, 0, 0.006))
    obj = bpy.context.object
    obj.name = "ground_contact_shadow"
    obj.scale = (radius_x, radius_y, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, material)
    obj.parent = parent


def build_car(m):
    root = root_for("car_wreck")
    contact_shadow(root, 2.15, 1.05, m["shadow"])
    box(root, "bent_underframe", (3.45, 1.42, 0.22), (0, 0, 0.35), m["dark"], rotation=(0.01, 0.025, -0.018), bevel=0.045)
    box(root, "rusted_floor_pan", (3.12, 1.28, 0.19), (-0.03, 0, 0.53), m["rust"], rotation=(0, -0.025, 0), bevel=0.06)
    irregular_panel(root, "crumpled_hood", [(-0.88, -0.63), (0.88, -0.58), (0.82, 0.57), (-0.70, 0.64)], 0.12, m["paint"], (1.15, 0, 0.82), (0.03, -0.04, 0.02))
    irregular_panel(root, "dented_trunk", [(-0.66, -0.59), (0.65, -0.55), (0.73, 0.53), (-0.55, 0.62)], 0.11, m["rust"], (-1.30, 0, 0.78), (-0.06, 0.03, -0.025))
    box(root, "cabin_floor", (1.48, 1.18, 0.12), (-0.10, 0, 0.75), m["dark"], bevel=0.035)
    for side in (-1, 1):
        y = side * 0.58
        branch(root, f"windshield_pillar_{side}", (0.48, y, 0.76), (0.28, y, 1.53), 0.055, m["rust"])
        branch(root, f"rear_pillar_{side}", (-0.77, y, 0.78), (-0.51, y, 1.48), 0.065, m["rust"])
        branch(root, f"roof_rail_{side}", (-0.50, y, 1.49), (0.28, y, 1.53), 0.052, m["steel"])
        box(root, f"seat_{side}", (0.55, 0.43, 0.16), (-0.23, side * 0.31, 0.91), m["cloth"], rotation=(0, 0.12, 0), bevel=0.055)
        branch(root, f"seat_back_{side}", (-0.45, side * 0.31, 0.94), (-0.58, side * 0.31, 1.36), 0.13, m["cloth"], vertices=10)
    box(root, "collapsed_roof", (1.25, 1.15, 0.10), (-0.13, -0.02, 1.51), m["paint"], rotation=(0.06, -0.02, 0.035), bevel=0.035)
    irregular_panel(root, "broken_windshield", [(-0.48, -0.23), (0.47, -0.20), (0.42, 0.21), (-0.34, 0.25)], 0.018, m["glass"], (0.40, 0, 1.22), (pi / 2, -0.25, pi / 2))
    for x in (-1.10, 1.12):
        for side in (-1, 1):
            if x > 1 and side > 0:
                cylinder(root, "exposed_front_hub", 0.18, 0.16, (x, side * 0.72, 0.43), m["rust"], rotation=(pi / 2, 0, 0), vertices=12)
            else:
                torus(root, f"cracked_tire_{x}_{side}", 0.31, 0.095, (x, side * 0.73, 0.43), m["rubber"], segments=18)
                cylinder(root, f"wheel_hub_{x}_{side}", 0.14, 0.17, (x, side * 0.73, 0.43), m["steel"], rotation=(pi / 2, 0, 0), vertices=10)
    for index, y in enumerate((-0.35, 0, 0.35)):
        box(root, f"exposed_engine_block_{index}", (0.40, 0.23, 0.25), (1.17, y, 0.78), m["dark"], rotation=(0, 0.02 * index, 0), bevel=0.035)
    branch(root, "loose_exhaust", (-1.0, -0.48, 0.32), (-1.92, -0.63, 0.25), 0.045, m["steel"], vertices=10)
    irregular_panel(root, "open_driver_door", [(-0.58, -0.42), (0.56, -0.38), (0.50, 0.35), (-0.50, 0.42)], 0.07, m["rust"], (-0.18, -0.92, 1.06), (pi / 2, 0.16, 0.08))
    return root


TREE_VARIANTS = {
    "dead_tree_a": [((0, 0, 0.08), (0.08, 0.01, 1.55), 0.20), ((0.08, 0.01, 1.45), (-0.45, 0.08, 2.28), 0.11), ((0.05, 0, 1.62), (0.61, -0.16, 2.05), 0.09), ((-0.28, 0.06, 2.02), (-0.72, 0.12, 2.45), 0.055)],
    "dead_tree_b": [((0, 0, 0.08), (-0.12, 0.02, 1.40), 0.18), ((-0.12, 0.02, 1.32), (-0.54, -0.12, 2.00), 0.10), ((-0.10, 0.02, 1.45), (0.47, 0.18, 2.20), 0.095), ((0.34, 0.14, 2.00), (0.66, 0.22, 2.38), 0.05)],
    "dead_tree_c": [((0, 0, 0.08), (0.20, -0.03, 1.72), 0.23), ((0.18, -0.03, 1.58), (-0.34, -0.20, 2.50), 0.12), ((0.20, -0.03, 1.43), (0.78, 0.14, 2.18), 0.12), ((0.57, 0.09, 1.93), (0.95, 0.22, 2.52), 0.058), ((-0.18, -0.15, 2.23), (-0.63, -0.24, 2.71), 0.055)],
}


def build_tree(model_id, m):
    root = root_for(model_id)
    contact_shadow(root, 0.78, 0.56, m["shadow"])
    for index, (start, end, radius) in enumerate(TREE_VARIANTS[model_id]):
        branch(root, f"split_dead_branch_{index}", start, end, radius, m["wood"] if index < 3 else m["wood_dark"], vertices=10)
        if index:
            direction = Vector(end) - Vector(start)
            twig_start = Vector(start) + direction * 0.62
            twig_end = twig_start + Vector(((-1) ** index * 0.22, 0.12 * (index % 2), 0.28))
            branch(root, f"dry_twig_{index}", twig_start, twig_end, max(0.025, radius * 0.38), m["wood_dark"], vertices=8)
            opposing_end = twig_start + Vector(((-1) ** (index + 1) * 0.18, -0.15 * (index % 2 + 1), 0.20 + index * 0.025))
            branch(root, f"dry_opposing_twig_{index}", twig_start, opposing_end, max(0.018, radius * 0.29), m["wood_dark"], vertices=7)
    for index, angle in enumerate((0, 1.15, 2.35, 3.65, 4.85)):
        start = (0.04 * sin(angle), 0.04 * sin(angle + 1), 0.10)
        end = (0.62 * sin(angle), 0.58 * sin(angle + 1.3), 0.035)
        branch(root, f"exposed_root_{index}", start, end, 0.075, m["wood_dark"], vertices=8)
    rock(root, "root_stone", (0.28, -0.22, 0.10), (0.28, 0.20, 0.13), m["stone"], rotation=(0.2, 0.1, 0.5))
    return root


def build_bush(m):
    root = root_for("dry_bush")
    contact_shadow(root, 0.74, 0.55, m["shadow"])
    rng = random.Random("realm-dry-bush-bc-v1")
    for index in range(17):
        angle = index / 17 * pi * 2 + rng.uniform(-0.14, 0.14)
        length = rng.uniform(0.48, 0.88)
        start = (rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.035)
        bend = Vector((sin(angle) * length * 0.58, sin(angle + pi / 2) * length * 0.58, rng.uniform(0.34, 0.62)))
        end = Vector((sin(angle) * length, sin(angle + pi / 2) * length, rng.uniform(0.18, 0.55)))
        branch(root, f"bush_stem_{index}", start, bend, 0.022, m["wood"], vertices=7)
        branch(root, f"bush_twig_{index}", bend, end, 0.013, m["wood_dark"], vertices=6)
        side = bend + Vector((sin(angle + 1.2) * 0.20, sin(angle + 2.7) * 0.20, rng.uniform(0.08, 0.23)))
        branch(root, f"bush_fork_{index}", bend, side, 0.010, m["wood_dark"], vertices=6)
    return root


def build_rubble(m):
    root = root_for("rubble_rock")
    contact_shadow(root, 1.10, 0.82, m["shadow"])
    specs = [
        ((-0.42, -0.10, 0.27), (0.58, 0.45, 0.35)), ((0.12, 0.05, 0.35), (0.72, 0.56, 0.48)),
        ((0.58, 0.06, 0.22), (0.45, 0.40, 0.29)), ((-0.05, -0.48, 0.16), (0.38, 0.31, 0.22)),
        ((-0.55, 0.38, 0.15), (0.35, 0.30, 0.20)), ((0.40, 0.42, 0.14), (0.32, 0.26, 0.18)),
    ]
    for index, (location, scale) in enumerate(specs):
        rock(root, f"fractured_rubble_{index}", location, scale, m["stone"] if index % 3 else m["concrete"], rotation=(0.23 * index, 0.14 * index, 0.37 * index), subdivisions=1)
    branch(root, "exposed_rebar_a", (-0.55, -0.15, 0.36), (0.44, 0.38, 0.70), 0.024, m["rust"], vertices=8)
    branch(root, "exposed_rebar_b", (-0.10, 0.45, 0.18), (0.66, -0.27, 0.43), 0.019, m["steel"], vertices=8)
    for child in root.children:
        if child.name != "ground_contact_shadow":
            child.location.z += 0.32
    return root


def build_scrap(m):
    root = root_for("scrap_heap")
    contact_shadow(root, 1.25, 0.92, m["shadow"])
    for index, (start, end, radius) in enumerate((
        ((-0.90, -0.30, 0.12), (0.82, 0.34, 0.52), 0.055),
        ((-0.65, 0.42, 0.18), (0.72, -0.42, 0.63), 0.048),
        ((-0.22, -0.66, 0.20), (0.08, 0.67, 0.70), 0.045),
    )):
        branch(root, f"bent_scrap_pipe_{index}", start, end, radius, m["steel"] if index == 2 else m["rust"], vertices=10)
    irregular_panel(root, "torn_corrugated_sheet_a", [(-0.72, -0.48), (0.76, -0.40), (0.60, 0.44), (-0.54, 0.52)], 0.055, m["rust"], (0, 0, 0.36), (0.32, 0.08, 0.34))
    irregular_panel(root, "faded_scrap_panel", [(-0.50, -0.34), (0.55, -0.31), (0.43, 0.29), (-0.48, 0.38)], 0.065, m["paint"], (-0.22, 0.08, 0.62), (0.46, -0.18, -0.44))
    torus(root, "half_buried_tire", 0.36, 0.10, (0.53, 0.20, 0.33), m["rubber"], rotation=(0.18, 0.66, 0.10), segments=18)
    for index, location in enumerate(((-0.45, -0.15, 0.22), (0.18, -0.38, 0.25), (0.05, 0.28, 0.52))):
        cylinder(root, f"discarded_gear_{index}", 0.18 - index * 0.025, 0.08, location, m["dark"], rotation=(pi / 2, 0.2 * index, 0), vertices=12)
    box(root, "crushed_canister", (0.42, 0.28, 0.24), (-0.58, 0.38, 0.25), m["yellow"], rotation=(0.14, 0.42, 0.28), bevel=0.06)
    return root


def build_shack(m):
    root = root_for("wasteland_shack")
    contact_shadow(root, 2.35, 1.85, m["shadow"])
    box(root, "raised_shack_floor", (3.75, 2.75, 0.18), (0, 0, 0.18), m["wood_dark"], bevel=0.035)
    for index, x in enumerate((-1.72, -0.58, 0.58, 1.72)):
        box(root, f"floor_plank_{index}", (1.02, 2.54, 0.085), (x, 0, 0.31), m["wood"], rotation=(0, 0, 0.008 * (-1) ** index), bevel=0.018)
    for index, x in enumerate((-1.78, -0.60, 0.60, 1.78)):
        box(root, f"back_patch_{index}", (1.08, 0.15, 2.32), (x, 1.31, 1.43), m["rust"] if index % 2 else m["wood"], rotation=(0, 0.02 * (-1) ** index, 0), bevel=0.025)
    for side in (-1, 1):
        for index, y in enumerate((-0.88, 0.0, 0.88)):
            box(root, f"side_wall_{side}_{index}", (0.15, 0.82, 2.22), (side * 1.82, y, 1.39), m["wood"] if index == 1 else m["rust"], rotation=(0, 0.015 * side, 0), bevel=0.025)
    box(root, "front_left_wall", (1.22, 0.15, 2.22), (-1.24, -1.31, 1.39), m["wood"], bevel=0.025)
    box(root, "front_door_post", (0.20, 0.18, 2.35), (-0.50, -1.31, 1.45), m["steel"], bevel=0.02)
    box(root, "front_window_lower", (1.68, 0.15, 0.74), (0.93, -1.31, 0.70), m["rust"], bevel=0.025)
    box(root, "front_window_upper", (1.68, 0.15, 0.58), (0.93, -1.31, 2.18), m["paint"], bevel=0.025)
    box(root, "window_left_post", (0.18, 0.18, 0.90), (0.05, -1.32, 1.48), m["steel"], bevel=0.018)
    box(root, "window_right_post", (0.18, 0.18, 0.90), (1.80, -1.32, 1.48), m["steel"], bevel=0.018)
    irregular_panel(root, "hanging_door", [(-0.54, -1.02), (0.48, -0.98), (0.55, 0.96), (-0.45, 1.02)], 0.10, m["paint"], (-0.16, -1.58, 1.25), (pi / 2, 0.02, -0.20))
    for side in (-1, 1):
        branch(root, f"roof_beam_{side}", (-1.92, side * 1.36, 2.54), (1.92, side * 1.36, 2.78), 0.075, m["wood_dark"], vertices=9)
    for index, x in enumerate((-1.55, -0.52, 0.51, 1.54)):
        roof_material = m["rust"] if index in (0, 3) else (m["paint"] if index == 1 else m["steel"])
        box(
            root, f"patched_sloping_roof_{index}", (1.02, 3.08, 0.12),
            (x, 0.015 * (-1) ** index, 2.70 + 0.018 * (index % 2)),
            roof_material, rotation=(0.075 + 0.006 * (-1) ** index, 0, -0.016 + index * 0.008), bevel=0.022,
        )
    irregular_panel(root, "roof_canvas_patch", [(-0.82, -0.64), (0.82, -0.58), (0.72, 0.58), (-0.72, 0.64)], 0.025, m["cloth"], (-0.65, -0.20, 2.80), (0.075, 0, 0.05))
    for index, x in enumerate((-1.55, -0.75, 0.05, 0.85, 1.65)):
        branch(root, f"roof_rib_{index}", (x, -1.44, 2.58), (x, 1.44, 2.80), 0.025, m["steel"], vertices=8)
    branch(root, "crooked_stovepipe", (1.30, 0.65, 2.74), (1.35, 0.67, 3.55), 0.095, m["dark"], vertices=10)
    branch(root, "stovepipe_cap", (1.18, 0.67, 3.57), (1.52, 0.67, 3.57), 0.045, m["rust"], vertices=8)
    box(root, "entry_step", (1.15, 0.55, 0.16), (-0.20, -1.68, 0.14), m["wood"], rotation=(0, 0, 0.03), bevel=0.025)
    return root


def descendants(root):
    result = []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def stats(root):
    bpy.context.view_layer.update()
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return {
        "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(obj.data.loop_triangles) for obj in meshes),
        "minimumMetres": [round(v, 6) for v in minimum],
        "maximumMetres": [round(v, 6) for v in maximum],
        "sizeMetres": [round(v, 6) for v in maximum - minimum],
    }


def export_model(root, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()), export_format="GLB", use_selection=True,
        export_extras=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="AUTO", export_cameras=False, export_lights=False,
        export_animations=False,
        export_copyright="Realm of Ashes original priority environment B+C set.",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {root.name}: {result}")


def arrange_catalog(roots):
    positions = {
        "car_wreck": (-3.1, 1.9, 0), "wasteland_shack": (2.6, 1.75, 0),
        "dead_tree_a": (-3.5, -1.45, 0), "dead_tree_b": (-1.8, -1.45, 0),
        "dead_tree_c": (-0.1, -1.45, 0), "dry_bush": (1.35, -1.45, 0),
        "rubble_rock": (2.75, -1.55, 0), "scrap_heap": (4.25, -1.50, 0),
    }
    for root in roots:
        model_id = root["realm_model_id"]
        x, y, z = positions[model_id]
        root.location = (x, y, z + GROUND_LIFT_METRES.get(model_id, 0.0))


def render_catalog(path, roots):
    arrange_catalog(roots)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 980
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path.resolve())
    scene.world.color = (0.022, 0.025, 0.023)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0.4, 0.15, -0.018))
    ground = bpy.context.object
    ground.name = "priority_environment_review_ground"
    ground_mat = bpy.data.materials.new("priority_environment_review_ground_material")
    ground_mat.diffuse_color = (0.07, 0.065, 0.055, 1)
    ground_mat.roughness = 0.98
    ground.data.materials.append(ground_mat)
    camera_data = bpy.data.cameras.new("priority_environment_review_camera")
    camera = bpy.data.objects.new("priority_environment_review_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 11.3
    camera.location = (8.6, -11.7, 9.2)
    camera.rotation_euler = (Vector((0.25, 0.15, 0.95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    for name, location, energy, size in (
        ("review_key", (-5, -7, 11), 1700, 5.5),
        ("review_fill", (7, -1, 7), 950, 4.5),
        ("review_rim", (1, 7, 9), 1250, 4.0),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 0.6)) - light.location).to_track_quat("-Z", "Y").to_euler()
    label_mat = bpy.data.materials.new("priority_environment_label_material")
    label_mat.diffuse_color = (0.035, 0.038, 0.032, 1)
    for root in roots:
        model_id = root["realm_model_id"]
        curve = bpy.data.curves.new(f"label_{model_id}_curve", "FONT")
        curve.body = LABELS_RU[model_id]
        curve.align_x = "CENTER"
        curve.size = 0.18
        curve.extrude = 0.002
        label = bpy.data.objects.new(f"label_{model_id}", curve)
        scene.collection.objects.link(label)
        label.location = (root.location.x, root.location.y - 1.05, 0.012)
        label.data.materials.append(label_mat)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main():
    args = parse_args()
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    materials = make_materials()
    roots = [
        build_car(materials),
        build_tree("dead_tree_a", materials),
        build_tree("dead_tree_b", materials),
        build_tree("dead_tree_c", materials),
        build_bush(materials),
        build_rubble(materials),
        build_scrap(materials),
        build_shack(materials),
    ]
    report_models = {}
    for root in roots:
        model_id = root["realm_model_id"]
        root.location = (0, 0, GROUND_LIFT_METRES.get(model_id, 0.0))
        model_stats = stats(root)
        # Roots and half-buried rubble intentionally extend a few centimetres
        # below the terrain plane so they do not appear to float on slopes.
        if model_stats["minimumMetres"][2] < -0.05:
            raise RuntimeError(f"{model_id} is below ground: {model_stats['minimumMetres']}")
        output = args.output_dir / f"{model_id}_bc_v1.glb"
        export_model(root, output)
        report_models[model_id] = {
            "file": output.name,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest().upper(),
            **model_stats,
        }
    report = {
        "schema": "realm.priority-environment-report.v1",
        "style": "geometry_b_materials_c",
        "textureSize": TEXTURE_SIZE,
        "models": report_models,
        "totals": {
            key: sum(row[key] for row in report_models.values())
            for key in ("meshes", "vertices", "triangles")
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.render:
        render_catalog(args.render, roots)
    arrange_catalog(roots)
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
