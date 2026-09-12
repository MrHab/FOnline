"""Compare a current bare-pixel ray with archived/current GLB and helper geometry."""
import sys,json,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from suit_surface_metrics import stress_surface

root=Path(__file__).resolve().parents[2]
body_id,item_id=sys.argv[-2:]
report=json.loads((root/f'unity-client/Logs/coverage-fit-arms-bent-hands-{item_id}-{body_id}.json').read_text())
directories=['unity-client/Logs/SuitClosedGloveProof-2-be760740','unity-client/Logs/UpperSuitCandidate']
for relative in directories:
    directory=root/relative;manifest=json.loads((directory/'manifest.json').read_text())
    entry=next(r for r in manifest['files'] if (r['bodyId'],r['itemId'])==(body_id,item_id))
    model=directory/Path(entry['candidateFile']).name
    assert hashlib.sha256(model.read_bytes()).hexdigest()==entry['sha256']
    if relative==directories[-1]:assert report['version']==manifest['version'] and report['suitSha256']==entry['sha256']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects=rig.import_gltf(model);arm=next(o for o in objects if o.type=='ARMATURE')
    for o in objects:
        if o.animation_data:o.animation_data_clear()
    arm.data.pose_position='REST';bpy.context.view_layer.update()
    surfaces={o:stress_surface(o,arm) for o in objects if o.type=='MESH'}
    camera=bpy.data.objects.new('probe_camera',bpy.data.cameras.new('probe_camera'))
    bpy.context.collection.objects.link(camera)
    for include_helpers in (False,True):
        points=[];faces=[]
        for obj,(vertices,triangles,_) in surfaces.items():
            if not include_helpers and rig.mesh_is_helper(obj):continue
            offset=len(points);points.extend(vertices)
            faces.extend(tuple(offset+i for i in f) for f in triangles)
        tree=BVHTree.FromPolygons(points,faces,all_triangles=True)
        results=[]
        for view in report['views']:
            positions={'front':(0,-3,1.4),'back':(0,3,1.4),'left':(3,0,1.4),'right':(-3,0,1.4),'underarm':(2,-3,.6)}
            camera.location=positions[view['view']];rig.look_at(camera,Vector((0,0,.94)))
            bpy.context.view_layer.update()
            forward=camera.matrix_world.to_quaternion()@Vector((0,0,-1))
            bare=0
            for example in view['examples']:
                x,y=[((v+.5)/1200-.5)*2.3 for v in example['pixel']]
                origin=camera.matrix_world@Vector((x,y,0))
                skin_depth=(Vector(example['point'])-origin).dot(forward)
                hit,_,_,distance=tree.ray_cast(origin,forward,10)
                bare+=int(hit is None or distance>skin_depth+.00005)
            results.append((view['view'],bare,len(view['examples'])))
        print('MODEL_VS_HELPER_OCCLUSION',manifest['version'],entry['sha256'],'includeHelpers',include_helpers,results,flush=True)
