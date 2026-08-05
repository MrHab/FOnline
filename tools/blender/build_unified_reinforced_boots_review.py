"""Build the B+C reinforced-boots review asset on the approved boot fit.

The approved v21 boot proportions and skinning remain the anatomical base.
Original protection geometry adds a steel toe, shin and heel plates, outer
ankle guards, retaining straps and a reinforced lugged sole.  Every pair is
built directly on one of the six current 65-bone player bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import cos, pi, sin
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def load_boot_base_module():
    path = Path(__file__).with_name("build_unified_boots_review.py")
    spec = importlib.util.spec_from_file_location("realm_boot_base", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load approved boot builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = load_boot_base_module()


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_reinforced_boots_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--side-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    parser.add_argument("--game-render", type=Path)
    parser.add_argument("--walk-render", type=Path)
    parser.add_argument("--run-render", type=Path)
    return parser.parse_args(argv)


def normalized(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, value) for value in weights.values())
    if total <= 0.0:
        return weights
    return {name: max(0.0, value) / total for name, value in weights.items() if value > 0.0}


def add_box(
    builder,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    material: int,
    weights: dict[str, float],
) -> None:
    cx, cy, cz = center
    sx, sy, sz = (value * 0.5 for value in size)
    weights = normalized(weights)
    indices = [
        builder.add_vertex((cx + dx * sx, cy + dy * sy, cz + dz * sz), weights)
        for dz in (-1.0, 1.0)
        for dy in (-1.0, 1.0)
        for dx in (-1.0, 1.0)
    ]
    for face in (
        (0, 1, 3, 2), (4, 6, 7, 5),
        (0, 4, 5, 1), (2, 3, 7, 6),
        (0, 2, 6, 4), (1, 5, 7, 3),
    ):
        builder.add_face(tuple(indices[index] for index in face), material)


def add_prism_y(
    builder,
    center: Vector,
    radius: float,
    depth: float,
    material: int,
    weights: dict[str, float],
    segments: int = 8,
) -> None:
    weights = normalized(weights)
    rings: list[list[int]] = []
    for y in (center.y - depth * 0.5, center.y + depth * 0.5):
        rings.append([
            builder.add_vertex(
                (center.x + cos(2.0 * pi * index / segments) * radius, y, center.z + sin(2.0 * pi * index / segments) * radius),
                weights,
            )
            for index in range(segments)
        ])
    builder.add_face(tuple(reversed(rings[0])), material)
    builder.add_face(tuple(rings[1]), material)
    for index in range(segments):
        following = (index + 1) % segments
        builder.add_face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)


def add_toe_cap(
    builder,
    side: str,
    center_x: float,
    half_width: float,
    toe_y: float,
    sole_top: float,
) -> None:
    # Four dorsal sections form a compact stamped cap instead of a cuboid toe.
    stations = (
        (toe_y + 0.008, 0.28, sole_top + 0.050, 0.62),
        (toe_y + 0.032, 0.68, sole_top + 0.078, 0.55),
        (toe_y + 0.075, 0.96, sole_top + 0.112, 0.38),
        (toe_y + 0.118, 0.92, sole_top + 0.132, 0.18),
    )
    arcs: list[list[int]] = []
    arc_segments = 8
    for y, width_factor, top_z, ball_weight in stations:
        ring = []
        width = half_width * width_factor
        for index in range(arc_segments + 1):
            angle = pi - pi * index / arc_segments
            x = center_x + cos(angle) * width
            z = sole_top + 0.006 + (top_z - sole_top - 0.006) * sin(angle) ** 0.70
            ring.append(builder.add_vertex(
                (x, y, z),
                normalized({f"foot_{side}": 1.0 - ball_weight, f"ball_{side}": ball_weight}),
            ))
        arcs.append(ring)
    for station_index in range(len(arcs) - 1):
        for index in range(arc_segments):
            builder.add_face((
                arcs[station_index][index], arcs[station_index + 1][index],
                arcs[station_index + 1][index + 1], arcs[station_index][index + 1],
            ), 0)
    builder.add_face(tuple(reversed(arcs[0])), 1)
    builder.add_face(tuple(arcs[-1]), 0)
    # Readable worn steel border across the rear of the cap.
    add_box(
        builder,
        (center_x, stations[-1][0] + 0.002, sole_top + 0.052),
        (half_width * 1.70, 0.008, 0.010),
        1,
        {f"foot_{side}": 0.84, f"ball_{side}": 0.16},
    )


def add_shin_plate(
    builder,
    side: str,
    center_x: float,
    front_y: float,
) -> None:
    rows = (
        (0.098, 0.038, 0.003),
        (0.150, 0.049, -0.003),
        (0.207, 0.055, -0.001),
        (0.238, 0.051, 0.004),
    )
    columns = (-1.0, -0.45, 0.0, 0.45, 1.0)
    front: list[list[int]] = []
    back: list[list[int]] = []
    for row_index, (z, half_width, y_bulge) in enumerate(rows):
        calf_weight = 0.62 + row_index * 0.12
        weights = normalized({f"foot_{side}": 1.0 - calf_weight, f"calf_{side}": calf_weight})
        front_row = []
        back_row = []
        for column in columns:
            crown = (1.0 - abs(column)) * 0.005
            x = center_x + column * half_width
            front_row.append(builder.add_vertex((x, front_y + y_bulge - crown, z), weights))
            back_row.append(builder.add_vertex((x, front_y + y_bulge + 0.006, z), weights))
        front.append(front_row)
        back.append(back_row)
    for row_index in range(len(rows) - 1):
        for column_index in range(len(columns) - 1):
            builder.add_face((
                front[row_index][column_index], front[row_index + 1][column_index],
                front[row_index + 1][column_index + 1], front[row_index][column_index + 1],
            ), 0)
            builder.add_face((
                back[row_index][column_index + 1], back[row_index + 1][column_index + 1],
                back[row_index + 1][column_index], back[row_index][column_index],
            ), 0)
    # Close the plate perimeter.
    for row_index in range(len(rows) - 1):
        builder.add_face((front[row_index][0], back[row_index][0], back[row_index + 1][0], front[row_index + 1][0]), 0)
        builder.add_face((front[row_index + 1][-1], back[row_index + 1][-1], back[row_index][-1], front[row_index][-1]), 0)
    for column_index in range(len(columns) - 1):
        builder.add_face((front[0][column_index], front[0][column_index + 1], back[0][column_index + 1], back[0][column_index]), 0)
        builder.add_face((front[-1][column_index + 1], front[-1][column_index], back[-1][column_index], back[-1][column_index + 1]), 0)

    add_box(builder, (center_x, front_y - 0.006, 0.172), (0.010, 0.006, 0.118), 1, {f"calf_{side}": 1.0})
    for x_direction in (-1.0, 1.0):
        for z in (0.118, 0.218):
            add_prism_y(
                builder,
                Vector((center_x + x_direction * 0.035, front_y - 0.006, z)),
                0.006,
                0.006,
                1,
                {f"calf_{side}": 1.0},
            )
    # Small oxidised repair area, offset from the central ridge.
    add_box(builder, (center_x + 0.026, front_y - 0.0095, 0.176), (0.018, 0.0025, 0.024), 4, {f"calf_{side}": 1.0})


def add_heel_plate(
    builder,
    side: str,
    center_x: float,
    half_width: float,
    heel_y: float,
    sole_top: float,
) -> None:
    widths = (half_width * 0.72, half_width * 0.96, half_width * 0.88)
    heights = (sole_top + 0.020, 0.078, 0.132)
    front_y = heel_y + 0.003
    back_y = front_y + 0.007
    front = []
    back = []
    for half, z in zip(widths, heights):
        front.append((
            builder.add_vertex((center_x - half, front_y, z), {f"foot_{side}": 1.0}),
            builder.add_vertex((center_x + half, front_y, z), {f"foot_{side}": 1.0}),
        ))
        back.append((
            builder.add_vertex((center_x - half, back_y, z), {f"foot_{side}": 1.0}),
            builder.add_vertex((center_x + half, back_y, z), {f"foot_{side}": 1.0}),
        ))
    for index in range(2):
        builder.add_face((front[index][0], front[index][1], front[index + 1][1], front[index + 1][0]), 0)
        builder.add_face((back[index][1], back[index][0], back[index + 1][0], back[index + 1][1]), 0)
    builder.add_face((front[0][0], back[0][0], back[0][1], front[0][1]), 1)
    builder.add_face((front[-1][1], back[-1][1], back[-1][0], front[-1][0]), 1)
    for side_index in (0, 1):
        builder.add_face((front[0][side_index], front[-1][side_index], back[-1][side_index], back[0][side_index]), 0)


def add_outer_ankle_plate(
    builder,
    side: str,
    center_x: float,
    half_width: float,
    ankle_center_y: float,
) -> None:
    direction = 1.0 if side == "l" else -1.0
    outer_x = center_x + direction * half_width * 1.02
    inner_x = outer_x - direction * 0.009
    outline = (
        (ankle_center_y - 0.052, 0.088),
        (ankle_center_y + 0.050, 0.092),
        (ankle_center_y + 0.064, 0.142),
        (ankle_center_y + 0.032, 0.172),
        (ankle_center_y - 0.038, 0.164),
    )
    weights = normalized({f"foot_{side}": 0.42, f"calf_{side}": 0.58})
    outer = [builder.add_vertex((outer_x, y, z), weights) for y, z in outline]
    inner = [builder.add_vertex((inner_x, y, z), weights) for y, z in outline]
    if direction > 0.0:
        builder.add_face(tuple(outer), 0)
        builder.add_face(tuple(reversed(inner)), 0)
    else:
        builder.add_face(tuple(reversed(outer)), 0)
        builder.add_face(tuple(inner), 0)
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        builder.add_face((outer[index], outer[following], inner[following], inner[index]), 1 if index in {0, 3} else 0)
    add_prism_y(
        builder,
        Vector((outer_x + direction * 0.002, ankle_center_y + 0.006, 0.132)),
        0.006,
        0.012,
        1,
        weights,
    )


def add_reinforced_sole(
    builder,
    side: str,
    center_x: float,
    half_width: float,
    heel_y: float,
    toe_y: float,
    sole_bottom: float,
) -> None:
    depth = heel_y - toe_y
    for index, progression in enumerate((0.11, 0.34, 0.58, 0.81)):
        y = heel_y + (toe_y - heel_y) * progression
        width_factor = (0.70, 0.94, 0.96, 0.76)[index]
        ball_weight = max(0.0, min(0.72, (progression - 0.42) / 0.48))
        add_box(
            builder,
            (center_x, y, sole_bottom - 0.006),
            (half_width * 2.0 * width_factor, depth * 0.095, 0.014),
            2,
            normalized({f"foot_{side}": 1.0 - ball_weight, f"ball_{side}": ball_weight}),
        )
    # Steel side rails make the heavier sole readable from the game camera.
    for x_direction in (-1.0, 1.0):
        add_box(
            builder,
            (center_x + x_direction * half_width * 0.94, (heel_y + toe_y) * 0.5 + 0.004, sole_bottom + 0.010),
            (0.006, depth * 0.68, 0.017),
            1,
            {f"foot_{side}": 0.72, f"ball_{side}": 0.28},
        )


def build_reinforcement(
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
    materials: list[bpy.types.Material],
) -> tuple[bpy.types.Object, dict[str, object]]:
    builder = BASE.BootMeshBuilder()
    detail_report: dict[str, object] = {}
    for side in ("l", "r"):
        foot_bounds = fit[side]["footBounds"]
        minimum = Vector(foot_bounds["minimum"])
        maximum = Vector(foot_bounds["maximum"])
        sole = fit[side]["sole"]
        center_x = (minimum.x + maximum.x) * 0.5
        half_width = float(sole["halfWidth"])
        heel_y = float(sole["heelY"])
        toe_y = float(sole["toeY"])
        sole_bottom = float(sole["bottomZ"])
        sole_top = float(sole["topZ"])
        ankle_center_y = min(maximum.y - 0.045, 0.082)
        front_y = ankle_center_y - 0.081

        add_toe_cap(builder, side, center_x, half_width * 1.01, toe_y, sole_top)
        add_shin_plate(builder, side, center_x, front_y)
        add_heel_plate(builder, side, center_x, half_width, heel_y, sole_top)
        add_reinforced_sole(builder, side, center_x, half_width, heel_y, toe_y, sole_bottom)

        side_direction = 1.0 if side == "l" else -1.0
        add_outer_ankle_plate(builder, side, center_x, half_width, ankle_center_y)
        ankle_width = max(0.058, half_width * 0.88)
        for z in (0.134, 0.194):
            BASE.add_elliptic_tube(
                builder,
                side,
                center_x,
                ankle_center_y,
                ((z, ankle_width * 1.15, 0.076), (z + 0.014, ankle_width * 1.17, 0.078)),
                3,
                14,
            )
            buckle_x = center_x + side_direction * ankle_width * 1.13
            add_box(builder, (buckle_x, ankle_center_y - 0.054, z + 0.007), (0.014, 0.010, 0.018), 1, {f"calf_{side}": 0.70, f"foot_{side}": 0.30})

        detail_report[side] = {
            "steelToe": {"frontY": round(toe_y + 0.008, 5), "rearY": round(toe_y + 0.118, 5)},
            "shinPlate": {"frontY": round(front_y, 5), "bottomZ": 0.098, "topZ": 0.238},
            "heelPlate": {"rearY": round(heel_y + 0.010, 5), "topZ": 0.132},
            "lugBottomZ": round(sole_bottom - 0.013, 5),
            "weights": [f"foot_{side}", f"ball_{side}", f"calf_{side}"],
        }

    mesh = bpy.data.meshes.new(f"{asset_id}_reinforcement_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.face_materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_reinforcement", mesh)
    bpy.context.collection.objects.link(details)
    details.parent = armature
    details.matrix_parent_inverse = Matrix.Identity(4)
    details.matrix_world = armature.matrix_world.copy()
    for material in materials:
        details.data.materials.append(material)
    group_names = sorted({name for weights in builder.weights for name, value in weights.items() if value > 0.0})
    groups = {name: details.vertex_groups.new(name=name) for name in group_names}
    for vertex_index, weights in enumerate(builder.weights):
        for name, value in normalized(weights).items():
            groups[name].add([vertex_index], value, "REPLACE")
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.84, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    details.select_set(False)
    return details, detail_report


def combine_boot_objects(
    boots: bpy.types.Object,
    details: bpy.types.Object,
    asset_id: str,
) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    boots.select_set(True)
    details.select_set(True)
    bpy.context.view_layer.objects.active = boots
    bpy.ops.object.join()
    boots.name = asset_id
    boots.data.name = f"{asset_id}_mesh"
    boots["realm_asset_id"] = asset_id
    boots["realm_item_id"] = "reinforcedBoots"
    boots["realm_item_name_ru"] = "Усиленные ботинки"
    boots["realm_art_direction"] = "character_geometry_b_materials_c"
    boots["realm_review_only"] = True
    boots["realm_runtime_integration_allowed"] = False
    boots["realm_geometry_provenance"] = "approved v21 fit with original reinforced protection geometry"
    boots.select_set(False)
    return boots


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def set_review_action(armature: bpy.types.Object, action_name: str | None, frame: float = 0.0) -> None:
    if armature.animation_data:
        for track in armature.animation_data.nla_tracks:
            track.mute = True
        armature.animation_data.action = bpy.data.actions.get(action_name) if action_name else None
    armature.data.pose_position = "POSE" if action_name else "REST"
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def evaluated_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        return (
            Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
            Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
        )
    finally:
        evaluated.to_mesh_clear()


def render_review(
    output: Path,
    camera_location: tuple[float, float, float],
    target: tuple[float, float, float],
    ortho_scale: float,
    floor_z: float,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("reinforced_boots_review_world")
    scene.world.color = (0.022, 0.025, 0.024)
    for obj in [obj for obj in list(scene.objects) if obj.name.startswith("reinforced_boots_review_")]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=6.0, location=(0.0, 0.0, floor_z))
    floor = bpy.context.object
    floor.name = "reinforced_boots_review_floor"
    floor_material = bpy.data.materials.get("reinforced_boots_review_floor_material") or bpy.data.materials.new("reinforced_boots_review_floor_material")
    floor_material.use_nodes = True
    floor_bsdf = floor_material.node_tree.nodes.get("Principled BSDF")
    floor_bsdf.inputs["Base Color"].default_value = (0.072, 0.078, 0.072, 1.0)
    floor_bsdf.inputs["Roughness"].default_value = 0.94
    floor.data.materials.append(floor_material)
    for name, location, energy, color, size in (
        ("reinforced_boots_review_key", (-2.2, -3.1, 2.6), 900, (1.0, 0.77, 0.55), 2.4),
        ("reinforced_boots_review_fill", (2.6, -1.0, 1.8), 650, (0.55, 0.72, 0.88), 2.8),
        ("reinforced_boots_review_rim", (0.0, 2.5, 2.2), 780, (0.90, 0.68, 0.46), 2.0),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, Vector(target))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "reinforced_boots_review_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.lens = 60
    look_at(camera, Vector(target))
    scene.camera = camera
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output.resolve())
    bpy.ops.render.render(write_still=True)


def parse_exported_glb(path: Path, bone_names: set[str]) -> dict[str, object]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    accessors = gltf.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position = primitive.get("attributes", {}).get("POSITION")
            if position is not None:
                vertices += accessors[position]["count"]
            indices = primitive.get("indices")
            if indices is not None:
                triangles += accessors[indices]["count"] // 3
    return {
        "meshDefinitions": len(gltf.get("meshes", [])),
        "positionVertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "skins": len(gltf.get("skins", [])),
        "bones": sum(1 for node in gltf.get("nodes", []) if node.get("name") in bone_names),
    }


def export_candidate(output: Path, armature: bpy.types.Object, boots: bpy.types.Object) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    boots.select_set(True)
    bpy.context.view_layer.objects.active = boots
    bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
    )


def main() -> None:
    args = parse_args()
    BASE.clear_scene()
    reference_objects = BASE.import_glb(args.reference_character)
    armature = next((obj for obj in reference_objects if obj.type == "ARMATURE"), None)
    body = next((obj for obj in reference_objects if obj.type == "MESH" and "body" in obj.name.lower()), None)
    if armature is None or body is None:
        raise RuntimeError("Reference character must contain the current armature and body mesh")
    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    for obj in list(reference_objects):
        if obj.type == "MESH" and obj != body:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    materials = {
        "leather": BASE.pbr_material("boots_weathered_leather", (0.235, 0.115, 0.060), 0.86, 0.0),
        "sole": BASE.pbr_material("boots_rubberized_sole", (0.085, 0.095, 0.09), 0.90, 0.0),
        "canvas": BASE.pbr_material("boots_dusty_canvas", (0.245, 0.235, 0.155), 0.94, 0.0),
        "hardware": BASE.pbr_material("boots_aged_hardware", (0.22, 0.235, 0.225), 0.64, 0.58),
        "steel": BASE.pbr_material("reinforced_boots_weathered_steel", (0.115, 0.128, 0.120), 0.66, 0.74),
        "rust": BASE.pbr_material("reinforced_boots_oxidized_repairs", (0.145, 0.045, 0.016), 0.91, 0.08),
    }
    boots, fit = BASE.build_original_body_fitted_boots(body, armature, args.asset_id)
    for name in ("leather", "sole", "canvas", "hardware"):
        boots.data.materials.append(materials[name])
    details, reinforcement = build_reinforcement(
        armature,
        args.asset_id,
        fit,
        [materials["steel"], materials["hardware"], materials["sole"], materials["leather"], materials["rust"]],
    )
    boots = combine_boot_objects(boots, details, args.asset_id)
    sole_bottom = min(float(fit[side]["sole"]["bottomZ"]) for side in ("l", "r"))

    set_review_action(armature, None)
    if args.front_render:
        render_review(args.front_render, (0.70, -2.05, 0.64), (0.0, 0.015, 0.115), 0.66, sole_bottom - 0.014)
    if args.side_render:
        render_review(args.side_render, (2.0, -0.18, 0.56), (0.0, 0.015, 0.115), 0.66, sole_bottom - 0.014)
    if args.back_render:
        render_review(args.back_render, (-0.48, 2.05, 0.60), (0.0, 0.035, 0.115), 0.66, sole_bottom - 0.014)
    if args.detail_render:
        render_review(args.detail_render, (0.48, -1.40, 0.46), (0.125, -0.025, 0.105), 0.42, sole_bottom - 0.014)
    if args.game_render:
        render_review(args.game_render, (1.55, -2.25, 2.15), (0.0, 0.02, 0.11), 0.72, sole_bottom - 0.014)
    if args.walk_render:
        set_review_action(armature, "walk", 10)
        minimum, maximum = evaluated_bounds(boots)
        center = (minimum + maximum) * 0.5
        extent = maximum - minimum
        render_review(
            args.walk_render,
            tuple(center + Vector((0.70, -2.10, 0.52))),
            tuple(center),
            max(0.72, extent.z + 0.30),
            minimum.z - 0.020,
        )
    if args.run_render:
        set_review_action(armature, "run", 6)
        minimum, maximum = evaluated_bounds(boots)
        center = (minimum + maximum) * 0.5
        extent = maximum - minimum
        render_review(
            args.run_render,
            tuple(center + Vector((0.86, -2.55, 0.62))),
            tuple(center),
            max(0.90, extent.x + 0.42, extent.z + 0.42),
            minimum.z - 0.020,
        )
    set_review_action(armature, None)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, boots)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    export_candidate(args.output, armature, boots)
    actual = parse_exported_glb(args.output, {bone.name for bone in armature.data.bones})
    report = {
        "assetId": args.asset_id,
        "itemId": "reinforcedBoots",
        "itemNameRu": "Усиленные ботинки",
        "bodyId": args.body_id,
        "file": args.output.name,
        "dimensionsMetres": {
            "width": round(boots.dimensions.x, 4),
            "depth": round(boots.dimensions.y, 4),
            "height": round(boots.dimensions.z, 4),
        },
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "reinforcement": reinforcement,
        "animationStress": {
            "walk": {"frame": 10, "rendered": bool(args.walk_render)},
            "run": {"frame": 6, "rendered": bool(args.run_render)},
            "rigCompatibility": actual["bones"] == 65 and actual["skins"] == 1,
        },
        "design": {
            "geometry": "B",
            "materialsAndWear": "C",
            "features": ["стальной подносок", "щиток голени", "защита пятки", "наружная защита лодыжки", "усиленная подошва", "ремни и пряжки"],
        },
        "provenance": {
            "license": "Realm of Ashes project asset",
            "base": "approved original equipment boots v21 fit",
            "rebuild": "original reinforced protection geometry and B+C materials on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_REINFORCED_BOOTS_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
