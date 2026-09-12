"""Diagnose the original disconnected textile selection, without writing assets."""
import sys
from pathlib import Path
import bpy,bmesh
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig

root=Path(__file__).resolve().parents[2]
body_id=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
objects=rig.import_gltf(root/f'public/assets/models/characters/base/character_{body_id}.glb')
arm=next(o for o in objects if o.type=='ARMATURE');arm.data.pose_position='REST'
bpy.context.view_layer.update()
body=next(o for o in objects if o.type=='MESH' and 'body_base' in o.name)
liner=rig.bake_rest_mesh(body)
names={g.index:g.name for g in liner.vertex_groups}
influence=[sum(g.weight for g in v.groups if names[g.group].startswith(('clavicle_','upperarm_','lowerarm_')))
    for v in liner.data.vertices]
shoulder=arm.matrix_world@arm.data.bones['upperarm_l'].head_local
elbow=arm.matrix_world@arm.data.bones['lowerarm_l'].head_local
neck=(arm.matrix_world@arm.data.bones['neck_01'].head_local).z
def outside(face,_):
    p=face.calc_center_median()
    side_chest=abs(shoulder.x)*.55<abs(p.x)<abs(shoulder.x)+.03 and shoulder.z-.18<p.z<neck-.03
    span=abs(p.x)<abs(shoulder.x)+.08 or abs(abs(p.x)-abs(elbow.x))<.11
    return not (side_chest or span and sum(influence[v.index] for v in face.verts)/len(face.verts)>=.12)
rig.delete_faces(liner,outside)
bm=bmesh.new();bm.from_mesh(liner.data)
def audit(stage):
    test=bpy.data.meshes.new('textile_validation');bm.to_mesh(test)
    before=(len(test.vertices),len(test.polygons))
    result=test.validate(verbose=True)
    print('TEXTILE_STAGE',stage,before,'invalid',result,flush=True)
    if result:
        seen={}
        for face in bm.faces:
            key=frozenset(face.verts)
            if key in seen:print('DUPLICATE_TEXTILE',stage,[list(v.co) for v in face.verts],flush=True)
            seen[key]=face
    bpy.data.meshes.remove(test)
audit('selected')
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bm.normal_update()
audit('welded')
for v in bm.verts:v.co+=v.normal*(.008+.004*max(0,1-abs(abs(v.co.x)-abs(elbow.x))/.06))
audit('offset')
deform=bm.verts.layers.deform.active
def same_weights(vertices):
    rows=[dict(v[deform]) for v in vertices];keys=set().union(*rows)
    return all(max(r.get(k,0) for r in rows)-min(r.get(k,0) for r in rows)<1e-6 for k in keys)
edges=[e for e in bm.edges if len(e.link_faces)==2 and e.calc_face_angle()<.0001
    and same_weights(set(v for f in e.link_faces for v in f.verts))]
if edges:bmesh.ops.dissolve_edges(bm,edges=edges,use_verts=True,use_face_split=False)
audit('dissolved')
bmesh.ops.triangulate(bm,faces=list(bm.faces));audit('triangulated')
bm.free()
