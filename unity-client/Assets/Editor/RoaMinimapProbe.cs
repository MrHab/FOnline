#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaMinimapProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить мини-карту";

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

                Vector3 center = RoaCoords.TileToWorld(19, 19, 38, 38);
                Vector2 normalized = minimap.WorldToMapNormalized(center);
                Require(Mathf.Abs(normalized.x - 19.5f / 38f) < 0.0001f
                        && Mathf.Abs(normalized.y - 19.5f / 38f) < 0.0001f,
                        "преобразование координат мини-карты потеряло ось Z");

                Debug.Log("[МИНИ-КАРТА] готово: " + minimap.MapWidth + "×" + minimap.MapDepth
                    + ", авторских объектов=" + minimap.StaticFeatureCount
                    + ", центр=" + normalized.x.ToString("0.000") + ":" + normalized.y.ToString("0.000"));
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

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
