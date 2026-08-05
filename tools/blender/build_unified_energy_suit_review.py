"""Build the B+C energy-protection suit review asset for the current player rig.

The design is a restrained insulated technical coverall, not powered armour:
a fitted graphite weave carries segmented ceramic panels, aged conductive
channels and one compact field regulator.  Geometry is measured independently
from each of the six shipped player bodies and bound to the current 65-bone rig.
"""

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


HAZMAT_PATH = Path(__file__).with_name("build_unified_hazmat_suit_review.py")
HAZMAT_SPEC = importlib.util.spec_from_file_location("realm_hazmat_review_base", HAZMAT_PATH)
if HAZMAT_SPEC is None or HAZMAT_SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared equipment helpers from {HAZMAT_PATH}")
HAZMAT = importlib.util.module_from_spec(HAZMAT_SPEC)
HAZMAT_SPEC.loader.exec_module(HAZMAT)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_energy_suit_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def emissive_material(
    name: str,
    color: tuple[float, float, float],
    emission: tuple[float, float, float],
    strength: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.22
    bsdf.inputs["Roughness"].default_value = 0.24
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    else:
        bsdf.inputs["Emission"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    material.diffuse_color = (*color, 1.0)
    return material


def mark_energy_equipment(obj: bpy.types.Object, asset_id: str) -> None:
    obj["realm_asset_id"] = asset_id
    obj["realm_item_id"] = "energySuit"
    obj["realm_item_name_ru"] = "Энергозащитный костюм"
    obj["realm_art_direction"] = "character_geometry_b_materials_c"
    obj["realm_review_only"] = True
    obj["realm_runtime_integration_allowed"] = False


class EnergyBuilder(HAZMAT.HazmatBuilder):
    pass


def measured_arm_band(
    builder: EnergyBuilder,
    body: bpy.types.Object,
    armature: bpy.types.Object,
    side: str,
    material: int,
) -> None:
    direction = 1.0 if side == "l" else -1.0
    points = HAZMAT.BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
    minimum, maximum = HAZMAT.BASE.bounds(points)
    outer = max(abs(minimum.x), abs(maximum.x))
    inner = min(abs(minimum.x), abs(maximum.x))
    band_center_x = direction * (inner + (outer - inner) * 0.38)
    nearby = [point for point in points if abs(point.x - band_center_x) < 0.045]
    band_minimum, band_maximum = HAZMAT.BASE.bounds(nearby)
    center_yz = ((band_minimum.y + band_maximum.y) * 0.5, (band_minimum.z + band_maximum.z) * 0.5)
    radii_yz = (
        (band_maximum.y - band_minimum.y) * 0.5 + 0.015,
        (band_maximum.z - band_minimum.z) * 0.5 + 0.015,
    )
    x0, x1 = sorted((band_center_x - 0.030, band_center_x + 0.030))
    builder.ellipse_band_x(
        x0,
        x1,
        center_yz,
        radii_yz,
        material,
        {f"upperarm_{side}": 0.58, f"lowerarm_{side}": 0.42},
        16,
    )


def measured_knee_band(
    builder: EnergyBuilder,
    body: bpy.types.Object,
    armature: bpy.types.Object,
    side: str,
    material: int,
) -> None:
    direction = 1.0 if side == "l" else -1.0
    points = HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})
    knee_points = [point for point in points if 0.48 <= point.z <= 0.70]
    minimum, maximum = HAZMAT.BASE.bounds(knee_points)
    center_x = direction * abs((minimum.x + maximum.x) * 0.5)
    center_y = (minimum.y + maximum.y) * 0.5
    radii = (
        (maximum.x - minimum.x) * 0.5 + 0.014,
        (maximum.y - minimum.y) * 0.5 + 0.015,
    )
    builder.ellipse_band_z(
        (center_x, center_y),
        radii,
        0.555,
        0.585,
        material,
        {f"thigh_{side}": 0.36, f"calf_{side}": 0.64},
        18,
    )


def build_energy_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> bpy.types.Object:
    builder = EnergyBuilder()
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    torso_half_x = max(abs(torso_minimum.x), abs(torso_maximum.x))
    torso_center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    torso_radius_y = (torso_maximum.y - torso_minimum.y) * 0.5
    front_y = torso_minimum.y - 0.038
    back_y = torso_maximum.y + 0.042

    # Flexible insulated collar stays below the jaw and leaves every face and
    # hairstyle unobstructed.
    collar_z0 = torso_maximum.z - 0.028
    collar_radii = (torso_half_x * 0.52, torso_radius_y * 0.74)
    builder.ellipse_band_z(
        (0.0, torso_center_y),
        collar_radii,
        collar_z0,
        collar_z0 + 0.052,
        1,
        {"spine_03": 0.72, "neck_01": 0.28},
        20,
    )

    # Four restrained ceramic-composite panels protect the chest without a
    # single oversized plate.  Their gaps remain flexible for weapon poses.
    upper_z = min(torso_maximum.z - 0.095, 1.445)
    lower_z = max(torso_minimum.z + 0.265, 1.105)
    panel_outer = torso_half_x * 0.62
    panel_inner = max(0.030, torso_half_x * 0.16)
    for direction in (-1.0, 1.0):
        builder.prism_xz(
            [
                (direction * panel_inner, upper_z),
                (direction * panel_outer, upper_z - 0.042),
                (direction * panel_outer * 0.91, lower_z + 0.145),
                (direction * panel_inner * 1.10, lower_z + 0.120),
            ],
            front_y,
            0.020,
            4,
            {"spine_03": 0.58, "spine_02": 0.42},
        )

    # Compact regulator: a protected circular field cell with a warm aged
    # conductor ring and cool readable core.
    core_z = min(1.285, torso_maximum.z - 0.205)
    core_y = front_y - 0.035
    builder.cylinder_y((0.0, core_y, core_z), 0.055, 0.030, 2, {"spine_02": 0.68, "spine_03": 0.32}, 18)
    builder.cylinder_y((0.0, core_y - 0.019, core_z), 0.036, 0.014, 3, {"spine_02": 0.68, "spine_03": 0.32}, 18)
    builder.cylinder_y((0.0, core_y - 0.029, core_z), 0.012, 0.008, 4, {"spine_02": 0.68, "spine_03": 0.32}, 12)

    # Copper channels carry the field close to the garment.  Thin emissive
    # cores sit inside wider aged conductors instead of floating above them.
    channel_paths = [
        ((-0.028, front_y - 0.041, core_z + 0.024), (-torso_half_x * 0.46, front_y - 0.019, core_z + 0.092)),
        ((0.028, front_y - 0.041, core_z + 0.024), (torso_half_x * 0.46, front_y - 0.019, core_z + 0.092)),
        ((0.0, front_y - 0.041, core_z - 0.040), (0.0, front_y - 0.018, lower_z - 0.006)),
    ]
    for start, end in channel_paths:
        builder.tube_between(start, end, 0.0065, 2, {"spine_02": 0.62, "spine_03": 0.38}, 9)
        builder.tube_between(
            (start[0], start[1] - 0.010, start[2]),
            (end[0], end[1] - 0.010, end[2]),
            0.0024,
            3,
            {"spine_02": 0.62, "spine_03": 0.38},
            8,
        )

    # A body-measured conductive waist loop distributes the field evenly.
    waist_z = max(torso_minimum.z + 0.205, 1.005)
    waist_points = [
        point
        for point in HAZMAT.BASE.group_points(body, armature, HAZMAT.TORSO_GROUPS)
        if waist_z - 0.035 <= point.z <= waist_z + 0.040
    ]
    waist_minimum, waist_maximum = HAZMAT.BASE.bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.014,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.014,
    )
    builder.ellipse_band_z((0.0, waist_center_y), waist_radii, waist_z, waist_z + 0.024, 1, HAZMAT.BASE.torso_weights(waist_z), 24)

    # Arm and knee bands are measured per body; their low profile preserves
    # the game's running, aiming and two-handed rifle poses.
    for side in ("l", "r"):
        measured_arm_band(builder, body, armature, side, 1)
        measured_knee_band(builder, body, armature, side, 1)

    # Rear capacitor is deliberately compact: one protected field cell and
    # two vertical cooling ribs avoid the visual weight of a backpack.
    module_z = min(1.275, torso_maximum.z - 0.23)
    builder.box((0.0, back_y + 0.026, module_z), (0.160, 0.060, 0.165), 1, {"spine_02": 0.68, "spine_03": 0.32})
    builder.cylinder_y((0.0, back_y + 0.060, module_z + 0.015), 0.030, 0.038, 2, {"spine_02": 0.70, "spine_03": 0.30}, 16)
    builder.cylinder_y((0.0, back_y + 0.084, module_z + 0.015), 0.017, 0.010, 3, {"spine_02": 0.70, "spine_03": 0.30}, 14)
    for direction in (-1.0, 1.0):
        builder.box((direction * 0.052, back_y + 0.058, module_z - 0.012), (0.020, 0.024, 0.105), 5, {"spine_02": 0.76, "spine_03": 0.24})

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
    details = bpy.data.objects.new(f"{asset_id}_field_details", mesh)
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
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.85, island_margin=0.014)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in details.data.polygons:
        polygon.use_smooth = polygon.material_index in (1, 2, 3)
    details.select_set(False)
    mark_energy_equipment(details, asset_id)
    fit["detailVertices"] = len(mesh.vertices)
    fit["detailPolygons"] = len(mesh.polygons)
    fit["energyCore"] = [0.0, round(core_y, 5), round(core_z, 5)]
    fit["waistRadii"] = [round(value, 5) for value in waist_radii]
    return details


def main() -> None:
    args = parse_args()
    HAZMAT.BASE.clear_scene()
    reference_objects = HAZMAT.BASE.import_glb(args.reference_character)
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

    materials = {
        "composite": HAZMAT.textured_material("energy_suit_weathered_graphite_composite", (0.030, 0.075, 0.092), 0.68, 0.22, args.body_id, "coated_canvas", 0.11),
        "insulation": HAZMAT.textured_material("energy_suit_aged_charcoal_insulation", (0.018, 0.024, 0.027), 0.86, 0.02, args.body_id, "rubber", 0.08),
        "conductor": HAZMAT.plain_material("energy_suit_tarnished_copper_channels", (0.105, 0.040, 0.014), 0.58, 0.68),
        "field": emissive_material("energy_suit_cyan_field_glass", (0.018, 0.125, 0.165), (0.010, 0.36, 0.56), 1.65),
        "ceramic": HAZMAT.plain_material("energy_suit_chipped_blue_ceramic", (0.025, 0.075, 0.090), 0.62, 0.24),
        "repair": HAZMAT.plain_material("energy_suit_oxidized_service_patch", (0.080, 0.094, 0.080), 0.82, 0.18),
    }
    material_order = tuple(materials[name] for name in ("composite", "insulation", "conductor", "field", "ceramic", "repair"))

    shell, fit = HAZMAT.build_shell(body, armature, args.asset_id)
    liner = HAZMAT.build_inner_liner(body, armature, args.asset_id, float(fit["headBounds"]["minimum"][2]) - 0.025)
    details = build_energy_details(body, armature, args.asset_id, fit)
    for obj in (liner, shell, details):
        mark_energy_equipment(obj, args.asset_id)
        for material in material_order:
            obj.data.materials.append(material)

    helpers = HAZMAT.pose_review(armature)
    if args.front_render:
        HAZMAT.render_review(args.front_render, (2.35, -4.05, 2.08), (0.0, 0.0, 0.98), 2.16)
    if args.back_render:
        HAZMAT.render_review(args.back_render, (-2.35, 4.05, 2.05), (0.0, 0.0, 1.00), 2.16)
    if args.detail_render:
        HAZMAT.render_review(args.detail_render, (1.18, -3.05, 1.72), (0.0, -0.04, 1.24), 1.12)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    HAZMAT.reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in (liner, shell, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, liner, shell, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    HAZMAT.export_candidate(args.output, armature, [liner, shell, details])
    actual = HAZMAT.parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "energySuit",
        "itemNameRu": "Энергозащитный костюм",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "materials": [material.name for material in material_order],
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry with authored B+C field-protection details on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_ENERGY_SUIT_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
