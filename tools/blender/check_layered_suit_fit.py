"""Verify suit skin coverage, including upper-body checks and boot swaps."""
import hashlib
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from check_free_gear_fit import surface
from suit_enclosure import covered_body_faces, enclosure_hit, skin_surface_samples, welded_surface_normals, exterior_boundary_normal

ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'public/assets/models/equipment/suits-v2'

def main():
    global DEST
    if '--candidate' in sys.argv:DEST=ROOT/'unity-client/Logs/UpperSuitCandidate'
    rows=[]
    upper_body='--upper-body' in sys.argv
    manifest=json.loads((DEST/'manifest.json').read_text())
    for entry in manifest['files']:
        assert 0<entry['triangles']<12000, 'Suit triangle budget: '+entry['itemId']+'/'+entry['bodyId']
        bpy.ops.wm.read_factory_settings(use_empty=True)
        body_id=entry['bodyId']
        model_file=ROOT/entry['candidateFile'] if '--candidate' in sys.argv else ROOT/('public'+entry['file'])
        assert hashlib.sha256(model_file.read_bytes()).hexdigest()==entry['sha256']
        assert hashlib.sha256((ROOT/entry['bodyReference']['file']).read_bytes()).hexdigest()==entry['bodyReference']['sha256']
        character=rig.import_gltf(ROOT/entry['bodyReference']['file'])
        equipment=rig.import_gltf(model_file)
        for o in character+equipment:
            if o.type=='ARMATURE':o.data.pose_position='REST'
            if o.animation_data:o.animation_data_clear()
        bpy.context.view_layer.update()
        body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
        armature=next(o for o in character if o.type=='ARMATURE')
        knee_height=max((armature.matrix_world@armature.data.bones['calf_'+side].head_local).z for side in ('l','r'))
        pelvis_height=(armature.matrix_world@armature.data.bones['pelvis'].head_local).z
        shoulder_width=max(abs((armature.matrix_world@armature.data.bones['upperarm_'+side].head_local).x) for side in ('l','r'))
        body_points,body_faces,body_bvh=surface([body])
        smooth_normals=welded_surface_normals(body_points,body_faces) if upper_body else None
        if upper_body:body_faces=covered_body_faces(body)
        prepared=[];redirected=0
        for face in body_faces:
            center=sum((body_points[i] for i in face),Vector())/len(face)
            if not upper_body and center.z>.85:continue
            a,b,c=(body_points[i] for i in face[:3]);normal=(b-a).cross(c-a).normalized()
            probes=skin_surface_samples(face,body_points,include_boundary=upper_body)
            alternatives=[normal]*(1+len(face))
            if upper_body:
                alternatives += [smooth_normals[i] for i in face]
                alternatives += [(smooth_normals[a]+smooth_normals[b]).normalized()
                    for a,b in zip(face,face[1:]+face[:1])]
            for p,alternative in zip(probes,alternatives):
                direction,changed=exterior_boundary_normal(body_bvh,p,normal,alternative) if upper_body else (normal,False)
                prepared.append((p,direction));redirected+=int(changed)
        suit_meshes=[o for o in equipment if not rig.mesh_is_helper(o)]
        for boot in ['integrated','boots','scoutBoots','reinforcedBoots','assaultBoots']:
            boot_objects=[]
            boot_hash=None
            if boot=='integrated': meshes=suit_meshes
            else:
                boot_objects=rig.import_gltf(ROOT/f'public/assets/models/equipment/free-v2/equipment_{boot}_{body_id}.glb')
                boot_hash=hashlib.sha256((ROOT/f'public/assets/models/equipment/free-v2/equipment_{boot}_{body_id}.glb').read_bytes()).hexdigest()
                for o in boot_objects:
                    if o.type=='ARMATURE':o.data.pose_position='REST'
                    if o.animation_data:o.animation_data_clear()
                bpy.context.view_layer.update()
                meshes=[o for o in suit_meshes if 'builtin_footwear' not in o.name]+[o for o in boot_objects if not rig.mesh_is_helper(o)]
            points,faces,whole=surface(meshes)
            low,high=rig.bounds(points)
            halves={side:BVHTree.FromPolygons(points,[f for f in faces if sum(points[i].x for i in f)*side>0]) for side in (-1,1)}
            samples=missing=0; examples=[]; missing_bands={}; distant_pelvis_exits=0; distant_upper_exits=0
            zones={name:{'samples':0,'uncovered':0} for name in ('foot','calf','thigh','pelvis','torso','arms')}
            for p,normal in prepared:
                samples+=1
                zone_name=('arms' if abs(p.x)>shoulder_width else 'torso') if p.z>pelvis_height else (
                    'pelvis' if p.z>.85 else 'foot' if p.z<.17 else 'calf' if p.z<=knee_height else 'thigh')
                zone=zones[zone_name]
                zone['samples']+=1
                # Feet/calves are separate garment volumes; a far wall on
                # the opposite leg cannot cover them. Above the knees,
                # loose trousers can form one pelvis volume across the
                # midline, especially when the wearer's thighs touch.
                enclosure=whole if p.z>knee_height else halves[1 if p.x>0 else -1]
                # A downward ray inside loose trousers may exit below the knee.
                # The pelvis belongs to the trouser enclosure, not the short
                # sleeve/torso shell. Derive that boundary from the actual rig.
                near_limit=.3 if p.z>pelvis_height or zone_name=='pelvis' else .5
                exit_valid,(hit,hit_normal,_,distance)=enclosure_hit(enclosure,p,normal,near_limit,(high-low).length+.01)
                distant_pelvis=zone_name=='pelvis' and hit is not None and distance>.3
                if distant_pelvis and exit_valid:distant_pelvis_exits+=1
                if p.z>pelvis_height and hit is not None and distance>.3 and exit_valid:distant_upper_exits+=1
                if hit is None or not exit_valid:
                    missing+=1
                    zone['uncovered']+=1
                    band=f'{int(p.z*20)/20:.2f}'
                    missing_bands[band]=missing_bands.get(band,0)+1
                    # Keep a bounded but useful set: twelve armpit samples
                    # used to hide every later neck failure from diagnostics.
                    if len(examples)<96:examples.append({'point':list(p),'normal':list(normal)})
            rows.append({'itemId':entry['itemId'],'bodyId':body_id,'boots':boot,
                'suitSha256':entry['sha256'],'bodySha256':entry['bodyReference']['sha256'],
                'bootSha256':boot_hash,'kneeHeight':knee_height,'pelvisHeight':pelvis_height,
                'distantPelvisExits':distant_pelvis_exits,'distantUpperExits':distant_upper_exits,'zones':zones,
                'redirectedConcaveBoundarySamples':redirected,
                'surfaceSamples':samples,'uncoveredSamples':missing,'uncoveredHeightBands':missing_bands,'examples':examples})
            print('SUIT_COVERAGE',entry['itemId'],body_id,boot,samples,missing,flush=True)
            for o in boot_objects:bpy.data.objects.remove(o,do_unlink=True)
    report=ROOT/('unity-client/Logs/layered-suit-upper-candidate-coverage.json' if '--candidate' in sys.argv else
        'unity-client/Logs/layered-suit-upper-coverage.json' if upper_body else 'unity-client/Temp/layered-suit-coverage.json')
    report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps({'schema':'realm.layered-suit-coverage.v2','version':manifest['version'],
        'upperBodyIncluded':upper_body,'coverageMask':'skin-ownership-v1' if upper_body else 'lower-height-v1',
        'enclosureMethod':'near-surface-layered-rays-v2',
        'surfaceSampling':'face-interior-vertex-edge-exterior-normal-v3' if upper_body else 'face-interior-v1','rows':rows},indent=2)+'\n')
    if any(r['uncoveredSamples'] for r in rows):raise RuntimeError('Skin protrudes through suit/boots; inspect '+str(report))

if __name__=='__main__':main()
