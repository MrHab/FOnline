"""Build the male-medium leather-armor blockout for artistic approval.

This is deliberately not a production asset.  It establishes only the large
forms of a two-piece survivor kit: a hip-length leather jacket and high-waisted
reinforced leather trousers.  Materials are flat review colours, small hardware
is omitted, and runtime integration remains locked until the silhouette is
approved from every required camera.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import atan2, cos, pi, sin
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HAZMAT_PATH = Path(__file__).with_name("build_unified_hazmat_suit_review.py")
HAZMAT_SPEC = importlib.util.spec_from_file_location("realm_leather_armor_blockout_base", HAZMAT_PATH)
if HAZMAT_SPEC is None or HAZMAT_SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared garment helpers from {HAZMAT_PATH}")
HAZMAT = importlib.util.module_from_spec(HAZMAT_SPEC)
HAZMAT_SPEC.loader.exec_module(HAZMAT)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_leather_armor_blockout_v1")
    parser.add_argument("--body-id", default="male_medium")
    for name in ("front", "back", "left", "right", "three-quarter", "isometric", "game-camera", "wireframe", "native"):
        parser.add_argument(f"--{name}-render", type=Path, required=True)
    return parser.parse_args(argv)


def flat_material(name: str, color: tuple[float, float, float], roughness: float = 0.88) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    material.diffuse_color = (*color, 1.0)
    return material


def fitted_section_position(
    position: Vector,
    group: str | None,
    torso_points: list[Vector],
    arm_points: dict[str, list[Vector]],
    leg_points: dict[str, list[Vector]],
    garment: str,
) -> Vector:
    """Quiet donor anatomy without turning the garment into a rigid cylinder."""
    if group in HAZMAT.TORSO_GROUPS or (group and group.startswith("clavicle_")):
        minimum, maximum = section_bounds(torso_points, 2, position.z, 0.042)
        center_y = (minimum.y + maximum.y) * 0.5
        source_rx = max(0.08, max(abs(minimum.x), abs(maximum.x)))
        source_ry = max(0.055, (maximum.y - minimum.y) * 0.5)
        angle = atan2(
            (position.y - center_y) / source_ry,
            position.x / source_rx,
        )
        clearance = 0.014 if garment == "jacket" else 0.012
        target = Vector((
            cos(angle) * (source_rx + clearance),
            center_y + sin(angle) * (source_ry + clearance),
            position.z,
        ))
        return position.lerp(target, 0.24)

    if group and group.startswith(("upperarm_", "lowerarm_")):
        side = group.rsplit("_", 1)[-1]
        minimum, maximum = section_bounds(arm_points[side], 0, position.x, 0.045)
        center_y = (minimum.y + maximum.y) * 0.5
        center_z = (minimum.z + maximum.z) * 0.5
        radius_y = max(0.026, (maximum.y - minimum.y) * 0.5)
        radius_z = max(0.026, (maximum.z - minimum.z) * 0.5)
        angle = atan2((position.z - center_z) / radius_z, (position.y - center_y) / radius_y)
        target = Vector((
            position.x,
            center_y + cos(angle) * (radius_y + 0.011),
            center_z + sin(angle) * (radius_z + 0.011),
        ))
        return position.lerp(target, 0.32)

    if group and group.startswith(("thigh_", "calf_")):
        side = group.rsplit("_", 1)[-1]
        minimum, maximum = section_bounds(leg_points[side], 2, position.z, 0.040)
        center_x = (minimum.x + maximum.x) * 0.5
        center_y = (minimum.y + maximum.y) * 0.5
        radius_x = max(0.032, (maximum.x - minimum.x) * 0.5)
        radius_y = max(0.032, (maximum.y - minimum.y) * 0.5)
        angle = atan2((position.y - center_y) / radius_y, (position.x - center_x) / radius_x)
        target = Vector((
            center_x + cos(angle) * (radius_x + 0.012),
            center_y + sin(angle) * (radius_y + 0.012),
            position.z,
        ))
        return position.lerp(target, 0.36)
    return position


def build_fitted_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    garment: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    """Build a welded, body-derived jacket or trouser shell with restrained ease."""
    if garment not in {"jacket", "trousers"}:
        raise ValueError(f"Unsupported garment shell: {garment}")
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    torso_points = HAZMAT.BASE.group_points(body, armature, HAZMAT.TORSO_GROUPS)
    torso_minimum, torso_maximum = HAZMAT.BASE.bounds(torso_points)
    arm_points = {
        side: HAZMAT.BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        for side in ("l", "r")
    }
    leg_points = {
        side: HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})
        for side in ("l", "r")
    }
    lowerarm_points = arm_points["l"] + arm_points["r"]
    sleeve_limit_x = max(abs(point.x) for point in lowerarm_points) - 0.060
    lower_hem = 0.955
    upper_limit = min(1.535, torso_maximum.z + 0.020)
    trouser_waist = 1.025
    ankle_limit = 0.125

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    source_indices: list[int] = []
    source_to_new: dict[int, int] = {}
    position_to_new: dict[tuple[int, int, int], int] = {}

    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        dominant = [HAZMAT.dominant_group(body, index) for index in polygon.vertices]
        if garment == "jacket":
            torso_votes = sum(group in HAZMAT.TORSO_GROUPS for group in dominant)
            clavicle_votes = sum(group in {"clavicle_l", "clavicle_r"} for group in dominant)
            hand_votes = sum(HAZMAT.is_hand_group(group) for group in dominant)
            is_torso = lower_hem <= center.z <= upper_limit and torso_votes + clavicle_votes >= 1
            is_sleeve = (
                0.13 <= abs(center.x) <= sleeve_limit_x
                and 1.245 <= center.z <= 1.625
                and hand_votes == 0
            )
            keep = is_torso or is_sleeve
        else:
            leg_votes = sum(
                group in {"root", "pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r"}
                for group in dominant
            )
            pelvis_fallback = 0.72 <= center.z <= trouser_waist and abs(center.x) <= 0.40
            keep = ankle_limit <= center.z <= trouser_waist and (leg_votes >= 1 or pelvis_fallback)
        if not keep:
            continue

        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in source_to_new:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                normal = (normal_transform @ source_vertex.normal).normalized()
                group = HAZMAT.dominant_group(body, source_index)
                clearance = 0.014 if garment == "jacket" else 0.012
                position = base_position + normal * clearance
                position = fitted_section_position(
                    position,
                    group,
                    torso_points,
                    arm_points,
                    leg_points,
                    garment,
                )
                if garment == "jacket":
                    if abs(base_position.x) < 0.40:
                        position.z = max(lower_hem, min(upper_limit, position.z))
                    elif abs(position.x) > sleeve_limit_x:
                        position.x = (1.0 if position.x > 0.0 else -1.0) * sleeve_limit_x
                else:
                    position.z = max(ankle_limit, min(trouser_waist, position.z))
                key = tuple(round(value * 100000.0) for value in base_position)
                new_index = position_to_new.get(key)
                if new_index is None:
                    new_index = len(vertices)
                    position_to_new[key] = new_index
                    vertices.append(tuple(position))
                    source_indices.append(source_index)
                source_to_new[source_index] = new_index
            face.append(source_to_new[source_index])
        faces.append(tuple(face))

    mesh = bpy.data.meshes.new(f"{asset_id}_{garment}_blockout_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    shell = bpy.data.objects.new(f"leather_armor_blockout_{garment}", mesh)
    bpy.context.collection.objects.link(shell)
    shell.parent = armature
    shell.matrix_parent_inverse = Matrix.Identity(4)
    shell.matrix_world = armature.matrix_world.copy()
    HAZMAT.copy_shell_weights(body, shell, source_indices)
    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    smooth = shell.modifiers.new(f"{garment}_tailoring_smooth", "LAPLACIANSMOOTH")
    smooth.iterations = 3 if garment == "jacket" else 4
    smooth.lambda_factor = 0.035
    smooth.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    solidify = shell.modifiers.new(f"{garment}_leather_thickness", "SOLIDIFY")
    solidify.thickness = 0.0042
    solidify.offset = -0.10
    solidify.use_rim = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    armature_modifier = shell.modifiers.new("current_player_rig", "ARMATURE")
    armature_modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in shell.data.polygons:
        polygon.use_smooth = True
    shell.select_set(False)
    shell["realm_asset_id"] = asset_id
    shell["realm_geometry_stage"] = "blockout"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False
    return shell, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "lowerHemZ": lower_hem,
        "upperLimitZ": upper_limit,
        "sleeveLimitX": sleeve_limit_x,
        "trouserWaistZ": trouser_waist,
        "ankleLimitZ": ankle_limit,
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
    }


def neutralize_character(reference_objects: list[bpy.types.Object], body: bpy.types.Object) -> None:
    mannequin = flat_material("leather_armor_blockout_mannequin", (0.055, 0.063, 0.068), 0.96)
    for obj in reference_objects:
        if obj.type != "MESH":
            continue
        if obj == body:
            obj.data.materials.clear()
            obj.data.materials.append(mannequin)
        else:
            obj.hide_render = True


def refine_shell_for_two_piece_armor(
    shell: bpy.types.Object,
    fit: dict[str, object],
) -> dict[str, float]:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    torso_depth = torso_maximum.y - torso_minimum.y
    upper_limit = torso_maximum.z + 0.018
    jacket_hem = 1.025

    bm = bmesh.new()
    bm.from_mesh(shell.data)
    remove_faces = []
    for face in bm.faces:
        center = face.calc_center_median()
        remove_hands_or_feet = face.material_index == 1
        opening_progress = max(0.0, min(1.0, (center.z - 1.245) / max(0.001, upper_limit - 1.245)))
        opening_half_width = 0.022 + opening_progress * 0.082
        open_jacket_front = (
            center.z > 1.245
            and center.y < center_y - torso_depth * 0.31
            and abs(center.x) < opening_half_width
        )
        if remove_hands_or_feet or open_jacket_front:
            remove_faces.append(face)
    if remove_faces:
        bmesh.ops.delete(bm, geom=remove_faces, context="FACES")
    bm.to_mesh(shell.data)
    bm.free()
    shell.data.update()

    for polygon in shell.data.polygons:
        polygon.material_index = 0 if polygon.center.z >= jacket_hem else 1
        polygon.use_smooth = True
    shell.name = "leather_armor_blockout_jacket_and_trousers"
    shell["realm_asset_id"] = "equipment_leather_armor_blockout_v1"
    shell["realm_geometry_stage"] = "blockout"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False
    return {
        "jacketHemZ": jacket_hem,
        "frontOpeningStartZ": 1.245,
        "upperLimitZ": upper_limit,
    }


def trim_shell_to_trousers(shell: bpy.types.Object, waist_z: float = 0.995) -> dict[str, float]:
    """Keep only the continuous pelvis-and-leg part of the shared coverall.

    The coverall helper already has reliable body clearance and skin weights.
    Trimming it below the jacket gives us a clean trouser blockout without the
    boxy torso volume that is appropriate for a hazmat suit but not leather.
    """
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    remove_faces = []
    for face in bm.faces:
        center = face.calc_center_median()
        if face.material_index == 1 or center.z > waist_z:
            remove_faces.append(face)
    if remove_faces:
        bmesh.ops.delete(bm, geom=remove_faces, context="FACES")
    bm.to_mesh(shell.data)
    bm.free()
    shell.data.update()
    for polygon in shell.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    shell.name = "leather_armor_blockout_trousers"
    shell["realm_asset_id"] = "equipment_leather_armor_blockout_v1"
    shell["realm_geometry_stage"] = "blockout"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False
    return {"trouserWaistZ": waist_z, "bootOpeningZ": 0.125}


def build_trouser_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    waist_z: float,
) -> bpy.types.Object:
    builder = HAZMAT.HazmatBuilder()
    pelvis_points = HAZMAT.BASE.group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    waist_points = [point for point in pelvis_points if waist_z - 0.065 <= point.z <= waist_z + 0.035]
    waist_minimum, waist_maximum = HAZMAT.BASE.bounds(waist_points or pelvis_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.018,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.020,
    )
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        waist_radii,
        waist_z - 0.030,
        waist_z + 0.012,
        1,
        {"pelvis": 0.86, "spine_01": 0.14},
        24,
    )

    for side in ("l", "r"):
        thigh_points = HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}"})
        calf_points = HAZMAT.BASE.group_points(body, armature, {f"calf_{side}"})
        thigh_minimum, _ = HAZMAT.BASE.bounds(thigh_points)
        _, calf_maximum = HAZMAT.BASE.bounds(calf_points)
        knee_z = (thigh_minimum.z + calf_maximum.z) * 0.5
        knee_minimum, knee_maximum = section_bounds(thigh_points + calf_points, 2, knee_z, 0.070)
        knee_center_x = (knee_minimum.x + knee_maximum.x) * 0.5
        knee_front_y = knee_minimum.y - 0.018
        knee_radius_x = max(0.052, (knee_maximum.x - knee_minimum.x) * 0.34)
        builder.ellipse_disc_y(
            (knee_center_x, knee_front_y, knee_z),
            (knee_radius_x, 0.082),
            2,
            {f"thigh_{side}": 0.34, f"calf_{side}": 0.66},
            20,
        )

    details = HAZMAT.finalize_detail_builder(builder, armature, asset_id, "blockout_trouser_details")
    details["realm_geometry_stage"] = "blockout"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details


def build_coherent_design_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
    materials: tuple[bpy.types.Material, ...],
) -> bpy.types.Object:
    """Add only reference-defining construction masses to the fitted shells."""
    builder = HAZMAT.HazmatBuilder()
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    front_y = float(fit.get("frontY", torso_minimum.y - 0.008))
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x))
    upper_limit = float(fit["upperLimitZ"])
    lower_hem = float(fit["lowerHemZ"])

    # Narrow notched lapels, fitted to the actual chest plane instead of a
    # freestanding armour plate.
    lapel_outer = min(0.132, half_width * 0.62)
    for direction in (-1.0, 1.0):
        outline = [
            (direction * lapel_outer, upper_limit - 0.052),
            (direction * 0.054, upper_limit - 0.018),
            (direction * 0.034, 1.315),
            (direction * 0.094, 1.382),
        ]
        builder.prism_xz(outline, front_y - 0.004, 0.007, 0, {"spine_03": 0.82, "spine_02": 0.18})

    builder.ellipse_arc_band_z(
        (0.0, center_y + 0.006),
        (min(0.132, half_width * 0.56), 0.096),
        upper_limit - 0.040,
        upper_limit + 0.034,
        0.16,
        pi - 0.16,
        0,
        {"spine_03": 0.82, "neck_01": 0.18},
        20,
    )

    zipper_bottom = lower_hem + 0.030
    zipper_top = 1.325
    builder.box(
        (0.0, front_y - 0.012, (zipper_bottom + zipper_top) * 0.5),
        (0.014, 0.007, zipper_top - zipper_bottom),
        3,
        {"spine_01": 0.30, "spine_02": 0.50, "spine_03": 0.20},
    )

    waist_points = [
        point for point in HAZMAT.BASE.group_points(body, armature, HAZMAT.TORSO_GROUPS)
        if lower_hem - 0.030 <= point.z <= lower_hem + 0.085
    ]
    waist_minimum, waist_maximum = HAZMAT.BASE.bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.020,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.020,
    )
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        (waist_radii[0] * 0.992, waist_radii[1] * 0.992),
        lower_hem - 0.004,
        lower_hem + 0.020,
        0,
        {"pelvis": 0.25, "spine_01": 0.75},
        28,
    )
    belt_z0 = lower_hem + 0.008
    belt_z1 = belt_z0 + 0.042
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        waist_radii,
        belt_z0,
        belt_z1,
        1,
        {"pelvis": 0.28, "spine_01": 0.72},
        28,
    )
    buckle_y = waist_center_y - waist_radii[1] - 0.010
    buckle_z = (belt_z0 + belt_z1) * 0.5
    for x, z, size in (
        (-0.023, 0.0, (0.007, 0.008, 0.050)),
        (0.023, 0.0, (0.007, 0.008, 0.050)),
        (0.0, -0.021, (0.052, 0.008, 0.007)),
        (0.0, 0.021, (0.052, 0.008, 0.007)),
    ):
        builder.box((x, buckle_y, buckle_z + z), size, 3, {"spine_01": 0.82, "pelvis": 0.18})

    # Jacket cuffs and elbow reinforcement.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        arm_points = HAZMAT.BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        minimum, maximum = HAZMAT.BASE.bounds(arm_points)
        maximum_distance = max(abs(minimum.x), abs(maximum.x))
        cuff_center_x = direction * (maximum_distance - 0.050)
        cuff_minimum, cuff_maximum = section_bounds(arm_points, 0, cuff_center_x, 0.045)
        cuff_center = ((cuff_minimum.y + cuff_maximum.y) * 0.5, (cuff_minimum.z + cuff_maximum.z) * 0.5)
        cuff_radii = (
            (cuff_maximum.y - cuff_minimum.y) * 0.5 + 0.015,
            (cuff_maximum.z - cuff_minimum.z) * 0.5 + 0.015,
        )
        x0, x1 = sorted((cuff_center_x - 0.022, cuff_center_x + 0.022))
        builder.ellipse_band_x(x0, x1, cuff_center, cuff_radii, 1, {f"lowerarm_{side}": 1.0}, 18)

        elbow_x = direction * (maximum_distance * 0.72)
        elbow_minimum, elbow_maximum = section_bounds(arm_points, 0, elbow_x, 0.055)
        elbow_center_y = elbow_maximum.y + 0.014
        elbow_center_z = (elbow_minimum.z + elbow_maximum.z) * 0.5
        builder.ellipse_disc_y(
            (elbow_x, elbow_center_y, elbow_center_z),
            (0.050, 0.075),
            2,
            {f"upperarm_{side}": 0.28, f"lowerarm_{side}": 0.72},
            20,
        )

    # Trouser waistband, knee guards and ankle cuffs.
    trouser_waist = float(fit["trouserWaistZ"])
    pelvis_points = HAZMAT.BASE.group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    band_points = [point for point in pelvis_points if trouser_waist - 0.070 <= point.z <= trouser_waist + 0.025]
    pelvis_minimum, pelvis_maximum = HAZMAT.BASE.bounds(band_points or pelvis_points)
    pelvis_center_y = (pelvis_minimum.y + pelvis_maximum.y) * 0.5
    pelvis_radii = (
        max(abs(pelvis_minimum.x), abs(pelvis_maximum.x)) + 0.017,
        (pelvis_maximum.y - pelvis_minimum.y) * 0.5 + 0.018,
    )
    builder.ellipse_band_z(
        (0.0, pelvis_center_y),
        pelvis_radii,
        trouser_waist - 0.034,
        trouser_waist + 0.006,
        1,
        {"pelvis": 0.92, "spine_01": 0.08},
        28,
    )
    ankle_z = float(fit["ankleLimitZ"]) + 0.020
    for side in ("l", "r"):
        thigh_points = HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}"})
        calf_points = HAZMAT.BASE.group_points(body, armature, {f"calf_{side}"})
        thigh_minimum, _ = HAZMAT.BASE.bounds(thigh_points)
        _, calf_maximum = HAZMAT.BASE.bounds(calf_points)
        knee_z = (thigh_minimum.z + calf_maximum.z) * 0.5
        knee_minimum, knee_maximum = section_bounds(thigh_points + calf_points, 2, knee_z, 0.070)
        knee_center_x = (knee_minimum.x + knee_maximum.x) * 0.5
        builder.ellipse_disc_y(
            (knee_center_x, knee_minimum.y - 0.028, knee_z),
            (max(0.052, (knee_maximum.x - knee_minimum.x) * 0.34), 0.084),
            2,
            {f"thigh_{side}": 0.32, f"calf_{side}": 0.68},
            22,
        )
        ankle_minimum, ankle_maximum = section_bounds(calf_points, 2, ankle_z, 0.050)
        ankle_center = (
            (ankle_minimum.x + ankle_maximum.x) * 0.5,
            (ankle_minimum.y + ankle_maximum.y) * 0.5,
        )
        ankle_radii = (
            (ankle_maximum.x - ankle_minimum.x) * 0.5 + 0.014,
            (ankle_maximum.y - ankle_minimum.y) * 0.5 + 0.014,
        )
        builder.ellipse_band_z(
            ankle_center,
            ankle_radii,
            ankle_z - 0.030,
            ankle_z + 0.020,
            1,
            {f"calf_{side}": 1.0},
            18,
        )

    details = HAZMAT.finalize_detail_builder(builder, armature, asset_id, "blockout_design_masses")
    details.data.materials.clear()
    for material in materials:
        details.data.materials.append(material)
    for polygon, material_index in zip(details.data.polygons, builder.materials):
        polygon.material_index = material_index
    details["realm_geometry_stage"] = "blockout"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details


def section_bounds(points: list[Vector], axis: int, value: float, half_window: float) -> tuple[Vector, Vector]:
    selected = [point for point in points if abs(point[axis] - value) <= half_window]
    return HAZMAT.BASE.bounds(selected or points)


def add_z_loft(
    builder: HAZMAT.HazmatBuilder,
    specs: list[tuple[float, float, float, float, float, dict[str, float]]],
    material: int,
    segments: int = 28,
) -> list[list[int]]:
    rings: list[list[int]] = []
    for z, center_x, center_y, radius_x, radius_y, weights in specs:
        ring = []
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            ring.append(builder.vertex((
                center_x + cos(angle) * radius_x,
                center_y + sin(angle) * radius_y,
                z,
            ), weights))
        rings.append(ring)
    for first, second in zip(rings, rings[1:]):
        for index in range(segments):
            following = (index + 1) % segments
            builder.face((first[index], first[following], second[following], second[index]), material)
    return rings


def add_x_loft(
    builder: HAZMAT.HazmatBuilder,
    specs: list[tuple[float, float, float, float, float, dict[str, float]]],
    material: int,
    segments: int = 22,
) -> list[list[int]]:
    rings: list[list[int]] = []
    for x, center_y, center_z, radius_y, radius_z, weights in specs:
        ring = []
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            ring.append(builder.vertex((
                x,
                center_y + cos(angle) * radius_y,
                center_z + sin(angle) * radius_z,
            ), weights))
        rings.append(ring)
    for first, second in zip(rings, rings[1:]):
        for index in range(segments):
            following = (index + 1) % segments
            builder.face((first[index], first[following], second[following], second[index]), material)
    return rings


def add_review_thickness(obj: bpy.types.Object, name: str) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    solidify = obj.modifiers.new(name, "SOLIDIFY")
    solidify.thickness = 0.0040
    solidify.offset = -0.10
    solidify.use_rim = True
    obj.select_set(False)


def build_parametric_jacket(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    """Construct a clean jacket blockout as tailored lofts around the donor."""
    builder = HAZMAT.HazmatBuilder()
    torso_points = HAZMAT.BASE.group_points(body, armature, HAZMAT.TORSO_GROUPS)
    torso_minimum, torso_maximum = HAZMAT.BASE.bounds(torso_points)
    torso_levels = (0.955, 1.055, 1.205, 1.335, 1.405)
    torso_specs = []
    for z in torso_levels:
        minimum, maximum = section_bounds(torso_points, 2, z, 0.045)
        center_y = (minimum.y + maximum.y) * 0.5
        ease_x = 0.018 if z < 1.16 else (0.034 if z < 1.30 else 0.052)
        ease_y = 0.020 if z < 1.16 else (0.028 if z < 1.30 else 0.036)
        torso_specs.append((
            z,
            0.0,
            center_y,
            max(abs(minimum.x), abs(maximum.x)) + ease_x,
            (maximum.y - minimum.y) * 0.5 + ease_y,
            HAZMAT.BASE.torso_weights(z),
        ))
    torso_rings = add_z_loft(builder, torso_specs, 0, 30)

    top_spec = torso_specs[-1]
    top_ring = torso_rings[-1]
    shoulder_outer: list[int] = []
    shoulder_inner: list[int] = []
    segments = len(top_ring)
    neck_center_y = (torso_minimum.y + torso_maximum.y) * 0.5 - 0.004
    for index in range(segments):
        angle = 2.0 * pi * index / segments
        x = cos(angle) * (top_spec[3] + 0.055)
        y = top_spec[2] + sin(angle) * (top_spec[4] + 0.042)
        shoulder_z = 1.472 + 0.040 * abs(sin(angle))
        side = "l" if x >= 0.0 else "r"
        outer_weights = {"spine_03": 0.48, f"clavicle_{side}": 0.52}
        shoulder_outer.append(builder.vertex((x, y, shoulder_z), outer_weights))
        shoulder_inner.append(builder.vertex((
            cos(angle) * 0.082,
            neck_center_y + sin(angle) * 0.066,
            1.525,
        ), {"spine_03": 0.70, "neck_01": 0.30}))
    for index in range(segments):
        following = (index + 1) % segments
        builder.face((top_ring[index], top_ring[following], shoulder_outer[following], shoulder_outer[index]), 0)
        builder.face((shoulder_outer[index], shoulder_outer[following], shoulder_inner[following], shoulder_inner[index]), 0)

    arm_points = {
        side: HAZMAT.BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        for side in ("l", "r")
    }
    sleeve_limits = []
    for side, direction in (("l", 1.0), ("r", -1.0)):
        points = arm_points[side]
        minimum, maximum = HAZMAT.BASE.bounds(points)
        inner_abs = max(0.120, min(abs(minimum.x), abs(maximum.x)) - 0.035)
        outer_abs = max(abs(minimum.x), abs(maximum.x)) - 0.050
        sleeve_limits.append(outer_abs)
        sleeve_specs = []
        for progression in (0.0, 0.22, 0.50, 0.76, 1.0):
            x_abs = inner_abs + (outer_abs - inner_abs) * progression
            x = direction * x_abs
            section_minimum, section_maximum = section_bounds(points, 0, x, 0.045)
            center_y = (section_minimum.y + section_maximum.y) * 0.5
            center_z = (section_minimum.z + section_maximum.z) * 0.5
            overlap_ease = 0.034 * max(0.0, 1.0 - progression / 0.25)
            radius_y = (section_maximum.y - section_minimum.y) * 0.5 + 0.014 + overlap_ease
            radius_z = (section_maximum.z - section_minimum.z) * 0.5 + 0.014 + overlap_ease
            if progression < 0.18:
                weights = {f"clavicle_{side}": 0.24, f"upperarm_{side}": 0.76}
            elif progression < 0.62:
                weights = {f"upperarm_{side}": 0.88, f"lowerarm_{side}": 0.12}
            else:
                blend = min(1.0, (progression - 0.62) / 0.38)
                weights = {f"upperarm_{side}": 1.0 - blend, f"lowerarm_{side}": blend}
            sleeve_specs.append((x, center_y, center_z, radius_y, radius_z, weights))
        add_x_loft(builder, sleeve_specs, 0, 24)

    jacket = HAZMAT.finalize_detail_builder(builder, armature, asset_id, "blockout_parametric_jacket")
    jacket.name = "leather_armor_blockout_jacket"
    add_review_thickness(jacket, "jacket_blockout_thickness")
    jacket["realm_geometry_stage"] = "blockout"
    return jacket, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "lowerHemZ": torso_levels[0],
        "upperLimitZ": 1.505,
        "sleeveLimitX": max(sleeve_limits),
        "trouserWaistZ": 1.025,
        "ankleLimitZ": 0.125,
        "frontY": round(torso_specs[2][2] - torso_specs[2][4] - 0.006, 5),
        "construction": "measured parametric loft",
        "vertices": len(jacket.data.vertices),
        "polygons": len(jacket.data.polygons),
    }


def build_parametric_trousers(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    """Construct a clean high-waisted trouser yoke with two articulated legs."""
    builder = HAZMAT.HazmatBuilder()
    pelvis_points = HAZMAT.BASE.group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    pelvis_specs = []
    for z, weights in (
        (0.725, {"pelvis": 0.30, "thigh_l": 0.35, "thigh_r": 0.35}),
        (0.855, {"pelvis": 0.62, "thigh_l": 0.19, "thigh_r": 0.19}),
        (1.025, {"pelvis": 0.92, "spine_01": 0.08}),
    ):
        minimum, maximum = section_bounds(pelvis_points, 2, z, 0.055)
        pelvis_specs.append((
            z,
            0.0,
            (minimum.y + maximum.y) * 0.5,
            max(abs(minimum.x), abs(maximum.x)) + 0.016,
            (maximum.y - minimum.y) * 0.5 + 0.018,
            weights,
        ))
    pelvis_rings = add_z_loft(builder, pelvis_specs, 0, 30)
    pelvis_bottom_center = builder.vertex((
        pelvis_specs[0][1],
        pelvis_specs[0][2],
        pelvis_specs[0][0],
    ), pelvis_specs[0][5])
    for index in range(len(pelvis_rings[0])):
        following = (index + 1) % len(pelvis_rings[0])
        builder.face((pelvis_bottom_center, pelvis_rings[0][following], pelvis_rings[0][index]), 0)

    for side in ("l", "r"):
        points = HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})
        leg_specs = []
        for z in (0.885, 0.700, 0.500, 0.300, 0.135):
            minimum, maximum = section_bounds(points, 2, z, 0.045)
            if z >= 0.66:
                weights = {f"thigh_{side}": 1.0}
            elif z >= 0.46:
                blend = (0.66 - z) / 0.20
                weights = {f"thigh_{side}": 1.0 - blend, f"calf_{side}": blend}
            else:
                weights = {f"calf_{side}": 1.0}
            leg_specs.append((
                z,
                (minimum.x + maximum.x) * 0.5,
                (minimum.y + maximum.y) * 0.5,
                (maximum.x - minimum.x) * 0.5 + 0.012,
                (maximum.y - minimum.y) * 0.5 + 0.012,
                weights,
            ))
        add_z_loft(builder, leg_specs, 0, 26)

    trousers = HAZMAT.finalize_detail_builder(builder, armature, asset_id, "blockout_parametric_trousers")
    trousers.name = "leather_armor_blockout_trousers"
    add_review_thickness(trousers, "trouser_blockout_thickness")
    trousers["realm_geometry_stage"] = "blockout"
    return trousers, {
        "trouserWaistZ": 1.025,
        "ankleLimitZ": 0.125,
        "construction": "measured pelvis and leg lofts",
        "vertices": len(trousers.data.vertices),
        "polygons": len(trousers.data.polygons),
    }


def build_blockout_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
    silhouette: dict[str, float],
) -> bpy.types.Object:
    builder = HAZMAT.HazmatBuilder()
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.035
    radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.038
    front_y = center_y - radius_y - 0.014
    jacket_hem = silhouette["jacketHemZ"]
    upper_limit = silhouette["upperLimitZ"]

    # A broad hem establishes the jacket as a separate garment over the trouser
    # waistband.  No buckle or small hardware is introduced at blockout stage.
    waist_points = [
        point for point in HAZMAT.BASE.group_points(body, armature, HAZMAT.TORSO_GROUPS)
        if jacket_hem - 0.055 <= point.z <= jacket_hem + 0.055
    ]
    waist_minimum, waist_maximum = HAZMAT.BASE.bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.022,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.024,
    )
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        waist_radii,
        jacket_hem - 0.012,
        jacket_hem + 0.018,
        2,
        {"pelvis": 0.30, "spine_01": 0.70},
        24,
    )

    pelvis_points = HAZMAT.BASE.group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    pelvis_band_points = [point for point in pelvis_points if 0.80 <= point.z <= 1.08]
    pelvis_minimum, pelvis_maximum = HAZMAT.BASE.bounds(pelvis_band_points or pelvis_points)
    pelvis_center_y = (pelvis_minimum.y + pelvis_maximum.y) * 0.5
    pelvis_bottom_radii = (
        max(abs(pelvis_minimum.x), abs(pelvis_maximum.x)) + 0.026,
        (pelvis_maximum.y - pelvis_minimum.y) * 0.5 + 0.030,
    )
    pelvis_top_radii = (
        max(waist_radii[0] - 0.004, pelvis_bottom_radii[0] * 0.90),
        max(waist_radii[1] - 0.004, pelvis_bottom_radii[1] * 0.90),
    )
    builder.ellipse_frustum_z(
        (0.0, pelvis_center_y),
        pelvis_bottom_radii,
        pelvis_top_radii,
        0.790,
        jacket_hem - 0.015,
        1,
        {"pelvis": 0.54, "thigh_l": 0.23, "thigh_r": 0.23},
        {"pelvis": 0.82, "spine_01": 0.18},
        28,
    )

    # Restrained motorcycle-style lapels communicate the intended jacket cut
    # while leaving their exact fold and thickness for the next approved stage.
    lapel_outer = min(0.125, half_width * 0.50)
    lapel_inner = max(0.040, half_width * 0.18)
    lapel_point = 1.285
    for direction in (-1.0, 1.0):
        outline = [
            (direction * (lapel_inner * 0.90), upper_limit - 0.020),
            (direction * (lapel_outer * 0.72), upper_limit - 0.046),
            (direction * lapel_outer, upper_limit - 0.135),
            (direction * (lapel_outer * 0.58), lapel_point + 0.040),
            (direction * 0.030, lapel_point),
        ]
        builder.prism_xz(outline, front_y - 0.008, 0.008, 0, {"spine_02": 0.28, "spine_03": 0.72})

    # Raised back collar: a protective leather stand, not a hood.
    builder.ellipse_arc_band_z(
        (0.0, center_y + 0.010),
        (0.122, 0.100),
        upper_limit - 0.045,
        upper_limit + 0.040,
        0.16,
        pi - 0.16,
        2,
        {"spine_03": 0.84, "neck_01": 0.16},
        18,
    )

    # Sleeve cuffs are kept as large silhouette forms only.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        lowerarm_points = HAZMAT.BASE.group_points(body, armature, {f"lowerarm_{side}"})
        minimum, maximum = HAZMAT.BASE.bounds(lowerarm_points)
        maximum_distance = max(abs(minimum.x), abs(maximum.x))
        cuff_center_x = direction * (maximum_distance - 0.048)
        cuff_minimum, cuff_maximum = section_bounds(lowerarm_points, 0, cuff_center_x, 0.045)
        center_yz = ((cuff_minimum.y + cuff_maximum.y) * 0.5, (cuff_minimum.z + cuff_maximum.z) * 0.5)
        radii_yz = (
            (cuff_maximum.y - cuff_minimum.y) * 0.5 + 0.019,
            (cuff_maximum.z - cuff_minimum.z) * 0.5 + 0.019,
        )
        x0, x1 = sorted((cuff_center_x - 0.026, cuff_center_x + 0.026))
        builder.ellipse_band_x(x0, x1, center_yz, radii_yz, 2, {f"lowerarm_{side}": 1.0}, 16)

    # Trousers: high waist, broad knee reinforcements and ankle openings that
    # leave boots as a separate equipment slot.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        thigh_points = HAZMAT.BASE.group_points(body, armature, {f"thigh_{side}"})
        calf_points = HAZMAT.BASE.group_points(body, armature, {f"calf_{side}"})
        thigh_minimum, thigh_maximum = HAZMAT.BASE.bounds(thigh_points)
        calf_minimum, calf_maximum = HAZMAT.BASE.bounds(calf_points)
        knee_z = (thigh_minimum.z + calf_maximum.z) * 0.5
        all_leg_points = thigh_points + calf_points
        knee_minimum, knee_maximum = section_bounds(all_leg_points, 2, knee_z, 0.080)
        knee_x = (knee_minimum.x + knee_maximum.x) * 0.5
        knee_y = knee_minimum.y - 0.050
        knee_radius_x = max(0.064, (knee_maximum.x - knee_minimum.x) * 0.38)
        builder.ellipse_disc_y(
            (knee_x, knee_y, knee_z),
            (knee_radius_x, 0.098),
            2,
            {f"thigh_{side}": 0.30, f"calf_{side}": 0.70},
            20,
        )

        ankle_z = max(0.125, calf_minimum.z + 0.070)
        ankle_minimum, ankle_maximum = section_bounds(calf_points, 2, ankle_z, 0.055)
        ankle_center = (
            (ankle_minimum.x + ankle_maximum.x) * 0.5,
            (ankle_minimum.y + ankle_maximum.y) * 0.5,
        )
        ankle_radii = (
            (ankle_maximum.x - ankle_minimum.x) * 0.5 + 0.018,
            (ankle_maximum.y - ankle_minimum.y) * 0.5 + 0.018,
        )
        builder.ellipse_band_z(
            ankle_center,
            ankle_radii,
            ankle_z - 0.022,
            ankle_z + 0.025,
            2,
            {f"calf_{side}": 1.0},
            18,
        )

    details = HAZMAT.finalize_detail_builder(builder, armature, asset_id, "blockout_large_forms")
    details["realm_geometry_stage"] = "blockout"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details


def pose_blockout(armature: bpy.types.Object) -> None:
    armature.data.pose_position = "POSE"
    for side, direction in (("l", 1.0), ("r", -1.0)):
        upperarm = armature.pose.bones.get(f"upperarm_{side}")
        if upperarm:
            upperarm.rotation_mode = "XYZ"
            upperarm.rotation_euler.z = -direction * 0.34
    bpy.context.view_layer.update()


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()


def render_blockout(
    equipment_objects: list[bpy.types.Object],
    output: Path,
    camera_location: tuple[float, float, float],
    target: tuple[float, float, float],
    ortho_scale: float,
    resolution: tuple[int, int] = (900, 1100),
    wireframe: bool = False,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("leather_armor_blockout_world")
    scene.world.color = (0.020, 0.023, 0.024)

    for obj in [
        obj for obj in list(scene.objects)
        if obj.name.startswith("leather_armor_blockout_light")
        or obj.name in {"leather_armor_blockout_camera", "leather_armor_blockout_floor"}
    ]:
        bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, -0.02))
    floor = bpy.context.object
    floor.name = "leather_armor_blockout_floor"
    floor_material = bpy.data.materials.get("leather_armor_blockout_floor_material") or flat_material(
        "leather_armor_blockout_floor_material", (0.070, 0.076, 0.074), 0.98
    )
    floor.data.materials.append(floor_material)

    for name, location, energy, color, size in (
        ("leather_armor_blockout_light_key", (-2.8, -3.6, 4.6), 1180, (1.0, 0.82, 0.66), 3.2),
        ("leather_armor_blockout_light_fill", (3.2, -1.0, 3.2), 760, (0.58, 0.73, 0.88), 3.4),
        ("leather_armor_blockout_light_rim", (0.0, 3.4, 3.6), 980, (0.88, 0.67, 0.43), 2.5),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        HAZMAT.BASE.look_at(light, Vector(target))

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "leather_armor_blockout_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.lens = 58
    HAZMAT.BASE.look_at(camera, Vector(target))
    scene.camera = camera

    wire_objects: list[bpy.types.Object] = []
    if wireframe:
        wire_material = bpy.data.materials.get("leather_armor_blockout_wire") or flat_material(
            "leather_armor_blockout_wire", (0.004, 0.006, 0.006), 1.0
        )
        for source in equipment_objects:
            duplicate = source.copy()
            duplicate.data = source.data.copy()
            duplicate.name = f"{source.name}_wire_preview"
            bpy.context.collection.objects.link(duplicate)
            duplicate.data.materials.clear()
            duplicate.data.materials.append(wire_material)
            modifier = duplicate.modifiers.new("blockout_wireframe", "WIREFRAME")
            modifier.thickness = 0.0011
            modifier.use_replace = True
            wire_objects.append(duplicate)

    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output.resolve())
    bpy.ops.render.render(write_still=True)
    for obj in wire_objects:
        bpy.data.objects.remove(obj, do_unlink=True)


def export_preview(output: Path, armature: bpy.types.Object, equipment_objects: list[bpy.types.Object]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in equipment_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = equipment_objects[0]
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


def parse_glb(path: Path) -> dict[str, int]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    accessors = gltf.get("accessors", [])
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index = primitive.get("indices")
            if index is not None:
                triangles += accessors[index]["count"] // 3
    return {
        "meshes": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])),
        "skins": len(gltf.get("skins", [])),
        "triangles": triangles,
    }


def main() -> None:
    args = parse_args()
    if args.body_id != "male_medium":
        raise RuntimeError("The approval blockout is intentionally limited to male_medium")
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

    materials = (
        flat_material("blockout_jacket_warm_brown", (0.072, 0.026, 0.012), 0.90),
        flat_material("blockout_trousers_dark_umber", (0.036, 0.014, 0.009), 0.94),
        flat_material("blockout_reinforcement_mid_brown", (0.105, 0.039, 0.016), 0.88),
        flat_material("blockout_hardware_charcoal", (0.022, 0.026, 0.025), 0.82),
    )
    jacket_shell, jacket_fit = build_fitted_shell(body, armature, args.asset_id, "jacket")
    jacket_shell.data.materials.clear()
    jacket_shell.data.materials.append(materials[0])
    trouser_shell, trouser_fit = build_fitted_shell(body, armature, args.asset_id, "trousers")
    trouser_shell.data.materials.clear()
    trouser_shell.data.materials.append(materials[1])
    details = build_coherent_design_details(body, armature, args.asset_id, jacket_fit, materials)
    neutralize_character(reference_objects, body)
    equipment_objects = [jacket_shell, trouser_shell, details]

    pose_blockout(armature)
    renders = (
        (args.front_render, (0.0, -4.5, 1.12), (0.0, 0.0, 0.92), 1.98, (900, 1100), False),
        (args.back_render, (0.0, 4.5, 1.12), (0.0, 0.0, 0.92), 1.98, (900, 1100), False),
        (args.left_render, (-4.5, 0.0, 1.12), (0.0, 0.0, 0.92), 1.98, (900, 1100), False),
        (args.right_render, (4.5, 0.0, 1.12), (0.0, 0.0, 0.92), 1.98, (900, 1100), False),
        (args.three_quarter_render, (3.15, -3.65, 1.58), (0.0, 0.0, 0.92), 2.05, (900, 1100), False),
        (args.isometric_render, (3.20, -3.75, 2.68), (0.0, 0.0, 0.86), 2.12, (900, 1100), False),
        (args.game_camera_render, (3.10, -3.65, 2.58), (0.0, 0.0, 0.82), 2.08, (768, 768), False),
        (args.wireframe_render, (3.15, -3.65, 1.58), (0.0, 0.0, 0.92), 2.05, (900, 1100), True),
        (args.native_render, (3.10, -3.65, 2.58), (0.0, 0.0, 0.82), 2.08, (112, 112), False),
    )
    for output, location, target, scale, resolution, wireframe in renders:
        render_blockout(equipment_objects, output, location, target, scale, resolution, wireframe)
    reset_pose(armature)

    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    export_preview(args.output, armature, equipment_objects)
    actual = parse_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "stage": "blockout",
        "garments": ["hip-length leather jacket", "high-waisted reinforced leather trousers"],
        "actualGlb": actual,
        "bytes": args.output.stat().st_size,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": {"jacket": jacket_fit, "trousers": trouser_fit},
        "silhouette": {
            "jacketHemZ": jacket_fit["lowerHemZ"],
            "trouserWaistZ": trouser_fit["trouserWaistZ"],
            "ankleLimitZ": trouser_fit["ankleLimitZ"],
        },
        "materials": [material.name for material in materials],
        "omittedUntilApproval": ["PBR textures", "micro detail", "hardware", "final topology", "six-body adaptation", "runtime integration"],
        "reviewOnly": True,
        "artisticApproval": False,
        "runtimeIntegrationAllowed": False,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_LEATHER_ARMOR_BLOCKOUT=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
