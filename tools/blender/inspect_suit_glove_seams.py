"""Inspect finished glove topology at versioned bare-skin pixels, without writes."""
import sys,json,hashlib
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from refit_suit_gloves import hand_groups
from suit_surface_metrics import stress_surface

root=Path(__file__).resolve().parents[2]
body_id,item_id=sys.argv[-2:]
manifest=json.loads((root/'unity-client/Logs/UpperSuitCandidate/manifest.json').read_text())
entry=next(r for r in manifest['files'] if (r['bodyId'],r['itemId'])==(body_id,item_id))
report=json.loads((root/f'unity-client/Logs/coverage-fit-arms-bent-hands-{item_id}-{body_id}.json').read_text())
assert report['version']==manifest['version'] and report['suitSha256']==entry['sha256']
assert hashlib.sha256((root/entry['candidateFile']).read_bytes()).hexdigest()==entry['sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
character=rig.import_gltf(root/entry['bodyReference']['file'])
equipment=rig.import_gltf(root/entry['candidateFile'])
for obj in character+equipment:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
    if obj.animation_data:obj.animation_data_clear()
bpy.context.view_layer.update()
body=next(o for o in character if o.type=='MESH' and 'body_base' in o.name)
armature=next(o for o in character if o.type=='ARMATURE')
deltas={};stress_surface(body,armature,deltas)
shell=next(o for o in equipment if o.type=='MESH' and 'downloaded_shell' in o.name)
probe=rig.bake_rest_mesh(shell)
bm=bmesh.new();bm.from_mesh(probe.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
bm.normal_update();bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
points=[v.co.copy() for v in bm.verts]
tree=BVHTree.FromBMesh(bm)
group_ids=hand_groups(probe);deform=bm.verts.layers.deform.active
hand_weight=lambda v:sum(w for g,w in v[deform].items() if g in group_ids)
boundaries=[e for e in bm.edges if e.is_boundary and all(hand_weight(v)>.5 for v in e.verts)]
nonmanifold=[e for e in bm.edges if len(e.link_faces)>2 and all(hand_weight(v)>.5 for v in e.verts)]
print('FINISHED_GLOVE_TOPOLOGY','boundaryEdges',len(boundaries),'nonmanifoldEdges',len(nonmanifold),flush=True)
def edge_distance(edge,p):
    a,b=(v.co for v in edge.verts);delta=b-a
    t=max(0,min(1,(p-a).dot(delta)/delta.length_squared))
    return (p-(a+delta*t)).length
for view in report['views']:
    for example in view['examples']:
        posed=Vector(example['point']);side='l' if posed.x>0 else 'r'
        inverse=deltas['lowerarm_'+side].inverted()
        p=inverse@posed;n=(inverse.to_3x3()@Vector(example['normal'])).normalized()
        nearest=tree.find_nearest(p)
        edges=sorted(boundaries,key=lambda e:edge_distance(e,p))[:4]
        print('BARE_FINGERTIP',view['view'],example['face'],'point',list(p),'nearestDistance',nearest[3],
              'nearestDot',(nearest[0]-p).dot(n),'nearestFaceNormal',list(nearest[1]),flush=True)
        for e in edges:
            print('NEAREST_GLOVE_BOUNDARY',edge_distance(e,p),[list(v.co) for v in e.verts],flush=True)
        for label,direction in [('normal',n),('opposite',-n)]:
            hit,normal,face,distance=tree.ray_cast(p+direction*1e-5,direction,.05)
            print('GLOVE_RAY',label,distance,'normalDot',normal.dot(direction) if normal is not None else None,flush=True)
bm.free()

# Trace whether the copied body openings are actually sealed before inflation.
source=rig.bake_rest_mesh(body);groups=hand_groups(source)
influence=[sum(g.weight for g in v.groups if g.group in groups) for v in source.data.vertices]
rig.delete_faces(source,lambda f,_:sum(influence[v.index] for v in f.verts)/len(f.verts)<.1)
bm=bmesh.new();bm.from_mesh(source.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
deform=bm.verts.layers.deform.active
for attempt in range(4):
    boundary=[e for e in bm.edges if e.is_boundary];by_vertex={}
    for edge in boundary:
        for v in edge.verts:by_vertex.setdefault(v,set()).add(edge)
    remaining=set(boundary);added=[]
    while remaining:
        component={remaining.pop()};pending=list(component)
        while pending:
            for v in pending.pop().verts:
                for e in by_vertex[v]&remaining:
                    remaining.remove(e);component.add(e);pending.append(e)
        vertices={v for e in component for v in e.verts}
        owned=all(sum(w for g,w in v[deform].items() if g in groups)>.5 for v in vertices)
        if not owned:continue
        created=bmesh.ops.holes_fill(bm,edges=list(component),sides=0)['faces']
        added.extend(created)
        if len(component)>6 or not created:
            print('SOURCE_BOUNDARY_COMPONENT',attempt,len(component),'degrees',sorted(len(by_vertex[v]) for v in vertices),
                  'closedFaces',len(created),'bounds',[list(p) for p in rig.bounds(v.co for v in vertices)],flush=True)
        if not created and attempt==0:
            ordered=sorted(vertices,key=lambda v:tuple(v.co))
            local={v:i for i,v in enumerate(ordered)}
            print('UNFILLED_LOOP_VERTICES',[list(v.co) for v in ordered],flush=True)
            print('UNFILLED_LOOP_EDGES',[(local[e.verts[0]],local[e.verts[1]]) for e in component],flush=True)
            for face in set(f for e in component for f in e.link_faces):
                print('UNFILLED_ADJACENT_FACE',[local.get(v,-1) for v in face.verts],face.calc_area(),list(face.normal),flush=True)
    if added:bmesh.ops.triangulate(bm,faces=added)
    print('SOURCE_CLOSURE_ROUND',attempt,'added',len(added),'remainingHandEdges',sum(e.is_boundary and all(
        sum(w for g,w in v[deform].items() if g in groups)>.5 for v in e.verts) for e in bm.edges),flush=True)
bm.free()
