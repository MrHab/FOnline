"""Render diagnostic frames from a GLB death animation.

The script is intentionally model-agnostic so authored humanoid and creature
death clips can be checked with the same camera, lighting and ground plane.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--action", default="death")
    parser.add_argument("--samples", type=int, default=5)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def evaluated_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            points.append(evaluated.matrix_world @ Vector(corner))
    if not points:
        raise RuntimeError("Imported GLB has no renderable bounds")
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def add_review_stage(minimum: Vector, maximum: Vector) -> bpy.types.Object:
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    span = max(size.x, size.y, size.z, 1.0)

    bpy.ops.mesh.primitive_plane_add(size=span * 8.0, location=(center.x, center.y, 0.0))
    ground = bpy.context.object
    ground.name = "death_review_ground"
    material = bpy.data.materials.new("death_review_ground_material")
    material.diffuse_color = (0.065, 0.075, 0.085, 1.0)
    material.metallic = 0.0
    material.roughness = 0.88
    ground.data.materials.append(material)

    bpy.ops.object.camera_add(
        location=(
            center.x + span * 2.25,
            center.y - span * 3.15,
            max(size.z * 1.20, span * 1.45),
        )
    )
    camera = bpy.context.object
    camera.data.lens = 62
    point_camera(camera, Vector((center.x, center.y, max(size.z * 0.42, 0.35))))
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(
        type="AREA",
        location=(center.x - span * 1.8, center.y - span * 1.6, span * 3.0),
    )
    key = bpy.context.object
    key.data.energy = 1150.0
    key.data.shape = "DISK"
    key.data.size = span * 2.1
    point_camera(key, center)

    bpy.ops.object.light_add(
        type="AREA",
        location=(center.x + span * 2.1, center.y + span * 1.2, span * 1.9),
    )
    fill = bpy.context.object
    fill.data.energy = 700.0
    fill.data.size = span * 1.8
    point_camera(fill, center)
    return camera


def render_samples(args: argparse.Namespace) -> None:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("Imported GLB has no armature")
    action = bpy.data.actions.get(args.action)
    if action is None:
        raise RuntimeError(f"Imported GLB has no {args.action!r} action")
    armature.animation_data_create()
    armature.animation_data.action = action

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.028)

    scene.frame_set(round(action.frame_range[0]))
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    add_review_stage(minimum, maximum)

    args.output.mkdir(parents=True, exist_ok=True)
    sample_count = max(2, args.samples)
    start, end = action.frame_range
    for index in range(sample_count):
        factor = index / (sample_count - 1)
        frame = round(start + (end - start) * factor)
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        scene.render.filepath = str(
            (args.output / f"{index + 1:02d}_frame_{frame:03d}.png").resolve()
        )
        bpy.ops.render.render(write_still=True)

    final_minimum, final_maximum = evaluated_bounds(meshes)
    tracked_bones = {}
    for name in ("root", "pelvis", "head", "hand_l", "hand_r", "foot_l", "foot_r"):
        bone = armature.pose.bones.get(name)
        if bone is None:
            continue
        position = armature.matrix_world @ bone.head
        tracked_bones[name] = [round(value, 5) for value in position]
    print("REALM_DEATH_REVIEW_POSE=" + json.dumps({
        "action": args.action,
        "frame": round(end),
        "bounds": {
            "minimum": [round(value, 5) for value in final_minimum],
            "maximum": [round(value, 5) for value in final_maximum],
        },
        "bones": tracked_bones,
    }))


def main() -> None:
    render_samples(parse_args())


if __name__ == "__main__":
    main()
