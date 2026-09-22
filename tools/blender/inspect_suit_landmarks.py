"""Read-only landmarks and source bounds used to diagnose suit retargeting."""
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig
root = Path(__file__).resolve().parents[2]
for label, file in [('source', root / 'Build/SourceDownloads/free-armor-replacements-20260908/quaternius_male_spacesuit.gltf'),
                    ('initial', root / 'unity-client/Temp/LayeredSuitReview/docs/art/reviews/unified-equipment-hazmat-suit-v1/suit/equipment_hazmat_suit_unified_v1_female_medium.glb'),
                    ('target', root / 'public/assets/models/characters/base/character_female_medium.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = rig.import_gltf(file)
    arm = next(o for o in objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'REST'
    for obj in objects:
        if obj.animation_data: obj.animation_data_clear()
    bpy.context.view_layer.update()
    print('RIG_MATRIX', label, [list(r) for r in arm.matrix_world], flush=True)
    for bone in arm.data.bones:
        if bone.name in ('Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Wrist.L',
                         'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l'):
            print('LANDMARK', label, bone.name, list(arm.matrix_world @ bone.head_local), list(arm.matrix_world @ bone.tail_local), flush=True)
    for obj in objects:
        if obj.type != 'MESH': continue
        points = rig.evaluated_points(obj)
        print('BOUNDS', label, obj.name, [list(p) for p in rig.bounds(points)], flush=True)
        if label == 'source' and 'spacesuit_body' in obj.name.lower():
            for group in obj.vertex_groups:
                subset = [points[v.index] for v in obj.data.vertices if any(m.group == group.index and m.weight > .8 for m in v.groups)]
                if subset: print('GROUP_BOUNDS', group.name, [list(p) for p in rig.bounds(subset)], flush=True)
