"""Measure collapsed triangles in fitted suit details without modifying assets."""
import hashlib
import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig

root = Path(__file__).resolve().parents[2]
manifest = json.loads((root/'unity-client/Logs/UpperSuitCandidate/manifest.json').read_text())
body = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--body=')), None)
item = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--item=')), None)
rows = []
for row in manifest['files']:
    if body and body != row['bodyId']: continue
    if item and item != row['itemId']: continue
    path = root/row['candidateFile']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = rig.import_gltf(path)
    for obj in objects:
        if obj.type == 'ARMATURE': obj.data.pose_position = 'REST'
        if obj.animation_data: obj.animation_data_clear()
    bpy.context.view_layer.update()
    for obj in objects:
        if obj.type != 'MESH': continue
        points = rig.evaluated_points(obj)
        obj.data.calc_loop_triangles()
        bad = []
        for triangle in obj.data.loop_triangles:
            a,b,c = (points[i] for i in triangle.vertices)
            area = (b-a).cross(c-a).length*.5
            if area < 1e-10:
                bad.append({'triangle': triangle.index, 'area': area,
                    'center': list((a+b+c)/3),
                    'material': obj.data.materials[triangle.material_index].name})
        evidence = {'itemId': row['itemId'], 'bodyId': row['bodyId'],
            'sha256': row['sha256'], 'mesh': obj.name,
            'triangles': len(obj.data.loop_triangles), 'collapsedTriangles': len(bad),
            'examples': bad[:24]}
        rows.append(evidence)
        print('DETAIL_TOPOLOGY', json.dumps(evidence), flush=True)
report = {'version': manifest['version'], 'minimumAreaSquareMetres': 1e-10, 'rows': rows}
(root/'unity-client/Logs/suit-detail-topology.json').write_text(json.dumps(report,indent=2)+'\n')
if any(r['collapsedTriangles'] for r in rows): raise RuntimeError('Collapsed suit triangles found')
