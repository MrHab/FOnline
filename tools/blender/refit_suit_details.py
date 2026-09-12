"""Refit retained accessory islands to the downloaded garment, not the old shell."""
import bpy
import bmesh
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import build_free_armor_replacements as rig
import build_free_equipment_models as gear


def islands(mesh):
    links={i:set() for i in range(len(mesh.vertices))}
    for edge in mesh.edges:
        a,b=edge.vertices;links[a].add(b);links[b].add(a)
    remaining=set(links);result=[]
    while remaining:
        group={remaining.pop()};pending=list(group)
        while pending:
            neighbours=links[pending.pop()] & remaining
            remaining-=neighbours;group|=neighbours;pending.extend(neighbours)
        result.append(sorted(group))
    return result


def surface(objects):
    points=[];faces=[]
    for obj in objects:
        start=len(points)
        points.extend(rig.evaluated_points(obj))
        faces.extend(tuple(start+i for i in face.vertices) for face in obj.data.polygons)
    return points,faces


def fit_retained(equipment,armature,body):
    shell=next(o for o in equipment if 'downloaded_shell' in o.name)
    support_points,support_faces=surface([shell])
    cloth=BVHTree.FromPolygons(support_points,support_faces)
    leg_cloth={side:BVHTree.FromPolygons(support_points,
        [f for f in support_faces if sum(support_points[i].x for i in f)*side>0]) for side in (-1,1)}
    body_tree,body_points,_,weights=rig.target_skin_data(body)
    sampler=gear.surface_weight_sampler(body,body_points,weights)
    _,cloth_points,_,cloth_weights=rig.target_skin_data(shell)
    cloth_sampler=gear.surface_weight_sampler(shell,cloth_points,cloth_weights)
    neck=(armature.matrix_world@armature.data.bones['neck_01'].head_local).z
    pelvis=(armature.matrix_world@armature.data.bones['pelvis'].head_local).z
    records=[]
    for original in list(equipment):
        if original==shell or 'builtin_footwear' in original.name:continue
        fitted=rig.bake_rest_mesh(original)
        for modifier in list(fitted.modifiers):fitted.modifiers.remove(modifier)
        bm=bmesh.new();bm.from_mesh(fitted.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bm.to_mesh(fitted.data);bm.free()
        # A long zipper/conduit must follow the coat along its length, not
        # remain a rigid bar touching only its two end points.
        flexible=set()
        for indices in islands(fitted.data):
            lo,hi=rig.bounds(fitted.data.vertices[i].co for i in indices)
            size=hi-lo
            if size.z>.15 and size.x<.045 and size.y<.065:flexible.update(indices)
        if flexible:
            bm=bmesh.new();bm.from_mesh(fitted.data);bm.verts.ensure_lookup_table()
            edges=[e for e in bm.edges if all(v.index in flexible for v in e.verts) and e.calc_length()>.035]
            if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=min(24,math.ceil(max(e.calc_length() for e in edges)/.035)-1),use_grid_fill=True)
            bm.to_mesh(fitted.data);bm.free()
        parts=[];removed=set()
        for indices in islands(fitted.data):
            low,high=rig.bounds(fitted.data.vertices[i].co for i in indices)
            size=high-low;center=(low+high)*.5
            wraps_center=low.x<-.075 and high.x>.075 and size.y>.15
            obsolete_yoke=wraps_center and .70<low.z<1.0 and high.z<1.15 and size.z>.10
            obsolete_cowl=wraps_center and neck-.14<center.z<neck+.15 and size.z<.17
            if obsolete_yoke or obsolete_cowl:
                removed.update(indices)
                records.append({'part':'obsolete_yoke' if obsolete_yoke else 'obsolete_cowl','vertices':len(indices),'removed':True})
                continue
            # Head/hood/respirator geometry remains aligned with the face. Only
            # the old redundant neck cowl above was removed from that assembly.
            if center.z>neck+.03:
                parts.append(('head',indices,low,high));continue
            # Circumferential seals are flexible; rigid plates and modules are
            # mounted from the front/back, preserving each island's shape.
            # The wrist gasket is a broad tube, not a thin bracelet. Its
            # axial width can be nearly its diameter on the slim body.
            arm_seal=abs(center.x)>.25 and len(indices)>=16 and min(size.y,size.z)>.035 and size.x<max(size.y,size.z)*1.25
            wraps=wraps_center or (size.z<.07 and size.x>.10 and size.y>.10) or arm_seal
            strip=size.z>.15 and size.x<.045 and size.y<.065
            parts.append(('band' if wraps else 'strip' if strip else 'panel',indices,low,high))

        for kind,indices,low,high in parts:
            if kind!='band':continue
            center=(low+high)*.5
            # Medial rays from a knee/ankle must stop on that leg. Using the
            # last hit of the whole suit stretched seals across BOTH legs.
            band_cloth=leg_cloth[1 if center.x>0 else -1] if center.z<pelvis and abs(center.x)>.03 else cloth
            for i in indices:
                p=fitted.data.vertices[i].co
                if abs(center.x)>.25:
                    origin=Vector((p.x,center.y,center.z));direction=Vector((0,p.y-center.y,p.z-center.z)).normalized()
                else:
                    origin=Vector((center.x,center.y,p.z));direction=Vector((p.x-center.x,p.y-center.y,0)).normalized()
                start=origin;last=None
                for _ in range(12):
                    hit,_,_,_=band_cloth.ray_cast(start,direction,.5)
                    if hit is None or (hit-origin).length>.5:break
                    last=hit;start=hit+direction*.0002
                if last is not None:p[:]=last+direction*.004

        # Place inner/backing pieces before the outward lenses and channels.
        # Previously placed pieces become supports, so a lens remains on its
        # housing instead of being flattened separately onto the garment.
        for side in (-1,1):
            panels=[p for p in parts if p[0] in ('panel','strip') and ((p[2].y+p[3].y)*.5<0)==(side<0)]
            panels.sort(key=lambda p:side*(p[2].y if side>0 else p[3].y))
            placed=[]
            for kind,indices,low,high in panels:
                support=BVHTree.FromPolygons(support_points,support_faces+placed)
                center=(low+high)*.5;size=high-low
                backing=low.y if side>0 else high.y
                backing_indices=[i for i in indices if abs(fitted.data.vertices[i].co.y-backing)<.00002]
                probes=[(center.x,center.z)]+[(center.x+size.x*x,center.z+size.z*z) for x,z in ((-.3,-.3),(.3,-.3),(-.3,.3),(.3,.3))]
                probes += [(fitted.data.vertices[i].co.x,fitted.data.vertices[i].co.z) for i in backing_indices]
                hits=[]
                for x,z in probes:
                    hit,_,_,_=support.ray_cast(Vector((x,side*2,z)),Vector((0,-side,0)),4)
                    if hit is not None:hits.append(hit.y)
                if not hits:raise RuntimeError('No clothing support for retained accessory '+original.name+' '+str(list(center)))
                # A curved shoulder can extend past the centre sample by more
                # than the module's thickness. Start its plane outside every
                # backing sample before conforming that back toward the cloth.
                # This preserves the front and prevents inverted side walls.
                target=max(hits,key=lambda y:side*y) if kind=='panel' else hits[0]
                delta=target+side*.001-backing
                for i in indices:fitted.data.vertices[i].co.y+=delta
                # Give flat modules a conforming backing. A rigid plane can
                # touch at one corner yet visibly hover over a curved coat.
                # The visible front stays intact; the rear surface follows the
                # cloth (or the underlying housing for stacked lenses).
                rear_adjustment=0.0
                for i in backing_indices:
                    p=fitted.data.vertices[i].co
                    hit,_,_,_=support.ray_cast(Vector((p.x,side*2,p.z)),Vector((0,-side,0)),4)
                    if hit is not None:
                        desired=hit.y+side*.001
                        rear_adjustment=max(rear_adjustment,abs(desired-p.y))
                        p.y=desired
                if kind=='strip':
                    for i in indices:
                        p=fitted.data.vertices[i].co
                        # Preserve section thickness; backing vertices were
                        # already conformed above, while front vertices still
                        # carry their original offset from the translated back.
                        depth=0 if i in backing_indices else p.y-(backing+delta)
                        hit,_,_,_=support.ray_cast(Vector((p.x,side*2,p.z)),Vector((0,-side,0)),4)
                        if hit is not None:p.y=hit.y+side*.001+depth
                component=set(indices)
                offset=len(support_points)
                local={index:offset+j for j,index in enumerate(indices)}
                support_points.extend(fitted.data.vertices[i].co.copy() for i in indices)
                placed.extend(tuple(local[i] for i in f.vertices) for f in fitted.data.polygons if all(i in component for i in f.vertices))
                records.append({'part':'flexible_strip' if kind=='strip' else 'panel','vertices':len(indices),'center':list(center),
                    'shiftY':delta,'supportY':target,'backingMaxAdjustment':rear_adjustment})
            # Support triangles belong to this side only; the next side's cast
            # sees the garment and its own inner-to-outer assembly sequence.

        if removed:
            bm=bmesh.new();bm.from_mesh(fitted.data);bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm,geom=[bm.verts[i] for i in sorted(removed)],context='VERTS')
            bm.to_mesh(fitted.data);bm.free()
        fitted.data.update()
        # Fitting a plate to cloth but sampling its skin from the naked body
        # gives the two surfaces different shoulder/spine blends. In native
        # reload/walk poses their initially 3 mm gap grew to almost 4 cm.
        # Transfer the fitted garment's weights to its attachments instead.
        # Keep the hood/respirator on its anatomical head binding, not the
        # nearest shoulder or collar. Classify after deletion so indices agree.
        head_vertices=set()
        for indices in islands(fitted.data):
            low,high=rig.bounds(fitted.data.vertices[i].co for i in indices)
            if (low.z+high.z)*.5>neck+.03:head_vertices.update(indices)
        def attachment_weights(vertex):
            return sampler(vertex.co) if vertex.index in head_vertices else cloth_sampler(vertex.co)
        name=original.name
        for key in original.keys():fitted[key]=original[key]
        equipment.remove(original);bpy.data.objects.remove(original,do_unlink=True)
        fitted.name=name
        gear.world_skin(fitted,armature,body_tree,weights,sample_vertex_weights=attachment_weights)
        fitted['realm_attachment_skin']='fitted-garment-surface-v1; anatomical head preserved'
        records.append({'part':'attachment_skin','method':'fitted-garment-surface-v1',
            'clothVertices':len(fitted.data.vertices)-len(head_vertices),'headVertices':len(head_vertices)})
        equipment.append(fitted)
    print('RETAINED_DETAIL_FIT',records,flush=True)
    return records
