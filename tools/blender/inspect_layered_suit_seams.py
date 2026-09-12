"""Read-only candidate seam diagnostic; writes only a report image in Logs."""
from pathlib import Path
import sys
import json
import bpy
import bmesh
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from check_free_gear_fit import surface

root=Path(__file__).resolve().parents[2]
entries=json.loads((root/'unity-client/Logs/UpperSuitCandidate/manifest.json').read_text())['files']
item=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--item=')),None)
body_id=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--body=')),None)
entry=next(e for e in entries if (not item or e['itemId']==item) and (not body_id or e['bodyId']==body_id))
bpy.ops.wm.read_factory_settings(use_empty=True)
body=rig.import_gltf(root/entry['bodyReference']['file'])
gear=rig.import_gltf(root/entry['candidateFile'])
for obj in body+gear:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
    if obj.animation_data:obj.animation_data_clear()
bpy.context.view_layer.update()
meshes=[o for o in gear if o.type=='MESH' and 'downloaded_shell' in o.name]
points,faces,bvh=surface(meshes)
sample=Vector((.0015108216,.0257732086,.9056760669))
normal=Vector((-.11429378,-.03345142,-.99288368))
if '--uncovered' in sys.argv:
    report=json.loads((root/'unity-client/Logs/layered-suit-upper-candidate-coverage.json').read_text())
    row=next(r for r in report['rows'] if r['itemId']==entry['itemId'] and r['bodyId']==entry['bodyId'] and r['boots']=='integrated')
    assert row['suitSha256']==entry['sha256'], 'Coverage is stale'
    index=next((int(a.split('=',1)[1]) for a in sys.argv if a.startswith('--example=')),0)
    sample=Vector(row['examples'][index]['point']); normal=Vector(row['examples'][index]['normal'])
if '--visible' in sys.argv:
    report=json.loads((root/f"unity-client/Logs/coverage-fit-{entry['itemId']}-{entry['bodyId']}.json").read_text())
    assert report['suitSha256']==entry['sha256'], 'Visibility report is stale'
    view=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--view=')),None)
    row=next(r for r in report['views'] if r['bareSkinRays'] and (view is None or r['view']==view))
    index=next((int(a.split('=',1)[1]) for a in sys.argv if a.startswith('--example=')),0)
    sample=Vector(row['examples'][index]['point']);normal=Vector(row['examples'][index]['normal'])
print('SEAM_SAMPLE',entry['itemId'],entry['bodyId'],list(sample),list(normal),flush=True)
print('SEAM_RAY',bvh.ray_cast(sample+normal*.001,normal,2),flush=True)
print('SEAM_REVERSE_RAY',bvh.ray_cast(sample-normal*.001,-normal,2),flush=True)
for direction in [normal,Vector((1,0,0)),Vector((-1,0,0)),Vector((0,1,0)),Vector((0,-1,0)),Vector((0,0,-1))]:
    start=sample+direction*.001;hits=[]
    for _ in range(24):
        hit,n,_,distance=bvh.ray_cast(start,direction,2)
        if hit is None:break
        hits.append((round((hit-sample).length,5),round(n.dot(direction),5)))
        start=hit+direction*.0001
    print('SEAM_CROSSINGS',list(direction),hits,flush=True)
near,norm,face,dist=bvh.find_nearest(sample)
print('NEAREST_FACE',list(near),list(norm),dist,[list(points[i]) for i in faces[face]],flush=True)
if len(meshes)==1:
    mesh_obj=meshes[0]
    polygon=mesh_obj.data.polygons[face]
    print('NEAREST_MATERIAL',mesh_obj.data.materials[polygon.material_index].name,flush=True)
    for vertex in polygon.vertices:
        adjacent={mesh_obj.data.materials[p.material_index].name for p in mesh_obj.data.polygons if vertex in p.vertices}
        print('NEAREST_VERTEX_MATERIALS',vertex,sorted(adjacent),flush=True)
mesh=bpy.data.meshes.new('diagnostic_topology');mesh.from_pydata(points,[],faces)
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
edges=[e for e in bm.edges if e.is_boundary and all(abs(v.co.x)<.12 and .7<v.co.z<1 for v in e.verts)]
print('CENTRAL_BOUNDARIES',len(edges),[[list(v.co) for v in e.verts] for e in edges[:20]],flush=True)
remaining={e for e in bm.edges if e.is_boundary};loops=[]
while remaining:
    group={remaining.pop()};todo=list(group)
    while todo:
        edge=todo.pop()
        adjacent={e for v in edge.verts for e in v.link_edges if e in remaining}
        remaining-=adjacent;group|=adjacent;todo.extend(adjacent)
    vertices={v for e in group for v in e.verts}
    loops.append((len(group),rig.bounds(v.co for v in vertices)))
print('BOUNDARY_LOOPS',[(n,list(lo),list(hi)) for n,(lo,hi) in loops],flush=True)
bm.free()
for obj in body:
    if obj.type=='MESH':obj.hide_render=True
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('seam_world');scene.world.color=(.04,.04,.04)
camera=bpy.data.objects.new('seam_camera',bpy.data.cameras.new('seam_camera'))
scene.collection.objects.link(camera);scene.camera=camera
camera.location=sample+normal*.55;rig.look_at(camera,sample)
camera.data.type='ORTHO';camera.data.ortho_scale=.42
for position in [(0,-.8,1.4),(.3,.4,.5)]:
    lamp=bpy.data.objects.new('seam_light',bpy.data.lights.new('seam_light','AREA'))
    scene.collection.objects.link(lamp);lamp.location=position;lamp.data.energy=35;lamp.data.shape='DISK';lamp.data.size=.7
    rig.look_at(lamp,Vector((0,0,.9)))
scene.render.filepath=str(root/f"unity-client/Logs/upper-candidate-seam-{entry['itemId']}-{entry['bodyId']}.png")
bpy.ops.render.render(write_still=True)
