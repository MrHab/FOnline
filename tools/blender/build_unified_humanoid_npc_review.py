"""Build a humanoid NPC golden master from the exact current player system.

Human NPCs must not be a second, blockier species.  This review asset therefore
reuses the approved player topology, materials, 65-bone rig and locomotion
clips.  Only NPC metadata and missing combat reactions are authored here.
Equipment remains a separate inventory-driven layer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Euler, Vector


COMBAT_ACTIONS = ("attack", "hurt", "death")
REQUIRED_ACTIONS = ("idle", "walk", "run", "turn", *COMBAT_ACTIONS)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--asset-id", default="npc_humanoid_base_unified_v1")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def remove_import_helpers() -> None:
    helpers = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.name.startswith("Icosphere")
        and not obj.vertex_groups
        and not obj.data.materials
    ]
    for helper in helpers:
        bpy.data.objects.remove(helper, do_unlink=True)


def import_player(source: Path) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    result = bpy.ops.import_scene.gltf(
        filepath=str(source.resolve()),
        import_shading="NORMALS",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot import player base: {source}")
    remove_import_helpers()
    armatures = [
        obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"
    ]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one player armature, found {len(armatures)}")
    if not meshes:
        raise RuntimeError("Player base contains no visible meshes")
    return armatures[0], meshes


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.matrix_basis.identity()
        bone.rotation_mode = "QUATERNION"


def apply_baseline(
    armature: bpy.types.Object,
    baseline: dict[str, dict[str, object]],
) -> None:
    for bone_name, base in baseline.items():
        bone = armature.pose.bones[bone_name]
        bone.location = base["location"]
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = base["rotation"]
        bone.scale = base["scale"]


def apply_pose_offsets(
    armature: bpy.types.Object,
    pose: dict[str, dict[str, tuple[float, float, float]]],
    baseline: dict[str, dict[str, object]],
) -> None:
    for bone_name, transform in pose.items():
        bone = armature.pose.bones[bone_name]
        base = baseline[bone_name]
        if "location" in transform:
            bone.location = base["location"] + Vector(transform["location"])
        if "rotation" in transform:
            offset = Euler(
                transform["rotation"],
                "XYZ",
            ).to_quaternion()
            bone.rotation_quaternion = base["rotation"] @ offset


def key_complete_pose(
    armature: bpy.types.Object,
    frame: int,
    bone_names: tuple[str, ...],
) -> None:
    for bone_name in bone_names:
        bone = armature.pose.bones[bone_name]
        bone.keyframe_insert("location", frame=frame, group=bone_name)
        bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone_name)
        bone.keyframe_insert("scale", frame=frame, group=bone_name)


def key_pose(
    armature: bpy.types.Object,
    frame: int,
    pose: dict[str, dict[str, tuple[float, float, float]]],
    keyed_bones: tuple[str, ...],
    baseline: dict[str, dict[str, object]],
) -> None:
    apply_baseline(armature, baseline)
    apply_pose_offsets(armature, pose, baseline)
    key_complete_pose(armature, frame, keyed_bones)


def create_action(
    armature: bpy.types.Object,
    name: str,
    frames: tuple[
        tuple[int, dict[str, dict[str, tuple[float, float, float]]]],
        ...,
    ],
    baseline: dict[str, dict[str, object]],
) -> None:
    existing = bpy.data.actions.get(name)
    if existing is not None:
        bpy.data.actions.remove(existing)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    # Key the complete 65-bone idle baseline. Otherwise unmentioned fingers
    # snap to the open bind pose during NPC-only actions.
    keyed_bones = tuple(sorted(baseline))
    for frame, pose in frames:
        key_pose(armature, frame, pose, keyed_bones, baseline)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    action.frame_start = frames[0][0]
    action.frame_end = frames[-1][0]
    armature.animation_data.action = None
    reset_pose(armature)


def create_attack_action(
    armature: bpy.types.Object,
    baseline: dict[str, dict[str, object]],
    neutral: dict[str, dict[str, tuple[float, float, float]]],
) -> None:
    existing = bpy.data.actions.get("attack")
    if existing is not None:
        bpy.data.actions.remove(existing)
    action = bpy.data.actions.new("attack")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    bone_names = tuple(sorted(baseline))

    key_pose(armature, 1, neutral, bone_names, baseline)
    key_pose(armature, 20, neutral, bone_names, baseline)

    for frame, torso_pose, wrist, pole in (
        (
            6,
            {
                "spine_02": {"rotation": (0.02, -0.03, -0.13)},
                "spine_03": {"rotation": (0.04, -0.04, -0.15)},
                "head": {"rotation": (-0.02, 0.02, 0.08)},
                "upperarm_l": {"rotation": (0.05, 0.0, -0.08)},
            },
            (-0.22, -0.20, 1.43),
            (-0.72, -0.18, 1.30),
        ),
        (
            11,
            {
                "root": {"location": (0.0, -0.055, 0.0)},
                "spine_02": {"rotation": (-0.05, 0.04, 0.17)},
                "spine_03": {"rotation": (-0.10, 0.06, 0.24)},
                "head": {"rotation": (0.03, -0.02, -0.10)},
                "upperarm_l": {"rotation": (-0.08, 0.02, 0.10)},
            },
            (-0.16, -0.68, 1.38),
            (-0.66, -0.34, 1.28),
        ),
    ):
        apply_baseline(armature, baseline)
        apply_pose_offsets(armature, torso_pose, baseline)
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()

        target = bpy.data.objects.new(f"attack_wrist_target_{frame}", None)
        pole_target = bpy.data.objects.new(f"attack_elbow_pole_{frame}", None)
        bpy.context.scene.collection.objects.link(target)
        bpy.context.scene.collection.objects.link(pole_target)
        target.location = armature.matrix_world @ Vector(wrist)
        pole_target.location = armature.matrix_world @ Vector(pole)

        forearm = armature.pose.bones["lowerarm_r"]
        constraint = forearm.constraints.new("IK")
        constraint.name = "review_attack_ik"
        constraint.target = target
        constraint.pole_target = pole_target
        constraint.chain_count = 2
        constraint.use_tail = True
        bpy.context.view_layer.update()

        upper_matrix = armature.pose.bones["upperarm_r"].matrix.copy()
        lower_matrix = armature.pose.bones["lowerarm_r"].matrix.copy()
        forearm.constraints.remove(constraint)
        bpy.data.objects.remove(target, do_unlink=True)
        bpy.data.objects.remove(pole_target, do_unlink=True)
        bpy.context.view_layer.update()
        armature.pose.bones["upperarm_r"].matrix = upper_matrix
        bpy.context.view_layer.update()
        armature.pose.bones["lowerarm_r"].matrix = lower_matrix
        bpy.context.view_layer.update()
        key_complete_pose(armature, frame, bone_names)

    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    action.frame_start = 1
    action.frame_end = 20
    armature.animation_data.action = None
    reset_pose(armature)


def pin_death_limb_contacts(
    armature: bpy.types.Object,
    frame: int = 38,
    clearance: float = 0.025,
) -> None:
    """Bake relaxed final hand/foot contacts instead of leaving limbs airborne."""
    action = bpy.data.actions.get("death")
    if action is None:
        raise RuntimeError("Cannot pin contacts without the death action")
    armature.animation_data_create()
    armature.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()

    for parent_name, effector_name in (
        ("upperarm_l", "lowerarm_l"),
        ("upperarm_r", "lowerarm_r"),
        ("thigh_l", "calf_l"),
        ("thigh_r", "calf_r"),
    ):
        parent = armature.pose.bones[parent_name]
        effector = armature.pose.bones[effector_name]
        current_tail = armature.matrix_world @ effector.tail
        target = bpy.data.objects.new(f"death_contact_{effector_name}", None)
        bpy.context.scene.collection.objects.link(target)
        target.location = Vector((current_tail.x, current_tail.y, clearance))

        constraint = effector.constraints.new("IK")
        constraint.name = "death_ground_contact_ik"
        constraint.target = target
        constraint.chain_count = 2
        constraint.use_tail = True
        bpy.context.view_layer.update()

        parent_matrix = parent.matrix.copy()
        effector_matrix = effector.matrix.copy()
        effector.constraints.remove(constraint)
        bpy.data.objects.remove(target, do_unlink=True)
        bpy.context.view_layer.update()
        parent.matrix = parent_matrix
        bpy.context.view_layer.update()
        effector.matrix = effector_matrix
        bpy.context.view_layer.update()
        for bone in (parent, effector):
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
            bone.keyframe_insert("scale", frame=frame, group=bone.name)

    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = None
    reset_pose(armature)


def capture_idle_baseline(
    armature: bpy.types.Object,
) -> dict[str, dict[str, object]]:
    idle = bpy.data.actions.get("idle")
    if idle is None:
        raise RuntimeError("Approved player base has no idle action")
    armature.animation_data_create()
    armature.animation_data.action = idle
    frame = round((idle.frame_range[0] + idle.frame_range[1]) * 0.5)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    baseline = {}
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        baseline[bone.name] = {
            "location": bone.location.copy(),
            "rotation": bone.rotation_quaternion.copy(),
            "scale": bone.scale.copy(),
        }
    armature.animation_data.action = None
    return baseline


def create_turn_action(
    armature: bpy.types.Object,
    baseline: dict[str, dict[str, object]],
    neutral: dict[str, dict[str, tuple[float, float, float]]],
) -> None:
    """Переступание на месте для разворота корпуса.

    Клип не крутит персонажа сам — вращение задаёт игра. Он поочерёдно
    поднимает и опускает стопы (подъём щиколотки ~15 см, чтобы IK стоп
    отпускал замок по высоте), переносит вес тазом и слегка подыгрывает
    руками. Первый и последний кадры совпадают — цикл замкнут.
    """
    lift_l = {
        **neutral,
        "root": {"location": (0.018, 0.0, -0.012)},
        "pelvis": {"rotation": (0.0, 0.0, -0.05)},
        "spine_02": {"rotation": (0.02, 0.0, 0.045)},
        "spine_03": {"rotation": (0.015, 0.0, 0.03)},
        "thigh_l": {"rotation": (-0.62, 0.0, 0.04)},
        "calf_l": {"rotation": (1.18, 0.0, 0.0)},
        "foot_l": {"rotation": (-0.2, 0.0, 0.0)},
        "upperarm_l": {"rotation": (-0.06, 0.0, -0.03)},
        "upperarm_r": {"rotation": (0.06, 0.0, 0.03)},
    }
    lift_r = {
        **neutral,
        "root": {"location": (-0.018, 0.0, -0.012)},
        "pelvis": {"rotation": (0.0, 0.0, 0.05)},
        "spine_02": {"rotation": (0.02, 0.0, -0.045)},
        "spine_03": {"rotation": (0.015, 0.0, -0.03)},
        "thigh_r": {"rotation": (-0.62, 0.0, -0.04)},
        "calf_r": {"rotation": (1.18, 0.0, 0.0)},
        "foot_r": {"rotation": (-0.2, 0.0, 0.0)},
        "upperarm_l": {"rotation": (0.06, 0.0, -0.03)},
        "upperarm_r": {"rotation": (-0.06, 0.0, 0.03)},
    }
    settle_l = {
        **neutral,
        "root": {"location": (0.008, 0.0, -0.004)},
        "thigh_l": {"rotation": (-0.08, 0.0, 0.01)},
        "calf_l": {"rotation": (0.14, 0.0, 0.0)},
    }
    settle_r = {
        **neutral,
        "root": {"location": (-0.008, 0.0, -0.004)},
        "thigh_r": {"rotation": (-0.08, 0.0, -0.01)},
        "calf_r": {"rotation": (0.14, 0.0, 0.0)},
    }
    create_action(
        armature,
        "turn",
        (
            (1, neutral),
            (5, lift_l),
            (9, settle_l),
            (12, neutral),
            (15, neutral),
            (19, lift_r),
            (23, settle_r),
            (26, neutral),
            (28, neutral),
        ),
        baseline,
    )


def add_combat_actions(armature: bpy.types.Object) -> None:
    baseline = capture_idle_baseline(armature)
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
        "thigh_l": {"rotation": (0.0, 0.0, 0.0)},
        "thigh_r": {"rotation": (0.0, 0.0, 0.0)},
    }
    create_attack_action(armature, baseline, neutral)
    create_turn_action(armature, baseline, neutral)
    create_action(
        armature,
        "hurt",
        (
            (1, neutral),
            (
                5,
                {
                    **neutral,
                    "root": {"location": (0.035, 0.025, 0.015)},
                    "spine_02": {"rotation": (0.18, 0.06, 0.16)},
                    "spine_03": {"rotation": (0.24, 0.10, 0.20)},
                    "head": {"rotation": (-0.18, -0.04, -0.20)},
                    "upperarm_l": {"rotation": (0.18, 0.08, -0.22)},
                    "upperarm_r": {"rotation": (-0.24, -0.06, 0.18)},
                },
            ),
            (14, neutral),
        ),
        baseline,
    )
    create_action(
        armature,
        "death",
        (
            (1, neutral),
            (
                7,
                {
                    **neutral,
                    "root": {
                        "location": (0.0, -0.025, -0.035),
                        "rotation": (0.10, 0.0, 0.025),
                    },
                    "pelvis": {"rotation": (0.10, 0.0, -0.025)},
                    "spine_01": {"rotation": (0.10, 0.0, 0.02)},
                    "spine_02": {"rotation": (0.18, 0.03, -0.03)},
                    "spine_03": {"rotation": (0.22, -0.02, 0.025)},
                    "head": {"rotation": (-0.18, 0.02, -0.025)},
                    "upperarm_l": {"rotation": (-0.18, 0.04, -0.20)},
                    "upperarm_r": {"rotation": (-0.10, -0.03, 0.18)},
                },
            ),
            (
                15,
                {
                    **neutral,
                    "root": {
                        "location": (0.015, -0.11, -0.31),
                        "rotation": (0.28, 0.0, 0.04),
                    },
                    "pelvis": {"rotation": (0.18, 0.0, -0.05)},
                    "spine_01": {"rotation": (0.20, 0.0, 0.03)},
                    "spine_02": {"rotation": (0.30, 0.04, -0.04)},
                    "spine_03": {"rotation": (0.34, -0.03, 0.04)},
                    "head": {"rotation": (-0.30, 0.02, -0.04)},
                    "upperarm_l": {"rotation": (0.34, 0.08, 0.28)},
                    "upperarm_r": {"rotation": (0.28, -0.06, -0.25)},
                    "lowerarm_l": {"rotation": (-0.24, 0.0, 0.06)},
                    "lowerarm_r": {"rotation": (-0.20, 0.0, -0.05)},
                    "thigh_l": {"rotation": (-0.68, 0.02, 0.08)},
                    "thigh_r": {"rotation": (-0.50, -0.02, -0.07)},
                    "calf_l": {"rotation": (1.18, 0.0, -0.04)},
                    "calf_r": {"rotation": (0.96, 0.0, 0.04)},
                    "foot_l": {"rotation": (-0.48, 0.0, 0.0)},
                    "foot_r": {"rotation": (-0.38, 0.0, 0.0)},
                },
            ),
            (
                24,
                {
                    **neutral,
                    "root": {
                        "location": (0.025, -0.19, -0.12),
                        "rotation": (0.92, 0.015, 0.055),
                    },
                    "pelvis": {"rotation": (0.10, 0.0, -0.04)},
                    "spine_01": {"rotation": (0.12, 0.0, 0.02)},
                    "spine_02": {"rotation": (0.22, 0.04, -0.03)},
                    "spine_03": {"rotation": (0.26, -0.03, 0.035)},
                    "head": {"rotation": (-0.38, 0.03, -0.04)},
                    "upperarm_l": {"rotation": (0.72, 0.08, 0.40)},
                    "upperarm_r": {"rotation": (0.60, -0.06, -0.34)},
                    "lowerarm_l": {"rotation": (-0.26, 0.0, 0.08)},
                    "lowerarm_r": {"rotation": (-0.30, 0.0, -0.07)},
                    "thigh_l": {"rotation": (-0.34, 0.02, 0.11)},
                    "thigh_r": {"rotation": (-0.18, -0.02, -0.09)},
                    "calf_l": {"rotation": (0.72, 0.0, -0.04)},
                    "calf_r": {"rotation": (0.56, 0.0, 0.04)},
                    "foot_l": {"rotation": (-0.28, 0.0, 0.0)},
                    "foot_r": {"rotation": (-0.22, 0.0, 0.0)},
                },
            ),
            (
                38,
                {
                    **neutral,
                    "root": {
                        "location": (0.035, -0.24, 0.020),
                        "rotation": (1.50, 0.02, 0.065),
                    },
                    "pelvis": {"rotation": (0.06, 0.0, -0.04)},
                    "spine_01": {"rotation": (0.06, 0.0, 0.02)},
                    "spine_02": {"rotation": (0.10, 0.04, -0.04)},
                    "spine_03": {"rotation": (0.12, -0.03, 0.045)},
                    "head": {"rotation": (-0.34, 0.06, -0.08)},
                    "clavicle_l": {"rotation": (0.0, 0.0, 0.12)},
                    "clavicle_r": {"rotation": (0.0, 0.0, -0.10)},
                    "upperarm_l": {"rotation": (0.28, 0.10, 0.58)},
                    "upperarm_r": {"rotation": (-0.28, -0.10, -0.58)},
                    "lowerarm_l": {"rotation": (-0.20, 0.0, 0.10)},
                    "lowerarm_r": {"rotation": (0.20, 0.0, -0.10)},
                    "thigh_l": {"rotation": (-0.08, 0.02, 0.04)},
                    "thigh_r": {"rotation": (0.08, -0.02, -0.04)},
                    "calf_l": {"rotation": (0.18, 0.0, -0.03)},
                    "calf_r": {"rotation": (-0.18, 0.0, 0.03)},
                    "foot_l": {"rotation": (-0.08, 0.0, 0.0)},
                    "foot_r": {"rotation": (0.08, 0.0, 0.0)},
                },
            ),
        ),
        baseline,
    )
    pin_death_limb_contacts(armature)


def evaluated_bounds(
    meshes: list[bpy.types.Object],
) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            points.extend(
                evaluated.matrix_world @ vertex.co for vertex in mesh.vertices
            )
        finally:
            evaluated.to_mesh_clear()
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    return minimum, maximum


def configure_npc(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    asset_id: str,
) -> None:
    armature.name = "npc_humanoid_root"
    armature["realm_schema"] = "realm.humanoid-npc-review.v1"
    armature["realm_asset_id"] = asset_id
    armature["realm_category"] = "humanoid_npc"
    armature["realm_species"] = "human"
    armature["realm_art_direction"] = "character_geometry_b_materials_c"
    armature["realm_shared_player_topology"] = True
    armature["realm_inventory_driven_equipment"] = True
    armature["realm_underwear_included"] = True
    armature["realm_barefoot"] = True
    armature["realm_review_only"] = True
    armature["realm_runtime_integration_allowed"] = False
    for obj in meshes:
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = armature
        obj.parent = armature
        obj["realm_npc_body_layer"] = (
            "hair"
            if "hair" in obj.name.lower()
            else "eyes"
            if "eye" in obj.name.lower()
            else "eyebrows"
            if "eyebrow" in obj.name.lower()
            else "body_base"
        )


def parse_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(
        data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0")
    )
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
    skins = gltf.get("skins", [])
    return {
        "meshDefinitions": len(gltf.get("meshes", [])),
        "positionVertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "skins": len(skins),
        "skinJointCounts": [
            len(skin.get("joints", [])) for skin in skins
        ],
        "animations": [
            animation.get("name", "") for animation in gltf.get("animations", [])
        ],
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
    }


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
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
            "Realm of Ashes B+C humanoid NPC review derivative. Player "
            "topology/rig/locomotion: Quaternius CC0-1.0; Realm materials "
            "and authored combat reactions."
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
    clear_scene()
    armature, meshes = import_player(args.source)
    configure_npc(armature, meshes, args.asset_id)
    add_combat_actions(armature)
    missing = [
        name for name in REQUIRED_ACTIONS if bpy.data.actions.get(name) is None
    ]
    if missing:
        raise RuntimeError(f"Missing required actions: {missing}")
    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    export_candidate(args.output, armature, meshes)
    actual = parse_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "source": args.source.as_posix(),
        "sourceSha256": hashlib.sha256(args.source.read_bytes()).hexdigest().upper(),
        "boundsIdleMetres": {
            "minimum": [round(value, 6) for value in minimum],
            "maximum": [round(value, 6) for value in maximum],
        },
        "rig": {
            "armatures": 1,
            "boneCount": len(armature.data.bones),
            "bones": sorted(bone.name for bone in armature.data.bones),
        },
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "provenance": {
            "baseTopologyRigLocomotion": "current approved player base",
            "baseLicense": "CC0-1.0",
            "combatAnimations": "original Realm of Ashes keyframes",
            "externalDonorBeyondApprovedPlayer": None,
        },
        "design": {
            "sharedPlayerTopology": True,
            "inventoryDrivenEquipment": True,
            "underwearIncluded": True,
            "barefoot": True,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_HUMANOID_NPC_BUILD=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
