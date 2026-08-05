"""Export the critic-approved two-hand rifle pose as a tiny runtime donor.

Run this script with the final held-review .blend open.  It bakes only the
upper-body bones used by the grip and stores the approved weapon-root transform
in an empty named ``approved_assault_rifle_mount``.  The resulting GLB contains
no character or weapon mesh; Three.js uses its animation tracks and mount node
to reproduce the reviewed pose on every compatible 65-bone character rig.
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

    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    evaluated_matrices = {
        name: armature.pose.bones[name].matrix.copy()
        for name in GRIP_BONES
    }
    mount_matrix = armature.matrix_world.inverted() @ weapon_root.matrix_world

    if armature.animation_data:
        armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        for constraint in list(pose_bone.constraints):
            pose_bone.constraints.remove(constraint)
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()

    depth = {}
    for name in GRIP_BONES:
        bone = armature.pose.bones[name]
        level = 0
        parent = bone.parent
        while parent is not None:
            level += 1
            parent = parent.parent
        depth[name] = level
    for name in sorted(GRIP_BONES, key=lambda value: depth[value]):
        armature.pose.bones[name].matrix = evaluated_matrices[name]
    bpy.context.view_layer.update()
    pose_values = {}
    for name in GRIP_BONES:
        location, rotation, scale = armature.pose.bones[name].matrix_basis.decompose()
        pose_values[name] = (location.copy(), rotation.copy(), scale.copy())

    action = bpy.data.actions.new("assault_rifle_grip")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame in (1, 2):
        bpy.context.scene.frame_set(frame)
        for name in GRIP_BONES:
            bone = armature.pose.bones[name]
            location, rotation, scale = pose_values[name]
            bone.rotation_mode = "QUATERNION"
            bone.location = location
            bone.rotation_quaternion = rotation
            bone.scale = scale
            bone.keyframe_insert("location", frame=frame, group=name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=name)
            bone.keyframe_insert("scale", frame=frame, group=name)
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
        export_force_sampling=False,
        export_def_bones=True,
        export_leaf_bone=False,
        export_armature_object_remove=False,
        export_skins=False,
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
