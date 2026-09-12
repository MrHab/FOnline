"""Render a deterministic review sheet for the shipped weapon GLBs."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector, Matrix


WEAPON_IDS = (
    "pistol",
    "rifle",
    "assaultRifle",
    "machineGun",
    "laserPistol",
    "flamethrower",
    "plasmaRifle",
    "shotgun",
    "rocketLauncher",
    "revolver",
    "sawedOffShotgun",
    "smg",
    "knife",
    "pickaxe",
    "axe",
    "handPump",
)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def import_weapon(model_directory: Path, weapon_id: str):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(model_directory / f"weapon_{weapon_id}.glb"))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    roots = [obj for obj in imported if obj.parent is None]
    root = bpy.data.objects.new(f"REVIEW_{weapon_id}", None)
    bpy.context.collection.objects.link(root)
    for obj in roots:
        obj.parent = root
    for obj in imported:
        if obj.animation_data:
            obj.animation_data_clear()
    return root


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(args.output.resolve())
    scene.world = bpy.data.worlds.new("review_world")
    scene.world.color = (0.015, 0.018, 0.017)

    columns = 4
    spacing_x = 3.25
    spacing_y = 3.0
    for index, weapon_id in enumerate(WEAPON_IDS):
        col = index % columns
        row = index // columns
        root = import_weapon(args.model_directory.resolve(), weapon_id)
        # Lay out the side silhouettes. A top-down view along the weapon's up
        # axis shows only a thin barrel and cannot verify a replaced body.
        if weapon_id in {"knife", "pickaxe", "axe", "handPump"}:
            root.rotation_euler = (0, 0, -math.pi / 2)
        else:
            root.rotation_euler = Matrix(((0,1,0),(0,0,1),(1,0,0))).to_euler()
        bpy.context.view_layer.update()
        points = [obj.matrix_world @ Vector(corner)
                  for obj in root.children_recursive if obj.type == "MESH"
                  for corner in obj.bound_box]
        low = Vector(tuple(min(point[a] for point in points) for a in range(3)))
        high = Vector(tuple(max(point[a] for point in points) for a in range(3)))
        scale = min(2.6 / (high.x - low.x), 1.5 / (high.y - low.y))
        root.scale = (scale,) * 3
        root.location = Vector((col * spacing_x, -row * spacing_y, 0.45)) - (low + high) * 0.5 * scale

        bpy.ops.object.text_add(location=(col * spacing_x - 0.72, -row * spacing_y - 1.15, 0.025))
        label = bpy.context.object
        label.data.body = weapon_id
        label.data.align_x = "LEFT"
        label.data.size = 0.26
        label.data.extrude = 0.004
        label.data.materials.append(bpy.data.materials.get("review_label") or make_label_material())

    center = ((columns - 1) * spacing_x / 2, -1.5 * spacing_y, 0)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(center[0], center[1], -0.03))
    ground = bpy.context.object
    ground.name = "review_ground"
    material = bpy.data.materials.new("review_ground_material")
    material.diffuse_color = (0.055, 0.065, 0.06, 1)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = material.diffuse_color
    principled.inputs["Roughness"].default_value = 0.93
    ground.data.materials.append(material)

    bpy.ops.object.light_add(type="AREA", location=(center[0] - 4, center[1] - 3, 12))
    key = bpy.context.object
    key.data.energy = 1900
    key.data.shape = "DISK"
    key.data.size = 8
    look_at(key, center)
    bpy.ops.object.light_add(type="AREA", location=(center[0] + 7, center[1] + 3, 8))
    fill = bpy.context.object
    fill.data.energy = 1150
    fill.data.color = (0.55, 0.72, 0.67)
    fill.data.size = 7
    look_at(fill, center)

    bpy.ops.object.camera_add(location=(center[0], center[1] - 1.4, 18.5))
    camera = bpy.context.object
    look_at(camera, (center[0], center[1], 0))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 14.8
    scene.camera = camera
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.color_mode = "RGBA"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def make_label_material():
    material = bpy.data.materials.new("review_label")
    material.diffuse_color = (0.76, 0.61, 0.32, 1)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = material.diffuse_color
    principled.inputs["Roughness"].default_value = 0.78
    return material


if __name__ == "__main__":
    main()
