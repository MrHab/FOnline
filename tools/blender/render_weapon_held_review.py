"""Render a review weapon in a real two-hand pose on the current player rig."""

from __future__ import annotations

import argparse
import json
from math import pi
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--character", type=Path, required=True)
    parser.add_argument("--weapon", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--hands-output", type=Path)
    parser.add_argument("--hands-front-output", type=Path)
    parser.add_argument("--hands-opposite-output", type=Path)
    parser.add_argument("--hands-muzzle-output", type=Path)
    parser.add_argument("--game-output", type=Path)
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()), import_shading="NORMALS")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def roots(objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    object_set = set(objects)
    return [obj for obj in objects if obj.parent not in object_set]


def mesh_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in objects
        if obj.type == "MESH" and not obj.hide_render
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("No visible meshes")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_empty(name: str, location: Vector) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    empty.location = location
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.08
    bpy.context.scene.collection.objects.link(empty)
    return empty


def pose_arm_to_socket(
    armature: bpy.types.Object,
    side: str,
    socket: bpy.types.Object,
) -> dict[str, object]:
    hand = armature.pose.bones.get(f"hand_{side}")
    if hand is None:
        raise RuntimeError(f"Current player rig has no hand_{side}")
    target = add_empty(f"review_hand_target_{side}", socket.matrix_world.translation)
    target.rotation_euler = socket.matrix_world.to_euler()
    outward = -1 if side == "r" else 1
    pole = add_empty(
        f"review_elbow_pole_{side}",
        Vector((outward * 0.68, -0.18, 1.18)),
    )
    constraint = hand.constraints.new("IK")
    constraint.name = f"review_two_hand_fit_{side}"
    constraint.target = target
    constraint.pole_target = pole
    # The support arm may rotate the clavicle forward, as it would in a real
    # shouldered firing stance. The trigger arm remains anchored at the
    # shoulder so the stock contact does not drift.
    constraint.chain_count = 4 if side == "l" else 3
    constraint.use_tail = True
    constraint.use_rotation = True
    constraint.iterations = 96
    shoulder = armature.matrix_world @ armature.pose.bones[f"upperarm_{side}"].head
    midpoint = (shoulder + target.location) * 0.5
    desired_elbow = midpoint + (
        Vector((-0.003, 0.065, -0.143))
        if side == "r"
        else Vector((-0.038, -0.057, -0.073))
    )
    best_angle = 0.0
    best_distance = float("inf")
    for index in range(32):
        angle = (pi * 2.0 * index) / 32.0
        constraint.pole_angle = angle
        bpy.context.view_layer.update()
        elbow = armature.matrix_world @ armature.pose.bones[f"lowerarm_{side}"].head
        distance = (elbow - desired_elbow).length
        if distance < best_distance:
            best_distance = distance
            best_angle = angle
    constraint.pole_angle = best_angle
    bpy.context.view_layer.update()
    actual_elbow = armature.matrix_world @ armature.pose.bones[f"lowerarm_{side}"].head
    return {
        "hand": hand.name,
        "target": tuple(round(value, 4) for value in target.location),
        "pole": tuple(round(value, 4) for value in pole.location),
        "selectedPoleAngleRadians": round(best_angle, 4),
        "desiredElbow": tuple(round(value, 4) for value in desired_elbow),
        "actualElbow": tuple(round(value, 4) for value in actual_elbow),
        "elbowErrorMetres": round((actual_elbow - desired_elbow).length, 4),
    }


def pose_trigger_finger(armature: bpy.types.Object) -> None:
    """Keep the trigger finger extended while the other fingers wrap the grip."""
    rotations = {
        "index_01_r": Quaternion((1.0, 0.0, 0.0, 0.0)),
        "index_02_r": Quaternion((0.8775826, 0.4794255, 0.0, 0.0)),
        "index_03_r": Quaternion((0.8775826, 0.4794255, 0.0, 0.0)),
    }
    for name, rotation in rotations.items():
        bone = armature.pose.bones.get(name)
        if bone is None:
            raise RuntimeError(f"Current player rig has no {name}")
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = rotation


def pose_support_hand_grip(armature: bpy.types.Object) -> dict[str, object]:
    """Use the user-requested 180-degree correction of the support wrist."""
    hand = armature.pose.bones.get("hand_l")
    if hand is None:
        raise RuntimeError("Current player rig has no hand_l")
    ik = hand.constraints.get("review_two_hand_fit_l")
    if ik is None:
        raise RuntimeError("Support hand has no review IK constraint")

    # First let IK solve the natural forearm-to-hand axis. Then give the same
    # IK target the requested wrist roll. Driving rotation through the IK
    # target preserves that axis; a separate world-space COPY_ROTATION
    # constraint bends the wrist because pose bones include their rest matrix.
    ik.use_rotation = False
    bpy.context.view_layer.update()
    hand_world = armature.matrix_world @ hand.matrix
    palm_rotation = hand_world.to_quaternion() @ Quaternion(
        Vector((0, 1, 0)),
        pi * 0.5,
    )
    hand_target = ik.target
    hand_target.matrix_world = (
        Matrix.Translation(hand_target.matrix_world.translation)
        @ palm_rotation.to_matrix().to_4x4()
    )
    ik.use_rotation = True

    # The additional 180-degree wrist turn reverses the useful local bend
    # direction. Curl the four fingers toward the top and far side so that
    # they close around the handguard while the palm supports it from below.
    finger_angles = {
        "index": (-0.68, -1.05, -0.95),
        "middle": (-0.76, -1.12, -1.00),
        "ring": (-0.82, -1.16, -1.04),
        "pinky": (-0.88, -1.20, -1.08),
    }
    for finger, angles in finger_angles.items():
        for joint, angle in enumerate(angles, start=1):
            bone_name = f"{finger}_{joint:02d}_l"
            bone = armature.pose.bones.get(bone_name)
            if bone is None:
                raise RuntimeError(f"Current player rig has no {bone_name}")
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = Quaternion(
                Vector((1, 0, 0)),
                angle,
            )
    # The wrist turn also reverses the thumb.  Refit the complete chain so it
    # runs toward the muzzle, then move its unconnected root slightly outward
    # and upward onto the wooden handguard's left face.  This keeps it clear
    # of the lower metal rail without changing the approved palm or fingers.
    thumb_basis_quaternions = {
        "thumb_01_l": (
            0.756239652633667,
            0.5436831116676331,
            0.28363457322120667,
            -0.22817036509513855,
        ),
        "thumb_02_l": (
            0.969728946685791,
            -0.24020721018314362,
            -0.029435506090521812,
            -0.03255578503012657,
        ),
        "thumb_03_l": (
            0.9673327207565308,
            -0.040539421141147614,
            0.10893853008747101,
            0.22529177367687225,
        ),
    }
    for bone_name, rotation in thumb_basis_quaternions.items():
        bone = armature.pose.bones.get(bone_name)
        if bone is None:
            raise RuntimeError(f"Current player rig has no {bone_name}")
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion(rotation)
    thumb_root_offset = (
        0.017399609088897705,
        0.003852546215057373,
        0.006644606590270996,
    )
    armature.pose.bones["thumb_01_l"].location = thumb_root_offset
    bpy.context.view_layer.update()
    return {
        "palmRollDegrees": 90,
        "palmRollDeltaFromPreviousDegrees": 180,
        "fingerShape": "progressive closed C-grip",
        "fingerCurlRadians": {
            finger: list(angles)
            for finger, angles in finger_angles.items()
        },
        "thumbBasisQuaternions": {
            bone_name: list(rotation)
            for bone_name, rotation in thumb_basis_quaternions.items()
        },
        "thumbRootPoseOffset": list(thumb_root_offset),
        "thumbPlacement": "forward on the left wooden face, clear of the lower rail",
        "wristAlignment": "IK target rotation preserves forearm-to-hand axis",
    }


def setup_review_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.052, 0.048, 0.043, 1)
    background.inputs["Strength"].default_value = 0.28

    floor_material = bpy.data.materials.new("held_review_floor")
    floor_material.use_nodes = True
    floor_bsdf = floor_material.node_tree.nodes["Principled BSDF"]
    floor_bsdf.inputs["Base Color"].default_value = (0.17, 0.16, 0.145, 1)
    floor_bsdf.inputs["Roughness"].default_value = 0.94
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.015))
    bpy.context.object.data.materials.append(floor_material)

    lights = (
        ("held_key", (-3.6, -4.8, 5.8), 920, 4.5),
        ("held_fill", (4.1, -2.0, 3.2), 520, 3.5),
        ("held_rim", (1.0, 4.2, 4.5), 680, 3.0),
    )
    for name, location, energy, size in lights:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        scene.collection.objects.link(light)
        look_at(light, Vector((0, -0.1, 1.0)))

    camera_data = bpy.data.cameras.new("held_review_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.45
    camera = bpy.data.objects.new("held_review_camera", camera_data)
    camera.location = (-5.0, -1.8, 2.6)
    scene.collection.objects.link(camera)
    look_at(camera, Vector((0, -0.12, 0.96)))
    scene.camera = camera
    return camera


def main() -> None:
    args = parse_args()
    clear_scene()
    character_objects = import_glb(args.character)
    armature = next((obj for obj in character_objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("Character GLB has no armature")
    if armature.animation_data:
        armature.animation_data.action = None
    weapon_objects = import_glb(args.weapon)
    for obj in weapon_objects:
        if obj.animation_data:
            obj.animation_data_clear()
    weapon_roots = roots(weapon_objects)
    if len(weapon_roots) != 1:
        names = ", ".join(obj.name for obj in weapon_roots)
        raise RuntimeError(f"Weapon review GLB must have exactly one root, got: {names}")
    weapon_root = weapon_roots[0]
    butt_socket = next((obj for obj in weapon_objects if obj.name == "socket_butt"), None)
    if butt_socket:
        local_butt = butt_socket.location.copy()
        shoulder_bone = armature.pose.bones["upperarm_r"]
        shoulder_world = armature.matrix_world @ shoulder_bone.head
        shoulder_contact = shoulder_world + Vector((0.0, -0.075, -0.035))
        aim_direction = Vector((0.15, -0.988, 0.03)).normalized()
        world_up = Vector((0, 0, 1))
        z_axis = (world_up - aim_direction * aim_direction.dot(world_up)).normalized()
        x_axis = aim_direction.cross(z_axis).normalized()
        aim_rotation = Matrix(
            (
                (x_axis.x, aim_direction.x, z_axis.x, 0),
                (x_axis.y, aim_direction.y, z_axis.y, 0),
                (x_axis.z, aim_direction.z, z_axis.z, 0),
                (0, 0, 0, 1),
            )
        )
        weapon_root.matrix_world = (
            Matrix.Translation(shoulder_contact)
            @ aim_rotation
            @ Matrix.Translation(-local_butt)
        )
    else:
        weapon_root.matrix_world = (
            Matrix.Translation(Vector((-0.04, -0.34, 1.19)))
            @ Matrix.Rotation(-pi * 0.5, 4, "Z")
        )
    bpy.context.view_layer.update()

    sockets = {
        side: next(
            (obj for obj in weapon_objects if obj.name == f"socket_grip_{side}"),
            None,
        )
        for side in ("r", "l")
    }
    if any(socket is None for socket in sockets.values()):
        raise RuntimeError("Weapon must export socket_grip_r and socket_grip_l")
    support_grip_forward_offset = (
        sockets["l"].location.y - sockets["r"].location.y
    )
    if support_grip_forward_offset < 0.30:
        raise RuntimeError(
            "Support-hand socket must be at least 0.30 m ahead of the "
            f"primary grip; got {support_grip_forward_offset:.3f} m"
        )
    fit = {
        side: pose_arm_to_socket(armature, side, sockets[side])
        for side in ("r", "l")
    }
    pose_trigger_finger(armature)
    support_hand_pose = pose_support_hand_grip(armature)
    bpy.context.view_layer.update()

    weapon_root["realm_review_two_hand_fit"] = True
    bpy.context.view_layer.update()

    hand_head_distances: dict[str, float] = {}
    hand_palm_distances: dict[str, float] = {}
    for side in ("r", "l"):
        pose_bone = armature.pose.bones[f"hand_{side}"]
        hand_head_world = armature.matrix_world @ pose_bone.head
        hand_palm_world = armature.matrix_world @ pose_bone.tail
        socket_world = sockets[side].matrix_world.translation
        hand_head_distances[side] = round((hand_head_world - socket_world).length, 4)
        hand_palm_distances[side] = round((hand_palm_world - socket_world).length, 4)
    butt_distance = None
    if butt_socket:
        shoulder_bone = armature.pose.bones["upperarm_r"]
        shoulder_contact = (
            armature.matrix_world @ shoulder_bone.head
            + Vector((0.0, -0.075, -0.035))
        )
        butt_distance = round((butt_socket.matrix_world.translation - shoulder_contact).length, 4)
    if any(distance > 0.005 for distance in hand_palm_distances.values()):
        raise RuntimeError(
            "A palm does not contact its grip socket: "
            f"{hand_palm_distances}"
        )
    if butt_distance is not None and butt_distance > 0.005:
        raise RuntimeError(
            f"Stock does not contact the shoulder: {butt_distance:.4f} m"
        )
    elbow_errors = {
        side: float(fit[side]["elbowErrorMetres"])
        for side in ("r", "l")
    }
    if any(error > 0.02 for error in elbow_errors.values()):
        raise RuntimeError(
            "Unnatural elbow fit exceeds 0.02 m: "
            f"errors={elbow_errors}, fit={fit}"
        )

    camera = setup_review_scene()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(args.output.resolve())
    bpy.ops.render.render(write_still=True)
    if args.hands_output:
        args.hands_output.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        hands_center = (
            sockets["r"].matrix_world.translation
            + sockets["l"].matrix_world.translation
        ) * 0.5
        view_direction = Vector((5.0, 1.8, -1.64)).normalized()
        camera.location = hands_center - view_direction * 5.0
        look_at(camera, hands_center)
        camera.data.ortho_scale = 0.72
        scene.render.resolution_x = 960
        scene.render.resolution_y = 640
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(args.hands_output.resolve())
        bpy.ops.render.render(write_still=True)
    if args.hands_front_output:
        args.hands_front_output.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        hands_center = (
            sockets["r"].matrix_world.translation
            + sockets["l"].matrix_world.translation
        ) * 0.5
        camera.location = hands_center + Vector((-2.4, -3.2, 0.35))
        look_at(camera, hands_center)
        camera.data.ortho_scale = 0.72
        scene.render.resolution_x = 960
        scene.render.resolution_y = 640
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(args.hands_front_output.resolve())
        bpy.ops.render.render(write_still=True)
    if args.hands_opposite_output:
        args.hands_opposite_output.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        hands_center = (
            sockets["r"].matrix_world.translation
            + sockets["l"].matrix_world.translation
        ) * 0.5
        view_direction = Vector((-5.0, 1.8, -1.64)).normalized()
        camera.location = hands_center - view_direction * 5.0
        look_at(camera, hands_center)
        camera.data.ortho_scale = 0.72
        scene.render.resolution_x = 960
        scene.render.resolution_y = 640
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(args.hands_opposite_output.resolve())
        bpy.ops.render.render(write_still=True)
    if args.hands_muzzle_output:
        args.hands_muzzle_output.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        primary = sockets["r"].matrix_world.translation
        support = sockets["l"].matrix_world.translation
        weapon_forward = (support - primary).normalized()
        camera.location = support + weapon_forward * 4.0
        look_at(camera, support)
        camera.data.ortho_scale = 0.42
        scene.render.resolution_x = 640
        scene.render.resolution_y = 640
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(args.hands_muzzle_output.resolve())
        bpy.ops.render.render(write_still=True)
    if args.game_output:
        args.game_output.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        camera.location = (-5.0, -1.8, 2.6)
        look_at(camera, Vector((0, -0.12, 0.96)))
        camera.data.ortho_scale = 2.45
        scene.render.resolution_x = 112
        scene.render.resolution_y = 112
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(args.game_output.resolve())
        bpy.ops.render.render(write_still=True)
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    report = {
        "character": args.character.name,
        "weapon": args.weapon.name,
        "fit": fit,
        "handHeadToSocketDistanceMetres": hand_head_distances,
        "palmTailToGripSocketDistanceMetres": hand_palm_distances,
        "buttToShoulderContactDistanceMetres": butt_distance,
        "supportGripForwardOffsetMetres": round(
            support_grip_forward_offset,
            4,
        ),
        "triggerFingerPose": "index extended; middle and distal joints partially curled",
        "supportHandPose": support_hand_pose,
        "runtimeAttachmentBone": "hand_r",
        "reviewPoseMethod": "weapon butt anchored to current right shoulder; right palm uses the pistol-grip socket; left palm uses a validated forward handguard socket",
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_WEAPON_HELD_REVIEW=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
