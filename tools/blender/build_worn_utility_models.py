"""Fit existing licensed CC0 utility donors to all bodies and armor waists.

The belt strap changes circumference; canisters and detector parts stay rigid.
Every visible vertex follows the canonical pelvis, never a donor skeleton.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import build_free_equipment_models as gear
import build_free_armor_replacements as rig

ROOT = Path(__file__).resolve().parents[2]
ITEM_DIR = ROOT / 'public/assets/models/items/kromka'
ITEMS = {r['id']: r for r in json.loads((ITEM_DIR/'manifest.json').read_text(encoding='utf8'))['files']}
IDS = ['artifactDetectorMk1','artifactDetectorMk2','artifactDetectorMk3','artifactBelt2','artifactBelt3','artifactBelt4']
ARMORS = {'none': None, 'leather': 'equipment_leather_jacket',
    'metalArmor': 'equipment_metal_armor', 'ballisticVest': 'equipment_ballistic_vest',
    'combatArmor': 'equipment_combat_armor', 'heavyArmor': 'equipment_heavy_armor',
    'hazmatSuit': 'equipment_hazmat_suit', 'energySuit': 'equipment_energy_suit'}


def reference(file):
    return {'file': file.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}


def waist(points, z):
    band = [p for p in points if abs(p.z-z)<.08]
    lo, hi = rig.bounds(band)
    center = (lo+hi)*.5
    rx, ry = (hi.x-lo.x)*.5, (hi.y-lo.y)*.5
    # A fitted ellipse must enclose the corners as well as the axis extrema.
    factor = max(math.hypot((p.x-center.x)/rx,(p.y-center.y)/ry) for p in band)
    return center.x, center.y, rx*factor+.018, ry*factor+.018


def torso_points(obj):
    points=rig.evaluated_points(obj)
    return [p for p,v in zip(points,obj.data.vertices)
        if sum(g.weight for g in v.groups if obj.vertex_groups[g.group].name
            in ('pelvis','spine_01','spine_02','spine_03'))>.5]


def build_body(body_id, destination, review):
    gear.reset()
    body_file=ROOT/f'public/assets/models/characters/base/character_{body_id}.glb'
    character=rig.import_gltf(body_file)
    armature=next(o for o in character if o.type=='ARMATURE')
    armature.data.pose_position='REST'
    if armature.animation_data: armature.animation_data_clear()
    bpy.context.view_layer.update()
    body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
    body_points=rig.evaluated_points(body)
    height=(armature.matrix_world @ armature.data.bones['spine_01'].head_local).z-.02
    rows=[]
    for armor_id,prefix in ARMORS.items():
        refs=[reference(body_file)]
        armor_objects=[]
        points=torso_points(body)
        if prefix:
            armor_file=ROOT/f'public/assets/models/equipment/armor/{prefix}_{body_id}.glb'
            if armor_id in ('hazmatSuit','energySuit'):
                armor_file=ROOT/f'public/assets/models/equipment/suits-v2/equipment_{armor_id}_{body_id}.glb'
            refs.append(reference(armor_file))
            armor_objects=rig.import_gltf(armor_file)
            for obj in armor_objects:
                if obj.type=='ARMATURE': obj.data.pose_position='REST'
                if obj.animation_data: obj.animation_data_clear()
            bpy.context.view_layer.update()
            for obj in armor_objects:
                if obj.type=='MESH' and not rig.mesh_is_helper(obj): points.extend(torso_points(obj))
        # Some rigid armor plates use torso weights even on the arms. They
        # must not enlarge a waist belt to the character's full arm span.
        body_band=[p for p in body_points if abs(p.z-height)<.08]
        body_lo,body_hi=rig.bounds(body_band)
        points=[p for p in points if body_lo.x-.075<p.x<body_hi.x+.075
            and body_lo.y-.10<p.y<body_hi.y+.10]
        cx,cy,rx,ry=waist(points,height)
        print(f'UTILITY_FIT {body_id} {armor_id}: z={height:.3f}, radii={rx:.3f},{ry:.3f}',flush=True)
        for item_id in IDS:
            source=ITEM_DIR/f'item_{item_id}.glb'
            if hashlib.sha256(source.read_bytes()).hexdigest()!=ITEMS[item_id]['sha256']:
                raise RuntimeError('Stale source item manifest: '+item_id)
            imported=rig.import_gltf(source)
            bpy.context.view_layer.update()
            outputs=[]
            belt=item_id.startswith('artifactBelt')
            for original in imported:
                if original.type!='MESH' or rig.mesh_is_helper(original): continue
                obj=rig.bake_rest_mesh(original)
                lo,hi=rig.bounds(v.co for v in obj.data.vertices)
                center=(lo+hi)*.5
                if belt and 'WornLeatherBelt' in original.name:
                    for v in obj.data.vertices:
                        v.co=Vector((cx+v.co.x*rx/.18,cy+v.co.y*ry/.115,height+v.co.z))
                elif belt:
                    # Preserve each downloaded canister's dimensions. Only its
                    # mounting location follows the new belt circumference.
                    shift=Vector((cx+center.x*rx/.18,cy+center.y*ry/.115,height+center.z))-center
                    for v in obj.data.vertices: v.co+=shift
                else:
                    rotation=Matrix.Rotation(math.pi/2,4,'Z')
                    for v in obj.data.vertices:
                        v.co=rotation @ v.co+Vector((cx+rx+.040,cy-.03,height-.065))
                obj.name=f'utility_{item_id}_{body_id}_{armor_id}_{len(outputs)}'
                obj['realm_item_id']=item_id
                obj['realm_body_id']=body_id
                obj['realm_armor_fit']=armor_id
                obj['realm_source_license']='CC0-1.0'
                obj['realm_source_sha256']=ITEMS[item_id]['sha256']
                gear.world_skin(obj,armature,sample_weights=lambda p:[('pelvis',1.0)])
                outputs.append(obj)
            for obj in imported: bpy.data.objects.remove(obj,do_unlink=True)
            file=destination/f'equipment_{item_id}_{body_id}_{armor_id}.glb'
            rig.export_review(file,armature,outputs)
            rows.append({'itemId':item_id,'bodyId':body_id,'armorId':armor_id,
                'slot':'artifactBelt' if belt else 'detector',
                'file':'/assets/models/equipment/utilities-v1/'+file.name,
                'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size,
                'triangles':sum(rig.triangle_count(o) for o in outputs),'joints':len(armature.data.bones),
                'sourceItem':reference(source),'sources':ITEMS[item_id]['sources'],
                'fittingReferences':refs,'waist':{'height':height,'center':[cx,cy],'radii':[rx,ry]},
                'modifications':['body and armor waist fitting','rigid pelvis skin','rigid donor details']})
            if review and body_id=='male_medium' and item_id=='artifactBelt4' and armor_id in ('none','heavyArmor'):
                rig.prepare_review_body(character)
                rig.render_review(review/f'{item_id}_{armor_id}.png',rig.bounds(body_points),'front')
            for obj in outputs: bpy.data.objects.remove(obj,do_unlink=True)
        for obj in armor_objects: bpy.data.objects.remove(obj,do_unlink=True)
    return rows


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'public/assets/models/equipment/utilities-v1')
    parser.add_argument('--body',choices=rig.RUNTIME_BODY_IDS)
    parser.add_argument('--review',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.output=args.output.resolve()
    if args.review: args.review=args.review.resolve()
    args.output.mkdir(parents=True,exist_ok=True)
    if args.review: args.review.mkdir(parents=True,exist_ok=True)
    rows=[]
    for body in [args.body] if args.body else rig.RUNTIME_BODY_IDS:
        rows.extend(build_body(body,args.output,args.review))
    version='1-'+hashlib.sha256(''.join(r['sha256'] for r in rows).encode()).hexdigest()[:8]
    (args.output/'manifest.json').write_text(json.dumps({'schema':'realm.worn-utilities.v1',
        'version':version,'generator':'tools/blender/build_worn_utility_models.py','files':rows},
        ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'WORN_UTILITIES_BUILT={len(rows)} version={version}',flush=True)


if __name__=='__main__': main()
