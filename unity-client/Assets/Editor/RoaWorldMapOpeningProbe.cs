#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaWorldMapOpeningProbe
    {
        const string Key = "RoaWorldMapOpeningProbe";
        static string Output => Environment.GetEnvironmentVariable("ROA_MAP_OPEN_OUT");
        static RoaWorldMapOpeningProbe()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state => {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode) EditorApplication.delayCall += () =>
                    new GameObject("MapOpeningProbe").AddComponent<RoaWorldMapOpeningProbeDriver>().Begin();
                if (state == PlayModeStateChange.EnteredEditMode)
                { SessionState.SetBool(Key, false); if (Application.isBatchMode) EditorApplication.Exit(SessionState.GetInt(Key+".exit", 1)); }
            };
        }
        public static void Run()
        {
            Directory.CreateDirectory(Output);
            EditorSceneManager.playModeStartScene = null;
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SessionState.SetBool(Key, true); SessionState.SetInt(Key+".exit", 1);
            EditorApplication.isPlaying = true;
        }
        internal static void Finish(Exception error, JObject report)
        {
            report["status"] = error == null ? "PASS" : "FAIL";
            if (error != null) { report["error"] = error.ToString(); Debug.LogError(error); }
            System.IO.File.WriteAllText(Path.Combine(Output, "report.json"), report.ToString());
            SessionState.SetInt(Key+".exit", error == null ? 0 : 1);
            EditorApplication.isPlaying = false;
        }
        internal static string File(string name) => Path.Combine(Output, name);
    }

    public sealed class RoaWorldMapOpeningProbeDriver : MonoBehaviour
    {
        readonly JObject report = new JObject();
        const BindingFlags Hidden = BindingFlags.NonPublic | BindingFlags.Instance;
        public void Begin() => StartCoroutine(Guard());
        IEnumerator Guard()
        {
            var stack = new Stack<IEnumerator>(); stack.Push(Audit());
            Exception error = null;
            while (stack.Count > 0)
            {
                object next = null; bool moved = false;
                try { moved = stack.Peek().MoveNext(); if (moved) next = stack.Peek().Current; }
                catch (Exception e) { error = e; break; }
                if (!moved) { stack.Pop(); continue; }
                if (next is IEnumerator nested) { stack.Push(nested); continue; }
                yield return next;
            }
            RoaWorldMapOpeningProbe.Finish(error, report);
        }
        IEnumerator Audit()
        {
            var local = new GameObject("MainCamera").AddComponent<Camera>(); local.tag = "MainCamera";
            local.cullingMask = ~(1<<RoaWorldMap3D.MapLayer); int mask = local.cullingMask;
            bool fog = RenderSettings.fog;
            var host = new GameObject("OverviewFixture");
            var overview = host.AddComponent<RoaWorldOverviewCanvas>(); overview.enabled = false;
            overview.ProbeSelf = JObject.Parse("{\"zone\":{\"id\":\"z_02_10\",\"u\":0.5,\"v\":0.5}}");
            typeof(RoaWorldOverviewCanvas).GetMethod("Start", Hidden).Invoke(overview, null);
            Require(overview.Map3D != null && !overview.Map3D.Ready && !overview.Map3D.IsLoading,
                "Startup must defer the 3D scene until the world map opens");
            report["startupDefers3D"] = true;
            var watch = System.Diagnostics.Stopwatch.StartNew();
            overview.OpenFor(overview.ProbeSelf); watch.Stop();
            report["coldOpenMilliseconds"] = watch.Elapsed.TotalMilliseconds;
            Require(overview.IsOpen && !overview.Uses3D, "Cold open must show usable terrain immediately");
            var canvas = host.GetComponentInChildren<Canvas>(true);
            var terrain = canvas.GetComponentsInChildren<RawImage>(true).First(x => x.name == "Map");
            Require(terrain.enabled && terrain.texture != null && terrain.texture.width > 500, "First-frame terrain missing");
            Require(!canvas.GetComponentsInChildren<Text>(true).Any(t => t.text.Contains("Загрузка карты")), "Loading placeholder remains");
            Require(local.cullingMask == mask && RenderSettings.fog == fog, "Preparation changed gameplay camera or fog");
            Capture(overview, canvas, "cold-desktop.png", 1280, 720);
            Capture(overview, canvas, "cold-mobile.png", 844, 390);
            overview.SelectForProbe("z_02_10");
            Require(overview.ZoneWindowOpen, "Baked overview cannot open zone cards");
            typeof(RoaWorldOverviewCanvas).GetMethod("CloseCard", Hidden).Invoke(overview, null);
            overview.Close();
            float deadline = Time.realtimeSinceStartup + 240;
            while (!overview.Map3D.Ready || overview.Map3D.IsLoading)
            { Require(Time.realtimeSinceStartup < deadline, "On-demand preparation timed out"); yield return null; }
            Require(!overview.IsOpen && !overview.Map3D.IsOpen && local.cullingMask == mask, "Close during preparation reopened the map");
            Camera camera = overview.Map3D.MapCamera;
            for (int i=0; i<3; i++)
            {
                watch.Restart(); overview.OpenFor(overview.ProbeSelf); watch.Stop();
                report["warmOpenMilliseconds"+i] = watch.Elapsed.TotalMilliseconds;
                Require(overview.Uses3D, "Prepared map did not open synchronously");
                Require(overview.Map3D.MapCamera == camera, "Reopening recreated the camera");
                if (i==0) { Capture(overview, canvas, "warm-desktop.png", 1280, 720); Capture(overview, canvas, "warm-mobile.png", 844, 390); }
                overview.Close();
                Require(overview.Map3D.Ready && overview.Map3D.HasZones && !overview.Map3D.IsLoading, "Close discarded the cache");
                Require(local.cullingMask == mask && RenderSettings.fog == fog, "Close did not restore gameplay");
                yield return null;
            }
            // The mobile close path uses the same cache policy even with reduced presentation.
            typeof(RoaWorldMap3D).GetField("_mobile", Hidden).SetValue(overview.Map3D, true);
            yield return overview.Map3D.Open(true); overview.Map3D.Close();
            Require(overview.Map3D.Ready && overview.Map3D.HasZones, "Mobile close unloaded prepared terrain");
            report["mobileRetainsScene"] = true;
            report["coldZoneCard"] = true;
            report["closeDuringPreparation"] = true;
            report["initialTerrainPixels"] = terrain.texture.width;
        }
        static void Capture(RoaWorldOverviewCanvas overview, Canvas canvas, string name, int width, int height)
        {
            const int layer = 29;
            var ui = new GameObject("CaptureUI").AddComponent<Camera>(); ui.enabled = false;
            ui.cullingMask = 1<<layer; ui.clearFlags = CameraClearFlags.SolidColor; ui.backgroundColor = Color.clear;
            ui.nearClipPlane = .1f; ui.farClipPlane = 100;
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            ui.targetTexture = target; ui.rect = new Rect(0,0,1,1);
            canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = ui; canvas.planeDistance = 10;
            foreach (Transform t in canvas.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
            Canvas.ForceUpdateCanvases();
            typeof(RoaWorldOverviewCanvas).GetMethod("Rebuild", Hidden).Invoke(overview, new object[]{overview.ProbeSelf});
            if (overview.Uses3D) typeof(RoaWorldOverviewCanvas).GetMethod("LayoutViewLabels", Hidden).Invoke(overview, null);
            Canvas.ForceUpdateCanvases();
            Color32[] background = overview.Uses3D ? Pixels(overview.Map3D.MapCamera, width, height) : null;
            Color32[] foreground = Pixels(ui, width, height);
            if(background!=null) for(int i=0;i<foreground.Length;i++) foreground[i]=Color32.Lerp(background[i],foreground[i],foreground[i].a/255f);
            var image=new Texture2D(width,height,TextureFormat.RGB24,false);image.SetPixels32(foreground);image.Apply();
            System.IO.File.WriteAllBytes(RoaWorldMapOpeningProbe.File(name),image.EncodeToPNG());
            DestroyImmediate(image); canvas.renderMode=RenderMode.ScreenSpaceOverlay;canvas.worldCamera=null;
            ui.targetTexture=null;DestroyImmediate(target);DestroyImmediate(ui.gameObject);
        }
        static Color32[] Pixels(Camera camera, int width, int height)
        {
            var target = new RenderTexture(width,height,24,RenderTextureFormat.ARGB32);
            var request = new UnityEngine.Rendering.Universal.UniversalRenderPipeline.SingleCameraRequest { destination=target };
            if(UnityEngine.Rendering.RenderPipeline.SupportsRenderRequest(camera,request)) UnityEngine.Rendering.RenderPipeline.SubmitRenderRequest(camera,request);
            else { camera.targetTexture=target;camera.Render();camera.targetTexture=null; }
            RenderTexture.active=target;var image=new Texture2D(width,height,TextureFormat.RGBA32,false);
            image.ReadPixels(new Rect(0,0,width,height),0,0);image.Apply();RenderTexture.active=null;
            Color32[] pixels=image.GetPixels32();DestroyImmediate(image);DestroyImmediate(target);return pixels;
        }
        static void Require(bool condition,string message) { if(!condition)throw new Exception(message); }
    }
}
#endif
