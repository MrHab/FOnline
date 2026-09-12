"""Render a contact sheet of source candidates or generated item GLBs."""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector


def bounds(root):
    points = [obj.matrix_world @ Vector(p) for obj in root.children_recursive
              if obj.type == 'MESH' for p in obj.bound_box]
    return (Vector([min(p[a] for p in points) for a in range(3)]),
            Vector([max(p[a] for p in points) for a in range(3)]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model-root', type=Path)
    parser.add_argument('--columns', type=int, default=5)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    manifest = json.loads(args.manifest.read_text(encoding='utf8'))
    rows = manifest.get('sources', manifest.get('files', []))
    base = args.model_root or args.manifest.parent
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for i, row in enumerate(rows):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(base / row['file'].lstrip('/')))
        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        root = bpy.data.objects.new('Review_' + row['id'], None)
        bpy.context.collection.objects.link(root)
        for obj in imported:
            if any(c.name.startswith('glTF_not_exported') for c in obj.users_collection):
                continue
            if obj.animation_data:
                obj.animation_data_clear()
            if obj.parent not in imported:
                world = obj.matrix_world.copy()
                obj.parent = root
                obj.matrix_world = world
        root.rotation_euler = (math.radians(60), 0, math.radians(-20))
        bpy.context.view_layer.update()
        low, high = bounds(root)
        scale = min(2.1 / max(high.x - low.x, .001), 1.75 / max(high.y - low.y, .001))
        root.scale = (scale,) * 3
        x, y = (i % args.columns) * 2.8, -(i // args.columns) * 2.65
        root.location = Vector((x, y, .15)) - Vector(((low.x + high.x) * .5, (low.y + high.y) * .5, low.z)) * scale
        bpy.ops.object.text_add(location=(x, y - 1.12, .02))
        label = bpy.context.object
        label.data.body = row['id']
        label.data.align_x = 'CENTER'
        label.data.size = .145
        label.data.materials.append(material('Label', (.85, .79, .6)))
    line_count = math.ceil(len(rows) / args.columns)
    center = Vector(((args.columns - 1) * 2.8 / 2, -(line_count - 1) * 2.65 / 2, 0))
    bpy.ops.mesh.primitive_plane_add(size=60, location=center + Vector((0, 0, -.03)))
    bpy.context.object.data.materials.append(material('Ground', (.055, .065, .061)))
    for offset, energy, size in [((-5,-4,13),2200,10), ((7,4,10),1400,8)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(offset))
        light = bpy.context.object
        light.data.energy, light.data.size = energy, size
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add(location=center + Vector((0,0,25)))
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(args.columns * 2.8 + .6, line_count * 2.65 + .6) * 1.05
    scene = bpy.context.scene
    scene.camera = camera
    scene.world = bpy.data.worlds.new('Review world')
    scene.world.color = (.13, .13, .13)
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = args.columns * 400
    scene.render.resolution_y = line_count * 380
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(args.output.resolve())
    scene.view_settings.look = 'AgX - Medium High Contrast'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def material(name, color):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .8
    return mat


if __name__ == '__main__':
    main()
