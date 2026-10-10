using System;
using System.Collections.Generic;
using System.Linq;
using Kromka.Authoring;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>Per-sector terrain and infrastructure from the original authored world field.</summary>
    public sealed class RoaSectorSurface : MonoBehaviour
    {
        public const string ResourceKey = "RealmOfAshes/SectorSurfaces";
        [Serializable] public sealed class Point { public float x, z, h, g; public Vector3 Vector => new Vector3(x,h,z); }
        [Serializable] public sealed class Edge { public Point a,b; }
        [Serializable] public sealed class Foundation { public float x,z,halfX,halfZ,blend,height,waterBlend,dryCutBlend; public string shape,id; public Point[] points,levelPoints; public bool afterHydro,afterRoads,foreign,fillWater,cutOnly; }
        [Serializable] public sealed class Route { public string id,type,style; public float halfWidth,height,dryLandingBlend; public Point a,b; public Point[] points,supports; public bool blocked; public Corridor[] dryRoadProtectionEnvelopes; }
        [Serializable] public sealed class Corridor { public string id; public float halfWidth,blend,margin; public Point[] points; }
        [Serializable] public sealed class HydroCut { public float minX,maxX,minY,maxY,blend; }
        [Serializable] public sealed class Placement { public string id; public float x,z; public bool remove; }
        [Serializable] public sealed class Gate { public string side; public float along; public Point entry,gate,boundary; }
        [Serializable] public sealed class Pollution { public float x,z,halfX,halfZ; public float[] color; }
        [Serializable] public sealed class RailPoint { public float x,z,h,surfaceH,alongMetres,earthworkHalfWidth,earthworkBlend; public string kind,spanId; public Vector3 Vector=>new Vector3(x,h,z); }
        [Serializable] public sealed class RailSpan { public string id,globalId,kind; public int fromIndex,toIndex; public bool portalStart,portalEnd,serviceStart,serviceEnd; }
        [Serializable] public sealed class RailInfrastructure { public string id,sourceRoadId; public float halfWidth,tunnelClearanceHeight,viaductSupportSpacing; public RailPoint[] points; public RailSpan[] spans; public bool foreign; }
        [Serializable] public sealed class RailStructure { public string id,kind,globalId; public float x,z,h,g,halfLength,halfWidth,height,rotationY,alongMetres; }
        [Serializable] private sealed class SourcePose { public Transform transform; public Vector3 position; public bool active; }
        [Serializable] public sealed class GroundLattice
        {
            public string schema,zoneId,profileGeometryHash,geometryHash,codeHash;
            public int segments;
            public long[] vertexBits;
            [NonSerialized] internal Vector3[] decoded;
        }
        [Serializable] public sealed class Profile
        {
            public string zoneId,locationId,title,region;
            public float width,depth,mapMinX,mapMinY,mapSpan,gain,datum;
            public int terrainSegments;
            public bool legacyDam;
            public bool retainingFinish;
            public Foundation[] foundations;
            public Point[] waterVertices;
            public int[] waterIndices;
            public Edge[] waterEdges;
            public Edge[] visibleShore;
            public Edge[] physicalShore;
            public Route[] roads,bridges,processPipes;
            public Corridor[] corridors;
            public HydroCut[] hydroCuts;
            public Placement[] placements;
            public Point hub;
            public Gate[] gates;
            public Pollution waterPollution;
            public RailInfrastructure[] railInfrastructure;
            public RailStructure[] railSupports,railBarriers;
            public RoaSurfaceCellPatches.Cell[] surfacePatches;
            public GroundLattice groundLattice;
            public bool hasGroundLattice;
            public RoadBankTreatment[] roadBankTreatments;
            public RoadBankWall[] roadBankWalls;
            public RoadBankWall[] roadBankContactWalls;
            public bool hasRoadBankContactWalls;
            public RoadBankFooting[] roadBankContactFootings;
            public bool hasRoadBankContactFootings;
            public BridgeBankRevetment[] bridgeBankRevetments;
            public BridgeBankRevetmentMesh[] bridgeBankRevetmentMeshes;
        }
        [Serializable] public sealed class BridgeBankRevetment
        {
            public string id,bridge,end,association;
            public float minX,maxX,minZ,maxZ,thickness,cover,toeEmbed,minSlope,minLift,roadMargin,protectionMargin;
        }
        [Serializable] public sealed class BridgeBankRevetmentMesh
        {
            public string id,sourceHash,geometryHash;
            public Point[] vertices;
            public int[] indices,prisms;
        }
        [Serializable] private sealed class Catalog { public Profile[] profiles; }
        [Serializable] public sealed class RoadBankTreatment
        {
            public float minX,maxX,minZ,maxZ,blend;
        }
        [Serializable] public sealed class RoadBankWallPoint
        {
            public float x,z,outerX,outerZ,top,bottom;
        }
        [Serializable] public sealed class RoadBankWall
        {
            public string id;
            public RoadBankWallPoint[] points;
        }
        [Serializable] public sealed class RoadBankFootingPoint
        {
            public float x,z,outerX,outerZ,top,outerTop,bottom;
        }
        [Serializable] public sealed class RoadBankFooting
        {
            public string id;
            public RoadBankFootingPoint[] points;
        }
        public struct WaterSample { public bool Inside; public float Distance,Height,BankX,BankZ,BankHeight; }
        private static Dictionary<string,Profile> _profiles;
#if !UNITY_EDITOR
        private static RoaRuntimeSectorCatalog _runtimeCatalog;
#endif
        private sealed class RailSegment { public RailInfrastructure route; public RailPoint a,b; }
        private sealed class RailIndex { public RailInfrastructure[] source; public Dictionary<Vector2Int,List<RailSegment>> cells; }
        private struct RailSample { public float distance,halfWidth,earthworkHalfWidth,earthworkBlend,h,surfaceH; public string kind; }
        private static readonly Dictionary<Profile,RailIndex> RailIndexes=new Dictionary<Profile,RailIndex>();
        private static RailSample? RailAt(Profile p,float x,float z)
        {
            if(p.railInfrastructure==null || p.railInfrastructure.Length==0)return null;
            if(!RailIndexes.TryGetValue(p,out RailIndex index) || index.source!=p.railInfrastructure)
            {
                index=new RailIndex {source=p.railInfrastructure,cells=new Dictionary<Vector2Int,List<RailSegment>>()};
                const float cellSize=16f;
                foreach(RailInfrastructure route in p.railInfrastructure)
                {
                    if(route.points==null)continue;
                    for(int i=1;i<route.points.Length;i++)
                    {
                        RailPoint a=route.points[i-1],b=route.points[i];
                        float aWidth=a.earthworkHalfWidth>0?a.earthworkHalfWidth:route.halfWidth;
                        float bWidth=b.earthworkHalfWidth>0?b.earthworkHalfWidth:route.halfWidth;
                        float aBlend=a.earthworkBlend>0?a.earthworkBlend:(a.kind=="tunnel"?2:8);
                        float bBlend=b.earthworkBlend>0?b.earthworkBlend:(b.kind=="tunnel"?2:8);
                        float margin=Mathf.Max(route.halfWidth+8,aWidth+aBlend,bWidth+bBlend);
                        var segment=new RailSegment {route=route,a=a,b=b};
                        for(int ix=Mathf.FloorToInt((Mathf.Min(a.x,b.x)-margin)/cellSize);ix<=Mathf.FloorToInt((Mathf.Max(a.x,b.x)+margin)/cellSize);ix++)
                        for(int iz=Mathf.FloorToInt((Mathf.Min(a.z,b.z)-margin)/cellSize);iz<=Mathf.FloorToInt((Mathf.Max(a.z,b.z)+margin)/cellSize);iz++)
                        {
                            var key=new Vector2Int(ix,iz);
                            if(!index.cells.TryGetValue(key,out List<RailSegment> list)){list=new List<RailSegment>();index.cells.Add(key,list);}
                            list.Add(segment);
                        }
                    }
                }
                RailIndexes[p]=index;
            }
            if(!index.cells.TryGetValue(new Vector2Int(Mathf.FloorToInt(x/16),Mathf.FloorToInt(z/16)),out List<RailSegment> nearby))return null;
            RailSample? nearest=null;
            foreach(RailSegment segment in nearby)
            {
                RailPoint a=segment.a,b=segment.b;float dx=b.x-a.x,dz=b.z-a.z;
                float t=Mathf.Clamp01(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz+1e-12f));
                float distance=new Vector2(x-a.x-dx*t,z-a.z-dz*t).magnitude;
                float aWidth=a.earthworkHalfWidth>0?a.earthworkHalfWidth:segment.route.halfWidth;
                float bWidth=b.earthworkHalfWidth>0?b.earthworkHalfWidth:segment.route.halfWidth;
                float aBlend=a.earthworkBlend>0?a.earthworkBlend:(a.kind=="tunnel"?2:8);
                float bBlend=b.earthworkBlend>0?b.earthworkBlend:(b.kind=="tunnel"?2:8);
                float earthworkHalfWidth=Mathf.Lerp(aWidth,bWidth,t),earthworkBlend=Mathf.Lerp(aBlend,bBlend,t);
                if(distance>Mathf.Max(segment.route.halfWidth+8,earthworkHalfWidth+earthworkBlend) || nearest.HasValue&&distance>=nearest.Value.distance)continue;
                nearest=new RailSample {distance=distance,halfWidth=segment.route.halfWidth,earthworkHalfWidth=earthworkHalfWidth,earthworkBlend=earthworkBlend,
                    h=Mathf.Lerp(a.h,b.h,t),surfaceH=Mathf.Lerp(a.surfaceH,b.surfaceH,t),kind=t<.5f?a.kind:b.kind};
            }
            return nearest;
        }
        private sealed class WaterIndex
        {
            public readonly Dictionary<long,List<Edge>> Edges=new Dictionary<long,List<Edge>>();
            public readonly Dictionary<long,List<int>> Triangles=new Dictionary<long,List<int>>();
        }
        private static readonly Dictionary<Profile,WaterIndex> WaterIndexes=new Dictionary<Profile,WaterIndex>();
        private static RoaSectorSurface _active;
        private readonly List<Mesh> _meshes = new List<Mesh>();
        private Material _retainingFinishMaterial;
        private Material _retainingWearMaterial;
        private readonly List<Material> _materials = new List<Material>();
        [SerializeField] private string _locationId;
        [SerializeField] private int _surfaceSegments=128;
        private Vector3[] _surfaceVertices;
        private int[] _surfaceIndices;
        private RoaMeshSurfaceHeight _shorePatchHeights;
        private RoaMeshSurfaceHeight _tunnelCoverHeights;
        private RoaGlobalMapRelief _relief;
        [SerializeField] private Mesh _sourceMesh;
        [SerializeField] private Material _sourceMaterial;
        [SerializeField] private bool _sourceTransformStored;
        [SerializeField] private Vector3 _sourceGroundPosition,_sourceGroundScale;
        [SerializeField] private Quaternion _sourceGroundRotation;
        [SerializeField] private Collider[] _sourceColliders;
        [SerializeField] private bool[] _sourceColliderEnabled;
        [SerializeField] private MeshCollider _surfaceCollider;
        [SerializeField] private Transform _generatedRoot;
        [SerializeField] private SourcePose[] _sourcePoses;
        public Profile Sector { get; private set; }
        public static bool Active => _active != null;
        public static void ReleaseRuntimeProfiles()
        {
#if !UNITY_EDITOR
            _runtimeCatalog?.ReleaseProfiles();
            RailIndexes.Clear();WaterIndexes.Clear();BoundaryNeighbours.Clear();
            RoaSurfaceCellPatches.ReleaseRuntimeProfiles();
#endif
        }
        public static Profile Find(string id)
        {
#if !UNITY_EDITOR
            if(_runtimeCatalog==null)_runtimeCatalog=new RoaRuntimeSectorCatalog();
            return _runtimeCatalog.Find(id);
#else
            if (_profiles == null)
            {
                _profiles = new Dictionary<string,Profile>(StringComparer.Ordinal);
                TextAsset asset = Resources.Load<TextAsset>(ResourceKey);
                string source=asset?.text;
#if UNITY_EDITOR
                string preview=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
                if(!string.IsNullOrEmpty(preview))source=System.IO.File.ReadAllText(preview);
#endif
                if (source != null) foreach (Profile p in JsonUtility.FromJson<Catalog>(source).profiles)
                    _profiles.Add(p.locationId,p);
            }
            return id != null && _profiles.TryGetValue(id,out Profile profile) ? profile : null;
#endif
        }
        public static IEnumerable<Profile> AllProfiles { get { Find(null);
#if UNITY_EDITOR
            return _profiles.Values;
#else
            return _runtimeCatalog.Headers.Select(header=>Find(header.locationId));
#endif
        } }
        public static Vector2 MapPoint(Profile p,float x,float z) => new Vector2(
            p.mapMinX+(x/p.width+0.5f)*p.mapSpan,p.mapMinY+(0.5f-z/p.depth)*p.mapSpan);
        public static Vector2 SourcePoint(Vector2 p)
        {
            float dx=Mathf.Max(200f-p.x,0f,p.x-220f),dy=Mathf.Max(200f-p.y,0f,p.y-220f);
            return new Vector2(p.x-4.2f*(1f-Smooth(0,10,new Vector2(dx,dy).magnitude)),p.y);
        }
        private static float Smooth(float a,float b,float x) => Mathf.SmoothStep(0,1,Mathf.InverseLerp(a,b,x));
        private static float Distance(float x,float z,Point a,Point b,out float t)
        {
            float dx=b.x-a.x,dz=b.z-a.z;
            t=Mathf.Clamp01(((x-a.x)*dx+(z-a.z)*dz)/Mathf.Max(0.00001f,dx*dx+dz*dz));
            return new Vector2(x-a.x-dx*t,z-a.z-dz*t).magnitude;
        }
        public static WaterSample WaterAt(Profile p,float x,float z)
        {
            var water=new WaterSample { Distance=float.PositiveInfinity,BankX=x,BankZ=z };
            WaterIndex index=IndexFor(p);long key=CellKey(Mathf.FloorToInt(x/16),Mathf.FloorToInt(z/16));
            if(index.Edges.TryGetValue(key,out List<Edge> edges))foreach (Edge edge in edges)
            {
                float d=Distance(x,z,edge.a,edge.b,out float t);
                if(d<water.Distance) {water.Distance=d;water.Height=Mathf.Lerp(edge.a.h,edge.b.h,t);water.BankHeight=water.Height;water.BankX=Mathf.Lerp(edge.a.x,edge.b.x,t);water.BankZ=Mathf.Lerp(edge.a.z,edge.b.z,t);}
            }
            Point[] v=p.waterVertices;
            if(index.Triangles.TryGetValue(key,out List<int> triangles))foreach(int i in triangles)
            {
                Point a=v[p.waterIndices[i]],b=v[p.waterIndices[i+1]],c=v[p.waterIndices[i+2]];
                // Evaluate small native fans without float cancellation. The
                // authored server surface uses the same determinant cutoff.
                double den=((double)b.z-c.z)*((double)a.x-c.x)+((double)c.x-b.x)*((double)a.z-c.z);
                if(Math.Abs(den)<0.000000001)continue;
                double u=(((double)b.z-c.z)*((double)x-c.x)+((double)c.x-b.x)*((double)z-c.z))/den;
                double w=(((double)c.z-a.z)*((double)x-c.x)+((double)a.x-c.x)*((double)z-c.z))/den;
                double q=(((double)a.z-b.z)*((double)x-b.x)+((double)b.x-a.x)*((double)z-b.z))/den;
                if(u>=-0.0000001 && w>=-0.0000001 && q>=-0.0000001)
                {water.Inside=true;water.Height=(float)(u*a.h+w*b.h+q*c.h);break;}
            }
            return water;
        }
        private static long CellKey(int x,int z)=>((long)x<<32)|(uint)z;
        private static WaterIndex IndexFor(Profile p)
        {
            if(WaterIndexes.TryGetValue(p,out WaterIndex ready))return ready;
            bool wide=false;
            if(p.hydroCuts!=null)foreach(HydroCut c in p.hydroCuts)
                if(c.maxX+c.blend>=p.mapMinX && c.minX-c.blend<=p.mapMinX+p.mapSpan && c.maxY+c.blend>=p.mapMinY && c.minY-c.blend<=p.mapMinY+p.mapSpan){wide=true;break;}
            var index=new WaterIndex();float margin=(wide?128:32)*p.gain/160+1;
            foreach(Edge e in p.waterEdges)Add(index.Edges,e,Mathf.Min(e.a.x,e.b.x)-margin,Mathf.Max(e.a.x,e.b.x)+margin,Mathf.Min(e.a.z,e.b.z)-margin,Mathf.Max(e.a.z,e.b.z)+margin);
            for(int i=0;i<p.waterIndices.Length;i+=3)
            {
                Point a=p.waterVertices[p.waterIndices[i]],b=p.waterVertices[p.waterIndices[i+1]],c=p.waterVertices[p.waterIndices[i+2]];
                Add(index.Triangles,i,Mathf.Min(a.x,b.x,c.x)-.00001f,Mathf.Max(a.x,b.x,c.x)+.00001f,Mathf.Min(a.z,b.z,c.z)-.00001f,Mathf.Max(a.z,b.z,c.z)+.00001f);
            }
            WaterIndexes.Add(p,index);return index;
            void Add<T>(Dictionary<long,List<T>> table,T item,float minX,float maxX,float minZ,float maxZ)
            {
                for(int ix=Mathf.FloorToInt(minX/16);ix<=Mathf.FloorToInt(maxX/16);ix++)for(int iz=Mathf.FloorToInt(minZ/16);iz<=Mathf.FloorToInt(maxZ/16);iz++)
                {
                    long key=CellKey(ix,iz);if(!table.TryGetValue(key,out List<T> rows))table.Add(key,rows=new List<T>());rows.Add(item);
                }
            }
        }
        public static Route BridgeAt(Profile p,float x,float z,float radius=0)
        {
            foreach(Route b in p.bridges)
            {
                Point[] points=b.points!=null && b.points.Length>1?b.points:new[]{b.a,b.b};
                for(int i=1;i<points.Length;i++)
                {
                    Point a=points[i-1],end=points[i];float dx=end.x-a.x,dz=end.z-a.z;
                    float t=((x-a.x)*dx+(z-a.z)*dz)/Mathf.Max(.00001f,dx*dx+dz*dz);
                    if(t>=-1e-6f && t<=1+1e-6f && Distance(x,z,a,end,out _)+radius<=b.halfWidth+1e-6f)return b;
                }
            }
            return null;
        }
        public static float BridgeHeight(Route b,float x,float z)
        {
            if(b.style=="legacyDam")return RoaDamRoadWaterProjection.BridgeWalkHeightAt(x,z);
            if(b.points==null || b.points.Length<2)return b.height;
            float nearest=float.PositiveInfinity,height=b.height;
            for(int i=1;i<b.points.Length;i++)
            {
                float d=Distance(x,z,b.points[i-1],b.points[i],out float t);
                if(d<nearest){nearest=d;height=Mathf.Lerp(b.points[i-1].h,b.points[i].h,t);}
            }
            return height;
        }
        private static float RawHeight(Profile p,RoaGlobalMapRelief relief,float x,float z)
        {
            Vector2 point=SourcePoint(MapPoint(p,x,z));
            return (relief.HeightAt(point.x,point.y)-p.datum)*p.gain;
        }
        public static float Height(Profile p,RoaGlobalMapRelief relief,float x,float z,bool walking=false,bool applyRail=true,bool railWalking=false,bool naturalSubstrate=false)
        {
            float h=RawHeight(p,relief,x,z);
            WaterSample water=WaterAt(p,x,z);
            float edgeWet=float.IsInfinity(water.Distance)?0:Smooth(.005f*p.gain/160,.5f*p.gain/160,water.BankHeight-RawHeight(p,relief,water.BankX,water.BankZ));
            Vector2 mapped=MapPoint(p,x,z);float cut=0;
            if(p.hydroCuts!=null)foreach(HydroCut c in p.hydroCuts)
            {
                float d=new Vector2(Mathf.Max(c.minX-mapped.x,0,mapped.x-c.maxX),Mathf.Max(c.minY-mapped.y,0,mapped.y-c.maxY)).magnitude;
                cut=Mathf.Max(cut,1-Smooth(0,c.blend,d));
            }
            if(water.Inside)
            {
                float bed=water.Height+0.04f*p.gain/160-1.84f*p.gain/160*Smooth(0,3*p.gain/160,water.Distance);
                float blend=Smooth(0.005f*p.gain/160,0.5f*p.gain/160,water.Height-h);
                h=Mathf.Lerp(h,Mathf.Min(h,bed),blend);
                float shore=edgeWet*(1-Smooth(0,3*p.gain/160,water.Distance));
                h=Mathf.Lerp(h,bed,shore);
                h=Mathf.Lerp(h,bed,cut);
                Vector2 canonical=MapPoint(p,x,z);
                float distance=new Vector2(Mathf.Max(200-canonical.x,0,canonical.x-220),Mathf.Max(200-canonical.y,0,canonical.y-220)).magnitude;
                h=Mathf.Lerp(h,bed,1-Smooth(0,5,distance));
            }
            else if(!float.IsInfinity(water.Distance) && edgeWet>0)
            {
                float slope=Mathf.Min((32+96*cut)*p.gain/160,Mathf.Max(12*p.gain/160,(h-water.Height)*3.2f+6*p.gain/160));
                if(water.Distance<slope)
                {
                    float crest=Mathf.Max(h,water.Height+0.23f*p.gain/160),crestAt=slope*0.62f;
                    float bank=water.Distance<crestAt ? Mathf.Lerp(water.Height+0.04f*p.gain/160,crest,Smooth(0,crestAt,water.Distance)) : Mathf.Lerp(crest,h,Smooth(crestAt,slope,water.Distance));
                    h=Mathf.Lerp(h,bank,edgeWet);
                }
            }
            foreach(Foundation f in p.foundations)
            {
                if(f.afterHydro || f.afterRoads)continue;
                float distance=FoundationDistance(f,x,z);
                float weight=(1-Smooth(0,f.blend,distance))*(f.waterBlend>0?(water.Inside?0:Smooth(0,f.waterBlend,water.Distance)):1);
                h=Mathf.Lerp(h,f.height,weight);
            }
            if(cut>0)
            {
                if(water.Inside)
                {
                    float bed=water.Height+.04f*p.gain/160-1.84f*p.gain/160*Smooth(0,3*p.gain/160,water.Distance);
                    h=Mathf.Lerp(h,bed,cut);
                }
                else if(!float.IsInfinity(water.Distance))
                {
                    float run=Mathf.Min(128*p.gain/160,Mathf.Max(12*p.gain/160,(h-water.Height)*3.2f+6*p.gain/160));
                    float bank=Mathf.Lerp(water.Height+.04f*p.gain/160,h,Smooth(0,run,water.Distance));
                    h=Mathf.Lerp(h,bank,cut);
                }
            }
            // Share natural-bank eligibility across all fills and approaches.
            // A preceding earthwork cannot amplify the next one into the bed.
            if(naturalSubstrate)return h;
            float naturalBank=h,roadDryWeight=EngineeringDryWeight(p,water,h);
            bool protectedFillWater=false;
            foreach(Foundation f in p.foundations)if(f.afterHydro && !f.afterRoads)
            {
                float level=f.height,nearest=float.PositiveInfinity;
                if(f.levelPoints!=null)for(int i=1;i<f.levelPoints.Length;i++)
                {
                    float d=Distance(x,z,f.levelPoints[i-1],f.levelPoints[i],out float t);
                    if(d<nearest){nearest=d;level=Mathf.Lerp(f.levelPoints[i-1].h,f.levelPoints[i].h,t);}
                }
                float transition=f.dryCutBlend>0&&h>level&&!water.Inside?f.dryCutBlend:f.blend;
                float blend=Smooth(0,transition,FoundationDistance(f,x,z));
                float dry=f.fillWater?1:roadDryWeight;
                if(f.fillWater&&blend<1)protectedFillWater=true;
                h=dry==1?Mathf.Lerp(level,h,blend):Mathf.Lerp(h,level,(1-blend)*dry);
            }
            if(!protectedFillWater&&h>naturalBank&&!float.IsInfinity(water.Distance))
            {
                float cap=Mathf.Max(naturalBank,water.Height+.04f*p.gain/160+.65f*water.Distance);
                if(h>cap)h=Mathf.Lerp(h,cap,Mathf.Max(edgeWet,cut)*(1-BridgeFootingWeight(p,x,z)));
            }
            // Traffic uses the deck. Keep natural low soil beneath the span,
            // with continuous transitions to the actual endpoint footings.
            float openSpan=protectedFillWater?0:BridgeOpenSpanWeight(p,x,z,water,naturalBank,edgeWet,cut);
            if(openSpan>0&&h>naturalBank)h=openSpan==1?naturalBank:Mathf.Lerp(h,naturalBank,openSpan);
            float roadLevel=0,roadWeight=0,roadInfluence=0;
            bool channelBed=water.Inside && h<water.Height+.02f*p.gain/160;
            if(roadDryWeight>0)
            {
                Route closest=null;float nearest=float.PositiveInfinity;
                foreach(Route bridge in p.bridges)
                {
                    if(bridge.style=="legacyDam" || bridge.style=="railViaduct" || bridge.style=="metalService")continue;
                    Point[] points=bridge.points!=null && bridge.points.Length>1?bridge.points:new[]{bridge.a,bridge.b};
                    float distance=float.PositiveInfinity;
                    for(int i=1;i<points.Length;i++)distance=Mathf.Min(distance,Distance(x,z,points[i-1],points[i],out _));
                    if(distance-bridge.halfWidth<nearest){closest=bridge;nearest=distance-bridge.halfWidth;}
                }
                if(closest!=null)
                {
                    float weight=(1-Smooth(2.5f*p.gain/160,8*p.gain/160,nearest))*roadDryWeight*(1-openSpan);
                    h=Mathf.Lerp(h,BridgeHeight(closest,x,z),weight);
                }
            }
            float beforeRoadSoil=h;
            if(roadDryWeight>0 && p.corridors!=null)foreach(Corridor corridor in p.corridors)
            {
                float nearest=float.PositiveInfinity,level=h;
                for(int i=1;i<corridor.points.Length;i++)
                {
                    float d=Distance(x,z,corridor.points[i-1],corridor.points[i],out float t);
                    if(d<nearest){nearest=d;level=Mathf.Lerp(corridor.points[i-1].h,corridor.points[i].h,t);}
                }
                float influence=1-Smooth(corridor.halfWidth,corridor.halfWidth+corridor.blend,nearest);
                float kernel=1-Smooth(0,corridor.halfWidth+corridor.blend,nearest),weight=kernel*kernel;
                roadLevel+=level*weight;roadWeight+=weight;roadInfluence=Mathf.Max(roadInfluence,influence);
            }
            if(roadWeight>1e-12f)h=Mathf.Lerp(h,roadLevel/roadWeight,roadInfluence*roadDryWeight*(1-openSpan));
            if(!protectedFillWater&&h>beforeRoadSoil&&h>naturalBank)
            {
                float cap=Mathf.Max(beforeRoadSoil,naturalBank);
                float weight=Mathf.Max(water.Inside?1:0,edgeWet,cut)*RoadBankWeight(p,x,z);
                if(weight>0)h=Mathf.Lerp(h,cap,weight);
            }
            foreach(Foundation f in p.foundations)if(f.afterRoads && (!water.Inside || f.fillWater || f.cutOnly))
            {
                float level=f.height,nearest=float.PositiveInfinity;
                if(f.levelPoints!=null)for(int i=1;i<f.levelPoints.Length;i++)
                {
                    float d=Distance(x,z,f.levelPoints[i-1],f.levelPoints[i],out float t);
                    if(d<nearest){nearest=d;level=Mathf.Lerp(f.levelPoints[i-1].h,f.levelPoints[i].h,t);}
                }
                float weight=(1-Smooth(0,f.blend,FoundationDistance(f,x,z)))*(f.waterBlend>0?Smooth(0,f.waterBlend,water.Distance):1);
                // Clearance cuts can excavate the bank below a deck but can
                // never raise or fill the river bed.
                h=Mathf.Lerp(h,f.cutOnly?Mathf.Min(h,level):level,weight);
            }
            Vector2 finalMap=MapPoint(p,x,z);
            float distanceToDam=new Vector2(Mathf.Max(200-finalMap.x,0,finalMap.x-220),Mathf.Max(200-finalMap.y,0,finalMap.y-220)).magnitude;
            if(distanceToDam<5)
            {
                float datum=relief.HeightAt(200.675f,216.625f);
                float old=RoaDamRoadWaterProjection.ExtendedBedHeightAt(relief,(finalMap.x-210)*16,(210-finalMap.y)*16)/160+datum;
                h=Mathf.Lerp(h,(old-p.datum)*p.gain,1-Smooth(0,5,distanceToDam));
            }
            // Match the dry bank soil to the actual deck across a side entry.
            // Water triangles keep their open bed below the bridge.
            if(!water.Inside && p.bridges!=null)foreach(Route bridge in p.bridges)if(bridge.dryLandingBlend>0)
            {
                Point[] points=bridge.points!=null&&bridge.points.Length>0?bridge.points:new[]{bridge.a,bridge.b};
                float nearest=float.PositiveInfinity;
                for(int i=1;i<points.Length;i++)nearest=Mathf.Min(nearest,Distance(x,z,points[i-1],points[i],out _));
                float weight=1-Smooth(bridge.halfWidth,bridge.halfWidth+bridge.dryLandingBlend,nearest);
                if(weight>0)h=Mathf.Lerp(h,BridgeHeight(bridge,x,z),weight);
            }
            float naturalBeforeRail=h;
            // Legacy dam bed is applied after channelBed was first tested.
            // Keep the finished submerged bed open under its bridge.
            bool openChannel=water.Inside && naturalBeforeRail<water.Height+.02f*p.gain/160;
            float? railFloor=null,railRoof=null;
            if(applyRail)
            {
                RailSample? near=RailAt(p,x,z);
                if(near.HasValue)
                {
                    RailSample rail=near.Value;
                    bool viaduct=rail.kind=="viaduct" || rail.h-rail.surfaceH>8;
                    if(walking && !railWalking && (rail.kind=="tunnel" || viaduct))railRoof=naturalBeforeRail;
                    else if(walking && rail.distance<=rail.halfWidth)railFloor=rail.h;
                    if(!viaduct && !channelBed && !openChannel)
                    {
                        float weight=1-Smooth(rail.earthworkHalfWidth,rail.earthworkHalfWidth+rail.earthworkBlend,rail.distance);
                        h=Mathf.Lerp(h,rail.h,weight);
                    }
                }
            }
            if(walking && railFloor.HasValue)return railFloor.Value;
            if(walking && railRoof.HasValue)return railRoof.Value;
            if(walking) {Route b=BridgeAt(p,x,z);if(b!=null && (b.style!="railViaduct" || railWalking))return BridgeHeight(b,x,z);}
            return h;
        }
        // Keep the bed open while joining earthworks continuously on both
        // sides of a native water edge. Matches the authoritative server.
        private static float EngineeringDryWeight(Profile p,WaterSample water,float height)
        {
            float scale=p.gain/160;
            float above=Smooth(.02f*scale,.5f*scale,height-water.Height);
            if(float.IsInfinity(water.Distance))return water.Inside?above:1;
            return water.Inside?above:Mathf.Max(above,Smooth(0,3*scale,water.Distance));
        }
        private static float BridgeFootingWeight(Profile p,float x,float z)
        {
            float scale=p.gain/160,weight=0;
            foreach(Route bridge in p.bridges)
            {
                if(bridge.style=="legacyDam"||bridge.style=="railViaduct"||bridge.style=="metalService")continue;
                Point[] points=bridge.points!=null&&bridge.points.Length>1?bridge.points:new[]{bridge.a,bridge.b};
                foreach(int end in new[]{0,points.Length-1})
                {
                    Point a=points[end],b=points[end==0?1:points.Length-2];
                    float dx=b.x-a.x,dz=b.z-a.z,length=Mathf.Sqrt(dx*dx+dz*dz);if(length<.001f)continue;
                    float along=Mathf.Abs(((x-a.x)*dx+(z-a.z)*dz)/length);
                    float across=Mathf.Abs(((z-a.z)*dx-(x-a.x)*dz)/length);
                    float distance=new Vector2(Mathf.Max(0,along-.75f*scale),Mathf.Max(0,across-bridge.halfWidth*.75f)).magnitude;
                    weight=Mathf.Max(weight,1-Smooth(0,2*scale,distance));
                }
            }
            return weight;
        }
        private static float BridgeOpenSpanWeight(Profile p,float x,float z,WaterSample water,float naturalBank,float edgeWet,float cut)
        {
            float scale=p.gain/160;
            float wet=Mathf.Max(edgeWet,cut,water.Inside?Smooth(0,3*scale,water.Distance):0);
            float low=1-Smooth(.5f*scale,2*scale,naturalBank-water.Height);
            if(wet==0||low==0)return 0;
            Route closest=null;float nearest=float.PositiveInfinity,bestAlong=0,bestTotal=0;
            foreach(Route bridge in p.bridges)
            {
                if(bridge.style=="legacyDam"||bridge.style=="railViaduct"||bridge.style=="metalService")continue;
                Point[] points=bridge.points!=null&&bridge.points.Length>1?bridge.points:new[]{bridge.a,bridge.b};
                float total=0;
                for(int i=1;i<points.Length;i++)total+=new Vector2(points[i].x-points[i-1].x,points[i].z-points[i-1].z).magnitude;
                if(total<.001f)continue;
                float along=0;
                for(int i=1;i<points.Length;i++)
                {
                    float length=new Vector2(points[i].x-points[i-1].x,points[i].z-points[i-1].z).magnitude;
                    float distance=Distance(x,z,points[i-1],points[i],out float t);
                    if(distance-bridge.halfWidth<nearest)
                    {closest=bridge;nearest=distance-bridge.halfWidth;bestAlong=along+t*length;bestTotal=total;}
                    along+=length;
                }
            }
            if(closest==null)return 0;
            float ends=Smooth(0,3*scale,Mathf.Min(bestAlong,bestTotal-bestAlong));
            float radial=1-Smooth(2.5f*scale,8*scale,nearest);
            if(ends==0||radial==0)return 0;
            float footing=1-BridgeFootingWeight(p,x,z);
            if(footing==0)return 0;
            if(closest.dryRoadProtectionEnvelopes!=null&&closest.dryRoadProtectionEnvelopes.Length>0)
            {
                float protection=0;
                foreach(Corridor road in closest.dryRoadProtectionEnvelopes)
                {
                    float distance=float.PositiveInfinity;
                    for(int i=1;i<road.points.Length;i++)distance=Mathf.Min(distance,Distance(x,z,road.points[i-1],road.points[i],out _));
                    float core=1-Smooth(road.halfWidth,road.halfWidth+road.blend,distance);
                    protection=Mathf.Max(protection,core*Smooth(-road.margin,0,nearest));
                }
                return ends*footing*radial*wet*low*(1-protection);
            }
            // Preserve the real capsule footprint of a road entering the
            // deck from its dry side. Matches the server's continuous blend.
            const float margin=.705f; // .48 radius + .075 skin + .15 clearance
            float roadCore=0;
            foreach(Route road in p.roads)
            {
                if(road.blocked||(road.type!="track"&&road.type!="road"))continue;
                Point[] points=road.points!=null&&road.points.Length>1?road.points:new[]{road.a,road.b};
                float distance=float.PositiveInfinity;
                for(int i=1;i<points.Length;i++)distance=Mathf.Min(distance,Distance(x,z,points[i-1],points[i],out _));
                roadCore=Mathf.Max(roadCore,1-Smooth(road.halfWidth+margin,road.halfWidth+margin+2*scale,distance));
            }
            float roadProtection=roadCore*Smooth(-margin,0,nearest);
            return ends*footing*radial*wet*low*(1-roadProtection);
        }
        private static float RoadBankWeight(Profile p,float x,float z)
        {
            float weight=0;
            if(p.roadBankTreatments!=null)foreach(RoadBankTreatment t in p.roadBankTreatments)
                weight=Mathf.Max(weight,1-Smooth(0,t.blend,Mathf.Max(t.minX-x,0,x-t.maxX,t.minZ-z,z-t.maxZ)));
            if(weight==0)return 0;
            float scale=p.gain/160,core=0;
            foreach(Route road in p.roads)
            {
                if(road.blocked||(road.type!="track"&&road.type!="road"))continue;
                Point[] points=road.points!=null&&road.points.Length>1?road.points:new[]{road.a,road.b};
                float distance=float.PositiveInfinity;
                for(int i=1;i<points.Length;i++)distance=Mathf.Min(distance,Distance(x,z,points[i-1],points[i],out _));
                core=Mathf.Max(core,1-Smooth(road.halfWidth+.705f,road.halfWidth+.705f+.25f*scale,distance));
            }
            if(core==1)return 0;
            float footing=BridgeFootingWeight(p,x,z);
            foreach(Foundation f in p.foundations)footing=Mathf.Max(footing,1-Smooth(0,2*scale,FoundationDistance(f,x,z)));
            return weight*(1-core)*(1-footing);
        }
        private static float FoundationDistance(Foundation f,float x,float z)
        {
            if(f.shape=="polygon")
            {
                bool inside=false;float nearest=float.PositiveInfinity;
                for(int i=0,j=f.points.Length-1;i<f.points.Length;j=i++)
                {
                    Point a=f.points[j],b=f.points[i];nearest=Mathf.Min(nearest,Distance(x,z,a,b,out _));
                    if((a.z>z)!=(b.z>z) && x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
                }
                return inside?0:nearest;
            }
            return f.shape=="ellipse"?Mathf.Max(0,(new Vector2((x-f.x)/f.halfX,(z-f.z)/f.halfZ).magnitude-1)*Mathf.Min(f.halfX,f.halfZ)):new Vector2(Mathf.Max(0,Mathf.Abs(x-f.x)-f.halfX),Mathf.Max(0,Mathf.Abs(z-f.z)-f.halfZ)).magnitude;
        }
        public static float GroundHeightAt(float x,float z,float referenceFeet=float.NaN)
        {
            if(_active==null || _active.Sector==null)return 0;
            Profile p=_active.Sector;
            if(Mathf.Abs(x)>p.width/2 || Mathf.Abs(z)>p.depth/2)return 0;
            if(p.railInfrastructure?.Length>0)
            {
                if(_active._tunnelCoverHeights==null)
                {
                    var cover=_active._generatedRoot.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(f=>f.name==RoaSectorRailInfrastructure.CoverName);
                    if(cover!=null)_active._tunnelCoverHeights=new RoaMeshSurfaceHeight(cover.sharedMesh);
                }
                if(_active._tunnelCoverHeights!=null&&_active._tunnelCoverHeights.TryHeight(x,z,out float roof) && (float.IsNaN(referenceFeet)||referenceFeet>=roof-2))return roof+.05f*p.gain/160;
            }
            if(TryRailLayer(p,_active._relief,x,z,referenceFeet,out float railFloor))return railFloor;
            Route bridge=BridgeAt(p,x,z);
            if(bridge!=null)return BridgeHeight(bridge,x,z);
            if(_active.TryMeshHeight(x,z,out float h))return h+.05f*p.gain/160;
            return Height(p,_active._relief,x,z);
        }
        public static bool TryRailFloor(Profile profile,float x,float z,out float height)
        {
            var rail=RailAt(profile,x,z);height=rail?.h??0;
            return rail.HasValue&&rail.Value.distance<=rail.Value.halfWidth;
        }
        public static bool IsClosedFreightAt(float x,float z)
        {
            Profile p=_active==null?null:_active.Sector;
            if(p==null && RoaZoneReliefProjection.LegacyActive)p=Find(RoaZoneReliefProjection.DamRoadZone);
            if(p?.railBarriers==null)return false;
            var near=RailAt(p,x,z);
            return near.HasValue && near.Value.distance<=near.Value.halfWidth+.85f && (near.Value.kind=="tunnel"||near.Value.kind=="viaduct");
        }
        public static bool TryRailLayer(Profile profile,RoaGlobalMapRelief relief,float x,float z,float referenceFeet,out float height)
        {
            var nearest=RailAt(profile,x,z);height=0;
            if(!nearest.HasValue || nearest.Value.distance>nearest.Value.halfWidth)return false;
            RailSample rail=nearest.Value;
            float natural=Height(profile,relief,x,z,true,false);
            if(rail.kind=="tunnel")height=float.IsNaN(referenceFeet)||referenceFeet>=natural-2?natural:rail.h;
            else if(rail.kind=="viaduct")height=!float.IsNaN(referenceFeet)&&referenceFeet>=rail.h-2?rail.h:natural;
            else height=rail.h;
            return true;
        }
        private bool TryMeshHeight(float x,float z,out float height)
        {
            if(_shorePatchHeights!=null)return _shorePatchHeights.TryHeight(x,z,out height);
            height=0;if(_surfaceVertices==null)return false;
            int segments=_surfaceSegments,side=segments+1;
            int ix=Mathf.Clamp(Mathf.FloorToInt((x/Sector.width+.5f)*segments),0,segments-1),iz=Mathf.Clamp(Mathf.FloorToInt((z/Sector.depth+.5f)*segments),0,segments-1);
            for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++)
            {
                int cx=ix+dx,cz=iz+dz;if(cx<0 || cz<0 || cx>=segments || cz>=segments)continue;
                int a=cz*side+cx,b=a+1,c=a+side,d=c+1;
                if(Triangle(a,c,b,out height) || Triangle(b,c,d,out height))return true;
            }
            return false;
            bool Triangle(int ia,int ib,int ic,out float h)
            {
                Vector3 a=_surfaceVertices[ia],b=_surfaceVertices[ib],c=_surfaceVertices[ic];
                float den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);h=0;
                if(Mathf.Abs(den)<.0000001f)return false;
                float u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,w=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
                if(u<-.00001f || w<-.00001f || u+w>1.00001f)return false;
                h=u*a.y+w*b.y+(1-u-w)*c.y;return true;
            }
        }
        private float SeatWoodResourceBase(Transform root)
        {
            // A native tree can end in a point away from its authored pivot.
            // Seat its actual lowest mesh vertices on the finished terrain;
            // moving the pivot onto the ground does not seat that root.
            var vertices=new List<Vector3>();
            foreach(MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                MeshRenderer renderer=filter.GetComponent<MeshRenderer>();
                if(renderer==null||!renderer.enabled||!renderer.gameObject.activeInHierarchy||filter.sharedMesh==null)continue;
                foreach(Vector3 vertex in filter.sharedMesh.vertices)
                    vertices.Add(filter.transform.TransformPoint(vertex));
            }
            if(vertices.Count==0)throw new InvalidOperationException("Wood resource without an enabled native mesh: "+root.name);
            float bottom=vertices.Min(v=>v.y);
            Vector3[] baseVertices=vertices.Where(v=>v.y<=bottom+.08f).ToArray();
            // Only a single native root tip can be seated by translation alone.
            // A broad or split root on a slope needs an authored placement;
            // lowering it by its deepest gap can bury the other support points.
            Vector3 tip=vertices.First(v=>v.y==bottom);
            if(baseVertices.Any(v=>new Vector2(v.x-tip.x,v.z-tip.z).sqrMagnitude>.0001f))return 0;
            float lowestGround=float.PositiveInfinity,highestGround=float.NegativeInfinity;
            foreach(Vector3 vertex in baseVertices)
            {
                // Props outside the authored sector are dealt with by the
                // placement pass, rather than extrapolating its edge plane.
                if(Mathf.Abs(vertex.x)>Sector.width*.5f||Mathf.Abs(vertex.z)>Sector.depth*.5f)return 0;
                if(!TryMeshHeight(vertex.x,vertex.z,out float ground)||float.IsNaN(ground)||float.IsInfinity(ground))
                    throw new InvalidOperationException("No indexed terrain below native wood root: "+root.name);
                lowestGround=Mathf.Min(lowestGround,ground);
                highestGround=Mathf.Max(highestGround,ground);
            }
            if(float.IsPositiveInfinity(lowestGround))return 0;
            if(highestGround-lowestGround>.02f)return 0;
            float gap=bottom-lowestGround;
            if(gap<=.03f)return 0;
            // A centimetre of soil contact avoids a visible air line without
            // changing the imported mesh, its scale, rotation or XZ placement.
            float adjustment=-gap-.01f;
            root.position+=Vector3.up*adjustment;
            return adjustment;
        }
        public static bool ContainsWater(float x,float z) => _active != null && IsWaterAt(_active.Sector,x,z);
        public static bool IsWaterAt(Profile p,float x,float z,float radius=0)
        {
            if(BridgeAt(p,x,z,radius)!=null)return false;
            RoaGlobalMapRelief relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            if(Wet(x,z))return true;
            for(int i=0;i<8 && radius>0;i++)if(Wet(x+radius*Mathf.Cos(i*Mathf.PI/4),z+radius*Mathf.Sin(i*Mathf.PI/4)))return true;
            return false;
            bool Wet(float px,float pz)
            {
                WaterSample water=WaterAt(p,px,pz);
                return (water.Inside || water.Distance<=.00001f) && Height(p,relief,px,pz)<water.Height+.02f*p.gain/160;
            }
        }
        public static bool Project(string id,Renderer ground)
        {
            Profile p=Find(id);
            if(p==null || p.legacyDam || ground==null)return false;
            RoaSectorSurface existing=ground.GetComponent<RoaSectorSurface>();
#if UNITY_EDITOR
            // A preview catalog must project fresh geometry, even if this
            // scene contains an older saved surface. Saved-scene audits run
            // without the preview override and keep the actual baked meshes.
            if(existing!=null&&!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT")))
            {RestoreSource(ground);existing=null;}
#endif
            if(existing!=null){existing.Bind(id);return true;}
            RoaGlobalMapRelief relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            if(relief==null || !relief.Ready)throw new InvalidOperationException("Missing original relief field");
            var component=ground.gameObject.AddComponent<RoaSectorSurface>();
            component.Sector=p;component._locationId=id;component._relief=relief;
            component._sourceMesh=ground.GetComponent<MeshFilter>().sharedMesh;
            component._sourceMaterial=ground.sharedMaterial;
            component._sourceTransformStored=true;
            component._sourceGroundPosition=ground.transform.localPosition;
            component._sourceGroundRotation=ground.transform.localRotation;
            component._sourceGroundScale=ground.transform.localScale;
            component._sourceColliders=ground.GetComponents<Collider>();
            component._sourceColliderEnabled=new bool[component._sourceColliders.Length];
            for(int i=0;i<component._sourceColliders.Length;i++)component._sourceColliderEnabled[i]=component._sourceColliders[i].enabled;
            var poses=new List<SourcePose>();
            foreach(KromkaPlacedObjectAuthoring placed in ground.transform.root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                if(placed.gameObject!=ground.gameObject && (placed.transform.parent==null || placed.transform.parent.GetComponentInParent<KromkaPlacedObjectAuthoring>()==null))
                    poses.Add(new SourcePose {transform=placed.transform,position=placed.transform.position,active=placed.gameObject.activeSelf});
            component._sourcePoses=poses.ToArray();
            int segments=p.terrainSegments==256?256:128;component._surfaceSegments=segments;
            // The generated surface already contains metre coordinates. Keep
            // its owned mesh in that space instead of applying the source
            // plane's scale twice through world/local float conversions.
            if(p.surfacePatches?.Length>0)
            {
                Transform parent=ground.transform.parent;
                if(parent!=null&&(parent.position!=Vector3.zero||parent.rotation!=Quaternion.identity
                    ||parent.lossyScale!=Vector3.one))
                    throw new InvalidOperationException("Indexed terrain requires an identity location root");
                ground.transform.localPosition=Vector3.zero;
                ground.transform.localRotation=Quaternion.identity;
                ground.transform.localScale=Vector3.one;
            }
            Mesh mesh=component.BuildGround(ground.transform,p,relief,segments);
            ground.GetComponent<MeshFilter>().sharedMesh=mesh;
            component.CacheSurface();
            foreach(Collider c in ground.GetComponents<Collider>())c.enabled=false;
            component._surfaceCollider=ground.gameObject.AddComponent<MeshCollider>();component._surfaceCollider.sharedMesh=mesh;
            Mesh visible=RoaSectorRailInfrastructure.VisibleTerrain(mesh,p,ground.transform);
            if(visible!=mesh){component._meshes.Add(visible);ground.GetComponent<MeshFilter>().sharedMesh=visible;component._surfaceCollider.sharedMesh=visible;}
            _active=component;
            component._generatedRoot=new GameObject("SectorSurface_AUTHORED").transform;
            component._generatedRoot.SetParent(ground.transform.parent,false);
            component.BuildWater(component._generatedRoot,p);
            component.BuildRoutes(component._generatedRoot,p,relief);
            component.BuildWaterBarriers(component._generatedRoot,p,relief);
            var changes=new Dictionary<string,Placement>(StringComparer.Ordinal);
            if(p.placements!=null)foreach(Placement change in p.placements)changes.Add(change.id,change);
            foreach(KromkaPlacedObjectAuthoring placed in ground.transform.root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if(placed.gameObject==ground.gameObject || placed.GetComponentInParent<RoaSectorSurface>()!=null)continue;
                if(placed.transform.parent!=null && placed.transform.parent.GetComponentInParent<KromkaPlacedObjectAuthoring>()!=null)continue;
                Vector3 pos=placed.transform.position;
                if(changes.TryGetValue(placed.StableObjectId,out Placement change))
                {
                    if(change.remove){placed.gameObject.SetActive(false);continue;}
                    pos.x=change.x;pos.z=change.z;
                }
                float offset=Height(p,relief,pos.x,pos.z,true);
                if(placed.GameplayTags.Contains("natural-rim"))
                {
                    // The mouth sits below its supporting rim; use the prepared
                    // perimeter rather than lowering the whole lip into the pit.
                    var rim=new float[8];
                    for(int sample=0;sample<rim.Length;sample++)
                    {float angle=sample*Mathf.PI*2/rim.Length;rim[sample]=Height(p,relief,pos.x+Mathf.Cos(angle)*5.8f,pos.z+Mathf.Sin(angle)*5.8f);}
                    Array.Sort(rim);offset=(rim[3]+rim[4])*.5f;
                }
                if(placed.GameplayTags.Contains("water-intake"))offset=WaterAt(p,pos.x,pos.z).Height;
                bool cityShore=placed.GameplayTags.Contains("city-shore");
                if(cityShore)
                {
                    var platform=p.foundations.FirstOrDefault(f=>f.id=="city_platform" && !f.foreign);
                    if(platform==null)throw new InvalidOperationException("City shoreline without a platform: "+p.locationId);
                    offset=platform.height;
                }
                pos.y+=offset;
                placed.transform.position=pos;
                if(cityShore)
                {
                    // Keep the top at the city platform and fill the retaining
                    // face with additional native sections down to the bank.
                    // The imported wall's 3.01 m height is never stretched.
                    Transform visual=null;
                    foreach(Transform child in placed.transform)if(child.name!="Collision"){visual=child;break;}
                    if(visual==null)throw new InvalidOperationException("City shoreline without a native visual: "+placed.StableObjectId);
                    // The anchor sits on the flat platform. Sample the finished
                    // indexed ground along the actual oriented wall perimeter,
                    // including its outside face, to determine the buried foot.
                    float bankFloor=float.PositiveInfinity;
                    foreach(MeshFilter filter in visual.GetComponentsInChildren<MeshFilter>(true))
                    {
                        if(filter.sharedMesh==null)continue;
                        Bounds bounds=filter.sharedMesh.bounds;
                        Transform frame=filter.transform;
                        float axisX=frame.TransformVector(Vector3.right).magnitude;
                        float axisZ=frame.TransformVector(Vector3.forward).magnitude;
                        if(axisX<.000001f||axisZ<.000001f)throw new InvalidOperationException("Degenerate native shoreline wall: "+placed.StableObjectId);
                        float minX=bounds.min.x-.05f/axisX,maxX=bounds.max.x+.05f/axisX;
                        float minZ=bounds.min.z-.05f/axisZ,maxZ=bounds.max.z+.05f/axisZ;
                        var corners=new[] {new Vector3(minX,bounds.center.y,minZ),new Vector3(maxX,bounds.center.y,minZ),
                            new Vector3(maxX,bounds.center.y,maxZ),new Vector3(minX,bounds.center.y,maxZ)};
                        for(int edge=0;edge<corners.Length;edge++)
                        {
                            Vector3 start=frame.TransformPoint(corners[edge]),end=frame.TransformPoint(corners[(edge+1)%corners.Length]);
                            int samples=Mathf.Max(1,Mathf.CeilToInt(Vector3.Distance(start,end)/.5f));
                            for(int sample=0;sample<=samples;sample++)
                            {
                                Vector3 point=Vector3.Lerp(start,end,sample/(float)samples);
                                if(!component.TryMeshHeight(point.x,point.z,out float actual)||float.IsNaN(actual)||float.IsInfinity(actual))
                                    throw new InvalidOperationException("No saved ground below native shoreline wall: "+placed.StableObjectId);
                                bankFloor=Mathf.Min(bankFloor,actual);
                            }
                        }
                    }
                    if(float.IsPositiveInfinity(bankFloor))throw new InvalidOperationException("City shoreline without a native mesh: "+placed.StableObjectId);
                    if(p.retainingFinish)component.BuildRetainingFinish(visual,placed.StableObjectId,0);
                    float drop=offset-bankFloor+.1f;
                    if(drop>60)throw new InvalidOperationException("City bank requires a different retaining structure: "+placed.StableObjectId);
                    if(visual!=null)for(int level=1;level*3.01f<drop;level++)
                    {
                        var support=Instantiate(visual.gameObject,component._generatedRoot);
                        support.name="CityShoreDepth_"+placed.StableObjectId+"_"+level;
                        support.transform.SetPositionAndRotation(visual.position-Vector3.up*(level*3.01f),visual.rotation);
                        foreach(Collider collider in support.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                        if(p.retainingFinish)component.BuildRetainingFinish(support.transform,placed.StableObjectId,level);
                    }
                }
                if(placed.gameObject.activeInHierarchy&&placed.GameplayTags.Contains("resource")&&placed.GameplayTags.Contains("wood"))
                    offset+=component.SeatWoodResourceBase(placed.transform);
                var terrainPlacement=placed.GetComponent<RoaTerrainPlacement>() ?? placed.gameObject.AddComponent<RoaTerrainPlacement>();
                terrainPlacement.GroundOffset=offset;
            }
            var poseTransforms=new HashSet<Transform>();foreach(SourcePose pose in poses)poseTransforms.Add(pose.transform);
            foreach(KromkaSpawnAuthoring anchor in ground.transform.root.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
            {
                if(anchor.GetComponentInParent<KromkaPlacedObjectAuthoring>()!=null || anchor.transform.parent?.GetComponentInParent<KromkaSpawnAuthoring>()!=null)continue;
                Vector3 pos=anchor.transform.position;
                if(poseTransforms.Add(anchor.transform))poses.Add(new SourcePose {transform=anchor.transform,position=pos,active=anchor.gameObject.activeSelf});
                if(anchor.Kind==KromkaSpawnKind.PlayerArrival || anchor.Kind==KromkaSpawnKind.MigrationArrival){pos.x=p.hub.x;pos.z=p.hub.z;}
                if(changes.TryGetValue(anchor.SpawnId,out Placement moved) && !moved.remove){pos.x=moved.x;pos.z=moved.z;}
                float offset=Height(p,relief,pos.x,pos.z,true);pos.y+=offset;anchor.transform.position=pos;
                var placement=anchor.GetComponent<RoaTerrainPlacement>() ?? anchor.gameObject.AddComponent<RoaTerrainPlacement>();placement.GroundOffset=offset;
            }
            component._sourcePoses=poses.ToArray();
            return true;
        }
#if UNITY_EDITOR
        public static void RestoreSource(Renderer ground)
        {
            RoaSectorSurface component=ground?.GetComponent<RoaSectorSurface>();if(component==null)return;
            if(component._sourcePoses!=null)foreach(SourcePose pose in component._sourcePoses)
                if(pose.transform!=null){pose.transform.position=pose.position;pose.transform.gameObject.SetActive(pose.active);var placement=pose.transform.GetComponent<RoaTerrainPlacement>();if(placement!=null)DestroyImmediate(placement);}
            ground.GetComponent<MeshFilter>().sharedMesh=component._sourceMesh;
            ground.sharedMaterial=component._sourceMaterial;
            if(component._sourceTransformStored)
            {
                ground.transform.localPosition=component._sourceGroundPosition;
                ground.transform.localRotation=component._sourceGroundRotation;
                ground.transform.localScale=component._sourceGroundScale;
            }
            if(component._sourceColliders!=null)for(int i=0;i<component._sourceColliders.Length;i++)
                if(component._sourceColliders[i]!=null)component._sourceColliders[i].enabled=component._sourceColliderEnabled[i];
            if(component._surfaceCollider!=null)DestroyImmediate(component._surfaceCollider);
            if(component._generatedRoot!=null)DestroyImmediate(component._generatedRoot.gameObject);
            DestroyImmediate(component);
        }
#endif
        private void Bind(string id)
        {
            _locationId=id;Sector=Find(id);_relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            CacheSurface();_active=this;
        }
        private void CacheSurface()
        {
            Mesh mesh=GetComponent<MeshFilter>()?.sharedMesh;if(mesh==null)return;
            _surfaceVertices=mesh.vertices;
            for(int i=0;i<_surfaceVertices.Length;i++)_surfaceVertices[i]=transform.TransformPoint(_surfaceVertices[i]);
            _surfaceIndices=mesh.triangles;
            _shorePatchHeights=Sector?.surfacePatches?.Length>0
                ?new RoaMeshSurfaceHeight(_surfaceVertices,_surfaceIndices):null;
        }
        private void OnEnable(){if(!string.IsNullOrEmpty(_locationId))Bind(_locationId);}
        private Mesh BuildGround(Transform transform,Profile p,RoaGlobalMapRelief relief,int segments)
        {
            var vertices=new Vector3[(segments+1)*(segments+1)];var uv=new Vector2[vertices.Length];
            var ids=new int[segments*segments*6];int next=0;
            for(int z=0;z<=segments;z++)for(int x=0;x<=segments;x++)
            {
                Vector3 world=GridVertex(p,relief,x,z,segments);
                int i=z*(segments+1)+x;
                vertices[i]=transform.InverseTransformPoint(world);
                uv[i]=new Vector2(world.x/p.width+.5f,z/(float)segments);
                if(x==segments || z==segments)continue;
                int a=i,b=i+1,c=i+segments+1,d=c+1;
                ids[next++]=a;ids[next++]=c;ids[next++]=b;ids[next++]=b;ids[next++]=c;ids[next++]=d;
            }
            Mesh regular=MakeMesh("SectorRelief_"+p.zoneId,vertices,ids,uv);
            if(p.surfacePatches==null||p.surfacePatches.Length==0)return regular;
            Mesh patched=RoaSurfaceCellPatches.Apply(p,regular,transform,p.surfacePatches,
                (x,z)=>new Vector2(x/p.width+.5f,z/p.depth+.5f));
            _meshes.Add(patched);return patched;
        }
        private Mesh MakeMesh(string name,Vector3[] vertices,int[] indices,Vector2[] uv=null)
        {
            var mesh=new Mesh {name=name,indexFormat=IndexFormat.UInt32,vertices=vertices,triangles=indices};
            if(uv!=null)mesh.uv=uv;
            mesh.RecalculateNormals();mesh.RecalculateBounds();_meshes.Add(mesh);return mesh;
        }
        // The exported Float32 lattice is the common soil mesh, including its
        // vertical offset. Refined cells replace these vertices in Apply.
        public static Vector3 GridVertex(Profile p,RoaGlobalMapRelief relief,int ix,int iz,int segments,bool forceNative=false)
        {
            if(ix<0||iz<0||ix>segments||iz>segments)throw new ArgumentOutOfRangeException("Ground lattice vertex");
            GroundLattice cache=p.groundLattice;
            // JsonUtility instantiates empty reference objects for missing
            // fields. The explicit marker distinguishes an absent cache from
            // malformed authored cache data without an analytic fallback.
            if(!forceNative&&p.hasGroundLattice&&cache==null)
                throw new InvalidOperationException("Missing canonical ground lattice "+p.zoneId);
            if(!forceNative&&!p.hasGroundLattice&&cache!=null
                &&(!string.IsNullOrEmpty(cache.schema)||!string.IsNullOrEmpty(cache.zoneId)
                    ||!string.IsNullOrEmpty(cache.profileGeometryHash)||!string.IsNullOrEmpty(cache.geometryHash)
                    ||!string.IsNullOrEmpty(cache.codeHash)||cache.segments!=0||cache.vertexBits?.Length>0))
                throw new InvalidOperationException("Unmarked canonical ground lattice "+p.zoneId);
            if(!forceNative&&p.hasGroundLattice)
            {
                if(cache.schema!="roa.groundLattice.v1"||cache.zoneId!=p.zoneId||cache.segments!=segments
                    ||cache.vertexBits==null||cache.vertexBits.Length!=3*(segments+1)*(segments+1)
                    ||string.IsNullOrEmpty(cache.profileGeometryHash)||string.IsNullOrEmpty(cache.geometryHash)
                    ||string.IsNullOrEmpty(cache.codeHash))
                    throw new InvalidOperationException("Invalid canonical ground lattice "+p.zoneId);
                if(cache.decoded==null)
                {
                    var decoded=new Vector3[(segments+1)*(segments+1)];
                    for(int at=0;at<decoded.Length;at++)
                    {
                        float Read(int component)
                        {
                            long bits=cache.vertexBits[at*3+component];
                            if(bits<0||bits>uint.MaxValue)throw new InvalidOperationException("Invalid Float32 lattice bits "+p.zoneId);
                            float value=BitConverter.Int32BitsToSingle(unchecked((int)bits));
                            if(float.IsNaN(value)||float.IsInfinity(value))throw new InvalidOperationException("Nonfinite lattice vertex "+p.zoneId);
                            return value;
                        }
                        decoded[at]=new Vector3(Read(0),Read(1),Read(2));
                    }
                    cache.decoded=decoded;
                }
                return cache.decoded[iz*(segments+1)+ix];
            }
            float x=(ix/(float)segments-.5f)*p.width,z=(iz/(float)segments-.5f)*p.depth;
            if(ix>0&&ix<segments)x=SnapGridX(p,x,z,segments);
            return new Vector3(x,GridHeight(p,relief,x,z)-.05f*p.gain/160,z);
        }
        public static float GridHeight(Profile p,RoaGlobalMapRelief relief,float x,float z,bool applyRail=true)
        {
            // Detailed site grids retain the common 128-sample boundary. The
            // extra interior vertices must not change a neighbour's seam.
            bool vertical=Mathf.Abs(Mathf.Abs(x)-p.width*.5f)<.0001f;
            bool horizontal=Mathf.Abs(Mathf.Abs(z)-p.depth*.5f)<.0001f;
            if(!vertical&&!horizontal)return Height(p,relief,x,z,false,applyRail);
            if(!p.legacyDam&&p.terrainSegments!=256)return BoundaryHeight(p,relief,x,z,applyRail);
            float span=vertical?p.depth:p.width,along=vertical?z:x;
            float coordinate=Mathf.Clamp((along/span+.5f)*128,0,128);
            int first=Mathf.Min(127,Mathf.FloorToInt(coordinate));
            float a=CommonCoordinate(first),b=CommonCoordinate(first+1);
            while(first>0&&along<a){first--;a=CommonCoordinate(first);b=CommonCoordinate(first+1);}
            while(first<127&&along>b){first++;a=CommonCoordinate(first);b=CommonCoordinate(first+1);}
            float t=Mathf.InverseLerp(a,b,along);
            return vertical?Mathf.Lerp(BoundaryHeight(p,relief,x,a,applyRail),BoundaryHeight(p,relief,x,b,applyRail),t)
                :Mathf.Lerp(BoundaryHeight(p,relief,a,z,applyRail),BoundaryHeight(p,relief,b,z,applyRail),t);
            float CommonCoordinate(int column)
            {
                float original=(column/128f-.5f)*span;
                if(vertical||column==0||column==128)return original;
                // The common grid includes the shoreline-pinned vertices of
                // the 128-detail neighbour, rather than an unsnapped lattice.
                return SnapGridX(p,original,z,128);
            }
        }
        private static readonly Dictionary<Profile,Profile[]> BoundaryNeighbours=new Dictionary<Profile,Profile[]>();
        private static float BoundaryHeight(Profile p,RoaGlobalMapRelief relief,float x,float z,bool applyRail)
        {
            Vector2 point=MapPoint(p,x,z);
            if(!BoundaryNeighbours.TryGetValue(p,out Profile[] neighbours))
            {
                var candidates=AllProfiles;
#if !UNITY_EDITOR
                candidates=_runtimeCatalog.Headers;
#endif
                neighbours=candidates.Where(q=>Mathf.Abs(q.mapMinX-p.mapMinX)<=p.mapSpan&&Mathf.Abs(q.mapMinY-p.mapMinY)<=p.mapSpan)
                    .OrderBy(q=>q.mapMinY).ThenBy(q=>q.mapMinX).ToArray();BoundaryNeighbours[p]=neighbours;
            }
            // Sampling exactly on a river triangle edge can round inward on
            // the 160m city and outward on its 320m neighbour. One common
            // source supplies both boundary vertices in overview coordinates.
            Profile source=neighbours.FirstOrDefault(q=>point.x>=q.mapMinX-.00001f&&point.x<=q.mapMinX+q.mapSpan+.00001f
                &&point.y>=q.mapMinY-.00001f&&point.y<=q.mapMinY+q.mapSpan+.00001f)??p;
#if !UNITY_EDITOR
            source=Find(source.locationId);
#endif
            float sx=((point.x-source.mapMinX)/source.mapSpan-.5f)*source.width;
            float sz=(.5f-(point.y-source.mapMinY)/source.mapSpan)*source.depth;
            return (source.datum+Height(source,relief,sx,sz,false,applyRail)/source.gain-p.datum)*p.gain;
        }
        public static float SnapGridX(Profile p,float original,float z,int segments)
        {
            if(Mathf.Abs(original)>=p.width*.5f-.0001f)return original;
            // Visible water is clipped against each playable grid. At a shared
            // boundary its clipped lip can differ between 128 and 256 detail.
            // Both neighbours pin to the common authored river bank instead.
            bool boundary=Mathf.Abs(Mathf.Abs(z)-p.depth*.5f)<.0001f;
            var edges=boundary?p.waterEdges:p.visibleShore;
            float value=original,closest=p.width/segments*.5f;
            foreach(Edge edge in edges??Array.Empty<Edge>())
            {
                if(Mathf.Abs(edge.b.z-edge.a.z)<.000001f||z<Mathf.Min(edge.a.z,edge.b.z)-.0001f||z>Mathf.Max(edge.a.z,edge.b.z)+.0001f)continue;
                float bank=Mathf.Lerp(edge.a.x,edge.b.x,(z-edge.a.z)/(edge.b.z-edge.a.z)),distance=Mathf.Abs(bank-original);
                if(distance<closest){closest=distance;value=bank;}
            }
            return value;
        }
        private void BuildWater(Transform parent,Profile p)
        {
            if(p.waterIndices.Length==0)return;
            Mesh mesh=RoaSectorWaterMesh.Build(p,_surfaceVertices,_surfaceSegments,
                p.surfacePatches?.Length>0?_surfaceIndices:null);_meshes.Add(mesh);
            if(mesh.vertexCount==0)return;
            Material water=new Material(Resources.Load<Material>("RealmOfAshes/DamRoadRiver")){name="SectorRiver"};
            if(p.waterPollution!=null && p.waterPollution.color!=null && p.waterPollution.color.Length==4 && p.waterPollution.halfX>0 && p.waterPollution.halfZ>0)
            {
                Pollution film=p.waterPollution;Vector2 center=MapPoint(p,film.x,film.z);
                water.SetVector("_PollutionCenter",new Vector4(center.x*16,-center.y*16,0,0));
                water.SetVector("_PollutionRadii",new Vector4(film.halfX*320/p.width,film.halfZ*320/p.depth,0,0));
                water.SetColor("_PollutionColor",new Color(film.color[0],film.color[1],film.color[2],film.color[3]));
            }
            water.SetFloat("_BankDistanceMode",1);_materials.Add(water);
            RenderMesh(parent,"SectorWater",mesh,water,false);
        }
        private void BuildRetainingFinish(Transform nativeVisual,string objectId,int level)
        {
            // The imported reverse face uses one flat atlas pixel. Give only
            // the authored quay a metre-textured finish, without changing the
            // native mesh, material, transform, bounds or collision.
            if(_retainingFinishMaterial==null)
            {
                Texture2D texture=Resources.Load<Texture2D>(RoaGroundTextures.ResourceFolder+"dirty_concrete_albedo");
                Shader shader=Shader.Find("Universal Render Pipeline/Lit");
                if(texture==null||shader==null)throw new InvalidOperationException("Missing quay concrete finish");
                _retainingFinishMaterial=new Material(shader){name="CityQuayConcreteFinish"};
                _retainingFinishMaterial.SetTexture("_BaseMap",texture);
                _retainingFinishMaterial.SetColor("_BaseColor",new Color(.71f,.69f,.61f));
                _retainingFinishMaterial.SetFloat("_Smoothness",.06f);
                _retainingWearMaterial=new Material(_retainingFinishMaterial){name="CityQuayConcreteFootWear"};
                _retainingWearMaterial.SetColor("_BaseColor",new Color(.48f,.46f,.40f));
                _materials.Add(_retainingFinishMaterial);_materials.Add(_retainingWearMaterial);
            }
            int index=0;
            foreach(MeshFilter filter in nativeVisual.GetComponentsInChildren<MeshFilter>(true))
            {
                if(filter.sharedMesh==null)continue;
                Transform frame=filter.transform;Bounds bounds=filter.sharedMesh.bounds;
                float sx=frame.TransformVector(Vector3.right).magnitude;
                float sy=frame.TransformVector(Vector3.up).magnitude;
                float sz=frame.TransformVector(Vector3.forward).magnitude;
                if(sx<=0||sy<=0||sz<=0)throw new InvalidOperationException("Degenerate quay finish: "+objectId);
                float left=bounds.min.x+.025f/sx,right=bounds.max.x-.025f/sx;
                float bottom=bounds.min.y+.025f/sy,top=bounds.max.y-.025f/sy;
                if(left>=right||bottom>=top)throw new InvalidOperationException("Quay finish needs a concrete wall: "+objectId);
                string name="CityShoreFinish_"+objectId+"_"+level+"_"+(index++);
                Face(name,bottom,top,bounds.min.z-.006f/sz,_retainingFinishMaterial);
                Face(name+"_FootWear",bottom,Mathf.Min(top,bottom+.28f/sy),bounds.min.z-.009f/sz,_retainingWearMaterial);
                void Face(string label,float low,float high,float z,Material material)
                {
                    var local=new[]{new Vector3(left,low,z),new Vector3(right,low,z),new Vector3(right,high,z),new Vector3(left,high,z)};
                    var vertices=new Vector3[4];var uv=new Vector2[4];
                    for(int i=0;i<local.Length;i++)
                    {
                        vertices[i]=_generatedRoot.InverseTransformPoint(frame.TransformPoint(local[i]));
                        uv[i]=new Vector2((local[i].x-bounds.min.x)*sx,(local[i].y-bounds.min.y)*sy)*.5f;
                    }
                    GameObject finish=RenderMesh(_generatedRoot,label,MakeMesh(label,vertices,new[]{0,2,1,0,3,2},uv),material,false);
                    finish.GetComponent<MeshRenderer>().shadowCastingMode=ShadowCastingMode.Off;
                }
            }
        }
        private Material ColorMaterial(string name,Color color)
        {
            bool concrete=name=="SectorBridge"||name=="UtilityPipeSupport";
            bool steel=name=="SectorBridgeHandrail"||name=="SectorServiceWalkwayFrame";
            bool oxide=name=="OxidizedUtilityPipe";
            if(concrete||steel||oxide)
            {
                Material textured=RoaGroundTextures.CreateMaterial("wet_concrete",name,Application.isMobilePlatform);
                if(textured==null)throw new InvalidOperationException("Missing bridge infrastructure textures "+name);
                textured.SetFloat("_MacroStrength",0);
                textured.SetFloat("_GroundTiling",concrete?2.3f:1.1f);
                textured.SetFloat("_GroundSaturation",steel?.12f:.5f);
                textured.SetFloat("_NormalStrength",concrete?.75f:.22f);
                textured.SetFloat("_Metallic",steel?.48f:oxide?.16f:0f);
                textured.SetFloat("_DrySmoothness",steel?.25f:.16f);
                textured.SetColor("_BaseColor",new Color(color.r/.45f,color.g/.45f,color.b/.45f,1));
                _materials.Add(textured);return textured;
            }
            var material=new Material(Shader.Find("Universal Render Pipeline/Lit")){name=name};
            material.SetColor("_BaseColor",color);material.SetFloat("_Smoothness",0.1f);_materials.Add(material);return material;
        }
        private void BuildWaterBarriers(Transform parent,Profile p,RoaGlobalMapRelief relief)
        {
            Edge[] shoreline=p.physicalShore?.Length>0?p.physicalShore:p.visibleShore;
            if(shoreline==null || shoreline.Length==0)return;
            var vertices=new List<Vector3>();var ids=new List<int>();
            var levels=new Dictionary<Vector2,Vector2>();
            var shorePoints=new Dictionary<Vector2,Vector3>();
            float SignedShore(float x,float z)
            {
                WaterSample water=WaterAt(p,x,z);
                // Match IsWaterAt and the authoritative server footprint. A
                // coarse or refined soil face can cross the water at another
                // XZ; stopping there lets the capsule enter server-blocked water.
                float floor=Height(p,relief,x,z);
                return water.Inside||water.Distance<=.00001f
                    ? floor-water.Height-.02f*p.gain/160
                    : Mathf.Max(.001f,water.Distance);
            }
            Vector3 RefineShore(Vector3 point,Vector2 normal)
            {
                var key=new Vector2(point.x,point.z);
                if(shorePoints.TryGetValue(key,out Vector3 cached))return cached;
                float center=SignedShore(point.x,point.z),lo=0,hi=0,left=center,right=center;
                bool bracket=false;float cell=p.width/256;
                // The authored marching contour interpolates the height field.
                // Resolve the collision contour against the nonlinear field so
                // that a capsule stops before its authoritative water footprint.
                for(int step=1;step<=12&&!bracket;step++)
                {
                    float radius=cell*step/8;
                    float a=SignedShore(point.x-normal.x*radius,point.z-normal.y*radius);
                    float b=SignedShore(point.x+normal.x*radius,point.z+normal.y*radius);
                    if((a<0)!=(center<0)){lo=-radius;hi=0;left=a;right=center;bracket=true;}
                    else if((b<0)!=(center<0)){lo=0;hi=radius;left=center;right=b;bracket=true;}
                }
                if(bracket)for(int iteration=0;iteration<20;iteration++)
                {
                    float middle=(lo+hi)*.5f,value=SignedShore(point.x+normal.x*middle,point.z+normal.y*middle);
                    if((value<0)==(left<0)){lo=middle;left=value;}else {hi=middle;right=value;}
                }
                if(bracket){float shift=(lo+hi)*.5f;point.x+=normal.x*shift;point.z+=normal.y*shift;point.y=WaterAt(p,point.x,point.z).Height;}
                shorePoints[key]=point;return point;
            }
            Vector2 BarrierLevels(Vector3 shore)
            {
                var key=new Vector2(shore.x,shore.z);
                if(levels.TryGetValue(key,out Vector2 cached))return cached;
                float low=shore.y-5,high=Mathf.Max(shore.y,Height(p,relief,shore.x,shore.z))+3;
                // A cliff approach or a vehicle leaving a high bank must not
                // pass above a wall whose height only follows the waterline.
                // Include both the public roof and the lowered freight floor.
                foreach(float radius in new[]{3f,6f})for(int direction=0;direction<8;direction++)
                {
                    float angle=direction*Mathf.PI/4,x=shore.x+Mathf.Cos(angle)*radius,z=shore.z+Mathf.Sin(angle)*radius;
                    if(Mathf.Abs(x)>p.width/2||Mathf.Abs(z)>p.depth/2)continue;
                    float floor=Height(p,relief,x,z),publicGround=Height(p,relief,x,z,false,false);
                    low=Mathf.Min(low,Mathf.Min(floor,publicGround)-3);
                    high=Mathf.Max(high,Mathf.Max(floor,publicGround)+3);
                }
                return levels[key]=new Vector2(low,high);
            }
            var protectedDecks=new List<Vector2[]>();
            float bridgeScale=p.gain/160;
            RoaMeshSurfaceHeight guardGround=null;
            var guardSupports=new Dictionary<Vector2,float>();
            float GuardSupport(float x,float z)
            {
                var key=new Vector2(x,z);if(guardSupports.TryGetValue(key,out float cached))return cached;
                if(guardGround==null&&_surfaceCollider!=null&&_surfaceCollider.sharedMesh!=null)
                {
                    Mesh mesh=_surfaceCollider.sharedMesh;Vector3[] actual=mesh.vertices;
                    for(int i=0;i<actual.Length;i++)actual[i]=_surfaceCollider.transform.TransformPoint(actual[i]);
                    guardGround=new RoaMeshSurfaceHeight(actual,mesh.triangles);
                }
                float support=Height(p,relief,x,z,true);
                if(guardGround!=null&&guardGround.TryHeight(x,z,out float actualHeight))support=Mathf.Max(support,actualHeight);
                return guardSupports[key]=support;
            }
            float GuardCrest(Vector3 face,float deck)
            {
                // The existing 6m bank-support envelope covers every authored
                // vehicle's driver-to-corner reach (current maximum 5.49m).
                // A horizontal long body on a higher approach must meet a side
                // face, rather than skim the cap and receive an upward push.
                float support=Mathf.Max(deck,GuardSupport(face.x,face.z));
                for(int z=Mathf.CeilToInt(face.z-6);z<=Mathf.FloorToInt(face.z+6);z++)
                    for(int x=Mathf.CeilToInt(face.x-6);x<=Mathf.FloorToInt(face.x+6);x++)
                    {
                        if(Mathf.Abs(x)>p.width/2||Mathf.Abs(z)>p.depth/2
                            ||new Vector2(x-face.x,z-face.z).sqrMagnitude>36)continue;
                        support=Mathf.Max(support,GuardSupport(x,z));
                    }
                float driverSkin=Mathf.Clamp(RealmOfAshes.Game.RoaPlayerController.AuthoritativeCollisionRadius*.16f,.045f,.075f);
                return Mathf.Max(deck+.96f*bridgeScale,support+driverSkin+.025f
                    +RealmOfAshes.Game.RoaVehicleCatalog.Hull.Bottom+RealmOfAshes.Game.RoaVehicleCatalog.Hull.Height*.5f);
            }
            foreach(Route route in p.bridges)
            {
                // Foot-only walkways keep their existing guarded entrances.
                if(route.style=="railViaduct"||route.style=="metalService"||route.style=="legacyDam")continue;
                Point[] source=route.points?.Length>1?route.points:new[]{route.a,route.b};
                var centers=new List<Vector3>();
                // Match the real Ribbon cross-sections, including curved spans.
                for(int j=1;j<source.Length;j++)
                {
                    Vector3 a=source[j-1].Vector,b=source[j].Vector;
                    int count=Mathf.Max(1,Mathf.CeilToInt(new Vector2(b.x-a.x,b.z-a.z).magnitude/2));
                    for(int k=j==1?0:1;k<=count;k++)centers.Add(Vector3.Lerp(a,b,k/(float)count));
                }
                float innerWidth=route.halfWidth-.31f*bridgeScale,outerWidth=route.halfWidth-.13f*bridgeScale;
                if(innerWidth<=0)continue;
                var normals=new Vector3[centers.Count];
                for(int j=0;j<centers.Count;j++)
                {
                    Vector3 direction=centers[Mathf.Min(j+1,centers.Count-1)]-centers[Mathf.Max(0,j-1)];
                    direction.y=0;direction.Normalize();normals[j]=new Vector3(-direction.z,0,direction.x);
                }
                var wallVertices=new List<Vector3>();var wallIds=new List<int>();
                for(int j=1;j<centers.Count;j++)
                {
                    Vector3 a=centers[j-1],b=centers[j],middle=(a+b)*.5f;
                    Vector3 side=(normals[j-1]+normals[j]).normalized;
                    bool wet=false;
                    foreach(float across in new[]{-route.halfWidth-.5f,0,route.halfWidth+.5f})
                    {
                        Vector3 outside=middle+side*across;WaterSample water=WaterAt(p,outside.x,outside.z);
                        wet|=(water.Inside||water.Distance<=.00001f)&&Height(p,relief,outside.x,outside.z)<water.Height+.02f*bridgeScale;
                    }
                    if(!wet)continue;
                    Vector3 leftA=a-normals[j-1]*innerWidth,rightA=a+normals[j-1]*innerWidth,
                        leftB=b-normals[j]*innerWidth,rightB=b+normals[j]*innerWidth;
                    var polygon=new[]{XZ(leftA),XZ(rightA),XZ(rightB),XZ(leftB)};
                    // A portal is an exact convex subset of the saved deck, never
                    // an endpoint radius or a widened allowance into open water.
                    if(!Convex(polygon))continue;
                    protectedDecks.Add(polygon);
                    foreach(float sign in new[]{-1f,1f})
                    {
                        Vector3 inA=a+normals[j-1]*(sign*innerWidth),inB=b+normals[j]*(sign*innerWidth),
                            outA=a+normals[j-1]*(sign*outerWidth),outB=b+normals[j]*(sign*outerWidth);
                        // Each side ends at its own shore. A wet opposite side
                        // must not extend this parapet across a dry bank entrance.
                        int pieces=Mathf.Max(1,Mathf.CeilToInt(Vector3.Distance(outA,outB)/.25f));
                        var wetIntervals=new List<Vector2>();
                        for(int piece=0;piece<pieces;piece++)
                        {
                            float from=piece/(float)pieces,to=(piece+1)/(float)pieces;
                            Vector3 first=Vector3.Lerp(outA,outB,from),last=Vector3.Lerp(outA,outB,to);
                            bool firstWet=SignedShore(first.x,first.z)<0,lastWet=SignedShore(last.x,last.z)<0;
                            if(!firstWet&&!lastWet)continue;
                            if(firstWet!=lastWet)
                            {
                                float lo=from,hi=to;
                                for(int iteration=0;iteration<20;iteration++)
                                {
                                    float fraction=(lo+hi)*.5f;Vector3 point=Vector3.Lerp(outA,outB,fraction);
                                    if((SignedShore(point.x,point.z)<0)==firstWet)lo=fraction;else hi=fraction;
                                }
                                if(firstWet)to=(lo+hi)*.5f;else from=(lo+hi)*.5f;
                            }
                            if(to<=from)continue;
                            if(wetIntervals.Count>0&&wetIntervals[wetIntervals.Count-1].y==from)
                                wetIntervals[wetIntervals.Count-1]=new Vector2(wetIntervals[wetIntervals.Count-1].x,to);
                            else wetIntervals.Add(new Vector2(from,to));
                        }
                        foreach(Vector2 interval in wetIntervals)
                        {
                            float from=interval.x,to=interval.y;
                            Vector3 innerA=Vector3.Lerp(inA,inB,from),innerB=Vector3.Lerp(inA,inB,to),
                                outerA=Vector3.Lerp(outA,outB,from),outerB=Vector3.Lerp(outA,outB,to);
                            WaterSample waterA=WaterAt(p,outerA.x,outerA.z),waterB=WaterAt(p,outerB.x,outerB.z);
                            float lowA=BarrierLevels(new Vector3(outerA.x,waterA.Height,outerA.z)).x,
                                lowB=BarrierLevels(new Vector3(outerB.x,waterB.Height,outerB.z)).x;
                            float topA=GuardCrest(innerA,Mathf.Lerp(a.y,b.y,from)),topB=GuardCrest(innerB,Mathf.Lerp(a.y,b.y,to));
                        int n=wallVertices.Count;
                        wallVertices.AddRange(new[]{At(innerA,lowA),At(outerA,lowA),At(outerB,lowB),At(innerB,lowB),
                            At(innerA,topA),At(outerA,topA),At(outerB,topB),At(innerB,topB)});
                        int[] faces={0,1,2,0,2,3,4,6,5,4,7,6,0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4};
                        for(int face=0;face<faces.Length;face+=3)
                        {
                            wallIds.Add(n+faces[face]);
                            wallIds.Add(n+faces[face+(sign>0?2:1)]);
                            wallIds.Add(n+faces[face+(sign>0?1:2)]);
                        }
                        }
                    }
                }
                if(wallIds.Count>0)
                    RenderMesh(parent,"BridgeWaterParapets_"+route.id,
                        ClipToSector(MakeMesh("BridgeWaterParapets_"+route.id,wallVertices.ToArray(),wallIds.ToArray())),
                        ColorMaterial("SectorBridge",new Color(.39f,.39f,.36f)),true);
            }
            Vector2 XZ(Vector3 point)=>new Vector2(point.x,point.z);
            Vector3 At(Vector3 point,float height)=>new Vector3(point.x,height,point.z);
            float Cross(Vector2 a,Vector2 b)=>a.x*b.y-a.y*b.x;
            bool Convex(Vector2[] polygon)
            {
                float winding=0;
                for(int j=0;j<polygon.Length;j++)
                {
                    float cross=Cross(polygon[(j+1)%polygon.Length]-polygon[j],polygon[(j+2)%polygon.Length]-polygon[(j+1)%polygon.Length]);
                    if(Mathf.Abs(cross)<.000001f)return false;
                    if(winding!=0&&cross*winding<0)return false;winding=cross;
                }
                return true;
            }
            bool PortalInterval(Vector3 a,Vector3 b,Vector2[] polygon,out Vector2 interval)
            {
                float lo=0,hi=1,winding=Cross(polygon[1]-polygon[0],polygon[2]-polygon[1]);
                for(int j=0;j<polygon.Length;j++)
                {
                    Vector2 edge=polygon[(j+1)%polygon.Length]-polygon[j];
                    float atA=Cross(edge,XZ(a)-polygon[j])*Mathf.Sign(winding),
                        atB=Cross(edge,XZ(b)-polygon[j])*Mathf.Sign(winding);
                    if(atA<0&&atB<0){interval=default;return false;}
                    if(atA<0)lo=Mathf.Max(lo,atA/(atA-atB));
                    if(atB<0)hi=Mathf.Min(hi,atA/(atA-atB));
                }
                interval=new Vector2(lo,hi);return hi>lo;
            }
            foreach(Edge edge in shoreline)
            {
                float length=Vector2.Distance(new Vector2(edge.a.x,edge.a.z),new Vector2(edge.b.x,edge.b.z));
                if(length<.00001f)continue;
                int steps=Mathf.Max(1,Mathf.CeilToInt(length/.25f));
                Vector2 normal=new Vector2(-(edge.b.z-edge.a.z),edge.b.x-edge.a.x).normalized;
                for(int i=0;i<steps;i++)
                {
                    Vector3 sourceA=i==0?edge.a.Vector:Vector3.Lerp(edge.a.Vector,edge.b.Vector,i/(float)steps),
                        sourceB=i+1==steps?edge.b.Vector:Vector3.Lerp(edge.a.Vector,edge.b.Vector,(i+1)/(float)steps);
                    Vector3 a=RefineShore(sourceA,normal),b=RefineShore(sourceB,normal);
                    Route bridge=BridgeAt(p,(a.x+b.x)*.5f,(a.z+b.z)*.5f);
                    Vector2 atA=BarrierLevels(a),atB=BarrierLevels(b);
                    float topA=bridge!=null ? BridgeHeight(bridge,a.x,a.z)-.15f : atA.y;
                    float topB=bridge!=null ? BridgeHeight(bridge,b.x,b.z)-.15f : atB.y;
                    var openings=new List<Vector2>();
                    foreach(Vector2[] polygon in protectedDecks)
                        if(PortalInterval(a,b,polygon,out Vector2 interval))openings.Add(interval);
                    openings.Sort((left,right)=>left.x.CompareTo(right.x));
                    float cursor=0;
                    foreach(Vector2 opening in openings)
                    {
                        if(opening.x>cursor)BarrierPart(cursor,opening.x);
                        cursor=Mathf.Max(cursor,opening.y);
                    }
                    if(cursor<1)BarrierPart(cursor,1);
                    void BarrierPart(float from,float to)
                    {
                        Vector3 start=Vector3.Lerp(a,b,from),end=Vector3.Lerp(a,b,to);int n=vertices.Count;
                        vertices.AddRange(new[]{At(start,Mathf.Lerp(atA.x,atB.x,from)),At(end,Mathf.Lerp(atA.x,atB.x,to)),
                            At(start,Mathf.Lerp(topA,topB,from)),At(end,Mathf.Lerp(topA,topB,to))});
                        ids.AddRange(new[]{n,n+2,n+1,n+1,n+2,n+3,n,n+1,n+2,n+1,n+3,n+2});
                    }
                }
            }
            var go=new GameObject("SectorWaterBarrier");go.transform.SetParent(parent,false);
            go.AddComponent<MeshCollider>().sharedMesh=MakeMesh("WaterBarrier_"+p.zoneId,vertices.ToArray(),ids.ToArray());
        }
        private GameObject RenderMesh(Transform parent,string name,Mesh mesh,Material material,bool collision)
        {
            var go=new GameObject(name);go.transform.SetParent(parent,false);
            go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
            if(collision)go.AddComponent<MeshCollider>().sharedMesh=mesh;
            return go;
        }
        private void BuildRoutes(Transform parent,Profile p,RoaGlobalMapRelief relief)
        {
            Material concrete=ColorMaterial("SectorBridge",new Color(0.39f,0.39f,0.36f));
            BuildRoadBankWalls(parent,p,concrete);
            BuildRoadBankContactFootings(parent,p,concrete);
            BuildBridgeBankRevetments(parent,p,concrete);
            Material walkwayFrame=ColorMaterial("SectorServiceWalkwayFrame",new Color(.25f,.27f,.25f));
            walkwayFrame.SetFloat("_Metallic",.48f);walkwayFrame.SetFloat("_Smoothness",.16f);
            Material walkwayDeck=ColorMaterial("SectorServiceWalkwayDeck",new Color(.43f,.39f,.32f));
            walkwayDeck.SetFloat("_Metallic",.08f);walkwayDeck.SetFloat("_Smoothness",.08f);
            Material walkwaySeams=ColorMaterial("SectorServiceWalkwaySeams",new Color(.23f,.22f,.20f));
            RoaSectorRailInfrastructure.Build(parent,p,relief);
            if(p.processPipes!=null)foreach(Route pipe in p.processPipes)BuildPipeline(parent,p,pipe,relief);
            foreach(Route route in p.roads)
            {
                if(route.blocked)continue;
                if(route.type=="pipeline"){BuildPipeline(parent,p,route,relief);continue;}
                if(route.type=="railway")
                {
                    if(p.railInfrastructure!=null && p.railInfrastructure.Any(r=>r.sourceRoadId==route.id))continue;
                    Point[] routePoints=route.points!=null && route.points.Length>1 ? route.points : new[]{route.a,route.b};
                    var sampled=new List<RoaDamRoadRailProjection.Point>();
                    for(int j=1;j<routePoints.Length;j++)
                    {
                        Point a=routePoints[j-1],b=routePoints[j];
                        int steps=Mathf.Max(1,Mathf.CeilToInt(Vector2.Distance(new Vector2(a.x,a.z),new Vector2(b.x,b.z))/2));
                        for(int k=j==1?0:1;k<=steps;k++)sampled.Add(new RoaDamRoadRailProjection.Point {x=Mathf.Lerp(a.x,b.x,k/(float)steps),z=Mathf.Lerp(a.z,b.z,k/(float)steps)});
                    }
                    RoaDamRoadRailProjection.BuildRoute(parent,route.id,sampled.ToArray(),
                        (x,z)=>Height(p,relief,x,z,true)+0.025f);
                    continue;
                }
                // Ground routes are painted into the terrain material. An
                // independent ribbon intersects the coarse terrain triangles
                // on hills and leaves saw-toothed gaps in the road surface.
            }
            foreach(Route b in p.bridges)
            {
                if(b.style=="railViaduct")continue;
                bool service=b.style=="metalService";
                Ribbon(parent,b,relief,service?walkwayDeck:concrete,true);
                BridgeStructure(parent,b,relief,service?walkwayFrame:concrete);
                if(service)WalkwayDeckSeams(parent,b,walkwaySeams);
            }
        }
        private static float[] BankRecipeValues(BridgeBankRevetment c)=>new[]{c.minX,c.maxX,c.minZ,c.maxZ,c.thickness,c.cover,c.toeEmbed,c.minSlope,c.minLift,c.roadMargin,c.protectionMargin};
        private static bool BankFinite(float value)=>!float.IsNaN(value)&&!float.IsInfinity(value);
        private static void BankString(System.IO.BinaryWriter writer,string text)
        {
            byte[] bytes=System.Text.Encoding.UTF8.GetBytes(text??"");writer.Write(bytes.Length);writer.Write(bytes);
        }
        private static string BankDigest(Action<System.IO.BinaryWriter> write)
        {
            using(var stream=new System.IO.MemoryStream())
            {
                using(var writer=new System.IO.BinaryWriter(stream,System.Text.Encoding.UTF8,true))write(writer);
                using(var sha=System.Security.Cryptography.SHA256.Create())
                    return BitConverter.ToString(sha.ComputeHash(stream.ToArray())).Replace("-","").ToLowerInvariant();
            }
        }
        private static List<KeyValuePair<string,Route>> BankRoutes(Profile p)
        {
            var routes=new List<KeyValuePair<string,Route>>();
            foreach(Route r in p.bridges??Array.Empty<Route>())routes.Add(new KeyValuePair<string,Route>("bridge",r));
            foreach(Route r in p.roads??Array.Empty<Route>())if(!r.blocked&&(r.type=="road"||r.type=="track"))routes.Add(new KeyValuePair<string,Route>("road",r));
            routes.Sort((a,b)=>StringComparer.Ordinal.Compare(a.Key+":"+a.Value.id,b.Key+":"+b.Value.id));return routes;
        }
        private static Point[] BankRoutePoints(Route r)=>r.points!=null&&r.points.Length>0?r.points:new[]{r.a,r.b};
        private static string BankSourceHash(Profile p,BridgeBankRevetment c)=>BankDigest(w=>
        {
            BankString(w,"roa.bridgeBankRevetment.v4");BankString(w,p.zoneId);BankString(w,p.groundLattice?.profileGeometryHash);
            BankString(w,c.id);BankString(w,c.bridge);BankString(w,c.end);BankString(w,c.association);foreach(float v in BankRecipeValues(c))w.Write(v);
            var routes=BankRoutes(p);w.Write(routes.Count);foreach(var entry in routes)
            {
                Route r=entry.Value;BankString(w,entry.Key);BankString(w,r.id);w.Write(r.halfWidth);
                Point[] points=BankRoutePoints(r);w.Write(points.Length);foreach(Point q in points){w.Write(q.x);w.Write(q.z);}
            }
        });
        private static string BankGeometryHash(BridgeBankRevetmentMesh m)=>BankDigest(w=>
        {
            BankString(w,m.sourceHash);w.Write(m.vertices.Length);foreach(Point q in m.vertices){w.Write(q.x);w.Write(q.h);w.Write(q.z);}
            foreach(int[] rows in new[]{m.indices,m.prisms}){w.Write(rows.Length);foreach(int i in rows)w.Write(i);}
        });
        private static double BankCross(Vector2 a,Vector2 b,Vector2 c)=>((double)b.x-a.x)*(c.y-a.y)-((double)b.y-a.y)*(c.x-a.x);
        private static List<Vector2> BankHull(IEnumerable<Vector2> points)
        {
            var sorted=points.Distinct().OrderBy(v=>v.x).ThenBy(v=>v.y).ToArray();var low=new List<Vector2>();var high=new List<Vector2>();
            foreach(Vector2 v in sorted){while(low.Count>1&&BankCross(low[low.Count-2],low[low.Count-1],v)<=0)low.RemoveAt(low.Count-1);low.Add(v);}
            foreach(Vector2 v in sorted.Reverse()){while(high.Count>1&&BankCross(high[high.Count-2],high[high.Count-1],v)<=0)high.RemoveAt(high.Count-1);high.Add(v);}
            if(sorted.Length<3)return sorted.ToList();low.RemoveAt(low.Count-1);high.RemoveAt(high.Count-1);low.AddRange(high);return low;
        }
        private static bool BankInside(Vector2 p,List<Vector2> poly)=>poly.Count>2&&poly.Select((v,i)=>BankCross(v,poly[(i+1)%poly.Count],p)).All(d=>d>=-1e-8);
        private static double BankPointSegment(Vector2 p,Vector2 a,Vector2 b)
        {
            double dx=(double)b.x-a.x,dz=(double)b.y-a.y,den=dx*dx+dz*dz;
            double t=den>0?Math.Max(0,Math.Min(1,(((double)p.x-a.x)*dx+((double)p.y-a.y)*dz)/den)):0;
            return Math.Sqrt(Math.Pow(p.x-a.x-t*dx,2)+Math.Pow(p.y-a.y-t*dz,2));
        }
        private static double BankSegmentDistance(Vector2 a,Vector2 b,Vector2 c,Vector2 d)
        {
            if(BankCross(a,b,c)*BankCross(a,b,d)<0&&BankCross(c,d,a)*BankCross(c,d,b)<0)return 0;
            return Math.Min(Math.Min(BankPointSegment(a,c,d),BankPointSegment(b,c,d)),Math.Min(BankPointSegment(c,a,b),BankPointSegment(d,a,b)));
        }
        private sealed class BankProtectedSegment { public Vector2 a,b; public double radius; public List<Vector2> polygon; }
        private static List<BankProtectedSegment> BankProtectedSegments(Profile p,BridgeBankRevetment c)
        {
            var result=new List<BankProtectedSegment>();foreach(var entry in BankRoutes(p))
            {
                Point[] points=BankRoutePoints(entry.Value);for(int i=1;i<points.Length;i++)
                {
                    Vector2 a=new Vector2(points[i-1].x,points[i-1].z),b=new Vector2(points[i].x,points[i].z);
                    double dx=(double)b.x-a.x,dz=(double)b.y-a.y,length=Math.Sqrt(dx*dx+dz*dz);if(length<1e-8)continue;
                    double radius=entry.Value.halfWidth+(entry.Key=="road"?c.roadMargin:0)+c.protectionMargin;
                    var s=new BankProtectedSegment {a=a,b=b,radius=radius};if(entry.Key=="bridge")
                    {
                        double tx=dx/length,tz=dz/length,nx=-tz,nz=tx;
                        s.polygon=BankHull(new[]{
                            new Vector2((float)(a.x-tx*c.protectionMargin+nx*radius),(float)(a.y-tz*c.protectionMargin+nz*radius)),
                            new Vector2((float)(b.x+tx*c.protectionMargin+nx*radius),(float)(b.y+tz*c.protectionMargin+nz*radius)),
                            new Vector2((float)(b.x+tx*c.protectionMargin-nx*radius),(float)(b.y+tz*c.protectionMargin-nz*radius)),
                            new Vector2((float)(a.x-tx*c.protectionMargin-nx*radius),(float)(a.y-tz*c.protectionMargin-nz*radius))});
                    }
                    result.Add(s);
                }
            }
            return result;
        }
        private static bool BankProtected(List<Vector2> poly,List<BankProtectedSegment> segments)
        {
            foreach(var s in segments)
            {
                if(s.polygon==null)
                {
                    if(BankInside(s.a,poly)||BankInside(s.b,poly))return true;
                    for(int i=0;i<poly.Count;i++)if(BankSegmentDistance(poly[i],poly[(i+1)%poly.Count],s.a,s.b)<=s.radius+1e-6)return true;
                }
                else
                {
                    if(poly.Any(v=>BankInside(v,s.polygon))||s.polygon.Any(v=>BankInside(v,poly)))return true;
                    for(int i=0;i<poly.Count;i++)for(int j=0;j<s.polygon.Count;j++)
                        if(BankSegmentDistance(poly[i],poly[(i+1)%poly.Count],s.polygon[j],s.polygon[(j+1)%s.polygon.Count])<1e-7)return true;
                }
            }
            return false;
        }
        private sealed class BankEdge { public int a,b,count; }
        private static List<BankEdge> BankMeshEdges(int[] triangles)
        {
            var rows=new Dictionary<long,BankEdge>();var ordered=new List<BankEdge>();
            for(int i=0;i<triangles.Length;i+=3)for(int j=0;j<3;j++)
            {
                int a=triangles[i+j],b=triangles[i+(j+1)%3];long key=((long)Math.Min(a,b)<<32)|(uint)Math.Max(a,b);
                if(!rows.TryGetValue(key,out BankEdge e)){e=new BankEdge {a=a,b=b};rows.Add(key,e);ordered.Add(e);}e.count++;
            }
            return ordered;
        }
        private void AssertWetBankComponents(Profile p,BridgeBankRevetment c,int[] front,Vector3[] vertices)
        {
            var natural=new Profile {width=p.width,depth=p.depth,mapMinX=p.mapMinX,mapMinY=p.mapMinY,mapSpan=p.mapSpan,gain=p.gain,datum=p.datum,
                legacyDam=p.legacyDam,foundations=Array.Empty<Foundation>(),corridors=Array.Empty<Corridor>(),roads=Array.Empty<Route>(),bridges=Array.Empty<Route>(),
                waterVertices=p.waterVertices,waterIndices=p.waterIndices,waterEdges=p.waterEdges,hydroCuts=p.hydroCuts,
                railInfrastructure=p.railInfrastructure,roadBankTreatments=p.roadBankTreatments};
            int count=front.Length/3;var edges=new Dictionary<long,List<int>>();var adjacent=new List<int>[count];
            for(int f=0;f<count;f++){adjacent[f]=new List<int>();for(int j=0;j<3;j++){
                int a=front[f*3+j],b=front[f*3+(j+1)%3];long key=((long)Math.Min(a,b)<<32)|(uint)Math.Max(a,b);
                if(!edges.TryGetValue(key,out List<int> faces)){faces=new List<int>();edges.Add(key,faces);}faces.Add(f);}}
            foreach(var faces in edges.Values){if(faces.Count>2)throw new InvalidOperationException("Non-manifold bank association "+p.zoneId);
                if(faces.Count==2){adjacent[faces[0]].Add(faces[1]);adjacent[faces[1]].Add(faces[0]);}}
            var visited=new bool[count];for(int seed=0;seed<count;seed++)if(!visited[seed]){
                var group=new List<int>{seed};visited[seed]=true;for(int i=0;i<group.Count;i++)foreach(int n in adjacent[group[i]])if(!visited[n]){visited[n]=true;group.Add(n);}
                var members=new HashSet<int>(group);var checkedVertices=new HashSet<int>();bool wetConnected=false;
                foreach(var edge in edges)if(edge.Value.Count==1&&members.Contains(edge.Value[0])){
                    int a=(int)(edge.Key>>32),b=(int)(edge.Key&0xffffffffL);foreach(int id in new[]{a,b})if(checkedVertices.Add(id)){
                        Vector3 q=vertices[id];float sourceZ=q.z-c.cover;WaterSample wet=WaterAt(p,q.x,q.z);
                        if(!TryMeshHeight(q.x,sourceZ,out float sourceGround)||!TryMeshHeight(q.x,q.z,out float outerGround))
                            throw new InvalidOperationException("Unsupported native bank association "+p.zoneId);
                        if(wet.Inside&&sourceGround<=wet.Height+.5f&&outerGround<=wet.Height+.0015f)wetConnected=true;
                    }}
                if(!wetConnected)throw new InvalidOperationException("Detached non-wet bank component "+p.zoneId);
                bool raisedSeed=false;foreach(int f in group)
                {
                    Vector3 center=(vertices[front[f*3]]+vertices[front[f*3+1]]+vertices[front[f*3+2]])/3;
                    float sourceZ=center.z-c.cover;if(!TryMeshHeight(center.x,sourceZ,out float nativeGround))
                        throw new InvalidOperationException("Unsupported native bank seed "+p.zoneId);
                    float raw=Height(natural,_relief,center.x,sourceZ,false)-.05f*p.gain/160;
                    if(nativeGround-raw>=c.minLift-.0015f){raisedSeed=true;break;}
                }
                if(!raisedSeed)throw new InvalidOperationException("Native wet bank component lacks engineered seed "+p.zoneId);
            }
        }
        private void BuildBridgeBankRevetments(Transform parent,Profile p,Material concrete)
        {
            var configs=p.bridgeBankRevetments;var meshes=p.bridgeBankRevetmentMeshes;
            if(configs==null||configs.Length==0)
            {
                if(meshes!=null&&meshes.Length>0)throw new InvalidOperationException("Unmarked bridge bank revetment "+p.zoneId);return;
            }
            if(!p.hasGroundLattice||p.groundLattice==null||p.surfacePatches==null||p.surfacePatches.Length==0
                ||meshes==null||meshes.Length!=configs.Length||configs.Select(c=>c.id).Distinct().Count()!=configs.Length)
                throw new InvalidOperationException("Incomplete indexed bridge bank revetment "+p.zoneId);
            for(int mi=0;mi<configs.Length;mi++)
            {
                BridgeBankRevetment c=configs[mi];BridgeBankRevetmentMesh m=meshes[mi];
                if(c==null||m==null||string.IsNullOrEmpty(c.id)||!(c.end=="a"||c.end=="b")||!p.bridges.Any(b=>b.id==c.bridge)
                    ||!BankRecipeValues(c).All(BankFinite)||c.minX>=c.maxX||c.minZ>=c.maxZ||c.minX<-p.width/2||c.maxX>p.width/2||c.minZ<-p.depth/2||c.maxZ>p.depth/2
                    ||c.association!="native-wet-connected-fill"||c.thickness!=.5f||c.cover!=.025f||c.toeEmbed!=.25f||c.minSlope<1||c.minLift<.5f||c.roadMargin!=.73f||c.protectionMargin!=.5f
                    ||m.id!=c.id||m.sourceHash!=BankSourceHash(p,c)||m.vertices==null||m.vertices.Length==0||m.indices==null||m.indices.Length==0||m.indices.Length%3!=0
                    ||m.prisms==null||m.prisms.Length==0||m.prisms.Length%6!=0||m.geometryHash!=BankGeometryHash(m))
                    throw new InvalidOperationException("Stale bridge bank revetment "+p.zoneId);
                Vector3[] vertices=m.vertices.Select(q=>q.Vector).ToArray();
                if(vertices.Any(q=>!BankFinite(q.x)||!BankFinite(q.y)||!BankFinite(q.z))||m.indices.Concat(m.prisms).Any(i=>i<0||i>=vertices.Length))
                    throw new InvalidOperationException("Invalid bridge bank mesh vertex/index "+p.zoneId);
                for(int i=0;i<m.indices.Length;i+=3)
                    if(Vector3.Cross(vertices[m.indices[i+1]]-vertices[m.indices[i]],vertices[m.indices[i+2]]-vertices[m.indices[i]]).sqrMagnitude<1e-20f)
                        throw new InvalidOperationException("Degenerate bridge bank mesh face "+p.zoneId);
                if(BankMeshEdges(m.indices).Any(e=>e.count!=2))throw new InvalidOperationException("Open bridge bank mesh "+p.zoneId);
                var segments=BankProtectedSegments(p,c);var expected=new List<int>();var front=new List<int>();
                for(int i=0;i<m.prisms.Length;i+=6)
                {
                    int[] ids=m.prisms.Skip(i).Take(6).ToArray();Vector3[] v=ids.Select(j=>vertices[j]).ToArray();
                    for(int j=0;j<3;j++)if(ids[j]%2!=0||ids[j]+1!=ids[j+3]||v[j].x!=v[j+3].x||v[j].y!=v[j+3].y||Math.Abs(v[j].z-v[j+3].z-c.thickness)>3e-5)
                        throw new InvalidOperationException("Altered bridge bank thickness "+p.zoneId);
                    if(BankCross(new Vector2(v[0].x,v[0].z),new Vector2(v[1].x,v[1].z),new Vector2(v[2].x,v[2].z))>=-1e-10
                        ||BankProtected(BankHull(v.Select(q=>new Vector2(q.x,q.z))),segments))
                        throw new InvalidOperationException("Bridge bank intrusion/inverted prism "+p.zoneId);
                    front.AddRange(new[]{ids[0],ids[1],ids[2]});expected.AddRange(new[]{ids[0],ids[1],ids[2],ids[3],ids[5],ids[4]});
                }
                foreach(BankEdge e in BankMeshEdges(front.ToArray()))
                {
                    if(e.count==1)expected.AddRange(new[]{e.a,e.a+1,e.b,e.b,e.a+1,e.b+1});
                    else if(e.count!=2)throw new InvalidOperationException("Non-manifold bridge bank source "+p.zoneId);
                }
                if(!expected.SequenceEqual(m.indices)||m.prisms.Distinct().Count()!=vertices.Length)
                    throw new InvalidOperationException("Bridge bank render/collider/server volume mismatch "+p.zoneId);
                for(int i=0;i<vertices.Length;i+=2)
                {
                    Vector3 q=vertices[i];float sourceZ=q.z-c.cover;
                    if(!TryMeshHeight(q.x,sourceZ,out float sourceGround)||!TryMeshHeight(q.x,q.z,out float outerGround)||q.y>sourceGround+.0015f)
                        throw new InvalidOperationException("Floating bank crown "+p.zoneId);
                    if(q.y<sourceGround-.0015f)
                    {
                        WaterSample wet=WaterAt(p,q.x,q.z);float expectedToe=Mathf.Min(sourceGround,outerGround)-c.toeEmbed;
                        if(!wet.Inside||sourceGround>=wet.Height-.0015f||Mathf.Abs(q.y-expectedToe)>.0015f)
                            throw new InvalidOperationException("Detached bank toe "+p.zoneId);
                    }
                }
                for(int i=0;i<front.Count;i+=3)
                {
                    bool lowered=false,exposed=false;
                    for(int j=0;j<3;j++)
                    {
                        Vector3 q=vertices[front[i+j]];
                        if(!TryMeshHeight(q.x,q.z-c.cover,out float sourceGround))
                            throw new InvalidOperationException("Missing native bank face support "+p.zoneId);
                        lowered|=q.y<sourceGround-.0015f;
                        exposed|=q.y>WaterAt(p,q.x,q.z).Height+.0015f;
                    }
                    if(lowered&&exposed)throw new InvalidOperationException("Exposed bank front deformation "+p.zoneId);
                }
                AssertWetBankComponents(p,c,front.ToArray(),vertices);
                // Separate render vertices give every closed face its true
                // normal. Metre UVs run continuously across the front faces.
                var render=new Vector3[m.indices.Length];var uv=new Vector2[render.Length];var indices=new int[render.Length];
                for(int i=0;i<render.Length;i+=3)
                {
                    Vector3 a=vertices[m.indices[i]],b=vertices[m.indices[i+1]],d=vertices[m.indices[i+2]],n=Vector3.Cross(b-a,d-a).normalized;
                    for(int j=0;j<3;j++){Vector3 q=vertices[m.indices[i+j]];render[i+j]=q;indices[i+j]=i+j;
                        uv[i+j]=i<m.prisms.Length?new Vector2(q.x,q.y):Mathf.Abs(n.y)>.7f?new Vector2(q.x,q.z):Mathf.Abs(n.z)>=Mathf.Abs(n.x)?new Vector2(q.x,q.y):new Vector2(q.z,q.y);}
                }
                string name="BridgeBankRevetment_"+m.id;
                // The metre UVs retain the concrete's construction joints on
                // steep lining. Ground weather masks must not turn it into soil.
                Material authored=Resources.Load<Material>("RealmOfAshes/BridgeBankConcrete");
                if(authored==null)throw new InvalidOperationException("Missing bridge bank concrete");
                Material lining=new Material(authored){name="BridgeBankConcrete_"+m.id};_materials.Add(lining);
                Mesh liningMesh=MakeMesh(name,render,indices,uv);liningMesh.RecalculateTangents();
                RenderMesh(parent,name,liningMesh,lining,true);
            }
        }
        private void BuildRoadBankWalls(Transform parent,Profile p,Material concrete)
        {
            if(!p.hasRoadBankContactWalls&&p.roadBankContactWalls!=null&&p.roadBankContactWalls.Length>0)
                throw new InvalidOperationException("Unmarked retaining contact wall "+p.zoneId);
            RoadBankWall[] walls=p.hasRoadBankContactWalls?p.roadBankContactWalls:p.roadBankWalls;
            if(p.hasRoadBankContactWalls)
            {
                if(p.roadBankWalls==null||p.roadBankWalls.Length==0||walls==null||walls.Length!=p.roadBankWalls.Length)
                    throw new InvalidOperationException("Incomplete retaining contact wall "+p.zoneId);
                for(int i=0;i<walls.Length;i++)
                {
                    RoadBankWall source=p.roadBankWalls[i],derived=walls[i];
                    if(source.id!=derived.id||source.points==null||derived.points==null||source.points.Length!=derived.points.Length)
                        throw new InvalidOperationException("Mismatched retaining contact wall "+p.zoneId);
                    for(int j=0;j<derived.points.Length;j++)
                    {
                        RoadBankWallPoint a=source.points[j],b=derived.points[j];
                        if(a.x!=b.x||a.z!=b.z||a.top!=b.top||a.bottom!=b.bottom)
                            throw new InvalidOperationException("Altered retaining inner face "+p.zoneId);
                        float width=new Vector2(b.outerX-b.x,b.outerZ-b.z).magnitude;
                        if(float.IsNaN(width)||width<.24999f||width>.80001f)
                            throw new InvalidOperationException("Invalid retaining contact thickness "+p.zoneId);
                    }
                }
            }
            if(walls==null)return;
            foreach(RoadBankWall wall in walls)
            {
                if(wall.points==null||wall.points.Length<2)throw new InvalidOperationException("Empty road retaining wall "+wall.id);
                var vertices=new List<Vector3>();var ids=new List<int>();var uv=new List<Vector2>();
                float along=0;int winding=0;
                for(int i=0;i<wall.points.Length;i++)
                {
                    RoadBankWallPoint a=wall.points[i];
                    if(i>0)along+=new Vector2(a.x-wall.points[i-1].x,a.z-wall.points[i-1].z).magnitude;
                    // Adjacent spans share one embedded cross-section. This is
                    // no higher than either former span floor at the same node.
                    float bottom=Mathf.Min(a.bottom,wall.points[Mathf.Max(0,i-1)].bottom,
                        wall.points[Mathf.Min(wall.points.Length-1,i+1)].bottom);
                    vertices.AddRange(new[]{new Vector3(a.x,bottom,a.z),new Vector3(a.outerX,bottom,a.outerZ),
                        new Vector3(a.outerX,a.top,a.outerZ),new Vector3(a.x,a.top,a.z)});
                    for(int j=0;j<4;j++)uv.Add(new Vector2(along,vertices[vertices.Count-4+j].y));
                    if(i==0)continue;
                    RoadBankWallPoint previous=wall.points[i-1];
                    float area=(a.x-previous.x)*(a.outerZ-previous.z)-(a.z-previous.z)*(a.outerX-previous.x);
                    float other=(a.outerX-previous.x)*(previous.outerZ-previous.z)
                        -(a.outerZ-previous.z)*(previous.outerX-previous.x);
                    int sign=area>0?1:area<0?-1:0;
                    if(sign==0||other*sign<=.0000001f||(winding!=0&&sign!=winding))
                        throw new InvalidOperationException("Folded retaining wall "+wall.id);
                    winding=sign;
                    int from=(i-1)*4,to=i*4;
                    Face(from, to, to+1, from+1);
                    Face(from+3, from+2, to+2, to+3);
                    Face(from, from+3, to+3, to);
                    Face(from+1, to+1, to+2, from+2);
                }
                Face(0,1,2,3);
                int last=(wall.points.Length-1)*4;Face(last,last+3,last+2,last+1);
                void Face(int a,int b,int c,int d)
                {
                    if(winding<0){int swap=b;b=d;d=swap;}
                    ids.AddRange(new[]{a,b,c,a,c,d});
                }
                string name="RoadBankRetaining_"+wall.id;
                RenderMesh(parent,name,MakeMesh(name,vertices.ToArray(),ids.ToArray(),uv.ToArray()),concrete,true);
            }
        }
        private void BuildRoadBankContactFootings(Transform parent,Profile p,Material concrete)
        {
            if(!p.hasRoadBankContactFootings&&p.roadBankContactFootings!=null&&p.roadBankContactFootings.Length>0)
                throw new InvalidOperationException("Unmarked retaining footing "+p.zoneId);
            if(!p.hasRoadBankContactFootings)return;
            if(!p.hasRoadBankContactWalls||p.roadBankContactFootings==null||p.roadBankContactWalls==null)
                throw new InvalidOperationException("Incomplete retaining footing "+p.zoneId);
            if(p.roadBankContactFootings.Length!=p.roadBankContactWalls.Length)
                throw new InvalidOperationException("Discontinuous retaining footing "+p.zoneId);
            for(int footIndex=0;footIndex<p.roadBankContactFootings.Length;footIndex++)
            {
                RoadBankFooting foot=p.roadBankContactFootings[footIndex];
                RoadBankWall wall=p.roadBankContactWalls[footIndex];
                if(foot.id!=wall.id+"_foot_0"||foot.points==null||wall.points==null||foot.points.Length!=wall.points.Length)
                    throw new InvalidOperationException("Discontinuous retaining footing "+p.zoneId);
                if(foot.points==null||foot.points.Length<2)throw new InvalidOperationException("Empty retaining footing "+foot.id);
                var vertices=new List<Vector3>();var indices=new List<int>();var uv=new List<Vector2>();
                float along=0;int winding=0;
                for(int i=0;i<foot.points.Length;i++)
                {
                    RoadBankFootingPoint a=foot.points[i];
                    if(i>0)along+=new Vector2(a.x-foot.points[i-1].x,a.z-foot.points[i-1].z).magnitude;
                    float width=new Vector2(a.outerX-a.x,a.outerZ-a.z).magnitude;
                    if(width<.399f||width>.401f||a.top<=a.bottom+.1f||a.outerTop<=a.bottom+.1f)
                        throw new InvalidOperationException("Invalid retaining footing volume "+foot.id);
                    RoadBankWallPoint joined=wall.points[i];
                    if(Mathf.Abs(joined.outerX-a.x)>=.0001f||Mathf.Abs(joined.outerZ-a.z)>=.0001f
                        ||a.top>joined.top-.249f||a.bottom>joined.bottom)
                        throw new InvalidOperationException("Detached retaining footing "+foot.id);
                    vertices.AddRange(new[]{new Vector3(a.x,a.bottom,a.z),
                        new Vector3(a.outerX,a.bottom,a.outerZ),
                        new Vector3(a.outerX,a.outerTop,a.outerZ),new Vector3(a.x,a.top,a.z)});
                    for(int j=0;j<4;j++)uv.Add(new Vector2(along,vertices[vertices.Count-4+j].y));
                    if(i==0)continue;
                    RoadBankFootingPoint previous=foot.points[i-1];
                    float first=(a.x-previous.x)*(a.outerZ-previous.z)-(a.z-previous.z)*(a.outerX-previous.x);
                    float second=(a.outerX-previous.x)*(previous.outerZ-previous.z)
                        -(a.outerZ-previous.z)*(previous.outerX-previous.x);
                    int sign=first>0?1:first<0?-1:0;
                    if(sign==0||second*sign<=.0000001f||(winding!=0&&sign!=winding))
                        throw new InvalidOperationException("Folded retaining footing "+foot.id);
                    winding=sign;int from=(i-1)*4,to=i*4;
                    Face(from,to,to+1,from+1);Face(from+3,from+2,to+2,to+3);
                    Face(from,from+3,to+3,to);Face(from+1,to+1,to+2,from+2);
                }
                Face(0,1,2,3);int last=(foot.points.Length-1)*4;
                Face(last,last+3,last+2,last+1);
                void Face(int a,int b,int c,int d)
                {
                    if(winding<0){int swap=b;b=d;d=swap;}
                    indices.AddRange(new[]{a,b,c,a,c,d});
                }
                string name="RoadBankFooting_"+foot.id;
                RenderMesh(parent,name,MakeMesh(name,vertices.ToArray(),indices.ToArray(),uv.ToArray()),concrete,true);
            }
        }
        private void BuildPipeline(Transform parent,Profile p,Route route,RoaGlobalMapRelief relief)
        {
            Point[] source=route.points!=null && route.points.Length>1?route.points:new[]{route.a,route.b};
            var centers=new List<Vector3>();float scale=p.gain/160;
            for(int j=1;j<source.Length;j++)
            {
                Point a=source[j-1],b=source[j];int count=Mathf.Max(1,Mathf.CeilToInt(new Vector2(b.x-a.x,b.z-a.z).magnitude/2));
                for(int k=j==1?0:1;k<=count;k++)
                {
                    float x=Mathf.Lerp(a.x,b.x,k/(float)count),z=Mathf.Lerp(a.z,b.z,k/(float)count);WaterSample water=WaterAt(p,x,z);
                    float level=Height(p,relief,x,z);
                    if(water.Inside)level=Mathf.Max(level,water.Height+.8f*scale);
                    centers.Add(new Vector3(x,route.style=="process"?Mathf.Lerp(a.h,b.h,k/(float)count):level+1.2f*scale,z));
                }
            }
            var vertices=new List<Vector3>();var uv=new List<Vector2>();var ids=new List<int>();float along=0;
            const int sides=10;
            for(int i=0;i<centers.Count;i++)
            {
                Vector3 direction=centers[Mathf.Min(i+1,centers.Count-1)]-centers[Mathf.Max(0,i-1)];direction.Normalize();
                Vector3 side=Vector3.Cross(Vector3.up,direction);
                if(side.sqrMagnitude==0f)side=Vector3.right;
                side=side.normalized;
                Vector3 up=Vector3.Cross(direction,side).normalized;
                if(i>0)along+=Vector3.Distance(centers[i-1],centers[i]);
                for(int j=0;j<=sides;j++)
                {
                    float angle=j*Mathf.PI*2/sides;vertices.Add(centers[i]+(side*Mathf.Cos(angle)+up*Mathf.Sin(angle))*(route.style=="process"?route.halfWidth:.48f*scale));uv.Add(new Vector2(j/(float)sides,along));
                    if(i>0 && j<sides){int a=(i-1)*(sides+1)+j,b=a+sides+1;ids.AddRange(new[]{a,a+1,b,a+1,b+1,b});}
                }
            }
            Mesh raw=MakeMesh("Pipeline_"+route.id,vertices.ToArray(),ids.ToArray(),uv.ToArray());
            RenderMesh(parent,"Pipeline_"+route.id,ClipToSector(raw),ColorMaterial("OxidizedUtilityPipe",new Color(.27f,.24f,.19f)),route.style=="process");
            if(route.supports!=null)foreach(Point support in route.supports)
            {
                float height=support.h-support.g;
                if(height<=.08f)continue;
                var stand=GameObject.CreatePrimitive(PrimitiveType.Cube);stand.name="PipeSupport_"+route.id;
                stand.transform.SetParent(parent,false);stand.transform.position=new Vector3(support.x,support.g+height*.5f,support.z);
                stand.transform.localScale=new Vector3(.18f,height,.18f);
                stand.GetComponent<Renderer>().sharedMaterial=ColorMaterial("UtilityPipeSupport",new Color(.30f,.28f,.24f));
            }
        }
        private Mesh ClipToSector(Mesh input)
        {
            var output=new List<Vector3>();var uv=new List<Vector2>();var ids=new List<int>();
            Vector3[] v=input.vertices;Vector2[] sourceUv=input.uv;int[] sourceIds=input.triangles;
            for(int i=0;i<sourceIds.Length;i+=3)
            {
                var polygon=new List<(Vector3 v,Vector2 uv)>();
                for(int j=0;j<3;j++){int k=sourceIds[i+j];polygon.Add((v[k],sourceUv.Length==v.Length?sourceUv[k]:Vector2.zero));}
                foreach((int axis,float value,bool less) in new[]{(0,-Sector.width/2,false),(0,Sector.width/2,true),(2,-Sector.depth/2,false),(2,Sector.depth/2,true)})
                {
                    var clipped=new List<(Vector3 v,Vector2 uv)>();
                    for(int j=0;j<polygon.Count;j++)
                    {
                        var a=polygon[j];var b=polygon[(j+1)%polygon.Count];
                        bool insideA=less?a.v[axis]<=value:a.v[axis]>=value,insideB=less?b.v[axis]<=value:b.v[axis]>=value;
                        if(insideA)clipped.Add(a);
                        if(insideA!=insideB){float t=(value-a.v[axis])/(b.v[axis]-a.v[axis]);clipped.Add((Vector3.Lerp(a.v,b.v,t),Vector2.Lerp(a.uv,b.uv,t)));}
                    }
                    polygon=clipped;
                }
                for(int j=1;j<polygon.Count-1;j++)foreach(var point in new[]{polygon[0],polygon[j],polygon[j+1]})
                {ids.Add(output.Count);output.Add(point.v);uv.Add(point.uv);}
            }
            return MakeMesh(input.name+"_Cut",output.ToArray(),ids.ToArray(),uv.ToArray());
        }
        private void WalkwayDeckSeams(Transform parent,Route bridge,Material material)
        {
            Point[] points=bridge.points!=null && bridge.points.Length>1?bridge.points:new[]{bridge.a,bridge.b};
            var vertices=new List<Vector3>();var indices=new List<int>();
            float scale=Sector.gain/160,station=1.2f*scale,along=0;
            for(int i=1;i<points.Length;i++)
            {
                Vector3 a=points[i-1].Vector,b=points[i].Vector,forward=b-a;forward.y=0;
                float length=forward.magnitude;
                if(length<.001f)continue;
                forward/=length;
                Vector3 side=new Vector3(-forward.z,0,forward.x);
                while(station<=along+length)
                {
                    Vector3 center=Vector3.Lerp(a,b,(station-along)/length)+Vector3.up*(.012f*scale);
                    Vector3 edge=side*(bridge.halfWidth-.10f*scale),seam=forward*(.025f*scale);
                    int n=vertices.Count;
                    vertices.AddRange(new[]{center-seam-edge,center-seam+edge,center+seam-edge,center+seam+edge});
                    indices.AddRange(new[]{n,n+1,n+2,n+1,n+3,n+2});
                    station+=1.2f*scale;
                }
                along+=length;
            }
            if(indices.Count>0)RenderMesh(parent,"BridgeDeckSeams_"+bridge.id,
                ClipToSector(MakeMesh("BridgeDeckSeams_"+bridge.id,vertices.ToArray(),indices.ToArray())),material,false);
        }
        private void BridgeStructure(Transform parent,Route bridge,RoaGlobalMapRelief relief,Material concrete)
        {
            var vertices=new List<Vector3>();var ids=new List<int>();float scale=Sector.gain/160;
            var guardVertices=new List<Vector3>();var guardIds=new List<int>();
            var railVertices=new List<Vector3>();var railIds=new List<int>();
            var abutmentVertices=new List<Vector3>();var abutmentIds=new List<int>();
            Point[] points=bridge.points!=null && bridge.points.Length>1?bridge.points:new[]{bridge.a,bridge.b};
            if(bridge.style!="metalService")foreach(int end in new[]{0,points.Length-1})
            {
                Point anchor=points[end],next=points[end==0?1:points.Length-2];
                Vector3 forward=new Vector3(next.x-anchor.x,0,next.z-anchor.z).normalized;
                Vector3 side=new Vector3(-forward.z,0,forward.x);
                // The load-bearing mass starts at the actual deck landing.
                // Extending the deck tangent onto the dry approach creates a
                // raised concrete lip where the approach terrain curves down.
                float halfLength=2.75f*scale;
                Vector3 center=anchor.Vector+forward*halfLength;
                center.y=BridgeHeight(bridge,center.x,center.z);
                float halfWidth=bridge.halfWidth+.5f*scale;
                if(Mathf.Abs(center.x)>Sector.width/2+halfLength+halfWidth||Mathf.Abs(center.z)>Sector.depth/2+halfLength+halfWidth)continue;
                float substrate=float.PositiveInfinity;
                foreach(float alongOffset in new[]{-halfLength,0,halfLength})foreach(float sideOffset in new[]{-halfWidth,0,halfWidth})
                {
                    Vector3 foot=center+forward*alongOffset+side*sideOffset;
                    substrate=Mathf.Min(substrate,Height(Sector,relief,foot.x,foot.z,false,false,false,true));
                }
                if(center.y-substrate<1.5f*scale)continue;
                // A full-width structural mass supports the raised approach.
                // Its foot embeds in the original bank, below the engineered fill.
                Box(center,forward,side,halfLength,halfWidth,substrate-center.y-1.6f*scale,-.28f*scale,abutment:true);
                // Short return walls retain the approach soil on both sides.
                // Panel tops follow actual terrain, rather than an extrapolated deck.
                foreach(float sign in new[]{-1f,1f})for(int station=0;station<6;station++)
                {
                    Vector3 wing=anchor.Vector-forward*((station+.5f)*scale)+side*(sign*(bridge.halfWidth+.25f*scale));
                    wing.y=Height(Sector,relief,wing.x,wing.z)-.05f*scale;
                    float foot=Height(Sector,relief,wing.x,wing.z,false,false,false,true)-.6f*scale;
                    if(wing.y-foot<1.5f*scale)continue;
                    Box(wing,forward,side,.52f*scale,.5f*scale,foot-wing.y,.2f*scale,abutment:true);
                }
            }
            float totalLength=0;
            for(int i=1;i<points.Length;i++)totalLength+=new Vector2(points[i].x-points[i-1].x,points[i].z-points[i-1].z).magnitude;
            float nextPier=0,along=0;
            for(int j=1;j<points.Length;j++)
            {
                Vector3 a=points[j-1].Vector,b=points[j].Vector,direction=b-a;direction.y=0;
                float length=direction.magnitude;direction.Normalize();Vector3 side=new Vector3(-direction.z,0,direction.x);
                float deckBottom=bridge.style=="metalService"?-.12f*scale:-.28f*scale;
                float railOffset=bridge.halfWidth+(bridge.style=="metalService"?.12f:-.22f*scale);
                Box((a+b)*.5f,direction,side,length*.5f,bridge.halfWidth,deckBottom,
                    bridge.style=="metalService"?-.025f*scale:0);
                foreach(float sign in new[]{-1f,1f})
                {
                    float railStart=bridge.style=="metalService"?Mathf.Clamp(2*scale-along,0,length):0;
                    float railEnd=bridge.style=="metalService"?Mathf.Clamp(totalLength-2*scale-along,0,length):length;
                    if(railEnd>railStart+.01f)
                    {
                        Vector3 railCenter=Vector3.Lerp(a,b,(railStart+railEnd)/(2*length));
                        Box(railCenter+side*(sign*railOffset),direction,side,(railEnd-railStart)*.5f,.09f*scale,.84f*scale,.96f*scale,false,true);
                    }
                    // The visible handrail also stops a player leaving a deck
                    // above water. Keep dry-bank side access open; the river
                    // wall sits below the deck to permit crossing the bridge.
                    int steps=Mathf.Max(1,Mathf.CeilToInt(length));
                    for(int i=0;i<steps;i++)
                    {
                        Vector3 center=Vector3.Lerp(a,b,(i+.5f)/steps);
                        Vector3 outside=center+side*(sign*(bridge.halfWidth+.5f));
                        WaterSample water=WaterAt(Sector,outside.x,outside.z);
                        bool wetSide=(water.Inside||water.Distance<=.00001f)&&Height(Sector,relief,outside.x,outside.z)<water.Height+.02f*scale;
                        bool elevatedDrySide=bridge.style=="metalService"&&center.y-Height(Sector,relief,outside.x,outside.z)>.6f*scale;
                        if(!wetSide&&!elevatedDrySide)continue;
                        if(bridge.style=="metalService" && (along+(i+.5f)*length/steps<2*scale || along+(i+.5f)*length/steps>totalLength-2*scale))continue;
                        Box(center+side*(sign*railOffset),direction,side,length/(steps*2),.09f*scale,.84f*scale,.96f*scale,true);
                    }
                }
                while(nextPier<=along+length)
                {
                    Vector3 center=Vector3.Lerp(a,b,Mathf.Clamp01((nextPier-along)/Mathf.Max(.0001f,length)));
                    if(Mathf.Abs(center.x)<Sector.width/2-1 && Mathf.Abs(center.z)<Sector.depth/2-1)
                    {
                        float bottom=Height(Sector,relief,center.x,center.z)-center.y-.45f*scale;
                        float pierBottom=bridge.style=="metalService"?-.12f*scale:-.28f*scale;
                        Box(center,direction,side,(bridge.style=="metalService"?.28f:.75f)*scale,bridge.halfWidth*(bridge.style=="metalService"?.35f:.75f),bottom,pierBottom);
                        foreach(float sign in new[]{-1f,1f})Box(center+side*(sign*railOffset),direction,side,.1f*scale,.1f*scale,0,.96f*scale,false,true);
                    }
                    nextPier+=16*scale;
                }
                along+=length;
            }
            Mesh raw=MakeMesh("BridgeStructure_"+bridge.id,vertices.ToArray(),ids.ToArray());
            RenderMesh(parent,"BridgeStructure_"+bridge.id,ClipToSector(raw),concrete,false);
            if(abutmentIds.Count>0)RenderMesh(parent,"BridgeAbutments_"+bridge.id,
                ClipToSector(MakeMesh("BridgeAbutments_"+bridge.id,abutmentVertices.ToArray(),abutmentIds.ToArray())),concrete,true);
            Material metal=ColorMaterial("SectorBridgeHandrail",new Color(.15f,.17f,.16f));
            metal.SetFloat("_Metallic",.65f);metal.SetFloat("_Smoothness",.25f);
            RenderMesh(parent,"BridgeHandrails_"+bridge.id,ClipToSector(MakeMesh("BridgeHandrails_"+bridge.id,railVertices.ToArray(),railIds.ToArray())),metal,false);
            if(guardIds.Count>0)
            {
                var guard=new GameObject("BridgeWaterSideGuards_"+bridge.id);guard.transform.SetParent(parent,false);
                guard.AddComponent<MeshCollider>().sharedMesh=ClipToSector(MakeMesh("BridgeWaterSideGuards_"+bridge.id,guardVertices.ToArray(),guardIds.ToArray()));
            }

            void Box(Vector3 center,Vector3 direction,Vector3 side,float halfLength,float halfWidth,float bottom,float top,bool guard=false,bool handrail=false,bool abutment=false)
            {
                // Top and bottom elevations follow the deck tangent, including ramps.
                Vector3 slope=direction;
                int nearest=0;float best=float.PositiveInfinity;
                for(int k=1;k<points.Length;k++){float d=Distance(center.x,center.z,points[k-1],points[k],out _);if(d<best){best=d;nearest=k;}}
                if(nearest>0)
                {
                    Point a=points[nearest-1],b=points[nearest];
                    Vector2 routeDirection=new Vector2(b.x-a.x,b.z-a.z);
                    float run=routeDirection.magnitude;
                    if(run>.001f)slope.y=Vector2.Dot(new Vector2(direction.x,direction.z),routeDirection/run)*(b.h-a.h)/run;
                }
                var targetVertices=guard?guardVertices:handrail?railVertices:abutment?abutmentVertices:vertices;
                var targetIds=guard?guardIds:handrail?railIds:abutment?abutmentIds:ids;
                int start=targetVertices.Count;
                foreach(float y in new[]{bottom,top})foreach((float x,float z) in new[]{(-1f,-1f),(1f,-1f),(1f,1f),(-1f,1f)})targetVertices.Add(center+slope*(x*halfLength)+side*(z*halfWidth)+Vector3.up*y);
                foreach(int k in new[]{0,1,2,0,2,3,4,6,5,4,7,6,0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4})targetIds.Add(start+k);
            }
        }
        private void Ribbon(Transform parent,Route route,RoaGlobalMapRelief relief,Material material,bool bridge)
        {
            Point[] source=route.points!=null && route.points.Length>1?route.points:new[]{route.a,route.b};
            var centers=new List<Vector3>();
            for(int j=1;j<source.Length;j++)
            {
                Vector3 a=source[j-1].Vector,b=source[j].Vector;
                int steps=Mathf.Max(1,Mathf.CeilToInt(new Vector2(b.x-a.x,b.z-a.z).magnitude/2));
                for(int k=j==1?0:1;k<=steps;k++)centers.Add(Vector3.Lerp(a,b,k/(float)steps));
            }
            var v=new Vector3[centers.Count*2];var uv=new Vector2[v.Length];var ids=new List<int>();float along=0;
            for(int i=0;i<centers.Count;i++)
            {
                Vector3 center=centers[i],direction=centers[Mathf.Min(i+1,centers.Count-1)]-centers[Mathf.Max(0,i-1)];direction.y=0;direction.Normalize();
                Vector3 normal=new Vector3(-direction.z,0,direction.x)*route.halfWidth;
                if(i>0)along+=new Vector2(center.x-centers[i-1].x,center.z-centers[i-1].z).magnitude;
                for(int side=0;side<2;side++)
                {
                    Vector3 point=center+normal*(side==0?-1:1);
                    point.y=bridge?center.y:Height(Sector,relief,point.x,point.z,true)+0.025f;
                    v[i*2+side]=point;uv[i*2+side]=new Vector2(side,along*.5f);
                }
                if(i<centers.Count-1)ids.AddRange(new[]{i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2});
            }
            Mesh mesh=MakeMesh(route.id,v,ids.ToArray(),uv);
            RenderMesh(parent,(bridge?"SectorBridge_":"SectorRoute_")+route.id,
                bridge?ClipToSector(mesh):mesh,material,bridge);
        }
        private void OnDisable(){if(_active==this)_active=null;}
        private void OnDestroy()
        {
            if(_active==this)_active=null;
            foreach(Mesh m in _meshes)if(m!=null){if(Application.isPlaying)Destroy(m);else DestroyImmediate(m);}
            foreach(Material m in _materials)if(m!=null){if(Application.isPlaying)Destroy(m);else DestroyImmediate(m);}
        }
    }
}
