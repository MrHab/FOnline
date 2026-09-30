#if UNITY_EDITOR
using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Погода без сервера: разбор снимка kromka.weather.v1, строки журнала о смене
    /// погоды, огибающая молнии, свет под облаками, мокрая земля, косые струи и
    /// собранные звуки дождя и грома. Живой клиент с сервером — RoaWeatherPlayProbe.
    /// </summary>
    public static class RoaWeatherProbe
    {
        private const string Tag = "[ПОГОДА]";

        [MenuItem("Realm of Ashes/Погода/Проверить правила погоды")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                CheckRules();
                host = new GameObject("WeatherProbeAudio");
                RoaAudio audio = host.AddComponent<RoaAudio>();
                // В Edit Mode Awake сам не зовётся — собираем клипы так же, как проба звуков оружия.
                if (audio.GeneratedClipCount == 0)
                    typeof(RoaAudio).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(audio, null);
                Require(audio.RainCueReady, "шум дождя или гром не собраны");
                Debug.Log(Tag + " готово: снимок, журнал, молния, свет, мокрая земля, струи, звуки дождя и грома.");
            }
            catch (Exception error)
            {
                Debug.LogError(Tag + " ошибка: " + error.Message);
                throw;
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>Чистые правила: разбор снимка, строки журнала, вспышка, свет и мокрая земля.</summary>
        public static void CheckRules()
        {
            RoaWeather.Snapshot storm = RoaWeather.Parse(JObject.Parse(
                "{\"state\":\"storm\",\"rain\":1,\"cloud\":1,\"wetness\":1,\"mud\":0.75,\"puddles\":1,"
                + "\"wind\":{\"x\":0,\"z\":2,\"speed\":1},\"sheltered\":false,\"effects\":{\"moveSpeedMultiplier\":0.895,"
                + "\"hearingMultiplier\":0.55,\"visionMultiplier\":0.78,\"rangedAccuracyMultiplier\":0.9}}"));
            Require(storm.Valid && storm.State == "storm" && Mathf.Approximately(storm.MoveSpeedMultiplier, 0.895f)
                && Mathf.Approximately(storm.Wind.y, 1f), "снимок ливня разобран неверно");
            RoaWeather.Snapshot broken = RoaWeather.Parse(JObject.Parse("{\"state\":\"rain\",\"rain\":\"x\",\"effects\":{\"moveSpeedMultiplier\":0.01}}"));
            Require(broken.Rain == 0f && broken.MoveSpeedMultiplier == 0.5f, "кривой снимок не зажат в разумные пределы");
            RoaWeather.Snapshot clear = RoaWeather.Parse(JObject.Parse("{\"state\":\"clear\",\"mud\":0}"));
            RoaWeather.Snapshot rain = RoaWeather.Parse(JObject.Parse("{\"state\":\"rain\",\"rain\":0.4}"));
            RoaWeather.Snapshot muddy = RoaWeather.Parse(JObject.Parse("{\"state\":\"overcast\",\"mud\":0.5}"));
            Require(RoaWeather.TransitionNotice(clear, rain).StartsWith("Начался дождь"), "нет строки о начале дождя");
            Require(RoaWeather.TransitionNotice(rain, storm).StartsWith("Ливень"), "нет строки о ливне");
            Require(RoaWeather.TransitionNotice(storm, muddy).Contains("Грязь"), "нет строки о грязи после дождя");
            Require(RoaWeather.TransitionNotice(rain, rain) == "", "одна и та же погода не повторяется в журнале");
            Require(RoaWeather.LightningEnvelope(0.04f) > 0.99f && RoaWeather.LightningEnvelope(0.6f) == 0f
                && RoaWeather.LightningEnvelope(0.1f) < RoaWeather.LightningEnvelope(0.17f), "вспышка молнии без двойного удара");

            RoaWorldLighting.LightingSample day = RoaWorldLighting.Evaluate(13f);
            RoaWorldLighting.LightingSample overcast = RoaWorldLighting.WithWeather(day, 1f, 1f);
            Require(overcast.SunIntensity < day.SunIntensity * 0.4f && !overcast.SunShadows, "в сплошной облачности солнце не гаснет");
            Require(overcast.FogDensity > day.FogDensity * 4f, "ливень не сгущает дымку");
            Require(overcast.Exposure < day.Exposure * 0.85f, "под сплошной облачностью кадр не темнеет целиком");
            Require(overcast.SkyColor.grayscale < day.SkyColor.grayscale + 0.05f, "грозовое небо светлее ясного");
            RoaWorldLighting.LightingSample same = RoaWorldLighting.WithWeather(day, 0f, 0f);
            Require(Mathf.Approximately(same.SunIntensity, day.SunIntensity) && Mathf.Approximately(same.FogDensity, day.FogDensity),
                "ясная погода меняет свет");
            RoaWorldLighting.WetGround(new Color(0.8f, 0.7f, 0.6f), 0.18f, 1f, out Color soaked, out float gloss);
            RoaWorldLighting.WetGround(new Color(0.8f, 0.7f, 0.6f), 0.18f, 0f, out Color dry, out float matte);
            Require(soaked.grayscale < dry.grayscale * 0.75f && gloss > 0.4f && Mathf.Approximately(matte, 0.18f),
                "мокрая земля не темнеет или не блестит");
            Vector3 windy = RoaRainFx.DropVelocity(Vector2.right, 1f);
            Vector3 calm = RoaRainFx.DropVelocity(Vector2.right, 0f);
            Require(windy.y < -9f && windy.x > calm.x * 3f, "ветер не кладёт струи");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
