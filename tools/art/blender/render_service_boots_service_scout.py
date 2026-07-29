"""Render deterministic review views from an exported Service Scout GLB."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


VIEWS = {
    "front": ((0.34, -0.58, 0.28), (0.0, -0.01, 0.12), 58.0),
    "three_quarter": ((0.45, -0.62, 0.34), (0.0, -0.01, 0.12), 58.0),
    "side": ((0.65, -0.02, 0.29), (0.0, -0.01, 0.12), 62.0),
    "rear": ((0.38, 0.62, 0.30), (0.0, 0.0, 0.12), 60.0),
    "sole": ((0.34, -0.38, -0.36), (0.0, -0.01, 0.055), 58.0),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (
        Vector(target) - obj.location
    ).to_track_quat("-Z", "Y").to_euler()


def make_material(
    name: str,
    colour: tuple[float, float, float, float],
    roughness: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = colour
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = colour
    principled.inputs["Roughness"].default_value = roughness
    return material


def build_studio() -> tuple[bpy.types.Object, bpy.types.Object]:
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("review_world")
        bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.025,
        0.028,
        0.032,
        1.0,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0.0, 0.0, -0.002))
    ground = bpy.context.object
    ground.name = "review_ground"
    ground.data.materials.append(
        make_material(
            "mat_review_ground",
            (0.28, 0.20, 0.15, 1.0),
            0.9,
        )
    )

    camera_data = bpy.data.cameras.new("review_camera")
    camera = bpy.data.objects.new("review_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.lens = 58.0
    camera.data.sensor_width = 36.0
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("review_key", "AREA")
    key_data.energy = 55.0
    key_data.shape = "DISK"
    key_data.size = 1.4
    key = bpy.data.objects.new("review_key", key_data)
    key.location = (-0.75, -0.85, 1.35)
    bpy.context.collection.objects.link(key)
    look_at(key, (0.0, 0.0, 0.12))

    fill_data = bpy.data.lights.new("review_fill", "AREA")
    fill_data.energy = 24.0
    fill_data.size = 1.1
    fill = bpy.data.objects.new("review_fill", fill_data)
    fill.location = (0.8, -0.25, 0.85)
    bpy.context.collection.objects.link(fill)
    look_at(fill, (0.0, 0.0, 0.12))

    rim_data = bpy.data.lights.new("review_rim", "AREA")
    rim_data.energy = 38.0
    rim_data.size = 0.9
    rim = bpy.data.objects.new("review_rim", rim_data)
    rim.location = (0.0, 0.82, 0.88)
    bpy.context.collection.objects.link(rim)
    look_at(rim, (0.0, 0.0, 0.15))
    return camera, ground


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.name.startswith("mesh_service_boots_")
        for corner in obj.bound_box
    ]
    print(
        "service-scout render bounds:",
        tuple(round(min(point[index] for point in points), 5) for index in range(3)),
        tuple(round(max(point[index] for point in points), 5) for index in range(3)),
        flush=True,
    )
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            obj.hide_render = True
            obj.show_in_front = False
        elif obj.type == "MESH" and not obj.name.startswith(
            "mesh_service_boots_"
        ):
            obj.hide_render = True
    camera, ground = build_studio()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.render.use_file_extension = True
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.color_depth = "8"

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for view, (location, target, lens) in VIEWS.items():
        ground.hide_render = view == "sole"
        camera.location = location
        camera.data.lens = lens
        look_at(camera, target)
        scene.render.filepath = str(
            (args.output_dir / f"{args.prefix}_{view}.png").resolve()
        )
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
