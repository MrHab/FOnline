"""Build body-fitted B+C heavy armour for the current 65-bone player rig."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import pi
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
COMBAT_PATH = HERE / "build_unified_combat_armor_review.py"
SPEC = importlib.util.spec_from_file_location("realm_combat_review_base", COMBAT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared combat-armour helpers: {COMBAT_PATH}")
COMBAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMBAT)
BASE = COMBAT.BASE
METAL = COMBAT.METAL


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_heavy_armor_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def panel_yz(
    builder: BASE.DetailBuilder,
    points: list[tuple[float, float, float]],
    thickness: float,
    material: int,
    weights: dict[str, float],
) -> None:
    """Extrude an outer limb panel along local X."""
    left = [builder.vertex((x - thickness * 0.5, y, z), weights) for x, y, z in points]
    right = [builder.vertex((x + thickness * 0.5, y, z), weights) for x, y, z in points]
    builder.face(tuple(reversed(left)), material)
    builder.face(tuple(right), material)
    for index in range(len(points)):
        following = (index + 1) % len(points)
        builder.face((left[index], left[following], right[following], right[index]), material)


def build_heavy_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.040
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.044
    front_y = torso_minimum.y - 0.052
    back_y = torso_maximum.y + 0.050
    lower = max(1.045, float(fit["lowerHemZ"]) - 0.030)
    upper = min(1.525, float(fit["upperLimitZ"]) + 0.030)
    chest_bottom = lower + 0.110
    chest_top = upper - 0.012
    builder = BASE.DetailBuilder()

    # The heavy cuirass is a nested double plate, not a scaled combat vest.
    outer_chest = [
        (-half_width * 0.56, chest_top + 0.006),
        (-half_width * 0.88, chest_top - 0.050),
        (-half_width, chest_bottom + 0.105),
        (-half_width * 0.91, chest_bottom + 0.010),
        (-half_width * 0.54, chest_bottom - 0.036),
        (0.0, chest_bottom - 0.052),
        (half_width * 0.54, chest_bottom - 0.036),
        (half_width * 0.91, chest_bottom + 0.010),
        (half_width, chest_bottom + 0.105),
        (half_width * 0.88, chest_top - 0.050),
        (half_width * 0.56, chest_top + 0.006),
    ]
    METAL.panel_xyz(builder, [
        (x, front_y + 0.030 * (abs(x) / max(0.001, half_width)) ** 1.40, z)
        for x, z in outer_chest
    ], 0.036, 1, {"spine_02": 0.34, "spine_03": 0.66})

    inner_chest = [
        (-half_width * 0.48, chest_top - 0.032),
        (-half_width * 0.70, chest_top - 0.082),
        (-half_width * 0.72, chest_bottom + 0.080),
        (-half_width * 0.43, chest_bottom + 0.018),
        (0.0, chest_bottom - 0.012),
        (half_width * 0.43, chest_bottom + 0.018),
        (half_width * 0.72, chest_bottom + 0.080),
        (half_width * 0.70, chest_top - 0.082),
        (half_width * 0.48, chest_top - 0.032),
    ]
    METAL.panel_xyz(builder, [
        (x, front_y - 0.024 + 0.022 * (abs(x) / max(0.001, half_width)) ** 1.25, z)
        for x, z in inner_chest
    ], 0.026, 2, {"spine_02": 0.39, "spine_03": 0.61})

    # Wide rear shell and a separate serviceable spine frame.
    outer_back = [
        (-half_width * 0.58, chest_top + 0.018),
        (-half_width * 0.94, chest_top - 0.052),
        (-half_width * 0.93, chest_bottom + 0.018),
        (-half_width * 0.54, chest_bottom - 0.035),
        (0.0, chest_bottom - 0.055),
        (half_width * 0.54, chest_bottom - 0.035),
        (half_width * 0.93, chest_bottom + 0.018),
        (half_width * 0.94, chest_top - 0.052),
        (half_width * 0.58, chest_top + 0.018),
        (0.0, chest_top + 0.052),
    ]
    METAL.panel_xyz(builder, [
        (x, back_y - 0.026 * (abs(x) / max(0.001, half_width)) ** 1.35, z)
        for x, z in outer_back
    ], 0.034, 1, {"spine_02": 0.33, "spine_03": 0.67})
    for x in (-half_width * 0.22, half_width * 0.22):
        builder.box(
            (x, back_y + 0.020, (chest_bottom + chest_top) * 0.5),
            (0.034, 0.030, chest_top - chest_bottom - 0.020),
            4, {"spine_02": 0.42, "spine_03": 0.58},
        )
    for z in (chest_bottom + 0.060, chest_bottom + 0.190, chest_top - 0.030):
        builder.box((0.0, back_y + 0.026, z), (half_width * 0.58, 0.028, 0.031), 4, BASE.torso_weights(z))

    # Three deep overlapping lames shield the abdomen while keeping it flexible.
    lame_centres: list[float] = []
    for index in range(3):
        z = lower + 0.034 + index * 0.057
        lame_centres.append(z)
        width = half_width * (0.86 + index * 0.043)
        builder.prism_xz([
            (-width, z + 0.038),
            (-width * 0.92, z - 0.040),
            (0.0, z - 0.054),
            (width * 0.92, z - 0.040),
            (width, z + 0.038),
        ], front_y - 0.010 - index * 0.004, 0.028, 1 if index == 2 else 2, BASE.torso_weights(z))
    builder.ellipse_band_z(
        (0.0, center_y), (half_width * 1.03, radius_y * 1.04),
        lower - 0.025, lower + 0.052, 3,
        {"spine_01": 0.64, "spine_02": 0.36}, segments=26,
    )

    # A three-part fauld closes the exposed waist without joining both legs
    # into one rigid skirt.  Each side flap follows its own thigh in motion.
    pelvis_points = BASE.group_points(body, armature, {"pelvis"})
    pelvis_minimum, pelvis_maximum = BASE.bounds(pelvis_points)
    pelvis_front_y = pelvis_minimum.y - 0.046
    fauld_top = min(lower + 0.018, pelvis_maximum.z - 0.010)
    fauld_bottom = max(pelvis_minimum.z + 0.035, fauld_top - 0.155)
    builder.prism_xz([
        (-half_width * 0.20, fauld_top),
        (half_width * 0.20, fauld_top),
        (half_width * 0.15, fauld_bottom + 0.015),
        (0.0, fauld_bottom - 0.018),
        (-half_width * 0.15, fauld_bottom + 0.015),
    ], pelvis_front_y - 0.014, 0.030, 1, {"pelvis": 1.0})
    for side, direction in (("l", 1.0), ("r", -1.0)):
        builder.prism_xz([
            (direction * half_width * 0.18, fauld_top + 0.004),
            (direction * half_width * 0.78, fauld_top - 0.008),
            (direction * half_width * 0.67, fauld_bottom + 0.004),
            (direction * half_width * 0.30, fauld_bottom - 0.015),
        ], pelvis_front_y, 0.026, 2,
            {"pelvis": 0.42, f"thigh_{side}": 0.58})

    # High rear-and-side collar protects the neck but leaves the face clear.
    builder.ellipse_arc_band_z(
        (0.0, center_y + 0.010), (half_width * 0.67, radius_y * 0.97),
        chest_top - 0.018, chest_top + 0.105, 0.10, pi - 0.10,
        1, {"spine_03": 0.78, "neck_01": 0.22}, segments=18,
    )
    for direction in (-1.0, 1.0):
        side = "l" if direction > 0 else "r"
        x_inner = direction * half_width * 0.40
        x_outer = direction * half_width * 0.66
        builder.prism_xz([
            (x_inner, chest_top + 0.040),
            (x_outer, chest_top + 0.020),
            (x_outer, chest_top - 0.018),
            (x_inner, chest_top - 0.006),
        ], front_y + 0.012, 0.020, 2,
            {"spine_03": 0.58, f"clavicle_{side}": 0.42})

    arm_guards: list[tuple[str, str, tuple[float, float, float]]] = []
    for side in ("l", "r"):
        direction = 1.0 if side == "l" else -1.0
        shoulder = METAL.measured_arm_band(
            builder, body, armature, side, "upperarm", 0.22, 0.135, 0.035, 1,
            {f"clavicle_{side}": 0.30, f"upperarm_{side}": 0.70},
        )
        arm_guards.append((side, "shoulder", shoulder))
        forearm = METAL.measured_arm_band(
            builder, body, armature, side, "lowerarm", 0.48, 0.165, 0.024, 2,
            {f"lowerarm_{side}": 1.0},
        )
        arm_guards.append((side, "forearm", forearm))
        # Stepped pauldron cap makes the silhouette heavy without occupying the armpit.
        builder.box(
            (shoulder[0], shoulder[1] - 0.004, shoulder[2] + 0.066),
            (0.158, 0.158, 0.044), 1,
            {f"clavicle_{side}": 0.27, f"upperarm_{side}": 0.73},
        )
        builder.box(
            (shoulder[0] + direction * 0.020, shoulder[1] - 0.012, shoulder[2] + 0.092),
            (0.115, 0.122, 0.024), 2,
            {f"clavicle_{side}": 0.20, f"upperarm_{side}": 0.80},
        )
        for offset in (-0.042, 0.042):
            builder.octahedron(
                (shoulder[0] + direction * offset, shoulder[1] - 0.090, shoulder[2] + 0.057),
                0.010, 4, {f"upperarm_{side}": 1.0},
            )

    # Open outer-thigh guards: no rigid ring between the legs.
    thigh_guards: list[dict[str, float | str]] = []
    for side in ("l", "r"):
        points = BASE.group_points(body, armature, {f"thigh_{side}"})
        minimum, maximum = BASE.bounds(points)
        direction = 1.0 if side == "l" else -1.0
        outer_x = maximum.x if side == "l" else minimum.x
        height = min(0.245, (maximum.z - minimum.z) * 0.48)
        center_z = maximum.z - (maximum.z - minimum.z) * 0.48
        sample = [point for point in points if abs(point.z - center_z) <= height * 0.55]
        sample_minimum, sample_maximum = BASE.bounds(sample or points)
        center_y_leg = (sample_minimum.y + sample_maximum.y) * 0.5
        radius_y_leg = (sample_maximum.y - sample_minimum.y) * 0.5 + 0.025
        plate_x = outer_x + direction * 0.030
        panel_yz(builder, [
            (plate_x, center_y_leg - radius_y_leg * 0.80, center_z + height * 0.48),
            (plate_x, center_y_leg - radius_y_leg, center_z - height * 0.25),
            (plate_x, center_y_leg - radius_y_leg * 0.45, center_z - height * 0.52),
            (plate_x, center_y_leg + radius_y_leg * 0.62, center_z - height * 0.43),
            (plate_x, center_y_leg + radius_y_leg * 0.83, center_z + height * 0.33),
            (plate_x, center_y_leg + radius_y_leg * 0.30, center_z + height * 0.53),
        ], 0.030, 1, {f"thigh_{side}": 1.0})
        panel_yz(builder, [
            (plate_x + direction * 0.020, center_y_leg - radius_y_leg * 0.54, center_z + height * 0.28),
            (plate_x + direction * 0.020, center_y_leg - radius_y_leg * 0.65, center_z - height * 0.17),
            (plate_x + direction * 0.020, center_y_leg + radius_y_leg * 0.34, center_z - height * 0.30),
            (plate_x + direction * 0.020, center_y_leg + radius_y_leg * 0.48, center_z + height * 0.20),
        ], 0.018, 2, {f"thigh_{side}": 1.0})
        # Two narrow straps wrap the leg; the armour itself stays only outside.
        strap_radii = (
            (sample_maximum.x - sample_minimum.x) * 0.5 + 0.010,
            radius_y_leg - 0.010,
        )
        center_xy = (
            (sample_minimum.x + sample_maximum.x) * 0.5,
            center_y_leg,
        )
        for strap_z in (center_z - height * 0.33, center_z + height * 0.33):
            builder.ellipse_band_z(
                center_xy, strap_radii, strap_z - 0.010, strap_z + 0.010,
                3, {f"thigh_{side}": 1.0}, segments=18,
            )
        thigh_guards.append({"side": side, "centerZ": round(center_z, 5), "height": round(height, 5)})

    # Large readable hardware, hazard stripe and one field-repair plate.
    builder.box(
        (0.0, front_y - 0.043, (chest_bottom + chest_top) * 0.5),
        (0.038, 0.024, chest_top - chest_bottom - 0.020), 4,
        {"spine_02": 0.38, "spine_03": 0.62},
    )
    builder.box((0.0, front_y - 0.051, lower + 0.012), (0.088, 0.042, 0.064), 4, {"spine_01": 0.70, "spine_02": 0.30})
    hazard_z = chest_bottom + 0.095
    for index in range(3):
        builder.box(
            (-half_width * 0.52 + index * half_width * 0.17, front_y - 0.045, hazard_z + index * 0.004),
            (half_width * 0.12, 0.014, 0.023), 5, {"spine_02": 0.78, "spine_03": 0.22},
        )
    repair = [
        (half_width * 0.26, chest_bottom + 0.185),
        (half_width * 0.72, chest_bottom + 0.170),
        (half_width * 0.68, chest_bottom + 0.270),
        (half_width * 0.30, chest_bottom + 0.258),
    ]
    builder.prism_xz(repair, front_y - 0.044, 0.012, 5, {"spine_02": 0.45, "spine_03": 0.55})

    mesh = bpy.data.meshes.new(f"{asset_id}_heavy_plates_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_layered_heavy_plates", mesh)
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
    bevel = details.modifiers.new("heavy_manufactured_edge_softening", "BEVEL")
    bevel.width = 0.0045
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
    details["realm_item_id"] = "heavyArmor"
    details["realm_equipment_slot"] = "armor"
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details, {
        "outerChestPoints": len(outer_chest),
        "innerChestPoints": len(inner_chest),
        "outerBackPoints": len(outer_back),
        "abdominalLames": len(lame_centres),
        "fauldPanels": 3,
        "spineRails": 2,
        "armGuards": len(arm_guards),
        "thighGuards": thigh_guards,
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
        BASE.pbr_material("heavy_armor_black_padded_underlayer", (0.036, 0.041, 0.039), 0.93, 0.0, f"{args.body_id}:underlayer", 0.09),
        BASE.pbr_material("heavy_armor_worn_gunmetal", (0.145, 0.160, 0.153), 0.55, 0.68, f"{args.body_id}:gunmetal", 0.13),
        BASE.pbr_material("heavy_armor_olive_composite_inserts", (0.090, 0.115, 0.080), 0.72, 0.10, f"{args.body_id}:composite", 0.12),
        BASE.pbr_material("heavy_armor_aged_webbing", (0.080, 0.054, 0.032), 0.91, 0.0, f"{args.body_id}:webbing", 0.11),
        BASE.pbr_material("heavy_armor_oxidised_hardware", (0.185, 0.095, 0.040), 0.70, 0.48, f"{args.body_id}:hardware", 0.12),
        BASE.pbr_material("heavy_armor_faded_hazard_repair", (0.285, 0.190, 0.055), 0.82, 0.08, f"{args.body_id}:hazard", 0.11),
    )
    underlayer, fit = BASE.build_shell(body, armature, args.asset_id)
    underlayer.name = f"{args.asset_id}_black_padded_underlayer"
    underlayer["realm_item_id"] = "heavyArmor"
    underlayer["realm_equipment_slot"] = "armor"
    details, detail_report = build_heavy_details(body, armature, args.asset_id, fit)
    for obj in (underlayer, details):
        for material in materials:
            obj.data.materials.append(material)

    helpers = BASE.pose_review(armature)
    if args.front_render:
        BASE.render_review(armature, args.front_render, (2.45, -4.25, 2.12), (0.0, 0.0, 1.05), 2.15)
    if args.back_render:
        BASE.render_review(armature, args.back_render, (-2.55, 4.15, 2.18), (0.0, 0.0, 1.07), 2.15)
    if args.detail_render:
        BASE.render_review(armature, args.detail_render, (1.38, -3.25, 1.82), (0.0, -0.02, 1.23), 1.38)
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
        "itemId": "heavyArmor",
        "slot": "armor",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "details": detail_report,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry with authored B+C double cuirass, open limb protection and serviceable rear frame on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_HEAVY_ARMOR_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
