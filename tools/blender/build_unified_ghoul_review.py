"""Build a connected B+C ghoul from the approved humanoid NPC topology.

The approved humanoid v5 asset already carries the current player anatomy,
65-joint rig and six complete actions.  This generator welds its imported
triangle islands back into one continuous body surface, removes human hair
and eyebrows, authors an emaciated ghoul anatomy, and replaces the human
palette with packed 512 px B+C materials.  Runtime export stays gated by a
separately approved review SHA.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import sin
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_humanoid_npc_review import (
    apply_baseline,
    apply_pose_offsets,
    capture_idle_baseline,
    clear_scene,
    evaluated_bounds,
    import_player,
    key_complete_pose,
    key_pose,
    parse_glb,
    reset_pose,
)


SOURCE_SHA256 = (
    "EAC5248C381FD457E93A04094DAC51FA22C60EDE138C88E00EEFBB3EB4E6091E"
)
REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
LIMB_FACTORS = {
    "neck_01": 0.74,
    "upperarm_l": 0.64,
    "upperarm_r": 0.64,
    "lowerarm_l": 0.62,
    "lowerarm_r": 0.62,
    "thigh_l": 0.78,
    "thigh_r": 0.78,
    "calf_l": 0.72,
    "calf_r": 0.72,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        "--source-blend",
        dest="source",
        type=Path,
        required=True,
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_ghoul_unified_v1")
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def validate_sha256(value: str | None) -> str:
    normalized = str(value or "").upper()
    if normalized and (
        len(normalized) != 64
        or any(character not in "0123456789ABCDEF" for character in normalized)
    ):
        raise RuntimeError(
            "--runtime-approved-sha must be a 64-character hexadecimal SHA-256"
        )
    return normalized


def connected_component_count(mesh: bpy.types.Mesh) -> int:
    adjacency = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    visited: set[int] = set()
    components = 0
    for start in range(len(adjacency)):
        if start in visited:
            continue
        components += 1
        visited.add(start)
        stack = [start]
        while stack:
            vertex = stack.pop()
            for neighbor in adjacency[vertex]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
    return components


def weld_body(body: bpy.types.Object) -> dict[str, int | float]:
    before = len(body.data.vertices)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.000001)
    bpy.ops.object.mode_set(mode="OBJECT")
    after = len(body.data.vertices)
    components = connected_component_count(body.data)
    if components != 1:
        raise RuntimeError(
            f"Ghoul body must be one connected surface; got {components}"
        )
    return {
        "verticesBefore": before,
        "verticesAfter": after,
        "mergedVertices": before - after,
        "thresholdMetres": 0.000001,
        "connectedComponents": components,
    }


def weight_map(
    vertex: bpy.types.MeshVertex,
    index_to_name: dict[int, str],
) -> dict[str, float]:
    return {
        index_to_name[group.group]: group.weight
        for group in vertex.groups
        if group.group in index_to_name and group.weight > 0.0001
    }


def closest_on_segment(
    point: Vector,
    start: Vector,
    end: Vector,
) -> Vector:
    segment = end - start
    denominator = segment.length_squared
    if denominator <= 1e-12:
        return start.copy()
    t = max(0.0, min(1.0, (point - start).dot(segment) / denominator))
    return start + segment * t


def bone_segment_in_mesh(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
) -> tuple[Vector, Vector]:
    bone = armature.data.bones[bone_name]
    transform = body.matrix_world.inverted() @ armature.matrix_world
    return transform @ bone.head_local, transform @ bone.tail_local


def reshape_body(
    body: bpy.types.Object,
    armature: bpy.types.Object,
) -> dict[str, object]:
    index_to_name = {
        group.index: group.name for group in body.vertex_groups
    }
    segments = {
        name: bone_segment_in_mesh(body, armature, name)
        for name in LIMB_FACTORS
    }
    changed = 0
    head_vertices = 0
    thinned_limb_vertices = 0
    torso_vertices = 0
    hunched_vertices = 0
    maximum_displacement = 0.0

    for vertex in body.data.vertices:
        original = vertex.co.copy()
        co = original.copy()
        weights = weight_map(vertex, index_to_name)

        # Thin long limb volumes around their actual Quaternius/player bone
        # axes.  Vertex weights feather the change through shoulders, elbows,
        # knees and ankles instead of creating hard procedural seams.
        for bone_name, factor in LIMB_FACTORS.items():
            influence = min(1.0, weights.get(bone_name, 0.0))
            if influence <= 0.03:
                continue
            start, end = segments[bone_name]
            anchor = closest_on_segment(co, start, end)
            target = anchor + (co - anchor) * factor
            co = co.lerp(target, influence)
            thinned_limb_vertices += 1

        torso_influence = min(
            1.0,
            sum(
                weights.get(name, 0.0)
                for name in ("pelvis", "spine_01", "spine_02", "spine_03")
            ),
        )
        if torso_influence > 0.03:
            # Narrow the waist and flatten the abdominal depth while keeping
            # the ribcage and shoulder girdle readable.
            waist = max(0.0, min(1.0, (1.34 - co.z) / 0.45))
            target = co.copy()
            target.x *= 1.0 - torso_influence * (0.115 + waist * 0.080)
            target.y *= 1.0 - torso_influence * (0.18 + waist * 0.11)
            # Collapse the upper rib cage into a narrower, flatter wedge.
            # This changes the 112 px silhouette instead of relying on skin
            # colour or surface damage to communicate the mutation.
            chest_band = max(
                0.0,
                1.0 - abs(target.z - 1.355) / 0.205,
            )
            target.x *= 1.0 - torso_influence * chest_band * 0.17
            target.y *= 1.0 - torso_influence * chest_band * 0.24
            co = co.lerp(target, torso_influence)
            torso_vertices += 1

        # Permanently break the human neck-to-chest axis.  Head, neck,
        # upper spine and shoulder attachments move forward with feathered
        # skin weights, keeping the body continuous under every animation.
        hunch = (
            weights.get("spine_02", 0.0) * 0.026
            + weights.get("spine_03", 0.0) * 0.062
            + weights.get("neck_01", 0.0) * 0.098
            + weights.get("head", 0.0) * 0.118
            + (
                weights.get("clavicle_l", 0.0)
                + weights.get("clavicle_r", 0.0)
                + weights.get("upperarm_l", 0.0) * 0.35
                + weights.get("upperarm_r", 0.0) * 0.35
            ) * 0.046
        )
        if hunch > 0.001:
            co.y -= hunch
            left_shoulder = min(
                1.0,
                weights.get("clavicle_l", 0.0)
                + weights.get("upperarm_l", 0.0),
            )
            right_shoulder = min(
                1.0,
                weights.get("clavicle_r", 0.0)
                + weights.get("upperarm_r", 0.0),
            )
            co.z += left_shoulder * 0.012 - right_shoulder * 0.022
            co.x *= 1.0 - min(1.0, left_shoulder + right_shoulder) * 0.11
            hunched_vertices += 1

        head_influence = min(1.0, weights.get("head", 0.0))
        if head_influence > 0.03:
            target = co.copy()
            # Narrow temples and lengthen the cranium without turning the
            # head into a separate caricatured primitive.
            target.x *= 1.0 - 0.22 * head_influence
            if target.z > 1.72:
                target.z += 0.038 * head_influence

            front = max(0.0, min(1.0, (-target.y - 0.025) / 0.085))
            cheek_band = max(
                0.0,
                1.0 - abs(target.z - 1.665) / 0.075,
            )
            cheek_side = max(
                0.0,
                min(1.0, (abs(target.x) - 0.022) / 0.055),
            )
            # Sink the malar area and flatten the nose bridge.
            target.y += (
                0.032
                * front
                * cheek_band
                * cheek_side
                * head_influence
            )
            if abs(target.x) < 0.030 and 1.655 < target.z < 1.735:
                target.y += 0.036 * front * head_influence
            # Radiation collapse pulls the outer ear cartilage toward the
            # skull while preserving the approved connected head surface.
            ear_band = max(
                0.0,
                1.0 - abs(target.z - 1.665) / 0.070,
            )
            if abs(target.x) > 0.070:
                target.x *= 1.0 - 0.13 * ear_band * head_influence
            # A modest forward lower jaw preserves a threatening profile
            # while the closed mouth still deforms on the original rig.
            jaw_band = max(
                0.0,
                1.0 - abs(target.z - 1.605) / 0.055,
            )
            if target.y < -0.025:
                target.y -= 0.043 * jaw_band * head_influence
                target.z -= 0.014 * jaw_band * head_influence
            co = co.lerp(target, head_influence)
            head_vertices += 1

        # Small deterministic asymmetry breaks the pristine character-editor
        # symmetry without adding noisy displacement or loose detail meshes.
        if 1.18 < co.z < 1.58:
            asymmetry = sin(co.z * 31.0 + co.y * 17.0) * 0.0022
            co.x += asymmetry * (0.35 + abs(co.x))

        displacement = (co - original).length
        if displacement > 1e-7:
            vertex.co = co
            changed += 1
            maximum_displacement = max(maximum_displacement, displacement)

    body.data.update()
    return {
        "changedVertices": changed,
        "headVertices": head_vertices,
        "thinnedLimbInfluences": thinned_limb_vertices,
        "torsoVertices": torso_vertices,
        "hunchedSilhouetteVertices": hunched_vertices,
        "maximumDisplacementMetres": round(maximum_displacement, 6),
        "policy": (
            "weight-feathered radial limb thinning, collapsed rib cage, "
            "permanent predatory hunch, asymmetric shoulders, sunken "
            "cheeks, collapsed nose and prognathic jaw"
        ),
    }


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "skin": pbr_material(
            "ghoul_desiccated_olive_skin",
            (0.245, 0.255, 0.195),
            0.94,
            normal_strength=0.20,
        ),
        "ash": pbr_material(
            "ghoul_ashen_dead_tissue",
            (0.205, 0.215, 0.170),
            0.97,
            normal_strength=0.18,
        ),
        "necrosis": pbr_material(
            "ghoul_muted_necrotic_tissue",
            (0.225, 0.185, 0.135),
            0.93,
            normal_strength=0.16,
        ),
        "scar": pbr_material(
            "ghoul_healed_radiation_scars",
            (0.235, 0.180, 0.140),
            0.91,
            normal_strength=0.14,
        ),
        "cloth": pbr_material(
            "ghoul_charcoal_underwear",
            (0.055, 0.052, 0.045),
            0.98,
            normal_strength=0.11,
        ),
        "nail": pbr_material(
            "ghoul_brittle_nails",
            (0.315, 0.300, 0.205),
            0.86,
            normal_strength=0.08,
        ),
        "eye": pbr_material(
            "ghoul_clouded_amber_eyes",
            (0.240, 0.245, 0.190),
            0.84,
            normal_strength=0.03,
        ),
    }


def assign_body_materials(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> dict[str, int]:
    def ragged_ellipsoid(
        point: Vector,
        origin: tuple[float, float, float],
        radii: tuple[float, float, float],
    ) -> bool:
        normalized = sum(
            ((point[axis] - origin[axis]) / radii[axis]) ** 2
            for axis in range(3)
        )
        if normalized <= 0.76:
            return True
        if normalized >= 1.08:
            return False
        edge_noise = sin(
            point.x * 91.0
            + point.y * 73.0
            + point.z * 47.0
        )
        return normalized < 0.91 + edge_noise * 0.14

    body.data.materials.clear()
    order = ("skin", "ash", "necrosis", "scar", "cloth", "nail")
    for key in order:
        body.data.materials.append(materials[key])
    counts = {key: 0 for key in order}
    for polygon in body.data.polygons:
        center = sum(
            (body.data.vertices[index].co for index in polygon.vertices),
            Vector(),
        ) / len(polygon.vertices)
        key = "skin"
        # Briefs remain a real base-state layer, not baked role armour.
        if 0.86 < center.z < 1.115 and abs(center.x) < 0.275:
            key = "cloth"
        elif (
            (center.z < 0.045 and center.y < -0.065)
            or (abs(center.x) > 0.812 and center.y < -0.015)
        ):
            key = "nail"
        elif ragged_ellipsoid(
            center,
            (-0.048, -0.075, 1.665),
            (0.018, 0.028, 0.034),
        ):
            key = "scar"
        elif any(
            ragged_ellipsoid(center, origin, radii)
            for origin, radii in (
                ((0.175, -0.005, 1.405), (0.068, 0.090, 0.082)),
                ((-0.115, -0.010, 0.480), (0.048, 0.072, 0.100)),
            )
        ):
            key = "ash"
        elif any(
            ragged_ellipsoid(center, origin, radii)
            for origin, radii in (
                ((0.110, -0.015, 0.660), (0.045, 0.068, 0.070)),
                ((-0.105, -0.030, 1.180), (0.043, 0.060, 0.062)),
            )
        ):
            key = "necrosis"
        polygon.material_index = order.index(key)
        polygon.use_smooth = False
        counts[key] += 1
    return counts


def create_ghoul_attack_action(armature: bpy.types.Object) -> dict[str, object]:
    """Replace the human punch with a complete two-handed ghoul lunge."""
    baseline = capture_idle_baseline(armature)

    def capture_action_pose(
        action_name: str,
        frame: float,
    ) -> dict[str, dict[str, object]]:
        action = bpy.data.actions.get(action_name)
        if action is None:
            raise RuntimeError(
                f"Ghoul attack needs source action {action_name}"
            )
        armature.animation_data_create()
        armature.animation_data.action = action
        bpy.context.scene.frame_set(round(frame))
        bpy.context.view_layer.update()
        pose = {}
        for bone in armature.pose.bones:
            bone.rotation_mode = "QUATERNION"
            pose[bone.name] = {
                "location": bone.location.copy(),
                "rotation": bone.rotation_quaternion.copy(),
                "scale": bone.scale.copy(),
            }
        armature.animation_data.action = None
        return pose

    lunge_baseline = capture_action_pose("run", 1.0)
    existing = bpy.data.actions.get("attack")
    if existing is not None:
        bpy.data.actions.remove(existing)
    action = bpy.data.actions.new("attack")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    bone_names = tuple(sorted(baseline))
    neutral = {
        "root": {"location": (0.0, 0.0, 0.0)},
        "spine_02": {"rotation": (0.0, 0.0, 0.0)},
        "spine_03": {"rotation": (0.0, 0.0, 0.0)},
        "head": {"rotation": (0.0, 0.0, 0.0)},
        "clavicle_l": {"rotation": (0.0, 0.0, 0.0)},
        "clavicle_r": {"rotation": (0.0, 0.0, 0.0)},
        "upperarm_l": {"rotation": (0.0, 0.0, 0.0)},
        "upperarm_r": {"rotation": (0.0, 0.0, 0.0)},
        "lowerarm_l": {"rotation": (0.0, 0.0, 0.0)},
        "lowerarm_r": {"rotation": (0.0, 0.0, 0.0)},
    }

    def solve_arm(
        side: str,
        frame: int,
        wrist: tuple[float, float, float],
        pole: tuple[float, float, float],
    ) -> None:
        target = bpy.data.objects.new(
            f"ghoul_attack_wrist_{side}_{frame}",
            None,
        )
        pole_target = bpy.data.objects.new(
            f"ghoul_attack_elbow_{side}_{frame}",
            None,
        )
        bpy.context.scene.collection.objects.link(target)
        bpy.context.scene.collection.objects.link(pole_target)
        target.location = armature.matrix_world @ Vector(wrist)
        pole_target.location = armature.matrix_world @ Vector(pole)
        forearm = armature.pose.bones[f"lowerarm_{side}"]
        constraint = forearm.constraints.new("IK")
        constraint.name = f"ghoul_attack_ik_{side}"
        constraint.target = target
        constraint.pole_target = pole_target
        constraint.chain_count = 2
        constraint.use_tail = True
        bpy.context.view_layer.update()
        upper_matrix = armature.pose.bones[f"upperarm_{side}"].matrix.copy()
        lower_matrix = forearm.matrix.copy()
        forearm.constraints.remove(constraint)
        bpy.data.objects.remove(target, do_unlink=True)
        bpy.data.objects.remove(pole_target, do_unlink=True)
        bpy.context.view_layer.update()
        armature.pose.bones[f"upperarm_{side}"].matrix = upper_matrix
        bpy.context.view_layer.update()
        forearm.matrix = lower_matrix
        bpy.context.view_layer.update()

    def pose_claws(curl: float, spread: float) -> None:
        for side, mirror in (("l", 1.0), ("r", -1.0)):
            for finger_index, finger in enumerate(
                ("index", "middle", "ring", "pinky")
            ):
                fan = (
                    finger_index - 1.5
                ) * spread * mirror
                for joint, joint_factor in ((1, 0.72), (2, 1.0), (3, 0.82)):
                    bone_name = f"{finger}_{joint:02d}_{side}"
                    bone = armature.pose.bones[bone_name]
                    offset = Quaternion(
                        Vector((1.0, 0.0, 0.0)),
                        curl * joint_factor,
                    )
                    if joint == 1:
                        offset = (
                            Quaternion(
                                Vector((0.0, 0.0, 1.0)),
                                fan,
                            )
                            @ offset
                        )
                    bone.rotation_mode = "QUATERNION"
                    bone.rotation_quaternion = offset
            thumb_name = f"thumb_01_{side}"
            thumb = armature.pose.bones[thumb_name]
            thumb.rotation_mode = "QUATERNION"
            thumb.rotation_quaternion = Quaternion(
                Vector((0.0, 1.0, 0.0)),
                0.32 * mirror,
            )

    key_pose(armature, 1, neutral, bone_names, baseline)
    for frame, pose_baseline, torso_pose, wrists, claw_pose in (
        (
            6,
            baseline,
            {
                "root": {"location": (0.0, 0.018, 0.0)},
                "spine_02": {"rotation": (0.07, -0.03, -0.09)},
                "spine_03": {"rotation": (0.10, -0.05, -0.13)},
                "head": {"rotation": (-0.05, 0.03, 0.10)},
            },
            {
                "l": ((0.34, -0.26, 1.43), (0.68, -0.20, 1.22)),
                "r": ((-0.34, -0.26, 1.43), (-0.68, -0.20, 1.22)),
            },
            (-0.16, 0.08),
        ),
        (
            11,
            lunge_baseline,
            {
                "root": {"location": (0.0, -0.025, 0.022)},
                "spine_02": {"rotation": (-0.06, 0.01, 0.03)},
                "spine_03": {"rotation": (-0.10, 0.02, 0.05)},
                "head": {"rotation": (0.08, -0.02, -0.04)},
            },
            {
                "l": ((0.27, -0.70, 1.48), (0.70, -0.23, 1.20)),
                "r": ((-0.27, -0.70, 1.35), (-0.70, -0.23, 1.20)),
            },
            (-0.12, 0.17),
        ),
        (
            14,
            baseline,
            {
                "root": {"location": (0.0, -0.035, 0.0)},
                "spine_02": {"rotation": (-0.08, -0.03, 0.11)},
                "spine_03": {"rotation": (-0.12, -0.05, 0.17)},
                "head": {"rotation": (0.09, 0.03, -0.13)},
            },
            {
                "l": ((0.34, -0.66, 1.24), (0.70, -0.23, 1.18)),
                "r": ((-0.20, -0.79, 1.52), (-0.70, -0.23, 1.22)),
            },
            (-0.20, 0.15),
        ),
    ):
        bpy.context.scene.frame_set(frame)
        apply_baseline(armature, pose_baseline)
        apply_pose_offsets(armature, torso_pose, pose_baseline)
        bpy.context.view_layer.update()
        for side in ("l", "r"):
            wrist, pole = wrists[side]
            solve_arm(side, frame, wrist, pole)
        pose_claws(*claw_pose)
        key_complete_pose(armature, frame, bone_names)
    key_pose(armature, 22, neutral, bone_names, baseline)

    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    action.frame_start = 1
    action.frame_end = 22
    armature.animation_data.action = None
    reset_pose(armature)
    return {
        "style": "two-handed predatory lunge and asymmetric rake",
        "frames": [1, 6, 11, 14, 22],
        "fullyKeyedBones": len(bone_names),
        "channels": len(action.fcurves),
        "fingerPose": "open separated claws with articulated phalanges",
    }


def configure_eyes(
    eyes: bpy.types.Object,
    material: bpy.types.Material,
) -> None:
    eyes.data.materials.clear()
    eyes.data.materials.append(material)
    for polygon in eyes.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = False


def configure_asset(
    armature: bpy.types.Object,
    body: bpy.types.Object,
    eyes: bpy.types.Object,
    asset_id: str,
    approved_review_sha: str,
) -> None:
    runtime_mode = bool(approved_review_sha)
    armature.name = "ghoul_full_humanoid_rig"
    body.name = "ghoul_connected_emaciated_body"
    body.data.name = "ghoul_connected_emaciated_body_mesh"
    eyes.name = "ghoul_clouded_eyes"
    eyes.data.name = "ghoul_clouded_eyes_mesh"
    armature["realm_schema"] = "realm.unified-creature-review.v1"
    armature["realm_asset_id"] = asset_id
    armature["realm_category"] = "humanoid"
    armature["realm_species"] = "ghoul"
    armature["realm_style"] = "geometry_b_materials_c"
    armature["realm_shared_player_topology"] = True
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_underwear_included"] = True
    armature["realm_barefoot"] = True
    armature["realm_no_equipment"] = True
    armature["realm_review_only"] = not runtime_mode
    armature["realm_runtime_integration_allowed"] = runtime_mode
    if runtime_mode:
        armature["realm_approved_review_sha256"] = approved_review_sha
        armature["realm_runtime_scale_multiplier"] = 1.0
    for obj in (body, eyes):
        obj.parent = armature
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = armature


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    meshes: tuple[bpy.types.Object, ...],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Realm of Ashes B+C ghoul. Humanoid topology, rig and base "
            "motion derive from the approved Quaternius-based player system; "
            "ghoul anatomy, materials and review pipeline are project work."
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
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest().upper()
    if source_hash != SOURCE_SHA256:
        raise RuntimeError(
            f"Unexpected humanoid v5 hash {source_hash}; "
            f"expected {SOURCE_SHA256}"
        )
    clear_scene()
    # GLB animation time is mapped onto the current Blender scene FPS during
    # import.  Pin the scene explicitly so an interactive review build and a
    # clean background rebuild sample identical poses and export the same GLB.
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 0
    scene.frame_end = 250
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    # Review builds may be launched inside an already open Blender donor
    # scene.  Imported GLB actions carry fake users, so remove them explicitly
    # instead of letting the next import create attack.001/death.001 copies.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    armature, imported_meshes = import_player(args.source)
    body = next(
        (obj for obj in imported_meshes if obj.name.startswith("body_base")),
        None,
    )
    eyes = next(
        (obj for obj in imported_meshes if "face_eyes" in obj.name),
        None,
    )
    if body is None or eyes is None:
        raise RuntimeError("Approved humanoid source has no body or eyes")
    for obj in list(imported_meshes):
        if obj not in (body, eyes):
            bpy.data.objects.remove(obj, do_unlink=True)

    weld_report = weld_body(body)
    reshape_report = reshape_body(body, armature)
    materials = create_materials()
    material_counts = assign_body_materials(body, materials)
    configure_eyes(eyes, materials["eye"])
    attack_report = create_ghoul_attack_action(armature)
    configure_asset(
        armature,
        body,
        eyes,
        args.asset_id,
        approved_review_sha,
    )
    missing = sorted(
        set(REQUIRED_ACTIONS)
        - {action.name.lower() for action in bpy.data.actions}
    )
    if missing:
        raise RuntimeError(f"Ghoul source is missing actions: {missing}")

    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds([body, eyes])
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    armature["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, armature, (body, eyes))
    actual = parse_glb(args.output)
    if actual["skins"] != 1 or actual["skinJointCounts"] != [65]:
        raise RuntimeError(
            "Ghoul must export one 65-joint humanoid skin; "
            f"got {actual['skins']} skins and {actual['skinJointCounts']} joints"
        )
    if sorted(name.lower() for name in actual["animations"]) != sorted(
        REQUIRED_ACTIONS
    ):
        raise RuntimeError(
            f"Ghoul action set changed: {actual['animations']}"
        )

    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "source": args.source.name,
        "sourceSha256": source_hash,
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
            "bodyTopology": weld_report,
            "anatomicalReshape": reshape_report,
            "bodyPolygons": len(body.data.polygons),
            "flatShaded": all(
                not polygon.use_smooth for polygon in body.data.polygons
            ),
            "removedHumanLayers": ["face_eyebrows", "hair_short_crop"],
        },
        "combatAnimation": attack_report,
        "materials": {
            "bodyMaterialPolygonCounts": material_counts,
            "materialCount": len(materials),
            "textureResolution": [512, 512],
            "policy": (
                "desiccated olive skin, ashen tissue, muted necrosis, "
                "localized scars, charcoal underwear, brittle nails and "
                "clouded amber eyes"
            ),
        },
        "provenance": {
            "base": "approved humanoid NPC v5 / current player anatomy",
            "baseLicense": "Quaternius CC0-1.0 plus Realm adaptations",
            "geometry": (
                "welded approved humanoid body with weight-feathered "
                "project-authored ghoul anatomy"
            ),
            "rigAndAnimations": (
                "approved 65-joint humanoid skin and six v5 actions"
            ),
            "externalDonorBeyondApprovedHumanoid": None,
        },
        "reviewOnly": not bool(approved_review_sha),
        "runtimeIntegrationAllowed": bool(approved_review_sha),
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if approved_review_sha:
        report["approvedReviewSha256"] = approved_review_sha
        report["runtimeScaleMultiplier"] = 1.0
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_GHOUL=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
