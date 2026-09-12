"""Render a neutral front preview of an external armor source.

This helper is intentionally generic: it imports a glTF/GLB, removes obvious
viewer helpers and handheld weapons, frames the remaining meshes, and writes a
PNG for visual selection before any runtime asset is generated.
"""

from __future__ import annotations

import math
import pathlib
import sys

import bpy
from mathutils import Vector


EXCLUDED_NAME_TOKENS = (
    "icosphere",
    "pistol",
    "revolver",
    "rifle",
    "sniper",
    "shotgun",
    "launcher",
    "cannon",
    "grenade",
    "shovel",
    "knife",
    "smg",
    " gun",
)


def arguments() -> tuple[pathlib.Path, pathlib.Path]:
    if "--" not in sys.argv:
        raise SystemExit("expected model and output paths after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2:
        raise SystemExit("expected model and output paths")
    source = pathlib.Path(values[0]).resolve()
    output = pathlib.Path(values[1]).resolve()
    if not source.is_file():
        raise SystemExit(f"model does not exist: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    return source, output


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    source, output = arguments()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source))

    for armature in [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]:
        armature.data.pose_position = "REST"

    meshes = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        lowered = f" {obj.name.lower()}"
        if any(token in lowered for token in EXCLUDED_NAME_TOKENS):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        meshes.append(obj)
    if not meshes:
        raise SystemExit("source has no previewable meshes")

    corners = []
    for obj in meshes:
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    minimum = Vector(tuple(min(point[index] for point in corners) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in corners) for index in range(3)))
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    size = max(extent.x, extent.z, 0.5)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 560
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.018, 0.022, 0.028)

    camera_data = bpy.data.cameras.new("external_source_camera")
    camera = bpy.data.objects.new("external_source_camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.lens = 58
    camera.location = (center.x, minimum.y - max(size * 2.25, extent.y * 2.0), center.z + size * 0.02)
    look_at(camera, center)
    scene.camera = camera

    for name, location, energy, color, radius in (
        ("key", (center.x - size, camera.location.y * 0.45, maximum.z + size * 0.35), 1050, (1.0, 0.79, 0.62), size * 0.7),
        ("fill", (center.x + size, camera.location.y * 0.20, center.z + size * 0.1), 800, (0.50, 0.68, 1.0), size * 0.8),
        ("rim", (center.x, maximum.y + size, maximum.z + size * 0.1), 900, (0.95, 0.55, 0.30), size * 0.55),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.color = color
        light_data.shape = "DISK"
        light_data.size = max(radius, 0.4)
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        look_at(light, center)

    bpy.ops.render.render(write_still=True)
    print(f"ROA_EXTERNAL_SOURCE_RENDER={output}")


if __name__ == "__main__":
    main()
