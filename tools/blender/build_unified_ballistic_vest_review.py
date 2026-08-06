"""Build a body-fitted B+C ballistic vest for the current player rig."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
BASE_PATH = HERE / "build_unified_leather_jacket_review.py"
SPEC = importlib.util.spec_from_file_location("realm_leather_review_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared equipment helpers: {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_ballistic_vest_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def build_carrier_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_points = BASE.group_points(body, armature, BASE.TORSO_GROUPS)
    torso_minimum, torso_maximum = BASE.bounds(torso_points)
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    lower = max(1.030, torso_minimum.z + 0.180)
    upper = min(1.495, torso_maximum.z - 0.070)
    old_to_new: dict[int, int] = {}
    position_to_new: dict[tuple[int, int, int], int] = {}
    source_indices: list[int] = []
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        dominant = [BASE.dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        torso_votes = sum(group in BASE.TORSO_GROUPS for group in dominant)
        if torso_votes < max(1, len(dominant) // 2) or not lower <= center.z <= upper:
            continue
        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in old_to_new:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                normal = (normal_transform @ source_vertex.normal).normalized()
                position = base_position + normal * 0.026
                key = tuple(round(value * 100000.0) for value in base_position)
                existing = position_to_new.get(key)
                if existing is None:
                    existing = len(vertices)
                    position_to_new[key] = existing
                    source_indices.append(source_index)
                    vertices.append(tuple(position))
                old_to_new[source_index] = existing
            face.append(old_to_new[source_index])
        faces.append(tuple(face))

    mesh = bpy.data.meshes.new(f"{asset_id}_carrier_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    carrier = bpy.data.objects.new(f"{asset_id}_soft_carrier", mesh)
    bpy.context.collection.objects.link(carrier)
    carrier.parent = armature
    carrier.matrix_parent_inverse = Matrix.Identity(4)
    carrier.matrix_world = armature.matrix_world.copy()

    source_to_new = {source_index: new_index for new_index, source_index in enumerate(source_indices)}
    required_groups = sorted({
        body.vertex_groups[assignment.group].name
        for source_index in source_indices
        for assignment in body.data.vertices[source_index].groups
        if assignment.weight > 0.0
    })
    vertex_groups = {name: carrier.vertex_groups.new(name=name) for name in required_groups}
    for source_index, new_index in source_to_new.items():
        for assignment in body.data.vertices[source_index].groups:
            name = body.vertex_groups[assignment.group].name
            if assignment.weight > 0.0:
                vertex_groups[name].add([new_index], assignment.weight, "REPLACE")

    bpy.context.view_layer.objects.active = carrier
    carrier.select_set(True)
    smooth = carrier.modifiers.new("carrier_padding", "LAPLACIANSMOOTH")
    smooth.iterations = 4
    smooth.lambda_factor = 0.08
    smooth.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    solidify = carrier.modifiers.new("stitched_carrier_thickness", "SOLIDIFY")
    solidify.thickness = 0.007
    solidify.offset = -0.10
    solidify.use_rim = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    armature_modifier = carrier.modifiers.new("current_player_rig", "ARMATURE")
    armature_modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in carrier.data.polygons:
        polygon.use_smooth = True
    carrier.select_set(False)
    carrier["realm_asset_id"] = asset_id
    carrier["realm_item_id"] = "ballisticVest"
    carrier["realm_equipment_slot"] = "armor"
    carrier["realm_art_direction"] = "character_geometry_b_materials_c"
    carrier["realm_review_only"] = True
    carrier["realm_runtime_integration_allowed"] = False
    return carrier, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "shellVertices": len(mesh.vertices),
        "shellPolygons": len(mesh.polygons),
        "lowerHemZ": round(lower, 5),
        "upperLimitZ": round(upper, 5),
    }


def panel_xyz(
    builder: BASE.DetailBuilder,
    points: list[tuple[float, float, float]],
    thickness: float,
    material: int,
    weights: dict[str, float],
) -> None:
    front = [builder.vertex((x, y - thickness * 0.5, z), weights) for x, y, z in points]
    back = [builder.vertex((x, y + thickness * 0.5, z), weights) for x, y, z in points]
    builder.face(tuple(reversed(front)), material)
    builder.face(tuple(back), material)
    for index in range(len(points)):
        following = (index + 1) % len(points)
        builder.face((front[index], front[following], back[following], back[index]), material)


def build_vest_details(
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.020
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.035
    front_y = torso_minimum.y - 0.050
    back_y = torso_maximum.y + 0.046
    # Extend the clean cummerbund edge below the sampled carrier boundary so
    # the low-poly source body's staggered polygon hem never reads as fringe.
    lower = float(fit["lowerHemZ"]) - 0.025
    upper = float(fit["upperLimitZ"]) - 0.005
    plate_bottom = lower + 0.035
    plate_top = upper - 0.020
    builder = BASE.DetailBuilder()

    # Front and rear ballistic inserts follow the torso curve, with clipped
    # upper corners so the vest remains visibly lighter than metal armour.
    front_outline = [
        (-half_width * 0.52, plate_top),
        (-half_width * 0.82, plate_top - 0.070),
        (-half_width * 0.86, plate_bottom + 0.045),
        (-half_width * 0.67, plate_bottom),
        (half_width * 0.67, plate_bottom),
        (half_width * 0.86, plate_bottom + 0.045),
        (half_width * 0.82, plate_top - 0.070),
        (half_width * 0.52, plate_top),
    ]
    curved_front = [
        (x, front_y + 0.020 * (abs(x) / max(0.001, half_width)) ** 1.35, z)
        for x, z in front_outline
    ]
    panel_xyz(builder, curved_front, 0.019, 1, {"spine_02": 0.38, "spine_03": 0.62})

    back_outline = [
        (-half_width * 0.58, plate_top + 0.015),
        (-half_width * 0.84, plate_top - 0.055),
        (-half_width * 0.82, plate_bottom + 0.025),
        (-half_width * 0.64, plate_bottom - 0.010),
        (half_width * 0.64, plate_bottom - 0.010),
        (half_width * 0.82, plate_bottom + 0.025),
        (half_width * 0.84, plate_top - 0.055),
        (half_width * 0.58, plate_top + 0.015),
    ]
    curved_back = [
        (x, back_y - 0.017 * (abs(x) / max(0.001, half_width)) ** 1.30, z)
        for x, z in back_outline
    ]
    panel_xyz(builder, curved_back, 0.017, 1, {"spine_02": 0.34, "spine_03": 0.66})

    # Cummerbund and broad shoulder adjustments visibly connect the carrier.
    builder.ellipse_band_z(
        (0.0, center_y),
        (half_width * 1.01, radius_y * 1.04),
        lower,
        lower + 0.092,
        2,
        {"spine_01": 0.35, "spine_02": 0.65},
        segments=24,
    )
    shoulder_x = half_width * 0.54
    shoulder_depth = radius_y * 2.0 + 0.075
    for side in (-1.0, 1.0):
        weights = {"spine_03": 0.72, "clavicle_l" if side < 0 else "clavicle_r": 0.28}
        builder.box((side * shoulder_x, center_y, upper - 0.012), (0.070, shoulder_depth, 0.032), 2, weights)
        builder.box((side * shoulder_x, front_y - 0.030, upper - 0.050), (0.052, 0.022, 0.062), 3, weights)

    # Three practical magazine pouches and separate top flaps.
    pouch_count = 3
    pouch_width = half_width * 0.47
    pouch_z = lower + 0.105
    for index, x in enumerate((-pouch_width, 0.0, pouch_width)):
        builder.box((x, front_y - 0.060, pouch_z), (pouch_width * 0.82, 0.082, 0.118), 0, {"spine_02": 1.0})
        builder.box((x, front_y - 0.104, pouch_z + 0.048), (pouch_width * 0.86, 0.018, 0.034), 4, {"spine_02": 1.0})
        builder.box((x, front_y - 0.116, pouch_z + 0.047), (0.018, 0.012, 0.048), 3, {"spine_02": 1.0})

    # MOLLE rows, central release buckle and a rear drag handle survive the
    # isometric view without turning into high-frequency surface noise.
    molle_rows = 3
    for z in (plate_bottom + 0.130, plate_bottom + 0.185, plate_bottom + 0.240):
        builder.box((0.0, front_y - 0.021, z), (half_width * 1.22, 0.014, 0.018), 2, BASE.torso_weights(z))
    builder.box((0.0, front_y - 0.034, plate_top - 0.105), (0.054, 0.026, 0.064), 3, {"spine_03": 1.0})
    for z in (plate_bottom + 0.145, plate_bottom + 0.220):
        builder.box((0.0, back_y + 0.020, z), (half_width * 1.18, 0.014, 0.020), 2, BASE.torso_weights(z))
    handle_z = plate_top + 0.050
    builder.box((0.0, back_y + 0.036, handle_z), (0.128, 0.024, 0.026), 2, {"spine_03": 1.0})
    builder.box((-0.056, back_y + 0.030, handle_z - 0.032), (0.022, 0.020, 0.072), 2, {"spine_03": 1.0})
    builder.box((0.056, back_y + 0.030, handle_z - 0.032), (0.022, 0.020, 0.072), 2, {"spine_03": 1.0})

    # One large field repair breaks the otherwise manufactured symmetry.
    repair = [
        (-half_width * 0.70, plate_bottom + 0.205),
        (-half_width * 0.36, plate_bottom + 0.198),
        (-half_width * 0.39, plate_bottom + 0.260),
        (-half_width * 0.73, plate_bottom + 0.252),
    ]
    builder.prism_xz(repair, front_y - 0.018, 0.008, 4, {"spine_03": 0.62, "spine_02": 0.38})

    mesh = bpy.data.meshes.new(f"{asset_id}_details_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_plates_webbing_pouches", mesh)
    bpy.context.collection.objects.link(details)
    details.parent = armature
    details.matrix_parent_inverse = Matrix.Identity(4)
    details.matrix_world = armature.matrix_world.copy()
    group_names = sorted({name for weights in builder.weights for name, weight in weights.items() if weight > 0.0})
    vertex_groups = {name: details.vertex_groups.new(name=name) for name in group_names}
    for vertex_index, weights in enumerate(builder.weights):
        total = sum(weights.values())
        for name, weight in weights.items():
            if total > 0.0 and weight > 0.0:
                vertex_groups[name].add([vertex_index], weight / total, "REPLACE")
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bevel = details.modifiers.new("softened_carrier_hardware", "BEVEL")
    bevel.width = 0.0035
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.82, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_item_id"] = "ballisticVest"
    details["realm_equipment_slot"] = "armor"
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details, {
        "frontPlateOutlinePoints": len(front_outline),
        "backPlateOutlinePoints": len(back_outline),
        "pouchCount": pouch_count,
        "molleRows": molle_rows,
        "shoulderAdjusters": 2,
        "dragHandle": True,
        "halfWidth": round(half_width, 5),
        "frontY": round(front_y, 5),
        "backY": round(back_y, 5),
    }


def main() -> None:
    args = parse_args()
    BASE.clear_scene()
    reference_objects = BASE.import_glb(args.reference_character)
    armature = next((obj for obj in reference_objects if obj.type == "ARMATURE"), None)
    body = next((obj for obj in reference_objects if obj.type == "MESH" and "body" in obj.name.lower()), None)
    if armature is None or body is None:
        raise RuntimeError("Reference character must contain the current armature and body mesh")
    armature.data.pose_position = "REST"
    if armature.animation_data:
        armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()

    materials = (
        BASE.pbr_material("ballistic_vest_faded_olive_carrier", (0.095, 0.112, 0.078), 0.91, 0.0, f"{args.body_id}:carrier", 0.09),
        BASE.pbr_material("ballistic_vest_charcoal_insert", (0.050, 0.056, 0.052), 0.70, 0.08, f"{args.body_id}:insert", 0.08),
        BASE.pbr_material("ballistic_vest_dusty_webbing", (0.170, 0.155, 0.105), 0.94, 0.0, f"{args.body_id}:webbing", 0.10),
        BASE.pbr_material("ballistic_vest_oxidised_hardware", (0.165, 0.125, 0.075), 0.66, 0.56, f"{args.body_id}:hardware", 0.08),
        BASE.pbr_material("ballistic_vest_faded_repair_cloth", (0.235, 0.095, 0.045), 0.93, 0.0, f"{args.body_id}:repair", 0.11),
    )
    carrier, fit = build_carrier_shell(body, armature, args.asset_id)
    details, detail_report = build_vest_details(armature, args.asset_id, fit)
    for obj in (carrier, details):
        for material in materials:
            obj.data.materials.append(material)

    helpers = BASE.pose_review(armature)
    if args.front_render:
        BASE.render_review(armature, args.front_render, (2.35, -4.1, 2.05), (0.0, 0.0, 1.04), 2.05)
    if args.back_render:
        BASE.render_review(armature, args.back_render, (-2.45, 4.0, 2.12), (0.0, 0.0, 1.06), 2.05)
    if args.detail_render:
        BASE.render_review(armature, args.detail_render, (1.32, -3.15, 1.78), (0.0, -0.02, 1.28), 1.18)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    BASE.reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in (carrier, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, carrier, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    BASE.export_candidate(args.output, armature, [carrier, details])
    actual = BASE.parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "ballisticVest",
        "slot": "armor",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "details": detail_report,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry with authored B+C plate carrier, webbing and pouches on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_BALLISTIC_VEST_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
