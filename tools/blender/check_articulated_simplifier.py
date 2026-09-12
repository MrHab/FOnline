"""Regression: endpoint LOD retains source skin assignments and boundaries."""
import sys,math
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
sys.path.insert(0,str(Path(__file__).parent))
from suit_surface_metrics import triangle_surface,sampled_surface_error
from simplify_articulated_mesh import simplify_endpoints

bpy.ops.wm.read_factory_settings(use_empty=True)
vertices=[(ring/20,math.cos(side*math.tau/12)*.04,math.sin(side*math.tau/12)*.04)
          for ring in range(21) for side in range(12)]
faces=[]
for ring in range(20):
    for side in range(12):
        a=ring*12+side;b=ring*12+(side+1)%12;c=b+12;d=a+12
        faces.extend(((a,b,c),(a,c,d)))
mesh=bpy.data.meshes.new('sleeve');mesh.from_pydata(vertices,[],faces)
obj=bpy.data.objects.new('sleeve',mesh);bpy.context.collection.objects.link(obj)
upper=obj.vertex_groups.new(name='upperarm_l');lower=obj.vertex_groups.new(name='lowerarm_l')
source_weights={};posed=[]
rotation=Matrix.Rotation(1.2,4,'Z');pivot=Vector((.5,0,0))
for vertex in mesh.vertices:
    weight=max(0,min(1,(vertex.co.x-.35)/.3))
    upper.add([vertex.index],1-weight,'REPLACE');lower.add([vertex.index],weight,'REPLACE')
    source_weights[tuple(vertex.co)]=(1-weight,weight)
    posed.append(vertex.co.lerp(pivot+rotation@(vertex.co-pivot),weight))
bpy.context.view_layer.update();rest=triangle_surface(obj)
result=simplify_endpoints(obj,rest,(posed,rest[1],None),180,.003)
assert len(mesh.polygons)<=360,result
assert len(mesh.polygons)==result['expectedTriangles']
assert max(result['plannedSurfaceErrors'])<=.003,result
assert sampled_surface_error(rest,obj)<=.003
for vertex in mesh.vertices:
    assert tuple(vertex.co) in source_weights,'A retained endpoint moved'
    expected=source_weights[tuple(vertex.co)]
    assert abs(upper.weight(vertex.index)-expected[0])<1e-6
    assert abs(lower.weight(vertex.index)-expected[1])<1e-6
for point in vertices[:12]+vertices[-12:]:
    assert any((v.co-Vector(point)).length<1e-7 for v in mesh.vertices),'An overlap boundary moved'
print('ARTICULATED_SIMPLIFIER_PASS',result,flush=True)

mesh=bpy.data.meshes.new('tetrahedron')
mesh.from_pydata([(0,0,0),(.01,0,0),(0,.01,0),(0,0,.01)],[],[(0,2,1),(0,1,3),(1,2,3),(2,0,3)])
tetra=bpy.data.objects.new('tetrahedron',mesh);bpy.context.collection.objects.link(tetra)
tetra.vertex_groups.new(name='thigh_l').add(list(range(4)),1,'REPLACE')
bpy.context.view_layer.update();reference=triangle_surface(tetra)
result=simplify_endpoints(tetra,reference,reference,2,.1)
assert len(mesh.polygons)==4,'Closed tetrahedron cannot collapse into duplicate faces'
assert not mesh.validate(verbose=True),'Export must not need to remove duplicate faces'
print('ARTICULATED_CLOSED_COMPONENT_PASS',result,flush=True)
