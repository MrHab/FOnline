using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>A continuous freight formation, with physical tunnel lining and viaduct decks.</summary>
    public sealed class RoaSectorRailInfrastructure : MonoBehaviour
    {
        public const string CoverName="RailTunnelTerrainCover";
        public static int TerrainSegments(RoaSectorSurface.Profile profile)=>profile.legacyDam||profile.terrainSegments==256?256:128;
        private readonly List<Mesh> _meshes=new List<Mesh>();
        private readonly List<Material> _materials=new List<Material>();
        private bool _terrainNormalsBound;

        public static void Build(Transform parent,RoaSectorSurface.Profile profile,RoaGlobalMapRelief relief)
        {
            if(profile.railInfrastructure==null || profile.railInfrastructure.Length==0)return;
            var host=new GameObject("FreightEngineering_AUTHORED");host.transform.SetParent(parent,false);
            var builder=host.AddComponent<RoaSectorRailInfrastructure>();
            builder.Generate(profile,relief);
        }

        public static void BindTerrainMaterial(Transform location,Material material,Renderer ground)
        {
            foreach(var infrastructure in location.GetComponentsInChildren<RoaSectorRailInfrastructure>(true))
                foreach(var renderer in infrastructure.GetComponentsInChildren<MeshRenderer>(true))
                    if(renderer.name==CoverName)
                    {
                        renderer.sharedMaterial=material;
                        if(!infrastructure._terrainNormalsBound)
                        {
                            infrastructure.JoinTerrainNormals(ground.GetComponent<MeshFilter>(),renderer.GetComponent<MeshFilter>());
                            infrastructure._terrainNormalsBound=true;
                        }
                    }
        }

        private static Vector3Int NormalKey(Vector3 position)=>Vector3Int.RoundToInt(position*1024);
        private static void AccumulateNormals(Mesh mesh,Transform transform,Dictionary<Vector3Int,Vector3> sums,bool existingOnly)
        {
            var vertices=mesh.vertices;var triangles=mesh.triangles;
            for(int i=0;i<vertices.Length;i++)vertices[i]=transform.TransformPoint(vertices[i]);
            for(int i=0;i<triangles.Length;i+=3)
            {
                Vector3 a=vertices[triangles[i]],b=vertices[triangles[i+1]],c=vertices[triangles[i+2]];
                Vector3 normal=Vector3.Cross(b-a,c-a);
                if(normal.sqrMagnitude<1e-12f)continue;
                for(int j=0;j<3;j++)
                {
                    var key=NormalKey(vertices[triangles[i+j]]);
                    bool found=sums.TryGetValue(key,out var sum);
                    if(found||!existingOnly)sums[key]=sum+normal;
                }
            }
        }
        private static void ApplyNormals(Mesh mesh,Transform transform,Dictionary<Vector3Int,Vector3> sums)
        {
            var vertices=mesh.vertices;var normals=mesh.normals;
            // World-space face sums work even if the authored ground has a
            // different transform from the tunnel cover. Positions stay intact.
            var worldToLocalNormal=transform.localToWorldMatrix.transpose;
            for(int i=0;i<vertices.Length;i++)
                if(sums.TryGetValue(NormalKey(transform.TransformPoint(vertices[i])),out var sum)&&sum.sqrMagnitude>1e-12f)
                    normals[i]=worldToLocalNormal.MultiplyVector(sum.normalized).normalized;
            mesh.normals=normals;
        }
        private void JoinTerrainNormals(MeshFilter ground,MeshFilter cover)
        {
            if(ground?.sharedMesh==null||cover?.sharedMesh==null)return;
            if(!ground.sharedMesh.isReadable||!cover.sharedMesh.isReadable)return;
            var sums=new Dictionary<Vector3Int,Vector3>();
            AccumulateNormals(cover.sharedMesh,cover.transform,sums,false);
            AccumulateNormals(ground.sharedMesh,ground.transform,sums,true);
            foreach(var filter in new[]{ground,cover})
            {
                // Saved meshes and physical colliders keep their authored data.
                // Only these renderer-owned copies receive continuous normals.
                var mesh=Instantiate(filter.sharedMesh);mesh.name=filter.sharedMesh.name+"_JoinedTerrainNormals";
                ApplyNormals(mesh,filter.transform,sums);filter.sharedMesh=mesh;_meshes.Add(mesh);
            }
        }

        private void Generate(RoaSectorSurface.Profile profile,RoaGlobalMapRelief relief)
        {
            var formation=new Geometry(profile);var deck=new Geometry(profile);
            var lining=new Geometry(profile);var portals=new Geometry(profile);var piers=new Geometry(profile);
            var segments=new HashSet<string>();var pierStations=new HashSet<int>();var portalStations=new HashSet<int>();
            foreach(var route in profile.railInfrastructure.OrderBy(r=>r.foreign).ThenBy(r=>r.id,StringComparer.Ordinal))
            {
                if(route.points==null || route.points.Length<2)continue;
                var nativeRun=new List<RoaSectorSurface.RailPoint>();int nativeRunIndex=0;
                void FlushNative()
                {
                    if(nativeRun.Count>1)
                    {
                        var run=nativeRun.ToArray();
                        RoaDamRoadRailProjection.BuildRoute(transform,route.id+"_part_"+(nativeRunIndex++),run.Select(p=>new RoaDamRoadRailProjection.Point{x=p.x,z=p.z}).ToArray(),
                            (x,z)=>FormationHeight(route,x,z)+.025f,Rect.MinMaxRect(-profile.width/2,-profile.depth/2,profile.width/2,profile.depth/2),run[0].alongMetres);
                    }
                    nativeRun.Clear();
                }
                float nextPier=Mathf.Ceil(route.points[0].alongMetres/route.viaductSupportSpacing)*route.viaductSupportSpacing;
                for(int i=1;i<route.points.Length;i++)
                {
                    var a=route.points[i-1];var b=route.points[i];
                    string VertexKey(RoaSectorSurface.RailPoint p)=>Mathf.RoundToInt(p.x*10000)+","+Mathf.RoundToInt(p.z*10000)+","+Mathf.RoundToInt(p.h*10000);
                    string ka=VertexKey(a),kb=VertexKey(b),key=StringComparer.Ordinal.Compare(ka,kb)<0?ka+"/"+kb:kb+"/"+ka;
                    if(!segments.Add(key)){FlushNative();continue;}
                    if(nativeRun.Count==0)nativeRun.Add(a);nativeRun.Add(b);
                    Vector3 sideA=Side(route.points,i-1),sideB=Side(route.points,i);
                    float floorHalf=route.halfWidth+(a.kind=="tunnel"||b.kind=="tunnel"?.85f:0);
                    Slab(formation,a.Vector,b.Vector,sideA,sideB,floorHalf,.25f);
                    if(a.kind=="viaduct" || b.kind=="viaduct")
                    {
                        Slab(deck,a.Vector,b.Vector,sideA,sideB,route.halfWidth+.35f,.55f);
                        foreach(float sign in new[]{-1f,1f})
                        {
                            Vector3 edgeA=a.Vector+sideA*(sign*(route.halfWidth+.3f)),edgeB=b.Vector+sideB*(sign*(route.halfWidth+.3f));
                            // A low curb retains the ballast without closing the walking deck.
                            Slab(deck,edgeA+Vector3.up*.18f,edgeB+Vector3.up*.18f,sideA,sideB,.12f,.25f);
                        }
                        while(profile.railSupports==null && nextPier<=b.alongMetres)
                        {
                            float t=Mathf.InverseLerp(a.alongMetres,b.alongMetres,nextPier);
                            Vector3 centre=Vector3.Lerp(a.Vector,b.Vector,t);
                            float soil=RoaSectorSurface.Height(profile,relief,centre.x,centre.z,false,false);
                            Vector3 side=Vector3.Lerp(sideA,sideB,t).normalized;
                            if(centre.y-soil>1 && !CrossesApproach(profile,centre,route.halfWidth+2) && pierStations.Add(Mathf.RoundToInt(nextPier*100)))Box(piers,centre,side,1.1f,route.halfWidth-.3f,soil-centre.y,-.55f);
                            nextPier+=Mathf.Max(4,route.viaductSupportSpacing);
                        }
                    }
                    else nextPier=Mathf.Ceil(b.alongMetres/Mathf.Max(4,route.viaductSupportSpacing))*Mathf.Max(4,route.viaductSupportSpacing);
                    if(a.kind=="tunnel" || b.kind=="tunnel")
                    {
                        const int arcs=16;
                        for(int j=0;j<arcs;j++)
                        {
                            Vector2 u=Arch(j/(float)arcs,route.halfWidth,route.tunnelClearanceHeight);
                            Vector2 v=Arch((j+1)/(float)arcs,route.halfWidth,route.tunnelClearanceHeight);
                            // Faces point into the bore so the visible surface and capsule collision agree.
                            lining.Quad(a.Vector+sideA*u.x+Vector3.up*u.y,b.Vector+sideB*u.x+Vector3.up*u.y,
                                b.Vector+sideB*v.x+Vector3.up*v.y,a.Vector+sideA*v.x+Vector3.up*v.y);
                        }
                        float wallHalf=route.halfWidth+.85f;
                        foreach(float sign in new[]{-1f,1f})
                        {
                            Vector3 pa=a.Vector+sideA*(wallHalf*sign),pb=b.Vector+sideB*(wallHalf*sign);
                            if(sign<0)lining.Quad(pa-Vector3.up*.2f,pb-Vector3.up*.2f,pb+Vector3.up*1.1f,pa+Vector3.up*1.1f);
                            else lining.Quad(pb-Vector3.up*.2f,pa-Vector3.up*.2f,pa+Vector3.up*1.1f,pb+Vector3.up*1.1f);
                        }
                    }
                }
                foreach(var span in route.spans??Array.Empty<RoaSectorSurface.RailSpan>())
                {
                    if(span.kind!="tunnel")continue;
                    if(span.portalStart && portalStations.Add(Mathf.RoundToInt(route.points[span.fromIndex].alongMetres*100)))Portal(portals,profile,relief,route,span.fromIndex);
                    if(span.portalEnd && portalStations.Add(Mathf.RoundToInt(route.points[span.toIndex].alongMetres*100)))Portal(portals,profile,relief,route,span.toIndex);
                }
                FlushNative();
            }
            foreach(var support in profile.railSupports??Array.Empty<RoaSectorSurface.RailStructure>())
            {
                Vector3 side=new Vector3(-Mathf.Sin(support.rotationY),0,Mathf.Cos(support.rotationY));
                Box(piers,new Vector3(support.x,support.h,support.z),side,support.halfLength,support.halfWidth,support.g-support.h,0);
            }
            Material concrete=Material("FreightWeatheredConcrete",new Color(.36f,.35f,.31f));
            Material gravel=Material("FreightFormation",new Color(.39f,.38f,.32f));
            Render("FreightFormationCollider",formation,gravel,true);
            Render("FreightViaductDeck",deck,concrete,true);Render("FreightViaductPiers",piers,concrete,true);
            Render("FreightTunnelLining",lining,concrete,true);Render("FreightTunnelPortals",portals,concrete,true);
            BuildTerrainCover(profile,relief);
            BuildServiceGates(profile,relief);
        }

        private void BuildServiceGates(RoaSectorSurface.Profile profile,RoaGlobalMapRelief relief)
        {
            var bars=new Geometry(profile);var signs=new Geometry(profile);var stripes=new Geometry(profile);
            foreach(var gate in profile.railBarriers??Array.Empty<RoaSectorSurface.RailStructure>())
            {
                Vector3 side=new Vector3(-Mathf.Sin(gate.rotationY),0,Mathf.Cos(gate.rotationY));
                Vector3 centre=new Vector3(gate.x,gate.h,gate.z);
                // Both levels are physically closed. Public actors stay on the
                // surface; the freight deck/bore is secured service infrastructure.
                Fence(false);if(Mathf.Abs(gate.g-gate.h)>1)Fence(true);
                void Fence(bool surface)
                {
                    float fenceHalf=gate.halfWidth-.12f;
                    int count=Mathf.CeilToInt(fenceHalf*2/.28f);
                    float Base(float offset)
                    {
                        Vector3 at=centre+side*offset;
                        return surface?RoaSectorSurface.Height(profile,relief,at.x,at.z,false,false):gate.h;
                    }
                    float height=surface?2.2f:gate.height;
                    for(int i=0;i<=count;i++)
                    {
                        float u=Mathf.Lerp(-fenceHalf,fenceHalf,i/(float)count),baseY=Base(u);
                        Vector3 at=centre+side*u;at.y=baseY;
                        Box(bars,at,side,gate.halfLength,i==0||i==count?.12f:.045f,-.15f,height);
                        if(i==count)continue;
                        float v=Mathf.Lerp(-fenceHalf,fenceHalf,(i+1)/(float)count),otherY=Base(v);
                        foreach(float cross in new[]{.35f,height*.55f,height-.1f})
                        {
                            Vector3 a=centre+side*u,b=centre+side*v;a.y=baseY+cross;b.y=otherY+cross;
                            // Slab along the gate width, with its cross-section in the rail direction.
                            Vector3 direction=new Vector3(side.z,0,-side.x);
                            Slab(bars,a,b,direction,direction,gate.halfLength,.1f);
                        }
                    }
                    Vector3 signCentre=centre;signCentre.y=Base(0)+Mathf.Min(height-.3f,1.5f);
                    Box(signs,signCentre,side,gate.halfLength+.02f,.65f,-.23f,.23f);
                    Vector3 normal=new Vector3(side.z,0,-side.x);
                    foreach(float face in new[]{-1f,1f})for(float u=-1;u<.65f;u+=.3f)
                    {
                        Vector3 a=signCentre+normal*(face*(gate.halfLength+.023f))+side*Mathf.Clamp(u,-.65f,.65f)-Vector3.up*.23f;
                        Vector3 b=signCentre+normal*(face*(gate.halfLength+.023f))+side*Mathf.Clamp(u+.12f,-.65f,.65f)-Vector3.up*.23f;
                        Vector3 c=signCentre+normal*(face*(gate.halfLength+.023f))+side*Mathf.Clamp(u+.58f,-.65f,.65f)+Vector3.up*.23f;
                        Vector3 d=signCentre+normal*(face*(gate.halfLength+.023f))+side*Mathf.Clamp(u+.46f,-.65f,.65f)+Vector3.up*.23f;
                        stripes.Quad(a,b,c,d);stripes.Quad(d,c,b,a);
                    }
                }
            }
            Render("FreightLockedServiceGates",bars,Material("FreightServiceGateSteel",new Color(.21f,.22f,.2f)),true);
            Render("FreightServiceWarningPlates",signs,Material("FreightServiceWarningOchre",new Color(.62f,.39f,.08f)),false);
            Render("FreightServiceWarningStripes",stripes,Material("FreightServiceWarningBlack",new Color(.035f,.035f,.03f)),false);
        }

        public static float FormationHeight(RoaSectorSurface.RailInfrastructure route,float x,float z)
        {
            float distance=float.PositiveInfinity,height=0;
            for(int i=1;i<route.points.Length;i++)
            {
                var a=route.points[i-1];var b=route.points[i];var delta=new Vector2(b.x-a.x,b.z-a.z);
                float t=Mathf.Clamp01(Vector2.Dot(new Vector2(x-a.x,z-a.z),delta)/Mathf.Max(.000001f,delta.sqrMagnitude));
                float d=(new Vector2(x-a.x,z-a.z)-delta*t).sqrMagnitude;
                if(d>=distance)continue;distance=d;height=Mathf.Lerp(a.h,b.h,t);
            }
            return height;
        }
        private static Vector3 Side(RoaSectorSurface.RailPoint[] points,int i)
        {
            var a=points[Mathf.Max(0,i-1)];var b=points[Mathf.Min(points.Length-1,i+1)];
            return new Vector3(-(b.z-a.z),0,b.x-a.x).normalized;
        }
        private static Vector2 Arch(float t,float halfWidth,float clearance)
        {
            float angle=t*Mathf.PI;return new Vector2(-(halfWidth+.85f)*Mathf.Cos(angle),1.1f+(clearance-1.1f)*Mathf.Sin(angle));
        }
        private static void Portal(Geometry geometry,RoaSectorSurface.Profile profile,RoaGlobalMapRelief relief,RoaSectorSurface.RailInfrastructure route,int index)
        {
            var point=route.points[index];Vector3 side=Side(route.points,index);
            const int arcs=16;
            for(int j=0;j<arcs;j++)
            {
                Vector2 a=Arch(j/(float)arcs,route.halfWidth,route.tunnelClearanceHeight),b=Arch((j+1)/(float)arcs,route.halfWidth,route.tunnelClearanceHeight);
                Vector3 innerA=point.Vector+side*a.x+Vector3.up*a.y,innerB=point.Vector+side*b.x+Vector3.up*b.y;
                Vector3 topA=innerA,topB=innerB;
                topA.y=Mathf.Max(innerA.y+.4f,RoaSectorSurface.Height(profile,relief,topA.x,topA.z,false,false));
                topB.y=Mathf.Max(innerB.y+.4f,RoaSectorSurface.Height(profile,relief,topB.x,topB.z,false,false));
                geometry.Quad(innerA,innerB,topB,topA);geometry.Quad(innerB,innerA,topA,topB);
            }
            foreach(float sign in new[]{-1f,1f})
            {
                float width=Mathf.Max(route.halfWidth+5,point.earthworkHalfWidth+point.earthworkBlend+Mathf.Sqrt(2)*profile.width/(profile.terrainSegments==256?256:128)+2);
                int sections=Mathf.CeilToInt(width-route.halfWidth-.85f);
                for(int j=0;j<sections;j++)
                {
                    float u=Mathf.Lerp(route.halfWidth+.85f,width,j/(float)sections),v=Mathf.Lerp(route.halfWidth+.85f,width,(j+1)/(float)sections);
                    Vector3 inner=point.Vector+side*(sign*u)-Vector3.up*.5f,outer=point.Vector+side*(sign*v)-Vector3.up*.5f;
                    Vector3 innerTop=inner,outerTop=outer;
                    innerTop.y=Mathf.Max(point.h+1.1f,RoaSectorSurface.Height(profile,relief,inner.x,inner.z,false,false)+.05f);
                    outerTop.y=Mathf.Max(point.h+1.1f,RoaSectorSurface.Height(profile,relief,outer.x,outer.z,false,false)+.05f);
                    geometry.Quad(inner,outer,outerTop,innerTop);geometry.Quad(outer,inner,innerTop,outerTop);
                }
            }
        }
        private void BuildTerrainCover(RoaSectorSurface.Profile profile,RoaGlobalMapRelief relief)
        {
            if(!profile.railInfrastructure.Any(r=>r.points.Any(p=>p.kind=="tunnel")))return;
            int segments=TerrainSegments(profile);
            var cover=new Geometry(profile);
            foreach(var cell in TerrainCoverCells(profile))
            {
                int ix=cell.x,iz=cell.y;
                float x=(ix/(float)segments-.5f)*profile.width,z=(iz/(float)segments-.5f)*profile.depth;
                float dx=profile.width/segments,dz=profile.depth/segments;
                Vector3 a=Vertex(x,z),b=Vertex(x+dx,z),c=Vertex(x,z+dz),d=Vertex(x+dx,z+dz);
                cover.RoofTriangle(a,c,b);cover.RoofTriangle(b,c,d);
            }
            Render(CoverName,cover,Material("FreightTunnelTerrain",new Color(.36f,.33f,.24f)),true);
            Vector3 Vertex(float x,float z)=>new Vector3(x,RoaSectorSurface.GridHeight(profile,relief,x,z,false)-.05f*profile.gain/160,z);
        }
        public static HashSet<Vector2Int> TerrainCoverCells(RoaSectorSurface.Profile profile)
        {
            var cells=new HashSet<Vector2Int>();int segments=TerrainSegments(profile);
            if(profile.railInfrastructure==null)return cells;
            float dx=profile.width/segments,dz=profile.depth/segments,diagonal=Mathf.Sqrt(dx*dx+dz*dz);
            foreach(var route in profile.railInfrastructure)for(int i=1;i<route.points.Length;i++)
            {
                var a=route.points[i-1];var b=route.points[i];if(a.kind!="tunnel"&&b.kind!="tunnel")continue;
                float half=Mathf.Max(route.halfWidth,a.earthworkHalfWidth,b.earthworkHalfWidth);
                float blend=Mathf.Max(2,a.earthworkBlend,b.earthworkBlend);
                float margin=half+blend+diagonal;
                int x0=Mathf.Clamp(Mathf.FloorToInt((Mathf.Min(a.x,b.x)-margin+profile.width/2)/dx),0,segments-1),x1=Mathf.Clamp(Mathf.CeilToInt((Mathf.Max(a.x,b.x)+margin+profile.width/2)/dx),0,segments-1);
                int z0=Mathf.Clamp(Mathf.FloorToInt((Mathf.Min(a.z,b.z)-margin+profile.depth/2)/dz),0,segments-1),z1=Mathf.Clamp(Mathf.CeilToInt((Mathf.Max(a.z,b.z)+margin+profile.depth/2)/dz),0,segments-1);
                var v=new Vector2(b.x-a.x,b.z-a.z);
                for(int iz=z0;iz<=z1;iz++)for(int ix=x0;ix<=x1;ix++)
                {
                    var at=new Vector2((ix/(float)segments-.5f)*profile.width,(iz/(float)segments-.5f)*profile.depth);
                    float t=Mathf.Clamp01(Vector2.Dot(at-new Vector2(a.x,a.z),v)/Mathf.Max(v.sqrMagnitude,.000001f));
                    if((at-new Vector2(a.x,a.z)-v*t).magnitude<=margin)cells.Add(new Vector2Int(ix,iz));
                }
            }
            return cells;
        }
        public static Mesh VisibleTerrain(Mesh source,RoaSectorSurface.Profile profile,Transform transform=null)
        {
            var covered=TerrainCoverCells(profile);if(covered.Count==0)return source;
            int segments=TerrainSegments(profile);Vector3[] vertices=source.vertices;int[] triangles=source.triangles;var kept=new List<int>();
            // Mesh.uv returns a copy of the complete channel. Read it once:
            // fetching it per clipped vertex fills the WebGL heap in one frame.
            Vector2[] sourceUv=source.uv;
            var output=new List<Vector3>(vertices);var uv=new List<Vector2>(sourceUv);var planes=PortalPlanes(profile);
            for(int i=0;i<triangles.Length;i+=3)
            {
                Vector3 centre=(vertices[triangles[i]]+vertices[triangles[i+1]]+vertices[triangles[i+2]])/3;
                if(transform!=null)centre=transform.TransformPoint(centre);
                var cell=new Vector2Int(Mathf.Clamp(Mathf.FloorToInt((centre.x/profile.width+.5f)*segments),0,segments-1),Mathf.Clamp(Mathf.FloorToInt((centre.z/profile.depth+.5f)*segments),0,segments-1));
                if(!covered.Contains(cell)){kept.AddRange(new[]{triangles[i],triangles[i+1],triangles[i+2]});continue;}
                var remaining=new List<(Vector3 v,Vector2 uv)>();
                for(int j=0;j<3;j++){int k=triangles[i+j];remaining.Add((transform==null?vertices[k]:transform.TransformPoint(vertices[k]),sourceUv[k]));}
                foreach(var plane in planes)
                {
                    if(!NearPortal(remaining.Select(v=>v.v),plane))continue;
                    var exterior=ClipPortal(remaining,plane,false);
                    for(int j=1;j<exterior.Count-1;j++)foreach(var point in new[]{exterior[0],exterior[j],exterior[j+1]})
                    {kept.Add(output.Count);output.Add(transform==null?point.v:transform.InverseTransformPoint(point.v));uv.Add(point.uv);}
                    remaining=ClipPortal(remaining,plane,true);
                }
            }
            Mesh visible=Instantiate(source);visible.name=source.name+"_VisibleOutsideTunnels";visible.SetVertices(output);visible.SetUVs(0,uv);visible.SetTriangles(kept,0);visible.RecalculateNormals();visible.RecalculateBounds();return visible;
        }
        private struct PortalPlane {public Vector3 point,into;}
        private static List<PortalPlane> PortalPlanes(RoaSectorSurface.Profile profile)
        {
            var planes=new List<PortalPlane>();
            foreach(var route in profile.railInfrastructure??Array.Empty<RoaSectorSurface.RailInfrastructure>())
                foreach(var span in route.spans??Array.Empty<RoaSectorSurface.RailSpan>())
                {
                    if(span.kind!="tunnel")continue;
                    if(span.portalStart)Add(span.fromIndex,1);
                    if(span.portalEnd)Add(span.toIndex,-1);
                    void Add(int index,int direction)
                    {
                        var point=route.points[index];var neighbour=route.points[Mathf.Clamp(index+direction,0,route.points.Length-1)];
                        var into=new Vector3(neighbour.x-point.x,0,neighbour.z-point.z).normalized;
                        planes.Add(new PortalPlane {point=point.Vector,into=into});
                    }
                }
            return planes;
        }
        private static bool NearPortal(IEnumerable<Vector3> polygon,PortalPlane plane)=>polygon.Any(v=>new Vector2(v.x-plane.point.x,v.z-plane.point.z).sqrMagnitude<24*24);
        private static List<(Vector3 v,Vector2 uv)> ClipPortal(List<(Vector3 v,Vector2 uv)> polygon,PortalPlane plane,bool interior)
        {
            var result=new List<(Vector3 v,Vector2 uv)>();
            for(int i=0;i<polygon.Count;i++)
            {
                var a=polygon[i];var b=polygon[(i+1)%polygon.Count];float da=Vector3.Dot(a.v-plane.point,plane.into),db=Vector3.Dot(b.v-plane.point,plane.into);
                bool insideA=interior?da>=0:da<=0,insideB=interior?db>=0:db<=0;
                if(insideA)result.Add(a);
                if(insideA!=insideB){float t=da/(da-db);result.Add((Vector3.Lerp(a.v,b.v,t),Vector2.Lerp(a.uv,b.uv,t)));}
            }
            return result;
        }
        private static bool CrossesApproach(RoaSectorSurface.Profile profile,Vector3 centre,float margin)
        {
            foreach(var road in profile.roads)
            {
                if(road.type=="railway"||road.blocked)continue;var points=road.points?.Length>1?road.points:new[]{road.a,road.b};
                for(int i=1;i<points.Length;i++)
                {
                    var a=points[i-1];var b=points[i];var v=new Vector2(b.x-a.x,b.z-a.z);float t=Mathf.Clamp01(Vector2.Dot(new Vector2(centre.x-a.x,centre.z-a.z),v)/Mathf.Max(v.sqrMagnitude,.000001f));
                    if((new Vector2(centre.x-a.x,centre.z-a.z)-v*t).magnitude<=road.halfWidth+margin)return true;
                }
            }
            return false;
        }
        private static void Slab(Geometry g,Vector3 a,Vector3 b,Vector3 sideA,Vector3 sideB,float half,float depth)
        {
            Vector3 al=a-sideA*half,ar=a+sideA*half,bl=b-sideB*half,br=b+sideB*half;
            g.Quad(ar,br,bl,al);g.Quad(al-Vector3.up*depth,bl-Vector3.up*depth,br-Vector3.up*depth,ar-Vector3.up*depth);
            g.Quad(al,bl,bl-Vector3.up*depth,al-Vector3.up*depth);g.Quad(br,ar,ar-Vector3.up*depth,br-Vector3.up*depth);
        }
        private static void Box(Geometry g,Vector3 centre,Vector3 side,float halfLength,float halfWidth,float bottom,float top)
        {
            Vector3 along=new Vector3(side.z,0,-side.x),a=centre-along*halfLength,b=centre+along*halfLength;
            Slab(g,a+Vector3.up*top,b+Vector3.up*top,side,side,halfWidth,top-bottom);
            Vector3 al=a-side*halfWidth,ar=a+side*halfWidth,bl=b-side*halfWidth,br=b+side*halfWidth;
            g.Quad(al+Vector3.up*bottom,ar+Vector3.up*bottom,ar+Vector3.up*top,al+Vector3.up*top);
            g.Quad(bl+Vector3.up*top,br+Vector3.up*top,br+Vector3.up*bottom,bl+Vector3.up*bottom);
        }
        private Material Material(string name,Color color)
        {
            if(name=="FreightWeatheredConcrete")
            {
                Material concrete=RoaGroundTextures.CreateMaterial("wet_concrete",name,Application.isMobilePlatform);
                if(concrete==null)throw new InvalidOperationException("Missing freight concrete textures");
                concrete.SetFloat("_MacroStrength",0);concrete.SetFloat("_GroundTiling",2.3f);
                concrete.SetFloat("_GroundSaturation",.5f);concrete.SetFloat("_NormalStrength",.75f);
                concrete.SetFloat("_Metallic",0);concrete.SetFloat("_DrySmoothness",.16f);
                concrete.SetColor("_BaseColor",new Color(color.r/.45f,color.g/.45f,color.b/.45f,1));
                _materials.Add(concrete);return concrete;
            }
            var material=new Material(Shader.Find("Universal Render Pipeline/Lit")){name=name,color=color};
            material.SetFloat("_Smoothness",.08f);_materials.Add(material);return material;
        }
        private void Render(string name,Geometry geometry,Material material,bool collision)
        {
            if(geometry.indices.Count==0)return;
            var mesh=new Mesh{name=name,indexFormat=IndexFormat.UInt32};mesh.SetVertices(geometry.vertices);mesh.SetUVs(0,geometry.uv);mesh.SetTriangles(geometry.indices,0);mesh.RecalculateNormals();mesh.RecalculateBounds();_meshes.Add(mesh);
            var go=new GameObject(name);go.transform.SetParent(transform,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
            if(name==CoverName)
            {
                var sums=new Dictionary<Vector3Int,Vector3>();AccumulateNormals(mesh,go.transform,sums,false);ApplyNormals(mesh,go.transform,sums);
            }
            if(collision)go.AddComponent<MeshCollider>().sharedMesh=mesh;
        }
        private sealed class Geometry
        {
            public readonly List<Vector3> vertices=new List<Vector3>();public readonly List<Vector2> uv=new List<Vector2>();public readonly List<int> indices=new List<int>();
            private readonly RoaSectorSurface.Profile _profile;
            private readonly List<PortalPlane> _portals;
            public Geometry(RoaSectorSurface.Profile profile){_profile=profile;_portals=PortalPlanes(profile);}
            public void AddTriangle(Vector3 a,Vector3 b,Vector3 c)=>Triangle(a,b,c);
            public void RoofTriangle(Vector3 a,Vector3 b,Vector3 c)
            {
                var polygon=new List<(Vector3 v,Vector2 uv)>{(a,Vector2.zero),(b,Vector2.zero),(c,Vector2.zero)};
                foreach(var plane in _portals)if(NearPortal(polygon.Select(v=>v.v),plane))polygon=ClipPortal(polygon,plane,true);
                for(int i=1;i<polygon.Count-1;i++)Triangle(polygon[0].v,polygon[i].v,polygon[i+1].v);
            }
            public void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d){Triangle(a,b,c);Triangle(a,c,d);}
            private void Triangle(Vector3 a,Vector3 b,Vector3 c)
            {
                var polygon=new List<Vector3>{a,b,c};
                foreach(var plane in new[]{(axis:0,value:-_profile.width/2,less:false),(axis:0,value:_profile.width/2,less:true),(axis:2,value:-_profile.depth/2,less:false),(axis:2,value:_profile.depth/2,less:true)})
                {
                    var clipped=new List<Vector3>();
                    for(int i=0;i<polygon.Count;i++)
                    {
                        Vector3 u=polygon[i],v=polygon[(i+1)%polygon.Count];bool first=plane.less?u[plane.axis]<=plane.value:u[plane.axis]>=plane.value,second=plane.less?v[plane.axis]<=plane.value:v[plane.axis]>=plane.value;
                        if(first)clipped.Add(u);if(first!=second)clipped.Add(Vector3.Lerp(u,v,(plane.value-u[plane.axis])/(v[plane.axis]-u[plane.axis])));
                    }
                    polygon=clipped;
                }
                for(int i=1;i<polygon.Count-1;i++)foreach(var v in new[]{polygon[0],polygon[i],polygon[i+1]})
                {indices.Add(vertices.Count);vertices.Add(v);uv.Add(new Vector2(v.x/_profile.width+.5f,v.z/_profile.depth+.5f));}
            }
        }
        private void OnDestroy()
        {
            foreach(var mesh in _meshes)if(mesh!=null){if(Application.isPlaying)Destroy(mesh);else DestroyImmediate(mesh);}
            foreach(var material in _materials)if(material!=null){if(Application.isPlaying)Destroy(material);else DestroyImmediate(material);}
        }
    }
}
