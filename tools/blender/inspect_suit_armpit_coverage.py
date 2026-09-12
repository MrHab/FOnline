"""Inspect exact failed rest samples; no asset or coverage-rule changes."""
import sys,json,hashlib
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from suit_enclosure import enclosure_hit,skin_surface_samples

root=Path(__file__).resolve().parents[2]
body_id,item_id=sys.argv[-2:]
archive=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--archive=')),None)
directory=root/archive if archive else root/'unity-client/Logs/UpperSuitCandidate'
manifest=json.loads((directory/'manifest.json').read_text())
entry=next(r for r in manifest['files'] if (r['bodyId'],r['itemId'])==(body_id,item_id))
report=json.loads(((directory if archive else root/'unity-client/Logs')/'layered-suit-upper-candidate-coverage.json').read_text())
row=next(r for r in report['rows'] if (r['bodyId'],r['itemId'],r['boots'])==(body_id,item_id,'integrated'))
assert report['version']==manifest['version'] and row['suitSha256']==entry['sha256']
model_file=directory/Path(entry['candidateFile']).name if archive else root/entry['candidateFile']
assert hashlib.sha256(model_file.read_bytes()).hexdigest()==entry['sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
character=rig.import_gltf(root/entry['bodyReference']['file'])
gear=rig.import_gltf(model_file)
for obj in character+gear:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
    if obj.animation_data:obj.animation_data_clear()
bpy.context.view_layer.update()
body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
arm=next(o for o in character if o.type=='ARMATURE')
body_points=rig.evaluated_points(body)
body_tree=BVHTree.FromPolygons(body_points,[tuple(f.vertices) for f in body.data.polygons])
for obj in gear:
    if obj.type=='MESH':print('IMPORTED_MESH',obj.name,obj.hide_render,obj.hide_viewport,len(obj.data.polygons),dict(obj.items()))
def combined(objects):
    points=[];faces=[];labels=[]
    for obj in objects:
        if obj.type!='MESH':continue
        offset=len(points);points.extend(rig.evaluated_points(obj));obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            faces.append(tuple(offset+i for i in triangle.vertices))
            labels.append((obj.name,obj.data.materials[triangle.material_index].name if obj.data.materials else '<helper>'))
    return points,faces,BVHTree.FromPolygons(points,faces,all_triangles=True),labels
shoulder=arm.matrix_world@arm.data.bones['upperarm_l'].head_local
elbow=arm.matrix_world@arm.data.bones['lowerarm_l'].head_local
neck=arm.matrix_world@arm.data.bones['neck_01'].head_local
print('ORIGINAL_INSERT_SPANS','shoulderEndX',abs(shoulder.x)+.08,'elbowStartX',abs(elbow.x)-.11,flush=True)
print('GENERATED_INSERT_SPANS',entry.get('jointLiner',{}).get('spanBoundsMetres','not recorded in this older manifest'),flush=True)
for face in body.data.polygons:
    ids=tuple(face.vertices)
    center=sum((body_points[i] for i in ids),Vector())/len(ids)
    if not any((center-Vector(e['point'])).length<.05 for e in row['examples']):continue
    a,b,c=(body_points[i] for i in ids[:3]);own_normal=(b-a).cross(c-a).normalized()
    queried=body_tree.find_nearest(center)[1]
    for i,p in enumerate(skin_surface_samples(ids,body_points,True)):
        if any((p-Vector(e['point'])).length<2e-7 for e in row['examples']):
            print('EXACT_SAMPLE_OWNER',face.index,i,'ownNormal',list(own_normal),'queriedNormal',list(queried))
for label,objects in [('all',gear),('without_helpers',[o for o in gear if not rig.mesh_is_helper(o)])]:
    points,faces,tree,labels=combined(objects)
    for example in row['examples']:
        p=Vector(example['point']);normal=Vector(example['normal'])
        nearest=tree.find_nearest(p)
        print('SAMPLE',label,list(p),'nearest',nearest[3],labels[nearest[2]],'normalDot',(nearest[0]-p).dot(normal))
        print('ENCLOSURE',enclosure_hit(tree,p,normal,.3,4)[0])
        origin=p+normal*.001;cursor=origin.copy();crossings=[]
        for _ in range(12):
            hit,n,index,distance=tree.ray_cast(cursor,normal,4)
            if hit is None:break
            crossings.append(((hit-origin).dot(normal),n.dot(normal),labels[index]))
            cursor=hit+normal*.00001
        print('CROSSINGS',crossings)
        body_ray=body_tree.ray_cast(p+normal*.001,normal,4)
        print('BODY_FORWARD_HIT',list(body_ray[0]) if body_ray[0] is not None else None,body_ray[3],
              body_ray[1].dot(normal) if body_ray[1] is not None else None)
        if label=='without_helpers':
            cursor=p+normal*.00001
            for _ in range(12):
                hit,n,index,distance=body_tree.ray_cast(cursor,normal,4)
                if hit is None:break
                print('BODY_RAY_CROSSING',(hit-p).dot(normal),list(hit),n.dot(normal),index,flush=True)
                cursor=hit+normal*.00001
        for direction in [Vector((0,1,0)),Vector((0,-1,0)),Vector((0,0,1)),Vector((0,0,-1))]:
            hit,n,idx,d=tree.ray_cast(p,direction,4)
            print('CARDINAL_EXIT',list(direction),d,labels[idx] if hit is not None else None)
        source=body_tree.find_nearest(p);face=body.data.polygons[source[2]]
        center=sum((body_points[i] for i in face.vertices),Vector())/len(face.vertices)
        groups={}
        for i in face.vertices:
            for g in body.data.vertices[i].groups:
                name=body.vertex_groups[g.group].name;groups[name]=groups.get(name,0)+g.weight/len(face.vertices)
        print('BODY_FACE',source[2],list(center),'shoulder',list(shoulder),'neck',list(neck),'weights',groups)
probe=rig.bake_rest_mesh(body)
bm=bmesh.new();bm.from_mesh(probe.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
boundary=[e for e in bm.edges if e.is_boundary];by_vertex={}
for edge in boundary:
    for v in edge.verts:by_vertex.setdefault(v,set()).add(edge)
remaining=set(boundary)
while remaining:
    component={remaining.pop()};pending=list(component)
    while pending:
        edge=pending.pop()
        for vertex in edge.verts:
            for other in by_vertex[vertex]&remaining:
                remaining.remove(other);component.add(other);pending.append(other)
    vertices={v for edge in component for v in edge.verts}
    distance=min((v.co-Vector(e['point'])).length for v in vertices for e in row['examples'])
    if distance<.04:
        lo,hi=rig.bounds(v.co for v in vertices)
        print('NEARBY_SOURCE_BOUNDARY',len(component),distance,list(lo),list(hi))
bm.free()

shell=next(o for o in gear if o.type=='MESH' and 'downloaded_shell' in o.name)
probe=rig.bake_rest_mesh(shell)
bm=bmesh.new();bm.from_mesh(probe.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
bm.normal_update()
boundary=[e for e in bm.edges if e.is_boundary]
def edge_distance(edge,p):
    a,b=(v.co for v in edge.verts);d=b-a
    return (p-(a+d*max(0,min(1,(p-a).dot(d)/d.length_squared)))).length
for example in row['examples']:
    p=Vector(example['point']);normal=Vector(example['normal'])
    for edge in sorted(boundary,key=lambda e:edge_distance(e,p))[:5]:
        print('NEAREST_FINISHED_BOUNDARY',list(p),edge_distance(edge,p),[list(v.co) for v in edge.verts],flush=True)
    # A ray can run out of the edge of an open under-sleeve insert even where
    # no external skin is visible. Record the actual path through the body.
    for advance in (.00001,.001,.005,.01,.02,.04,.08,.16,.32):
        q=p+normal*advance
        nearest=body_tree.find_nearest(q)
        print('BODY_PATH',advance,'distance',nearest[3],'signedNearest',(q-nearest[0]).dot(nearest[1]),flush=True)
bm.free()
