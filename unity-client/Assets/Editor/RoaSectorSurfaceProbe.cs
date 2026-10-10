using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    public static class RoaSectorSurfaceProbe
    {
        [MenuItem("Realm of Ashes/Zones/Preview world sector surfaces")]
        public static void Run()=>RunCore(false);
        // Diagnostic saved scenes can be inspected before a candidate catalogue is
        // published. Final acceptance still uses Run() against the published resource.
        public static void RunSavedPreviewDiagnostic()=>RunCore(true);
        private static void RunCore(bool diagnosticPreview)
        {
            try
            {
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string output=Environment.GetEnvironmentVariable("ROA_SECTOR_CAPTURE")
                    ?? Path.Combine(repository,"Build/SectorSurfaces");
                Directory.CreateDirectory(output);
                bool savedOnly=Environment.GetEnvironmentVariable("ROA_SECTOR_CAPTURE_SAVED")=="1";
                string previewInput=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
                if(diagnosticPreview&&(!savedOnly||string.IsNullOrEmpty(previewInput)))
                    throw new InvalidOperationException("Saved preview diagnostics require a saved scene and external candidate catalogue.");
                if(!diagnosticPreview&&savedOnly&&!string.IsNullOrEmpty(previewInput))
                    throw new InvalidOperationException("Saved captures cannot use a preview catalogue.");
                string sourceHash=JObject.Parse(File.ReadAllText(diagnosticPreview?previewInput:
                    Path.Combine(repository,"data/kromka/sector-surfaces.json"))).Value<string>("sourceHash");
                string[] ids=(Environment.GetEnvironmentVariable("ROA_SECTOR_IDS")
                    ?? "z_09_08,z_10_09,z_10_06,z_07_13,sluiceCity,secondHaven,z_04_10,z_14_08").Split(',');
                var reports=new List<object>();
                foreach(string id in ids)
                {
                    RoaSectorSurface.Profile p=RoaSectorSurface.Find(id);
                    if(p==null || p.legacyDam)throw new InvalidOperationException("No general sector profile for "+id);
                    string definitionPath=p.locationId==p.zoneId ? "data/zones/authored/"+id+".json" : "data/locations/"+id+".json";
                    string authoredText=File.ReadAllText(Path.Combine(repository,definitionPath));
                    JObject authored=JObject.Parse(authoredText);
                    LocationDefinition definition=JsonConvert.DeserializeObject<LocationDefinition>(authoredText);
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(id));
                    RoaUnityLocationScene location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    if(location==null || location.GroundRenderer==null)throw new InvalidOperationException("Missing authored ground "+id);
                    if(savedOnly)
                    {
                        if(authored.Value<string>("sectorSurfaceVersion")!=sourceHash)
                            throw new InvalidOperationException("Saved scene uses a different surface version "+id);
                        foreach(var renderer in location.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled&&r.gameObject.activeInHierarchy))
                        {
                            // Text components recreate their glyph meshes from persisted font/text data.
                            if(renderer.GetComponent<TextMesh>()!=null||renderer.GetComponentInParent<TMPro.TMP_Text>()!=null)continue;
                            var savedMesh=renderer.GetComponent<MeshFilter>()?.sharedMesh;
                            if(savedMesh==null||!AssetDatabase.Contains(savedMesh)||renderer.sharedMaterials.Any(m=>m==null||!AssetDatabase.Contains(m)))
                                throw new InvalidOperationException("Unsaved visible mesh/material "+id+"/"+renderer.name);
                        }
                    }
                    else
                    {
                        var painter=new GameObject("SectorSurfaceCapturePainter").AddComponent<RoaLocalTerrain>();
                        painter.InitializeAuthoredSurface(definition,null,location.GroundRenderer);
                    }
                    if(location.GroundRenderer.GetComponent<RoaSectorSurface>()==null)throw new InvalidOperationException("Projection failed "+id);
                    foreach(Light light in Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude))light.enabled=false;
                    RenderSettings.ambientMode=AmbientMode.Flat;RenderSettings.ambientLight=new Color(.38f,.37f,.34f);
                    var ambient=new SphericalHarmonicsL2();ambient.AddAmbientLight(RenderSettings.ambientLight);
                    RenderSettings.ambientProbe=ambient;RenderSettings.fog=false;
                    Light sun=new GameObject("SectorCaptureSun").AddComponent<Light>();sun.type=LightType.Directional;
                    sun.color=new Color(1,.94f,.83f);sun.intensity=1.05f;sun.shadows=LightShadows.Soft;
                    sun.transform.rotation=Quaternion.Euler(52,-35,0);
                    Camera camera=new GameObject("SectorCaptureCamera").AddComponent<Camera>();
                    camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=new Color(.35f,.37f,.36f);
                    camera.farClipPlane=2000;camera.orthographic=true;
                    Physics.SyncTransforms();
                    var captureTerrain=new CaptureTerrain(location,p);
                    var basicCameraReports=new List<object>();
                    Bounds bounds=location.GroundRenderer.bounds;
                    File.WriteAllText(Path.Combine(output,id+"-visual-inventory.json"),JsonConvert.SerializeObject(
                        location.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled && r.gameObject.activeInHierarchy).Select(r=>new {
                            name=r.name,parent=r.transform.parent?.name,objectId=r.GetComponentInParent<KromkaPlacedObjectAuthoring>()?.StableObjectId,
                            center=new[]{r.bounds.center.x,r.bounds.center.y,r.bounds.center.z},size=new[]{r.bounds.size.x,r.bounds.size.y,r.bounds.size.z},materials=r.sharedMaterials.Select(m=>m==null?null:AssetDatabase.GetAssetPath(m)+"/"+m.name).ToArray()
                        }),Formatting.Indented));
                    Vector3 target=new Vector3(0,bounds.center.y,0);
                    camera.orthographicSize=p.depth*.55f;
                    camera.transform.position=target+new Vector3(0,700,0);camera.transform.LookAt(target,Vector3.forward);
                    KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-top.png"),1280,720);
                    camera.transform.rotation=Quaternion.Euler(58,-32,0);
                    camera.transform.position=target-camera.transform.forward*600;
                    KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-desktop.png"),1280,720);
                    KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-mobile.png"),844,390);
                    var focusPoints=new List<(string label,Vector3 point,float yaw)>();
                    JObject spawn=authored["spawn"] as JObject;
                    if(spawn==null || spawn["x"]==null || spawn["z"]==null)
                        throw new InvalidOperationException("Missing authored spawn for game-size capture "+id);
                    float spawnX=spawn.Value<float>("x"),spawnZ=spawn.Value<float>("z");
                    focusPoints.Add(("spawn",new Vector3(spawnX,captureTerrain.Height(spawnX,spawnZ,id+"/spawn").Value+1,spawnZ),0));
                    foreach(JObject site in (authored["sites"] as JArray??new JArray()).Concat(authored["facilities"] as JArray??new JArray()).OfType<JObject>())
                    {
                        string siteId=(string)site["id"];
                        float sx=(float)site["x"],sz=(float)site["z"];
                        float yaw=(float?)site["rotationY"]??0;
                        Quaternion rotation=Quaternion.Euler(0,yaw,0);
                        Vector3 SitePoint(float x,float z)
                        {
                            Vector3 at=new Vector3(sx,0,sz)+rotation*new Vector3(x,0,z);
                            at.y=captureTerrain.Height(at.x,at.z,id+"/site-focus").Value+1;
                            return at;
                        }
                        camera.orthographic=true;camera.orthographicSize=Mathf.Max((float)site["halfX"],(float)site["halfZ"])*1.3f;
                        camera.transform.rotation=Quaternion.Euler(78,-32,0);
                        camera.transform.position=SitePoint(0,0)-camera.transform.forward*100;
                        KromkaSceneShot.Capture(camera,Path.Combine(output,siteId+"-terrain-desktop.png"),1280,720);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,siteId+"-terrain-mobile.png"),844,390);
                        string layoutFile=new[]{"site-layouts","facility-layouts"}.Select(folder=>Path.Combine(repository,"data/kromka/"+folder,siteId+".json")).FirstOrDefault(File.Exists);
                        if(layoutFile!=null)
                        {
                            JObject layout=JObject.Parse(File.ReadAllText(layoutFile));
                            foreach(JObject view in (layout["viewpoints"] as JArray??new JArray()).OfType<JObject>())
                                focusPoints.Add((siteId+"-"+(string)view["label"],SitePoint((float?)view["x"]??0,(float?)view["z"]??0),yaw));
                            if(layout.Value<string>("schema")=="roa.facilityExterior.v1")
                            {
                                focusPoints.Add((siteId+"-entry",SitePoint(0,-(float)site["halfZ"]+4),yaw));
                                focusPoints.Add((siteId+"-purpose",SitePoint(-(float)site["halfX"]+9,5),yaw));
                            }
                        }
                    }
                    if(p.locationId!=p.zoneId)
                    {
                        JObject bankNpc=((JArray)authored["objects"]).OfType<JObject>().Single(row=>row.Value<string>("id")=="auctioneer");
                        float x=bankNpc["position"].Value<float>("x"),z=bankNpc["position"].Value<float>("z");
                        var savedTerrain=new CaptureTerrain(location,p);
                        focusPoints.Add(("city-bank",new Vector3(x,savedTerrain.Height(x,z,id+"/city-bank").Value+1,z),0));
                    }
                    if(p.visibleShore!=null && p.visibleShore.Length>0)
                    {
                        RoaSectorSurface.Edge bank=p.visibleShore[p.visibleShore.Length/2];
                        float x=(bank.a.x+bank.b.x)*.5f,z=(bank.a.z+bank.b.z)*.5f;
                        focusPoints.Add(("shore",new Vector3(x,RoaSectorSurface.Height(p,Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey),x,z),z),0));
                    }
                    int visibleBridgeIndex=0;
                    foreach(RoaSectorSurface.Route bridge in p.bridges)
                    {
                        var visible=(bridge.points?.Length>1?bridge.points:new[]{bridge.a,bridge.b}).Where(v=>Mathf.Abs(v.x)<=p.width/2 && Mathf.Abs(v.z)<=p.depth/2).ToArray();
                        if(visible.Length==0)continue;
                        var center=visible[visible.Length/2];
                        float x=center.x,z=center.z;
                        string bridgeLabel=visibleBridgeIndex==0?"bridge":"bridge-"+visibleBridgeIndex;
                        focusPoints.Add((bridgeLabel,new Vector3(x,RoaSectorSurface.BridgeHeight(bridge,x,z),z),0));
                        visibleBridgeIndex++;
                    }
                    foreach(var focus in focusPoints)
                    {
                        bool authoredBankRoof=(authored["objects"] as JArray)?.OfType<JObject>()
                            .Any(row=>row.Value<string>("id")=="city_bank_roof")==true;
                        using(var roofScope=focus.label=="city-bank" && authoredBankRoof
                            ? new CityRoofCaptureScope(camera,new CaptureTerrain(location,p),p,location,definition,authored,id+"/city-bank") : null)
                        {
                        camera.orthographic=false;camera.fieldOfView=52;camera.transform.rotation=Quaternion.Euler(55,45+focus.yaw,0);
                        var pointGeometry=new[]{new CaptureGeometry {bounds=new Bounds(focus.point,new Vector3(1f,.5f,1f))}};
                        object gameEye=PlaceFocusCamera(camera,captureTerrain,focus.point,pointGeometry,55,45+focus.yaw,21.5f,id+"/"+focus.label);
                        roofScope?.Update();
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+focus.label+"-game.png"),1280,720);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+focus.label+"-game-mobile.png"),844,390);
                        if(focus.label=="spawn"&&Environment.GetEnvironmentVariable("ROA_CAPTURE_GROUND_DIAGNOSTIC")=="1")
                            CaptureGroundDiagnostic(camera,location,output,id);
                        camera.orthographic=false;camera.fieldOfView=50;camera.transform.rotation=Quaternion.Euler(25,-28+focus.yaw,0);
                        object lowEye=PlaceFocusCamera(camera,captureTerrain,focus.point,pointGeometry,25,-28+focus.yaw,32,id+"/"+focus.label);
                        basicCameraReports.Add(new {label=focus.label,target=new[]{focus.point.x,focus.point.y,focus.point.z},gameEye,lowEye,terrainSource="saved MeshCollider",sceneSaved=false});
                        roofScope?.Update();
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+focus.label+"-low.png"),1280,720);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+focus.label+"-low-mobile.png"),844,390);
                        if(focus.label=="bridge" && Environment.GetEnvironmentVariable("ROA_SECTOR_ISOLATE_BRIDGE")=="1")
                        {
                            // Diagnostic only: distinguish hidden geometry from
                            // a missing face without changing the saved scene.
                            var rendered=location.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled).ToArray();
                            foreach(var renderer in rendered)renderer.enabled=renderer.name.StartsWith("BridgeStructure_",StringComparison.Ordinal)||renderer.name.StartsWith("BridgeHandrails_",StringComparison.Ordinal);
                            camera.fieldOfView=52;camera.transform.rotation=Quaternion.Euler(55,45+focus.yaw,0);
                            camera.transform.position=focus.point-camera.transform.forward*21.5f;
                            KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-bridge-structure-isolated.png"),1280,720);
                            File.WriteAllText(Path.Combine(output,id+"-bridge-structure-geometry.json"),JsonConvert.SerializeObject(rendered.Where(r=>r.enabled).Select(r=>new {
                                r.name,vertices=r.GetComponent<MeshFilter>().sharedMesh.vertices.Select(v=>r.transform.TransformPoint(v)).Select(v=>new[]{v.x,v.y,v.z}),triangles=r.GetComponent<MeshFilter>().sharedMesh.triangles,
                                eye=new[]{camera.transform.position.x,camera.transform.position.y,camera.transform.position.z},focus=new[]{focus.point.x,focus.point.y,focus.point.z}
                            })));
                            foreach(var renderer in rendered)renderer.enabled=true;
                        }
                        if(roofScope!=null)
                            File.WriteAllText(Path.Combine(output,id+"-city-bank-runtime-report.json"),JsonConvert.SerializeObject(new {
                                savedOnly,projectedDuringCapture=false,runtimeRoofCutaway=true,anchor="auctioneer",targetMarker="bank_counter",
                                actualPlayerPosition=new[]{roofScope.ActualPlayerPosition.x,roofScope.ActualPlayerPosition.y,roofScope.ActualPlayerPosition.z},
                                roofScope.WalkedWaypoints,npcInstantiated=false,sceneSaved=false},Formatting.Indented));
                        }
                    }
                    CaptureExtraFoci(camera,p,location,definition,authored,output);
                    int railIndex=0;
                    foreach(var rail in (p.railInfrastructure??Array.Empty<RoaSectorSurface.RailInfrastructure>()).Where(r=>!r.foreign))
                    {
                        foreach(var span in rail.spans)
                        {
                            int middle=(span.fromIndex+span.toIndex)/2;
                            var at=rail.points[middle];var before=rail.points[Mathf.Max(0,middle-1)];var after=rail.points[Mathf.Min(rail.points.Length-1,middle+1)];
                            Vector3 forward=new Vector3(after.x-before.x,0,after.z-before.z).normalized;
                            if(span.kind=="tunnel")
                            {
                                RailShot($"rail-{railIndex}-bore-{middle}",at.Vector+Vector3.up*1.9f,at.Vector+forward*12+Vector3.up*1.9f);
                                if(span.portalStart)PortalShot(span.fromIndex,1);
                                if(span.portalEnd)PortalShot(span.toIndex,-1);
                            }
                            if(span.kind=="viaduct")
                            {
                                Vector3 side=new Vector3(-forward.z,0,forward.x);
                                float soil=RoaSectorSurface.Height(p,Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey),at.x,at.z,true,false);
                                RailShot($"rail-{railIndex}-viaduct-base-{middle}",new Vector3(at.x,soil+7,at.z)+side*14-forward*8,new Vector3(at.x,soil+1,at.z));
                                RailShot($"rail-{railIndex}-viaduct-deck-{middle}",at.Vector+side*10-forward*8+Vector3.up*4,at.Vector);
                            }
                            void PortalShot(int index,int direction)
                            {
                                var portal=rail.points[index];var neighbour=rail.points[Mathf.Clamp(index+direction,0,rail.points.Length-1)];
                                Vector3 into=(neighbour.Vector-portal.Vector).normalized;
                                RailShot($"rail-{railIndex}-portal-{index}",portal.Vector-into*15+Vector3.up*3,portal.Vector+into*4+Vector3.up*2.4f);
                            }
                        }
                        railIndex++;
                    }
                    void RailShot(string label,Vector3 eye,Vector3 target)
                    {
                        camera.orthographic=false;camera.fieldOfView=58;camera.transform.position=eye;camera.transform.LookAt(target);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+label+"-desktop.png"),1280,720);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-"+label+"-mobile.png"),844,390);
                    }
                    File.WriteAllText(Path.Combine(output,id+"-basic-camera-report.json"),JsonConvert.SerializeObject(basicCameraReports,Formatting.Indented));
                    Mesh ground=location.GroundRenderer.GetComponent<MeshFilter>().sharedMesh;
                    CheckCoverSeams(location);
                    if(ground==null || ground.vertices.Any(v=>float.IsNaN(v.y)||float.IsInfinity(v.y)))
                        throw new InvalidOperationException("Invalid ground vertices "+id);
                    Physics.SyncTransforms();
                    Collider collider=location.GroundRenderer.GetComponent<MeshCollider>();
                    var probes=new List<object>();
                    for(int z=-2;z<=2;z++)for(int x=-2;x<=2;x++)
                    {
                        float px=x*p.width*.2f,pz=z*p.depth*.2f;
                        bool found=collider.Raycast(new Ray(new Vector3(px,500,pz),Vector3.down),out RaycastHit hit,1000);
                        foreach(var cover in location.GetComponentsInChildren<MeshCollider>().Where(c=>c.name==RoaSectorRailInfrastructure.CoverName))
                            if(cover.Raycast(new Ray(new Vector3(px,500,pz),Vector3.down),out RaycastHit roof,1000) && (!found||roof.point.y>hit.point.y)){hit=roof;found=true;}
                        if(!found)
                            throw new InvalidOperationException("Ground collision hole "+id);
                        probes.Add(new {x=px,z=pz,height=RoaSectorSurface.Height(p,Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey),px,pz),collisionHeight=hit.point.y});
                    }
                    var outside=location.GetComponentsInChildren<MeshRenderer>().Where(r=>r.bounds.min.x< -p.width/2-.1f || r.bounds.max.x>p.width/2+.1f || r.bounds.min.z< -p.depth/2-.1f || r.bounds.max.z>p.depth/2+.1f)
                        .Select(r=>new {name=r.name,material=r.sharedMaterial?.name,position=r.transform.position.ToString(),bounds=r.bounds.ToString(),marker=r.GetComponentInParent<KromkaPlacedObjectAuthoring>()?.StableObjectId}).ToArray();
                    reports.Add(new {id,p.zoneId,p.width,p.depth,sourceHash,savedOnly,diagnosticOnly=diagnosticPreview,previewCatalogue=diagnosticPreview?previewInput:null,projectedDuringCapture=!savedOnly,vertices=ground.vertexCount,waterTriangles=p.waterIndices.Length/3,probes,outside});
                    Debug.Log("[SECTOR SURFACE PREVIEW] Captured "+id);
                }
                File.WriteAllText(Path.Combine(output,"probe-report.json"),JsonConvert.SerializeObject(reports,Formatting.Indented));
                Debug.Log(diagnosticPreview
                    ? "[SECTOR SURFACE DIAGNOSTIC] Captured saved candidate geometry and collision; published catalogue acceptance remains required."
                    : "[SECTOR SURFACE PREVIEW] PASS: finite ground, collision samples, actual Unity renders. Gameplay approval remains a separate gate.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static void CaptureGroundDiagnostic(Camera camera,RoaUnityLocationScene location,string output,string id)
        {
            Renderer ground=location.GroundRenderer;
            Material[] original=ground.sharedMaterials;
            var lights=Object.FindObjectsByType<Light>(FindObjectsSortMode.None);
            var shadows=lights.Select(light=>light.shadows).ToArray();
            var flat=new Material(Shader.Find("Universal Render Pipeline/Lit")){color=new Color(.45f,.45f,.45f)};
            var macro=new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            var grain=new Material(original[0]);
            try
            {
                foreach(var light in lights)light.shadows=LightShadows.None;
                ground.sharedMaterial=flat;
                KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-ground-diagnostic-flat-lit.png"),1280,720);
                if(original[0].HasProperty("_BaseMap"))macro.SetTexture("_BaseMap",original[0].GetTexture("_BaseMap"));
                macro.SetColor("_BaseColor",Color.white);ground.sharedMaterial=macro;
                KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-ground-diagnostic-macro-unlit.png"),1280,720);
                grain.SetFloat("_MacroStrength",0);grain.SetFloat("_NormalStrength",0);
                grain.SetTexture("_SurfaceMask",Texture2D.blackTexture);grain.SetTexture("_RiverBankMask",Texture2D.blackTexture);
                foreach(string property in new[]{"_Wetness","_Mud","_Puddles"})if(grain.HasProperty(property))grain.SetFloat(property,0);
                ground.sharedMaterial=grain;
                KromkaSceneShot.Capture(camera,Path.Combine(output,id+"-ground-diagnostic-grain-only.png"),1280,720);
            }
            finally
            {
                ground.sharedMaterials=original;
                for(int i=0;i<lights.Length;i++)lights[i].shadows=shadows[i];
                Object.DestroyImmediate(flat);Object.DestroyImmediate(macro);Object.DestroyImmediate(grain);
            }
            if(!ground.sharedMaterials.SequenceEqual(original)||lights.Where((light,i)=>light.shadows!=shadows[i]).Any())
                throw new InvalidOperationException("Diagnostic ground or lighting state not restored");
            File.WriteAllText(Path.Combine(output,id+"-ground-diagnostic.json"),JsonConvert.SerializeObject(new {
                diagnosticOnly=true,sceneSaved=false,meshChanged=false,stateRestored=true,
                flatLit="Actual mesh normals, uniform lit colour, no texture or shadows",
                macroUnlit="Actual saved macro albedo, no lighting",
                grainOnly="Actual stochastic texture phase, no macro, normal map, masks or shadows"
            },Formatting.Indented));
        }

        private static void CaptureExtraFoci(Camera camera,RoaSectorSurface.Profile profile,RoaUnityLocationScene location,LocationDefinition definition,JObject authored,string output)
        {
            string file=Environment.GetEnvironmentVariable("ROA_SECTOR_CAPTURE_FOCI");
            if(string.IsNullOrWhiteSpace(file))return;
            var markers=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                .Where(m=>m.gameObject.activeInHierarchy).ToArray();
            Physics.SyncTransforms();
            var terrain=new CaptureTerrain(location,profile);
            var oil=location.GetComponentsInChildren<RoaOilExtraction>(true).Where(e=>e.gameObject.activeInHierarchy).ToArray();
            var reports=new List<object>();
            foreach(JObject view in JArray.Parse(File.ReadAllText(file)).OfType<JObject>().Where(v=>v.Value<string>("zone")==profile.zoneId))
            {
                string label=view.Value<string>("label");
                if(string.IsNullOrWhiteSpace(label)||Path.GetFileName(label)!=label)throw new InvalidOperationException("Invalid capture focus label");
                var ids=(view["objectIds"] as JArray)?.Values<string>().ToArray();
                if(ids==null||ids.Length==0)throw new InvalidOperationException("Capture focus needs actual object IDs: "+label);
                string context=profile.locationId+"/"+label+" ["+string.Join(",",ids)+"]";
                var actual=ids.Select(id=>
                {
                    var found=markers.Where(m=>m.StableObjectId==id).ToArray();
                    if(found.Length!=1)throw new InvalidOperationException("Capture focus "+context+": marker "+id+" has "+found.Length+" active instances");
                    return found[0];
                }).ToArray();
                var geometry=actual.Select(marker=>
                {
                    // Extraction equipment is a saved sibling of its controller, not a child.
                    var renderers=marker.GetComponentsInChildren<MeshRenderer>(true)
                        .Concat(oil.Where(e=>e.StableObjectId==marker.StableObjectId&&e.LocationId==profile.locationId).SelectMany(e=>e.GetComponentsInChildren<MeshRenderer>(true)))
                        .Where(r=>r.enabled&&r.gameObject.activeInHierarchy&&r.GetComponent<MeshFilter>()?.sharedMesh!=null).Distinct().ToArray();
                    if(renderers.Length==0)throw new InvalidOperationException("Capture focus "+context+": no enabled mesh bounds for "+marker.StableObjectId);
                    Bounds bounds=renderers[0].bounds;foreach(var renderer in renderers.Skip(1))bounds.Encapsulate(renderer.bounds);
                    return new CaptureGeometry{marker=marker,bounds=bounds,renderers=renderers};
                }).ToArray();
                Bounds combined=geometry[0].bounds;foreach(var item in geometry.Skip(1))combined.Encapsulate(item.bounds);
                Vector3 center=combined.center;
                float? ground=terrain.Height(center.x,center.z,context);
                Vector3 target=new Vector3(center.x,Mathf.Max(center.y,(ground??center.y)+.25f),center.z);
                float yaw=view.Value<float?>("yaw")??0,distance=view.Value<float?>("distance")??30;
                if(distance<=0)throw new InvalidOperationException("Invalid capture distance: "+label);
                using(var roofScope=profile.locationId!=profile.zoneId&&label=="city-public-services"
                    ? new CityRoofCaptureScope(camera,terrain,profile,location,definition,authored,context) : null)
                {
                camera.orthographic=false;camera.fieldOfView=52;
                object gameEye=PlaceFocusCamera(camera,terrain,target,geometry,55,45+yaw,distance,context);
                camera.ResetAspect();
                roofScope?.Update();
                KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-game.png"),1280,720);
                KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-game-mobile.png"),844,390);
                if(Environment.GetEnvironmentVariable("ROA_CAPTURE_SHADOW_DIAGNOSTIC")=="1"&&label=="protected-ground-contact")
                {
                    var lights=Object.FindObjectsByType<Light>(FindObjectsSortMode.None);
                    var shadows=lights.Select(light=>light.shadows).ToArray();
                    try
                    {
                        foreach(var light in lights)light.shadows=LightShadows.None;
                        KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-game-without-shadows.png"),1280,720);
                        KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-game-without-shadows-mobile.png"),844,390);
                    }
                    finally{for(int i=0;i<lights.Length;i++)lights[i].shadows=shadows[i];}
                    if(lights.Where((light,i)=>light.shadows!=shadows[i]).Any())throw new InvalidOperationException("Diagnostic shadow state not restored");
                    File.WriteAllText(Path.Combine(output,profile.locationId+"-shadow-diagnostic.json"),JsonConvert.SerializeObject(new {label,diagnosticOnly=true,sceneSaved=false,meshChanged=false,materialChanged=false,lights=lights.Select((light,i)=>new {light.name,restored=light.shadows==shadows[i]})},Formatting.Indented));
                }
                camera.fieldOfView=50;
                object lowEye=PlaceFocusCamera(camera,terrain,target,geometry,25,-28+yaw,distance*1.4f,context);
                camera.ResetAspect();
                roofScope?.Update();
                KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-low.png"),1280,720);
                KromkaSceneShot.Capture(camera,Path.Combine(output,profile.locationId+"-"+label+"-low-mobile.png"),844,390);
                reports.Add(new {label,center=new[]{center.x,center.y,center.z},groundHeight=ground,target=new[]{target.x,target.y,target.z},gameEye,lowEye,
                    terrainSource="saved MeshCollider",focusSource="enabled MeshRenderer.bounds",
                    runtimeRoofCutaway=roofScope!=null,playerAnchor=roofScope!=null?"auctioneer":null,
                    actualPlayerPosition=roofScope!=null?new[]{roofScope.ActualPlayerPosition.x,roofScope.ActualPlayerPosition.y,roofScope.ActualPlayerPosition.z}:null,
                    walkedWaypoints=roofScope?.WalkedWaypoints??0,npcInstantiated=false,sceneSaved=false,
                    markers=geometry.Select(g=>new {id=g.marker.StableObjectId,position=new[]{g.marker.transform.position.x,g.marker.transform.position.y,g.marker.transform.position.z},
                        groundHeight=terrain.Height(g.marker.transform.position.x,g.marker.transform.position.z,context),
                        boundsCenter=new[]{g.bounds.center.x,g.bounds.center.y,g.bounds.center.z},boundsSize=new[]{g.bounds.size.x,g.bounds.size.y,g.bounds.size.z},
                        renderers=g.renderers.Select(r=>r.name).ToArray()})});
                }
            }
            File.WriteAllText(Path.Combine(output,profile.locationId+"-focus-report.json"),JsonConvert.SerializeObject(reports,Formatting.Indented));
        }
        // Editor capture only: no Painter, projection, authored changes or Save.
        // The scene is the saved scene; roof presentation is the real runtime component.
        private sealed class CityRoofCaptureScope : IDisposable
        {
            private readonly GameObject host, playerObject;
            private readonly RoaRoofCutaway cutaway;
            private readonly RoaPlayerController player;
            private readonly KromkaPlacedObjectAuthoring bankRoof;
            private readonly Renderer[] savedRenderers;
            private readonly Material[][] savedMaterials;
            private readonly ShadowCastingMode[] savedShadows;
            private readonly bool[] savedReceiveShadows;
            private readonly Camera camera;
            private readonly RoaCameraRig rig;
            private readonly bool ownsRig;
            private readonly HashSet<string> runtimeRoofIds;
            private readonly HashSet<Renderer> cameraOnlyRenderers=new HashSet<Renderer>();
            public readonly Vector3 ActualPlayerPosition;
            public readonly int WalkedWaypoints;

            public CityRoofCaptureScope(Camera view, CaptureTerrain terrain,
                RoaSectorSurface.Profile profile, RoaUnityLocationScene location,
                LocationDefinition definition, JObject authored, string context)
            {
                camera = view;
                var npc = (authored["objects"] as JArray)?.OfType<JObject>()
                    .SingleOrDefault(row => row.Value<string>("id") == "auctioneer");
                if (npc?["entity"]?.Value<string>("kind") != "npc"
                    || npc["entity"].Value<string>("service") != "auction"
                    || !(npc["tags"] as JArray).Values<string>().Contains("city-bank"))
                    throw new InvalidOperationException(context + ": missing canonical bank service anchor");
                Vector2 anchor = new Vector2(npc["position"].Value<float>("x"), npc["position"].Value<float>("z"));
                var spawn = authored["spawn"] as JObject;
                if (spawn == null) throw new InvalidOperationException(context + ": no city spawn");
                Vector2 start = new Vector2(spawn.Value<float>("x"), spawn.Value<float>("z"));
                var markers = location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
                bankRoof = markers.Single(m => m.StableObjectId == "city_bank_roof");
                runtimeRoofIds = new HashSet<string>(definition.Objects.Where(row =>
                    row.Tags != null && row.Tags.Any(tag => tag == "roof-cutaway" || tag == "trader-cutaway")
                    || row.Occlusion != null && (bool?)row.Occlusion["cutaway"] == true).Select(row => row.Id));
                savedRenderers = location.GetComponentsInChildren<Renderer>(true);
                savedMaterials = savedRenderers.Select(r => r.sharedMaterials).ToArray();
                savedShadows = savedRenderers.Select(r => r.shadowCastingMode).ToArray();
                savedReceiveShadows = savedRenderers.Select(r => r.receiveShadows).ToArray();
                foreach(Renderer renderer in savedRenderers)
                {
                    var marker=renderer.GetComponentInParent<KromkaPlacedObjectAuthoring>();
                    var entry=marker==null?null:definition.Objects.FirstOrDefault(row=>row.Id==marker.StableObjectId);
                    // Exact authored renderer selection uses the production runtime API.
                    // Other renderers under the same root remain permanent-state guards.
                    if(RoaRoofCutaway.IsCameraCutawayRenderer(entry,renderer))cameraOnlyRenderers.Add(renderer);
                }

                // Same real collider grid/CC approach as RoaCityInteractionProbe,
                // but sample the saved MeshCollider rather than recreating terrain.
                const int size = 151;
                const float half = 75;
                float radius = RoaPlayerController.AuthoritativeCollisionRadius;
                var open = new bool[size * size];
                var heights = new float[open.Length];
                Vector2 Point(int i) => new Vector2(i % size - half, i / size - half);
                for (int i = 0; i < open.Length; i++)
                {
                    Vector2 at = Point(i);
                    float h = terrain.Height(at.x, at.y, context)
                        ?? throw new InvalidOperationException(context + ": missing saved ground");
                    heights[i] = h;
                    open[i] = !RoaSectorSurface.IsWaterAt(profile, at.x, at.y, radius)
                        && !Physics.CheckCapsule(new Vector3(at.x, h + radius + .08f, at.y),
                            new Vector3(at.x, h + RoaGameBootstrap.PlayerHeight - radius, at.y),
                            radius, ~0, QueryTriggerInteraction.Ignore);
                }
                int first = Enumerable.Range(0, open.Length).Where(i => open[i])
                    .OrderBy(i => (Point(i) - start).sqrMagnitude).First();
                if (Vector2.Distance(Point(first), start) > 2)
                    throw new InvalidOperationException(context + ": saved city spawn blocked");
                var parent = Enumerable.Repeat(-1, open.Length).ToArray();
                parent[first] = first;
                var queue = new Queue<int>(); queue.Enqueue(first);
                while (queue.Count > 0)
                {
                    int i = queue.Dequeue(), x = i % size, z = i / size;
                    for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = x + dx, nz = z + dz;
                        if (dx == 0 && dz == 0 || nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                        int next = nz * size + nx;
                        if (!open[next] || parent[next] >= 0) continue;
                        if (dx != 0 && dz != 0 && (!open[z * size + nx] || !open[nz * size + x])) continue;
                        if (Mathf.Abs(heights[next] - heights[i]) > .7f * Mathf.Sqrt(dx * dx + dz * dz)) continue;
                        parent[next] = i; queue.Enqueue(next);
                    }
                }
                int end = Enumerable.Range(0, parent.Length).Where(i => parent[i] >= 0)
                    .OrderBy(i => (Point(i) - anchor).sqrMagnitude).First();
                if (Vector2.Distance(Point(end), anchor) > 1.5f)
                    throw new InvalidOperationException(context + ": bank interaction not reachable from saved spawn");
                var path = new List<int>();
                for (int i = end; ; i = parent[i]) { path.Add(i); if (i == first) break; }
                path.Reverse();
                playerObject = new GameObject("CaptureActualBankPlayer");
                host = new GameObject("CaptureActualBankRoofRuntime");
                try
                {
                    Vector2 initial = Point(first);
                    playerObject.transform.position = new Vector3(initial.x,
                        heights[first] + RoaGameBootstrap.PlayerHeight / 2, initial.y);
                    var body = playerObject.AddComponent<CharacterController>();
                    body.height = RoaGameBootstrap.PlayerHeight; body.center = Vector3.zero;
                    RoaPlayerController.ConfigureAuthoritativeCollision(body);
                    Physics.SyncTransforms();
                    foreach (int i in path.Skip(1))
                    {
                        Vector2 next = Point(i);
                        for (int step = 0; step < 40; step++)
                        {
                            Vector2 delta = next - new Vector2(playerObject.transform.position.x, playerObject.transform.position.z);
                            if (delta.magnitude < .12f) break;
                            delta = delta.normalized * Mathf.Min(.12f, delta.magnitude);
                            body.Move(new Vector3(delta.x, -.04f, delta.y));
                        }
                        if (Vector2.Distance(new Vector2(playerObject.transform.position.x, playerObject.transform.position.z), next) > .4f)
                            throw new InvalidOperationException(context + ": actual bank walk blocked at " + playerObject.transform.position);
                    }
                    ActualPlayerPosition = playerObject.transform.position;
                    WalkedWaypoints = path.Count;
                    player = playerObject.AddComponent<RoaPlayerController>(); player.enabled = false;
                    var loader = host.AddComponent<RoaLocationLoader>();
                    var roots = (Dictionary<string, GameObject>)typeof(RoaLocationLoader)
                        .GetField("_objectRoots", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                        .GetValue(loader);
                    foreach (var marker in markers) roots[marker.StableObjectId] = marker.gameObject;
                    rig = camera.GetComponent<RoaCameraRig>();
                    if (rig == null) { rig = camera.gameObject.AddComponent<RoaCameraRig>(); ownsRig = true; }
                    rig.enabled = false; rig.ZoomPersistenceEnabled = false;
                    cutaway = host.AddComponent<RoaRoofCutaway>();
                    cutaway.Configure(null, rig); cutaway.SetPlayer(player); cutaway.Build(definition, loader);
                }
                catch { Dispose(); throw; }
            }

            public void Update()
            {
                // Force the normal interval only; never force opacity or renderer enablement.
                cutaway.SetPlayer(player);
                typeof(RoaRoofCutaway).GetMethod("LateUpdate",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(cutaway, null);
                if (cutaway.FadedCount < 1 || bankRoof.GetComponentsInChildren<Renderer>(true)
                    .Any(r => r.sharedMaterials.Any(m => m != null && m.HasProperty("_BaseColor")
                        && m.GetColor("_BaseColor").a > RoaRoofCutaway.CutawayOpacity + .01f)))
                    throw new InvalidOperationException("Actual runtime bank roof still hides the service");
                AssertUnchanged(false);
            }

            private void AssertUnchanged(bool all)
            {
                for (int i = 0; i < savedRenderers.Length; i++)
                {
                    var r = savedRenderers[i];
                    var marker = r.GetComponentInParent<KromkaPlacedObjectAuthoring>();
                    bool roof = marker != null && runtimeRoofIds.Contains(marker.StableObjectId);
                    if (!all && (roof || cameraOnlyRenderers.Contains(r))) continue;
                    if (!r.sharedMaterials.SequenceEqual(savedMaterials[i]) || r.shadowCastingMode != savedShadows[i]
                        || r.receiveShadows != savedReceiveShadows[i])
                        throw new InvalidOperationException("Capture runtime changed permanent material/shadow state: " + r.name);
                }
            }

            public void Dispose()
            {
                if (cutaway != null) { cutaway.Clear(); AssertUnchanged(true); }
                if (host != null) Object.DestroyImmediate(host);
                if (playerObject != null) Object.DestroyImmediate(playerObject);
                if (ownsRig && rig != null) Object.DestroyImmediate(rig);
            }
        }

        private sealed class CaptureGeometry
        {
            public KromkaPlacedObjectAuthoring marker;
            public Bounds bounds;
            public MeshRenderer[] renderers;
        }
        private sealed class CaptureTerrain
        {
            private readonly MeshCollider[] colliders;
            private readonly RoaSectorSurface.Profile profile;
            private readonly float top,bottom;
            private readonly Dictionary<Vector2,float?> heights=new Dictionary<Vector2,float?>();
            public CaptureTerrain(RoaUnityLocationScene location,RoaSectorSurface.Profile p)
            {
                profile=p;
                MeshCollider ground=location.GroundRenderer.GetComponent<MeshCollider>();
                if(ground==null||!ground.enabled||ground.sharedMesh==null)throw new InvalidOperationException("Missing saved terrain collider "+p.locationId);
                colliders=new[]{ground}.Concat(location.GetComponentsInChildren<MeshCollider>(true)
                    .Where(c=>c.name==RoaSectorRailInfrastructure.CoverName&&c.enabled&&c.gameObject.activeInHierarchy&&c.sharedMesh!=null)).Distinct().ToArray();
                top=colliders.Max(c=>c.bounds.max.y)+100;bottom=colliders.Min(c=>c.bounds.min.y)-100;
            }
            public float? Height(float x,float z,string context)
            {
                var key=new Vector2(x,z);if(heights.TryGetValue(key,out float? cached))return cached;
                var ray=new Ray(new Vector3(x,top,z),Vector3.down);float? height=null;
                foreach(var collider in colliders)if(collider.Raycast(ray,out RaycastHit hit,top-bottom))height=Mathf.Max(height??hit.point.y,hit.point.y);
                if(!height.HasValue&&Mathf.Abs(x)<profile.width/2-.001f&&Mathf.Abs(z)<profile.depth/2-.001f)
                    throw new InvalidOperationException("Capture focus "+context+": no saved terrain hit at "+x+","+z);
                heights[key]=height;return height;
            }
            public bool Blocks(Vector3 eye,Vector3 point,out string blocker)
            {
                Vector3 direction=point-eye;float length=direction.magnitude;
                foreach(var collider in colliders)if(collider.Raycast(new Ray(eye,direction.normalized),out RaycastHit hit,Mathf.Max(0,length-.05f)))
                {blocker=collider.name+" at "+hit.point;return true;}
                blocker=null;return false;
            }
        }
        private static object PlaceFocusCamera(Camera camera,CaptureTerrain terrain,Vector3 target,CaptureGeometry[] actual,float requestedPitch,float yaw,float distance,string context)
        {
            // Frame the narrower desktop aspect; Capture restores the actual PNG aspect.
            camera.aspect=1280f/720;
            Vector3 bestEye=Vector3.zero;float bestClearance=float.NegativeInfinity,bestPitch=0,bestYaw=0;
            string obstruction=null;
            var corners=actual.SelectMany(g=>BoundsCorners(g.bounds)).ToArray();
            float radius=corners.Max(point=>Vector3.Distance(target,point));
            float usedDistance=Mathf.Max(distance,radius/Mathf.Sin(camera.fieldOfView*Mathf.Deg2Rad*.5f)*1.08f);
            var sightTargets=actual.SelectMany(g=>
            {
                float soil=terrain.Height(g.bounds.center.x,g.bounds.center.z,context)??g.bounds.min.y;
                Vector3 body=g.bounds.center;body.y=Mathf.Max(body.y,soil+.25f);
                return new[]{body,new Vector3(body.x,Mathf.Max(g.bounds.min.y+.25f,soil+.25f),body.z)};
            }).ToArray();
            foreach(float pitch in new[]{requestedPitch,Mathf.Max(requestedPitch,40),Mathf.Max(requestedPitch,55),70f,82f}.Distinct())
            {
                foreach(float turn in new[]{0f,90f,-90f,180f,45f,-45f,135f,-135f})
                {
                    Vector3 eye=target-(Quaternion.Euler(pitch,yaw+turn,0)*Vector3.forward)*usedDistance;
                    float? eyeGround=terrain.Height(eye.x,eye.z,context);
                    float clearance=eyeGround.HasValue?eye.y-eyeGround.Value-1:float.PositiveInfinity;
                    foreach(Vector3 point in sightTargets)
                    {
                        int count=Mathf.Max(1,Mathf.CeilToInt(Vector3.Distance(eye,point)*2));
                        for(int i=0;i<=count;i++)
                        {
                            Vector3 sample=Vector3.Lerp(eye,point,(float)i/count);
                            float? sampleGround=terrain.Height(sample.x,sample.z,context);
                            if(sampleGround.HasValue)clearance=Mathf.Min(clearance,sample.y-sampleGround.Value-.15f);
                        }
                        if(terrain.Blocks(eye,point,out string blocker)){clearance=Mathf.Min(clearance,-.001f);obstruction=blocker;}
                    }
                    camera.transform.position=eye;camera.transform.LookAt(target);
                    bool inFrame=corners.All(point=>{Vector3 v=camera.WorldToViewportPoint(point);return v.z>camera.nearClipPlane&&v.x>=.025f&&v.x<=.975f&&v.y>=.025f&&v.y<=.975f;});
                    if(!inFrame){clearance=float.NegativeInfinity;obstruction="enabled model bounds outside frame";}
                    if(clearance>bestClearance){bestClearance=clearance;bestEye=eye;bestPitch=pitch;bestYaw=yaw+turn;}
                    if(clearance>=0)break;
                }
                if(bestClearance>=0)break;
            }
            if(bestClearance<0)throw new InvalidOperationException("No terrain-clear, bounds-framed capture eye for "+context+"; best clearance "+bestClearance+"; "+obstruction);
            camera.transform.position=bestEye;camera.transform.LookAt(target);
            return new {position=new[]{bestEye.x,bestEye.y,bestEye.z},groundHeight=terrain.Height(bestEye.x,bestEye.z,context),
                requestedPitch,pitch=bestPitch,yaw=bestYaw,requestedDistance=distance,distance=usedDistance,minimumSightClearance=bestClearance,
                framedBounds=true,sightTargets=sightTargets.Select(v=>new[]{v.x,v.y,v.z}).ToArray()};
            IEnumerable<Vector3> BoundsCorners(Bounds b)
            {
                foreach(int x in new[]{-1,1})foreach(int y in new[]{-1,1})foreach(int z in new[]{-1,1})
                    yield return b.center+Vector3.Scale(b.extents,new Vector3(x,y,z));
            }
        }
        private static void CheckCoverSeams(RoaUnityLocationScene location)
        {
            var ground=location.GroundRenderer.GetComponent<MeshFilter>();
            var heightByVertex=new Dictionary<Vector2Int,float>();
            foreach(Vector3 local in ground.sharedMesh.vertices)
            {
                Vector3 point=ground.transform.TransformPoint(local);heightByVertex[Key(point)]=point.y;
            }
            foreach(var cover in location.GetComponentsInChildren<MeshFilter>(true).Where(m=>m.name==RoaSectorRailInfrastructure.CoverName))
            {
                Vector3[] vertices=cover.sharedMesh.vertices;int[] triangles=cover.sharedMesh.triangles;
                var edges=new Dictionary<(Vector2Int,Vector2Int),(int count,Vector3 a,Vector3 b)>();
                for(int i=0;i<triangles.Length;i+=3)for(int j=0;j<3;j++)
                {
                    Vector3 a=cover.transform.TransformPoint(vertices[triangles[i+j]]),b=cover.transform.TransformPoint(vertices[triangles[i+(j+1)%3]]);
                    Vector2Int ka=Key(a),kb=Key(b);bool order=ka.x<kb.x||ka.x==kb.x&&ka.y<=kb.y;var key=order?(ka,kb):(kb,ka);
                    edges.TryGetValue(key,out var row);edges[key]=(row.count+1,a,b);
                }
                float gap=0;int bad=0;
                foreach(var edge in edges.Values.Where(e=>e.count==1))foreach(Vector3 point in new[]{edge.a,edge.b})
                {
                    if(Mathf.Abs(point.x)>=location.GroundRenderer.bounds.extents.x-.001f || Mathf.Abs(point.z)>=location.GroundRenderer.bounds.extents.z-.001f)continue;
                    if(heightByVertex.TryGetValue(Key(point),out float h))
                    {
                        float delta=Mathf.Abs(point.y-h);gap=Mathf.Max(gap,delta);
                        if(delta>.01f && bad++<8)Debug.Log($"[RAIL COVER EDGE] {location.LocationId} at {point}, floor {h}, delta {delta}");
                    }
                }
                Debug.Log($"[RAIL COVER SEAM] {location.LocationId}: max gap {gap}, differing boundary vertices {bad}");
            }
            Vector2Int Key(Vector3 v)=>new Vector2Int(Mathf.RoundToInt(v.x*1000),Mathf.RoundToInt(v.z*1000));
        }
    }
}
