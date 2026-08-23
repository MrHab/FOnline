#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks the day/night formula without changing the running scene.</summary>
    public static class RoaLightingProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить день и ночь";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                RoaWorldLighting.LightingSample noon = RoaWorldLighting.Evaluate(12f);
                RoaWorldLighting.LightingSample midnight = RoaWorldLighting.Evaluate(0f);
                RoaWorldLighting.LightingSample dawn = RoaWorldLighting.Evaluate(6f);
                RoaWorldLighting.LightingSample fixedWeb = RoaWorldLighting.Evaluate(RoaWorldLighting.WebFixedWorldHour);

                var oldKlim = new JObject
                {
                    ["id"] = "old-klim-caravan-yard-v1",
                    ["skyDay"] = "#596473",
                    ["fogDay"] = "#4f5964",
                    ["hemiSkyDay"] = "#d8d2c6",
                    ["hemiGroundDay"] = "#526171",
                    ["fillDay"] = "#c7d1dc",
                    ["sunDay"] = "#ffd39a",
                    ["rimDay"] = "#9fb4ca",
                    ["fogDensityDay"] = 0.0019f,
                    ["exposureDay"] = 1.08f,
                    ["hemiIntensityScale"] = 0.9f,
                    ["fillIntensityScale"] = 0.75f,
                    ["sunIntensityScale"] = 1.06f,
                    ["rimIntensityScale"] = 0.86f
                };
                RoaWorldLighting.LightingSample authoredNoon = RoaWorldLighting.Evaluate(12f, oldKlim);

                Require(noon.Daylight > 0.99f, "полдень не стал дневным");
                Require(noon.SunIntensity > 1.03f && noon.SunIntensity < 1.07f && noon.MoonIntensity < 0.01f,
                        "полуденные солнце/луна имеют неверную яркость");
                Require(noon.SunShadows, "полуденные тени выключены");

                Require(midnight.Daylight < 0.01f, "полночь не стала ночной");
                Require(midnight.SunIntensity < 0.01f && midnight.MoonIntensity > 0.36f,
                        "ночные солнце/луна имеют неверную яркость");
                Require(!midnight.SunShadows, "ночью остались солнечные тени");
                Require(midnight.GroundTintMix > 0.55f, "ночной оттенок земли не включился");

                Require(dawn.Twilight > 0.99f, "рассвет не вошёл в сумеречную фазу");
                Require(fixedWeb.SunIntensity > fixedWeb.MoonIntensity && fixedWeb.SunShadows,
                        "фиксированное время web-клиента не даёт дневной свет");
                Require(ApproximatelyColor(authoredNoon.SkyColor, Html("#596473")),
                        "авторский цвет неба Старого Клима потерян");
                Require(Mathf.Abs(authoredNoon.SunIntensity - 1.05f * 1.06f) < 0.001f,
                        "авторский множитель солнца Старого Клима потерян");
                Require(Mathf.Abs(authoredNoon.FogDensity - 0.0019f) < 0.00001f,
                        "авторская плотность тумана Старого Клима потеряна");

                Debug.Log("[ДЕНЬ/НОЧЬ] готово: полдень sun=" + noon.SunIntensity.ToString("0.00")
                    + ", полночь moon=" + midnight.MoonIntensity.ToString("0.00")
                    + ", рассвет twilight=" + dawn.Twilight.ToString("0.00")
                    + ", web " + fixedWeb.Hour.ToString("0.0") + "h daylight=" + fixedWeb.Daylight.ToString("0.00"));
            }
            catch (Exception error)
            {
                Debug.LogError("[ДЕНЬ/НОЧЬ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static Color Html(string value)
        {
            Color color;
            if (!ColorUtility.TryParseHtmlString(value, out color))
                throw new InvalidOperationException("Некорректный цвет теста: " + value);
            return color;
        }

        private static bool ApproximatelyColor(Color a, Color b)
        {
            return Mathf.Abs(a.r - b.r) < 0.001f
                && Mathf.Abs(a.g - b.g) < 0.001f
                && Mathf.Abs(a.b - b.b) < 0.001f;
        }
    }
}
#endif
