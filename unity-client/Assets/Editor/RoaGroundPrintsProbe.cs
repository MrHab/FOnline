#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Следы на земле (RoaGroundPrints и шейдер Kromka Ground). Правила: шаг человека
    /// 0,7–1,3 м, лапы чаще; бетон без грязи следов не держит; след в пыли живёт пару
    /// минут и смывается дождём за полминуты, след в грязи переживает и дождь, и
    /// высыхание; машина оставляет две колеи, мотоцикл одну. Карта: отпечаток ложится в
    /// тот тексель, который шейдер читает для его точки мира, носком вперёд, без
    /// зеркала. Кадры — суглинок без следов и со следами сухим, после дождя (следы с
    /// водой) и облегчённым шейдером (Library/GroundPrintsProbe).
    /// </summary>
    public static class RoaGroundPrintsProbe
    {
        private const string Tag = "[СЛЕДЫ]";
        private const int FrameWidth = 1280;
        private const int FrameHeight = 800;
        private const float FrameDistance = 7f;
        private static readonly int WetnessId = Shader.PropertyToID("_Wetness");
        private static readonly int PuddlesId = Shader.PropertyToID("_Puddles");
        private static readonly int MudId = Shader.PropertyToID("_Mud");
        private static readonly int StrengthId = Shader.PropertyToID("_KromkaPrintStrength");

        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/GroundPrintsProbe"));

        [MenuItem("Realm of Ashes/Погода/Проверить следы на земле")]
        public static void Run()
        {
            Directory.CreateDirectory(Output);
            var lines = new List<string>();
            var host = new GameObject("GroundPrintsProbe");
            try
            {
                RoaGroundPrints prints = host.AddComponent<RoaGroundPrints>();
                CheckRules(prints, lines);
                CheckMap(prints, lines);
                CheckFrames(prints, lines);
                Debug.Log(Tag + " готово: " + string.Join(" | ", lines) + " — кадры: " + Output);
            }
            catch (Exception error)
            {
                Debug.LogError(Tag + " ошибка: " + error.Message + (lines.Count > 0 ? " | " + string.Join(" | ", lines) : string.Empty));
                throw;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
                Shader.SetGlobalFloat(StrengthId, 0f);
            }
        }

        public static void RunBatch()
        {
            int code = 0;
            try { Run(); }
            catch (Exception) { code = 1; }
            EditorApplication.Exit(code);
        }

        private static void CheckRules(RoaGroundPrints prints, List<string> lines)
        {
            prints.SetLocation("probe_loam", "river_loam");
            float loam = RoaGroundTextures.Info(RoaGroundTextures.SetForPreset("river_loam")).Prints;
            Require(Mathf.Approximately(prints.Softness, loam), "мягкость суглинка не из каталога: " + prints.Softness);
            prints.SetConditions(0f, 0f, 0f);
            int walk = Walk(prints, new Vector3(-5f, 0f, 0f), new Vector3(5f, 0f, 0f), 1.6f);
            int run = Walk(prints, new Vector3(-5f, 0f, 2f), new Vector3(5f, 0f, 2f), 6.2f);
            int paws = Walk(prints, new Vector3(-5f, 0f, 4f), new Vector3(5f, 0f, 4f), 3f, RoaGroundPrints.Kind.Paw, 0.5f);
            Require(walk >= 11 && walk <= 16, "шаг пешком не 0,7 м: " + walk + " следов на 10 м");
            Require(run >= 6 && run <= 10, "шаг бегом не 1,2 м: " + run + " следов на 10 м");
            Require(paws > walk * 2, "маленький зверь шагает не чаще человека: " + paws);
            lines.Add("10 м: пешком " + walk + ", бегом " + run + ", лапы " + paws);

            // Бетон держит след, только когда на нём грязь.
            prints.SetLocation("probe_concrete", "wet_concrete");
            prints.SetConditions(0f, 0f, 0f);
            int dryConcrete = Walk(prints, new Vector3(-5f, 0f, 0f), new Vector3(5f, 0f, 0f), 1.6f);
            prints.SetConditions(1f, 0f, 0f);
            int wetConcrete = Walk(prints, new Vector3(-5f, 0f, 1f), new Vector3(5f, 0f, 1f), 1.6f);
            prints.SetConditions(1f, 0.6f, 0f);
            int muddyConcrete = Walk(prints, new Vector3(-5f, 0f, 2f), new Vector3(5f, 0f, 2f), 1.6f);
            Require(dryConcrete == 0 && wetConcrete == 0, "чистый бетон держит следы: " + dryConcrete + "/" + wetConcrete);
            Require(muddyConcrete > 8, "грязь на бетоне не держит следов: " + muddyConcrete);

            // Пыль и грязь: дождь смывает след в пыли, след в грязи переживает и дождь, и высыхание.
            prints.SetLocation("probe_life", "tract_dust");
            var dust = new Vector3(0f, 0f, 0f);
            var mud = new Vector3(4f, 0f, 0f);
            var later = new Vector3(8f, 0f, 0f);
            prints.SetConditions(0f, 0f, 0f);
            prints.StampFoot(dust, Vector3.forward, RoaGroundPrints.Kind.Boot, true);
            prints.SetConditions(1f, 1f, 0f);
            prints.StampFoot(mud, Vector3.forward, RoaGroundPrints.Kind.Boot, true);
            float dustDepth = prints.DepthNear(dust, 0.3f);
            float mudDepth = prints.DepthNear(mud, 0.3f);
            Require(dustDepth > 0.2f && mudDepth > dustDepth * 1.3f,
                "в грязи след не глубже, чем в пыли: " + mudDepth.ToString("0.00") + "/" + dustDepth.ToString("0.00"));
            prints.SetConditions(1f, 1f, 1f);
            prints.Advance(40f);
            Require(prints.DepthNear(dust, 0.3f) == 0f, "ливень за 40 с не смыл след в пыли");
            Require(prints.DepthNear(mud, 0.3f) > mudDepth * 0.99f, "ливень смыл след в грязи");
            prints.SetConditions(0f, 0f, 0f);
            prints.Advance(600f);
            Require(prints.DepthNear(mud, 0.3f) > mudDepth * 0.99f, "след в грязи пропал через 10 минут после дождя");
            prints.Advance(1500f);
            Require(prints.DepthNear(mud, 0.3f) == 0f, "след в грязи не исчезает и через 35 минут");
            prints.StampFoot(later, Vector3.forward, RoaGroundPrints.Kind.Boot, false);
            prints.Advance(60f);
            Require(prints.DepthNear(later, 0.3f) > 0.2f, "след в пыли пропал за минуту без дождя");
            prints.Advance(120f);
            Require(prints.DepthNear(later, 0.3f) == 0f, "след в пыли живёт дольше трёх минут");
            lines.Add("глубина пыль/грязь " + dustDepth.ToString("0.00") + "/" + mudDepth.ToString("0.00"));

            Require(RoaGroundPrints.TwinTrack("pickup_t3") && RoaGroundPrints.TwinTrack("armyTruck")
                && !RoaGroundPrints.TwinTrack("motorcycle") && !RoaGroundPrints.TwinTrack("moped"),
                "машины и мотоциклы перепутаны по колеям");
            prints.SetLocation("probe_wheels", "river_loam");
            prints.SetConditions(0.5f, 0.6f, 0f);
            int bike = Drive(prints, new Vector3(-5f, 0f, 0f), new Vector3(5f, 0f, 0f), 8f, false);
            int car = Drive(prints, new Vector3(-5f, 0f, 3f), new Vector3(5f, 0f, 3f), 8f, true);
            Require(bike >= 24 && bike <= 30, "колея мотоцикла не отрезками по 35 см: " + bike);
            Require(Mathf.Abs(car - bike * 2) <= 2, "у машины не две колеи: " + car + " против " + bike);
            lines.Add("колея 10 м: мотоцикл " + bike + ", машина " + car);
        }

        /// <summary>Отпечаток ложится в тот тексель карты, который шейдер земли читает для его точки.</summary>
        private static void CheckMap(RoaGroundPrints prints, List<string> lines)
        {
            prints.SetLocation("probe_map", "river_loam");
            prints.SetConditions(1f, 1f, 0f);
            var centre = new Vector2(1f, -2f);
            var at = new Vector3(3.3f, 0f, -4.7f);
            Require(prints.StampFoot(at, Vector3.forward, RoaGroundPrints.Kind.Boot, true), "след в грязи не напечатан");
            prints.Refresh(centre);
            Require(prints.Active && prints.Map != null, "карта следов не создана");
            Texture2D map = ReadMap(prints.Map);
            try
            {
                // Правая нога — на 11 см вправо (+X при ходьбе на север).
                Vector3 print = at + new Vector3(RoaGroundPrints.FootSpacing, 0f, 0f);
                float peak = 0f;
                for (float dz = -0.12f; dz <= 0.12f; dz += 0.01f)
                for (float dx = -0.04f; dx <= 0.04f; dx += 0.01f)
                    peak = Mathf.Max(peak, Depth(prints, map, print + new Vector3(dx, 0f, dz)));
                float mapMax = 0f;
                int maxX = -1, maxY = -1;
                Color[] all = map.GetPixels();
                for (int i = 0; i < all.Length; i++)
                    if (all[i].r > mapMax) { mapMax = all[i].r; maxX = i % map.width; maxY = i / map.width; }
                Vector2 expected = prints.MapUV(print) * map.width;
                Require(peak > 0.4f, "в точке следа карта пуста: " + peak.ToString("0.00") + ", максимум карты "
                    + mapMax.ToString("0.00") + " в " + maxX + "," + maxY + ", ждали " + expected.x.ToString("0") + "," + expected.y.ToString("0"));
                Require(Depth(prints, map, print + new Vector3(0f, 0f, 0.5f)) < 0.02f
                    && Depth(prints, map, print - new Vector3(0f, 0f, 0.5f)) < 0.02f
                    && Depth(prints, map, print + new Vector3(0.3f, 0f, 0f)) < 0.02f,
                    "след размазан дальше 30 см");
                var mirrorZ = new Vector3(print.x, 0f, 2f * centre.y - print.z);
                var mirrorX = new Vector3(2f * centre.x - print.x, 0f, print.z);
                Require(Depth(prints, map, mirrorZ) < 0.02f && Depth(prints, map, mirrorX) < 0.02f,
                    "карта следов отражена относительно мира");
                float front = 0f, rear = 0f;
                for (float along = -0.16f; along <= 0.16f; along += 0.01f)
                for (float across = -0.07f; across <= 0.07f; across += 0.01f)
                {
                    float depth = Depth(prints, map, print + new Vector3(across, 0f, along));
                    if (along > 0.02f) front += depth;
                    else if (along < -0.02f) rear += depth;
                }
                Require(front > rear * 1.15f, "носок не впереди: перед " + front.ToString("0.0") + ", зад " + rear.ToString("0.0"));
                lines.Add("карта " + prints.Map.width + " px на " + RoaGroundPrints.WindowSize + " м, пик " + peak.ToString("0.00")
                    + ", носок/пятка " + front.ToString("0.0") + "/" + rear.ToString("0.0"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(map);
            }
        }

        private static void CheckFrames(RoaGroundPrints prints, List<string> lines)
        {
            GameObject host = new GameObject("GroundPrintsProbe_Terrain");
            try
            {
                LocationDefinition location = RoaGroundTexturesProbe.Location("probe_prints", 18, 18, 52917L, "river_loam");
                RoaLocalTerrain terrain = host.AddComponent<RoaLocalTerrain>();
                terrain.Initialize(location, RoaGroundTexturesProbe.Map(18, 18));
                Require(terrain.UsesGroundTextures, "земля не на шейдере Kromka Ground");
                Material material = terrain.GroundRenderer.sharedMaterial;

                // Сухо: прогулка, зверь, мотоцикл и машина на сухом суглинке.
                prints.SetLocation("probe_prints_dry", "river_loam");
                prints.SetConditions(0f, 0f, 0f);
                Trails(prints);
                prints.Refresh(Vector2.zero);
                SetGround(terrain, 0f, 0f, 0f);
                var dryNone = Frame(host, "loam-dry-none", false);
                var dry = Frame(host, "loam-dry-prints", true);

                // После дождя: те же следы, оставленные в грязи, набрали воду.
                prints.SetLocation("probe_prints_wet", "river_loam");
                prints.SetConditions(1f, 0.8f, 0f);
                Trails(prints);
                prints.Refresh(Vector2.zero);
                SetGround(terrain, 0.7f, 0.6f, 0.8f);
                var wetNone = Frame(host, "loam-wet-none", false);
                var wet = Frame(host, "loam-wet-prints", true);

                material.EnableKeyword(RoaGroundTextures.LiteKeyword);
                var lite = Frame(host, "loam-wet-prints-lite", true);
                material.DisableKeyword(RoaGroundTextures.LiteKeyword);

                float dryChanged = RoaGroundTexturesProbe.ChangedFraction(dryNone, dry);
                float wetChanged = RoaGroundTexturesProbe.ChangedFraction(wetNone, wet);
                float liteChanged = RoaGroundTexturesProbe.ChangedFraction(wetNone, lite);
                lines.Add("кадр меняют следы: сухо " + dryChanged.ToString("0.0000") + ", после дождя " + wetChanged.ToString("0.0000")
                    + ", телефон " + liteChanged.ToString("0.0000"));
                foreach (var shot in new[] { dryNone, dry, wetNone, wet, lite })
                    Require(shot.Magenta < 0.0001f, "шейдер земли со следами не собран (пурпур)");
                // Следы видны, но меняют только полосы шагов и колей, а не весь кадр.
                Require(dryChanged > 0.004f && dryChanged < 0.12f, "сухие следы не видны или залили кадр: " + dryChanged.ToString("0.0000"));
                Require(wetChanged > 0.004f && wetChanged < 0.12f, "следы после дождя не видны или залили кадр: " + wetChanged.ToString("0.0000"));
                Require(liteChanged > 0.002f && liteChanged < 0.12f, "на телефоне следов не видно: " + liteChanged.ToString("0.0000"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>Прогулка поперёк кадра, зверь наискосок, мотоцикл и машина.</summary>
        private static void Trails(RoaGroundPrints prints)
        {
            Walk(prints, new Vector3(-6f, 0f, 1.2f), new Vector3(6f, 0f, 1.2f), 1.6f);
            Walk(prints, new Vector3(-5f, 0f, -2.5f), new Vector3(4f, 0f, -0.5f), 3f, RoaGroundPrints.Kind.Paw, 0.8f);
            Drive(prints, new Vector3(2.5f, 0f, -6f), new Vector3(2.5f, 0f, 6f), 7f, false);
            Drive(prints, new Vector3(-7f, 0f, -4.5f), new Vector3(7f, 0f, -4.5f), 7f, true);
        }

        private static RoaGroundTexturesProbe.Shot Frame(GameObject host, string name, bool withPrints)
        {
            Shader.SetGlobalFloat(StrengthId, withPrints ? 1f : 0f);
            try { return RoaGroundTexturesProbe.Render(host, name, Output, FrameDistance, FrameWidth, FrameHeight); }
            finally { Shader.SetGlobalFloat(StrengthId, 1f); }
        }

        private static void SetGround(RoaLocalTerrain terrain, float wetness, float puddles, float mud)
        {
            var block = new MaterialPropertyBlock();
            terrain.GroundRenderer.GetPropertyBlock(block);
            block.SetFloat(WetnessId, wetness);
            block.SetFloat(PuddlesId, puddles);
            block.SetFloat(MudId, mud);
            terrain.GroundRenderer.SetPropertyBlock(block);
        }

        /// <summary>Пройти по прямой кадрами по 1/20 с; сколько следов напечатано.</summary>
        private static int Walk(RoaGroundPrints prints, Vector3 from, Vector3 to, float speed,
                                RoaGroundPrints.Kind kind = RoaGroundPrints.Kind.Boot, float scale = 1f)
        {
            var track = default(RoaGroundPrints.Track);
            Vector3 direction = (to - from).normalized;
            float length = Vector3.Distance(from, to);
            int before = prints.PrintCount;
            for (float d = 0f; d <= length; d += speed / 20f)
                prints.TrackFeet(ref track, from + direction * d, direction * speed, true, kind, scale);
            return prints.PrintCount - before;
        }

        private static int Drive(RoaGroundPrints prints, Vector3 from, Vector3 to, float speed, bool twin)
        {
            var track = default(RoaGroundPrints.WheelTrack);
            Vector3 direction = (to - from).normalized;
            float length = Vector3.Distance(from, to);
            int before = prints.PrintCount;
            for (float d = 0f; d <= length; d += speed / 20f)
                prints.TrackWheels(ref track, from + direction * d, direction * speed, true, twin);
            return prints.PrintCount - before;
        }

        private static float Depth(RoaGroundPrints prints, Texture2D map, Vector3 world)
        {
            Vector2 uv = prints.MapUV(world);
            int x = Mathf.FloorToInt(uv.x * map.width);
            int y = Mathf.FloorToInt(uv.y * map.height);
            if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0f;
            return map.GetPixel(x, y).r;
        }

        /// <summary>Карта следов на CPU: через RGBA-копию, R8 читается не везде.</summary>
        private static Texture2D ReadMap(RenderTexture source)
        {
            RenderTexture previous = RenderTexture.active;
            RenderTexture copy = RenderTexture.GetTemporary(source.width, source.height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            try
            {
                Graphics.Blit(source, copy);
                RenderTexture.active = copy;
                var texture = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false, true);
                texture.ReadPixels(new Rect(0, 0, source.width, source.height), 0, 0);
                texture.Apply(false, false);
                return texture;
            }
            finally
            {
                RenderTexture.active = previous;
                RenderTexture.ReleaseTemporary(copy);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
