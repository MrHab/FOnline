"""Regression: a non-planar quad's centre is not a surface sample."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from suit_surface_metrics import triangle_surface,sampled_surface_error,freeze_surface_triangles

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('nonplanar_reference')
mesh.from_pydata([(0,0,0),(1,0,0),(1,1,.04),(0,1,0)],[],[(0,1,2,3)])
obj=bpy.data.objects.new('nonplanar_reference',mesh);bpy.context.collection.objects.link(obj)
mesh.materials.append(bpy.data.materials.new('cloth'))
mesh.materials.append(bpy.data.materials.new('trim'))
mesh.polygons[0].material_index=1
uv=mesh.uv_layers.new(name='source_uv')
for loop in mesh.loops:uv.data[loop.index].uv=(loop.vertex_index*.2,loop.vertex_index*.1)
group=obj.vertex_groups.new(name='hand_l')
for vertex in mesh.vertices:group.add([vertex.index],.2*(vertex.index+1),'REPLACE')
bpy.context.view_layer.update()
reference=triangle_surface(obj)
false_sample=sum(reference[0],Vector())/4
old_error=reference[2].find_nearest(false_sample)[3]
unchanged=sampled_surface_error(reference,obj)
assert old_error>.009,old_error
assert unchanged<1e-6,unchanged
freeze_surface_triangles(obj)
frozen=sampled_surface_error(reference,obj)
assert frozen<1e-6,frozen
assert len(mesh.polygons)==2 and all(p.material_index==1 for p in mesh.polygons)
for loop in mesh.loops:
    assert (mesh.uv_layers['source_uv'].data[loop.index].uv-Vector((loop.vertex_index*.2,loop.vertex_index*.1))).length<1e-6
for vertex in mesh.vertices:assert abs(group.weight(vertex.index)-.2*(vertex.index+1))<1e-6
for vertex in mesh.vertices:vertex.co.z+=.012
mesh.update();bpy.context.view_layer.update()
changed=sampled_surface_error(reference,obj)
assert changed>.011,changed
print('SURFACE_METRIC_PASS',{'falseQuadCentreError':old_error,
    'unchangedSurfaceError':unchanged,'frozenSurfaceError':frozen,'realDeformationError':changed},flush=True)

# Redundant opposite triangles are invalid for export but cover the same
# double-sided cloth surface in every pose. Cleanup is explicit and opt-in.
mesh=bpy.data.meshes.new('opposite_duplicate')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,.2)],[],[(0,1,2),(0,2,1)])
duplicate=bpy.data.objects.new('opposite_duplicate',mesh);bpy.context.collection.objects.link(duplicate)
material=bpy.data.materials.new('two_sided_cloth');material.use_backface_culling=False
mesh.materials.append(material)
group=duplicate.vertex_groups.new(name='upperarm_l');group.add([0,1,2],1,'REPLACE')
bpy.context.view_layer.update();reference=triangle_surface(duplicate)
for one_sided in (True,False):
    material.use_backface_culling=one_sided
    try:
        freeze_surface_triangles(duplicate,deduplicate_double_sided=one_sided)
        raise AssertionError('Duplicate cleanup must reject one-sided materials and require explicit opt-in')
    except RuntimeError:pass
result=freeze_surface_triangles(duplicate,deduplicate_double_sided=True)
assert result['removedDuplicateTriangles']==1 and len(mesh.polygons)==1
assert not mesh.validate(verbose=True)
assert sampled_surface_error(reference,duplicate)<1e-6
assert [tuple(v.co) for v in mesh.vertices]==[tuple(p) for p in reference[0]]
assert all(abs(group.weight(v.index)-1)<1e-6 for v in mesh.vertices)
print('DUPLICATE_CLOTH_NORMALIZATION_PASS',result,flush=True)
