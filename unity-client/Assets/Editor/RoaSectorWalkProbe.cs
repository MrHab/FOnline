using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Moves the game's capsule through actual saved terrain and bridge colliders.</summary>
    public static class RoaSectorWalkProbe
    {
        [MenuItem("Realm of Ashes/Zones/Check all sector walking surfaces")]
        public static void Run()
        {
            try
            {
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var ids=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                int roads=0,bridges=0,banks=0,railways=0;
                bool collectFailures=Environment.GetEnvironmentVariable("ROA_WALK_COLLECT_FAILURES")=="1";
                var failures=new List<object>();var completed=new List<string>();
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(p.legacyDam || ids!=null&&!ids.Contains(p.locationId))continue;
                    bool railOnly=Environment.GetEnvironmentVariable("ROA_WALK_RAIL_ONLY")=="1";
                    if(railOnly&&(p.railInfrastructure==null||p.railInfrastructure.Length==0))continue;
                    try
                    {
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    if(location?.GroundRenderer==null)throw new InvalidOperationException("Missing ground "+p.locationId);
                    string definitionPath=p.locationId==p.zoneId?"data/zones/authored/"+p.zoneId+".json":"data/locations/"+p.locationId+".json";
                    var painter=new GameObject("WalkingProbePainter").AddComponent<RoaLocalTerrain>();
                    painter.InitializeAuthoredSurface(JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(Path.Combine(repository,definitionPath))),null,location.GroundRenderer);
                    Physics.SyncTransforms();
                    int failuresBefore=failures.Count;
                    foreach(var route in p.roads.Where(r=>(r.type=="track"||r.type=="road")&&!r.blocked && Environment.GetEnvironmentVariable("ROA_WALK_RAIL_ONLY")!="1"))
                    {
                        try
                        {
                        var points=Trim(route.points?.Length>1?route.points:new[]{route.a,route.b},p,10);
                        if(points.Count<2)continue;
                        foreach(float offset in Lanes(route.halfWidth))
                        {Walk(p,route.id,points,offset);Walk(p,route.id,points.AsEnumerable().Reverse().ToList(),offset);}
                        roads++;
                        }
                        catch(Exception error)
                        {
                            if(!collectFailures)throw;
                            failures.Add(new{zone=p.zoneId,locationId=p.locationId,road=route.id,message=error.Message});
                            Debug.LogError("[SECTOR WALK] Failed road "+p.locationId+"/"+route.id+": "+error.Message);
                        }
                    }
                    foreach(var bridge in p.bridges)
                    {
                        if(bridge.style=="railViaduct")continue;
                        var points=Trim(bridge.points?.Length>1?bridge.points:new[]{bridge.a,bridge.b},p,3);
                        if(points.Count<2)continue;
                        foreach(float offset in BridgeLanes(bridge.halfWidth))
                        {Walk(p,bridge.id,points,offset);Walk(p,bridge.id,points.AsEnumerable().Reverse().ToList(),offset);}
                        bridges++;
                    }
                    foreach(var railway in Environment.GetEnvironmentVariable("ROA_WALK_RAIL_ONLY")=="1" ? p.railInfrastructure??Array.Empty<RoaSectorSurface.RailInfrastructure>() : Array.Empty<RoaSectorSurface.RailInfrastructure>())
                    {
                        // Check the interior of each engineering span. Its real
                        // locked service gate is tested by RoaRailClosureProbe;
                        // floor fitness must not demand passage through that gate.
                        foreach(var span in railway.spans??Array.Empty<RoaSectorSurface.RailSpan>())
                        {
                        var points=Trim(railway.points.Skip(span.fromIndex).Take(span.toIndex-span.fromIndex+1).Select(v=>new RoaSectorSurface.Point{x=v.x,z=v.z,h=v.h}).ToArray(),p,1.5f);
                        points=TrimEnds(points,4);
                        if(points.Count<2)continue;
                        foreach(float offset in new[]{-1.25f,0,1.25f})
                        {Walk(p,railway.id+"/"+span.id,points,offset,true);Walk(p,railway.id+"/"+span.id,points.AsEnumerable().Reverse().ToList(),offset,true);}
                        railways++;
                        }
                    }
                    foreach(var edge in (p.visibleShore??Array.Empty<RoaSectorSurface.Edge>()).Where((e,i)=>i%Mathf.Max(1,p.visibleShore.Length/12)==0))
                    {
                        float x=(edge.a.x+edge.b.x)*.5f,z=(edge.a.z+edge.b.z)*.5f;
                        if(Mathf.Abs(x)>p.width/2-8 || Mathf.Abs(z)>p.depth/2-8 || RoaSectorSurface.BridgeAt(p,x,z,2)!=null)continue;
                        Vector2 tangent=new Vector2(edge.b.x-edge.a.x,edge.b.z-edge.a.z).normalized,normal=new Vector2(-tangent.y,tangent.x);
                        var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
                        bool first=RoaSectorSurface.IsWaterAt(p,x+normal.x*2,z+normal.y*2);
                        bool second=RoaSectorSurface.IsWaterAt(p,x-normal.x*2,z-normal.y*2);
                        if(first==second)continue;
                        if(!first)normal=-normal;
                        Vector3 start=new Vector3(x-normal.x*3,RoaSectorSurface.Height(p,relief,x-normal.x*3,z-normal.y*3)+1.05f,z-normal.y*3);
                        var walker=new GameObject("RiverBoundaryProbe");walker.transform.position=start;
                        var body=Body(walker);
                        for(int k=0;k<75;k++)body.Move(new Vector3(normal.x*.12f,-.04f,normal.y*.12f));
                        bool submerged=RoaSectorSurface.IsWaterAt(p,walker.transform.position.x,walker.transform.position.z,.35f);
                        Vector3 reached=walker.transform.position;
                        string contacts=submerged?string.Join("; ",Physics.OverlapCapsule(reached-Vector3.up*.7f,reached+Vector3.up*.7f,body.radius+.15f).Where(c=>c!=body).Select(c=>c.name+" "+c.bounds)):null;
                        Object.DestroyImmediate(walker);
                        if(submerged)throw new InvalidOperationException($"Capsule entered river in {p.zoneId} at {x},{z}; start {start}; reached {reached}; water {RoaSectorSurface.WaterAt(p,reached.x,reached.z).Height}; shore-ground {RoaSectorSurface.Height(p,relief,x,z)}; normal {normal}; contacts {contacts}");
                        banks++;
                    }
                    Debug.Log("[SECTOR WALK] Completed "+p.locationId);
                    if(failures.Count==failuresBefore)completed.Add(p.locationId);
                    }
                    catch(Exception error)
                    {
                        if(!collectFailures)throw;
                        failures.Add(new{zone=p.zoneId,locationId=p.locationId,message=error.Message});
                        Debug.LogError("[SECTOR WALK] Failed "+p.locationId+": "+error.Message);
                    }
                }
                string report=Environment.GetEnvironmentVariable("ROA_WALK_REPORT");
                if(!string.IsNullOrWhiteSpace(report))File.WriteAllText(report,JsonConvert.SerializeObject(new{completed,failures,roads,bridges,railways,banks},Formatting.Indented)+"\n");
                if(failures.Count>0)throw new InvalidOperationException("Physical sector walking found "+failures.Count+" defects; see recorded failures.");
                Debug.Log($"[SECTOR WALK] PASS: {roads} gate approaches, {bridges} bridges including deck sides and {railways} freight spans in both directions, {banks} blocked river entries.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static CharacterController Body(GameObject walker)
        {
            var body=walker.AddComponent<CharacterController>();body.height=RoaGameBootstrap.PlayerHeight;body.center=Vector3.zero;
            RoaPlayerController.ConfigureAuthoritativeCollision(body);return body;
        }
        private static float[] Lanes(float halfWidth)
        {
            float outer=Mathf.Min(1.25f,halfWidth-RoaPlayerController.AuthoritativeCollisionRadius-.1f);
            if(outer<0)throw new InvalidOperationException("Passage narrower than the player's capsule");
            return new[]{-outer,0,outer};
        }
        private static float[] BridgeLanes(float halfWidth)
        {
            // Handrail inner face is .31 m inside the deck edge. Include the
            // real capsule radius and skin so this tests its usable sides.
            float outer=halfWidth-.31f-RoaPlayerController.AuthoritativeCollisionRadius-.15f;
            return outer>1.25f?new[]{-outer,-1.25f,0,1.25f,outer}:Lanes(halfWidth);
        }
        internal static Vector2 Walk(RoaSectorSurface.Profile p,string id,List<Vector2> points,float offset,bool railWalking=false,float finalTolerance=.2f)
        {
            if(points.Count<2)throw new InvalidOperationException("Empty route "+p.zoneId+" "+id);
            Vector2 firstDirection=(points[1]-points[0]).normalized;
            Vector2 first=points[0]+new Vector2(-firstDirection.y,firstDirection.x)*offset;
            var walker=new GameObject("SectorWalkCapsule");
            var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            walker.transform.position=new Vector3(first.x,RoaSectorSurface.Height(p,relief,first.x,first.y,true,true,railWalking)+1.05f,first.y);
            var body=Body(walker);
            try
            {
                for(int i=1;i<points.Count;i++)
                {
                    Vector2 direction=(points[i]-points[i-1]).normalized,target=points[i]+new Vector2(-direction.y,direction.x)*offset;
                    int attempts=Mathf.CeilToInt(Vector2.Distance(new Vector2(walker.transform.position.x,walker.transform.position.z),target)/.12f)*3+20;
                    for(int j=0;j<attempts;j++)
                    {
                        Vector2 delta=target-new Vector2(walker.transform.position.x,walker.transform.position.z);
                        if(delta.magnitude<(i==points.Count-1?finalTolerance:.2f))break;
                        delta=delta.normalized*Mathf.Min(.12f,delta.magnitude);body.Move(new Vector3(delta.x,-.04f,delta.y));
                    }
                    if(Vector2.Distance(new Vector2(walker.transform.position.x,walker.transform.position.z),target)>.55f)
                    {
                        Vector3 position=walker.transform.position;
                        string contacts=string.Join("; ",Physics.OverlapCapsule(position-Vector3.up*.7f,position+Vector3.up*.7f,body.radius+.15f)
                            .Where(c=>c!=body).Select(c=>c.name+" / "+c.transform.parent?.name+" / "+c.bounds));
                        for(int zi=-2;zi<=2;zi++)for(int xi=-2;xi<=2;xi++)
                        {
                            float x=target.x+xi*.5f,z=target.y+zi*.5f;
                            if(Physics.Raycast(new Vector3(x,300,z),Vector3.down,out RaycastHit hit,1000))
                                Debug.Log($"[WALK CONTACT] {x},{z}: {hit.collider.name}, y={hit.point.y}, slope={Vector3.Angle(hit.normal,Vector3.up)}, expected={RoaSectorSurface.Height(p,relief,x,z,true)}");
                        }
                        throw new InvalidOperationException($"Walking blocked {p.zoneId} {id}, lane {offset}, reached {position}, target {target}; contacts: {contacts}");
                    }
                }
                return new Vector2(walker.transform.position.x,walker.transform.position.z);
            }
            finally{Object.DestroyImmediate(walker);}
        }
        internal static List<Vector2> Trim(RoaSectorSurface.Point[] points,RoaSectorSurface.Profile p,float inset)
        {
            var result=new List<Vector2>();float halfX=p.width/2-inset,halfZ=p.depth/2-inset;
            for(int i=1;i<points.Length;i++)
            {
                Vector2 a=new Vector2(points[i-1].x,points[i-1].z),b=new Vector2(points[i].x,points[i].z);float low=0,high=1;
                for(int axis=0;axis<2;axis++)
                {
                    float d=b[axis]-a[axis],half=axis==0?halfX:halfZ;
                    if(Mathf.Abs(d)<.00001f){if(Mathf.Abs(a[axis])>half){low=1;high=0;}continue;}
                    float u=(-half-a[axis])/d,v=(half-a[axis])/d;low=Mathf.Max(low,Mathf.Min(u,v));high=Mathf.Min(high,Mathf.Max(u,v));
                }
                if(low>high)continue;
                foreach(float t in new[]{low,high}){Vector2 v=Vector2.Lerp(a,b,t);if(result.Count==0||Vector2.Distance(result[result.Count-1],v)>.001f)result.Add(v);}
            }
            return result;
        }
        private static List<Vector2> TrimEnds(List<Vector2> points,float margin)
        {
            var result=new List<Vector2>(points);
            for(int end=0;end<2;end++)
            {
                float left=margin;
                while(result.Count>1&&left>0)
                {
                    float distance=Vector2.Distance(result[0],result[1]);
                    if(distance<=left){left-=distance;result.RemoveAt(0);}
                    else {result[0]=Vector2.Lerp(result[0],result[1],left/distance);left=0;}
                }
                result.Reverse();
            }
            return result;
        }
    }
}
