"""Regression cases for long interior rays versus entry into another garment."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(Path(__file__).parent))
from suit_enclosure import covered_body_faces, enclosure_hit, skin_surface_samples, exterior_boundary_normal, welded_surface_normals

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1.2)
obj=bpy.context.object
points=[v.co.copy() for v in obj.data.vertices]
faces=[tuple(f.vertices) for f in obj.data.polygons]
closed=BVHTree.FromPolygons(points,faces)
valid,result=enclosure_hit(closed,Vector(),Vector((1,0,0)),.3,3)
assert valid and result[3]>.5, 'A long ray inside clothing was mistaken for a hole'
other_leg=BVHTree.FromPolygons([p+Vector((1.5,0,0)) for p in points],faces)
valid,result=enclosure_hit(other_leg,Vector(),Vector((1,0,0)),.3,3)
assert not valid and result[0] is not None, 'Entering another garment must not count as enclosure'
open_faces=[f for f in faces if not all(points[i].x>.5 for i in f)]
opened=BVHTree.FromPolygons(points,open_faces)
valid,_=enclosure_hit(opened,Vector(),Vector((1,0,0)),.3,3)
assert not valid, 'An actual opening must still fail'
# A closed inner plate can be encountered before the enclosing coat wall.
# Its entry/exit pair contributes zero; the coat's exit contributes one.
plate=[p*.08+Vector((.45,0,0)) for p in points]
layered=BVHTree.FromPolygons(points+plate,faces+[tuple(i+len(points) for i in f) for f in faces])
valid,result=enclosure_hit(layered,Vector(),Vector((1,0,0)),.3,3)
assert valid and result[1].x<0 and result[3]>.3, 'A distant inner plate entry must not mask the actual outer sleeve exit'
open_layered=BVHTree.FromPolygons(points+plate,open_faces+[tuple(i+len(points) for i in f) for f in faces])
valid,_=enclosure_hit(open_layered,Vector(),Vector((1,0,0)),.3,3)
assert not valid, 'An inner plate alone must not conceal an open outer coat'
far_plate=BVHTree.FromPolygons(plate,faces)
valid,result=enclosure_hit(far_plate,Vector(),Vector((1,0,0)),.3,3)
assert not valid, 'A distant detached plate must not enclose the skin'
valid,_=enclosure_hit(layered,Vector((-1,0,0)),Vector((1,0,0)),.3,3)
assert not valid, 'A sample outside both volumes must fail even with multiple exits'
print('SUIT_ENCLOSURE_PASS: distant exit, other-volume entry, opening, layered interior, open layered coat, distant patch, outside layers',flush=True)

mesh=bpy.data.meshes.new('coverage_mask_probe')
mesh.from_pydata([(x,y,z) for z in (2.0,1.5,1.0) for x,y in ((0,0),(.1,0),(0,.1))],[],
                 [(0,1,2),(3,4,5),(6,7,8)])
mask_body=bpy.data.objects.new('coverage_mask_probe',mesh)
bpy.context.collection.objects.link(mask_body)
for name,ids in [('clavicle_l',[0,1,2]),('head',[3,4,5]),('hand_l',[6,7,8])]:
    mask_body.vertex_groups.new(name=name).add(ids,1.0,'REPLACE')
assert covered_body_faces(mask_body)==[(0,1,2)], 'Raised shoulders must remain covered; face/hands are excluded by ownership'
assert covered_body_faces(mask_body,exclude_hands=False)==[(0,1,2),(6,7,8)], 'Glove fitting must retain hand surfaces while excluding the face'
print('SUIT_MASK_PASS: raised shoulder included, face and hand excluded',flush=True)
triangle=[Vector((0,0,0)),Vector((1,0,0)),Vector((0,1,0))]
samples=skin_surface_samples((0,1,2),triangle,include_boundary=True)
assert len(samples)==10 and all(p in samples for p in triangle)
assert Vector((.5,.5,0)) in samples, 'The diagonal seam midpoint must be probed'
print('SUIT_SAMPLING_PASS: face interiors, vertices and seam midpoints',flush=True)

# A concave armpit analogue: the outward normal of one boundary face starts
# inside its neighbour. It travels along the sleeve and escapes its open cuff.
def prism(outline,height):
    count=len(outline)
    vertices=[Vector((x,y,z)) for z in (-height,height) for x,y in outline]
    polygons=[tuple(reversed(range(count))),tuple(range(count,count*2))]
    polygons += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return vertices,polygons

body_points,body_faces=prism([(0,0),(.04,0),(.04,.02),(.02,.02),(.03,.04),(0,.04)],.01)
body_tree=BVHTree.FromPolygons(body_points,body_faces)
point=Vector((.02,.02,0));primary=Vector((1,-.5,0)).normalized()
outward=Vector((.8,1,0)).normalized()
direction,changed=exterior_boundary_normal(body_tree,point,primary,outward)
assert changed and (direction-outward).length<1e-6, 'A concave inward-going boundary ray needs an exterior normal'
coat_points,coat_faces=prism([(-.004,-.004),(.05,-.004),(.05,.024),(.024,.024),(.034,.044),(-.004,.044)],.014)
open_cuff=[f for i,f in enumerate(coat_faces) if i!=3]
coat=BVHTree.FromPolygons(coat_points,open_cuff)
assert not enclosure_hit(coat,point,primary,.3,1)[0], 'Fixture must reproduce an interior ray escaping the cuff'
assert enclosure_hit(coat,point,direction,.3,1)[0], 'Exterior boundary ray must hit the intact armpit'
hole=BVHTree.FromPolygons(coat_points,[f for i,f in enumerate(coat_faces) if i not in (3,5)])
assert not enclosure_hit(hole,point,direction,.3,1)[0], 'Corrected boundary direction must still reject a real armpit hole'
assert not exterior_boundary_normal(body_tree,point,primary,primary)[1], 'An alternative still inside the body must be rejected'
assert not exterior_boundary_normal(body_tree,point,primary,-primary)[1], 'Back-facing alternative must be rejected'
ordinary=Vector((.04,.01,0));normal=Vector((1,0,0))
assert not exterior_boundary_normal(body_tree,ordinary,normal,outward)[1], 'Ordinary exterior samples must retain their face normals'
large_tree=BVHTree.FromPolygons([p*10 for p in body_points],body_faces)
assert not exterior_boundary_normal(large_tree,point*10,primary,outward)[1], 'A distant exit cannot justify a local boundary correction'
split_points=[body_points[i] for f in body_faces for i in f]
offset=0;split_faces=[]
for f in body_faces:
    split_faces.append(tuple(range(offset,offset+len(f))));offset+=len(f)
welded=welded_surface_normals(split_points,split_faces)
for i,p in enumerate(split_points):
    assert abs(welded[i].length-1)<1e-6
    for j,q in enumerate(split_points):
        if (p-q).length<1e-8:assert (welded[i]-welded[j]).length<1e-6, 'UV seams cannot change the exterior normal'
print('SUIT_CONCAVE_BOUNDARY_PASS: body-only correction, actual hole, inward/back-facing alternatives, ordinary normals, distant exit, split seams',flush=True)

from check_free_gear_fit import surface
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=10)
helper=bpy.context.object;helper.name='Icosphere.importer_bone_display'
sample_points,sample_faces,_=surface([obj,helper])
assert len(sample_points)==len(points) and len(sample_faces)==len(faces), 'Importer display helpers must not provide garment coverage'
print('SUIT_HELPER_EXCLUSION_PASS: importer display sphere cannot hide garment holes',flush=True)
