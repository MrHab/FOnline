#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Снимок заливки опасных клеток глобальной карты так, как её строит игра:
    /// открывает сцену KromkaGlobalMap, поднимает RoaGlobalMap, подаёт ему
    /// ответы /api/global-map и /api/wasteland, снятые с локального сервера в
    /// Library/AgentCaptures (global-map-public.json, wasteland-public.json), и
    /// вызывает его собственную сборку динамических слоёв. Снимки — там же.
    /// Сцена не сохраняется.
    /// </summary>
    public static class RoaGlobalMapDangerCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";

        [MenuItem("Realm of Ashes/Глобальная карта/Снимок заливки опасных клеток")]
        public static void Run()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new Exception("[DANGER SHOT] Есть несохранённая сцена (" + SceneManager.GetSceneAt(i).name + ").");

            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string captures = Path.Combine(projectRoot, "Library", "AgentCaptures");
            JObject mapPayload = JObject.Parse(File.ReadAllText(Path.Combine(captures, "global-map-public.json")));
            JObject wastelandPayload = JObject.Parse(File.ReadAllText(Path.Combine(captures, "wasteland-public.json")));
            JObject wasteland = wastelandPayload["sim"] as JObject ?? wastelandPayload;

            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var authored = UnityEngine.Object.FindAnyObjectByType<RoaUnityGlobalMapScene>();
            if (authored == null) throw new Exception("[DANGER SHOT] В сцене нет RoaUnityGlobalMapScene.");

            var host = new GameObject("DangerShotProbe_Temp");
            SceneManager.MoveGameObjectToScene(host, scene);
            try
            {
                var map = host.AddComponent<RoaGlobalMap>();
                map.enabled = false;
                Call(map, "EnsureRuntimeState");
                var definition = mapPayload["map"].ToObject<GlobalMapDefinition>();
                Set(map, "_map", definition);
                Set(map, "_wasteland", wasteland);
                Set(map, "_authoredScene", authored);
                Set(map, "_root", authored.gameObject);
                Set(map, "_dynamicRoot", authored.DynamicContentRoot != null ? authored.DynamicContentRoot.gameObject : null);
                Transform boundaryLine = authored.StaticContentRoot != null
                    ? authored.StaticContentRoot.Find("WorldEdge_AUTHORED/ToxicBoundaryFog_AUTHORED/BoundaryLine")
                    : null;
                Set(map, "_playableBoundary", boundaryLine != null ? boundaryLine.GetComponent<RoaGlobalMapBoundary>() : null);
                authored.gameObject.SetActive(true);
                Call(map, "RebuildDynamicWorld");
                try
                {
                    MethodInfo apply = typeof(RoaGlobalMap).GetMethod("ApplyDynamicPresentation", Private);
                    if (apply != null) apply.Invoke(map, new object[] { true });
                }
                catch (Exception error)
                {
                    Debug.LogWarning("[DANGER SHOT] presentation tier not applied: " + error.InnerException?.Message);
                }

                string summary = "cells " + map.DangerCellCount + ", borders " + map.DangerBorderCount
                    + ", territory " + map.TerritoryCellCount;
                GlobalMapNode core = definition.Nodes?.Find(node => node != null && (node.LocationId == "coreZone" || node.Id == "coreZone"));
                Vector3 coreWorld = core != null ? PointToWorld(definition, core.X, core.Y) : Vector3.zero;
                Vector3 west = PointToWorld(definition, 30f, 150f);

                Capture(Path.Combine(captures, "danger-01-region.png"), Vector3.zero, 40f, 66f, 0f, 1600, 1000);
                Capture(Path.Combine(captures, "danger-02-core.png"), coreWorld, 14f, 58f, 0f, 1280, 800);
                Capture(Path.Combine(captures, "danger-03-west.png"), west, 16f, 58f, 0f, 1280, 800);
                Debug.Log("[DANGER SHOT] OK: " + summary + "; снимки → " + captures);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
                if (authored != null) authored.ClearDynamicContent();
                if (scene.isDirty) EditorSceneManager.OpenScene(scene.path, OpenSceneMode.Single);
            }
        }

        private static Vector3 PointToWorld(GlobalMapDefinition map, float x, float y)
        {
            float width = map.Grid.Cols * map.Grid.CellPoints;
            float height = map.Grid.Rows * map.Grid.CellPoints;
            return new Vector3((x - width * 0.5f) * 0.1f, 0f, (height * 0.5f - y) * 0.1f);
        }

        private static void Set(object target, string field, object value)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            info.SetValue(target, value);
        }

        private static void Call(object target, string method)
        {
            MethodInfo info = target.GetType().GetMethod(method, Private);
            if (info == null) throw new MissingMethodException(target.GetType().Name, method);
            info.Invoke(target, null);
        }

        private static void Capture(string path, Vector3 target, float distance, float pitch, float yaw, int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("DangerShotCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = RoaCameraRig.StrategicFieldOfView;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 500f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = RoaGlobalMap.StrategicProfile(90f).CameraBackground;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.SetPositionAndRotation(target - orbit * Vector3.forward * distance, orbit);
                renderTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                camera.Render();
                RenderTexture.active = renderTarget;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                    UnityEngine.Object.DestroyImmediate(cameraObject);
                }
                if (renderTarget != null) renderTarget.Release();
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
            }
        }
    }
}
#endif
