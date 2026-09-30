using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// То, что буря рисует в сцене: стены пыли на передней и задней кромке (там,
    /// где кромка проходит по рамке сцены), песок и тучи вокруг игрока, молнии со
    /// вспышкой. Всё строится кодом; шейдеры лежат в Resources/RealmOfAshes.
    /// </summary>
    public sealed partial class RoaRadiationStorm
    {
        private const int WallSegments = 48;
        private const float WallHalfSpan = 120f;
        private const float WallHeight = 46f;
        private const float WallCullMetres = 650f;
        private const float StrikeHeight = 72f;

        private sealed class Bolt
        {
            public GameObject Root;
            public LineRenderer Core;
            public LineRenderer Glow;
            public LineRenderer Branch;
            public Light Light;
            public Vector3 Top;
            public Vector3 Ground;
            public float StartedAt = -10f;
            public float Power;
            public bool Rejagged;
        }

        private GameObject _visualRoot;
        private Mesh _wallMesh;
        private MeshRenderer _wallRenderer;
        private Material _wallMaterial;
        private Material _dustMaterial;
        private Material _boltMaterial;
        private ParticleSystem _streaks;
        private ParticleSystem _puffs;
        private Bolt[] _bolts;
        private int _nextBolt;
        private float _flash;
        private float _nextStrikeAt;
        private Canvas _flashCanvas;
        private Image _flashImage;
        private bool _lowQuality;
        private readonly List<Vector3> _wallVertices = new List<Vector3>();
        private readonly List<Vector2> _wallUvs = new List<Vector2>();
        private readonly List<Color> _wallColors = new List<Color>();
        private readonly List<int> _wallTriangles = new List<int>();
        private readonly Vector2[] _edgeLine = new Vector2[WallSegments + 1];
        private readonly float[] _edgeAcross = new float[WallSegments + 1];

        /// <summary>
        /// Оси бури в сцене: dl — куда она идёт (единичный вектор по x, z), nl — вдоль
        /// фронта, kmPerMetre — сколько километров карты в метре сцены вдоль dl.
        /// </summary>
        public bool LocalAxes(out Vector2 dl, out Vector2 nl, out float kmPerMetre)
        {
            dl = Vector2.right;
            nl = Vector2.up;
            kmPerMetre = 0f;
            if (Path == null || !Frame.Valid) return false;
            var raw = new Vector2((float)(Path.DirX / Frame.Kx), (float)(Path.DirY / Frame.Kz));
            if (raw.sqrMagnitude < 1e-12f) return false;
            dl = raw.normalized;
            nl = new Vector2(-dl.y, dl.x);
            kmPerMetre = (float)(dl.x * Frame.Kx * Path.DirX + dl.y * Frame.Kz * Path.DirY);
            return kmPerMetre > 1e-6f;
        }

        private void UpdateVisuals(Vector3 player, bool local, double now)
        {
            if (!local && Presence <= 0.001f && _flash <= 0.001f)
            {
                HideVisuals();
                return;
            }
            EnsureVisuals();
            _lowQuality = Application.isMobilePlatform || QualitySettings.GetQualityLevel() <= 1;
            bool axes = LocalAxes(out Vector2 dl, out Vector2 nl, out float kmPerMetre);
            _wallRenderer.enabled = local && axes && BuildWalls(player, dl, nl, kmPerMetre, now);
            UpdateDust(player, local && axes, dl);
            UpdateScreen(player, local && axes, dl);
            UpdateLightning(player, local && axes, dl, nl, kmPerMetre);
            UpdateBolts();
            UpdateFlashOverlay();
        }

        // --- стены --------------------------------------------------------------------------------------

        private bool BuildWalls(Vector3 player, Vector2 dl, Vector2 nl, float kmPerMetre, double now)
        {
            _wallVertices.Clear();
            _wallUvs.Clear();
            _wallColors.Clear();
            _wallTriangles.Clear();
            var origin = new Vector2(player.x, player.z);
            float groundY = player.y - 1.2f;
            bool lead = AddEdgeWall(origin, dl, nl, kmPerMetre, groundY, now, true);
            bool trail = AddEdgeWall(origin, dl, nl, kmPerMetre, groundY, now, false);
            _wallMesh.Clear();
            if (!lead && !trail) return false;
            _wallMesh.SetVertices(_wallVertices);
            _wallMesh.SetUVs(0, _wallUvs);
            _wallMesh.SetColors(_wallColors);
            _wallMesh.SetTriangles(_wallTriangles, 0);
            _wallMesh.RecalculateBounds();
            return true;
        }

        /// <summary>
        /// Стена по кромке: точки кромки — там, где на неё ложится рамка сцены, по
        /// обе стороны от игрока. Три слоя вглубь бури: передний (по кромке) и два
        /// за ним — стена читается толстой, а не плёнкой.
        /// </summary>
        private bool AddEdgeWall(Vector2 origin, Vector2 dl, Vector2 nl, float kmPerMetre, float groundY, double now, bool lead)
        {
            float nearest = float.MaxValue;
            for (int i = 0; i <= WallSegments; i++)
            {
                float s = Mathf.Lerp(-WallHalfSpan, WallHalfSpan, i / (float)WallSegments);
                Vector2 b = origin + nl * s;
                Vector2 g = Frame.LocalToGlobal(b.x, b.y);
                double p = Path.Along(g.x, g.y);
                double q = Path.Across(g.x, g.y);
                double edge = lead ? Path.LeadAt(q, now) : Path.TrailAt(q, now);
                float metres = (float)((edge - p) / kmPerMetre);
                _edgeLine[i] = b + dl * metres;
                _edgeAcross[i] = (float)q;
                nearest = Mathf.Min(nearest, Mathf.Abs(metres));
            }
            if (nearest > WallCullMetres) return false;
            // Внутрь бури: от передней кромки — назад по ходу, от задней — вперёд.
            Vector2 inward = lead ? -dl : dl;
            float alpha = lead ? 1f : 0.62f;
            AddRibbon(inward * 18f, groundY, WallHeight * 1.3f, new Color(0.62f, 0.66f, 0.5f, 0.8f * alpha), 37f);
            AddRibbon(inward * 6f, groundY, WallHeight * 1.1f, new Color(0.8f, 0.82f, 0.68f, 0.85f * alpha), 19f);
            AddRibbon(Vector2.zero, groundY, WallHeight, new Color(1f, 1f, 1f, 0.95f * alpha), 0f);
            return true;
        }

        private void AddRibbon(Vector2 offset, float baseY, float height, Color color, float uvShift)
        {
            int first = _wallVertices.Count;
            float fadeSpan = WallSegments * 0.18f;
            for (int i = 0; i <= WallSegments; i++)
            {
                Vector2 w = _edgeLine[i] + offset;
                Color c = color;
                c.a *= Mathf.Clamp01(Mathf.Min(i, WallSegments - i) / fadeSpan);
                float u = _edgeAcross[i] * 0.9f + uvShift;
                _wallVertices.Add(new Vector3(w.x, baseY, w.y));
                _wallVertices.Add(new Vector3(w.x, baseY + height, w.y));
                _wallUvs.Add(new Vector2(u, 0f));
                _wallUvs.Add(new Vector2(u, 1f));
                _wallColors.Add(c);
                _wallColors.Add(c);
            }
            for (int i = 0; i < WallSegments; i++)
            {
                int a = first + i * 2;
                _wallTriangles.Add(a); _wallTriangles.Add(a + 2); _wallTriangles.Add(a + 1);
                _wallTriangles.Add(a + 1); _wallTriangles.Add(a + 2); _wallTriangles.Add(a + 3);
            }
        }

        // --- песок и тучи -------------------------------------------------------------------------------

        private void UpdateDust(Vector3 player, bool local, Vector2 dl)
        {
            float presence = local ? Presence : 0f;
            var wind3 = new Vector3(dl.x, 0f, dl.y);
            float windSpeed = Mathf.Lerp(5f, 24f, presence);
            UpdateDustSystem(_streaks, player, wind3, windSpeed, presence * presence * (_lowQuality ? 320f : 950f), 1.1f);
            UpdateDustSystem(_puffs, player, wind3, windSpeed * 0.45f, presence * (_lowQuality ? 8f : 22f), 3.5f);
        }

        private static void UpdateDustSystem(ParticleSystem system, Vector3 player, Vector3 wind, float speed, float rate, float lifetime)
        {
            if (system == null) return;
            // Облако рождается выше по ветру и проносится через кадр.
            system.transform.position = player - wind * (speed * lifetime * 0.45f) + Vector3.up * 4f;
            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = rate;
            ParticleSystem.VelocityOverLifetimeModule velocity = system.velocityOverLifetime;
            Vector3 v = wind * speed;
            velocity.x = new ParticleSystem.MinMaxCurve(v.x * 0.8f, v.x * 1.2f);
            velocity.y = new ParticleSystem.MinMaxCurve(-0.6f, 1.4f);
            velocity.z = new ParticleSystem.MinMaxCurve(v.z * 0.8f, v.z * 1.2f);
            if (rate > 0.01f && !system.isPlaying) system.Play();
        }

        private ParticleSystem CreateDust(string name, bool streaks)
        {
            var go = new GameObject(name);
            go.transform.SetParent(_visualRoot.transform, false);
            ParticleSystem system = go.AddComponent<ParticleSystem>();
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            ParticleSystem.MainModule main = system.main;
            main.loop = true;
            main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = streaks ? 1500 : 110;
            main.startSpeed = 0f;
            main.gravityModifier = 0f;
            main.startLifetime = streaks ? new ParticleSystem.MinMaxCurve(0.7f, 1.4f) : new ParticleSystem.MinMaxCurve(2.8f, 4.6f);
            main.startSize = streaks ? new ParticleSystem.MinMaxCurve(0.12f, 0.34f) : new ParticleSystem.MinMaxCurve(6f, 14f);
            main.startRotation = streaks ? new ParticleSystem.MinMaxCurve(0f) : new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
            main.startColor = streaks
                ? new ParticleSystem.MinMaxGradient(new Color(0.66f, 0.61f, 0.44f, 0.62f), new Color(0.72f, 0.96f, 0.48f, 0.85f))
                : new ParticleSystem.MinMaxGradient(new Color(0.27f, 0.28f, 0.19f, 0.24f), new Color(0.33f, 0.39f, 0.22f, 0.34f));
            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = 0f;
            ParticleSystem.ShapeModule shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = streaks ? new Vector3(50f, 9f, 50f) : new Vector3(62f, 7f, 62f);
            ParticleSystem.VelocityOverLifetimeModule velocity = system.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.World;
            velocity.x = new ParticleSystem.MinMaxCurve(0f, 0f);
            velocity.y = new ParticleSystem.MinMaxCurve(0f, 0f);
            velocity.z = new ParticleSystem.MinMaxCurve(0f, 0f);
            ParticleSystem.ColorOverLifetimeModule fade = system.colorOverLifetime;
            fade.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, 0.18f), new GradientAlphaKey(1f, 0.7f), new GradientAlphaKey(0f, 1f) });
            fade.color = new ParticleSystem.MinMaxGradient(gradient);
            if (streaks)
            {
                ParticleSystem.NoiseModule noise = system.noise;
                noise.enabled = true;
                noise.strength = 0.9f;
                noise.frequency = 0.35f;
                noise.quality = ParticleSystemNoiseQuality.Low;
            }
            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = streaks ? ParticleSystemRenderMode.Stretch : ParticleSystemRenderMode.Billboard;
            renderer.velocityScale = streaks ? 0.05f : 0f;
            renderer.lengthScale = streaks ? 4f : 1f;
            renderer.sharedMaterial = _dustMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return system;
        }

        // --- молнии -------------------------------------------------------------------------------------

        private void UpdateLightning(Vector3 player, bool local, Vector2 dl, Vector2 nl, float kmPerMetre)
        {
            if (!local || Time.time < _nextStrikeAt) return;
            float strength = 0.75f + 0.25f * Path.Strength;
            var dl3 = new Vector3(dl.x, 0f, dl.y);
            var nl3 = new Vector3(nl.x, 0f, nl.y);
            RoaRadiationStormPath.Sample here = Here;
            if (here.Inside)
            {
                // В буре молнии бьют вокруг, чаще — туда, куда смотрит камера.
                Strike(RandomGroundAround(player, 7f, 44f), Random.Range(0.7f, 1f));
                _nextStrikeAt = Time.time + Random.Range(0.8f, 2.6f) / strength;
            }
            else if (here.AheadKm > 0d && here.AheadKm < FeelAheadKm)
            {
                // Перед фронтом молнии бьют в стену бури; если стена далеко — только вспышка и раскат.
                float wallMetres = (float)(here.AheadKm / kmPerMetre);
                float closeness = 1f - (float)(here.AheadKm / FeelAheadKm);
                if (wallMetres < 170f)
                {
                    Vector3 at = player + dl3 * (wallMetres - Random.Range(2f, 26f)) + nl3 * Random.Range(-45f, 45f);
                    Strike(new Vector3(at.x, player.y, at.z), Random.Range(0.65f, 0.95f));
                }
                else DistantFlash(0.2f + 0.35f * closeness, Random.Range(1.2f, 4f), 0.35f + 0.45f * closeness);
                _nextStrikeAt = Time.time + Random.Range(2.4f, 5.6f) / strength;
            }
            else if (here.AheadKm > 0d && here.AheadKm < FeelAheadKm * 3d)
            {
                DistantFlash(0.1f, Random.Range(3f, 7f), 0.22f);
                _nextStrikeAt = Time.time + Random.Range(6f, 13f);
            }
            else if (!here.Inside && here.BehindKm > 0d && here.BehindKm < TailKm)
            {
                DistantFlash(0.16f, Random.Range(2f, 5f), 0.3f);
                _nextStrikeAt = Time.time + Random.Range(4f, 9f);
            }
            else _nextStrikeAt = Time.time + 2f;
        }

        private static Vector3 RandomGroundAround(Vector3 player, float min, float max)
        {
            float angle = Random.Range(0f, Mathf.PI * 2f);
            Camera camera = Camera.main;
            if (camera != null && Random.value < 0.6f)
            {
                Vector3 forward = camera.transform.forward;
                forward.y = 0f;
                if (forward.sqrMagnitude > 1e-4f)
                    angle = Mathf.Atan2(forward.z, forward.x) + Random.Range(-0.7f, 0.7f);
            }
            float distance = Random.Range(min, max);
            return new Vector3(player.x + Mathf.Cos(angle) * distance, player.y, player.z + Mathf.Sin(angle) * distance);
        }

        private void Strike(Vector3 ground, float power)
        {
            EnsureBolts();
            Bolt bolt = _bolts[_nextBolt];
            _nextBolt = (_nextBolt + 1) % _bolts.Length;
            bolt.Ground = ground;
            bolt.Top = ground + new Vector3(Random.Range(-12f, 12f), StrikeHeight, Random.Range(-12f, 12f));
            bolt.Power = power;
            bolt.StartedAt = Time.time;
            bolt.Rejagged = false;
            Jag(bolt);
            bolt.Root.SetActive(true);
            bolt.Light.enabled = !_lowQuality;
            bolt.Light.transform.position = ground + Vector3.up * 2.5f;
            _flash = Mathf.Max(_flash, power);
            Transform player = _bootstrap != null && _bootstrap.PlayerView != null ? _bootstrap.PlayerView.transform : null;
            float distance = player != null ? Vector3.Distance(player.position, ground) : 40f;
            QueueThunder(Mathf.Clamp(distance / 340f, 0.02f, 0.5f), Mathf.Lerp(1f, 0.55f, Mathf.InverseLerp(10f, 120f, distance)), true);
            if (distance < 30f && _bootstrap != null && _bootstrap.CameraRig != null)
                _bootstrap.CameraRig.AddImpulse(0.09f + 0.08f * power);
        }

        private void DistantFlash(float power, float thunderDelay, float thunderVolume)
        {
            _flash = Mathf.Max(_flash, power);
            QueueThunder(thunderDelay, thunderVolume, false);
        }

        private static void Jag(Bolt bolt)
        {
            SetJagged(bolt.Core, bolt.Top, bolt.Ground, 7f);
            var points = new Vector3[bolt.Core.positionCount];
            bolt.Core.GetPositions(points);
            bolt.Glow.positionCount = points.Length;
            bolt.Glow.SetPositions(points);
            // Ветка отходит низко, где её видит камера сверху.
            Vector3 fork = points[points.Length * 4 / 5];
            Vector3 end = bolt.Ground + new Vector3(Random.Range(-7f, 7f), Random.Range(0.5f, 3f), Random.Range(-7f, 7f));
            SetJagged(bolt.Branch, fork, end, 2.2f);
        }

        /// <summary>Ломаная молнии: середина отрезка смещается вбок на каждом уровне деления.</summary>
        private static void SetJagged(LineRenderer line, Vector3 from, Vector3 to, float spread)
        {
            const int levels = 5;
            var points = new List<Vector3> { from, to };
            float offset = spread;
            for (int level = 0; level < levels; level++)
            {
                var next = new List<Vector3>(points.Count * 2);
                for (int i = 0; i < points.Count - 1; i++)
                {
                    next.Add(points[i]);
                    Vector3 middle = (points[i] + points[i + 1]) * 0.5f;
                    middle += new Vector3(Random.Range(-offset, offset), Random.Range(-offset, offset) * 0.3f, Random.Range(-offset, offset));
                    next.Add(middle);
                }
                next.Add(points[points.Count - 1]);
                points = next;
                offset *= 0.55f;
            }
            line.positionCount = points.Count;
            line.SetPositions(points.ToArray());
        }

        private void UpdateBolts()
        {
            _flash = Mathf.MoveTowards(_flash, 0f, Time.deltaTime * 4.5f);
            if (_bolts == null) return;
            foreach (Bolt bolt in _bolts)
            {
                if (bolt.Root == null || !bolt.Root.activeSelf) continue;
                float age = Time.time - bolt.StartedAt;
                const float life = 0.34f;
                if (age >= life)
                {
                    bolt.Root.SetActive(false);
                    continue;
                }
                if (!bolt.Rejagged && age > 0.1f)
                {
                    bolt.Rejagged = true;
                    Jag(bolt);
                }
                // Молния мерцает: три удара по одному каналу и затухание.
                bool lit = age < 0.06f || (age > 0.1f && age < 0.16f) || (age > 0.22f && age < 0.26f);
                float fade = 1f - age / life;
                float strength = (lit ? 1f : 0.22f) * fade;
                if (lit) _flash = Mathf.Max(_flash, bolt.Power * 0.8f * fade);
                SetLineAlpha(bolt.Core, new Color(1f, 1f, 1f, strength));
                SetLineAlpha(bolt.Glow, new Color(0.5f, 1f, 0.4f, 0.55f * strength));
                SetLineAlpha(bolt.Branch, new Color(0.92f, 1f, 0.9f, 0.85f * strength));
                bolt.Light.intensity = 7f * bolt.Power * strength;
            }
        }

        private static void SetLineAlpha(LineRenderer line, Color color)
        {
            line.startColor = color;
            line.endColor = color;
        }

        private void EnsureBolts()
        {
            if (_bolts != null) return;
            _bolts = new Bolt[3];
            for (int i = 0; i < _bolts.Length; i++)
            {
                var root = new GameObject("StormBolt" + i);
                root.transform.SetParent(_visualRoot.transform, false);
                var bolt = new Bolt
                {
                    Root = root,
                    Glow = BoltLine(root.transform, "Glow", 0.9f),
                    Core = BoltLine(root.transform, "Core", 0.22f),
                    Branch = BoltLine(root.transform, "Branch", 0.12f)
                };
                var lightObject = new GameObject("Light");
                lightObject.transform.SetParent(root.transform, false);
                bolt.Light = lightObject.AddComponent<Light>();
                bolt.Light.type = LightType.Point;
                bolt.Light.range = 34f;
                bolt.Light.color = new Color(0.78f, 1f, 0.8f);
                bolt.Light.shadows = LightShadows.None;
                root.SetActive(false);
                _bolts[i] = bolt;
            }
        }

        private LineRenderer BoltLine(Transform parent, string name, float width)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            LineRenderer line = go.AddComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.widthMultiplier = width;
            line.numCapVertices = 2;
            line.sharedMaterial = _boltMaterial;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }

        // --- вспышка на экране -------------------------------------------------------------------------

        private void UpdateFlashOverlay()
        {
            float alpha = RoaGameBootstrap.BlocksWorldHud ? 0f : _flash * 0.16f * (Sheltered ? 0.7f : 1f);
            if (alpha <= 0.004f)
            {
                if (_flashCanvas != null && _flashCanvas.gameObject.activeSelf) _flashCanvas.gameObject.SetActive(false);
                return;
            }
            if (_flashCanvas == null)
            {
                var canvasObject = new GameObject("StormFlashCanvas", typeof(RectTransform), typeof(Canvas));
                canvasObject.transform.SetParent(transform, false);
                _flashCanvas = canvasObject.GetComponent<Canvas>();
                _flashCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
                // Под виньеткой урона (65) и HUD, поверх мира.
                _flashCanvas.sortingOrder = 64;
                var image = new GameObject("Flash", typeof(RectTransform), typeof(Image));
                image.transform.SetParent(canvasObject.transform, false);
                var rect = image.GetComponent<RectTransform>();
                rect.anchorMin = Vector2.zero;
                rect.anchorMax = Vector2.one;
                rect.offsetMin = rect.offsetMax = Vector2.zero;
                _flashImage = image.GetComponent<Image>();
                _flashImage.raycastTarget = false;
            }
            if (!_flashCanvas.gameObject.activeSelf) _flashCanvas.gameObject.SetActive(true);
            _flashImage.color = new Color(0.86f, 1f, 0.86f, alpha);
        }

        // --- создание и уборка --------------------------------------------------------------------------

        private void EnsureVisuals()
        {
            if (_visualRoot != null)
            {
                if (!_visualRoot.activeSelf) _visualRoot.SetActive(true);
                return;
            }
            _visualRoot = new GameObject("RadiationStorm");
            _wallMaterial = new Material(LoadShader("RealmOfAshes/StormWall", "RealmOfAshes/Storm Wall")) { name = "StormWall" };
            _wallMaterial.SetVector("_NoiseScale", new Vector4(3f, 4.6f, 0f, 0f));
            _wallMaterial.SetVector("_Scroll", new Vector4(0.08f, 0.3f, 0f, 0f));
            _dustMaterial = new Material(LoadShader("RealmOfAshes/StormDust", "RealmOfAshes/Storm Dust")) { name = "StormDust" };
            _boltMaterial = new Material(Shader.Find("Sprites/Default")) { name = "StormBolt" };
            var wall = new GameObject("Walls");
            wall.transform.SetParent(_visualRoot.transform, false);
            _wallMesh = new Mesh { name = "StormWalls" };
            _wallMesh.MarkDynamic();
            wall.AddComponent<MeshFilter>().sharedMesh = _wallMesh;
            _wallRenderer = wall.AddComponent<MeshRenderer>();
            _wallRenderer.sharedMaterial = _wallMaterial;
            _wallRenderer.shadowCastingMode = ShadowCastingMode.Off;
            _wallRenderer.receiveShadows = false;
            _streaks = CreateDust("StormStreaks", true);
            _puffs = CreateDust("StormClouds", false);
        }

        private static Shader LoadShader(string resource, string shaderName)
        {
            Shader shader = Resources.Load<Shader>(resource);
            if (shader == null) shader = Shader.Find(shaderName);
            return shader != null ? shader : Shader.Find("Sprites/Default");
        }

        /// <summary>Снимок миникарты: погасить стены, пыль и молнии на один кадр.</summary>
        public void HideForSnapshot(List<Renderer> hidden)
        {
            if (_visualRoot == null || !_visualRoot.activeInHierarchy) return;
            foreach (Renderer renderer in _visualRoot.GetComponentsInChildren<Renderer>(false))
            {
                if (renderer == null || !renderer.enabled) continue;
                renderer.enabled = false;
                hidden.Add(renderer);
            }
        }

        private void HideVisuals()
        {
            if (_visualRoot == null || !_visualRoot.activeSelf) return;
            if (_wallRenderer != null) _wallRenderer.enabled = false;
            if (_streaks != null) _streaks.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            if (_puffs != null) _puffs.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            if (_flashCanvas != null) _flashCanvas.gameObject.SetActive(false);
            HideScreen();
            _visualRoot.SetActive(false);
        }

        private void ReleaseVisuals()
        {
            if (_visualRoot != null) Destroy(_visualRoot);
            if (_flashCanvas != null) Destroy(_flashCanvas.gameObject);
            if (_wallMesh != null) Destroy(_wallMesh);
            if (_wallMaterial != null) Destroy(_wallMaterial);
            if (_dustMaterial != null) Destroy(_dustMaterial);
            if (_boltMaterial != null) Destroy(_boltMaterial);
            ReleaseScreen();
            _visualRoot = null;
            _bolts = null;
        }
    }
}
