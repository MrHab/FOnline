using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Read-only measurement of the actual enabled native support base.</summary>
    public static class RoaProtectedNativeSupportProbe
    {
        public static void Run()
        {
            try
            {
                string root=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string output=Environment.GetEnvironmentVariable("ROA_PROTECTED_SUPPORT_REPORT")
                    ??Path.Combine(root,"Build/protected-native-support.json");
                string preview=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
                string previewSHA=null;
                if(!string.IsNullOrEmpty(preview))using(var hash=SHA256.Create())previewSHA=BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(preview))).Replace("-","").ToLowerInvariant();
                float tolerance=.35f;
                string requestedTolerance=Environment.GetEnvironmentVariable("ROA_PROTECTED_SUPPORT_TOLERANCE");
                if(!string.IsNullOrEmpty(requestedTolerance)
                    &&(!float.TryParse(requestedTolerance,System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture,out tolerance)||!float.IsFinite(tolerance)||tolerance<=0||tolerance>.35f))
                    throw new InvalidOperationException("Native support tolerance may only tighten the existing .35m limit");
                bool savedOnly=Environment.GetEnvironmentVariable("ROA_PROTECTED_SUPPORT_SAVED_ONLY")=="1";
                bool structures=Environment.GetEnvironmentVariable("ROA_PROTECTED_SUPPORT_STRUCTURES")=="1";
                string requestedObjects=Environment.GetEnvironmentVariable("ROA_PROTECTED_SUPPORT_IDS");
                var objectIds=string.IsNullOrWhiteSpace(requestedObjects)?null:
                    new HashSet<string>(requestedObjects.Split(',').Select(id=>id.Trim()),StringComparer.Ordinal);
                var measuredIds=new HashSet<string>(StringComparer.Ordinal);
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selected=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(',').Select(id=>id.Trim()),StringComparer.Ordinal);
                var measurements=new List<object>();int failed=0,scanned=0,missing=0;
                int structureTargets=0,structureScanned=0,missingStructures=0,degenerateStructureBases=0;
                var excludedStructures=new List<object>();
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(p.legacyDam)continue;
                    if(selected!=null&&!selected.Contains(p.zoneId)&&!selected.Contains(p.locationId))continue;
                    string relative=p.locationId==p.zoneId?"data/zones/authored/":"data/locations/";
                    string file=Path.Combine(root,relative+p.locationId+".json"),text=File.ReadAllText(file);
                    JObject source=JObject.Parse(text);
                    var removed=new HashSet<string>((p.placements??Array.Empty<RoaSectorSurface.Placement>())
                        .Where(change=>change.remove).Select(change=>change.id),StringComparer.Ordinal);
                    bool RetainedStructure(JObject row)=>structures&&(string)row["model"]=="wastelandShack"
                        &&!removed.Contains((string)row["id"]);
                    if(structures&&objectIds==null)
                        foreach(var row in (source["objects"] as JArray??new JArray()).OfType<JObject>()
                            .Where(r=>(string)r["model"]=="wastelandShack"&&removed.Contains((string)r["id"])))
                            excludedStructures.Add(new{zone=p.zoneId,location=p.locationId,id=(string)row["id"],reason="AUTHORED_PLACEMENT_REMOVE"});
                    var targets=(source["objects"] as JArray??new JArray()).OfType<JObject>()
                        .Where(r=>objectIds!=null?objectIds.Contains((string)r["id"]):
                            (r["resourceType"]!=null||r["resource"]!=null)
                            &&new[]{"oilPumpJack","tireStack"}.Contains((string)r["model"])||RetainedStructure(r)).ToArray();
                    structureTargets+=targets.Count(RetainedStructure);
                    if(targets.Length==0)continue;
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    var definition=JsonConvert.DeserializeObject<LocationDefinition>(text);
                    if(!savedOnly)
                    {
                        var painter=new GameObject("ProtectedNativeSupportMeasurement").AddComponent<RoaLocalTerrain>();
                        painter.InitializeAuthoredSurface(definition,null,location.GroundRenderer);
                    }
                    var ground=location.GroundRenderer.GetComponents<MeshCollider>().FirstOrDefault(c=>c.enabled&&c.sharedMesh!=null);
                    if(ground==null)throw new InvalidOperationException("No actual terrain MeshCollider "+p.locationId);
                    if(savedOnly&&!AssetDatabase.Contains(ground.sharedMesh))
                        throw new InvalidOperationException("Native support measurement requires a saved terrain mesh "+p.locationId);
                    Physics.SyncTransforms();
                    var markers=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                        .Where(m=>m.gameObject.activeInHierarchy).ToArray();
                    foreach(var row in targets)
                    {
                        string id=(string)row["id"];
                        bool structure=RetainedStructure(row);
                        measuredIds.Add(id);
                        var marker=markers.SingleOrDefault(m=>m.StableObjectId==id);
                        if(marker==null){missing++;if(structure)missingStructures++;measurements.Add(new{zone=p.zoneId,location=p.locationId,id,status="MISSING_PROTECTED_MARKER",structure});continue;}
                        var vertices=new List<Vector3>();
                        foreach(var filter in marker.GetComponentsInChildren<MeshFilter>(true))
                        {
                            var renderer=filter.GetComponent<MeshRenderer>();
                            if(renderer==null||!renderer.enabled||!renderer.gameObject.activeInHierarchy||filter.sharedMesh==null)continue;
                            vertices.AddRange(filter.sharedMesh.vertices.Select(v=>filter.transform.TransformPoint(v)));
                        }
                        if(vertices.Count==0)throw new InvalidOperationException("No enabled native mesh "+p.locationId+"/"+id);
                        float bottom=vertices.Min(v=>v.y);
                        var baseVertices=vertices.Where(v=>v.y<=bottom+.08f).ToArray();
                        var hull=Hull(baseVertices.Select(v=>new Vector2(v.x,v.z)));
                        if(hull.Count==0||(hull.Count<3&&objectIds==null&&!structure))
                            throw new InvalidOperationException("Degenerate native support base "+p.locationId+"/"+id);
                        // Explicit native props may end in a point or an edge.
                        // Measure those actual vertices; machinery still needs a footprint.
                        int baseDimension=hull.Count>=3?2:hull.Count==2?1:0;
                        if(structure&&baseDimension<2)degenerateStructureBases++;
                        string baseDiagnostic=baseDimension==2?"AREA_HULL":
                            structure?(baseDimension==1?"DEGENERATE_STRUCTURE_BASE_EDGE":"DEGENERATE_STRUCTURE_BASE_POINT"):
                            (baseDimension==1?"EXPLICIT_BASE_EDGE":"EXPLICIT_BASE_POINT");
                        var center=hull.Aggregate(Vector2.zero,(sum,v)=>sum+v)/hull.Count;
                        var samples=new List<Vector2>{center};
                        for(int i=0;i<hull.Count;i++){samples.Add(hull[i]);samples.Add((hull[i]+hull[(i+1)%hull.Count])*.5f);}
                        var contacts=new List<object>();float maxGap=float.NegativeInfinity,maxBurial=float.PositiveInfinity;
                        foreach(var at in samples)
                        {
                            var ray=new Ray(new Vector3(at.x,bottom+1000,at.y),Vector3.down);
                            if(!ground.Raycast(ray,out var hit,2500))throw new InvalidOperationException("No native terrain support ray "+p.zoneId+"/"+id);
                            float gap=bottom-hit.point.y;maxGap=Mathf.Max(maxGap,gap);maxBurial=Mathf.Min(maxBurial,gap);
                            contacts.Add(new{x=at.x,z=at.y,bottom,ground=hit.point.y,gap});
                        }
                        bool pass=maxGap<=tolerance&&maxBurial>=-tolerance;if(!pass)failed++;scanned++;
                        if(structure)structureScanned++;
                        measurements.Add(new{zone=p.zoneId,location=p.locationId,id,model=(string)row["model"],
                            nativePrefab=(string)row["nativePrefab"],structure,baseDiagnostic,
                            status=pass?"PASS":"NATIVE_BASE_CONTACT_FAIL",maxGap,maxBurial,tolerance,
                            position=new[]{marker.transform.position.x,marker.transform.position.y,marker.transform.position.z},
                            sourcePosition=row["surfaceSourcePosition"]??row["position"],surfacePlacement=row["surfacePlacement"],
                            baseBand=.08f,baseDimension,hull=hull.Select(v=>new[]{v.x,v.y}),samples=contacts,
                            enabledMeshVertexCount=vertices.Count,baseVertexCount=baseVertices.Length,
                            nativeBaseVertices=structure?baseVertices.Select(v=>new[]{v.x,v.y,v.z}).ToArray():null});
                    }
                    if(text!=File.ReadAllText(file))throw new InvalidOperationException("Definition changed during probe "+file);
                    Debug.Log($"[PROTECTED NATIVE SUPPORT] {p.zoneId}: {targets.Length}, total {scanned}, contact failures {failed}");
                }
                if(objectIds!=null&&!objectIds.SetEquals(measuredIds))
                    throw new InvalidOperationException("Requested native support IDs were not measured: "+string.Join(",",objectIds.Except(measuredIds)));
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.WriteAllText(output,JsonConvert.SerializeObject(new{schema="roa.protectedNativeSupport.v1",scanned,failed,missing,tolerance,
                    previewInput=preview,previewSHA256=previewSHA,savedOnly,reprojectionAllowed=!savedOnly,
                    structures,structureTargets,structureScanned,missingStructures,degenerateStructureBases,excludedStructures,measurements},Formatting.Indented));
                Debug.Log($"[PROTECTED NATIVE SUPPORT] DONE: {scanned} actual native bases, {failed} contact failures, {missing} missing; no scenes or definitions saved.");
                if(missingStructures>0||structureScanned!=structureTargets)
                    throw new InvalidOperationException($"Retained structure native support incomplete: {structureScanned}/{structureTargets}, {missingStructures} missing markers; report {output}");
                if(Application.isBatchMode)EditorApplication.Exit(missing==0&&failed==0?0:1);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static List<Vector2> Hull(IEnumerable<Vector2> points)
        {
            var sorted=points.GroupBy(v=>(Mathf.RoundToInt(v.x*10000),Mathf.RoundToInt(v.y*10000))).Select(g=>g.First()).OrderBy(v=>v.x).ThenBy(v=>v.y).ToArray();
            var hull=new List<Vector2>();
            foreach(var v in sorted){while(hull.Count>=2&&Cross(hull[hull.Count-2],hull[hull.Count-1],v)<=.000001f)hull.RemoveAt(hull.Count-1);hull.Add(v);}
            int lower=hull.Count;
            for(int i=sorted.Length-2;i>=0;i--){var v=sorted[i];while(hull.Count>lower&&Cross(hull[hull.Count-2],hull[hull.Count-1],v)<=.000001f)hull.RemoveAt(hull.Count-1);hull.Add(v);}
            if(hull.Count>1)hull.RemoveAt(hull.Count-1);return hull;
        }
        private static float Cross(Vector2 a,Vector2 b,Vector2 c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    }
}
