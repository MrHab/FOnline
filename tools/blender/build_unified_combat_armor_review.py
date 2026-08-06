"""Build manufactured B+C combat armour for the current player rig."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import cos, pi, sin
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
BASE_PATH = HERE / "build_unified_metal_armor_review.py"
SPEC = importlib.util.spec_from_file_location("realm_metal_review_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared armour helpers: {BASE_PATH}")
METAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(METAL)
BASE = METAL.BASE


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_combat_armor_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def measured_leg_guard(
    builder: BASE.DetailBuilder,
    body: bpy.types.Object,
    armature: bpy.types.Object,
    side: str,
    progression: float,
    height: float,
    clearance: float,
    material: int,
) -> tuple[float, float, float]:
    points = BASE.group_points(body, armature, {f"thigh_{side}"})
    minimum, maximum = BASE.bounds(points)
    center_z = maximum.z - (maximum.z - minimum.z) * progression
    sample = [point for point in points if abs(point.z - center_z) <= height * 0.65]
    sample_minimum, sample_maximum = BASE.bounds(sample or points)
    center_xy = (
        (sample_minimum.x + sample_maximum.x) * 0.5,
        (sample_minimum.y + sample_maximum.y) * 0.5,
    )
    radii = (
        (sample_maximum.x - sample_minimum.x) * 0.5 + clearance,
        (sample_maximum.y - sample_minimum.y) * 0.5 + clearance,
    )
    z0 = center_z - height * 0.5
    z1 = center_z + height * 0.5
    strap_radii = (max(0.010, radii[0] - 0.008), max(0.010, radii[1] - 0.008))
    for strap_z in (center_z - height * 0.30, center_z + height * 0.30):
        builder.ellipse_band_z(
            center_xy, strap_radii, strap_z - 0.011, strap_z + 0.011,
            2, {f"thigh_{side}": 1.0}, segments=16,
        )
    if side == "l":
        start_angle, end_angle = -pi * 0.58, pi * 0.12
    else:
        start_angle, end_angle = pi * 0.88, pi * 1.58
    segments = 10
    weights = {f"thigh_{side}": 1.0}
    inner_radii = (max(0.010, radii[0] - 0.012), max(0.010, radii[1] - 0.012))
    rings: list[list[int]] = []
    for current_radii in (radii, inner_radii):
        for z in (z0, z1):
            ring = []
            for index in range(segments + 1):
                progress = index / segments
                angle = start_angle + (end_angle - start_angle) * progress
                ring.append(builder.vertex((
                    center_xy[0] + cos(angle) * current_radii[0],
                    center_xy[1] + sin(angle) * current_radii[1],
                    z,
                ), weights))
            rings.append(ring)
    outer_lower, outer_upper, inner_lower, inner_upper = rings
    for index in range(segments):
        following = index + 1
        builder.face((outer_lower[index], outer_lower[following], outer_upper[following], outer_upper[index]), material)
        builder.face((inner_lower[following], inner_lower[index], inner_upper[index], inner_upper[following]), material)
        builder.face((outer_upper[index], outer_upper[following], inner_upper[following], inner_upper[index]), material)
        builder.face((outer_lower[following], outer_lower[index], inner_lower[index], inner_lower[following]), material)
    builder.face((outer_lower[0], outer_upper[0], inner_upper[0], inner_lower[0]), material)
    builder.face((outer_lower[-1], inner_lower[-1], inner_upper[-1], outer_upper[-1]), material)
    return center_xy[0], center_xy[1], center_z


def build_combat_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.027
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.036
    front_y = torso_minimum.y - 0.045
    back_y = torso_maximum.y + 0.040
    lower = max(1.050, float(fit["lowerHemZ"]) - 0.020)
    upper = min(1.515, float(fit["upperLimitZ"]) + 0.020)
    chest_bottom = lower + 0.100
    chest_top = upper - 0.010
    builder = BASE.DetailBuilder()

    chest_outline = [
        (-half_width * 0.58, chest_top),
        (-half_width * 0.91, chest_top - 0.075),
        (-half_width * 0.95, chest_bottom + 0.080),
        (-half_width * 0.72, chest_bottom),
        (0.0, chest_bottom - 0.025),
        (half_width * 0.72, chest_bottom),
        (half_width * 0.95, chest_bottom + 0.080),
        (half_width * 0.91, chest_top - 0.075),
        (half_width * 0.58, chest_top),
    ]
    METAL.panel_xyz(builder, [
        (x, front_y + 0.022 * (abs(x) / max(0.001, half_width)) ** 1.35, z)
        for x, z in chest_outline
    ], 0.024, 1, {"spine_02": 0.36, "spine_03": 0.64})

    back_outline = [
        (-half_width * 0.62, chest_top + 0.010),
        (-half_width * 0.94, chest_top - 0.075),
        (-half_width * 0.87, chest_bottom + 0.015),
        (0.0, chest_bottom - 0.030),
        (half_width * 0.87, chest_bottom + 0.015),
        (half_width * 0.94, chest_top - 0.075),
        (half_width * 0.62, chest_top + 0.010),
        (0.0, chest_top + 0.035),
    ]
    METAL.panel_xyz(builder, [
        (x, back_y - 0.018 * (abs(x) / max(0.001, half_width)) ** 1.30, z)
        for x, z in back_outline
    ], 0.022, 1, {"spine_02": 0.32, "spine_03": 0.68})

    # Two flexible abdomen panels and the manufactured waist closure.
    for index in range(2):
        z = lower + 0.035 + index * 0.060
        width = half_width * (0.80 + index * 0.055)
        builder.prism_xz([
            (-width, z + 0.034), (-width * 0.92, z - 0.034),
            (0.0, z - 0.045), (width * 0.92, z - 0.034), (width, z + 0.034),
        ], front_y - 0.004, 0.019, 3, BASE.torso_weights(z))
    builder.ellipse_band_z(
        (0.0, center_y), (half_width * 1.00, radius_y * 1.03),
        lower - 0.020, lower + 0.050, 4,
        {"spine_01": 0.62, "spine_02": 0.38}, segments=24,
    )

    arm_guards = []
    for side in ("l", "r"):
        shoulder = METAL.measured_arm_band(
            builder, body, armature, side, "upperarm", 0.21, 0.115, 0.026, 1,
            {f"clavicle_{side}": 0.30, f"upperarm_{side}": 0.70},
        )
        arm_guards.append((side, "shoulder", shoulder))
        forearm = METAL.measured_arm_band(
            builder, body, armature, side, "lowerarm", 0.50, 0.145, 0.018, 3,
            {f"lowerarm_{side}": 1.0},
        )
        arm_guards.append((side, "forearm", forearm))
        builder.box(
            (shoulder[0], shoulder[1] - 0.006, shoulder[2] + 0.058),
            (0.142, 0.145, 0.038), 1,
            {f"clavicle_{side}": 0.24, f"upperarm_{side}": 0.76},
        )

    thigh_guards = [
        (side, measured_leg_guard(builder, body, armature, side, 0.48, 0.190, 0.020, 1))
        for side in ("l", "r")
    ]

    # Readable manufactured details: sternum shock strip, collar, belt
    # buckle, rear service panel and asymmetric repair plate.
    builder.box((0.0, front_y - 0.020, (chest_bottom + chest_top) * 0.5), (0.032, 0.018, chest_top - chest_bottom - 0.025), 2, {"spine_02": 0.38, "spine_03": 0.62})
    builder.ellipse_arc_band_z(
        (0.0, center_y + 0.004), (half_width * 0.58, radius_y * 0.90),
        chest_top - 0.010, chest_top + 0.060, 0.18, pi - 0.18,
        3, {"spine_03": 0.82, "neck_01": 0.18}, segments=14,
    )
    builder.box((0.0, front_y - 0.040, lower + 0.012), (0.070, 0.032, 0.060), 2, {"spine_01": 0.72, "spine_02": 0.28})
    builder.box((0.0, back_y + 0.025, chest_bottom + 0.115), (half_width * 0.92, 0.020, 0.105), 3, {"spine_02": 0.72, "spine_03": 0.28})
    repair = [
        (half_width * 0.28, chest_bottom + 0.165),
        (half_width * 0.72, chest_bottom + 0.155),
        (half_width * 0.68, chest_bottom + 0.245),
        (half_width * 0.31, chest_bottom + 0.235),
    ]
    builder.prism_xz(repair, front_y - 0.021, 0.009, 4, {"spine_02": 0.44, "spine_03": 0.56})

    mesh = bpy.data.meshes.new(f"{asset_id}_hardpoints_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_composite_plates_guards", mesh)
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
    bevel = details.modifiers.new("manufactured_edge_softening", "BEVEL")
    bevel.width = 0.004
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
    details["realm_item_id"] = "combatArmor"
    details["realm_equipment_slot"] = "armor"
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details, {
        "chestOutlinePoints": len(chest_outline),
        "backOutlinePoints": len(back_outline),
        "abdominalPanels": 2,
        "armGuards": len(arm_guards),
        "thighGuards": len(thigh_guards),
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
        BASE.pbr_material("combat_armor_graphite_underlayer", (0.045, 0.054, 0.050), 0.91, 0.0, f"{args.body_id}:underlayer", 0.08),
        BASE.pbr_material("combat_armor_chipped_olive_composite", (0.105, 0.135, 0.095), 0.67, 0.12, f"{args.body_id}:composite", 0.11),
        BASE.pbr_material("combat_armor_black_shock_strip", (0.025, 0.030, 0.028), 0.78, 0.0, f"{args.body_id}:shock", 0.09),
        BASE.pbr_material("combat_armor_tarnished_alloy", (0.165, 0.175, 0.155), 0.60, 0.55, f"{args.body_id}:alloy", 0.08),
        BASE.pbr_material("combat_armor_faded_tan_repair", (0.220, 0.145, 0.070), 0.89, 0.0, f"{args.body_id}:repair", 0.10),
    )
    underlayer, fit = BASE.build_shell(body, armature, args.asset_id)
    underlayer.name = f"{args.asset_id}_graphite_underlayer"
    underlayer["realm_item_id"] = "combatArmor"
    underlayer["realm_equipment_slot"] = "armor"
    details, detail_report = build_combat_details(body, armature, args.asset_id, fit)
    for obj in (underlayer, details):
        for material in materials:
            obj.data.materials.append(material)

    helpers = BASE.pose_review(armature)
    if args.front_render:
        BASE.render_review(armature, args.front_render, (2.35, -4.1, 2.05), (0.0, 0.0, 1.04), 2.05)
    if args.back_render:
        BASE.render_review(armature, args.back_render, (-2.45, 4.0, 2.12), (0.0, 0.0, 1.06), 2.05)
    if args.detail_render:
        BASE.render_review(armature, args.detail_render, (1.32, -3.15, 1.78), (0.0, -0.02, 1.22), 1.30)
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    BASE.reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in (underlayer, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, underlayer, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    BASE.export_candidate(args.output, armature, [underlayer, details])
    actual = BASE.parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "combatArmor",
        "slot": "armor",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "details": detail_report,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry with authored B+C manufactured composite plates and limb guards on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_COMBAT_ARMOR_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
