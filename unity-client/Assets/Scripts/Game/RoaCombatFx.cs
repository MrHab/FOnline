using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Pooled visual-only combat effects. Damage stays authoritative; this
    /// component consumes the same volatile shot relay as the web client.
    /// </summary>
    public sealed class RoaCombatFx : MonoBehaviour
    {
        public struct WeaponFxProfile
        {
            public Color Tracer;
            public Color Flash;
            public Color Light;
            public float TracerLife;
            public float FlashLife;
        }

        public struct SpeechBubble
        {
            public string Id;
            public string Text;
            public Vector3 World;
            public float Opacity;
        }

        private sealed class TracerFx
        {
            public GameObject Root;
            public LineRenderer Line;
            public Material Material;
            public float Started;
            public float Life;
            public bool Active;
        }

        private sealed class FlashFx
        {
            public GameObject Root;
            public Renderer Renderer;
            public Material Material;
            public Light Light;
            public Color Color;
            public float Started;
            public float Life;
            public bool Active;
        }

        private sealed class ImpactFx
        {
            public GameObject Root;
            public Material Material;
            public float Started;
            public float Life;
            public bool Active;
        }

        private sealed class ExplosionFx
        {
            public GameObject Root;
            public LineRenderer Ring;
            public Material RingMaterial;
            public Renderer Core;
            public Material CoreMaterial;
            public Light Light;
            public float Radius;
            public float Started;
            public const float Life = 0.46f;
        }

        private const int InitialTracerPool = 24;
        private const int InitialFlashPool = 16;
        private const int InitialImpactPool = 20;
        private const float DefaultShotDistance = 18f;

        private readonly List<TracerFx> _tracers = new List<TracerFx>();
        private readonly List<FlashFx> _flashes = new List<FlashFx>();
        private readonly List<ImpactFx> _impacts = new List<ImpactFx>();
        private readonly List<ExplosionFx> _explosions = new List<ExplosionFx>();
        private readonly List<SpeechBubble> _speech = new List<SpeechBubble>();

        public RoaAudio Audio;

        private RoaSocketClient _socket;
        private RoaEnemies _enemies;
        private bool _subscribed;
        private GUIStyle _speechStyle;

        public int ActiveTracerCount { get; private set; }
        public int ActiveFlashCount { get; private set; }
        public int ActiveImpactCount { get; private set; }
        public int ActiveExplosionCount { get { return _explosions.Count; } }

        public void Configure(RoaSocketClient socket, RoaEnemies enemies)
        {
            Unsubscribe();
            _socket = socket;
            _enemies = enemies;
            EnsurePools();
            Subscribe();
        }

        private void OnEnable()
        {
            Subscribe();
        }

        private void OnDisable()
        {
            Unsubscribe();
            Clear();
        }

        private void OnDestroy()
        {
            Unsubscribe();
            DestroyPools();
        }

        private void Subscribe()
        {
            if (_subscribed || _socket == null) return;
            _socket.OnShot += HandleShot;
            _subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!_subscribed || _socket == null) return;
            _socket.OnShot -= HandleShot;
            _subscribed = false;
        }

        private void HandleShot(JObject payload)
        {
            if (payload == null || payload["fxSuppressed"]?.ToObject<bool>() == true) return;
            if (_socket == null || string.IsNullOrEmpty(_socket.Session?.RoomId)) return;
            string locationId = payload["locationId"]?.ToString();
            if (!string.IsNullOrEmpty(locationId)
                && !string.Equals(locationId, _socket.Session.LocationId, StringComparison.Ordinal)) return;
            Vector3 start;
            Vector3 end;
            if (!TryShotEndpoints(payload, out start, out end)) return;
            PlayShot(start, end, payload["weapon"]?.ToString());
        }

        public void PlayShot(Vector3 start, Vector3 end, string weaponId)
        {
            EnsurePools();
            WeaponFxProfile profile = ProfileFor(weaponId);
            Vector3 direction = end - start;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) direction = Vector3.forward;
            else direction.Normalize();

            start += direction * 0.34f;
            start.y = Mathf.Max(start.y, 1.05f);
            end.y = Mathf.Max(end.y, 1.02f);
            Audio?.PlayShot(start, end, weaponId);

            TracerFx tracer = AcquireTracer();
            tracer.Line.positionCount = 2;
            tracer.Line.SetPosition(0, start);
            tracer.Line.SetPosition(1, end);
            SetMaterialColor(tracer.Material, profile.Tracer, 0.88f);
            tracer.Started = Time.unscaledTime;
            tracer.Life = profile.TracerLife;
            tracer.Active = true;
            tracer.Root.SetActive(true);

            FlashFx flash = AcquireFlash();
            flash.Root.transform.position = start;
            flash.Root.transform.localScale = Vector3.one * 0.22f;
            flash.Color = profile.Flash;
            SetMaterialColor(flash.Material, profile.Flash, 0.94f);
            flash.Light.color = profile.Light;
            flash.Light.intensity = 2.4f;
            flash.Light.range = 2.8f;
            flash.Started = Time.unscaledTime;
            flash.Life = profile.FlashLife;
            flash.Active = true;
            flash.Root.SetActive(true);

            ImpactFx impact = AcquireImpact();
            impact.Root.transform.position = end + Vector3.up * 0.04f;
            impact.Root.transform.localScale = Vector3.one * 0.16f;
            SetMaterialColor(impact.Material, Color.Lerp(profile.Tracer, new Color(0.72f, 0.62f, 0.46f), 0.45f), 0.82f);
            impact.Started = Time.unscaledTime;
            impact.Life = 0.18f;
            impact.Active = true;
            impact.Root.SetActive(true);

            Recount();
        }

        public void PlayExplosion(Vector3 center, float radius)
        {
            radius = Mathf.Max(1.4f, radius);
            Audio?.PlayExplosion(center, radius);
            var root = new GameObject("ExplosionFx");
            root.transform.SetParent(transform, false);
            root.transform.position = new Vector3(center.x, Mathf.Max(0.12f, center.y), center.z);

            Material ringMaterial = CreateTransparentMaterial(new Color(1f, 0.55f, 0.15f, 0.72f));
            var ring = root.AddComponent<LineRenderer>();
            ring.useWorldSpace = false;
            ring.loop = true;
            ring.positionCount = 32;
            ring.widthMultiplier = 0.11f;
            ring.alignment = LineAlignment.TransformZ;
            ring.shadowCastingMode = ShadowCastingMode.Off;
            ring.receiveShadows = false;
            ring.sharedMaterial = ringMaterial;
            for (int i = 0; i < 32; i++)
            {
                float a = i / 32f * Mathf.PI * 2f;
                ring.SetPosition(i, new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a)));
            }

            GameObject coreObject = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            coreObject.name = "Core";
            coreObject.transform.SetParent(root.transform, false);
            Collider collider = coreObject.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            Renderer core = coreObject.GetComponent<Renderer>();
            Material coreMaterial = CreateTransparentMaterial(new Color(1f, 0.32f, 0.05f, 0.9f));
            core.sharedMaterial = coreMaterial;

            Light light = root.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, 0.38f, 0.08f);
            light.range = radius * 2.2f;
            light.intensity = 5f;
            light.shadows = LightShadows.None;

            _explosions.Add(new ExplosionFx
            {
                Root = root,
                Ring = ring,
                RingMaterial = ringMaterial,
                Core = core,
                CoreMaterial = coreMaterial,
                Light = light,
                Radius = radius,
                Started = Time.unscaledTime
            });
        }

        public void Clear()
        {
            for (int i = 0; i < _tracers.Count; i++)
            {
                _tracers[i].Active = false;
                if (_tracers[i].Root != null) _tracers[i].Root.SetActive(false);
            }
            for (int i = 0; i < _flashes.Count; i++)
            {
                _flashes[i].Active = false;
                if (_flashes[i].Root != null) _flashes[i].Root.SetActive(false);
            }
            for (int i = 0; i < _impacts.Count; i++)
            {
                _impacts[i].Active = false;
                if (_impacts[i].Root != null) _impacts[i].Root.SetActive(false);
            }
            for (int i = _explosions.Count - 1; i >= 0; i--) DestroyExplosion(_explosions[i]);
            _explosions.Clear();
            ActiveTracerCount = 0;
            ActiveFlashCount = 0;
            ActiveImpactCount = 0;
        }

        private void Update()
        {
            float now = Time.unscaledTime;
            for (int i = 0; i < _tracers.Count; i++)
            {
                TracerFx fx = _tracers[i];
                if (!fx.Active) continue;
                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Root.SetActive(false);
                }
                else SetMaterialAlpha(fx.Material, 0.88f * (1f - t));
            }
            for (int i = 0; i < _flashes.Count; i++)
            {
                FlashFx fx = _flashes[i];
                if (!fx.Active) continue;
                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Root.SetActive(false);
                }
                else
                {
                    SetMaterialAlpha(fx.Material, 0.94f * (1f - t));
                    fx.Light.intensity = 2.4f * (1f - t);
                    fx.Root.transform.localScale = Vector3.one * Mathf.Lerp(0.22f, 0.06f, t);
                }
            }
            for (int i = 0; i < _impacts.Count; i++)
            {
                ImpactFx fx = _impacts[i];
                if (!fx.Active) continue;
                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Root.SetActive(false);
                }
                else
                {
                    SetMaterialAlpha(fx.Material, 0.82f * (1f - t));
                    fx.Root.transform.localScale = Vector3.one * Mathf.Lerp(0.16f, 0.035f, t);
                }
            }
            for (int i = _explosions.Count - 1; i >= 0; i--)
            {
                ExplosionFx fx = _explosions[i];
                float t = Mathf.Clamp01((now - fx.Started) / ExplosionFx.Life);
                if (t >= 1f)
                {
                    DestroyExplosion(fx);
                    _explosions.RemoveAt(i);
                    continue;
                }
                float eased = 1f - (1f - t) * (1f - t);
                fx.Ring.transform.localScale = Vector3.one * Mathf.Lerp(fx.Radius * 0.18f, fx.Radius, eased);
                fx.Core.transform.localScale = Vector3.one * Mathf.Lerp(0.3f, fx.Radius * 0.72f, eased);
                SetMaterialAlpha(fx.RingMaterial, 0.72f * (1f - t));
                SetMaterialAlpha(fx.CoreMaterial, 0.9f * (1f - t));
                fx.Light.intensity = 5f * (1f - t);
            }
            Recount();
        }

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (RoaGameBootstrap.BlocksWorldHud) return;
            if (_enemies == null || UnityEngine.Camera.main == null) return;
            _speech.Clear();
            _enemies.CollectSpeechBubbles(_speech);
            if (_speech.Count == 0) return;

            if (_speechStyle == null)
            {
                _speechStyle = new GUIStyle(GUI.skin.box)
                {
                    alignment = TextAnchor.MiddleCenter,
                    wordWrap = true,
                    fontStyle = FontStyle.Bold,
                    fontSize = 13,
                    normal = { textColor = new Color(0.88f, 1f, 0.9f) }
                };
            }

            UnityEngine.Camera camera = UnityEngine.Camera.main;
            Color previous = GUI.color;
            for (int i = 0; i < _speech.Count; i++)
            {
                SpeechBubble row = _speech[i];
                Vector3 point = camera.WorldToScreenPoint(row.World);
                if (point.z <= 0f) continue;
                const float width = 230f;
                const float height = 54f;
                var rect = new Rect(Mathf.Clamp(point.x - width * 0.5f, 6f, Screen.width - width - 6f),
                                    Mathf.Clamp(Screen.height - point.y - height, 6f, Screen.height - height - 6f),
                                    width, height);
                GUI.color = new Color(1f, 1f, 1f, Mathf.Clamp(row.Opacity, 0.18f, 1f));
                GUI.Box(rect, row.Text, _speechStyle);
            }
            GUI.color = previous;
        }

        public static WeaponFxProfile ProfileFor(string weaponId)
        {
            switch (weaponId ?? string.Empty)
            {
                case "laserPistol": return Profile(0xff5b84, 0xff6f9d, 0xff84b3, 0.22f, 0.11f);
                case "machineGun": return Profile(0xffcb76, 0xffd98a, 0xffc86a, 0.15f, 0.07f);
                case "flamethrower": return Profile(0xff8d24, 0xff5a00, 0xff8f33, 0.12f, 0.09f);
                case "plasmaRifle": return Profile(0x75ffa8, 0x3aff84, 0x6fffc1, 0.24f, 0.10f);
                case "shotgun": return Profile(0xffe09d, 0xffca72, 0xffcd7a, 0.12f, 0.07f);
                case "rocketLauncher": return Profile(0xffd18a, 0xff9a32, 0xffb04d, 0.20f, 0.12f);
                default: return Profile(0xffd56a, 0xffc86a, 0xffc86a, 0.16f, 0.08f);
            }
        }

        public static float ImpulseFor(string weaponId)
        {
            switch (weaponId ?? string.Empty)
            {
                case "rocketLauncher": return 0.18f;
                case "shotgun": return 0.13f;
                case "machineGun": return 0.075f;
                case "plasmaRifle": return 0.09f;
                case "rifle": case "assaultRifle": return 0.085f;
                default: return 0.055f;
            }
        }

        public static bool TryShotEndpoints(JObject payload, out Vector3 start, out Vector3 end)
        {
            start = Vector3.zero;
            end = Vector3.zero;
            if (payload == null) return false;

            float sx = Number(payload["startX"], Number(payload["originX"], Number(payload["x"], 0f)));
            float sz = Number(payload["startZ"], Number(payload["originZ"], Number(payload["z"], 0f)));
            float sy = Number(payload["startY"], 1.12f);
            start = RoaCoords.ToUnity(sx, sy, sz);

            JToken endXToken = payload["endX"];
            JToken endZToken = payload["endZ"];
            if (endXToken != null && endXToken.Type != JTokenType.Null
                && endZToken != null && endZToken.Type != JTokenType.Null)
            {
                end = RoaCoords.ToUnity(Number(endXToken, sx), 1.12f, Number(endZToken, sz));
                return (end - start).sqrMagnitude > 0.0001f;
            }

            float dirX = Number(payload["dirX"], Mathf.Sin(Number(payload["angle"], 0f)));
            float dirZ = Number(payload["dirZ"], Mathf.Cos(Number(payload["angle"], 0f)));
            float distance = Mathf.Max(0.1f, Number(payload["endDist"], DefaultShotDistance));
            Vector3 direction = RoaCoords.VelocityToUnity(dirX, dirZ);
            if (direction.sqrMagnitude < 0.0001f) return false;
            end = start + direction.normalized * distance;
            end.y = 1.12f;
            return true;
        }

        private static WeaponFxProfile Profile(int tracer, int flash, int light,
                                               float tracerLife, float flashLife)
        {
            return new WeaponFxProfile
            {
                Tracer = Hex(tracer),
                Flash = Hex(flash),
                Light = Hex(light),
                TracerLife = tracerLife,
                FlashLife = flashLife
            };
        }

        private static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 255) / 255f,
                             ((rgb >> 8) & 255) / 255f,
                             (rgb & 255) / 255f);
        }

        private void EnsurePools()
        {
            while (_tracers.Count < InitialTracerPool) _tracers.Add(CreateTracer());
            while (_flashes.Count < InitialFlashPool) _flashes.Add(CreateFlash());
            while (_impacts.Count < InitialImpactPool) _impacts.Add(CreateImpact());
        }

        private TracerFx AcquireTracer()
        {
            for (int i = 0; i < _tracers.Count; i++) if (!_tracers[i].Active) return _tracers[i];
            TracerFx created = CreateTracer();
            _tracers.Add(created);
            return created;
        }

        private FlashFx AcquireFlash()
        {
            for (int i = 0; i < _flashes.Count; i++) if (!_flashes[i].Active) return _flashes[i];
            FlashFx created = CreateFlash();
            _flashes.Add(created);
            return created;
        }

        private ImpactFx AcquireImpact()
        {
            for (int i = 0; i < _impacts.Count; i++) if (!_impacts[i].Active) return _impacts[i];
            ImpactFx created = CreateImpact();
            _impacts.Add(created);
            return created;
        }

        private TracerFx CreateTracer()
        {
            var root = new GameObject("TracerFx");
            root.transform.SetParent(transform, false);
            var line = root.AddComponent<LineRenderer>();
            Material material = CreateTransparentMaterial(Color.white);
            line.sharedMaterial = material;
            line.useWorldSpace = true;
            line.widthMultiplier = 0.055f;
            line.numCapVertices = 2;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            root.SetActive(false);
            return new TracerFx { Root = root, Line = line, Material = material };
        }

        private FlashFx CreateFlash()
        {
            GameObject root = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            root.name = "MuzzleFlashFx";
            root.transform.SetParent(transform, false);
            Collider collider = root.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            Renderer renderer = root.GetComponent<Renderer>();
            Material material = CreateTransparentMaterial(Color.white);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            Light light = root.AddComponent<Light>();
            light.type = LightType.Point;
            light.shadows = LightShadows.None;
            root.SetActive(false);
            return new FlashFx { Root = root, Renderer = renderer, Material = material, Light = light };
        }

        private ImpactFx CreateImpact()
        {
            GameObject root = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            root.name = "ImpactSparkFx";
            root.transform.SetParent(transform, false);
            Collider collider = root.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            Renderer renderer = root.GetComponent<Renderer>();
            Material material = CreateTransparentMaterial(Color.white);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            root.SetActive(false);
            return new ImpactFx { Root = root, Material = material };
        }

        private static Material CreateTransparentMaterial(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Color");
            var material = new Material(shader);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent;
            SetMaterialColor(material, color, color.a > 0f ? color.a : 1f);
            return material;
        }

        private static void SetMaterialColor(Material material, Color color, float alpha)
        {
            if (material == null) return;
            color.a = alpha;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        }

        private static void SetMaterialAlpha(Material material, float alpha)
        {
            if (material == null) return;
            if (material.HasProperty("_BaseColor"))
            {
                Color color = material.GetColor("_BaseColor");
                color.a = alpha;
                material.SetColor("_BaseColor", color);
            }
            if (material.HasProperty("_Color"))
            {
                Color color = material.GetColor("_Color");
                color.a = alpha;
                material.SetColor("_Color", color);
            }
        }

        private void Recount()
        {
            int tracers = 0;
            int flashes = 0;
            int impacts = 0;
            for (int i = 0; i < _tracers.Count; i++) if (_tracers[i].Active) tracers++;
            for (int i = 0; i < _flashes.Count; i++) if (_flashes[i].Active) flashes++;
            for (int i = 0; i < _impacts.Count; i++) if (_impacts[i].Active) impacts++;
            ActiveTracerCount = tracers;
            ActiveFlashCount = flashes;
            ActiveImpactCount = impacts;
        }

        private static float Number(JToken token, float fallback)
        {
            if (token == null) return fallback;
            // JValue.ToString() форматирует double текущей культурой (ru-RU даёт "173,3"),
            // и инвариантный разбор такой строки молча возвращал fallback. Числовые токены
            // читаем напрямую, строки разбираем инвариантно.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();
            float value;
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                                  System.Globalization.CultureInfo.InvariantCulture, out value)
                ? value : fallback;
        }

        private void DestroyExplosion(ExplosionFx fx)
        {
            if (fx == null) return;
            if (fx.RingMaterial != null) Destroy(fx.RingMaterial);
            if (fx.CoreMaterial != null) Destroy(fx.CoreMaterial);
            if (fx.Root != null) Destroy(fx.Root);
        }

        private void DestroyPools()
        {
            Clear();
            for (int i = 0; i < _tracers.Count; i++)
            {
                if (_tracers[i].Material != null) Destroy(_tracers[i].Material);
                if (_tracers[i].Root != null) Destroy(_tracers[i].Root);
            }
            for (int i = 0; i < _flashes.Count; i++)
            {
                if (_flashes[i].Material != null) Destroy(_flashes[i].Material);
                if (_flashes[i].Root != null) Destroy(_flashes[i].Root);
            }
            for (int i = 0; i < _impacts.Count; i++)
            {
                if (_impacts[i].Material != null) Destroy(_impacts[i].Material);
                if (_impacts[i].Root != null) Destroy(_impacts[i].Root);
            }
            _tracers.Clear();
            _flashes.Clear();
            _impacts.Clear();
        }
    }
}
