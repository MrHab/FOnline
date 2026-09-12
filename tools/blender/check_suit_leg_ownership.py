"""Crossed cloth vertices must retain their donor leg through fitting and skinning."""
import sys
from pathlib import Path
import bpy,bmesh
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
import build_free_equipment_models as gear
from fit_suit_leg_ownership import remember_source_legs,source_leg_side,leg_weight_sampler

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('two_legs')
mesh.from_pydata([(x,y,z) for x in (.1,-.1) for y,z in ((-.05,.6),(.05,.6),(.05,.8),(-.05,.8))],[],
                 [(0,1,2),(0,2,3),(4,6,5),(4,7,6)])
body=bpy.data.objects.new('body',mesh);bpy.context.collection.objects.link(body)
for side,indices in [('l',range(4)),('r',range(4,8))]:body.vertex_groups.new(name='thigh_'+side).add(list(indices),1,'REPLACE')
points=[v.co.copy() for v in mesh.vertices]
weights=[[('thigh_l' if i<4 else 'thigh_r',1.0)] for i in range(8)]
body_before=[tuple(p) for p in points]
cloth=bpy.data.objects.new('cloth',mesh.copy());bpy.context.collection.objects.link(cloth)
for side,indices in [('L',range(4)),('R',range(4,8))]:cloth.vertex_groups.new(name='UpperLeg.'+side).add(list(indices),1,'REPLACE')
remember_source_legs(cloth)
for vertex in cloth.data.vertices:vertex.co.x=-.03 if vertex.co.x>0 else .03
bm=bmesh.new();bm.from_mesh(cloth.data)
bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=1,use_grid_fill=True)
bm.to_mesh(cloth.data);bm.free()
assert all(source_leg_side(cloth,v.index)*v.co.x<0 for v in cloth.data.vertices), 'Fixture must cross both donor legs over the midline'
default=gear.surface_weight_sampler(body,points,weights)
sampler=leg_weight_sampler(cloth,body,points,weights,default)
for vertex in cloth.data.vertices:
    expected='thigh_l' if source_leg_side(cloth,vertex.index)>0 else 'thigh_r'
    assert max(default(vertex.co),key=lambda r:r[1])[0]!=expected, 'Nearest-position fixture must select the wrong leg'
    assert max(sampler(vertex),key=lambda r:r[1])[0]==expected, 'Source-side sampling must retain the correct leg'

arm=bpy.data.objects.new('rig',bpy.data.armatures.new('rig'));bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm;arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,x in [('thigh_l',.1),('thigh_r',-.1)]:
    bone=arm.data.edit_bones.new(name);bone.head=(x,0,.9);bone.tail=(x,0,.5)
bpy.ops.object.mode_set(mode='OBJECT');bpy.context.view_layer.update()
before=[v.co.copy() for v in cloth.data.vertices]
gear.world_skin(cloth,arm,sample_vertex_weights=sampler)
bpy.context.view_layer.update()
assert max((a-b).length for a,b in zip(before,rig.evaluated_points(cloth)))<1e-6
for vertex in cloth.data.vertices:
    expected='thigh_l' if source_leg_side(cloth,vertex.index)>0 else 'thigh_r'
    assert all(cloth.vertex_groups[g.group].name==expected for g in vertex.groups if g.weight>.001)
    assert abs(sum(g.weight for g in vertex.groups)-1)<1e-6
for name,angle in [('thigh_l',.65),('thigh_r',-.65)]:
    arm.pose.bones[name].rotation_mode='XYZ';arm.pose.bones[name].rotation_euler.x=angle
bpy.context.view_layer.update()
after=rig.evaluated_points(cloth)
for vertex,p in zip(cloth.data.vertices,after):
    name='thigh_l' if source_leg_side(cloth,vertex.index)>0 else 'thigh_r'
    expected=arm.pose.bones[name].matrix@arm.data.bones[name].matrix_local.inverted()@before[vertex.index]
    assert (p-expected).length<1e-6,'Cloth followed the opposite leg during the split-step pose'
assert body_before==[tuple(v.co) for v in body.data.vertices]
assert not cloth.data.validate(verbose=True),'Source labels or skinning created invalid mesh data'
print('SUIT_LEG_OWNERSHIP_PASS: crossed labels, subdivision, surface sampling, unchanged rest geometry, opposite leg poses and base body',flush=True)
