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
    /// <summary>Reloads the complete overview and captures actual desktop/mobile map detail.</summary>
    public static class RoaWorldSurfaceVisualProbe
    {
        public static void Run()
        {
            try
            {
                string output=Environment.GetEnvironmentVariable("ROA_WORLD_CAPTURE")
                    ??Path.GetFullPath(Path.Combine(Application.dataPath,"../../Build/WorldSectors"));
                Directory.CreateDirectory(output);
                var reports=new List<object>();
                var cameraReports=new List<object>();
                string requested=Environment.GetEnvironmentVariable("ROA_WORLD_CAPTURE_IDS");
                var selected=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                foreach(bool mobile in new[]{false,true})
                {
                    var scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
                    var authored=Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
                    var appearances=authored.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true);
                    if(appearances.Length!=197)throw new InvalidOperationException("Incomplete prepared world overview");
                    if(appearances.Any(a=>a.GetComponentsInChildren<Collider>(true).Length!=0))
                        throw new InvalidOperationException("Gameplay colliders copied into world overview");
                    var map=new GameObject("WorldSurfaceVisualProbe").AddComponent<RoaWorldMap3D>();
                    map.SetWorldSize(380,300);map.AttachForProbe(scene,authored,mobile);
                    string suffix=mobile?"mobile":"desktop";int width=mobile?844:1600,height=mobile?390:900;
                    map.FocusOn(new Vector2(190,150),40);map.SetView(0,70);
                    map.CaptureTo(Path.Combine(output,"world-overview-"+suffix+".png"),width,height);
                    File.WriteAllText(Path.Combine(output,"render-materials-"+suffix+".json"),JsonConvert.SerializeObject(
                        authored.GetComponentsInChildren<MeshRenderer>(false).Select(renderer=>new {
                            renderer.name,parent=renderer.transform.parent?.name,
                            center=new[]{renderer.bounds.center.x,renderer.bounds.center.y,renderer.bounds.center.z},
                            materials=renderer.sharedMaterials.Select(material=>new {
                                name=material?.name,path=material!=null?AssetDatabase.GetAssetPath(material):null,
                                shader=material?.shader?.name,supported=material?.shader!=null&&material.shader.isSupported,
                                shaderError=material?.shader!=null&&ShaderUtil.ShaderHasError(material.shader),
                                queue=material!=null?material.renderQueue:0,
                                tint=material!=null&&material.HasProperty("_BaseColor")?new[]{material.GetColor("_BaseColor").r,material.GetColor("_BaseColor").g,material.GetColor("_BaseColor").b,material.GetColor("_BaseColor").a}:null
                            })}),Formatting.None));
                    Vector3 eye=map.MapCamera.transform.position,scale=authored.transform.lossyScale;
                    cameraReports.Add(new {mobile,position=new[]{eye.x,eye.y,eye.z},rootScale=new[]{scale.x,scale.y,scale.z},sceneFogDensity=RenderSettings.fogDensity,effectiveFogDensity=RenderSettings.fogDensity/Mathf.Max(1,scale.x)});
                    int count=0;
                    foreach(var appearance in appearances.OrderBy(a=>a.name,StringComparer.Ordinal).Where(a=>selected==null||selected.Contains(a.name.Replace("_LocalAppearance",string.Empty))))
                    {
                        if(appearance.DesktopDetail.activeSelf==mobile || appearance.MobileDetail.activeSelf!=mobile)
                            throw new InvalidOperationException("Wrong overview detail "+appearance.name);
                        foreach(var renderer in appearance.GetComponentsInChildren<MeshRenderer>(false))
                        {
                            Mesh mesh=renderer.GetComponent<MeshFilter>()?.sharedMesh;
                            if(mesh==null||!AssetDatabase.Contains(mesh)||renderer.sharedMaterials.Any(m=>m==null||!AssetDatabase.Contains(m)))
                                throw new InvalidOperationException("Transient or missing overview geometry/material "+renderer.name);
                        }
                        Vector2 centre=(appearance.MapMin+appearance.MapMax)*.5f;
                        if(!appearance.TryHeight(centre,out float ground))throw new InvalidOperationException("Missing map picking surface "+appearance.name);
                        map.FocusOn(centre,2.5f);map.SetView(-25,58);
                        map.CaptureTo(Path.Combine(output,appearance.name+"-"+suffix+".png"),width,height);
                        if(Environment.GetEnvironmentVariable("ROA_WORLD_WATER_DIAGNOSTIC")=="1")
                        {
                            CaptureWithoutMineral(map,authored,Path.Combine(output,appearance.name+"-without-water-mineral-"+suffix+".png"),width,height);
                            CaptureWithoutAtmosphere(map,authored,Path.Combine(output,appearance.name+"-without-atmosphere-"+suffix+".png"),width,height);
                            CaptureWithoutMineral(map,authored,Path.Combine(output,appearance.name+"-flat-water-"+suffix+".png"),width,height,true);
                            WriteWaterRayDiagnostic(map,authored,Path.Combine(output,appearance.name+"-water-rays-"+suffix+".json"),width,height);
                        }
                        map.SetView(0,86);
                        map.CaptureTo(Path.Combine(output,appearance.name+"-top-"+suffix+".png"),width,height);
                        Vector3 screen=map.MapCamera.ViewportToScreenPoint(new Vector3(.5f,.5f,0));
                        if(!map.ScreenToPoint(screen,out Vector2 picked)||Vector2.Distance(picked,centre)>.1f)
                            throw new InvalidOperationException("Camera centre picking mismatch "+appearance.name);
                        reports.Add(new{appearance.name,mobile,ground,renderers=appearance.GetComponentsInChildren<MeshRenderer>(false).Length});
                        if(++count%10==0)Debug.Log("[WORLD VISUAL] "+suffix+" captured "+count);
                    }
                }
                File.WriteAllText(Path.Combine(output,"report.json"),JsonConvert.SerializeObject(reports,Formatting.Indented));
                File.WriteAllText(Path.Combine(output,"camera-report.json"),JsonConvert.SerializeObject(cameraReports,Formatting.Indented));
                Debug.Log("[WORLD VISUAL] PASS: saved 197 sector appearances; captured "+(reports.Count/2)+" selected sectors in both actual map detail modes, materials and point selection; visual critique remains required.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }

        private static void CaptureWithoutAtmosphere(RoaWorldMap3D map,RoaUnityGlobalMapScene authored,string output,int width,int height)
        {
            var originals=authored.GetComponentsInChildren<MeshRenderer>(false)
                .Where(r=>r.enabled&&r.sharedMaterials.Any(m=>m!=null&&m.shader.name.IndexOf("Fog",StringComparison.OrdinalIgnoreCase)>=0))
                .ToDictionary(r=>r,r=>r.enabled);
            try
            {
                foreach(var pair in originals)pair.Key.enabled=false;
                map.CaptureTo(output,width,height);
            }
            finally { foreach(var pair in originals)pair.Key.enabled=pair.Value; }
            if(originals.Any(pair=>pair.Key.enabled!=pair.Value))throw new InvalidOperationException("Diagnostic atmosphere state not restored");
            File.WriteAllText(Path.ChangeExtension(output,"json"),JsonConvert.SerializeObject(new {diagnosticOnly=true,sceneSaved=false,stateRestored=true,hidden=originals.Keys.Select(r=>r.name).ToArray()},Formatting.Indented));
        }

        private static void CaptureWithoutMineral(RoaWorldMap3D map,RoaUnityGlobalMapScene authored,string output,int width,int height,bool flat=false)
        {
            var renderers=authored.GetComponentsInChildren<MeshRenderer>(false);
            var originals=new Dictionary<MeshRenderer,Material[]>();
            var clones=new Dictionary<Material,Material>();
            try
            {
                foreach(var renderer in renderers)
                {
                    Material[] original=renderer.sharedMaterials;
                    if(!original.Any(m=>m!=null&&m.shader.name=="Realm of Ashes/Kromka Global Water"))continue;
                    originals.Add(renderer,original);
                    renderer.sharedMaterials=original.Select(material=>
                    {
                        if(material==null||material.shader.name!="Realm of Ashes/Kromka Global Water")return material;
                        if(!clones.TryGetValue(material,out Material copy))
                        {
                            copy=flat?new Material(Shader.Find("Universal Render Pipeline/Unlit")):new Material(material);
                            if(flat){copy.SetColor("_BaseColor",new Color(.03f,.32f,.62f,1));copy.SetFloat("_Cull",0);}
                            else copy.SetFloat("_MineralVeil",0);
                            clones.Add(material,copy);
                        }
                        return copy;
                    }).ToArray();
                }
                map.CaptureTo(output,width,height);
            }
            finally
            {
                foreach(var pair in originals)pair.Key.sharedMaterials=pair.Value;
                foreach(var copy in clones.Values)Object.DestroyImmediate(copy);
            }
            if(originals.Any(pair=>!pair.Key.sharedMaterials.SequenceEqual(pair.Value)))
                throw new InvalidOperationException("Diagnostic world water state not restored");
        }

        private static void WriteWaterRayDiagnostic(RoaWorldMap3D map,RoaUnityGlobalMapScene authored,string output,int width,int height)
        {
            var records=new List<object>();
            float aspect=map.MapCamera.aspect;map.MapCamera.aspect=width/(float)height;
            try
            {
            foreach(Vector2 pixel in new[]{new Vector2(.04f,.06f),new Vector2(.12f,.07f),new Vector2(.25f,.02f),new Vector2(.25f,.15f),new Vector2(.42f,.30f)})
            {
                Ray ray=map.MapCamera.ViewportPointToRay(new Vector3(pixel.x,pixel.y,0));
                var hits=new List<(float distance,MeshRenderer renderer,Mesh mesh,Vector3 point)>();
                foreach(var renderer in authored.GetComponentsInChildren<MeshRenderer>(false))
                {
                    if(!renderer.enabled||(map.MapCamera.cullingMask&(1<<renderer.gameObject.layer))==0||!renderer.bounds.IntersectRay(ray))continue;
                    Mesh mesh=renderer.GetComponent<MeshFilter>()?.sharedMesh;
                    if(mesh==null||!mesh.isReadable)continue;
                    Vector3[] vertices=mesh.vertices;int[] indices=mesh.triangles;
                    float nearest=float.PositiveInfinity;
                    for(int i=0;i<indices.Length;i+=3)
                    {
                        Vector3 a=renderer.transform.TransformPoint(vertices[indices[i]]),b=renderer.transform.TransformPoint(vertices[indices[i+1]]),c=renderer.transform.TransformPoint(vertices[indices[i+2]]);
                        Vector3 e1=b-a,e2=c-a,p=Vector3.Cross(ray.direction,e2);float det=Vector3.Dot(e1,p);
                        if(Mathf.Abs(det)<1e-9f)continue;
                        float inverse=1/det;Vector3 t=ray.origin-a;float u=Vector3.Dot(t,p)*inverse;
                        if(u<0||u>1)continue;
                        Vector3 q=Vector3.Cross(t,e1);float v=Vector3.Dot(ray.direction,q)*inverse;
                        if(v<0||u+v>1)continue;
                        float distance=Vector3.Dot(e2,q)*inverse;
                        if(distance>0&&distance<nearest)nearest=distance;
                    }
                    if(!float.IsPositiveInfinity(nearest))hits.Add((nearest,renderer,mesh,ray.GetPoint(nearest)));
                }
                records.Add(new {viewport=new[]{pixel.x,pixel.y},hits=hits.OrderBy(h=>h.distance).Take(6).Select(h=>new {
                    h.distance,name=h.renderer.name,parent=h.renderer.transform.parent?.name,mesh=AssetDatabase.GetAssetPath(h.mesh),
                    position=new[]{h.point.x,h.point.y,h.point.z},materials=h.renderer.sharedMaterials.Select(m=>m?.shader?.name+"/"+m?.name).ToArray()
                }).ToArray()});
            }
            }
            finally {map.MapCamera.aspect=aspect;}
            File.WriteAllText(output,JsonConvert.SerializeObject(new {diagnosticOnly=true,sceneSaved=false,width,height,records},Formatting.Indented));
        }
    }
}
