"""Inspect cloth topology around versioned rear-seam skin exposure; no asset writes."""
import sys,json,hashlib
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig

root=Path(__file__).resolve().parents[2]
body_id,item_id=sys.argv[-2:]
directory=root/'unity-client/Logs/UpperSuitCandidate'
manifest=json.loads((directory/'manifest.json').read_text())
entry=next(r for r in manifest['files'] if (r['bodyId'],r['itemId'])==(body_id,item_id))
report=json.loads((root/f'unity-client/Logs/coverage-fit-arms-bent-hands-{item_id}-{body_id}.json').read_text())
assert report['version']==manifest['version'] and report['suitSha256']==entry['sha256']
assert hashlib.sha256((root/entry['candidateFile']).read_bytes()).hexdigest()==entry['sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
character=rig.import_gltf(root/entry['bodyReference']['file']);equipment=rig.import_gltf(root/entry['candidateFile'])
for obj in character+equipment:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
    if obj.animation_data:obj.animation_data_clear()
bpy.context.view_layer.update()
body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
armature=next(o for o in character if o.type=='ARMATURE')
body_points=rig.evaluated_points(body)
shell=next(o for o in equipment if o.type=='MESH' and 'downloaded_shell' in o.name)
probe=rig.bake_rest_mesh(shell);bm=bmesh.new();bm.from_mesh(probe.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bm.normal_update();bm.faces.ensure_lookup_table()
tree=BVHTree.FromBMesh(bm);boundary=[e for e in bm.edges if e.is_boundary]
def edge_distance(edge,p):
    a,b=(v.co for v in edge.verts);d=b-a
    return (p-(a+d*max(0,min(1,(p-a).dot(d)/d.length_squared)))).length
for name in ('pelvis','thigh_l','calf_l'):print('LANDMARK',name,list(armature.matrix_world@armature.data.bones[name].head_local),flush=True)
for face_id in sorted({e['face'] for v in report['views'] for e in v['examples']}):
    face=body.data.polygons[face_id];p=sum((body_points[i] for i in face.vertices),Vector())/len(face.vertices)
    weights={}
    for i in face.vertices:
        for g in body.data.vertices[i].groups:
            name=body.vertex_groups[g.group].name;weights[name]=weights.get(name,0)+g.weight/len(face.vertices)
    nearest=tree.find_nearest(p)
    print('BARE_SOURCE_FACE',face_id,list(p),weights,'nearestCloth',nearest[3],list(nearest[0]),flush=True)
    for edge in sorted(boundary,key=lambda e:edge_distance(e,p))[:8]:
        print('CROTCH_BOUNDARY',edge_distance(edge,p),[list(v.co) for v in edge.verts],flush=True)
    for direction in (Vector((0,1,0)),Vector((0,-1,0)),Vector((1,0,0)),Vector((-1,0,0))):
        result=tree.ray_cast(p,direction,1)
        print('CROTCH_RAY',list(direction),result[3],list(result[0]) if result[0] is not None else None,flush=True)
for face in bm.faces:
    center=face.calc_center_median()
    if abs(center.x)<.035 and .76<center.z<.85 and -.06<center.y<.13:
        print('LOCAL_CLOTH_FACE',face.index,[list(v.co) for v in face.verts],
              probe.data.materials[face.material_index].name,list(face.normal),flush=True)
bm.free()
