"""Regression: parenting a world-fitted mesh must not apply body size twice."""
from pathlib import Path
import sys
import bpy
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig

root = Path(__file__).resolve().parents[2]
for body_id in rig.BODY_IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = rig.import_gltf(root / f'public/assets/models/characters/base/character_{body_id}.glb')
    arm = next(o for o in objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'REST'
    for obj in objects:
        if obj.animation_data: obj.animation_data_clear()
    body = next(o for o in objects if o.type == 'MESH' and 'body_base' in o.name)
    # Test both the actual imported rig and a translated/rotated parent. A test
    # limited to an identity male_medium rig would miss the original defect.
    original_matrix = arm.matrix_world.copy()
    for transformed in (False, True):
        arm.matrix_world = (Matrix.Translation((.3, -.2, .17)) @ Matrix.Rotation(.37, 4, 'Z')
                            @ original_matrix) if transformed else original_matrix
        bpy.context.view_layer.update()
        tree, points, _, weights = rig.target_skin_data(body)
        chosen = points[::max(1, len(points) // 72)]
        mesh = bpy.data.meshes.new('world_binding_probe')
        mesh.from_pydata(chosen, [], [(0, 1, 2)])
        obj = bpy.data.objects.new('world_binding_probe', mesh)
        bpy.context.collection.objects.link(obj)
        rig.transfer_skin(obj, arm, tree, weights)
        bpy.context.view_layer.update()
        actual = rig.evaluated_points(obj)
        error = max((a - b).length for a, b in zip(actual, chosen))
        assert error < 2e-6, f'{body_id}: world binding moved vertices by {error}m'
        print('WORLD_BINDING_PASS', body_id, transformed, len(chosen), error, flush=True)
        bpy.data.objects.remove(obj, do_unlink=True)
