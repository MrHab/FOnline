"""Inspect candidate boot coverage against the actual base body, without hiding skin."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig
ROOT = Path(__file__).resolve().parents[2]


def surface(objects):
    points, faces = [], []
    for obj in objects:
        # glTF importer bone-display helpers are not exported garment geometry.
        if rig.mesh_is_helper(obj): continue
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        offset = len(points)
        points += [evaluated.matrix_world @ v.co for v in mesh.vertices]
        faces += [tuple(offset+i for i in p.vertices) for p in mesh.polygons]
        evaluated.to_mesh_clear()
    return points, faces, BVHTree.FromPolygons(points, faces)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--body', action='append', choices=rig.RUNTIME_BODY_IDS)
    parser.add_argument('--report',type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    directory = args.directory.resolve()
    if args.report: args.report=args.report.resolve()
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'))
    rows = []
    for body_id in args.body or list(rig.RUNTIME_BODY_IDS):
      for item in ['boots','scoutBoots','reinforcedBoots','assaultBoots']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        character = rig.import_gltf(ROOT/f'public/assets/models/characters/base/character_{body_id}.glb')
        equipment = rig.import_gltf(directory/f'equipment_{item}_{body_id}.glb')
        for obj in character+equipment:
            if obj.type == 'ARMATURE': obj.data.pose_position = 'REST'
            if obj.animation_data: obj.animation_data_clear()
        bpy.context.view_layer.update()
        body = next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
        boots = [o for o in equipment if o.type=='MESH' and not rig.mesh_is_helper(o)]
        body_points, body_faces, body_bvh = surface([body])
        boot_points, _, boot_bvh = surface(boots)
        halves={side:surface([obj for obj in boots if rig.bounds(rig.evaluated_points(obj))[0].x*side>0
            or rig.bounds(rig.evaluated_points(obj))[1].x*side>0])[2] for side in (-1,1)}
        row = {'itemId':item, 'bodyId':body_id,
            'modelSha256':hashlib.sha256((directory/f'equipment_{item}_{body_id}.glb').read_bytes()).hexdigest(),
            'baseBodySha256':hashlib.sha256((ROOT/f'public/assets/models/characters/base/character_{body_id}.glb').read_bytes()).hexdigest(),
            'slices':[]}
        for low,high in [(0,.07),(.07,.13),(.13,.20),(.20,.26)]:
            bounds = {}
            for name,points in [('body',body_points),('boot',boot_points)]:
                filtered = [p for p in points if low<=p.z<high and p.x>0]
                if filtered: bounds[name] = [[round(v,4) for v in b] for b in rig.bounds(filtered)]
            row['slices'].append({'z':[low,high],**bounds})
        # Samples over the skin triangles; outward ray must encounter the boot.
        total = missing = 0
        missing_points=[]
        for face in body_faces:
            center = sum((body_points[i] for i in face),Vector())/len(face)
            if center.z > .17: continue
            normal = body_bvh.find_nearest(center)[1]
            for point in [center]+[(center+body_points[i])*.5 for i in face]:
                total += 1
                # Some toe-crease normals point across the forefoot. Follow the
                # ray to the same boot's far wall, never to the opposite boot.
                hit = halves[1 if point.x>0 else -1].ray_cast(point+normal*.001, normal, .5)[0]
                if hit is None:
                    missing += 1
                    if len(missing_points)<10: missing_points.append({'point':list(point),'normal':list(normal)})
        row['footSurfaceSamples'] = total
        row['uncoveredSamples'] = missing
        row['missingExamples'] = missing_points
        rows.append(row)
        if args.render:
            for obj in character:
                if obj.type=='MESH': obj.hide_render = True
            bb = rig.bounds(boot_points)
            rig.render_review(directory/f'{item}_{body_id}_isolated.png',bb,'front')
    print('BOOT_FIT_INSPECTION='+json.dumps(rows))
    if args.report:
        args.report.write_text(json.dumps({'schema':'realm.free-boot-coverage.v2','catalogVersion':manifest['version'],'rows':rows},indent=2)+'\n')
    if any(row['uncoveredSamples'] for row in rows):
        raise RuntimeError('Body surface protrudes through a boot; see coverage report')


if __name__ == '__main__': main()
