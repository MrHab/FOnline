"""Measure attachment/cloth separation in actual frame-bound Unity evidence."""
import json
from pathlib import Path
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[2]
folder = root / 'unity-client/Logs/UpperSuitUnityReview/runtime'
check = '--check' in sys.argv
report = json.loads((folder / 'report.json').read_text(encoding='utf-8-sig'))
failures = []
seen = 0
for file in sorted(folder.glob('*.skin.json')):
    snapshot = json.loads(file.read_text(encoding='utf-8-sig'))
    if check:
        assert snapshot['runId'] == report['runId'], 'Stale native attachment snapshot: ' + file.name
        assert snapshot['candidateVersion'] == report['servedSuitCatalogVersion'], 'Wrong snapshot catalog'
    seen += 1
    shell = next(m for m in snapshot['meshes'] if 'downloaded_shell' in m['name'])
    details = next(m for m in snapshot['meshes'] if 'details' in m['name'])
    triangles = list(zip(*[iter(shell['triangles'])]*3))
    rest = BVHTree.FromPolygons([Vector(p) for p in shell['rest']], triangles, all_triangles=True)
    posed = BVHTree.FromPolygons([Vector(p) for p in shell['posed']], triangles, all_triangles=True)
    records = []
    for i, (a, b) in enumerate(zip(details['rest'], details['posed'])):
        # Only details initially touching the garment, not a hood/visor beside
        # the exposed face or the deliberately projecting front of a module.
        rest_distance = rest.find_nearest(Vector(a))[3]
        if rest_distance > .02:
            continue
        posed_distance = posed.find_nearest(Vector(b))[3]
        weights = details['weights'][i]
        records.append({'vertex': i, 'rest': a, 'posed': b,
            'restGap': rest_distance, 'posedGap': posed_distance,
            'increase': posed_distance-rest_distance,
            'weights': [[details['bones'][weights[k]], weights[k+1]]
                for k in range(0,8,2) if weights[k+1] > 0]})
    records.sort(key=lambda row: row['increase'], reverse=True)
    if any(row['increase'] > .02 for row in records):
        failures.append(file.name)
    print(json.dumps({'file': file.name, 'runId': snapshot['runId'],
        'version': snapshot['candidateVersion'], 'nearClothVertices': len(records),
        'gapIncreasedOver2cm': sum(row['increase'] > .02 for row in records),
        'worst': records[:5]}, separators=(',', ':')), flush=True)
if check:
    assert seen == 3, 'Expected all three frame-bound attachment snapshots'
    assert not failures, 'Attachments separate by over 2 cm in native motion: ' + ', '.join(failures)
    print('NATIVE_ATTACHMENT_MOTION_PASS', report['runId'], report['servedSuitCatalogVersion'], flush=True)
