"""Export the critic-approved two-hand rifle pose as a tiny runtime donor.

Run this script with the final held-review .blend open.  It bakes only the
upper-body bones used by the grip and stores the approved weapon-root transform
in an empty named ``approved_assault_rifle_mount``.  One tiny untextured skinned
triangle is retained deliberately so the exported hierarchy remains a skeletal
rig.  The proxy is never added to the game scene.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy


GRIP_BONES = (
    "spine_01",
    "spine_02",
    "spine_03",
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "index_01_l",
    "index_02_l",
    "index_03_l",
    "middle_01_l",
    "middle_02_l",
    "middle_03_l",
    "ring_01_l",
    "ring_02_l",
    "ring_03_l",
    "pinky_01_l",
    "pinky_02_l",
    "pinky_03_l",
    "thumb_01_l",
    "thumb_02_l",
    "thumb_03_l",
    "index_01_r",
    "index_02_r",
    "index_03_r",
    "middle_01_r",
    "middle_02_r",
    "middle_03_r",
    "ring_01_r",
    "ring_02_r",
    "ring_03_r",
    "pinky_01_r",
    "pinky_02_r",
    "pinky_03_r",
    "thumb_01_r",
    "thumb_02_r",
    "thumb_03_r",
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args(argv)


def parse_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise RuntimeError("Runtime grip export is not a glTF 2 GLB")
    offset = 12
    gltf = None
    while offset + 8 <= len(data):
        length = struct.unpack_from("<I", data, offset)[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        if chunk_type == b"JSON":
            gltf = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        offset += 8 + length
    if gltf is None:
        raise RuntimeError("Runtime grip export has no JSON chunk")
    return {
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
        "animations": [animation.get("name", "") for animation in gltf.get("animations", [])],
        "animationChannels": sum(
            len(animation.get("channels", [])) for animation in gltf.get("animations", [])
        ),
        "meshes": len(gltf.get("meshes", [])),
        "skins": len(gltf.get("skins", [])),
    }


def find_weapon_root() -> bpy.types.Object:
    candidates = [
        obj
        for obj in bpy.context.scene.objects
        if obj.get("realm_asset_id") == "rifle_unified_v5"
        or obj.name == "weapon_rifle_unified_v5"
    ]
    if len(candidates) != 1:
        raise RuntimeError(
            "Held review scene must contain exactly one rifle_unified_v5 root; "
            f"found {[obj.name for obj in candidates]}"
        )
    return candidates[0]


def create_skin_proxy(armature: bpy.types.Object) -> bpy.types.Object:
    source_candidates = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and any(
            modifier.type == "ARMATURE" and modifier.object == armature
            for modifier in obj.modifiers
        )
    ]
    if not source_candidates:
        raise RuntimeError("Held review scene has no skinned character mesh for grip export")
    mesh = bpy.data.meshes.new("approved_grip_skin_proxy_mesh")
    mesh.from_pydata(
        [(0.0, 0.0, 0.0), (0.001, 0.0, 0.0), (0.0, 0.001, 0.0)],
        [],
        [(0, 1, 2)],
    )
    mesh.update()
    proxy = bpy.data.objects.new("approved_grip_skin_proxy", mesh)
    bpy.context.scene.collection.objects.link(proxy)
    proxy.parent = armature
    root_group = proxy.vertex_groups.new(name="root")
    root_group.add([0, 1, 2], 1.0, "REPLACE")
    modifier = proxy.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    return proxy


def main() -> None:
    args = parse_args()
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Held review scene must contain one armature; found {len(armatures)}")
    armature = armatures[0]
    missing = [name for name in GRIP_BONES if armature.pose.bones.get(name) is None]
    if missing:
        raise RuntimeError(f"Held review rig is missing grip bones: {missing}")
    weapon_root = find_weapon_root()
    skin_proxy = create_skin_proxy(armature)

    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    evaluated_matrices = {
        name: armature.pose.bones[name].matrix.copy()
        for name in GRIP_BONES
    }
    mount_matrix = armature.matrix_world.inverted() @ weapon_root.matrix_world

    if armature.animation_data:
        armature.animation_data_clear()

    action = bpy.data.actions.new("assault_rifle_grip")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.bone.select = pose_bone.name in GRIP_BONES
        if pose_bone.name in GRIP_BONES:
            pose_bone.rotation_mode = "QUATERNION"
    result = bpy.ops.nla.bake(
        frame_start=1,
        frame_end=2,
        step=1,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=True,
        clean_curves=False,
        bake_types={"POSE"},
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot visually bake approved grip IK: {result}")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    baked_pose_errors = {}
    for name in GRIP_BONES:
        expected_location, expected_rotation, _expected_scale = evaluated_matrices[name].decompose()
        actual_location, actual_rotation, _actual_scale = armature.pose.bones[name].matrix.decompose()
        baked_pose_errors[name] = {
            "position": (actual_location - expected_location).length,
            "rotationDegrees": actual_rotation.rotation_difference(expected_rotation).angle * 57.295779513,
        }
    worst_position = max(value["position"] for value in baked_pose_errors.values())
    worst_rotation = max(value["rotationDegrees"] for value in baked_pose_errors.values())
    if worst_position > 0.00001 or worst_rotation > 0.01:
        raise RuntimeError(
            "Visual IK bake drifted from the approved held pose: "
            f"position={worst_position:.8f} m, rotation={worst_rotation:.6f} degrees"
        )
    print(
        "REALM_GRIP_BAKE_ERROR="
        + json.dumps(
            {
                "positionMetres": worst_position,
                "rotationDegrees": worst_rotation,
            },
            sort_keys=True,
        )
    )

    # Blender's visual bake creates location and scale curves as well.  The
    # shared humanoid rig must keep its authored joint offsets and bone lengths;
    # only the reviewed thumb root has a deliberate small positional correction.
    for curve in list(action.fcurves):
        data_path = str(curve.data_path)
        bone_name = data_path.split('pose.bones["', 1)[-1].split('"]', 1)[0]
        if bone_name not in GRIP_BONES:
            action.fcurves.remove(curve)
            continue
        if data_path.endswith(".rotation_quaternion"):
            continue
        if bone_name == "thumb_01_l" and data_path.endswith(".location"):
            continue
        action.fcurves.remove(curve)
    for other_action in list(bpy.data.actions):
        if other_action != action:
            bpy.data.actions.remove(other_action)

    mount = bpy.data.objects.new("approved_assault_rifle_mount", None)
    mount.matrix_world = armature.matrix_world @ mount_matrix
    mount["realm_schema"] = "realm.approved-weapon-grip.v1"
    mount["realm_weapon_id"] = "assaultRifle"
    mount["realm_approved_pose"] = True
    bpy.context.scene.collection.objects.link(mount)

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    skin_proxy.select_set(True)
    mount.select_set(True)
    bpy.context.view_layer.objects.active = armature
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(args.output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_materials="NONE",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_force_sampling=True,
        export_def_bones=True,
        export_leaf_bone=False,
        export_armature_object_remove=False,
        export_skins=True,
        export_morph=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export runtime grip donor: {result}")

    parsed = parse_glb(args.output)
    report = {
        "schema": "realm.approved-weapon-grip.v1",
        "weaponId": "assaultRifle",
        "sourceScene": Path(bpy.data.filepath).name,
        "animation": "assault_rifle_grip",
        "gripBones": list(GRIP_BONES),
        "mountNode": "approved_assault_rifle_mount",
        "visualBake": {
            "maxPositionErrorMetres": worst_position,
            "maxRotationErrorDegrees": worst_rotation,
        },
        "actualGlb": parsed,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("REALM_APPROVED_ASSAULT_RIFLE_GRIP=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
