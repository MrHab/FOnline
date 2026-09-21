#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaMinimapProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить мини-карту";
        private const string RequestName = "RoaMinimapProbe.request";
        private static double _nextRequestCheck;

        static RoaMinimapProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem(MenuPath)]
        private static void Run()
        {
            GameObject host = null;
            try
            {
                string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                                                            "../../data/locations/settlement.json"));
                LocationDefinition location = JsonConvert.DeserializeObject<LocationDefinition>(
                    File.ReadAllText(path));
                host = new GameObject("MinimapProbe");
                RoaMinimap minimap = host.AddComponent<RoaMinimap>();
                minimap.SetLocation(location);

                Require(minimap.MapWidth == 38 && minimap.MapDepth == 38,
                        "размер settlement не равен серверной сетке 38×38");
                Require(minimap.StaticTexture != null
                        && minimap.StaticTexture.width == 38 && minimap.StaticTexture.height == 38,
                        "статическая текстура имеет неверный размер");
                Require(minimap.StaticFeatureCount >= 20,
                        "на карту попало слишком мало авторских объектов: " + minimap.StaticFeatureCount);

                // Двор Ключей — пять стен вокруг открытой земли (collisionParts из сцены):
                // на карте и в тумане закрашены стены, а не весь его размах 53×49 м.
                LocationObject ring = location.Objects.Find(entry => entry != null && entry.Id == "settlement-settlement-ring");
                Require(ring != null && ring.CollisionParts != null && ring.CollisionParts.Count == 5,
                        "у двора Ключей нет пяти стен в collisionParts");
                var ringTiles = new System.Collections.Generic.HashSet<int>();
                Require(RoaCollisionParts.ForEachTile(ring, 38, 38, (tx, tz) => ringTiles.Add(tz * 38 + tx)),
                        "стены двора не разложились по тайлам");
                RoaCoords.WorldToTile(RoaCoords.ToUnity(ring.Position.X, ring.Position.Z), 38, 38,
                                      out int ringX, out int ringZ);
                Require(ringTiles.Count >= 40 && !ringTiles.Contains(ringZ * 38 + ringX),
                        "двор закрашен целиком, а не стенами: " + ringTiles.Count + " тайлов");

                Vector3 center = RoaCoords.TileToWorld(19, 19, 38, 38);
                Vector2 normalized = minimap.WorldToMapNormalized(center);
                // Север вверху: ось v перевёрнута относительно тайла tz.
                Require(Mathf.Abs(normalized.x - 19.5f / 38f) < 0.0001f
                        && Mathf.Abs(normalized.y - (1f - 19.5f / 38f)) < 0.0001f,
                        "преобразование координат мини-карты потеряло ось Z");

                Require(RoaEnemies.ClassifyMinimapActor(JObject.Parse("{\"hostileToPlayer\":true}"))
                        == RoaMinimap.MarkerKind.Enemy,
                        "враждебный актёр не получил красный маркер");
                Require(RoaEnemies.ClassifyMinimapActor(JObject.Parse("{\"hostileToPlayer\":null}"))
                        == RoaMinimap.MarkerKind.Enemy
                        && RoaEnemies.ClassifyMinimapActor(new JObject())
                        == RoaMinimap.MarkerKind.Enemy,
                        "неполный серверный снимок не применил безопасную враждебность по умолчанию");
                Require(RoaEnemies.ClassifyMinimapActor(JObject.Parse("{\"hostileToPlayer\":false,\"canDialogue\":true}"))
                        == RoaMinimap.MarkerKind.FriendlyNpc,
                        "мирный актёр помечен как враг или сервис");
                Require(RoaEnemies.ClassifyMinimapActor(JObject.Parse("{\"hostileToPlayer\":false,\"traderProfile\":\"old_klim\"}"))
                        == RoaMinimap.MarkerKind.ServiceNpc,
                        "торговец не получил сервисный маркер");

                Debug.Log("[МИНИ-КАРТА] готово: " + minimap.MapWidth + "×" + minimap.MapDepth
                    + ", авторских объектов=" + minimap.StaticFeatureCount
                    + ", центр=" + normalized.x.ToString("0.000") + ":" + normalized.y.ToString("0.000")
                    + ", актёры=враг/мирный/сервис");
            }
            catch (Exception error)
            {
                Debug.LogError("[МИНИ-КАРТА] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        public static void RunBatch()
        {
            Run();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
