#if UNITY_EDITOR
using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Песчаная буря на границе мира вместо токсичного тумана.
    ///
    /// Художественное решение 2026-09-02: край карты закрывает не зелёная
    /// стена, а пыльная буря. Реализация — частицы ВНУТРИ существующего
    /// префаба GM_ToxicBoundaryFog (его файл, меш и материал запинены
    /// контрактом — остаются, меняется наполнение): четыре эмиттера по
    /// сторонам периметра, крупные мягкие клубы с турбулентностью
    /// noise-модуля, единый ветер с северо-востока, прогрев на старте.
    /// Прежняя стена-меш перекрашивается из кислотной зелени в пыльную
    /// дымку — фон за частицами.
    ///
    /// Текстура клуба печётся процедурно (радиальный спад × value-шум) в
    /// Art/GlobalMap/Textures; материал частиц — URP Particles/Unlit.
    /// Инструмент идемпотентен: старые Sandstorm_* внутри префаба
    /// пересоздаются. Сцена не трогается — инстанс обновляется сам.
    /// </summary>
    public static class RoaGlobalMapSandstormAuthoring
    {
        private const string PrefabPath =
            "Assets/Prefabs/GlobalMap/GM_ToxicBoundaryFog.prefab";
        private const string FogMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_ToxicBoundaryFog.mat";
        private const string DustMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_SandstormDust.mat";
        private const string DustTexturePath =
            "Assets/Art/GlobalMap/Textures/GM_SandstormPuff.png";
        private const string DashTexturePath =
            "Assets/Art/GlobalMap/Textures/GM_BoundaryDash.png";
        private const string LineMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_BoundaryLine.mat";
        private const string LineMeshPath =
            "Assets/Art/GlobalMap/Meshes/GM_Mesh_BoundaryLine.asset";
        // Игровая зона 90×90: линия чуть внутри кромки, над землёй (−0.13).
        private const float LineHalfExtent = 44.6f;
        private const float LineWidth = 0.45f;
        private const float LineY = -0.07f;

        // Кольцо эмиттеров: сразу за игровой зоной (selection 90×90,
        // внутренняя кромка тумана 41.5 юнита от центра).
        private const float EmitterDistance = 49f;
        private const float EmitterLength = 116f;

        [MenuItem("Realm of Ashes/Авторинг/Песчаная буря на границе")]
        public static void Apply()
        {
            Texture2D puff = BakePuffTexture();
            Material dust = BuildDustMaterial(puff);
            RetintFogWall();

            Material lineMaterial = BuildLineMaterial();
            Mesh lineMesh = BuildLineMesh();

            GameObject root = PrefabUtility.LoadPrefabContents(PrefabPath);
            try
            {
                // Художественное решение: стена-меш выключена — глубину даёт
                // сама буря. Меш и материал остаются в префабе (запинены
                // контрактом), гаснет только рендерер.
                MeshRenderer wall = root.GetComponent<MeshRenderer>();
                if (wall != null) wall.enabled = false;

                for (int i = root.transform.childCount - 1; i >= 0; i--)
                {
                    Transform child = root.transform.GetChild(i);
                    if (child.name.StartsWith("Sandstorm", StringComparison.Ordinal))
                        UnityEngine.Object.DestroyImmediate(child.gameObject);
                }

                // Чёткая граница для игрока: янтарный пунктир по периметру
                // игровой зоны — читаемое «дальше нельзя» перед стеной бури.
                Transform oldLine = root.transform.Find("BoundaryLine");
                if (oldLine != null)
                    UnityEngine.Object.DestroyImmediate(oldLine.gameObject);
                var line = new GameObject("BoundaryLine",
                    typeof(MeshFilter), typeof(MeshRenderer));
                line.transform.SetParent(root.transform, false);
                line.transform.localPosition = new Vector3(0f, LineY, 0f);
                line.GetComponent<MeshFilter>().sharedMesh = lineMesh;
                MeshRenderer lineRenderer = line.GetComponent<MeshRenderer>();
                lineRenderer.sharedMaterial = lineMaterial;
                lineRenderer.shadowCastingMode =
                    UnityEngine.Rendering.ShadowCastingMode.Off;
                lineRenderer.receiveShadows = false;

                // Ветер один на всю бурю — с северо-востока к юго-западу.
                var wind = new Vector3(-0.38f, 0.02f, -0.23f);
                BuildEmitter(root.transform, "Sandstorm_North",
                    new Vector3(0f, 2.2f, EmitterDistance), 0f, wind);
                BuildEmitter(root.transform, "Sandstorm_South",
                    new Vector3(0f, 2.2f, -EmitterDistance), 0f, wind);
                BuildEmitter(root.transform, "Sandstorm_East",
                    new Vector3(EmitterDistance, 2.2f, 0f), 90f, wind);
                BuildEmitter(root.transform, "Sandstorm_West",
                    new Vector3(-EmitterDistance, 2.2f, 0f), 90f, wind);

                // Низовая пыль: стелющиеся горизонтальные клубы прямо по
                // шву диорамы — прячут геометрический срез края.
                BuildLowDust(root.transform, "SandstormLow_North",
                    new Vector3(0f, 0.55f, 46f), 0f, wind);
                BuildLowDust(root.transform, "SandstormLow_South",
                    new Vector3(0f, 0.55f, -46f), 0f, wind);
                BuildLowDust(root.transform, "SandstormLow_East",
                    new Vector3(46f, 0.55f, 0f), 90f, wind);
                BuildLowDust(root.transform, "SandstormLow_West",
                    new Vector3(-46f, 0.55f, 0f), 90f, wind);

                // Дальний ярус вместо стены: высокие крупные клубы фоном.
                BuildFarWall(root.transform, "SandstormFar_North",
                    new Vector3(0f, 6.5f, 58f), 0f, wind);
                BuildFarWall(root.transform, "SandstormFar_South",
                    new Vector3(0f, 6.5f, -58f), 0f, wind);
                BuildFarWall(root.transform, "SandstormFar_East",
                    new Vector3(58f, 6.5f, 0f), 90f, wind);
                BuildFarWall(root.transform, "SandstormFar_West",
                    new Vector3(-58f, 6.5f, 0f), 90f, wind);

                PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            AssetDatabase.SaveAssets();

            // Сценический инстанс мог нести ручные override'ы стены
            // (материал/включённость) — снимаем, чтобы применилось
            // состояние префаба: стена выключена, буря вместо неё.
            GameObject sceneFog = GameObject.Find("ToxicBoundaryFog_AUTHORED");
            if (sceneFog != null)
            {
                MeshRenderer sceneWall = sceneFog.GetComponent<MeshRenderer>();
                if (sceneWall != null)
                {
                    PrefabUtility.RevertObjectOverride(sceneWall,
                        InteractionMode.AutomatedAction);
                    UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                        sceneFog.scene);
                }
            }
            Debug.Log("[БУРЯ] песчаная буря собрана: стена выключена, ярусы"
                + " частиц по периметру. Префаб и сцена сохранены.");
        }

        // ------------------------------------------------------------------

        private static void BuildEmitter(Transform parent, string name,
            Vector3 position, float yawDeg, Vector3 wind)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localRotation = Quaternion.Euler(0f, yawDeg, 0f);

            var ps = go.AddComponent<ParticleSystem>();
            ParticleSystem.MainModule main = ps.main;
            main.loop = true;
            main.prewarm = true;
            main.duration = 12f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(11f, 17f);
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(9f, 21f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0f,
                Mathf.PI * 2f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.82f, 0.66f, 0.45f, 0.55f),
                new Color(0.62f, 0.47f, 0.30f, 0.35f));
            main.maxParticles = 140;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;

            ParticleSystem.EmissionModule emission = ps.emission;
            emission.rateOverTime = 6.5f;

            ParticleSystem.ShapeModule shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(EmitterLength, 7f, 16f);

            // Постоянный снос ветром: скорость в мировых осях.
            ParticleSystem.VelocityOverLifetimeModule velocity =
                ps.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.World;
            velocity.x = wind.x;
            velocity.y = wind.y;
            velocity.z = wind.z;

            // Турбулентность — главный «характер» бури.
            ParticleSystem.NoiseModule noise = ps.noise;
            noise.enabled = true;
            noise.strength = 1.15f;
            noise.frequency = 0.09f;
            noise.scrollSpeed = 0.16f;
            noise.quality = ParticleSystemNoiseQuality.Medium;

            ParticleSystem.ColorOverLifetimeModule colorOverLife =
                ps.colorOverLifetime;
            colorOverLife.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(Color.white, 1f)
                },
                new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(0.9f, 0.18f),
                    new GradientAlphaKey(0.65f, 0.7f),
                    new GradientAlphaKey(0f, 1f)
                });
            colorOverLife.color = gradient;

            ParticleSystem.RotationOverLifetimeModule rotation =
                ps.rotationOverLifetime;
            rotation.enabled = true;
            rotation.z = new ParticleSystem.MinMaxCurve(
                -12f * Mathf.Deg2Rad, 12f * Mathf.Deg2Rad);

            ParticleSystem.SizeOverLifetimeModule sizeOverLife =
                ps.sizeOverLifetime;
            sizeOverLife.enabled = true;
            sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f,
                AnimationCurve.Linear(0f, 0.75f, 1f, 1.3f));

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial =
                AssetDatabase.LoadAssetAtPath<Material>(DustMaterialPath);
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.maxParticleSize = 3f;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortMode = ParticleSystemSortMode.None;
        }

        private static void BuildLowDust(Transform parent, string name,
            Vector3 position, float yawDeg, Vector3 wind)
        {
            BuildEmitter(parent, name, position, yawDeg, wind * 0.6f);
            var ps = parent.Find(name).GetComponent<ParticleSystem>();
            ParticleSystem.MainModule main = ps.main;
            main.startSize = new ParticleSystem.MinMaxCurve(15f, 27f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.74f, 0.59f, 0.41f, 0.5f),
                new Color(0.58f, 0.45f, 0.3f, 0.34f));
            main.maxParticles = 70;
            ParticleSystem.EmissionModule emission = ps.emission;
            emission.rateOverTime = 4f;
            ParticleSystem.ShapeModule shape = ps.shape;
            shape.scale = new Vector3(EmitterLength, 1f, 11f);
            ParticleSystem.NoiseModule noise = ps.noise;
            noise.strength = 0.55f;
            // Плашмя над землёй — ковёр пыли, а не вертикальные клубы.
            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.HorizontalBillboard;
        }

        private static void BuildFarWall(Transform parent, string name,
            Vector3 position, float yawDeg, Vector3 wind)
        {
            BuildEmitter(parent, name, position, yawDeg, wind * 0.4f);
            var ps = parent.Find(name).GetComponent<ParticleSystem>();
            ParticleSystem.MainModule main = ps.main;
            main.startSize = new ParticleSystem.MinMaxCurve(22f, 38f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.72f, 0.58f, 0.42f, 0.3f),
                new Color(0.56f, 0.44f, 0.3f, 0.2f));
            main.maxParticles = 60;
            ParticleSystem.EmissionModule emission = ps.emission;
            emission.rateOverTime = 2.6f;
            ParticleSystem.ShapeModule shape = ps.shape;
            shape.scale = new Vector3(EmitterLength + 24f, 11f, 18f);
            ParticleSystem.NoiseModule noise = ps.noise;
            noise.strength = 0.7f;
        }

        /// <summary>Кольцо из четырёх лент-квадов с пунктирной UV-развёрткой.</summary>
        private static Mesh BuildLineMesh()
        {
            var mesh = AssetDatabase.LoadAssetAtPath<Mesh>(LineMeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh();
            mesh.name = "GM_Mesh_BoundaryLine";

            float half = LineHalfExtent;
            float w = LineWidth * 0.5f;
            const float dashesPerSide = 64f;
            var vertices = new System.Collections.Generic.List<Vector3>();
            var uv = new System.Collections.Generic.List<Vector2>();
            var triangles = new System.Collections.Generic.List<int>();
            var starts = new[]
            {
                new Vector2(-half, half), new Vector2(half, half),
                new Vector2(half, -half), new Vector2(-half, -half)
            };
            var ends = new[]
            {
                new Vector2(half, half), new Vector2(half, -half),
                new Vector2(-half, -half), new Vector2(-half, half)
            };
            for (int sideIndex = 0; sideIndex < 4; sideIndex++)
            {
                Vector2 a = starts[sideIndex];
                Vector2 b = ends[sideIndex];
                Vector2 dir = (b - a).normalized;
                var n = new Vector2(-dir.y, dir.x);
                int baseIndex = vertices.Count;
                vertices.Add(new Vector3(a.x + n.x * w, 0f, a.y + n.y * w));
                vertices.Add(new Vector3(a.x - n.x * w, 0f, a.y - n.y * w));
                vertices.Add(new Vector3(b.x + n.x * w, 0f, b.y + n.y * w));
                vertices.Add(new Vector3(b.x - n.x * w, 0f, b.y - n.y * w));
                uv.Add(new Vector2(0f, 0f));
                uv.Add(new Vector2(0f, 1f));
                uv.Add(new Vector2(dashesPerSide, 0f));
                uv.Add(new Vector2(dashesPerSide, 1f));
                triangles.AddRange(new[]
                {
                    baseIndex, baseIndex + 2, baseIndex + 1,
                    baseIndex + 1, baseIndex + 2, baseIndex + 3
                });
            }
            mesh.Clear();
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            if (fresh) AssetDatabase.CreateAsset(mesh, LineMeshPath);
            else EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static Material BuildLineMaterial()
        {
            // Пунктир: одна плашка с мягкими краями, тиражируется UV-ами.
            const int width = 128, height = 16;
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                float dx = Mathf.InverseLerp(6f, 20f, x)
                    * (1f - Mathf.InverseLerp(76f, 90f, x));
                float dy = 1f - Mathf.Abs(y - height * 0.5f) / (height * 0.5f);
                float alpha = Mathf.Clamp01(dx) * Mathf.SmoothStep(0f, 1f, dy);
                texture.SetPixel(x, y, new Color(1f, 1f, 1f, alpha));
            }
            texture.Apply();
            File.WriteAllBytes(DashTexturePath, texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(DashTexturePath);
            var importer = AssetImporter.GetAtPath(DashTexturePath) as TextureImporter;
            if (importer != null && (importer.maxTextureSize != 128
                || importer.wrapMode != TextureWrapMode.Repeat))
            {
                importer.maxTextureSize = 128;
                importer.wrapMode = TextureWrapMode.Repeat;
                importer.alphaIsTransparency = true;
                importer.SaveAndReimport();
            }

            // Собственный шейдер: бегущий пунктир + пульс + вспышка отказа
            // (рантайм ставит _FlashCenter/_FlashStart при клике за границу).
            Shader shader = Shader.Find(
                "Universal Render Pipeline/Realm of Ashes/Global Map Boundary Line")
                ?? throw new InvalidOperationException(
                    "Шейдер линии границы не найден.");
            var material = AssetDatabase.LoadAssetAtPath<Material>(LineMaterialPath);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, LineMaterialPath);
            }
            material.shader = shader;
            material.SetTexture("_BaseMap",
                AssetDatabase.LoadAssetAtPath<Texture2D>(DashTexturePath));
            // Янтарь тревоги: тёпло-жёлтый, читается и на песке, и в буре.
            material.SetColor("_BaseColor", new Color(1f, 0.72f, 0.22f, 0.85f));
            material.SetColor("_FlashColor", new Color(1f, 0.22f, 0.12f, 1f));
            material.SetFloat("_ScrollSpeed", 0.5f);
            material.SetFloat("_PulseSpeed", 0.9f);
            material.SetFloat("_PulseAmount", 0.28f);
            material.SetFloat("_FlashStart", -100f);
            EditorUtility.SetDirty(material);
            return material;
        }

        // ------------------------------------------------------------------

        private static Texture2D BakePuffTexture()
        {
            string folder = Path.GetDirectoryName(DustTexturePath);
            if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);

            const int size = 256;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float nx = (x + 0.5f) / size - 0.5f;
                float ny = (y + 0.5f) / size - 0.5f;
                float radial = Mathf.Clamp01(1f - Mathf.Sqrt(nx * nx + ny * ny) * 2f);
                float noise =
                    Mathf.PerlinNoise(x * 0.035f + 7.1f, y * 0.035f + 3.7f) * 0.65f
                    + Mathf.PerlinNoise(x * 0.11f + 19.3f, y * 0.11f + 11.9f) * 0.35f;
                float alpha = Mathf.Pow(radial, 1.6f) * Mathf.Lerp(0.55f, 1f, noise);
                texture.SetPixel(x, y, new Color(1f, 1f, 1f, alpha));
            }
            texture.Apply();
            File.WriteAllBytes(DustTexturePath, texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(DustTexturePath);
            var importer = AssetImporter.GetAtPath(DustTexturePath) as TextureImporter;
            if (importer != null)
            {
                importer.maxTextureSize = 256;
                importer.alphaIsTransparency = true;
                importer.SaveAndReimport();
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(DustTexturePath);
        }

        private static Material BuildDustMaterial(Texture2D puff)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Particles/Unlit")
                ?? throw new InvalidOperationException(
                    "URP Particles/Unlit не найден.");
            var material = AssetDatabase.LoadAssetAtPath<Material>(DustMaterialPath);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, DustMaterialPath);
            }
            material.shader = shader;
            material.SetTexture("_BaseMap", puff);
            material.SetColor("_BaseColor", Color.white);
            // Прозрачное альфа-смешение, мягкие частицы у земли.
            material.SetFloat("_Surface", 1f);
            material.SetFloat("_Blend", 0f);
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            material.SetFloat("_SrcBlend",
                (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            material.SetFloat("_DstBlend",
                (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHATEST_ON");
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void RetintFogWall()
        {
            var fog = AssetDatabase.LoadAssetAtPath<Material>(FogMaterialPath);
            if (fog == null) return;
            if (fog.HasProperty("_DarkColor"))
                fog.SetColor("_DarkColor", new Color(0.14f, 0.1f, 0.06f));
            if (fog.HasProperty("_ToxicColor"))
                fog.SetColor("_ToxicColor", new Color(0.46f, 0.35f, 0.22f));
            if (fog.HasProperty("_GlowColor"))
                fog.SetColor("_GlowColor", new Color(0.66f, 0.5f, 0.3f));
            if (fog.HasProperty("_BoundaryColor"))
                fog.SetColor("_BoundaryColor", new Color(0.55f, 0.42f, 0.26f));
            EditorUtility.SetDirty(fog);
        }
    }
}
#endif
