"""Read-only world-space connected-part inventory of the current candidate."""
import json
from pathlib import Path
import sys
import bpy
import bmesh
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from refit_suit_details import islands

root=Path(__file__).resolve().parents[2]
item=next(a.split('=',1)[1] for a in sys.argv if a.startswith('--item='))
body=next(a.split('=',1)[1] for a in sys.argv if a.startswith('--body='))
manifest=json.loads((root/'unity-client/Logs/UpperSuitCandidate/manifest.json').read_text())
entry=next(e for e in manifest['files'] if e['itemId']==item and e['bodyId']==body)
bpy.ops.wm.read_factory_settings(use_empty=True)
objects=rig.import_gltf(root/entry['candidateFile'])
for obj in objects:
    if obj.type=='ARMATURE':obj.data.pose_position='REST'
    if obj.animation_data:obj.animation_data_clear()
bpy.context.view_layer.update()
for obj in objects:
    if obj.type!='MESH' or 'downloaded_shell' in obj.name or 'builtin_footwear' in obj.name:continue
    copy=rig.bake_rest_mesh(obj)
    bm=bmesh.new();bm.from_mesh(copy.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bm.to_mesh(copy.data);bm.free()
    for index,group in enumerate(islands(copy.data)):
        low,high=rig.bounds(copy.data.vertices[i].co for i in group)
        ids=set(group)
        materials={copy.data.materials[p.material_index].name for p in copy.data.polygons if all(i in ids for i in p.vertices)}
        print('DETAIL_PART',json.dumps({'index':index,'vertices':len(group),'center':list((low+high)*.5),
            'size':list(high-low),'materials':sorted(materials)}),flush=True)
