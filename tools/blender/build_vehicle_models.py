"""Build the rideable motorcycle from the pinned CC-BY donor.

The donor ("Military Motorbike" by Zsky, Poly Pizza, CC-BY 3.0) is one mesh with
five flat colours. The game needs moving parts and anchors, so this script:

- welds the flat-shaded faces into real parts and sorts them into the body, the
  steering assembly (fork, headlight, handlebars, front fender) and two wheels;
- scales the bike so a 1.8 m rider fits it and puts the origin on the ground
  under the rider's hips, which is where the player's position lives;
- gives each wheel its axle as the pivot, and the steering assembly the raked
  steering axis as its local Z (glTF Y), so the client spins and steers them;
- adds empty anchors the rider pose reaches for: seat, grips, foot pegs and
  exhaust outlets;
- replaces the glossy donor colours with matte Kromka paint, rubber and rust.

Every number below is measured on the donor after the glTF import (Blender
Z-up), where the bike looks along -Y and the tyres touch z = -1.158.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

SCALE = 0.5
# Ground point under the rider's hips; it becomes the model origin.
ORIGIN = Vector((0.0, 0.30, -1.158))
FRONT_AXLE = Vector((0.0, -1.781, -0.511))
REAR_AXLE = Vector((0.0, 1.751, -0.511))
WHEEL_RADIUS = 0.647
# The head tube runs from (y -1.47, z 0.12) to (y -1.13, z 1.0): ~21 degrees of rake.
STEER_POINT = Vector((0.0, -1.30, 0.56))
STEER_AXIS = Vector((0.0, 0.34, 0.88)).normalized()
# Anchors. The donor's +X becomes the rider's left once glTFast mirrors X into
# Unity; the client still sorts the pair by side, so a mirror cannot cross arms.
STEER_MARKERS = {
    'grip_l': (0.945, -0.44, 0.99),
    'grip_r': (-0.945, -0.44, 0.99),
}
BODY_MARKERS = {
    'seat': (0.0, 0.30, 0.39),
    'peg_l': (0.40, -0.15, -0.80),
    'peg_r': (-0.40, -0.15, -0.80),
    'exhaust_l': (0.47, 2.78, -0.50),
    'exhaust_r': (-0.47, 2.78, -0.50),
}

PALETTE = {
    # Linear base colour, roughness, metallic.
    'olive': ((0.12, 0.14, 0.06), 0.82, 0.15),
    'rubber': ((0.025, 0.027, 0.025), 0.95, 0.0),
    'leather': ((0.09, 0.055, 0.034), 0.74, 0.0),
    'blackMetal': ((0.034, 0.036, 0.034), 0.62, 0.55),
    'steel': ((0.30, 0.30, 0.29), 0.48, 0.85),
    'rust': ((0.24, 0.105, 0.048), 0.86, 0.35),
    'headlight': ((0.86, 0.76, 0.46), 0.22, 0.0),
    'taillight': ((0.45, 0.04, 0.03), 0.35, 0.0),
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    return parser.parse_args(argv)


def to_game(point):
    return (Vector(point) - ORIGIN) * SCALE


def import_donor(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if len(meshes) != 1:
        raise RuntimeError(f'donor must hold one mesh, found {len(meshes)}')
    donor = meshes[0]
    world = donor.matrix_world.copy()
    donor.parent = None
    donor.matrix_world = world
    bpy.ops.object.select_all(action='DESELECT')
    donor.select_set(True)
    bpy.context.view_layer.objects.active = donor
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in list(bpy.context.scene.objects):
        if obj is not donor:
            bpy.data.objects.remove(obj, do_unlink=True)
    return donor


def components(bm):
    """Faces joined by shared vertices, after the flat-shading splits are welded."""
    bm.faces.ensure_lookup_table()
    seen = set()
    groups = []
    for face in bm.faces:
        if face.index in seen:
            continue
        seen.add(face.index)
        stack = [face]
        group = []
        while stack:
            current = stack.pop()
            group.append(current)
            for vert in current.verts:
                for other in vert.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        groups.append(group)
    return groups


def bounds(faces):
    points = [vert.co for face in faces for vert in face.verts]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    return low, high


def classify(faces, materials):
    """Decide which moving part a welded component belongs to."""
    low, high = bounds(faces)
    center = (low + high) / 2
    size = high - low
    names = {materials[face.material_index] for face in faces}
    only_black = names == {'Black_Motor'}
    for part, axle in (('wheel_front', FRONT_AXLE), ('wheel_rear', REAR_AXLE)):
        near_axle = math.hypot(center.y - axle.y, center.z - axle.z) < 0.35
        if only_black and abs(center.x) < 0.1 and near_axle:
            return part
    if center.y < -1.0 or (size.x > 1.5 and center.z > 0.6):
        return 'steer'
    return 'body'


def surface(faces, materials, part):
    """Matte palette per face: tyres are rubber, saddles leather, pipes rust."""
    low, high = bounds(faces)
    center = (low + high) / 2
    size = high - low
    tyre = part.startswith('wheel') and size.y > 1.0 and size.z > 1.0
    saddle = part == 'body' and center.z > 0.25 and size.x > 0.6
    exhaust = part == 'body' and center.y > 1.9 and size.x > 0.9 and size.z < 0.15
    result = []
    for face in faces:
        source = materials[face.material_index]
        if source == 'Green_Motor':
            result.append('olive')
        elif source == 'Yellow_Motor':
            result.append('headlight')
        elif source == 'Red_Motor':
            result.append('taillight')
        elif source == 'Silver_Motor':
            result.append('rust' if exhaust else 'steel')
        elif tyre:
            result.append('rubber')
        elif saddle:
            result.append('leather')
        else:
            result.append('blackMetal')
    return result


def make_material(name):
    color, roughness, metallic = PALETTE[name]
    material = bpy.data.materials.new('moto_' + name)
    material.use_nodes = True
    shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1.0)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    material.diffuse_color = (*color, 1.0)
    return material


def build_part(name, source_bm, face_indices, face_surfaces, materials_by_name, pivot, basis):
    """Copy the chosen faces into their own object, expressed around its pivot."""
    bm = source_bm.copy()
    bm.faces.index_update()
    keep = set(face_indices)
    surface_by_face = dict(zip(face_indices, face_surfaces))
    slots = sorted(set(face_surfaces))
    slot_index = {surface_name: index for index, surface_name in enumerate(slots)}
    for face in bm.faces:
        if face.index in keep:
            face.material_index = slot_index[surface_by_face[face.index]]
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.index not in keep], context='FACES')
    loose = [vert for vert in bm.verts if not vert.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    inverse = basis.inverted()
    for vert in bm.verts:
        vert.co = inverse @ (to_game(vert.co) - pivot)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    for surface_name in slots:
        mesh.materials.append(materials_by_name[surface_name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def place(obj, parent, world_position, world_rotation=None):
    """Parent with an identity inverse so the glTF node keeps the local transform."""
    world = Matrix.Translation(world_position)
    if world_rotation is not None:
        world = world @ world_rotation.to_matrix().to_4x4()
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = parent.matrix_world.inverted() @ world
    else:
        obj.matrix_basis = world
    bpy.context.view_layer.update()


def add_empty(name, parent, world_position):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = 'PLAIN_AXES'
    empty.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(empty)
    place(empty, parent, world_position)
    return empty


def main():
    args = parse_args()
    donor = import_donor(Path(args.source))
    materials = [material.name for material in donor.data.materials]
    bm = bmesh.new()
    bm.from_mesh(donor.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()

    parts = {'body': ([], []), 'steer': ([], []), 'wheel_front': ([], []), 'wheel_rear': ([], [])}
    for faces in components(bm):
        part = classify(faces, materials)
        indices, surfaces = parts[part]
        indices.extend(face.index for face in faces)
        surfaces.extend(surface(faces, materials, part))
    for part, (indices, _) in parts.items():
        if not indices:
            raise RuntimeError(f'part {part} is empty: the donor changed')

    materials_by_name = {name: make_material(name) for name in PALETTE}
    steer_rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(STEER_AXIS)
    steer_pivot = to_game(STEER_POINT)
    identity = Matrix.Identity(3)
    steer_basis = steer_rotation.to_matrix()

    root = bpy.data.objects.new('vehicle_motorcycle', None)
    bpy.context.scene.collection.objects.link(root)
    root.matrix_basis = Matrix.Identity(4)

    body = build_part('body', bm, *parts['body'], materials_by_name, Vector(), identity)
    place(body, root, Vector())
    steer = build_part('steer', bm, *parts['steer'], materials_by_name, steer_pivot, steer_basis)
    place(steer, root, steer_pivot, steer_rotation)
    front = build_part('wheel_front', bm, *parts['wheel_front'], materials_by_name, to_game(FRONT_AXLE), identity)
    place(front, steer, to_game(FRONT_AXLE))
    rear = build_part('wheel_rear', bm, *parts['wheel_rear'], materials_by_name, to_game(REAR_AXLE), identity)
    place(rear, root, to_game(REAR_AXLE))
    bm.free()
    bpy.data.objects.remove(donor, do_unlink=True)

    for name, point in STEER_MARKERS.items():
        add_empty(name, steer, to_game(point))
    for name, point in BODY_MARKERS.items():
        add_empty(name, root, to_game(point))

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format='GLB', use_selection=False,
        export_yup=True, export_apply=False, export_animations=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_extras=False)

    triangles = 0
    for obj in (body, steer, front, rear):
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    points = [obj.matrix_world @ vert.co for obj in (body, steer, front, rear) for vert in obj.data.vertices]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    report = {
        'triangles': triangles,
        'partFaces': {part: len(indices) for part, (indices, _) in parts.items()},
        'boundsBlender': {'min': [round(v, 4) for v in low], 'max': [round(v, 4) for v in high]},
        'wheelRadius': round(WHEEL_RADIUS * SCALE, 4),
        'anchors': {name: [round(v, 4) for v in to_game(point)]
                    for name, point in {**STEER_MARKERS, **BODY_MARKERS}.items()},
        'axles': {'front': [round(v, 4) for v in to_game(FRONT_AXLE)],
                  'rear': [round(v, 4) for v in to_game(REAR_AXLE)]},
        'steer': {'pivot': [round(v, 4) for v in steer_pivot],
                  'axis': [round(v, 4) for v in STEER_AXIS]},
    }
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print('VEHICLE_REPORT ' + json.dumps(report))


main()
