"""Render actual suit/body geometry in a common rest pose; never writes assets."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig
from suit_enclosure import covered_body_faces

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', action='store_true')
    parser.add_argument('--body', required=True, choices=rig.BODY_IDS)
    parser.add_argument('--item', required=True, choices=['hazmatSuit', 'energySuit'])
    parser.add_argument('--highlight-body', action='store_true')
    parser.add_argument('--initial-fit', action='store_true')
    parser.add_argument('--coverage-body', action='store_true')
    parser.add_argument('--include-hands', action='store_true', help='Also require gloves to cover the base hands')
    parser.add_argument('--pose', choices=['rest','arms-bent'], default='rest')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.include_hands and not args.coverage_body:parser.error('--include-hands requires --coverage-body')
    directory = ROOT / ('unity-client/Logs/UpperSuitCandidate' if args.candidate
                        else 'public/assets/models/equipment/suits-v2')
    manifest = json.loads((directory / 'manifest.json').read_text())
    entry = next(r for r in manifest['files'] if r['itemId'] == args.item and r['bodyId'] == args.body)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    character = rig.import_gltf(ROOT / entry['bodyReference']['file'])
    model = ROOT / entry['candidateFile'] if args.candidate else ROOT / ('public' + entry['file'])
    if args.initial_fit:
        spec = next(s for s in rig.SPECS if s.item_id == args.item)
        model = ROOT / 'unity-client/Temp/LayeredSuitReview/docs/art/reviews' / spec.output_folder / f'{spec.output_prefix}_{args.body}.glb'
    model_hash=hashlib.sha256(model.read_bytes()).hexdigest()
    if not args.initial_fit:assert model_hash==entry['sha256'], 'Render model does not match its manifest'
    assert hashlib.sha256((ROOT/entry['bodyReference']['file']).read_bytes()).hexdigest()==entry['bodyReference']['sha256'], 'Render body reference is stale'
    equipment = rig.import_gltf(model)
    for obj in character + equipment:
        if obj.type == 'ARMATURE': obj.data.pose_position = 'REST'
        if obj.animation_data: obj.animation_data_clear()
    if args.pose=='arms-bent':
        # A reproducible deformation stress pose, not a substitute for Unity's
        # procedural reload. Apply identical world-space rotations to both rigs.
        for armature in [o for o in character+equipment if o.type=='ARMATURE']:
            armature.data.pose_position='POSE'
            for bone in armature.pose.bones:bone.matrix_basis=Matrix.Identity(4)
            bpy.context.view_layer.update()
            for name,angle,axis in [('upperarm_l',1.0,'Y'),('upperarm_r',-1.0,'Y'),
                ('lowerarm_l',-1.2,'Z'),('lowerarm_r',1.2,'Z')]:
                bone=armature.pose.bones[name]
                pivot=armature.matrix_world@bone.head
                rotation=Matrix.Translation(pivot)@Matrix.Rotation(angle,4,axis)@Matrix.Translation(-pivot)
                bone.matrix=armature.matrix_world.inverted()@rotation@armature.matrix_world@bone.matrix
                bpy.context.view_layer.update()
    if args.highlight_body:
        mat = bpy.data.materials.new('diagnostic_body_magenta')
        mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, .015, .18, 1)
        for obj in character:
            if obj.type == 'MESH':
                obj.data.materials.clear()
                obj.data.materials.append(mat)
    if args.coverage_body:
        neutral=bpy.data.materials.new('diagnostic_excluded_skin')
        neutral.diffuse_color=(.15,.15,.15,1)
        pink=bpy.data.materials.new('diagnostic_required_skin')
        pink.use_nodes=True
        shader=pink.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value=(1,0,.2,1)
        shader.inputs['Emission Color'].default_value=(1,0,.2,1)
        shader.inputs['Emission Strength'].default_value=1
        for obj in character:
            if obj.type!='MESH':continue
            required=set(covered_body_faces(obj,exclude_hands=not args.include_hands)) if 'body_base' in obj.name else set()
            obj.data.materials.clear();obj.data.materials.append(neutral);obj.data.materials.append(pink)
            for face in obj.data.polygons:face.material_index=1 if tuple(face.vertices) in required else 0
    bpy.context.view_layer.update()
    def mesh_surface(objects):
        points=[];faces=[]
        for obj in objects:
            if rig.mesh_is_helper(obj):continue
            offset=len(points);points.extend(rig.evaluated_points(obj))
            faces.extend(tuple(offset+i for i in f.vertices) for f in obj.data.polygons)
        return BVHTree.FromPolygons(points,faces)
    required_body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
    skin_tree=mesh_surface([required_body])
    garment_tree=mesh_surface(equipment)
    visibility=[]
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1200 if args.coverage_body else 720
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('fit_review_world')
    scene.world.color = (.08, .08, .08)
    scene.view_settings.view_transform = 'Standard'
    target = Vector((0, 0, .94 if args.coverage_body else 1.30))
    camera = bpy.data.objects.new('fit_review_camera', bpy.data.cameras.new('fit_review_camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.3 if args.coverage_body else 2.12
    for position in [(-1, -2, 3), (1, 2, 3)]:
        lamp = bpy.data.objects.new('fit_review_light', bpy.data.lights.new('fit_review_light', 'AREA'))
        scene.collection.objects.link(lamp)
        lamp.location = position
        lamp.data.energy = 150
        lamp.data.shape = 'DISK'
        lamp.data.size = 3
        rig.look_at(lamp, target)
    views=[('front', (0, -3, 1.4)), ('back', (0, 3, 1.4))]
    if args.coverage_body:views += [('left',(3,0,1.4)),('right',(-3,0,1.4)),('underarm',(2,-3,.6))]
    for name, position in views:
        camera.location = position
        rig.look_at(camera, target)
        prefix = 'coverage-fit' if args.coverage_body else 'initial-fit' if args.initial_fit else 'fit'
        if args.pose!='rest':prefix += '-'+args.pose
        if args.include_hands:prefix += '-hands'
        path = ROOT / 'unity-client/Logs' / f'{prefix}-{args.item}-{args.body}-{name}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        print('FIT_RENDER', 'initial-fit' if args.initial_fit else manifest['version'], model_hash, path, flush=True)
        if args.coverage_body:
            rendered=bpy.data.images.load(str(path),check_existing=False)
            pixels=list(rendered.pixels)
            # Diagnostic only: counts are view-dependent and include boundary
            # aliasing. Inspect the pictures; this is not a replacement for the
            # geometric audit or the animated Unity probe.
            exposed=sum(1 for r,g,b in zip(pixels[0::4],pixels[1::4],pixels[2::4]) if r>.7 and g<.15 and b>.2)
            print('VISIBLE_REQUIRED_SKIN_PIXELS',name,exposed,flush=True)
            bare=[]
            forward=camera.matrix_world.to_quaternion()@Vector((0,0,-1))
            for index in range(rendered.size[0]*rendered.size[1]):
                r,g,b=pixels[index*4:index*4+3]
                if not (r>.7 and g<.15 and b>.2):continue
                x=((index%rendered.size[0]+.5)/rendered.size[0]-.5)*camera.data.ortho_scale
                y=((index//rendered.size[0]+.5)/rendered.size[1]-.5)*camera.data.ortho_scale
                origin=camera.matrix_world@Vector((x,y,0))
                hit,normal,face,distance=skin_tree.ray_cast(origin,forward,10)
                if hit is None or required_body.data.polygons[face].material_index!=1:continue
                cover=garment_tree.ray_cast(origin,forward,10)
                # Glass may show diagnostic skin through an intact visor.
                # Compare actual depths to distinguish that from a bare seam.
                if cover[0] is None or cover[3]>distance+.00005:
                    bare.append({'point':list(hit),'normal':list(normal),'face':face,'pixel':[index%rendered.size[0],index//rendered.size[0]]})
            print('VISIBLE_BARE_SKIN_RAYS',name,len(bare),flush=True)
            visibility.append({'view':name,'magentaPixels':exposed,'bareSkinRays':len(bare),'examples':bare[:256]})
            bpy.data.images.remove(rendered)
    if args.coverage_body:
        prefix='coverage-fit'+('-'+args.pose if args.pose!='rest' else '')
        if args.include_hands:prefix += '-hands'
        report=ROOT/'unity-client/Logs'/f'{prefix}-{args.item}-{args.body}.json'
        report.write_text(json.dumps({'schema':'realm.suit-visibility.v1','version':manifest['version'],
            'pose':args.pose,'unityAnimationApproval':False,
            'includesHands':args.include_hands,
            'suitSha256':model_hash,'bodySha256':entry['bodyReference']['sha256'],
            'views':visibility},indent=2)+'\n')


if __name__ == '__main__': main()
