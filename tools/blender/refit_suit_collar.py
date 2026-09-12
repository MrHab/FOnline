"""Preserve the downloaded collar's rings when fitting the player's neck."""
from mathutils import Vector
import build_free_armor_replacements as rig
from suit_enclosure import covered_body_faces


def refit_collar(shell,reference,body,armature,body_points,body_bvh):
    neck=armature.matrix_world@armature.data.bones['neck_01'].head_local
    head=armature.matrix_world@armature.data.bones['head'].head_local
    bottom=neck.z-.065
    selected=[(i,p) for i,p in enumerate(reference) if p.z>bottom and abs(p.x)<.145]
    if not selected:raise RuntimeError('No downloaded collar region')
    top=max(p.z for _,p in selected if abs(p.x)<.10)
    top_ring=[p for _,p in selected if abs(p.x)<.10 and p.z>top-.025]
    low,high=rig.bounds(top_ring)
    source_center=(low+high)*.5
    covered={i for face in covered_body_faces(body) for i in face}
    required=[body_points[i] for i in covered if abs(body_points[i].x)<.10 and body_points[i].z>neck.z]
    # The source rim is lower behind the neck than at the front. A single
    # highest-source vertex as the height anchor left that whole rear sector
    # below the required neck surface. Preserve its local ring spacing, but
    # anchor each angular sector's rim above the actual required skin.
    target_top=max(p.z for p in required)+.028
    required_sectors=[]
    for p in required:
        direction=Vector((p.x-neck.x,p.y-neck.y,0))
        if direction.length>.001:required_sectors.append((direction.normalized(),p.z))
    rim=[]
    for _,p in selected:
        radial=Vector((p.x-source_center.x,p.y-source_center.y,0))
        if abs(p.x)<.10 and p.z>top-.05 and radial.length>.018:
            rim.append((radial.normalized(),p.z))
    changed=0
    for index,p in selected:
        blend_z=max(0,min(1,(p.z-bottom)/.055))
        blend_x=max(0,min(1,(.145-abs(p.x))/.045))
        blend=blend_z*blend_x
        radial=Vector((p.x-source_center.x,p.y-source_center.y,0))
        radius=radial.length
        direction=radial.normalized() if radius>.000001 else Vector((0,1,0))
        local_top=max((z for d,z in rim if d.dot(direction)>.95),default=top)
        # Back-neck coverage must not raise the front onto the wearer's chin.
        local_target=max((z for d,z in required_sectors if d.dot(direction)>.9),default=target_top-.028)+.030
        # An elevated game camera sees over a low front rim into the neck
        # opening, even when outward skin-normal rays meet the side wall.
        # Raise the front/side rim coherently, tapering to zero at the back.
        local_target+=.012*max(0,min(1,(.6-direction.y)/1.2))
        z=bottom+(p.z-bottom)*(local_target-bottom)/max(local_top-bottom,.001)
        along=max(0,min(1,(z-neck.z)/max(head.z-neck.z,.001)))
        center=neck.lerp(head,along);center.z=z
        if radius<.018:
            # A source cap's centre is not a ring vertex. Sending it outward
            # creates the long spikes previously seen at the back of the neck.
            fitted=center+radial
        else:
            hit,normal,_,distance=body_bvh.ray_cast(center,direction,.25)
            if hit is None:continue
            clearance=.020/max(.65,abs(normal.dot(direction)))
            layer=min(.012,max(0,radius-.055))
            fitted=center+direction*(distance+clearance+layer)
        shell.data.vertices[index].co=shell.data.vertices[index].co.lerp(fitted,blend)
        changed+=1
    shell.data.update()
    print('COLLAR_REFIT',changed,'height',bottom,target_top,'source_top',top,flush=True)
