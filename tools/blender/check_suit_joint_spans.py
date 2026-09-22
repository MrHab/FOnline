"""All body variants keep a continuous textile selection from shoulder to elbow."""
import sys,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from build_suit_joint_liner import sleeve_span_bounds,inside_sleeve_span

root=Path(__file__).resolve().parents[2]
for body_id in rig.RUNTIME_BODY_IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=root/f'public/assets/models/characters/base/character_{body_id}.glb'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    objects=rig.import_gltf(source)
    arm=next(o for o in objects if o.type=='ARMATURE');arm.data.pose_position='REST'
    bpy.context.view_layer.update()
    shoulder=arm.matrix_world@arm.data.bones['upperarm_l'].head_local
    elbow=arm.matrix_world@arm.data.bones['lowerarm_l'].head_local
    bounds=sleeve_span_bounds(shoulder.x,elbow.x)
    assert bounds[0]-bounds[1]>=.02-1e-8,'Shoulder/elbow selection must overlap'
    for side in (-1,1):
        for i in range(1001):
            x=side*(abs(shoulder.x)+(bounds[2]-abs(shoulder.x)-1e-5)*i/1000)
            assert inside_sleeve_span(x,bounds),'A gap remains between textile patches'
            if inside_sleeve_span(x,bounds,.02):
                assert inside_sleeve_span(x-side*.019,bounds) and inside_sleeve_span(x+side*.019,bounds),\
                    'Donor removal must remain inside the new textile overlap'
        assert not inside_sleeve_span(side*(bounds[2]+.001),bounds),'Do not extend elbow cloth onto hands'
    if body_id=='male_large':
        assert bounds[1]-(abs(shoulder.x)+.08)>.06,'Fixture must reproduce the diagnosed long-arm gap'
        body=next(o for o in objects if o.type=='MESH' and 'body_base' in o.name)
        points=rig.evaluated_points(body)
        tree=BVHTree.FromPolygons(points,[tuple(f.vertices) for f in body.data.polygons])
        p=Vector((.21291944,.01163990,1.43582737))
        n=Vector((.9864458,-.1637779,-.0100775)).normalized()
        entry=tree.ray_cast(p+n*.00001,n,1)
        hit=tree.ray_cast(entry[0]+n*.00001,n,1)
        assert hit[0] is not None and .30<hit[0].x<.32 and hit[1].dot(n)>0
        face=body.data.polygons[hit[2]]
        center=sum((points[i] for i in face.vertices),Vector())/len(face.vertices)
        assert inside_sleeve_span(center.x,bounds),'Previously exposed upper-arm face must be selected'
        groups={g.index for g in body.vertex_groups if g.name.startswith(('clavicle_','upperarm_','lowerarm_'))}
        ownership=sum(g.weight for i in face.vertices for g in body.data.vertices[i].groups if g.group in groups)/len(face.vertices)
        assert ownership>=.12,'The actual joint-textile ownership filter must include this face'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
    print('SLEEVE_SPAN_PASS',body_id,bounds,flush=True)
