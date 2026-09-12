"""Map versioned stress-view gaps back to the source body's rest faces."""
import sys,json,hashlib
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from suit_surface_metrics import stress_surface
from refit_suit_gloves import hand_groups

root=Path(__file__).resolve().parents[2]
body_id=sys.argv[-2];item_id=sys.argv[-1]
directory=root/'unity-client/Logs/UpperSuitCandidate'
manifest=json.loads((directory/'manifest.json').read_text())
entry=next(r for r in manifest['files'] if r['itemId']==item_id and r['bodyId']==body_id)
prefix='coverage-fit-arms-bent'+('-hands' if '--hands' in sys.argv else '')
report=json.loads((root/f'unity-client/Logs/{prefix}-{item_id}-{body_id}.json').read_text())
assert report['suitSha256']==entry['sha256']
assert hashlib.sha256((root/entry['candidateFile']).read_bytes()).hexdigest()==entry['sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
objects=rig.import_gltf(root/entry['bodyReference']['file'])
body=next(o for o in objects if o.type=='MESH' and 'body_base' in o.name)
arm=next(o for o in objects if o.type=='ARMATURE');arm.data.pose_position='REST'
bpy.context.view_layer.update()
points=rig.evaluated_points(body)
equipment=rig.import_gltf(root/entry['candidateFile'])
for obj in equipment:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
bpy.context.view_layer.update()
gear_points=[];gear_faces=[]
for obj in equipment:
    if obj.type!='MESH':continue
    offset=len(gear_points);gear_points.extend(rig.evaluated_points(obj));obj.data.calc_loop_triangles()
    gear_faces.extend(tuple(offset+i for i in t.vertices) for t in obj.data.loop_triangles)
gear_tree=BVHTree.FromPolygons(gear_points,gear_faces,all_triangles=True)
body_deltas={};gear_deltas={}
stress_surface(body,arm,body_deltas)
gear_arm=next(o for o in equipment if o.type=='ARMATURE')
stress_surface(next(o for o in equipment if o.type=='MESH'),gear_arm,gear_deltas)
for name in ('lowerarm_l','hand_l','thumb_03_l','thumb_04_leaf_l','pinky_04_leaf_l'):
    difference=max(abs(a-b) for ra,rb in zip(body_deltas[name],gear_deltas[name]) for a,b in zip(ra,rb))
    rigid=max(abs(a-b) for ra,rb in zip(body_deltas[name],body_deltas['lowerarm_l']) for a,b in zip(ra,rb))
    print('SKIN_DELTA_COMPARISON',name,'body_vs_gear',difference,'body_vs_forearm',rigid)
for obj,owner,deltas in [(body,arm,body_deltas)]+[(o,gear_arm,gear_deltas) for o in equipment if o.type=='MESH']:
    before=rig.evaluated_points(obj);after=stress_surface(obj,owner)[0]
    probes=[((after[i]-deltas['lowerarm_l']@p).length,i) for i,p in enumerate(before) if p.x>.80]
    if probes:
        error,index=max(probes)
        print('HAND_RIGID_RESIDUAL',obj.name,error,list(before[index]),
            [(obj.vertex_groups[g.group].name,g.weight) for g in obj.data.vertices[index].groups])
shoulder=arm.matrix_world@arm.data.bones['upperarm_l'].head_local
elbow=arm.matrix_world@arm.data.bones['lowerarm_l'].head_local
neck=arm.matrix_world@arm.data.bones['neck_01'].head_local
print('LANDMARKS',list(shoulder),list(elbow),list(neck))
indices=sorted(set(e['face'] for v in report['views'] for e in v['examples']))
for index in indices[:24]:
    face=body.data.polygons[index];center=sum((points[i] for i in face.vertices),Vector())/len(face.vertices)
    weights={}
    for i in face.vertices:
        for g in body.data.vertices[i].groups:
            name=body.vertex_groups[g.group].name
            weights[name]=weights.get(name,0)+g.weight/len(face.vertices)
    span=abs(center.x)<abs(shoulder.x)+.08 or abs(abs(center.x)-abs(elbow.x))<.11
    influence=sum(w for name,w in weights.items() if name.startswith(('clavicle_','upperarm_','lowerarm_')))
    side_chest=abs(shoulder.x)*.55<abs(center.x)<abs(shoulder.x)+.03 and shoulder.z-.18<center.z<neck.z-.03
    a,b,c=(points[i] for i in face.vertices[:3]);normal=(b-a).cross(c-a).normalized()
    nearest=gear_tree.find_nearest(center)
    corner_dots=[(gear_tree.find_nearest(points[i])[0]-points[i]).dot(normal) for i in face.vertices]
    print('GAP_SOURCE',index,list(center),{'armInfluence':influence,'jointSpan':span,'sideChest':side_chest,
        'nearestDistance':nearest[3],'outwardDot':(nearest[0]-center).dot(normal),'minimumCornerDot':min(corner_dots)},weights)
if '--hands' in sys.argv:
    probe=rig.bake_rest_mesh(body);groups=hand_groups(probe)
    influence=[sum(g.weight for g in v.groups if g.group in groups) for v in probe.data.vertices]
    rig.delete_faces(probe,lambda f,_:sum(influence[v.index] for v in f.verts)/len(f.verts)<.1)
    for tolerance in (1e-6,1e-5,1e-4):
        bm=bmesh.new();bm.from_mesh(probe.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=tolerance)
        edges=[e for e in bm.edges if len(e.link_faces)==1 and all(abs(v.co.x)>.80 for v in e.verts)]
        print('GLOVE_FINGER_BOUNDARIES',tolerance,len(edges),[list((e.verts[0].co+e.verts[1].co)/2) for e in edges[:8]])
        bm.free()
