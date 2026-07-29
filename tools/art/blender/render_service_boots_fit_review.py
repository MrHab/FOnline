"""Render eight lower-body deformation poses for Service Scout boots.

The script imports the approved B+C body and the generated review GLB into a
clean Blender scene.  Both assets keep separate humanoid_v1 armatures; the
body pose is copied bone-for-bone to the footwear rig before every render.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


POSES = (
    ("bind", None, 0.0, None),
    ("idle", "idle", 0.35, None),
    ("walk_contact", "walk", 0.0, None),
    ("run_contact", "run", 0.0, None),
    ("crouch_idle", None, 0.0, "crouch"),
    ("ready_1h", "idle", 0.35, "ready_1h"),
    ("ready_2h", "idle", 0.35, "ready_2h"),
    ("melee_heavy", None, 0.0, "melee_heavy"),
)
FOOT_REGION_BONES = {
    "foot_l",
    "ball_l",
    "ball_leaf_l",
    "foot_r",
    "ball_r",
    "ball_leaf_r",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--body", type=Path, required=True)
    parser.add_argument("--boots", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args(argv)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_glb(
    path: Path,
) -> tuple[list[bpy.types.Object], dict[str, bpy.types.Action]]:
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    result = bpy.ops.import_scene.gltf(filepath=str(path.resolve()))
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot import {path}: {result}")
    objects = [
        obj
        for obj in bpy.data.objects
        if obj not in before_objects
        and obj.name.split(".", 1)[0]
        not in {"Cube", "Icosphere", "Camera", "Light"}
    ]
    actions = {
        action.name.split(".", 1)[0]: action
        for action in bpy.data.actions
        if action not in before_actions
    }
    return objects, actions


def one_armature(
    objects: list[bpy.types.Object],
    label: str,
) -> bpy.types.Object:
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(
            f"{label}: expected one armature, got {len(armatures)}"
        )
    return armatures[0]


def hide_body_foot_regions(objects: list[bpy.types.Object]) -> int:
    removed = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        foot_groups = {
            group.index
            for group in obj.vertex_groups
            if group.name in FOOT_REGION_BONES
        }
        if not foot_groups:
            continue
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        deform = mesh.verts.layers.deform.active
        if deform is None:
            mesh.free()
            continue
        selected = [
            vertex
            for vertex in mesh.verts
            if sum(
                vertex[deform].get(index, 0.0)
                for index in foot_groups
            )
            >= 0.18
        ]
        removed += len(selected)
        bmesh.ops.delete(mesh, geom=selected, context="VERTS")
        mesh.to_mesh(obj.data)
        mesh.free()
        obj.data.update()
    if removed == 0:
        raise RuntimeError("Body has no weighted foot vertices to hide")
    return removed


def reset_pose(armature: bpy.types.Object) -> None:
    if armature.animation_data is not None:
        armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)


def action_pose(
    armature: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
    action_name: str,
    fraction: float,
) -> int:
    action = actions.get(action_name)
    if action is None:
        raise RuntimeError(f"Approved body is missing action {action_name}")
    armature.animation_data_create().action = action
    start, end = action.frame_range
    frame = round(start + (end - start) * fraction)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return frame


def rotate(
    armature: bpy.types.Object,
    name: str,
    xyz_degrees: tuple[float, float, float],
) -> None:
    bone = armature.pose.bones.get(name)
    if bone is None:
        raise RuntimeError(f"humanoid_v1 is missing pose bone {name}")
    current = bone.matrix_basis.to_euler("XYZ")
    delta = Euler(
        tuple(math.radians(value) for value in xyz_degrees),
        "XYZ",
    )
    bone.rotation_mode = "XYZ"
    bone.rotation_euler = Euler(
        (
            current.x + delta.x,
            current.y + delta.y,
            current.z + delta.z,
        ),
        "XYZ",
    )


def translate(
    armature: bpy.types.Object,
    name: str,
    offset: tuple[float, float, float],
) -> None:
    bone = armature.pose.bones.get(name)
    if bone is None:
        raise RuntimeError(f"humanoid_v1 is missing pose bone {name}")
    bone.location = bone.location + Vector(offset)


def manual_pose(armature: bpy.types.Object, pose_id: str) -> None:
    if pose_id == "crouch":
        translate(armature, "pelvis", (0.0, 0.0, -0.15))
        for side in ("l", "r"):
            rotate(armature, f"thigh_{side}", (-34.0, 0.0, 0.0))
            rotate(armature, f"calf_{side}", (66.0, 0.0, 0.0))
            rotate(armature, f"foot_{side}", (-30.0, 0.0, 0.0))
        rotate(armature, "spine_01", (18.0, 0.0, 0.0))
    elif pose_id == "ready_1h":
        rotate(armature, "spine_02", (2.0, 0.0, -10.0))
        rotate(armature, "upperarm_r", (-42.0, 4.0, -28.0))
        rotate(armature, "lowerarm_r", (-34.0, 0.0, 0.0))
        rotate(armature, "upperarm_l", (-12.0, 0.0, 16.0))
    elif pose_id == "ready_2h":
        rotate(armature, "spine_02", (4.0, 0.0, -7.0))
        rotate(armature, "upperarm_r", (-35.0, 4.0, -24.0))
        rotate(armature, "lowerarm_r", (-28.0, 0.0, 0.0))
        rotate(armature, "upperarm_l", (-30.0, -4.0, 24.0))
        rotate(armature, "lowerarm_l", (-38.0, 0.0, 0.0))
    elif pose_id == "melee_heavy":
        translate(armature, "pelvis", (0.0, -0.04, -0.05))
        rotate(armature, "spine_01", (12.0, 0.0, 18.0))
        rotate(armature, "thigh_l", (-20.0, 0.0, 8.0))
        rotate(armature, "calf_l", (38.0, 0.0, 0.0))
        rotate(armature, "foot_l", (-18.0, 0.0, 0.0))
        rotate(armature, "thigh_r", (8.0, 0.0, -7.0))
        rotate(armature, "upperarm_l", (-70.0, 0.0, 22.0))
        rotate(armature, "upperarm_r", (-72.0, 0.0, -20.0))
    else:
        raise RuntimeError(f"Unknown manual pose {pose_id}")
    bpy.context.view_layer.update()


def copy_pose(
    source: bpy.types.Object,
    target: bpy.types.Object,
) -> None:
    source_bones = {bone.name: bone for bone in source.pose.bones}
    target_bones = {bone.name: bone for bone in target.pose.bones}
    if set(source_bones) != set(target_bones):
        raise RuntimeError("Body and footwear joint sets do not match")
    for name, target_bone in target_bones.items():
        target_bone.matrix_basis = source_bones[name].matrix_basis.copy()
    bpy.context.view_layer.update()


def align_to_ground(
    body_armature: bpy.types.Object,
    boots_armature: bpy.types.Object,
    boots_objects: list[bpy.types.Object],
) -> float:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    minimum_z = math.inf
    for obj in boots_objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                minimum_z = min(
                    minimum_z,
                    (evaluated.matrix_world @ vertex.co).z,
                )
        finally:
            evaluated.to_mesh_clear()
    if not math.isfinite(minimum_z):
        raise RuntimeError("Cannot measure posed footwear ground contact")
    shift = -minimum_z
    body_armature.location.z += shift
    boots_armature.location.z += shift
    bpy.context.view_layer.update()
    return shift


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (
        target - obj.location
    ).to_track_quat("-Z", "Y").to_euler()


def make_material(
    name: str,
    colour: tuple[float, float, float, float],
    roughness: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = colour
    shader.inputs["Roughness"].default_value = roughness
    return material


def add_area(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    size: float,
    target: Vector,
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.size = size
    light = bpy.data.objects.new(name, data)
    light.location = location
    bpy.context.collection.objects.link(light)
    look_at(light, target)


def configure_stage() -> bpy.types.Object:
    target = Vector((0.0, -0.02, 0.58))
    bpy.ops.mesh.primitive_plane_add(
        size=7.0,
        location=(0.0, 0.0, -0.004),
    )
    ground = bpy.context.object
    ground.name = "fit_review_ground"
    ground.data.materials.append(
        make_material(
            "mat_fit_review_ground",
            (0.07, 0.055, 0.045, 1.0),
            0.95,
        )
    )
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("fit_review_world")
        bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (
        0.012,
        0.015,
        0.018,
        1.0,
    )
    background.inputs["Strength"].default_value = 0.28
    add_area("fit_key", (3.3, -4.0, 4.8), 900.0, 2.8, target)
    add_area("fit_fill", (-3.2, -1.8, 2.7), 560.0, 2.4, target)
    add_area("fit_rim", (1.2, 3.0, 3.5), 720.0, 2.0, target)

    camera_data = bpy.data.cameras.new("fit_review_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.45
    camera = bpy.data.objects.new("fit_review_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (2.25, -3.4, 1.25)
    look_at(camera, target)
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 22
    scene.view_settings.look = "AgX - Medium High Contrast"
    return camera


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body_objects, body_actions = import_glb(args.body)
    body_armature = one_armature(body_objects, "body")
    hidden_foot_vertices = hide_body_foot_regions(body_objects)
    boots_objects, _ = import_glb(args.boots)
    boots_armature = one_armature(boots_objects, "boots")
    for obj in (*body_objects, *boots_objects):
        if obj.type == "ARMATURE":
            obj.hide_render = True
    configure_stage()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    body_origin = body_armature.location.copy()
    boots_origin = boots_armature.location.copy()
    report_poses = []
    for pose_id, action_name, fraction, manual in POSES:
        body_armature.location = body_origin.copy()
        boots_armature.location = boots_origin.copy()
        reset_pose(body_armature)
        reset_pose(boots_armature)
        bpy.context.scene.frame_set(0)
        frame = 0
        if action_name:
            frame = action_pose(
                body_armature,
                body_actions,
                action_name,
                fraction,
            )
        if manual:
            manual_pose(body_armature, manual)
        copy_pose(body_armature, boots_armature)
        ground_shift = align_to_ground(
            body_armature,
            boots_armature,
            boots_objects,
        )
        output = args.output_dir / f"{args.prefix}_{pose_id}.png"
        bpy.context.scene.render.filepath = str(output.resolve())
        bpy.ops.render.render(write_still=True)
        report_poses.append(
            {
                "id": pose_id,
                "action": action_name,
                "frameFraction": fraction,
                "frame": frame,
                "manualPose": manual,
                "groundShiftMeters": round(ground_shift, 6),
                "image": output.name,
            }
        )

    report = {
        "schema": "realm.service-boots-fit-review.v1",
        "version": 1,
        "status": "review_candidate",
        "body": {
            "file": str(args.body.resolve()),
            "sha256": sha256_file(args.body),
        },
        "boots": {
            "file": str(args.boots.resolve()),
            "sha256": sha256_file(args.boots),
        },
        "rig": "humanoid_v1",
        "jointCount": len(body_armature.data.bones),
        "jointSetsMatch": (
            {bone.name for bone in body_armature.data.bones}
            == {bone.name for bone in boots_armature.data.bones}
        ),
        "hideBodyRegions": ["foot_l", "foot_r"],
        "hiddenBodyVertices": hidden_foot_vertices,
        "poses": report_poses,
        "runtimeIntegrationAllowed": False,
        "pullRequestAllowed": False,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"service-scout fit review: {len(report_poses)} poses, "
        f"{report['jointCount']} joints",
        flush=True,
    )


if __name__ == "__main__":
    main()
