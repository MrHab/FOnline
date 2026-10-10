using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Actual native controller preservation, separate well footprint and soil contact.</summary>
    public static class RoaOilExtractionProbe
    {
        public static void Run()
        {
            try
            {
                if(Environment.GetEnvironmentVariable("ROA_OIL_EXTRACTION_BUILD")=="1")RoaOilExtractionAssets.Build();
                string repo=System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath,"../.."));
                string output=Environment.GetEnvironmentVariable("ROA_OIL_EXTRACTION_REPORT")??System.IO.Path.Combine(repo,"Build/oil-extraction.json");
                string capture=Environment.GetEnvironmentVariable("ROA_OIL_EXTRACTION_CAPTURE");
                var reports=new List<object>();int total=0,added=0,existing=0,failed=0;
                string ids=Environment.GetEnvironmentVariable("ROA_OIL_EXTRACTION_IDS");
                foreach(var p in RoaSectorSurface.AllProfiles.Where(p=>string.IsNullOrEmpty(ids)||ids.Split(',').Contains(p.zoneId)).OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    string relative=p.locationId==p.zoneId?"data/zones/authored/":"data/locations/";
                    string text=File.ReadAllText(System.IO.Path.Combine(repo,relative+p.locationId+".json"));
                    var definition=JsonConvert.DeserializeObject<LocationDefinition>(text);
                    var rows=definition.Objects.Where(r=>r.Model=="oilPumpJack"&&r.ResourceType=="oil").ToArray();
                    if(rows.Length==0)continue;
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    var beforeMarkers=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
                    var original=rows.ToDictionary(r=>r.Id,r=>Snapshot(beforeMarkers.Single(m=>m.StableObjectId==r.Id)));
                    new GameObject("OilExtractionProbePainter").AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(definition,null,location.GroundRenderer);
                    Physics.SyncTransforms();
                    var markers=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
                    var builds=location.GetComponentsInChildren<RoaOilExtraction>(true);
                    int countBefore=builds.Length;
                    var signatures=builds.ToDictionary(b=>b.StableObjectId,b=>Signature(b));
                    RoaOilExtraction.Ensure(definition,location.GroundRenderer);Physics.SyncTransforms();
                    builds=location.GetComponentsInChildren<RoaOilExtraction>(true);
                    if(builds.Length!=countBefore||builds.Any(b=>Signature(b)!=signatures[b.StableObjectId]))throw new InvalidOperationException("Non-deterministic repeat "+p.zoneId);
                    if(markers.Length!=beforeMarkers.Length)throw new InvalidOperationException("New authoritative markers "+p.zoneId);
                    foreach(var row in rows)
                    {
                        total++;var marker=markers.Single(m=>m.StableObjectId==row.Id);
                        var assembly=builds.SingleOrDefault(b=>b.StableObjectId==row.Id);
                        var issues=new List<string>();
                        // Projection can legitimately move the controller root; native mesh/scale/LOD cannot change.
                        if(original[row.Id]!=Snapshot(marker))issues.Add("native_controller_changed");
                        if(assembly==null)
                        {
                            if(!marker.GetComponentsInChildren<Transform>(true).Any(t=>t.name.Contains("Horsehead")||t.name.Contains("HorseHead")||t.name.Contains("WalkingBeam")))issues.Add("missing_extraction");
                            else existing++;
                            reports.Add(new{zone=p.zoneId,id=row.Id,legacy=p.legacyDam,existingWalkingBeam=true,issues});
                            if(issues.Count>0)failed++;continue;
                        }
                        added++;
                        if(assembly.transform.IsChildOf(marker.transform))issues.Add("native_footer_polluted");
                        if(assembly.GetComponentsInChildren<Collider>(true).Length!=0)issues.Add("new_gameplay_collider");
                        var motor=assembly.transform.Find("NativeHydraulicPowerUnit");
                        if(motor!=null)issues.Add("obsolete_portable_motor");
                        var vertices=assembly.GetComponentsInChildren<MeshFilter>(true).Where(f=>f.sharedMesh!=null)
                            .SelectMany(f=>f.sharedMesh.vertices.Select(v=>f.transform.TransformPoint(v))).ToArray();
                        var local=vertices.Select(v=>Quaternion.Inverse(marker.transform.rotation)*(v-marker.transform.position)).ToArray();
                        float halfX=row.Footprint.X*.5f,halfZ=row.Footprint.Z*.5f;
                        if(local.Any(v=>Mathf.Abs(v.x)>halfX+.001f||Mathf.Abs(v.z)>halfZ+.001f))issues.Add("outside_existing_footprint");
                        if(!p.legacyDam&&vertices.Any(v=>RoaSectorSurface.IsWaterAt(p,v.x,v.z)))issues.Add("wet_extraction");
                        var casing=assembly.transform.Find("WellCasing_GroundContact");
                        float bottom=casing.position.y-casing.localScale.y;
                        float penetration=assembly.SoilContact.y-bottom;
                        if(Mathf.Abs(penetration-.22f)>.005f)issues.Add("missing_soil_contact");
                        float flangeY=assembly.transform.TransformPoint(new Vector3(.73f,.24f,.55f)).y;
                        if(assembly.SoilContact.y>flangeY+.10f)issues.Add("wellhead_buried");
                        var bounds=new Bounds(vertices[0],Vector3.zero);foreach(var v in vertices)bounds.Encapsulate(v);
                        var overlaps=new List<string>();
                        var nativeOverlaps=new List<string>();
                        var visible=assembly.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray();
                        var controller=marker.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray();
                        foreach(var other in markers.Where(m=>m!=marker&&m.gameObject.activeInHierarchy))
                        {
                            var otherMeshes=other.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r!=location.GroundRenderer&&r.enabled&&r.gameObject.activeInHierarchy&&r.bounds.size.y>.04f).ToArray();
                            if(GeometryOverlap(visible,otherMeshes))overlaps.Add(other.StableObjectId);
                            if(GeometryOverlap(controller,otherMeshes))nativeOverlaps.Add(other.StableObjectId);
                        }
                        foreach(var other in builds.Where(b=>b!=assembly))
                            if(GeometryOverlap(visible,other.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray()))overlaps.Add("equipment/"+other.StableObjectId);
                        if(overlaps.Count>0)issues.Add("actual_other_model_overlap");
                        if(nativeOverlaps.Count>0)issues.Add("native_controller_overlap");
                        var nativeVertices=controller.SelectMany(r=>r.GetComponent<MeshFilter>().sharedMesh.vertices.Select(v=>r.transform.TransformPoint(v))).ToArray();
                        float nativeBottom=nativeVertices.Min(v=>v.y);
                        var supportHull=Hull(nativeVertices.Where(v=>v.y<=nativeBottom+.08f).Select(v=>new Vector2(v.x,v.z)).ToArray());
                        var supportSamples=new List<Vector2>{supportHull.Aggregate(Vector2.zero,(sum,v)=>sum+v)/supportHull.Length};
                        for(int i=0;i<supportHull.Length;i++){supportSamples.Add(supportHull[i]);supportSamples.Add((supportHull[i]+supportHull[(i+1)%supportHull.Length])*.5f);}
                        float nativeMaxGap=float.NegativeInfinity,nativeMaxBurial=float.PositiveInfinity;
                        foreach(var point in supportSamples)
                        {
                            var ray=new Ray(new Vector3(point.x,nativeBottom+1000,point.y),Vector3.down);
                            var groundCollider=location.GroundRenderer.GetComponents<Collider>().First(c=>c.enabled);
                            if(!groundCollider.Raycast(ray,out var supportHit,2500))throw new InvalidOperationException("No actual native base ground "+row.Id);
                            float gap=nativeBottom-supportHit.point.y;nativeMaxGap=Mathf.Max(nativeMaxGap,gap);nativeMaxBurial=Mathf.Min(nativeMaxBurial,gap);
                        }
                        if(nativeMaxGap>.35f||nativeMaxBurial<-.35f)issues.Add("native_base_contact");
                        if(issues.Count>0)failed++;
                        if(issues.Count>0)Debug.LogWarning("[OIL EXTRACTION DEFECT] "+p.zoneId+"/"+row.Id+": "+string.Join(",",issues));
                        reports.Add(new{zone=p.zoneId,id=row.Id,legacy=p.legacyDam,issues,
                            ownExtractionGeometry=true,originalControllerPreserved=true,
                            footprint=new[]{row.Footprint.X,row.Footprint.Z},boundsMin=new[]{bounds.min.x,bounds.min.y,bounds.min.z},boundsMax=new[]{bounds.max.x,bounds.max.y,bounds.max.z},
                            contact=new[]{assembly.SoilContact.x,assembly.SoilContact.y,assembly.SoilContact.z},penetration,overlaps,nativeOverlaps,
                            nativeMaxGap,nativeMaxBurial,meshHulls=MeshHulls(visible),controllerHulls=MeshHulls(controller),
                            cabinetMeshes=marker.GetComponentsInChildren<MeshFilter>(true).Select(f=>f.sharedMesh?.name).ToArray()});
                        if(!string.IsNullOrEmpty(capture)&&(p.zoneId=="z_02_09"||(p.zoneId=="z_09_12"&&row.Id=="s45_p1")||p.legacyDam))
                            Capture(capture,p.zoneId,row.Id,marker,assembly);
                    }
                    Debug.Log($"[OIL EXTRACTION PROBE] {p.zoneId}: {rows.Length}, total {total}, failures {failed}");
                }
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(output));
                File.WriteAllText(output,JsonConvert.SerializeObject(new{schema="roa.oilExtractionProof.v1",total,added,existing,failed,repeatDeterministic=true,reports},Formatting.Indented));
                Debug.Log($"[OIL EXTRACTION PROBE] DONE {total}, {added} additions, {existing} existing real pumps, {failed} failures");
                if(Application.isBatchMode)EditorApplication.Exit(failed==0?0:1);
            }
            catch(Exception e){Debug.LogException(e);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        static string Snapshot(KromkaPlacedObjectAuthoring marker)
            =>string.Join("|",marker.GetComponentsInChildren<MeshFilter>(true).Select(f=>f.name+":"+f.sharedMesh?.GetEntityId()+":"+f.transform.localPosition+":"+f.transform.localRotation+":"+f.transform.localScale))
                +";rootScale="+marker.transform.localScale+";colliders="+marker.GetComponentsInChildren<Collider>(true).Length;
        static string Signature(RoaOilExtraction assembly)
            =>string.Join("|",assembly.GetComponentsInChildren<MeshFilter>(true).Select(f=>f.name+":"+f.transform.localPosition+":"+f.transform.localRotation+":"+f.transform.localScale));
        static object[] MeshHulls(MeshRenderer[] renderers)
            =>renderers.Select(r=>
            {
                var values=r.GetComponent<MeshFilter>().sharedMesh.vertices.Select(v=>r.transform.TransformPoint(v)).ToArray();
                return (object)new{name=r.name,minY=values.Min(v=>v.y),maxY=values.Max(v=>v.y),hull=Hull(values.Select(v=>new Vector2(v.x,v.z)).ToArray()).Select(v=>new[]{v.x,v.y}).ToArray()};
            }).ToArray();
        internal static bool GeometryOverlap(MeshRenderer[] one,MeshRenderer[] two)
        {
            // World AABBs are only a broad phase: source yaws rotate the native
            // bodies, so intersecting AABBs alone do not prove body overlap.
            foreach(var a in one)foreach(var b in two)
            {
                if(!a.bounds.Intersects(b.bounds))continue;
                var af=a.GetComponent<MeshFilter>();var bf=b.GetComponent<MeshFilter>();
                if(af?.sharedMesh==null||bf?.sharedMesh==null)continue;
                var av=af.sharedMesh.vertices.Select(v=>a.transform.TransformPoint(v)).ToArray();
                var bv=bf.sharedMesh.vertices.Select(v=>b.transform.TransformPoint(v)).ToArray();
                if(av.Length<3||bv.Length<3||av.Max(v=>v.y)<=bv.Min(v=>v.y)+.001f||bv.Max(v=>v.y)<=av.Min(v=>v.y)+.001f)continue;
                var ah=Hull(av.Select(v=>new Vector2(v.x,v.z)).ToArray());var bh=Hull(bv.Select(v=>new Vector2(v.x,v.z)).ToArray());
                bool separated=false;
                foreach(var polygon in new[]{ah,bh})for(int i=0;i<polygon.Length&&!separated;i++)
                {
                    Vector2 delta=polygon[(i+1)%polygon.Length]-polygon[i],axis=new Vector2(-delta.y,delta.x).normalized;
                    float amin=ah.Min(v=>Vector2.Dot(v,axis)),amax=ah.Max(v=>Vector2.Dot(v,axis)),bmin=bh.Min(v=>Vector2.Dot(v,axis)),bmax=bh.Max(v=>Vector2.Dot(v,axis));
                    separated=amax<=bmin+.001f||bmax<=amin+.001f;
                }
                if(!separated)return true;
            }
            return false;
        }
        static Vector2[] Hull(Vector2[] values)
        {
            var sorted=values.Distinct().OrderBy(v=>v.x).ThenBy(v=>v.y).ToArray();if(sorted.Length<3)return sorted;
            float Cross(Vector2 a,Vector2 b,Vector2 c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
            var lower=new List<Vector2>();foreach(var v in sorted){while(lower.Count>1&&Cross(lower[lower.Count-2],lower[lower.Count-1],v)<=0)lower.RemoveAt(lower.Count-1);lower.Add(v);}
            var upper=new List<Vector2>();foreach(var v in sorted.Reverse()){while(upper.Count>1&&Cross(upper[upper.Count-2],upper[upper.Count-1],v)<=0)upper.RemoveAt(upper.Count-1);upper.Add(v);}
            lower.RemoveAt(lower.Count-1);upper.RemoveAt(upper.Count-1);lower.AddRange(upper);return lower.ToArray();
        }
        static void Capture(string folder,string zone,string id,KromkaPlacedObjectAuthoring marker,RoaOilExtraction assembly)
        {
            Directory.CreateDirectory(folder);
            RenderSettings.ambientLight=new Color(.46f,.45f,.40f);RenderSettings.fog=false;
            foreach(var light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))light.enabled=false;
            var sun=new GameObject("OilReviewSun").AddComponent<Light>();sun.type=LightType.Directional;sun.intensity=1.1f;sun.transform.rotation=Quaternion.Euler(50,-35,0);
            var camera=new GameObject("OilReviewCamera").AddComponent<Camera>();camera.farClipPlane=1500;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=new Color(.35f,.37f,.35f);camera.fieldOfView=45;
            foreach(bool low in new[]{false,true})
            {
                Quaternion rotation=assembly.transform.rotation*Quaternion.Euler(low?18:48,-35,0);
                Vector3 target=marker.transform.position+Vector3.up*.95f;
                camera.transform.rotation=rotation;camera.transform.position=target-camera.transform.forward*(low?8:9);
                string name=zone+"-"+id+(low?"-low":"-game");
                KromkaSceneShot.Capture(camera,System.IO.Path.Combine(folder,name+".png"),1280,720);
                KromkaSceneShot.Capture(camera,System.IO.Path.Combine(folder,name+"-mobile.png"),844,390);
            }
            Object.DestroyImmediate(camera.gameObject);Object.DestroyImmediate(sun.gameObject);
        }
    }
}
