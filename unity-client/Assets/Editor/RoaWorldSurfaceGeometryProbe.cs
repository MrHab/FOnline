using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    public static class RoaWorldSurfaceGeometryProbe
    {
        public static void Run()
        {
            try
            {
                var reports=new List<object>();int wetSamples=0;float maxDelta=0,maxAnalyticDifference=0;int analyticDifferences=0,renderedWaterTriangles=0;
                var boundaries=new Dictionary<string,(RoaSectorSurface.Profile profile,Boundary[][] edges)>();
                var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selected=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(selected!=null&&!selected.Contains(p.locationId))continue;
                    int fineSegments=RoaSectorRailInfrastructure.TerrainSegments(p);
                    Mesh fine=RoaWorldSurfaceGround.Build(p,relief,fineSegments),desktop=RoaWorldSurfaceGround.Build(p,relief,32),mobile=RoaWorldSurfaceGround.Build(p,relief,16);
                    var engineering=new GameObject("WorldRoofGeometryProbe");
                    RoaSectorRailInfrastructure.Build(engineering.transform,p,relief);
                    Mesh[] covers=engineering.GetComponentsInChildren<MeshFilter>().Where(f=>f.name==RoaSectorRailInfrastructure.CoverName).Select(f=>f.sharedMesh).ToArray();
                    var coverSamplers=covers.Select(m=>new RoaMeshSurfaceHeight(m)).ToArray();
                    var profileEdges=new Boundary[2][];int lodIndex=0;
                    var reference=new Sampler(fine,p);int samples=0;float delta=0,hidden=0;
                    Mesh water=RoaSectorWaterMesh.Build(p,fine.vertices,fineSegments,
                        p.surfacePatches?.Length>0?fine.triangles:null);
                    Vector3[] waterVertices=water.vertices;int[] waterIndices=water.triangles;
                    foreach(Mesh lod in new[]{desktop,mobile})
                    {
                        var sampler=new Sampler(lod,p);
                        profileEdges[lodIndex++]=Enumerable.Range(0,4).Select(edge=>Boundary.Build(p,edge,sampler,coverSamplers,new[]{fine,lod}.Concat(covers))).ToArray();
                        for(int t=0;t<p.waterIndices.Length;t+=3)
                        {
                            Vector3 point=(p.waterVertices[p.waterIndices[t]].Vector+p.waterVertices[p.waterIndices[t+1]].Vector+p.waterVertices[p.waterIndices[t+2]].Vector)/3;
                            if(!RoaSectorSurface.IsWaterAt(p,point.x,point.z))continue;
                            float canonical=reference.Height(point.x,point.z),actual=sampler.Height(point.x,point.z);
                            delta=Mathf.Max(delta,Mathf.Abs(actual-canonical));hidden=Mathf.Max(hidden,actual-point.y);samples++;
                            if(actual-point.y>.2f*p.gain/160)analyticDifferences++;
                        }
                        for(int edge=0;edge<4;edge++)for(int i=0;i<=128;i++)
                        {
                            float x=edge<2?(edge==0?-.5f:.5f)*p.width:(i/128f-.5f)*p.width;
                            float z=edge>=2?(edge==2?-.5f:.5f)*p.depth:(i/128f-.5f)*p.depth;
                            delta=Mathf.Max(delta,Mathf.Abs(sampler.Height(x,z)-reference.Height(x,z)));
                        }
                        for(int i=0;i<waterIndices.Length;i+=3)
                        {
                            Vector3 point=(waterVertices[waterIndices[i]]+waterVertices[waterIndices[i+1]]+waterVertices[waterIndices[i+2]])/3;
                            if(sampler.Height(point.x,point.z)-point.y>.003f)throw new InvalidOperationException("Rendered river buried by ground "+p.zoneId);
                            renderedWaterTriangles++;
                        }
                        var lookupObject=new GameObject("WorldHeightLookupProbe");
                        var lookup=lookupObject.AddComponent<RoaWorldMapSectorAppearance>();
                        lookup.MapMin=Vector2.zero;lookup.MapMax=Vector2.one;
                        lookup.DesktopGround=desktop;lookup.MobileGround=mobile;
                        lookup.SurfaceCovers=covers;
                        lookup.transform.localPosition=new Vector3(0,7,0);lookup.transform.localScale=Vector3.one*.25f;
                        lookup.SetMobile(lod==mobile);
                        for(int zi=0;zi<=16;zi++)for(int xi=0;xi<=16;xi++)
                        {
                            float x=(xi/16f-.5f)*p.width,z=(zi/16f-.5f)*p.depth;
                            float publicHeight=sampler.Height(x,z);
                            foreach(var cover in coverSamplers)if(cover.TryHeight(x,z,out float roof))publicHeight=Mathf.Max(publicHeight,roof);
                            if(!lookup.TryHeight(new Vector2(xi/16f,1-zi/16f),out float picked) || Mathf.Abs(picked-(7+publicHeight*.25f))>.002f)
                                throw new InvalidOperationException("Overview point selection height mismatch "+p.zoneId);
                        }
                        Object.DestroyImmediate(lookupObject);
                        Mesh roads=RoaWorldSurfaceRoads.Build(p,lod);
                        foreach(Vector3 point in roads.vertices)
                            if(Mathf.Abs(sampler.Height(point.x,point.z)+.035f*p.gain/160-point.y)>.002f)
                                throw new InvalidOperationException("Overview road detached from ground "+p.zoneId);
                        Object.DestroyImmediate(roads);
                    }
                    if(delta>.005f)throw new InvalidOperationException("Overview LOD changed shoreline/edge "+p.zoneId+" delta="+delta);
                    maxDelta=Mathf.Max(maxDelta,delta);maxAnalyticDifference=Mathf.Max(maxAnalyticDifference,hidden);wetSamples+=samples;
                    reports.Add(new{p.zoneId,samples,delta,analyticWaterGroundDifference=hidden,desktopVertices=desktop.vertexCount,mobileVertices=mobile.vertexCount});
                    boundaries.Add(p.zoneId,(p,profileEdges));
                    Object.DestroyImmediate(engineering);Object.DestroyImmediate(water);Object.DestroyImmediate(fine);Object.DestroyImmediate(desktop);Object.DestroyImmediate(mobile);
                    if(reports.Count%10==0)Debug.Log("[WORLD GEOMETRY] Checked "+reports.Count);
                }
                int meshSeams=0,seamDefects=0;float maxMeshSeam=0;var seamFailures=new List<object>();
                var byCell=boundaries.Values.ToDictionary(row=>new Vector2Int(Mathf.RoundToInt(row.profile.mapMinX),Mathf.RoundToInt(row.profile.mapMinY)));
                foreach(var row in boundaries.Values)
                {
                    Vector2Int cell=new Vector2Int(Mathf.RoundToInt(row.profile.mapMinX),Mathf.RoundToInt(row.profile.mapMinY));
                    foreach(var connection in new[]{(delta:new Vector2Int(20,0),a:1,b:0),(delta:new Vector2Int(0,20),a:2,b:3)})
                    {
                        if(!byCell.TryGetValue(cell+connection.delta,out var next))continue;
                        for(int lod=0;lod<2;lod++)
                        {
                            Boundary a=row.edges[lod][connection.a],b=next.edges[lod][connection.b];
                            foreach(float t in a.Times.Concat(b.Times).Distinct())
                            {
                                float difference=Mathf.Abs(a.Height(t)-b.Height(t));maxMeshSeam=Mathf.Max(maxMeshSeam,difference);
                                if(difference>.0001f)
                                {
                                    seamDefects++;
                                    if(seamFailures.Count<80)
                                    {
                                        var p=row.profile;var q=next.profile;
                                        float px=connection.a==1?p.width/2:(t-.5f)*p.width,pz=connection.a==1?(t-.5f)*p.depth:-p.depth/2;
                                        float qx=connection.b==0?-q.width/2:(t-.5f)*q.width,qz=connection.b==0?(t-.5f)*q.depth:q.depth/2;
                                        seamFailures.Add(new{a=p.zoneId,b=q.zoneId,lod,t,difference,actualA=a.Height(t),actualB=b.Height(t),
                                            analyticA=p.datum+RoaSectorSurface.Height(p,relief,px,pz)/p.gain,
                                            analyticB=q.datum+RoaSectorSurface.Height(q,relief,qx,qz)/q.gain,
                                            gridA=p.datum+RoaSectorSurface.GridHeight(p,relief,px,pz)/p.gain,
                                            gridB=q.datum+RoaSectorSurface.GridHeight(q,relief,qx,qz)/q.gain,
                                            verticesA=a.Times.Where(v=>Mathf.Abs(v-t)<.012f).Select(v=>new{t=v,h=a.Height(v)}).ToArray(),
                                            verticesB=b.Times.Where(v=>Mathf.Abs(v-t)<.012f).Select(v=>new{t=v,h=b.Height(v)}).ToArray()});
                                    }
                                }
                            }
                        }
                        meshSeams++;
                    }
                }
                string output=Environment.GetEnvironmentVariable("ROA_WORLD_GEOMETRY_OUT")??Path.GetFullPath(Path.Combine(Application.dataPath,"../../Build/world-geometry.json"));
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.WriteAllText(output,JsonConvert.SerializeObject(new{profiles=reports.Count,meshSeams,maxMeshSeam,seamDefects,seamFailures,wetSamples,maxDelta,renderedWaterTriangles,renderedWaterOcclusions=0,maxAnalyticDifference,analyticDifferences,reports},Formatting.Indented));
                if(seamDefects>0)throw new InvalidOperationException($"Rendered sector seams: {seamDefects} differing samples, max overview gap {maxMeshSeam}; diagnostics saved to {output}");
                Debug.Log("[WORLD GEOMETRY] PASS: exact local shore/sector edge in both overview LODs; "+meshSeams+" rendered neighbour seams, max="+maxMeshSeam+"; draped roads and point selection; rendered water occlusions=0. Raw analytic/grid differences="+analyticDifferences+", max="+maxAnalyticDifference);
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        // Compare the piecewise linear boundaries of the actual meshes, including
        // shoreline snaps and tunnel roofs, in the shared overview height system.
        private sealed class Boundary
        {
            public float[] Times;
            private float[] _heights;
            public static Boundary Build(RoaSectorSurface.Profile p,int edge,Sampler sampler,RoaMeshSurfaceHeight[] covers,IEnumerable<Mesh> meshes)
            {
                var times=new SortedSet<float>{0,1};
                foreach(Mesh mesh in meshes)foreach(Vector3 vertex in mesh.vertices)
                {
                    float fixedCoordinate=edge<2?vertex.x:vertex.z;
                    float limit=(edge==0||edge==2?-.5f:.5f)*(edge<2?p.width:p.depth);
                    if(Mathf.Abs(fixedCoordinate-limit)>.001f)continue;
                    times.Add(Mathf.Clamp01((edge<2?vertex.z/p.depth:vertex.x/p.width)+.5f));
                }
                // Interior samples catch a roof intersecting the boundary between
                // ground vertices and exercise both sides of snapped river banks.
                for(int i=0;i<=512;i++)times.Add(i/512f);
                var result=new Boundary{Times=times.ToArray()};result._heights=new float[result.Times.Length];
                for(int i=0;i<result.Times.Length;i++)
                {
                    float t=result.Times[i],x=edge<2?(edge==0?-.5f:.5f)*p.width:(t-.5f)*p.width;
                    float z=edge>=2?(edge==2?-.5f:.5f)*p.depth:(t-.5f)*p.depth;
                    float h=sampler.Height(x,z);
                    foreach(var cover in covers)if(cover.TryHeight(x,z,out float roof))h=Mathf.Max(h,roof);
                    result._heights[i]=p.datum+h/p.gain;
                }
                return result;
            }
            public float Height(float t)
            {
                int index=Array.BinarySearch(Times,t);
                if(index>=0)return _heights[index];
                int upper=~index;
                if(upper==0)return _heights[0];
                if(upper==Times.Length)return _heights[_heights.Length-1];
                return Mathf.Lerp(_heights[upper-1],_heights[upper],Mathf.InverseLerp(Times[upper-1],Times[upper],t));
            }
        }
        private sealed class Sampler
        {
            private readonly Vector3[] _v;private readonly int[] _indices;private readonly Dictionary<int,List<int>> _buckets=new Dictionary<int,List<int>>();
            private readonly RoaSectorSurface.Profile _p;private readonly int _columns,_rows;
            private const float Step=8;
            public Sampler(Mesh mesh,RoaSectorSurface.Profile p)
            {
                _p=p;_v=mesh.vertices;_indices=mesh.triangles;_columns=Mathf.CeilToInt(p.width/Step);_rows=Mathf.CeilToInt(p.depth/Step);
                for(int i=0;i<_indices.Length;i+=3)
                {
                    Vector3 a=_v[_indices[i]],b=_v[_indices[i+1]],c=_v[_indices[i+2]];
                    if(Vector3.Cross(b-a,c-a).y<=0)throw new InvalidOperationException("Overview inverted or empty ground triangle "+p.zoneId);
                    for(int z=Z(Mathf.Min(a.z,b.z,c.z));z<=Z(Mathf.Max(a.z,b.z,c.z));z++)for(int x=X(Mathf.Min(a.x,b.x,c.x));x<=X(Mathf.Max(a.x,b.x,c.x));x++)
                    {int key=z*_columns+x;if(!_buckets.TryGetValue(key,out var list))_buckets[key]=list=new List<int>();list.Add(i);}
                }
            }
            private int X(float x)=>Mathf.Clamp(Mathf.FloorToInt((x+_p.width/2)/Step),0,_columns-1);
            private int Z(float z)=>Mathf.Clamp(Mathf.FloorToInt((z+_p.depth/2)/Step),0,_rows-1);
            public float Height(float x,float z)
            {
                bool found=false,contained=false;float height=0;
                if(_buckets.TryGetValue(Z(z)*_columns+X(x),out var candidates))foreach(int index in candidates)
                {
                    Vector3 a=_v[_indices[index]],b=_v[_indices[index+1]],c=_v[_indices[index+2]];
                    double az=(double)a.z-c.z,ax=(double)a.x-c.x,
                        bz=(double)b.z-c.z,bx=(double)b.x-c.x,
                        qx=(double)x-c.x,qz=(double)z-c.z;
                    double den=bz*ax-bx*az;
                    double u=(bz*qx-bx*qz)/den,w=(-az*qx+ax*qz)/den;
                    if(u<-.00002f||w<-.00002f||u+w>1.00002f)continue;
                    bool inside=u>=-1e-10&&w>=-1e-10&&u+w<=1+1e-10;
                    // Independently evaluate the actual saved face plane;
                    // loose edge extrapolation must not replace a containing face.
                    double abx=(double)b.x-a.x,aby=(double)b.y-a.y,abz=(double)b.z-a.z,
                        acx=(double)c.x-a.x,acy=(double)c.y-a.y,acz=(double)c.z-a.z;
                    double nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
                    float hit=(float)(a.y-(nx*((double)x-a.x)+nz*((double)z-a.z))/ny);
                    if(contained&&!inside)continue;
                    if(inside&&!contained){height=hit;found=true;contained=true;continue;}
                    if(!found||hit>height)height=hit;found=true;
                }
                if(found)return height;
                throw new InvalidOperationException("Overview mesh hole "+_p.zoneId+" "+x+","+z);
            }
        }
    }
}
