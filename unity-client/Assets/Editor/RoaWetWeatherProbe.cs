#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Мокрая погода вне земли. RoaWetSurfaces: освещаемые материалы темнеют и блестят
    /// (шершавое сильнее, металл слабее), прозрачное, неосвещаемое и слой карты мира не
    /// трогаются, чужая запись цвета становится сухой, смена прозрачности не копит
    /// темноту, копия материала (крыша) начинает сухой, сухое возвращается точно — в том
    /// числе у материала-ассета. RoaGroundWater: лужи на CPU совпадают с лужами шейдера на
    /// кадре сверху, маска зоны читает тропу и воду. Шаг в лужу даёт всплеск и круг, по
    /// мокрому шаг хлюпает, в луже — плещет; мокрых клипов три. Кадры — Library/WetWeatherProbe.
    /// </summary>
    public static class RoaWetWeatherProbe
    {
        private const string Tag = "[МОКРАЯ ПОГОДА]";
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int SmoothnessId = Shader.PropertyToID("_Smoothness");
        private static readonly int MetallicId = Shader.PropertyToID("_Metallic");
        private static readonly int SurfaceId = Shader.PropertyToID("_Surface");
        private static readonly int WetnessId = Shader.PropertyToID("_Wetness");
        private static readonly int PuddlesId = Shader.PropertyToID("_Puddles");
        private static readonly int MudId = Shader.PropertyToID("_Mud");
        private static readonly int RainId = Shader.PropertyToID("_Rain");

        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/WetWeatherProbe"));

        [MenuItem("Realm of Ashes/Погода/Проверить мокрые предметы, лужи и всплески")]
        public static void Run()
        {
            Directory.CreateDirectory(Output);
            var lines = new List<string>();
            try
            {
                CheckWetSurfaces(lines);
                CheckPuddlesAndSplashes(lines);
                Debug.Log(Tag + " готово: " + string.Join(" | ", lines) + " — кадры: " + Output);
            }
            catch (Exception error)
            {
                Debug.LogError(Tag + " ошибка: " + error.Message + (lines.Count > 0 ? " | " + string.Join(" | ", lines) : string.Empty));
                throw;
            }
            finally
            {
                RoaGroundWater.Terrain = null;
                RoaGroundWater.Puddles = 0f;
            }
        }

        public static void RunBatch()
        {
            int code = 0;
            try { Run(); }
            catch (Exception) { code = 1; }
            EditorApplication.Exit(code);
        }

        private static void CheckWetSurfaces(List<string> lines)
        {
            Shader lit = Shader.Find("Universal Render Pipeline/Lit");
            Shader unlit = Shader.Find("Universal Render Pipeline/Unlit");
            Require(lit != null && unlit != null, "нет шейдеров URP Lit/Unlit");
            Material asset = FindAssetMaterial();
            Color assetColor = asset.GetColor(BaseColorId);
            float assetSmoothness = asset.GetFloat(SmoothnessId);
            var created = new List<UnityEngine.Object>();
            GameObject host = new GameObject("WetWeatherProbe_Surfaces");
            created.Add(host);
            try
            {
                Material rough = Runtime(lit, "ProbeRough", new Color(0.6f, 0.5f, 0.4f, 1f), 0.1f, 0f, created);
                Material metal = Runtime(lit, "ProbeMetal", new Color(0.7f, 0.7f, 0.72f, 1f), 0.7f, 1f, created);
                Material glass = Runtime(lit, "ProbeGlass", new Color(0.6f, 0.8f, 0.9f, 0.4f), 0.9f, 0f, created);
                glass.SetFloat(SurfaceId, 1f);
                glass.renderQueue = 3000;
                Material mapOnly = Runtime(lit, "ProbeWorldMap", new Color(0.5f, 0.5f, 0.5f, 1f), 0.2f, 0f, created);
                var flat = new Material(unlit) { name = "ProbeUnlit" };
                flat.SetColor(BaseColorId, new Color(0.9f, 0.1f, 0.1f, 1f));
                created.Add(flat);
                Mesh cube = Resources.GetBuiltinResource<Mesh>("Cube.fbx");
                Cube(host, "Asset", cube, asset, 0);
                Cube(host, "Rough", cube, rough, 0);
                Cube(host, "Metal", cube, metal, 0);
                Cube(host, "Glass", cube, glass, 0);
                Cube(host, "Unlit", cube, flat, 0);
                Cube(host, "WorldMap", cube, mapOnly, RoaWorldMap3D.MapLayer);
                Color mapColor = mapOnly.GetColor(BaseColorId);
                // Атлас Synty (почти всё окружение и персонажи) — если пак в проекте.
                Shader synty = Shader.Find("Synty/Generic_Basic");
                Material atlas = synty != null ? Runtime(synty, "ProbeSyntyAtlas", Color.white, 0.2f, 0f, created) : null;
                if (atlas != null) Cube(host, "Synty", cube, atlas, 0);

                RoaWetSurfaces wet = host.AddComponent<RoaWetSurfaces>();
                wet.SetLocalWorldActive(true);
                wet.SetWetness(1f);
                wet.Rescan();
                wet.ApplyNow();
                Require(wet.TryGetDry(asset, out _, out _) && wet.TryGetDry(rough, out _, out _) && wet.TryGetDry(metal, out _, out _),
                    "освещаемые непрозрачные материалы не в реестре влажности");
                Require(!wet.TryGetDry(glass, out _, out _) && !wet.TryGetDry(flat, out _, out _) && !wet.TryGetDry(mapOnly, out _, out _),
                    "в реестр попало стекло, неосвещаемое или карта мира");
                Require(atlas == null || (wet.TryGetDry(atlas, out _, out _) && atlas.GetColor(BaseColorId).r < 0.8f),
                    "атлас Synty не мокнет");

                RoaWetSurfaces.WetValues(new Color(0.6f, 0.5f, 0.4f, 1f), 0.1f, 0f, 1f, out Color roughWet, out float roughGloss);
                Require(Close(rough.GetColor(BaseColorId), roughWet) && Mathf.Abs(rough.GetFloat(SmoothnessId) - roughGloss) < 0.0001f,
                    "шершавый материал не мокрый: " + rough.GetColor(BaseColorId));
                float roughDarken = 1f - rough.GetColor(BaseColorId).r / 0.6f;
                float metalDarken = 1f - metal.GetColor(BaseColorId).r / 0.7f;
                Require(roughDarken > 0.22f && roughDarken < 0.32f && roughGloss >= 0.6f, "шершавое темнеет не на четверть или не блестит");
                Require(metalDarken < 0.05f && metal.GetFloat(SmoothnessId) >= 0.7f, "металл темнеет как ткань: " + metalDarken);
                Require(Close(glass.GetColor(BaseColorId), new Color(0.6f, 0.8f, 0.9f, 0.4f)) && Close(mapOnly.GetColor(BaseColorId), mapColor)
                    && Close(flat.GetColor(BaseColorId), new Color(0.9f, 0.1f, 0.1f, 1f)), "стекло, неосвещаемое или карта мира намокли");
                Require(asset.GetColor(BaseColorId).r < assetColor.r || assetColor.r < 0.01f, "материал-ассет не мокрый");

                // Чужая запись цвета (окраска) — новый сухой цвет; смена одной прозрачности — нет.
                rough.SetColor(BaseColorId, new Color(0.2f, 0.6f, 0.2f, 1f));
                wet.ApplyNow();
                RoaWetSurfaces.WetValues(new Color(0.2f, 0.6f, 0.2f, 1f), 0.1f, 0f, 1f, out Color paintedWet, out _);
                Require(Close(rough.GetColor(BaseColorId), paintedWet), "окраска поверх мокрого не стала сухим цветом");
                Color faded = rough.GetColor(BaseColorId);
                faded.a = 0.4f;
                rough.SetColor(BaseColorId, faded);
                wet.ApplyNow();
                wet.ApplyNow();
                Color afterFade = rough.GetColor(BaseColorId);
                Require(Close(new Color(afterFade.r, afterFade.g, afterFade.b, 1f), paintedWet) && Mathf.Abs(afterFade.a - 0.4f) < 0.0001f,
                    "смена прозрачности копит темноту или сбрасывает прозрачность: " + afterFade);

                // Копия, снятая в дождь (крыша), начинает сухой.
                var copy = new Material(asset) { name = "ProbeRoofCopy" };
                created.Add(copy);
                RoaWetSurfaces.CopyDry(asset, copy);
                Require(Close(copy.GetColor(BaseColorId), assetColor) && Mathf.Abs(copy.GetFloat(SmoothnessId) - assetSmoothness) < 0.0001f,
                    "копия материала, снятая в дождь, осталась мокрой");

                // Высохло — сухое точно; без мира — тоже, и реестр пуст.
                wet.SetWetness(0f);
                wet.ApplyNow();
                Require(asset.GetColor(BaseColorId) == assetColor && asset.GetFloat(SmoothnessId) == assetSmoothness,
                    "высохший материал-ассет не вернулся точно");
                wet.SetWetness(1f);
                wet.ApplyNow();
                wet.SetLocalWorldActive(false);
                Require(asset.GetColor(BaseColorId) == assetColor && asset.GetFloat(SmoothnessId) == assetSmoothness && wet.MaterialCount == 0,
                    "уход из мира не вернул сухое точно");
                lines.Add("мокрые материалы: шершавое темнее на " + roughDarken.ToString("0.00") + ", металл на " + metalDarken.ToString("0.00")
                    + ", атлас Synty " + (atlas != null ? "мокнет" : "не в проекте") + ", ассет " + asset.name + " вернулся точно");
            }
            finally
            {
                // Материал-ассет в любом случае уходит сухим; на диск ничего не пишется.
                asset.SetColor(BaseColorId, assetColor);
                asset.SetFloat(SmoothnessId, assetSmoothness);
                foreach (UnityEngine.Object item in created)
                    if (item != null) UnityEngine.Object.DestroyImmediate(item);
            }
        }

        private static void CheckPuddlesAndSplashes(List<string> lines)
        {
            GameObject host = new GameObject("WetWeatherProbe_Ground");
            GameObject fxHost = new GameObject("WetWeatherProbe_Fx");
            try
            {
                LocationDefinition location = RoaGroundTexturesProbe.Location("probe_puddles", 18, 18, 52917L, "river_loam");
                RoaLocalTerrain terrain = host.AddComponent<RoaLocalTerrain>();
                terrain.Initialize(location, RoaGroundTexturesProbe.Map(18, 18));
                Require(terrain.UsesGroundTextures, "земля не на шейдере Kromka Ground");

                // Маска зоны на CPU: есть тропа и вода.
                bool path = false, water = false;
                for (float x = -17f; x <= 17f && !(path && water); x += 0.5f)
                for (float z = -17f; z <= 17f; z += 0.5f)
                {
                    Color surface = terrain.SurfaceAt(new Vector3(x, 0f, z));
                    path |= surface.r > 0.6f;
                    water |= surface.b > 0.6f;
                }
                Require(path && water, "маска зоны на CPU без тропы или воды");

                // Лужи CPU против шейдера: кадр строго сверху с лужами и без них.
                const float half = 9f;
                const int size = 360;
                SetGround(terrain, 1f, 0f);
                var dry = RoaGroundTexturesProbe.Render(host, "puddles-off", Output, half, size, size, true);
                SetGround(terrain, 1f, 1f);
                var puddles = RoaGroundTexturesProbe.Render(host, "puddles-on", Output, half, size, size, true);
                int agree = 0, total = 0, cpuWet = 0;
                for (int py = 4; py < size; py += 8)
                for (int px = 4; px < size; px += 8)
                {
                    float x = (px + 0.5f) / size * 2f * half - half;
                    float z = (py + 0.5f) / size * 2f * half - half;
                    Color surface = terrain.SurfaceAt(new Vector3(x, 0f, z));
                    if (surface.b > 0.1f) continue;
                    float depth = RoaGroundWater.PuddleDepth(x, z, 1f, surface.r);
                    // У края рельеф текстуры двигает дно на ±0,125 — там CPU не судья.
                    if (Mathf.Abs(depth) < 0.14f) continue;
                    bool changed = Mathf.Abs(Luminance(dry.Pixels[py * size + px]) - Luminance(puddles.Pixels[py * size + px])) > 0.05f;
                    total++;
                    if (depth > 0f) cpuWet++;
                    if (changed == depth > 0f) agree++;
                }
                float agreement = agree / (float)Mathf.Max(1, total);
                lines.Add("лужи CPU/шейдер: согласие " + agreement.ToString("0.00") + " на " + total + " точках (" + cpuWet + " в воде)");
                Require(total > 200 && cpuWet > 20 && cpuWet < total - 20, "на кадре мало уверенных точек луж и суши: " + total + "/" + cpuWet);
                Require(agreement > 0.9f, "лужи на CPU не совпадают с лужами шейдера: " + agreement.ToString("0.00"));

                // Всплеск: шаг в лужу — брызги, круг и плеск; шаг по мокрому — хлюп.
                RoaGroundWater.Terrain = terrain;
                RoaGroundWater.Puddles = 1f;
                Vector3 inPuddle = Vector3.zero, onDry = Vector3.zero;
                bool foundWet = false, foundDry = false;
                for (float x = -8f; x <= 8f && !(foundWet && foundDry); x += 0.25f)
                for (float z = -8f; z <= 8f; z += 0.25f)
                {
                    var point = new Vector3(x, 0f, z);
                    if (terrain.SurfaceAt(point).b > 0.1f) continue;
                    float depth = RoaGroundWater.PuddleDepth(point);
                    if (!foundWet && depth > 0.2f) { inPuddle = point; foundWet = true; }
                    if (!foundDry && depth < -0.2f) { onDry = point; foundDry = true; }
                }
                Require(foundWet && foundDry, "нет точки в луже или на суше");
                Require(RoaGroundWater.InWater(inPuddle) && !RoaGroundWater.InWater(onDry), "InWater не различает лужу и сушу");

                RoaAudio audio = fxHost.AddComponent<RoaAudio>();
                if (audio.GeneratedClipCount == 0)
                    typeof(RoaAudio).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(audio, null);
                Require(audio.WetStepCueReady && audio.GeneratedClipCount == 38, "мокрые шаги и всплеск не собраны: " + audio.GeneratedClipCount);
                RoaMovementFx fx = fxHost.AddComponent<RoaMovementFx>();
                fx.Configure(audio);
                fx.SetGround(1f, 0.5f);
                audio.SetGround(1f, 0.5f);
                Require(audio.WetStepMix > 0.99f, "по мокрой грязи шаг не хлюпает");
                int particles = fx.ActiveParticleCount;
                fx.EmitFootstep(Cue(onDry));
                Require(fx.PuddleSplashCount == 0, "шаг по суше плеснул");
                fx.EmitFootstep(Cue(inPuddle));
                Require(fx.PuddleSplashCount == 1 && fx.ActiveParticleCount > particles && fx.RingCapacity > 0,
                    "шаг в лужу без брызг и круга");
                audio.PlayActorFootstep(Cue(onDry));
                audio.PlayActorFootstep(Cue(inPuddle));
                Require(audio.WetStepCount == 1 && audio.SplashCount == 1, "шаги NPC: хлюп " + audio.WetStepCount + ", плеск " + audio.SplashCount);
                RoaGroundWater.Puddles = 0f;
                Require(!RoaGroundWater.InWater(inPuddle), "без луж по погоде под ногой всё ещё вода");
                audio.SetGround(0.1f, 0f);
                Require(audio.WetStepMix == 0f, "по сухому шаг хлюпает");
                lines.Add("всплески: лужа " + inPuddle + ", суша " + onDry + ", частиц " + fx.ActiveParticleCount);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(fxHost);
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static RoaAudio.FootstepCue Cue(Vector3 position)
        {
            return new RoaAudio.FootstepCue
            {
                Position = position,
                Velocity = new Vector3(3f, 0f, 0f),
                Speed = 3f,
                RightFoot = true,
                NoiseMultiplier = 1f
            };
        }

        private static void SetGround(RoaLocalTerrain terrain, float wetness, float puddles)
        {
            var block = new MaterialPropertyBlock();
            terrain.GroundRenderer.GetPropertyBlock(block);
            block.SetFloat(WetnessId, wetness);
            block.SetFloat(PuddlesId, puddles);
            block.SetFloat(MudId, 0f);
            block.SetFloat(RainId, 0f);
            terrain.GroundRenderer.SetPropertyBlock(block);
        }

        /// <summary>Непрозрачный URP Lit материал-ассет из префабов Кромки.</summary>
        private static Material FindAssetMaterial()
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { "Assets/Prefabs/Kromka", "Assets/Art/Kromka" }))
            {
                var material = AssetDatabase.LoadAssetAtPath<Material>(AssetDatabase.GUIDToAssetPath(guid));
                if (material == null || material.shader == null || material.shader.name != "Universal Render Pipeline/Lit") continue;
                if (material.renderQueue >= 2600 || (material.HasProperty(SurfaceId) && material.GetFloat(SurfaceId) > 0.5f)) continue;
                if (material.GetColor(BaseColorId).r < 0.1f) continue;
                return material;
            }
            throw new InvalidOperationException("нет непрозрачного URP Lit материала-ассета для проверки");
        }

        private static Material Runtime(Shader lit, string name, Color color, float smoothness, float metallic, List<UnityEngine.Object> created)
        {
            var material = new Material(lit) { name = name };
            material.SetColor(BaseColorId, color);
            material.SetFloat(SmoothnessId, smoothness);
            material.SetFloat(MetallicId, metallic);
            created.Add(material);
            return material;
        }

        private static void Cube(GameObject host, string name, Mesh mesh, Material material, int layer)
        {
            var go = new GameObject(name) { layer = layer };
            go.transform.SetParent(host.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        private static bool Close(Color a, Color b)
        {
            return Mathf.Abs(a.r - b.r) < 0.0005f && Mathf.Abs(a.g - b.g) < 0.0005f
                && Mathf.Abs(a.b - b.b) < 0.0005f && Mathf.Abs(a.a - b.a) < 0.0005f;
        }

        private static float Luminance(Color32 c)
        {
            return (0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b) / 255f;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
