"""Seal only the two known internal arm creases; preserve every other boundary."""
import sys,hashlib
from pathlib import Path
import bpy,bmesh
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from build_suit_joint_liner import seal_upperarm_slits

root=Path(__file__).resolve().parents[2]
for body_id in rig.RUNTIME_BODY_IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=root/f'public/assets/models/characters/base/character_{body_id}.glb'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    objects=rig.import_gltf(source)
    arm=next(o for o in objects if o.type=='ARMATURE');arm.data.pose_position='REST'
    bpy.context.view_layer.update()
    body=next(o for o in objects if o.type=='MESH' and 'body_base' in o.name)
    original=[tuple(v.co) for v in body.data.vertices]
    cloth=rig.bake_rest_mesh(body)
    bm=bmesh.new();bm.from_mesh(cloth.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    positions={v:tuple(v.co) for v in bm.verts}
    boundary={e for e in bm.edges if e.is_boundary}
    groups={g.index for g in cloth.vertex_groups if g.name.startswith(('clavicle_','upperarm_','lowerarm_'))}
    shoulder=arm.matrix_world@arm.data.bones['upperarm_l'].head_local
    elbow=arm.matrix_world@arm.data.bones['lowerarm_l'].head_local
    result=seal_upperarm_slits(bm,groups,shoulder.x,elbow.x)
    print('UPPERARM_SLIT_RESULT',body_id,result,flush=True)
    expected=2 if body_id.startswith('female') else 0
    assert result['closedSourceSlits']==expected,'Only the known mirrored source creases should close'
    assert result['addedTriangles']==expected*3
    assert all(v.is_valid and tuple(v.co)==p for v,p in positions.items()),'Do not move body-derived cloth corners'
    assert all(e.is_valid for e in boundary),'Do not discard source edges'
    assert sum(not e.is_boundary for e in boundary)==expected*5,'Do not close any other source boundary'
    test=bpy.data.meshes.new('sealed_upperarm_test');bm.to_mesh(test)
    assert not test.validate(verbose=True),'Source-crease caps must not duplicate triangles'
    bpy.data.meshes.remove(test);bm.free()
    assert [tuple(v.co) for v in body.data.vertices]==original
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
    print('UPPERARM_SLIT_PASS',body_id,flush=True)
