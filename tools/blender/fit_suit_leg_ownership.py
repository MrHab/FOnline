"""Preserve donor trouser-leg ownership across midline-crossing cloth fitting."""
LEG_SIDE='realm_source_leg_side'


def remember_source_legs(obj):
    """Store source-side labels before body-width fitting can cross the midline.

    Point attributes survive the generated mesh's subdivision, simplification,
    material joins and canonical skin replacement. They are not runtime bones.
    """
    attribute=obj.data.attributes.new(LEG_SIDE,'FLOAT','POINT')
    for vertex in obj.data.vertices:
        left=right=0.0
        for g in vertex.groups:
            name=obj.vertex_groups[g.group].name
            if name.startswith(('UpperLeg.','LowerLeg.','Foot.','PT.')):
                if name.endswith('.L'):left+=g.weight
                elif name.endswith('.R'):right+=g.weight
        total=left+right
        attribute.data[vertex.index].value=(left-right)/total if total>.05 else (
            1.0 if vertex.co.x>1e-6 else -1.0 if vertex.co.x<-1e-6 else 0.0)


def source_leg_side(obj,index):
    attribute=obj.data.attributes.get(LEG_SIDE)
    if attribute is None:raise RuntimeError('Source trouser-leg ownership was lost')
    return attribute.data[index].value


def leg_weight_sampler(obj,body,points,weights,default_sampler):
    """Sample the original leg's skin even if its loose cloth crosses x=0."""
    import build_free_equipment_models as gear
    body.data.calc_loop_triangles()
    triangles=[tuple(t.vertices) for t in body.data.loop_triangles]
    surfaces={}
    for side in (-1,1):
        faces=[f for f in triangles if sum(points[i].x for i in f)*side>1e-8]
        surfaces[side]=gear.surface_weight_sampler(body,points,weights,triangles=faces)
    def sample(vertex):
        side=source_leg_side(obj,vertex.index)
        if vertex.co.z>=.94 or abs(side)<.5:return default_sampler(vertex.co)
        return surfaces[1 if side>0 else -1](vertex.co)
    return sample
