using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Replays functional approaches against real saved Unity collision.</summary>
    public static class RoaSectorInteractionProbe
    {
        private sealed class Route
        {
            public string zone,locationId,kind,id;
            public RoaSectorSurface.Point approach,target;
            public float radius;
            public RoaSectorSurface.Point[] points;
        }
        public static void Run()
        {
            try
            {
                string input=Environment.GetEnvironmentVariable("ROA_INTERACTION_PATHS");
                if(string.IsNullOrEmpty(input))throw new InvalidOperationException("Set ROA_INTERACTION_PATHS");
                JObject diagnostic=JObject.Parse(File.ReadAllText(input));
                string preview=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
                JObject catalog=JObject.Parse(string.IsNullOrEmpty(preview)?Resources.Load<TextAsset>(RoaSectorSurface.ResourceKey).text:File.ReadAllText(preview));
                if(diagnostic.Value<string>("sourceHash")!=catalog.Value<string>("sourceHash"))throw new InvalidOperationException("Diagnostic paths belong to a different surface catalogue");
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selection=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                var routes=diagnostic["rows"].ToObject<Route[]>();
                int count=0,zones=0;
                bool collectFailures=Environment.GetEnvironmentVariable("ROA_INTERACTION_COLLECT_FAILURES")=="1";
                var failures=new List<object>();var completed=new List<string>();
                foreach(var group in routes.Where(r=>selection==null||selection.Contains(r.locationId)).GroupBy(r=>r.locationId).OrderBy(g=>g.Key,StringComparer.Ordinal))
                {
                    try
                    {
                    var p=RoaSectorSurface.Find(group.Key);
                    if(p==null||p.legacyDam)throw new InvalidOperationException("Unsupported diagnostic sector "+group.Key);
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    string definitionPath=p.locationId==p.zoneId?"data/zones/authored/"+p.zoneId+".json":"data/locations/"+p.locationId+".json";
                    var painter=new GameObject("InteractionProbeTerrain").AddComponent<RoaLocalTerrain>();
                    painter.InitializeAuthoredSurface(JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(Path.Combine(repository,definitionPath))),null,location.GroundRenderer);
                    Physics.SyncTransforms();
                    foreach(var row in group)
                    {
                        if(row.points==null||row.points.Length<2)throw new InvalidOperationException("Missing physical route "+row.zone+" "+row.id);
                        var points=row.points.Select(v=>new Vector2(v.x,v.z)).ToList();
                        Vector2 reached=RoaSectorWalkProbe.Walk(p,row.kind+"/"+row.id,points,0,false,.03f);
                        if(Vector2.Distance(points.Last(),new Vector2(row.target.x,row.target.z))>row.radius+.005f)
                            throw new InvalidOperationException("Physical approach outside interaction distance "+row.zone+" "+row.id);
                        if(Vector2.Distance(reached,new Vector2(row.target.x,row.target.z))>row.radius+.005f)
                            throw new InvalidOperationException("Reached position outside interaction distance "+row.zone+" "+row.id+": "+reached);
                        // Reaching a resource downhill must not strand the player below
                        // an unclimbable face. Replay the same actual approach uphill.
                        Vector2 returned=RoaSectorWalkProbe.Walk(p,row.kind+"/"+row.id+"/return",points.AsEnumerable().Reverse().ToList(),0,false,.03f);
                        if(Vector2.Distance(returned,points.First())>.035f)
                            throw new InvalidOperationException("Cannot return from interaction "+row.zone+" "+row.id+": "+returned);
                        count++;
                    }
                    zones++;Debug.Log("[SECTOR INTERACTION] Completed "+p.locationId+"; approaches "+group.Count());
                    completed.Add(p.locationId);
                    }
                    catch(Exception error)
                    {
                        if(!collectFailures)throw;
                        failures.Add(new{locationId=group.Key,message=error.Message});
                        Debug.LogError("[SECTOR INTERACTION] Failed "+group.Key+": "+error.Message);
                    }
                }
                string report=Environment.GetEnvironmentVariable("ROA_INTERACTION_REPORT");
                if(!string.IsNullOrWhiteSpace(report))File.WriteAllText(report,JsonConvert.SerializeObject(new{sourceHash=diagnostic.Value<string>("sourceHash"),completed,failures,approaches=count,roundTrips=count,zones},Formatting.Indented)+"\n");
                if(failures.Count>0)throw new InvalidOperationException("Physical interaction approaches failed in "+failures.Count+" zones; see recorded failures.");
                if(count==0)throw new InvalidOperationException("No physical approaches selected");
                Debug.Log($"[SECTOR INTERACTION] PASS: {count} real controller round trips in {zones} saved sectors.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
    }
}
