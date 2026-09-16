#if UNITY_EDITOR
using System;
using System.IO;
using Kromka.EditorTools;
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
    /// Снимок угодий и знака главаря на авторской карте: ставит те же префабы,
    /// что и карта во время игры, по координатам областей из
    /// `data/kromka/pve-areas.json`, рендерит PNG и убирает за собой. Нужен,
    /// чтобы видеть форму контура глазами, а не только по тестам.
    ///
    /// Сцена не сохраняется: пункт отказывается работать, если в редакторе есть
    /// несохранённые правки.
    /// </summary>
    public static class RoaGlobalMapZoneShotProbe
    {
        private const float MapScale = 0.1f;
        private const float ZoneHeight = 0.06f;
        private const float BadgeHeight = 0.34f;
        private const float BadgeRadiusPoints = 5.5f;

        [MenuItem("Realm of Ashes/Глобальная карта/Снимок угодий встреч")]
        public static void Run()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new Exception("[ZONE SHOT] Есть несохранённая сцена ("
                        + SceneManager.GetSceneAt(i).name + ") — снимок не трогает чужие правки.");

            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != "Assets/Scenes/GlobalMapAuthored.unity")
                scene = EditorSceneManager.OpenScene("Assets/Scenes/GlobalMapAuthored.unity",
                    OpenSceneMode.Single);

            // Каталог живых префабов сцены обязан знать новые типы: без записи
            // в `_livePrefabs` карта во время игры молча не нарисует угодья.
            var marker = UnityEngine.Object.FindAnyObjectByType<RoaUnityGlobalMapScene>();
            if (marker == null) throw new Exception("[ZONE SHOT] В сцене нет RoaUnityGlobalMapScene.");
            foreach (RoaGlobalMapPrefabKind kind in new[]
            {
                RoaGlobalMapPrefabKind.ZoneAreaA, RoaGlobalMapPrefabKind.ZoneAreaB,
                RoaGlobalMapPrefabKind.ZoneAreaC, RoaGlobalMapPrefabKind.BossBadge
            })
            {
                if (marker.PrefabFor(kind) == null)
                    throw new Exception("[ZONE SHOT] Каталог сцены не знает тип " + kind + ".");
            }

            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string dataPath = Path.GetFullPath(Path.Combine(projectRoot, "..", "data", "kromka", "pve-areas.json"));
            string mapPath = Path.GetFullPath(Path.Combine(projectRoot, "..", "data", "global-map.json"));
            JObject areas = JObject.Parse(File.ReadAllText(dataPath));
            JObject map = JObject.Parse(File.ReadAllText(mapPath));

            var root = new GameObject("ZoneShotProbe_Temp");
            SceneManager.MoveGameObjectToScene(root, scene);
            string output = Path.Combine(projectRoot, "Library", "AgentCaptures");
            Directory.CreateDirectory(output);
            try
            {
                int placed = 0;
                Vector3 focus = Vector3.zero;
                foreach (JToken token in areas["areas"] as JArray ?? new JArray())
                {
                    JObject area = token as JObject;
                    if (area == null) continue;
                    JObject node = FindNode(map, area["locationId"]?.ToString() ?? string.Empty);
                    if (node == null) continue;
                    float x = node["x"].Value<float>();
                    float y = node["y"].Value<float>();
                    float radius = area["radiusPoints"]?.Value<float>() ?? 24f;
                    int shape = area["shape"]?.Value<int>() ?? 1;
                    float rotation = area["shapeRotation"]?.Value<float>() ?? 0f;
                    int band = area["dangerBand"]?.Value<int>() ?? 3;

                    GameObject zone = Place(root.transform, ZonePrefab(shape),
                        area["id"]?.ToString() ?? "zone", x, y, Lift(x, y, radius), rotation,
                        radius * MapScale);
                    Color colour = RoaGlobalMap.EncounterZoneColor(band);
                    Tint(zone, new Color(colour.r, colour.g, colour.b, 0.16f), "ZoneFill");
                    Tint(zone, new Color(colour.r, colour.g, colour.b, 0.85f), "ZoneRim");
                    if (placed == 0) focus = zone.transform.position;
                    placed++;

                    // Один узел получает ещё и знак главаря: на снимке видно,
                    // как шестиугольник читается поверх угодий.
                    if (placed != 1) continue;
                    GameObject badge = Place(root.transform, "GM_BossBadge", "badge", x, y,
                        Lift(x, y, BadgeRadiusPoints * 2f) + BadgeHeight, 0f,
                        BadgeRadiusPoints * MapScale);
                    Tint(badge, RoaGlobalMap.BossBadgeFill, "BadgeFill");
                    Tint(badge, RoaGlobalMap.BossBadgeRim, "BadgeRim");
                }

                Capture(Path.Combine(output, "zones-01-close.png"), focus, 26f, 55f, 45f, 1280, 720);
                Capture(Path.Combine(output, "zones-02-region.png"), Vector3.zero, 96f, 58f, 45f, 1280, 720);
                Debug.Log("[ZONE SHOT] OK: угодий размещено " + placed + ", снимки → " + output);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                // Проба входит только в чистую сцену (проверка выше), поэтому
                // перечитывание с диска отбрасывает ровно её собственные
                // временные объекты и снимает флаг изменений: иначе следующая
                // сборка WebGL откажется идти со словами «Save edited scenes».
                if (scene.isDirty)
                    EditorSceneManager.OpenScene(scene.path, OpenSceneMode.Single);
            }
        }

        /// <summary>Тот же подъём над рельефом, что считает карта во время игры.</summary>
        private static float Lift(float x, float y, float radiusPoints)
        {
            float ground = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
            float highest = ground;
            for (int i = 0; i < 12; i++)
            {
                float angle = i * (Mathf.PI * 2f / 12f);
                float dx = Mathf.Cos(angle) * radiusPoints;
                float dy = Mathf.Sin(angle) * radiusPoints;
                highest = Mathf.Max(highest, KromkaGlobalMapReliefAuthoring.HeightAtMap(x + dx, y + dy));
                highest = Mathf.Max(highest,
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(x + dx * 0.6f, y + dy * 0.6f));
            }
            return ZoneHeight + Mathf.Max(0f, highest - ground);
        }

        private static JObject FindNode(JObject map, string locationId)
        {
            foreach (JToken token in map["nodes"] as JArray ?? new JArray())
            {
                JObject node = token as JObject;
                if (node == null) continue;
                if (node["locationId"]?.ToString() == locationId || node["id"]?.ToString() == locationId)
                    return node;
            }
            return null;
        }

        private static string ZonePrefab(int shape)
        {
            switch (Mathf.Clamp(shape, 1, 3))
            {
                case 1: return "GM_ZoneArea_A";
                case 2: return "GM_ZoneArea_B";
                default: return "GM_ZoneArea_C";
            }
        }

        private static GameObject Place(Transform parent, string prefabName, string name,
                                        float x, float y, float height, float rotation, float radius)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/Prefabs/GlobalMap/" + prefabName + ".prefab");
            if (prefab == null) throw new Exception("[ZONE SHOT] Не найден префаб " + prefabName);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            instance.name = prefabName + ":" + name;
            instance.transform.position = KromkaWorldSceneBuilder.PointToWorld(x, y, height);
            instance.transform.rotation = Quaternion.Euler(0f, rotation, 0f);
            instance.transform.localScale = new Vector3(radius, 1f, radius);
            return instance;
        }

        private static void Tint(GameObject target, Color color, string childFilter)
        {
            var block = new MaterialPropertyBlock();
            foreach (Renderer renderer in target.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer.gameObject.name.IndexOf(childFilter, StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                block.Clear();
                block.SetColor("_BaseColor", color);
                block.SetColor("_Color", color);
                renderer.SetPropertyBlock(block);
            }
        }

        private static void Capture(string path, Vector3 target, float distance,
                                    float pitch, float yaw, int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("ZoneShotCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = RoaCameraRig.StrategicFieldOfView;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 500f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = RoaGlobalMap.StrategicProfile(90f).CameraBackground;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.SetPositionAndRotation(
                    target - orbit * Vector3.forward * distance, orbit);
                renderTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
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
