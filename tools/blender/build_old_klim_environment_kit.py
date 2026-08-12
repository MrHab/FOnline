"""Build the authored Old Klim caravan-yard environment kit.

The kit is intentionally geometry-led: it uses deterministic material colours,
bevelled silhouettes and no raster textures.  Every source assembly is merged by
material before export so repeated dressing remains cheap to draw in the browser.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import atan2, cos, pi, sin
from pathlib import Path
import random
import shutil
import sys

import bpy
from mathutils import Vector


SCHEMA = "realm.old-klim-environment-model.v1"
REPORT_SCHEMA = "realm.old-klim-environment-report.v1"
MANIFEST_SCHEMA = "realm.old-klim-environment-kit.v1"
ASSET_VERSION = "old-klim-caravan-yard-v1"
BUILD_SEED = "realm-of-ashes:old-klim-caravan-yard:v1"

MODEL_ORDER = (
    "old_klim_trade_hall",
    "old_klim_trade_hall_roof",
    "old_klim_cliff_straight",
    "old_klim_cliff_corner",
    "old_klim_cliff_end",
    "old_klim_loading_canopy",
    "old_klim_caravan",
    "old_klim_scrub_blue_a",
    "old_klim_scrub_blue_b",
    "old_klim_scrub_amber",
    "old_klim_rock_scatter_a",
    "old_klim_rock_scatter_b",
    "old_klim_rock_scatter_c",
)

MODEL_META = {
    "old_klim_trade_hall": {
        "kind": "hero_structure",
        "instancing": "unique",
        "shadow": "realtime",
        "max_primitives": 5,
        "cutaway_group": "old_klim_trade_hall_roof",
    },
    "old_klim_trade_hall_roof": {
        "kind": "cutaway_roof",
        "instancing": "unique",
        "shadow": "realtime",
        "max_primitives": 2,
        "cutaway_for": "old_klim_trade_hall",
    },
    "old_klim_cliff_straight": {
        "kind": "cliff_module_straight",
        "instancing": "required",
        "shadow": "baked_or_disabled",
        "max_primitives": 2,
    },
    "old_klim_cliff_corner": {
        "kind": "cliff_module_corner",
        "instancing": "required",
        "shadow": "baked_or_disabled",
        "max_primitives": 2,
    },
    "old_klim_cliff_end": {
        "kind": "cliff_module_end",
        "instancing": "required",
        "shadow": "baked_or_disabled",
        "max_primitives": 2,
    },
    "old_klim_loading_canopy": {
        "kind": "loading_yard_canopy",
        "instancing": "limited",
        "shadow": "major_prop",
        "max_primitives": 2,
    },
    "old_klim_caravan": {
        "kind": "caravan_prop",
        "instancing": "limited",
        "shadow": "major_prop",
        "max_primitives": 3,
    },
    "old_klim_scrub_blue_a": {
        "kind": "scrub_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
    "old_klim_scrub_blue_b": {
        "kind": "scrub_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
    "old_klim_scrub_amber": {
        "kind": "scrub_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
    "old_klim_rock_scatter_a": {
        "kind": "rock_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
    "old_klim_rock_scatter_b": {
        "kind": "rock_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
    "old_klim_rock_scatter_c": {
        "kind": "rock_scatter",
        "instancing": "required",
        "shadow": "disabled",
        "max_primitives": 1,
    },
}

NON_BLOCKING_MODEL_IDS = frozenset({
    "old_klim_trade_hall_roof",
    "old_klim_scrub_blue_a",
    "old_klim_scrub_blue_b",
    "old_klim_scrub_amber",
    "old_klim_rock_scatter_a",
    "old_klim_rock_scatter_b",
    "old_klim_rock_scatter_c",
})


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--render", type=Path)
    parser.add_argument("--cutaway-render", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
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


def pbr_material(
    name: str,
    colour: tuple[float, float, float],
    roughness: float,
    metallic: float = 0.0,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*colour, 1.0)
    material.metallic = metallic
    material.roughness = roughness
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        emission_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        strength_input = shader.inputs.get("Emission Strength")
        if strength_input:
            strength_input.default_value = emission_strength
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_materials() -> dict[str, bpy.types.Material]:
    return {
        "charcoal": pbr_material(
            "old_klim_weathered_charcoal_steel", (0.092, 0.108, 0.112), 0.78, 0.42
        ),
        "teal": pbr_material(
            "old_klim_weathered_verdigris", (0.078, 0.138, 0.112), 0.88, 0.12
        ),
        "amber": pbr_material(
            "old_klim_amber_lamp", (0.64, 0.205, 0.035), 0.47, 0.08,
            emission=(1.0, 0.22, 0.018), emission_strength=3.8,
        ),
        "canvas": pbr_material(
            "old_klim_oxidised_canvas", (0.255, 0.135, 0.055), 0.96, 0.02
        ),
        "slate": pbr_material(
            "old_klim_charcoal_slate", (0.108, 0.116, 0.122), 0.97, 0.02
        ),
        "slate_cap": pbr_material(
            "old_klim_ash_dusted_slate", (0.172, 0.148, 0.116), 0.98, 0.01
        ),
        "scrub_blue": pbr_material(
            "old_klim_oxidised_blue_scrub", (0.105, 0.172, 0.162), 0.98
        ),
        "scrub_amber": pbr_material(
            "old_klim_dry_amber_scrub", (0.43, 0.245, 0.065), 0.98
        ),
        "rock": pbr_material(
            "old_klim_ash_beige_rock", (0.255, 0.225, 0.175), 0.99
        ),
    }


def create_root(model_id: str) -> bpy.types.Object:
    meta = MODEL_META[model_id]
    root = bpy.data.objects.new(model_id, None)
    bpy.context.scene.collection.objects.link(root)
    root["realm_schema"] = SCHEMA
    root["realm_model_id"] = model_id
    root["realm_asset_version"] = ASSET_VERSION
    root["realm_style"] = "geometry_b_material_colours"
    root["realm_kind"] = meta["kind"]
    root["realm_instancing"] = meta["instancing"]
    root["realm_shadow_policy"] = meta["shadow"]
    root["realm_max_primitives"] = meta["max_primitives"]
    root["realm_collision_policy"] = "authored_location_unchanged"
    if meta.get("cutaway_group"):
        root["realm_cutaway_group"] = meta["cutaway_group"]
    if meta.get("cutaway_for"):
        root["realm_cutaway_for"] = meta["cutaway_for"]
    return root


def finish_mesh(
    obj: bpy.types.Object,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    bevel: float = 0.0,
) -> bpy.types.Object:
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("stylised_bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    for face in obj.data.polygons:
        face.use_smooth = False
    obj.parent = parent
    return obj


def box(
    parent: bpy.types.Object,
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    material: bpy.types.Material,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.035,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, parent, material, min(bevel, min(size) * 0.22))


def cylinder(
    parent: bpy.types.Object,
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 10,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, parent, material, bevel)


def torus(
    parent: bpy.types.Object,
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    rotation: tuple[float, float, float] = (pi / 2, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=14,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, parent, material)


def beam_between(
    parent: bpy.types.Object,
    name: str,
    start: tuple[float, float, float] | Vector,
    end: tuple[float, float, float] | Vector,
    radius: float,
    material: bpy.types.Material,
    vertices: int = 7,
) -> bpy.types.Object:
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius * 1.03,
        radius2=radius * 0.78,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(
        direction.normalized()
    )
    return finish_mesh(obj, parent, material)


def faceted_rock(
    parent: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    rotation: tuple[float, float, float],
    seed: str,
    subdivisions: int = 1,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1.0,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    rng = random.Random(f"{BUILD_SEED}:{seed}")
    for index, vertex in enumerate(obj.data.vertices):
        jitter = 0.84 + rng.random() * 0.31
        axis = 0.96 + 0.055 * sin(index * 1.71 + rng.random())
        vertex.co *= jitter * axis
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, parent, material)


def chipped_cliff_mass(
    parent: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    body_material: bpy.types.Material,
    cap_material: bpy.types.Material,
    seed: str,
    lean: tuple[float, float] = (0.0, 0.0),
    yaw: float = 0.0,
    sides: int = 7,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build a deterministic, low-poly crag with an irregular chipped silhouette."""
    cx, cy, cz = location
    radius_x, radius_y, height = scale
    lean_x, lean_y = lean
    rng = random.Random(f"{BUILD_SEED}:{seed}")
    ring_heights = (0.0, 0.43, 0.79, 1.0)
    ring_scales = (0.86, 1.06, 0.93, 0.72)
    angle_offsets = [
        yaw + (2.0 * pi * index / sides) + rng.uniform(-0.105, 0.105)
        for index in range(sides)
    ]
    radial_profile = [rng.uniform(0.82, 1.16) for _ in range(sides)]
    vertices: list[tuple[float, float, float]] = []
    for ring_index, height_ratio in enumerate(ring_heights):
        ring_scale = ring_scales[ring_index]
        shift_x = lean_x * height_ratio + sin(height_ratio * pi) * 0.055 * radius_x
        shift_y = lean_y * height_ratio - sin(height_ratio * pi) * 0.035 * radius_y
        for side_index, angle in enumerate(angle_offsets):
            ring_jitter = 1.0 + rng.uniform(-0.055, 0.055)
            top_chip = rng.uniform(-0.055, 0.045) * height if ring_index == 3 else 0.0
            radial = radial_profile[side_index] * ring_scale * ring_jitter
            vertices.append((
                cx + shift_x + cos(angle) * radius_x * radial,
                cy + shift_y + sin(angle) * radius_y * radial,
                cz + height * height_ratio + top_chip,
            ))

    faces: list[tuple[int, ...]] = [tuple(reversed(range(sides)))]
    for ring_index in range(len(ring_heights) - 1):
        lower = ring_index * sides
        upper = (ring_index + 1) * sides
        for side_index in range(sides):
            next_index = (side_index + 1) % sides
            faces.append((
                lower + side_index,
                lower + next_index,
                upper + next_index,
                upper + side_index,
            ))
    top_start = (len(ring_heights) - 1) * sides
    faces.append(tuple(top_start + index for index in range(sides)))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    body = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(body)
    finish_mesh(body, parent, body_material)

    # A separate exposed top plane gives the mass an ash-dusted highlight without
    # adding another texture or draw-call group after material consolidation.
    cap_vertices = []
    for side_index in range(sides):
        x, y, z = vertices[top_start + side_index]
        cap_vertices.append((x, y, z + 0.018))
    cap_mesh = bpy.data.meshes.new(f"{name}_cap_mesh")
    cap_mesh.from_pydata(cap_vertices, [], [tuple(range(sides))])
    cap_mesh.update()
    cap = bpy.data.objects.new(f"{name}_cap", cap_mesh)
    bpy.context.scene.collection.objects.link(cap)
    finish_mesh(cap, parent, cap_material)
    return body, cap


def roof_canvas_mesh(
    parent: bpy.types.Object,
    name: str,
    width: float,
    depth: float,
    centre: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    cx, cy, cz = centre
    half_x = width * 0.5
    half_y = depth * 0.5
    ridge = 0.27
    thickness = 0.055
    top = [
        (-half_x, -half_y, 0.0),
        (0.0, -half_y, ridge),
        (half_x, -half_y, 0.0),
        (half_x, half_y, 0.0),
        (0.0, half_y, ridge),
        (-half_x, half_y, 0.0),
    ]
    vertices = [(x + cx, y + cy, z + cz) for x, y, z in top]
    vertices += [(x + cx, y + cy, z + cz - thickness) for x, y, z in top]
    faces = [
        (0, 1, 4, 5), (1, 2, 3, 4),
        (6, 11, 10, 7), (7, 10, 9, 8),
        (0, 6, 7, 1), (1, 7, 8, 2), (2, 8, 9, 3),
        (3, 9, 10, 4), (4, 10, 11, 5), (5, 11, 6, 0),
    ]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return finish_mesh(obj, parent, material, 0.012)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def consolidate_by_material(root: bpy.types.Object) -> None:
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    # Bake every source transform while the authored root is still at origin.
    # This keeps the exported pivot deterministic and avoids one joined mesh
    # inheriting an arbitrary source object's rotation or offset.
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    groups: dict[tuple[str, bool], list[bpy.types.Object]] = {}
    for obj in meshes:
        if not obj.data.materials:
            raise RuntimeError(f"{obj.name} has no material")
        collision_enabled = (
            obj.get("realmCollision") not in {"none", "ignore", "visual"}
            and obj.get("collision") is not False
        )
        groups.setdefault((obj.data.materials[0].name, collision_enabled), []).append(obj)
    for (material_name, collision_enabled), objects in sorted(groups.items()):
        material = bpy.data.materials[material_name]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        active.name = f"{root.name}_{material_name}_mesh"
        active.parent = root
        if root.name in NON_BLOCKING_MODEL_IDS or not collision_enabled:
            # The collider catalogue recognises ground_detail as visual-only in
            # addition to the explicit extras, including in older GLTFLoader.
            active.name = f"{root.name}_{material_name}_ground_detail"
            active["realmCollision"] = "none"
            active["collision"] = False
        while len(active.data.materials):
            active.data.materials.pop(index=len(active.data.materials) - 1)
        active.data.materials.append(material)
        for polygon in active.data.polygons:
            polygon.material_index = 0
            polygon.use_smooth = False
    bpy.ops.object.select_all(action="DESELECT")
    primitive_count = len([obj for obj in descendants(root) if obj.type == "MESH"])
    if primitive_count > MODEL_META[root.name]["max_primitives"]:
        raise RuntimeError(
            f"{root.name} has {primitive_count} primitives after consolidation"
        )


def build_trade_hall(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = create_root("old_klim_trade_hall")
    dark = materials["charcoal"]
    teal = materials["teal"]
    amber = materials["amber"]

    # Keep the walk collider authored inside the GLB without adding invisible
    # render meshes. Values use glTF X/Z coordinates (Blender X/-Y) and are
    # packed as centreX, centreZ, sizeX, sizeZ. The catalogue builder reads
    # these parts before falling back to mesh projection, so an open-front
    # building never collapses into one interior-filling AABB after batching.
    root["realm_collision_parts_schema"] = "center_x_center_z_size_x_size_z_v1"
    root["realm_collision_parts_xz"] = [
        0.0, -1.57, 7.25, 0.20,       # back wall
        -3.52, -0.08, 0.20, 3.05,    # left wall
        3.52, -0.08, 0.20, 3.05,     # right wall
        -2.72, 1.57, 1.55, 0.20,     # front-left panel
        -0.70, 1.57, 0.36, 0.22,     # centre pier
        1.55, 1.57, 3.90, 0.20,      # front-right lower wall
        1.50, 1.08, 3.55, 0.72,      # trade counter
        0.82, -1.12, 4.00, 0.62,     # interior counter
        -5.05, -1.05, 2.35, 0.72,    # workshop bench
        -6.42, 0.0, 0.18, 2.80,      # workshop side screen
    ]

    # Converted caravan shell and open-front cutaway interior.
    hall_chassis = box(root, "hall_chassis", (7.9, 3.75, 0.26), (0.0, 0.0, 0.31), dark, bevel=0.07)
    hall_floor = box(root, "hall_floor", (7.25, 3.35, 0.22), (0.0, 0.0, 0.58), teal, bevel=0.055)
    # These horizontal walk surfaces must not become one building-sized OBB.
    # The wall, counter and frame geometry below remains collision-authoritative.
    for walk_surface in (hall_chassis, hall_floor):
        walk_surface["realmCollision"] = "none"
        walk_surface["collision"] = False
    box(root, "hall_back_wall", (7.25, 0.20, 2.65), (0.0, 1.57, 1.95), teal, bevel=0.055)
    box(root, "hall_left_wall", (0.20, 3.05, 2.65), (-3.52, 0.08, 1.95), teal, bevel=0.055)
    box(root, "hall_right_wall", (0.20, 3.05, 2.65), (3.52, 0.08, 1.95), teal, bevel=0.055)
    box(root, "front_left_panel", (1.55, 0.20, 2.65), (-2.72, -1.57, 1.95), teal, bevel=0.055)
    box(root, "front_centre_pier", (0.36, 0.22, 2.65), (-0.70, -1.57, 1.95), dark, bevel=0.04)
    box(root, "front_right_lower", (3.90, 0.20, 0.82), (1.55, -1.57, 1.04), teal, bevel=0.05)
    box(root, "front_right_upper", (3.90, 0.20, 0.55), (1.55, -1.57, 3.00), teal, bevel=0.05)
    box(root, "trade_counter", (3.55, 0.72, 0.82), (1.50, -1.08, 1.02), dark, bevel=0.07)
    box(root, "interior_back_counter", (4.0, 0.62, 0.78), (0.82, 1.12, 1.00), dark, bevel=0.06)
    for x in (-2.90, -1.80, 2.90):
        box(root, f"vertical_frame_{x}", (0.16, 0.22, 2.88), (x, -1.52, 2.05), dark, bevel=0.025)
    box(root, "front_header", (7.30, 0.22, 0.20), (0.0, -1.55, 3.36), dark, bevel=0.035)
    for x in (-2.80, 2.80):
        for y in (-1.55, 1.55):
            box(root, f"corner_guard_{x}_{y}", (0.18, 0.18, 2.86), (x, y, 2.03), dark, bevel=0.025)

    # Axles and readable chunky wheels.
    for x in (-2.45, 2.45):
        for y in (-1.87, 1.87):
            torus(root, f"hall_wheel_{x}_{y}", 0.48, 0.145, (x, y, 0.62), dark)
            cylinder(root, f"hall_hub_{x}_{y}", 0.21, 0.16, (x, y, 0.62), teal, (pi / 2, 0.0, 0.0), 10)

    # Sheltered workshop wing, deliberately open at the front.
    workshop_floor = box(root, "workshop_floor", (3.05, 3.45, 0.18), (-5.08, 0.0, 0.28), dark, bevel=0.045)
    workshop_floor["realmCollision"] = "none"
    workshop_floor["collision"] = False
    for x in (-6.42, -3.78):
        for y in (-1.48, 1.48):
            box(root, f"workshop_post_{x}_{y}", (0.18, 0.18, 2.78), (x, y, 1.63), dark, bevel=0.025)
    for y in (-1.48, 1.48):
        box(root, f"workshop_header_{y}", (2.90, 0.18, 0.18), (-5.10, y, 3.05), dark, bevel=0.025)
    box(root, "workshop_back_bench", (2.35, 0.72, 0.85), (-5.05, 1.05, 0.82), teal, bevel=0.07)
    box(root, "workshop_side_screen", (0.18, 2.80, 1.55), (-6.42, 0.0, 1.05), teal, bevel=0.035)

    # Front access and warm focal lights.
    for index, (width, y, z) in enumerate(((1.55, -1.92, 0.36), (1.28, -2.20, 0.18))):
        entry_step = box(root, f"entry_step_{index}", (width, 0.45, 0.16), (-1.70, y, z), dark, bevel=0.035)
        entry_step["realmCollision"] = "none"
        entry_step["collision"] = False
    for index, location in enumerate(((-3.10, -1.76, 2.20), (-0.95, -1.76, 2.20), (3.10, -1.76, 2.20), (-5.45, -1.50, 2.10))):
        cylinder(root, f"amber_lamp_{index}", 0.115, 0.34, location, amber, vertices=10, bevel=0.015)
        box(root, f"lamp_bracket_{index}", (0.08, 0.22, 0.42), (location[0], location[1] + 0.12, location[2]), dark, bevel=0.012)

    consolidate_by_material(root)
    return root


def build_trade_hall_roof(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = create_root("old_klim_trade_hall_roof")
    dark = materials["charcoal"]
    teal = materials["teal"]
    for index, (x, width, tilt) in enumerate(((-2.45, 2.35, -0.012), (0.0, 2.35, 0.015), (2.45, 2.35, -0.01))):
        box(root, f"roof_panel_{index}", (width, 3.62, 0.18), (x, 0.0, 3.47 + abs(tilt) * 2), teal, (0.0, tilt, 0.0), bevel=0.055)
    box(root, "workshop_roof", (3.02, 3.58, 0.16), (-5.10, 0.0, 3.20), teal, (0.0, -0.02, 0.0), bevel=0.05)
    for x in (-3.46, 3.46):
        box(root, f"roof_side_rail_{x}", (0.16, 3.60, 0.68), (x, 0.0, 3.88), dark, bevel=0.025)
    for y in (-1.73, 1.73):
        box(root, f"roof_end_rail_{y}", (7.08, 0.15, 0.68), (0.0, y, 3.88), dark, bevel=0.025)
    for x in (-3.42, -1.72, 0.0, 1.72, 3.42):
        for y in (-1.73, 1.73):
            box(root, f"rail_post_{x}_{y}", (0.14, 0.14, 0.82), (x, y, 3.86), dark, bevel=0.02)
    cylinder(root, "roof_water_tank", 0.58, 1.18, (2.15, 0.58, 4.17), dark, vertices=14, bevel=0.025)
    cylinder(root, "roof_water_tank_cap", 0.38, 0.16, (2.15, 0.58, 4.84), teal, vertices=14, bevel=0.02)
    consolidate_by_material(root)
    return root


def build_cliff_module(
    model_id: str,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    root = create_root(model_id)
    slate = materials["slate"]
    cap = materials["slate_cap"]
    if model_id == "old_klim_cliff_straight":
        masses = [
            (-2.05, 0.10, 1.20, 1.02, 3.45, 0.16, -0.11, 0.06),
            (-0.78, 0.16, 1.12, 1.00, 4.02, -0.10, 0.14, -0.05),
            (0.57, -0.05, 1.18, 1.06, 3.58, 0.13, 0.08, 0.08),
            (1.90, 0.10, 1.16, 0.98, 4.13, -0.15, -0.08, -0.04),
        ]
    elif model_id == "old_klim_cliff_corner":
        masses = [
            (-1.62, 0.23, 1.20, 1.02, 3.74, 0.15, -0.10, 0.04),
            (-0.28, 0.20, 1.15, 1.00, 4.08, -0.09, 0.14, -0.07),
            (0.82, 0.46, 1.08, 1.05, 3.56, 0.12, 0.10, 0.09),
            (1.02, 1.65, 1.02, 0.88, 3.91, -0.11, -0.04, -0.02),
            (1.08, 2.78, 0.94, 0.78, 3.34, 0.10, 0.05, 0.11),
        ]
    else:
        masses = [
            (-1.44, 0.13, 1.18, 1.02, 3.94, 0.15, -0.10, 0.05),
            (-0.15, 0.10, 1.08, 0.96, 3.62, -0.08, 0.12, -0.08),
            (1.00, 0.05, 0.92, 0.82, 2.78, 0.12, 0.06, 0.10),
            (1.88, 0.02, 0.68, 0.62, 1.82, -0.08, -0.03, -0.04),
        ]
    for index, (x, y, sx, sy, height, lean_x, lean_y, yaw) in enumerate(masses):
        chipped_cliff_mass(
            root,
            f"cliff_crag_{index}",
            (x, y, 0.04),
            (sx, sy, height),
            slate,
            cap,
            f"{model_id}:crag:{index}",
            (lean_x, lean_y),
            yaw,
            sides=7 if index % 2 == 0 else 8,
        )
    consolidate_by_material(root)
    return root


def build_loading_canopy(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = create_root("old_klim_loading_canopy")
    dark = materials["charcoal"]
    canvas = materials["canvas"]
    for x in (-2.15, 2.15):
        for y in (-1.45, 1.45):
            box(root, f"canopy_post_{x}_{y}", (0.18, 0.18, 2.80), (x, y, 1.42), dark, bevel=0.025)
    for y in (-1.45, 1.45):
        box(root, f"canopy_long_header_{y}", (4.52, 0.18, 0.18), (0.0, y, 2.78), dark, bevel=0.025)
    for x in (-2.15, 0.0, 2.15):
        box(root, f"canopy_cross_header_{x}", (0.16, 3.08, 0.16), (x, 0.0, 2.82), dark, bevel=0.022)
    roof_canvas_mesh(root, "patched_canvas", 4.72, 3.18, (0.0, 0.0, 2.93), canvas)
    box(root, "loading_table", (2.15, 0.80, 0.16), (-0.75, 0.72, 0.92), canvas, bevel=0.045)
    for x in (-1.60, 0.10):
        box(root, f"table_leg_{x}", (0.16, 0.16, 0.86), (x, 0.72, 0.47), dark, bevel=0.02)
    consolidate_by_material(root)
    return root


def build_caravan(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = create_root("old_klim_caravan")
    dark = materials["charcoal"]
    teal = materials["teal"]
    canvas = materials["canvas"]
    box(root, "caravan_chassis", (5.30, 2.10, 0.24), (0.0, 0.0, 0.43), dark, bevel=0.055)
    box(root, "cargo_bed", (3.15, 1.92, 0.55), (-0.78, 0.0, 0.82), teal, bevel=0.065)
    box(root, "cab_lower", (1.72, 1.90, 0.72), (1.78, 0.0, 0.90), teal, bevel=0.10)
    box(root, "cab_upper", (1.45, 1.75, 0.82), (1.55, 0.0, 1.62), teal, (0.0, -0.08, 0.0), bevel=0.10)
    box(root, "windscreen", (0.12, 1.40, 0.46), (2.27, 0.0, 1.70), dark, (0.0, -0.10, 0.0), bevel=0.045)
    box(root, "front_bumper", (0.30, 2.02, 0.20), (2.72, 0.0, 0.57), dark, bevel=0.045)
    for x in (-1.65, 1.72):
        for y in (-1.08, 1.08):
            torus(root, f"caravan_wheel_{x}_{y}", 0.43, 0.13, (x, y, 0.58), dark)
            cylinder(root, f"caravan_hub_{x}_{y}", 0.18, 0.14, (x, y, 0.58), teal, (pi / 2, 0.0, 0.0), 10)
    for x in (-2.10, -0.95, 0.20):
        for y in (-0.88, 0.88):
            box(root, f"cargo_stake_{x}_{y}", (0.13, 0.13, 1.62), (x, y, 1.56), dark, bevel=0.02)
    roof_canvas_mesh(root, "cargo_canvas", 3.55, 2.12, (-0.92, 0.0, 2.28), canvas)
    for y in (-0.96, 0.96):
        box(root, f"canvas_side_{y}", (3.45, 0.08, 1.05), (-0.92, y, 1.77), canvas, bevel=0.025)
    consolidate_by_material(root)
    return root


def build_scrub(
    model_id: str,
    materials: dict[str, bpy.types.Material],
    colour_key: str,
    spread: float,
    height: float,
    phase: float,
) -> bpy.types.Object:
    root = create_root(model_id)
    material = materials[colour_key]
    rng = random.Random(f"{BUILD_SEED}:{model_id}")
    stem_count = 9
    for index in range(stem_count):
        angle = phase + index / stem_count * pi * 2 + rng.uniform(-0.16, 0.16)
        length = spread * rng.uniform(0.65, 1.02)
        base = Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.025))
        bend = Vector((
            cos(angle) * length * 0.42,
            sin(angle) * length * 0.42,
            height * rng.uniform(0.58, 0.92),
        ))
        end = Vector((
            cos(angle) * length,
            sin(angle) * length,
            height * rng.uniform(0.42, 1.02),
        ))
        beam_between(root, f"scrub_stem_{index}", base, bend, 0.022, material, 6)
        beam_between(root, f"scrub_tip_{index}", bend, end, 0.013, material, 5)
        fork_angle = angle + (-1 if index % 2 else 1) * rng.uniform(0.55, 0.95)
        fork = bend + Vector((
            cos(fork_angle) * length * 0.32,
            sin(fork_angle) * length * 0.32,
            height * rng.uniform(0.12, 0.32),
        ))
        beam_between(root, f"scrub_fork_{index}", bend, fork, 0.011, material, 5)
    consolidate_by_material(root)
    return root


def build_rock_scatter(
    model_id: str,
    materials: dict[str, bpy.types.Material],
    specs: tuple[tuple[tuple[float, float, float], tuple[float, float, float]], ...],
) -> bpy.types.Object:
    root = create_root(model_id)
    for index, (location, scale) in enumerate(specs):
        faceted_rock(
            root,
            f"scatter_rock_{index}",
            location,
            scale,
            materials["rock"],
            (0.13 * index, 0.09 * (index % 3), 0.47 * index),
            f"{model_id}:{index}",
        )
    consolidate_by_material(root)
    for child in descendants(root):
        if child.type == "MESH":
            child.location.z += 0.08
    return root


def model_stats(root: bpy.types.Object) -> dict:
    bpy.context.view_layer.update()
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{root.name} has no meshes")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    triangles = 0
    vertices = 0
    materials: set[str] = set()
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        vertices += len(obj.data.vertices)
        materials.update(mat.name for mat in obj.data.materials if mat)
    return {
        "meshes": len(meshes),
        "primitives": len(meshes),
        "materials": len(materials),
        "materialNames": sorted(materials),
        "images": 0,
        "vertices": vertices,
        "triangles": triangles,
        "minimumMetres": [round(value, 5) for value in minimum],
        "maximumMetres": [round(value, 5) for value in maximum],
        "sizeMetres": [round(value, 5) for value in maximum - minimum],
    }


def export_model(root: bpy.types.Object, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_copyright="Realm of Ashes original Old Klim caravan-yard kit.",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {root.name}: {result}")
    bpy.ops.object.select_all(action="DESELECT")


def exported_glb_stats(output: Path) -> dict[str, int]:
    data = output.read_bytes()
    if data[:4] != b"glTF" or int.from_bytes(data[4:8], "little") != 2:
        raise RuntimeError(f"{output.name} is not a glTF 2 GLB")
    offset = 12
    payload = None
    while offset + 8 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], "little")
        chunk_type = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        if chunk_type == b"JSON":
            payload = json.loads(chunk.decode("utf-8").rstrip("\0 "))
        offset += 8 + length
    if payload is None:
        raise RuntimeError(f"{output.name} does not contain a JSON chunk")
    meshes = payload.get("meshes", [])
    primitives = [primitive for mesh in meshes for primitive in mesh.get("primitives", [])]
    triangles = sum(
        int(payload["accessors"][primitive["indices"]]["count"]) // 3
        for primitive in primitives
    )
    vertices = sum(
        int(payload["accessors"][primitive["attributes"]["POSITION"]]["count"])
        for primitive in primitives
    )
    return {
        "meshes": len(meshes),
        "primitives": len(primitives),
        "materials": len(payload.get("materials", [])),
        "images": len(payload.get("images", [])),
        "vertices": vertices,
        "triangles": triangles,
    }


def arrange_review_scene(roots: dict[str, bpy.types.Object]) -> None:
    placements = {
        "old_klim_trade_hall": (-3.25, -0.75, 0.0, 0.0),
        "old_klim_trade_hall_roof": (-3.25, -0.75, 0.0, 0.0),
        "old_klim_loading_canopy": (4.5, -0.15, 0.0, 0.0),
        "old_klim_caravan": (5.15, 3.0, 0.0, -0.30),
        "old_klim_cliff_straight": (-5.35, 6.0, 0.0, 0.03),
        "old_klim_cliff_corner": (0.35, 6.25, 0.0, 0.02),
        "old_klim_cliff_end": (6.3, 6.2, 0.0, 0.04),
        "old_klim_scrub_blue_a": (-7.4, 2.65, 0.0, 0.0),
        "old_klim_scrub_blue_b": (7.6, 0.5, 0.0, 1.1),
        "old_klim_scrub_amber": (1.7, 3.8, 0.0, 0.4),
        "old_klim_rock_scatter_a": (-7.0, -3.6, 0.0, 0.0),
        "old_klim_rock_scatter_b": (0.2, -4.5, 0.0, 0.8),
        "old_klim_rock_scatter_c": (6.6, -3.0, 0.0, 0.2),
    }
    for model_id, root in roots.items():
        x, y, z, rotation = placements[model_id]
        root.location = (x, y, z)
        root.rotation_euler.z = rotation


def add_review_stage(materials: dict[str, bpy.types.Material]) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1125
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.012, 0.016, 0.022)
    scene.view_settings.look = "AgX - Medium High Contrast"

    ground_material = pbr_material(
        "old_klim_review_ash_ground", (0.23, 0.185, 0.125), 0.99
    )
    bpy.ops.mesh.primitive_plane_add(size=32, location=(0.0, 1.2, -0.035))
    ground = bpy.context.object
    ground.name = "old_klim_review_ground"
    ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("old_klim_review_camera")
    camera = bpy.data.objects.new("old_klim_review_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 19.5
    camera.location = (17.5, -23.0, 17.0)
    target = Vector((0.0, 1.25, 1.8))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()

    for name, location, colour, energy, size in (
        ("old_klim_key", (-7.5, -9.0, 15.0), (1.0, 0.59, 0.31), 1900, 7.0),
        ("old_klim_fill", (9.0, -1.0, 10.0), (0.28, 0.48, 0.72), 1150, 6.0),
        ("old_klim_rim", (0.0, 11.0, 13.0), (0.34, 0.53, 0.80), 1500, 5.0),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.color = colour
        light_data.energy = energy
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()

    # Preview-only warm pools show the intended contrast; runtime can bake them.
    for index, location in enumerate(((-6.3, -2.1, 2.0), (-4.1, -2.2, 2.0), (-0.1, -2.1, 2.0))):
        light_data = bpy.data.lights.new(f"preview_amber_{index}", "POINT")
        light_data.color = (1.0, 0.19, 0.018)
        light_data.energy = 125
        light_data.shadow_soft_size = 1.4
        light = bpy.data.objects.new(f"preview_amber_{index}", light_data)
        scene.collection.objects.link(light)
        light.location = location


def render_review(path: Path, roof: bpy.types.Object, cutaway: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    roof.hide_render = cutaway
    scene.render.filepath = str(path.resolve())
    bpy.ops.render.render(write_still=True)
    roof.hide_render = False


def main() -> None:
    args = parse_args()
    clear_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    materials = make_materials()
    roots_list = [
        build_trade_hall(materials),
        build_trade_hall_roof(materials),
        build_cliff_module("old_klim_cliff_straight", materials),
        build_cliff_module("old_klim_cliff_corner", materials),
        build_cliff_module("old_klim_cliff_end", materials),
        build_loading_canopy(materials),
        build_caravan(materials),
        build_scrub("old_klim_scrub_blue_a", materials, "scrub_blue", 0.74, 0.82, 0.0),
        build_scrub("old_klim_scrub_blue_b", materials, "scrub_blue", 0.92, 0.64, 0.52),
        build_scrub("old_klim_scrub_amber", materials, "scrub_amber", 0.64, 0.91, 0.25),
        build_rock_scatter(
            "old_klim_rock_scatter_a", materials,
            (((-0.42, -0.08, 0.20), (0.52, 0.39, 0.25)), ((0.18, 0.10, 0.27), (0.62, 0.46, 0.34)), ((0.68, -0.03, 0.14), (0.34, 0.28, 0.19))),
        ),
        build_rock_scatter(
            "old_klim_rock_scatter_b", materials,
            (((-0.34, 0.12, 0.15), (0.42, 0.34, 0.21)), ((0.16, -0.15, 0.17), (0.48, 0.35, 0.24)), ((0.50, 0.26, 0.11), (0.29, 0.23, 0.16)), ((-0.62, -0.22, 0.09), (0.24, 0.20, 0.13))),
        ),
        build_rock_scatter(
            "old_klim_rock_scatter_c", materials,
            (((-0.12, 0.00, 0.32), (0.67, 0.51, 0.41)), ((0.52, 0.14, 0.18), (0.39, 0.31, 0.23)), ((-0.52, -0.18, 0.14), (0.33, 0.27, 0.19))),
        ),
    ]
    roots = {root.name: root for root in roots_list}
    if tuple(roots) != MODEL_ORDER:
        raise RuntimeError(f"Unexpected model order: {tuple(roots)}")

    args.review_dir.mkdir(parents=True, exist_ok=True)
    args.runtime_dir.mkdir(parents=True, exist_ok=True)
    models: dict[str, dict] = {}
    for model_id in MODEL_ORDER:
        root = roots[model_id]
        root.location = (0.0, 0.0, 0.0)
        root.rotation_euler = (0.0, 0.0, 0.0)
        source_stats = model_stats(root)
        if source_stats["minimumMetres"][2] < -0.06:
            raise RuntimeError(f"{model_id} extends below ground: {source_stats['minimumMetres']}")
        review_file = args.review_dir / f"{model_id}.glb"
        runtime_file = args.runtime_dir / f"{model_id}.glb"
        export_model(root, review_file)
        shutil.copyfile(review_file, runtime_file)
        export_stats = exported_glb_stats(review_file)
        stats = {
            **source_stats,
            "sourceVertices": source_stats["vertices"],
            **export_stats,
        }
        digest = hashlib.sha256(review_file.read_bytes()).hexdigest().upper()
        models[model_id] = {
            "file": review_file.name,
            "runtimeFile": f"/assets/models/wasteland/{runtime_file.name}",
            "sha256": digest,
            "bytes": review_file.stat().st_size,
            "kind": MODEL_META[model_id]["kind"],
            "instancing": MODEL_META[model_id]["instancing"],
            "shadowPolicy": MODEL_META[model_id]["shadow"],
            **stats,
        }
        if MODEL_META[model_id].get("cutaway_group"):
            models[model_id]["cutawayGroup"] = MODEL_META[model_id]["cutaway_group"]
        if MODEL_META[model_id].get("cutaway_for"):
            models[model_id]["cutawayFor"] = MODEL_META[model_id]["cutaway_for"]

    generator_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest().upper()
    totals = {
        key: sum(int(model[key]) for model in models.values())
        for key in ("bytes", "meshes", "primitives", "vertices", "triangles")
    }
    report = {
        "schema": REPORT_SCHEMA,
        "assetVersion": ASSET_VERSION,
        "style": "geometry_b_material_colours",
        "buildSeed": BUILD_SEED,
        "generator": "tools/blender/build_old_klim_environment_kit.py",
        "generatorSha256": generator_sha,
        "rasterTextureDependencies": 0,
        "models": models,
        "totals": totals,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "assetVersion": ASSET_VERSION,
        "style": "geometry_b_material_colours",
        "sourceReview": "docs/art/reviews/old-klim-environment-kit-v1",
        "generator": report["generator"],
        "generatorSha256": generator_sha,
        "rasterTextureDependencies": 0,
        "models": {
            model_id: {
                key: value
                for key, value in models[model_id].items()
                if key not in ("file", "materialNames", "minimumMetres", "maximumMetres")
            }
            for model_id in MODEL_ORDER
        },
        "totals": totals,
    }
    (args.runtime_dir / "old-klim-environment-kit-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    arrange_review_scene(roots)
    add_review_stage(materials)
    if args.render:
        render_review(args.render, roots["old_klim_trade_hall_roof"], cutaway=False)
    if args.cutaway_render:
        render_review(args.cutaway_render, roots["old_klim_trade_hall_roof"], cutaway=True)
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
