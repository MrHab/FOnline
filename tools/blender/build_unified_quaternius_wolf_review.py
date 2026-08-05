"""Build a B+C ash wolf from the CC0 Quaternius Wolf topology and rig.

The donor contributes one connected low-poly surface, a 51-bone quadruped
rig and authored animal motion. Realm of Ashes keeps that animation-safe
topology, replaces every material with packed B+C PBR textures, normalizes
the six runtime action names and gates runtime export behind a separately
approved review SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import pi, sqrt
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    apply_ground_contact_corrections,
    connected_component_count,
    evaluated_bounds,
    parse_glb,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {
    "idle": "Idle",
    "walk": "Walk",
    "run": "Gallop",
    "attack": "Attack",
    "hurt": "Idle_HitReact_Left",
    "death": "Death",
}
DONOR_SHA256 = "FE31C3829DD2A8B9DFEDB2E5CB656939A1D525EBD535A62434D2D25A4399CB9E"
ROOT_SCALE = (0.630, 0.380, 0.503)
RUNTIME_SCALE_MULTIPLIER = 1.0
# Three.js evaluates the exported skinned vertex transform and the preserved
# asset-root transform together. A component-wise square root therefore makes
# the final runtime dimensions equal the approved review dimensions instead of
# applying the non-uniform art scale twice.
RUNTIME_ROOT_SCALE = tuple(sqrt(component) for component in ROOT_SCALE)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--asset-id",
        default="creature_ash_wolf_unified_v8",
    )
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def validate_sha256(value: str) -> str:
    normalized = str(value or "").upper()
    if normalized and (
        len(normalized) != 64
        or any(character not in "0123456789ABCDEF" for character in normalized)
    ):
        raise RuntimeError(
            "--runtime-approved-sha must be a 64-character hexadecimal SHA-256"
        )
    return normalized


def vertex_weight(
    vertex: bpy.types.MeshVertex,
    group_names: dict[int, str],
    wanted: set[str],
) -> float:
    return max(
        (
            assignment.weight
            for assignment in vertex.groups
            if group_names.get(assignment.group) in wanted
        ),
        default=0.0,
    )


def polygon_weight(
    body: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
    group_names: dict[int, str],
    wanted: set[str],
) -> float:
    return max(
        vertex_weight(body.data.vertices[index], group_names, wanted)
        for index in polygon.vertices
    )


def create_box_projected_uv(body: bpy.types.Object) -> None:
    """Create deterministic UVs without changing the connected donor mesh."""
    points = [vertex.co.copy() for vertex in body.data.vertices]
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    span = maximum - minimum
    for axis in range(3):
        span[axis] = max(span[axis], 1e-6)
    uv_layer = body.data.uv_layers.get("RealmWolfUV")
    if uv_layer is None:
        uv_layer = body.data.uv_layers.new(name="RealmWolfUV")
    for polygon in body.data.polygons:
        normal = polygon.normal
        absolute = tuple(abs(value) for value in normal)
        dominant = absolute.index(max(absolute))
        for loop_index in polygon.loop_indices:
            point = body.data.vertices[
                body.data.loops[loop_index].vertex_index
            ].co
            if dominant == 0:
                uv = (
                    (point.y - minimum.y) / span.y,
                    (point.z - minimum.z) / span.z,
                )
            elif dominant == 1:
                uv = (
                    (point.x - minimum.x) / span.x,
                    (point.z - minimum.z) / span.z,
                )
            else:
                uv = (
                    (point.x - minimum.x) / span.x,
                    (point.y - minimum.y) / span.y,
                )
            uv_layer.data[loop_index].uv = uv
    body.data.uv_layers.active = uv_layer
    body.data.update()


def rematerialize_body(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> dict[str, object]:
    """Preserve topology/weights while applying the approved B+C hierarchy."""
    original_material_names = [
        body.data.materials[polygon.material_index].name
        for polygon in body.data.polygons
    ]
    group_names = {group.index: group.name for group in body.vertex_groups}
    ear_tips = {
        "Ear3.L",
        "Ear4.L",
        "Ear3.R",
        "Ear4.R",
    }
    tail_tip = {"Tail7", "Tail8"}
    create_box_projected_uv(body)
    body.data.materials.clear()
    material_order = ("fur", "underfur", "dust", "charcoal", "eyes")
    for name in material_order:
        body.data.materials.append(materials[name])

    counts = {name: 0 for name in material_order}
    for polygon, source_name in zip(
        body.data.polygons,
        original_material_names,
    ):
        center = sum(
            (body.data.vertices[index].co for index in polygon.vertices),
            Vector(),
        ) / len(polygon.vertices)
        if source_name == "Eyes_Black":
            target = "eyes"
        elif source_name == "Nose":
            target = "charcoal"
        elif (
            polygon_weight(body, polygon, group_names, ear_tips) > 0.55
            or polygon_weight(body, polygon, group_names, tail_tip) > 0.72
        ):
            target = "charcoal"
        elif center.z < 0.34:
            target = "dust"
        elif source_name == "Main_Light":
            target = "underfur"
        else:
            target = "fur"
        polygon.material_index = material_order.index(target)
        polygon.use_smooth = False
        counts[target] += 1
    body.data.update()

    if counts["fur"] < 400 or counts["underfur"] < 150:
        raise RuntimeError(f"Wolf material hierarchy is too sparse: {counts}")
    if counts["eyes"] != 8 or counts["charcoal"] < 20:
        raise RuntimeError(f"Wolf facial/accent materials are incomplete: {counts}")
    return {
        "materialPolygonCounts": counts,
        "uvProjection": "deterministic dominant-axis box projection",
        "topologyEdits": 0,
        "facetPolicy": "preserved Quaternius flat-shaded faces",
    }


def limit_skin_influences(body: bpy.types.Object) -> dict[str, int]:
    """Make the donor's skin contract explicit for the four-weight runtime."""
    before = [
        sum(1 for assignment in vertex.groups if assignment.weight > 1e-6)
        for vertex in body.data.vertices
    ]
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_limit_total(
        group_select_mode="ALL",
        limit=4,
    )
    bpy.ops.object.vertex_group_normalize_all(
        group_select_mode="ALL",
        lock_active=False,
    )
    after = [
        sum(1 for assignment in vertex.groups if assignment.weight > 1e-6)
        for vertex in body.data.vertices
    ]
    overflow = sum(1 for count in before if count > 4)
    if max(after, default=0) > 4:
        raise RuntimeError("Wolf skin still contains more than four influences")
    return {
        "verticesLimitedToFourInfluences": overflow,
        "maximumInfluencesBefore": max(before, default=0),
        "maximumInfluencesAfter": max(after, default=0),
    }


def add_deforming_jaw(
    body: bpy.types.Object,
    armature: bpy.types.Object,
) -> dict[str, object]:
    """Extend the donor rig with a weighted jaw while keeping one body mesh."""
    if armature.data.bones.get("Jaw") is not None:
        raise RuntimeError("Quaternius donor unexpectedly already has Jaw")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    jaw = armature.data.edit_bones.new("Jaw")
    # The hinge sits at the rear corner of the mouth, not under the cheek.
    # This pivot lets the lower jaw swing down instead of dragging the whole
    # muzzle through a nod.
    jaw.head = (0.0, -1.94, 2.00)
    jaw.tail = (0.0, -2.44, 1.88)
    jaw.parent = armature.data.edit_bones["Head"]
    jaw.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    lower_jaw_vertices: set[int] = set()
    for polygon in body.data.polygons:
        source_name = body.data.materials[polygon.material_index].name
        if (
            source_name == "Main_Light"
            and polygon.center.y < -1.82
            and polygon.center.z < 2.04
        ):
            lower_jaw_vertices.update(polygon.vertices)
    jaw_group = body.vertex_groups.new(name="Jaw")
    weighted = 0
    maximum_weight = 0.0
    for index in sorted(lower_jaw_vertices):
        vertex = body.data.vertices[index]
        # A hard upper boundary prevents upper-lip and cheek vertices from
        # following the jaw. The two gradients feather the lower surface into
        # the anatomical hinge while keeping the chin almost rigidly attached.
        if vertex.co.z >= 2.04:
            continue
        forward = max(
            0.0,
            min(1.0, (-1.88 - vertex.co.y) / 0.56),
        )
        lower = max(
            0.0,
            min(1.0, (2.08 - vertex.co.z) / 0.24),
        )
        weight = min(1.0, forward * lower * 1.35)
        if weight <= 0.025:
            continue
        assignments = [
            (assignment.group, assignment.weight)
            for assignment in vertex.groups
        ]
        for group_index, old_weight in assignments:
            body.vertex_groups[group_index].add(
                [index],
                old_weight * (1.0 - weight),
                "REPLACE",
            )
        jaw_group.add([index], weight, "REPLACE")
        weighted += 1
        maximum_weight = max(maximum_weight, weight)
    if not 30 <= weighted <= 45 or maximum_weight < 0.90:
        raise RuntimeError(
            "Weighted jaw mask is not anatomically narrow: "
            f"vertices={weighted}, maximum={maximum_weight:.3f}"
        )
    return {
        "bone": "Jaw",
        "parent": "Head",
        "hinge": [0.0, -1.94, 2.00],
        "weightedVertices": weighted,
        "maximumWeight": round(maximum_weight, 4),
        "upperVertexBoundaryZ": 2.04,
        "topologyChange": "none",
    }


def add_mouth_interior(
    armature: bpy.types.Object,
    mouth_material: bpy.types.Material,
    tooth_material: bpy.types.Material,
) -> tuple[bpy.types.Object, dict[str, object]]:
    """Add a skinned dark cavity and four low-poly canine teeth."""
    vertices = [
        (-0.145, -1.98, 1.91),
        (0.145, -1.98, 1.91),
        (0.145, -1.98, 2.02),
        (-0.145, -1.98, 2.02),
        (-0.055, -2.45, 1.95),
        (0.055, -2.45, 1.95),
        (0.055, -2.45, 2.07),
        (-0.055, -2.45, 2.07),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (3, 2, 6, 7),
        (0, 3, 7, 4),
        (1, 5, 6, 2),
    ]
    material_indices = [0] * len(faces)
    head_vertices = set(range(len(vertices)))
    jaw_vertices: set[int] = set()

    def append_fang(
        center_x: float,
        center_y: float,
        base_z: float,
        tip_z: float,
        bone: str,
    ) -> None:
        start = len(vertices)
        radius = 0.030
        vertices.extend(
            (
                (center_x - radius, center_y - radius * 0.45, base_z),
                (center_x + radius, center_y - radius * 0.45, base_z),
                (center_x, center_y + radius * 0.65, base_z),
                (center_x, center_y, tip_z),
            )
        )
        faces.extend(
            (
                (start, start + 1, start + 2),
                (start, start + 3, start + 1),
                (start + 1, start + 3, start + 2),
                (start + 2, start + 3, start),
            )
        )
        material_indices.extend((1, 1, 1, 1))
        destination = head_vertices if bone == "Head" else jaw_vertices
        destination.update(range(start, start + 4))

    for x in (-0.095, 0.095):
        append_fang(x, -2.31, 2.075, 1.925, "Head")
    for x in (-0.075, 0.075):
        append_fang(x, -2.26, 1.865, 1.990, "Jaw")

    mesh = bpy.data.meshes.new("ash_wolf_mouth_details_mesh")
    mesh.from_pydata(vertices, (), faces)
    mesh.materials.append(mouth_material)
    mesh.materials.append(tooth_material)
    for polygon, material_index in zip(mesh.polygons, material_indices):
        polygon.use_smooth = False
        polygon.material_index = material_index
    mesh.update()
    mouth_details = bpy.data.objects.new("ash_wolf_mouth_details", mesh)
    bpy.context.scene.collection.objects.link(mouth_details)
    mouth_details.parent = armature
    create_box_projected_uv(mouth_details)
    head_group = mouth_details.vertex_groups.new(name="Head")
    head_group.add(sorted(head_vertices), 1.0, "REPLACE")
    jaw_group = mouth_details.vertex_groups.new(name="Jaw")
    jaw_group.add(sorted(jaw_vertices), 1.0, "REPLACE")
    modifier = mouth_details.modifiers.new("ash_wolf_mouth_skin", "ARMATURE")
    modifier.object = armature
    mouth_details["realm_detail"] = "dark_mouth_interior_and_canines"
    return mouth_details, {
        "mesh": mouth_details.name,
        "vertices": len(vertices),
        "triangles": sum(len(face) - 2 for face in faces),
        "materials": [mouth_material.name, tooth_material.name],
        "skinBones": ["Head", "Jaw"],
        "canineCount": 4,
        "placement": (
            "inside closed muzzle; dark cavity and canine teeth are revealed "
            "by lower-jaw opening"
        ),
    }


def prepare_actions(armature: bpy.types.Object) -> dict[str, object]:
    retained: set[bpy.types.Action] = set()
    mapping: dict[str, str] = {}
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise RuntimeError(f"Quaternius Wolf donor has no action {source}")
        mapping[target] = source
        action.name = target
        action.use_fake_user = True
        retained.add(action)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    baked_keyframes = 0
    for name in REQUIRED_ACTIONS:
        action = bpy.data.actions[name]
        armature.animation_data.action = action
        start = int(action.frame_range[0])
        end = int(action.frame_range[1])
        bpy.ops.nla.bake(
            frame_start=start,
            frame_end=end,
            only_selected=True,
            visual_keying=True,
            clear_constraints=False,
            clear_parents=False,
            use_current_action=True,
            bake_types={"POSE"},
            channel_types={
                "LOCATION",
                "ROTATION",
                "SCALE",
                "BBONE",
                "PROPS",
            },
        )
        baked_keyframes += (end - start + 1) * len(armature.pose.bones)
    bpy.ops.object.mode_set(mode="OBJECT")
    removed_constraints = 0
    for bone in armature.pose.bones:
        removed_constraints += len(bone.constraints)
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)
    armature.animation_data.action = bpy.data.actions["idle"]
    return {
        "sourceToRuntime": mapping,
        "runtimeRanges": {
            name: [
                round(value, 3)
                for value in bpy.data.actions[name].frame_range
            ]
            for name in REQUIRED_ACTIONS
        },
        "authoredMotion": (
            "Quaternius quadruped locomotion, attack, hit reaction and death"
        ),
        "visualBake": {
            "sampledPoseBoneFrames": baked_keyframes,
            "removedBlenderOnlyConstraints": removed_constraints,
            "purpose": (
                "preserve evaluated Quaternius IK motion in portable GLB "
                "bone channels"
            ),
        },
    }


def add_jaw_animation(armature: bpy.types.Object) -> dict[str, object]:
    jaw = armature.pose.bones.get("Jaw")
    if jaw is None:
        raise RuntimeError("Wolf rig has no Jaw pose bone")
    keys = {
        "idle": ((0, 0.0), (50, 0.015), (100, 0.0)),
        "walk": ((0, 0.0), (16, 0.025), (32, 0.0)),
        "run": ((0, 0.035), (8, 0.065), (17, 0.035)),
        "attack": (
            (0, 0.0),
            (8, 0.12),
            (14, 0.58),
            (22, 0.25),
            (30, 0.0),
            (40, 0.0),
        ),
        "hurt": ((0, 0.0), (5, 0.08), (12, 0.0), (20, 0.0)),
        "death": ((0, 0.0), (16, 0.04), (32, 0.08)),
    }
    for action_name, frames in keys.items():
        action = bpy.data.actions[action_name]
        for curve in list(action.fcurves):
            if curve.data_path.startswith('pose.bones["Jaw"]'):
                action.fcurves.remove(curve)
        armature.animation_data.action = action
        for frame, angle in frames:
            jaw.rotation_mode = "QUATERNION"
            jaw.rotation_quaternion = Quaternion(
                Vector((1.0, 0.0, 0.0)),
                angle,
            )
            jaw.keyframe_insert(
                "rotation_quaternion",
                frame=frame,
                group="Jaw",
            )
        for curve in action.fcurves:
            if curve.data_path.startswith('pose.bones["Jaw"]'):
                for point in curve.keyframe_points:
                    point.interpolation = "BEZIER"
                    point.handle_left_type = "AUTO_CLAMPED"
                    point.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = bpy.data.actions["idle"]
    return {
        "axis": "local +X opens lower jaw",
        "attackMaximumRadians": 0.58,
        "attackMaximumDegrees": round(0.58 * 180.0 / pi, 2),
        "keyframes": {
            action: [[frame, angle] for frame, angle in frames]
            for action, frames in keys.items()
        },
    }


def export_candidate(
    output: Path,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    body: bpy.types.Object,
    mouth_interior: bpy.types.Object,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.select_set(True)
    armature.select_set(True)
    body.select_set(True)
    mouth_interior.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Quaternius Ultimate Animated Animals / Wolf topology, rig and "
            "base animations: CC0 1.0. Realm of Ashes B+C materials: "
            "project work."
        ),
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_force_sampling=True,
        export_def_bones=True,
        export_leaf_bone=False,
        export_armature_object_remove=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {output}: {result}")


def main() -> None:
    args = parse_args()
    approved_review_sha = validate_sha256(args.runtime_approved_sha)
    runtime_mode = bool(approved_review_sha)
    donor_hash = hashlib.sha256(args.source_blend.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(
            f"Unexpected Quaternius donor hash {donor_hash}; "
            f"expected {DONOR_SHA256}"
        )

    if (
        not bpy.data.filepath
        or Path(bpy.data.filepath).resolve() != args.source_blend.resolve()
    ):
        bpy.ops.wm.open_mainfile(filepath=str(args.source_blend.resolve()))
    body = bpy.data.objects.get("Wolf")
    armature = bpy.data.objects.get("AnimalArmature")
    if body is None or armature is None:
        raise RuntimeError(
            "Quaternius donor must contain Wolf mesh and AnimalArmature"
        )
    if body.type != "MESH" or armature.type != "ARMATURE":
        raise RuntimeError("Quaternius Wolf donor objects have unexpected types")

    materials = {
        "fur": pbr_material(
            "ash_wolf_weathered_graphite_fur",
            (0.255, 0.265, 0.245),
            0.94,
            normal_strength=0.24,
        ),
        "underfur": pbr_material(
            "ash_wolf_dusty_ochre_underfur",
            (0.465, 0.335, 0.205),
            0.92,
            normal_strength=0.18,
        ),
        "dust": pbr_material(
            "ash_wolf_pale_contact_dust",
            (0.405, 0.350, 0.275),
            0.97,
            normal_strength=0.14,
        ),
        "charcoal": pbr_material(
            "ash_wolf_charcoal_nose_ears_tail",
            (0.065, 0.070, 0.065),
            0.86,
            normal_strength=0.10,
        ),
        "eyes": pbr_material(
            "ash_wolf_dull_amber_eyes",
            (0.715, 0.355, 0.060),
            0.64,
            normal_strength=0.06,
        ),
        "mouth": pbr_material(
            "ash_wolf_dark_mouth_interior",
            (0.035, 0.012, 0.010),
            0.90,
            normal_strength=0.04,
        ),
        "teeth": pbr_material(
            "ash_wolf_dusty_bone_teeth",
            (0.560, 0.470, 0.330),
            0.91,
            normal_strength=0.05,
        ),
    }
    jaw_rig_report = add_deforming_jaw(body, armature)
    material_report = rematerialize_body(body, materials)
    mouth_interior, mouth_report = add_mouth_interior(
        armature,
        materials["mouth"],
        materials["teeth"],
    )
    skin_report = limit_skin_influences(body)
    action_report = prepare_actions(armature)
    jaw_animation_report = add_jaw_animation(armature)

    body.name = "ash_wolf_quaternius_continuous_body"
    body.data.name = "ash_wolf_quaternius_continuous_body_mesh"
    armature.name = "ash_wolf_quaternius_rig"
    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.scene.collection.objects.link(root)
    armature.parent = root
    root.scale = RUNTIME_ROOT_SCALE if runtime_mode else ROOT_SCALE
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_species"] = "ash_wolf"
    root["realm_geometry_provenance"] = (
        "Quaternius Wolf single-component organic topology"
    )
    root["realm_donor_sha256"] = donor_hash
    if runtime_mode:
        root["realm_approved_review_sha256"] = approved_review_sha
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
        root["realm_runtime_scale_compensation"] = (
            "component_square_root_for_threejs_skinned_bounds"
        )
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_source_mapping"] = json.dumps(
        SOURCE_ACTIONS,
        sort_keys=True,
    )

    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds([body])
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    ground_report = apply_ground_contact_corrections(
        armature,
        [body],
        root,
    )
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds([body])
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, root, armature, body, mouth_interior)
    actual = parse_glb(args.output)
    missing_actions = sorted(set(REQUIRED_ACTIONS) - set(actual["animations"]))
    if missing_actions:
        raise RuntimeError(f"Wolf export is missing actions: {missing_actions}")
    if actual["skins"] != 1 or actual["skinJointCounts"] != [52]:
        raise RuntimeError(
            "Wolf must export one 52-joint augmented Quaternius skin; "
            f"got {actual['skins']} skins and {actual['skinJointCounts']} joints"
        )
    components = connected_component_count(body)
    if components != 1:
        raise RuntimeError(
            f"Primary wolf body must remain connected; got {components}"
        )

    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "boundsIdleMetres": {
            "minimum": [round(value, 6) for value in minimum],
            "maximum": [round(value, 6) for value in maximum],
            "size": [round(value, 6) for value in size],
        },
        "collider": {
            "type": "box",
            "size": [round(value, 6) for value in size],
            "center": [round(value, 6) for value in center],
        },
        "rig": {
            "armatures": 1,
            "boneCount": len(armature.data.bones),
            "bones": sorted(bone.name for bone in armature.data.bones),
        },
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "primaryBodyConnectedComponents": components,
            "primaryBodyTopology": (
                "unaltered Quaternius Wolf single-component organic topology"
            ),
            "sourceVertices": len(body.data.vertices),
            "sourceTriangles": sum(
                len(polygon.vertices) - 2 for polygon in body.data.polygons
            ),
            "flatShaded": all(
                not polygon.use_smooth for polygon in body.data.polygons
            ),
            "materialRemap": material_report,
            "skinInfluenceNormalization": skin_report,
            "deformingJaw": jaw_rig_report,
            "mouthInterior": mouth_report,
        },
        "actions": action_report,
        "jawAnimation": jaw_animation_report,
        "groundContactCorrections": {
            "actions": ground_report,
        },
        "provenance": {
            "donor": "Quaternius Ultimate Animated Animals / Wolf.blend",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "geometry": (
                "unaltered connected donor topology; no procedural replacement"
            ),
            "rig": (
                "Quaternius 51-bone quadruped rig plus one Realm weighted "
                "jaw bone"
            ),
            "animations": (
                "Quaternius Idle, Walk, Gallop, Attack, "
                "Idle_HitReact_Left and Death"
            ),
            "materials": (
                "original Realm of Ashes B+C packed 512 px PBR textures"
            ),
        },
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if runtime_mode:
        report["approvedReviewSha256"] = approved_review_sha
        report["runtimeScaleMultiplier"] = RUNTIME_SCALE_MULTIPLIER
        report["runtimeRootScale"] = [
            round(component, 9) for component in RUNTIME_ROOT_SCALE
        ]
        report["runtimeScaleCompensation"] = (
            "component_square_root_for_threejs_skinned_bounds"
        )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_QUATERNIUS_WOLF=" + json.dumps(
        report,
        ensure_ascii=False,
    ))


if __name__ == "__main__":
    main()
