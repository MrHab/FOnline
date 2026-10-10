using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    public static class RoaWaterCisternProbe
    {
        public static void Run()
        {
            try
            {
                if(Environment.GetEnvironmentVariable("ROA_WATER_CISTERN_BUILD")=="1")RoaWaterCisternAssets.Build();
                string repo=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string selected=Environment.GetEnvironmentVariable("ROA_WATER_CISTERN_IDS");
                var ids=string.IsNullOrEmpty(selected)?null:new HashSet<string>(selected.Split(','));
                var reports=new List<object>();var removed=new List<object>();int failed=0;
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(p.legacyDam||(ids!=null&&!ids.Contains(p.zoneId)))continue;
                    string folder=p.locationId==p.zoneId?"data/zones/authored/":"data/locations/";
                    string definitionText=File.ReadAllText(Path.Combine(repo,folder+p.locationId+".json"));
                    var def=JsonConvert.DeserializeObject<LocationDefinition>(definitionText);
                    var removedIds=new HashSet<string>((p.placements??Array.Empty<RoaSectorSurface.Placement>()).Where(r=>r.remove).Select(r=>r.id));
                    var archived=(JObject.Parse(definitionText)["surfaceSource"]?["removedObjects"] as JArray??new JArray())
                        .OfType<JObject>().Select(r=>r.ToObject<LocationObject>());
                    // Archives count removed scenery only. Painter/Ensure retain the untouched current definition.
                    var eligible=def.Objects.Concat(archived).GroupBy(r=>r.Id,StringComparer.Ordinal)
                        .Select(g=>g.First()).Where(RoaWaterCistern.Supports).ToArray();
                    removed.AddRange(eligible.Where(r=>removedIds.Contains(r.Id)).Select(r=>(object)new{zone=p.zoneId,id=r.Id,reason="authored-scenery-clearance"}));
                    var rows=def.Objects.Where(RoaWaterCistern.Supports).Where(r=>!removedIds.Contains(r.Id)).ToArray();if(rows.Length==0)continue;
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    var markers=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
                    var protectedSignatures=rows.ToDictionary(r=>r.Id,r=>Signature(markers.Single(m=>m.StableObjectId==r.Id)));
                    new GameObject("CisternProbePainter").AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(def,null,location.GroundRenderer);
                    Physics.SyncTransforms();
                    foreach(var row in rows)
                    {
                        var marker=markers.Single(m=>m.StableObjectId==row.Id);var issues=new List<string>();
                        var tank=marker.GetComponentInChildren<RoaWaterCistern>();
                        if(tank==null)throw new InvalidOperationException("Missing actual compact cistern "+row.Id);
                        if(Signature(marker)!=protectedSignatures[row.Id])issues.Add("authority-or-native-asset-mutated");
                        if(tank.GetComponentsInChildren<Collider>(true).Length!=0)issues.Add("new-gameplay-collider");
                        if((tank.transform.lossyScale-Vector3.one).sqrMagnitude>1e-8f)issues.Add("not-native-world-size");
                        var filters=tank.GetComponentsInChildren<MeshFilter>();
                        var points=filters.SelectMany(f=>f.sharedMesh.vertices.Select(v=>f.transform.TransformPoint(v))).ToArray();
                        var local=points.Select(v=>Quaternion.Inverse(marker.transform.rotation)*(v-marker.transform.position)).ToArray();
                        if(local.Any(v=>Mathf.Abs(v.x)>row.Footprint.X*.5f+.005f||Mathf.Abs(v.z)>row.Footprint.Z*.5f+.005f))issues.Add("outside-authored-footprint");
                        if(points.Any(v=>RoaSectorSurface.IsWaterAt(p,v.x,v.z,.1f)))issues.Add("wet-reservoir-foundation");
                        var ground=location.GroundRenderer.GetComponents<Collider>().Single(c=>c.enabled);
                        float Soil(Vector3 v){if(!ground.Raycast(new Ray(v+Vector3.up*1000,Vector3.down),out var hit,2500))throw new InvalidOperationException("No actual cistern ground");return hit.point.y;}
                        float maxContactError=tank.SoilContacts.Max(v=>Mathf.Abs(Soil(v)-v.y));
                        if(tank.SoilContacts.Length!=8||maxContactError>.01f)issues.Add("unsupported-saddle");
                        var body=filters.Where(f=>!f.name.StartsWith("GroundedConcreteSaddle_")).SelectMany(f=>f.sharedMesh.vertices.Select(v=>f.transform.TransformPoint(v))).ToArray();
                        float minGroundClearance=body.Min(v=>v.y-Soil(v));
                        if(minGroundClearance<-.03f)issues.Add("vessel-buried-in-terrain");
                        float maxSupportHeight=tank.SoilContacts.Max(v=>tank.transform.position.y+.44f-v.y);
                        // Visual screening, separate from the physical soil/body checks above.
                        // Independent review accepted grounded 1.286 m supports; bare supports
                        // exceeding 2 m required service terraces. Actual captures remain required.
                        if(maxSupportHeight>1.5f)issues.Add("excessive-saddle-height");
                        var own=tank.GetComponentsInChildren<MeshRenderer>().Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray();
                        var overlaps=markers.Where(m=>m!=marker&&m.gameObject.activeInHierarchy&&m.Role!="terrain")
                            .Where(m=>RoaOilExtractionProbe.GeometryOverlap(own,m.GetComponentsInChildren<MeshRenderer>()
                                .Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray())).Select(m=>m.StableObjectId).ToArray();
                        if(overlaps.Length>0)issues.Add("neighbor-overlap:"+string.Join(",",overlaps));
                        string before=OwnSignature(tank);
                        RoaWaterCistern.Ensure(def,location.GroundRenderer);Physics.SyncTransforms();
                        tank=marker.GetComponentInChildren<RoaWaterCistern>();
                        if(before!=OwnSignature(tank))issues.Add("non-repeatable-assembly");
                        if(issues.Count>0){failed++;Debug.LogWarning("[CISTERN DEFECT] "+p.zoneId+"/"+row.Id+": "+string.Join(",",issues));}
                        reports.Add(new{zone=p.zoneId,id=row.Id,issues,maxContactError,minGroundClearance,maxSupportHeight,
                            footprint=new[]{row.Footprint.X,row.Footprint.Z},boundsMin=new[]{points.Min(v=>v.x),points.Min(v=>v.y),points.Min(v=>v.z)},boundsMax=new[]{points.Max(v=>v.x),points.Max(v=>v.y),points.Max(v=>v.z)}});
                    }
                }
                string output=Environment.GetEnvironmentVariable("ROA_WATER_CISTERN_REPORT");
                File.WriteAllText(output,JsonConvert.SerializeObject(new{schema="roa.waterCisternProof.v1",count=reports.Count,removed,failed,reports},Formatting.Indented)+"\n");
                if(failed>0)throw new InvalidOperationException("Compact cistern proof failed: "+failed);
                Debug.Log("[WATER CISTERN PROOF] PASS: "+reports.Count+" actual assemblies, footprint, dry ground, eight saddle contacts, native/authority integrity and repeatability.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception e){Debug.LogException(e);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static string Signature(KromkaPlacedObjectAuthoring marker)
        {
            return JsonConvert.SerializeObject(new{marker.StableObjectId,marker.ServerArchetypeId,marker.Role,marker.ServerAuthoritative,marker.BlocksMovement,marker.BlocksVision,marker.ProvidesLowCover,tags=marker.GameplayTags,
                scale=marker.transform.localScale.ToString("F5"),
                native=marker.GetComponentsInChildren<MeshFilter>(true).Where(f=>f.GetComponentInParent<RoaWaterCistern>()==null)
                    .Select(f=>new{f.name,mesh=f.sharedMesh?.GetEntityId().ToString(),scale=f.transform.localScale.ToString("F5"),position=f.transform.localPosition.ToString("F5"),rotation=f.transform.localRotation.ToString("F5")}).ToArray(),
                colliders=marker.GetComponentsInChildren<Collider>(true).Select(c=>new{c.name,type=c.GetType().Name,c.enabled,c.isTrigger}).ToArray()});
        }
        private static string OwnSignature(RoaWaterCistern tank)=>JsonConvert.SerializeObject(new{position=tank.transform.position.ToString("F5"),rotation=tank.transform.rotation.ToString("F5"),scale=tank.transform.lossyScale.ToString("F5"),
            meshes=tank.GetComponentsInChildren<MeshFilter>().Select(f=>new{f.name,vertices=f.sharedMesh.vertices.Select(v=>v.ToString("F5")).ToArray(),triangles=f.sharedMesh.triangles}).ToArray()});
    }
}
