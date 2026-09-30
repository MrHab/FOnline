using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Дождь вокруг игровой камеры: косые струи и круги от капель на мокрой земле.
    ///
    /// Капли рождаются только там, куда смотрит камера: точка берётся в трапеции
    /// видимой земли (и чуть дальше её верхнего края — струи над дальней землёй
    /// видны в верху кадра), высота — случайная, а время жизни ровно такое, чтобы
    /// капля погасла у земли и не рисовалась под ней. Возле самой камеры капель нет:
    /// в упор струя стала бы полосой через весь экран.
    ///
    /// Частицы — CPU-система Unity: в WebGL нет вычислительных шейдеров, а пара тысяч
    /// коротких струй дешевле лишнего прохода по сцене. Материал тот же, что у пыли
    /// шагов (RoaMovementFx), поэтому в сборке уже есть его вариант шейдера.
    /// </summary>
    public sealed class RoaRainFx : MonoBehaviour
    {
        public const int DesktopStreakCapacity = 4600;
        public const int MobileStreakCapacity = 1900;
        public const float DesktopStreaksPerSecond = 5200f;
        public const float MobileStreaksPerSecond = 2100f;
        public const int DesktopRippleCapacity = 520;
        public const int MobileRippleCapacity = 220;
        public const float DesktopRipplesPerSecond = 480f;
        public const float MobileRipplesPerSecond = 200f;
        public const float FallSpeed = 10.5f;
        public const float MaxDropHeight = 7.5f;
        public const float MinCameraDistance = 3.2f;
        /// <summary>Дальше этого по лучу камеры землю не ищем: у горизонта капель не видно.</summary>
        public const float MaxGroundDistance = 48f;
        /// <summary>Дистанция игровой камеры, под которую подобраны размеры струй и кругов (RoaCameraRig).</summary>
        public const float ReferenceViewDistance = 11.5f;
        private const int TextureSize = 64;
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        private ParticleSystem _streaks;
        private ParticleSystem _ripples;
        private Material _streakMaterial;
        private Material _rippleMaterial;
        private Texture2D _streakTexture;
        private Texture2D _rippleTexture;
        private float _intensity;
        private float _wetness;
        private Vector2 _wind = Vector2.right;
        private float _windSpeed;
        private float _flashBoost = 1f;
        private float _viewScale = 1f;
        private Camera _camera;
        private float _streakCarry;
        private float _rippleCarry;
        private uint _random = 0x1b873593u;
        private readonly Vector3[] _corners = new Vector3[4];
        private static readonly Vector2[] ViewportCorners =
            { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f) };

        public bool Ready { get { return _streaks != null && _ripples != null; } }
        public float Intensity { get { return _intensity; } }
        public int StreakCount { get { return _streaks != null ? _streaks.particleCount : 0; } }
        public int RippleCount { get { return _ripples != null ? _ripples.particleCount : 0; } }
        public int StreakCapacity { get { return _streaks != null ? _streaks.main.maxParticles : 0; } }
        public int EmittedStreaks { get; private set; }
        /// <summary>Во сколько раз струи и круги крупнее из-за отдалённой камеры.</summary>
        public float ViewScale { get { return _viewScale; } }

        /// <summary>Сила дождя 0..1, влажность земли, ветер (направление по карте и сила 0..1) и камера кадра.</summary>
        public void SetWeather(float rain, float wetness, Vector2 wind, float windSpeed, Camera view)
        {
            _intensity = Mathf.Clamp01(rain);
            _wetness = Mathf.Clamp01(wetness);
            _wind = wind.sqrMagnitude > 0.0001f ? wind.normalized : Vector2.right;
            _windSpeed = Mathf.Clamp01(windSpeed);
            _camera = view;
        }

        /// <summary>
        /// Вспышка молнии 0..1. Частицы не освещаются, поэтому в миг удара струи и круги
        /// подсвечиваются сами — иначе на светлой земле они выглядят тёмными чёрточками.
        /// </summary>
        public void SetFlash(float flash)
        {
            float boost = 1f + Mathf.Clamp01(flash) * 2.2f;
            if (Mathf.Abs(boost - _flashBoost) < 0.01f) return;
            _flashBoost = boost;
            var tint = new Color(boost, boost, boost, 1f);
            if (_streakMaterial != null) _streakMaterial.SetColor(BaseColorId, tint);
            if (_rippleMaterial != null) _rippleMaterial.SetColor(BaseColorId, tint);
        }

        /// <summary>Скорость капли: вниз и вбок по ветру. Сильный ветер кладёт струи на 20°.</summary>
        public static Vector3 DropVelocity(Vector2 wind, float windSpeed)
        {
            float drift = Mathf.Lerp(0.6f, 3.8f, Mathf.Clamp01(windSpeed));
            return new Vector3(wind.x * drift, -FallSpeed, wind.y * drift);
        }

        private void Awake()
        {
            EnsureSystems();
        }

        private void OnDestroy()
        {
            Dispose(_streakMaterial);
            Dispose(_rippleMaterial);
            Dispose(_streakTexture);
            Dispose(_rippleTexture);
        }

        private void LateUpdate()
        {
            if (_intensity <= 0.001f || _camera == null)
            {
                _streakCarry = 0f;
                _rippleCarry = 0f;
                return;
            }
            EnsureSystems();
            if (!Ready || !ViewGround()) return;
            // Отдалённая камера: струи и круги растут с дистанцией, иначе на дальнем зуме
            // они тоньше пикселя и ливень пропадает. Число на экран остаётся прежним.
            _streaks.GetComponent<ParticleSystemRenderer>().velocityScale = 0.045f * _viewScale;

            bool mobile = Application.isMobilePlatform;
            // Редкие кадры (слабый телефон) не должны прореживать дождь, а подвисание —
            // выплёвывать его разом: четверть секунды — предел одного кадра.
            float dt = Mathf.Min(Time.deltaTime, 0.25f);
            // Струй становится больше быстрее, чем растёт сила: морось — редкие нити, ливень — стена.
            float density = Mathf.Pow(_intensity, 1.4f);
            _streakCarry += (mobile ? MobileStreaksPerSecond : DesktopStreaksPerSecond) * density * dt;
            int streaks = Mathf.Min((int)_streakCarry, 1400);
            _streakCarry -= streaks;
            Vector3 velocity = DropVelocity(_wind, _windSpeed);
            Vector3 cameraPosition = _camera.transform.position;
            // Частицы не освещаются: яркость берём от дымки часа, иначе ночью струи светятся.
            float light = Mathf.Clamp(RenderSettings.fogColor.grayscale * 2.2f, 0.35f, 1f);
            for (int i = 0; i < streaks; i++)
            {
                Vector3 ground = GroundPoint(Next01(), Mathf.Lerp(-0.08f, 1.3f, Next01()));
                float height = Mathf.Lerp(0.25f, MaxDropHeight, Next01());
                float lifetime = height / FallSpeed;
                Vector3 spawn = ground - velocity * lifetime;
                if ((spawn - cameraPosition).sqrMagnitude < MinCameraDistance * MinCameraDistance) continue;
                _streaks.Emit(new ParticleSystem.EmitParams
                {
                    position = spawn,
                    velocity = velocity * Mathf.Lerp(0.92f, 1.08f, Next01()),
                    startLifetime = lifetime,
                    startSize = (mobile ? 0.036f : 0.03f) * _viewScale * Mathf.Lerp(0.8f, 1.25f, Next01()),
                    startColor = new Color(0.78f * light, 0.82f * light, 0.88f * light, Mathf.Lerp(0.3f, 0.55f, Next01()))
                }, 1);
                EmittedStreaks++;
            }

            // Круги от капель — только на мокрой земле: на сухой вода сразу уходит.
            float rippleRate = (mobile ? MobileRipplesPerSecond : DesktopRipplesPerSecond)
                * density * Mathf.Clamp01(0.25f + _wetness);
            _rippleCarry += rippleRate * dt;
            int ripples = Mathf.Min((int)_rippleCarry, 150);
            _rippleCarry -= ripples;
            for (int i = 0; i < ripples; i++)
            {
                Vector3 ground = GroundPoint(Next01(), Next01());
                _ripples.Emit(new ParticleSystem.EmitParams
                {
                    position = ground + Vector3.up * 0.03f,
                    velocity = Vector3.zero,
                    startLifetime = Mathf.Lerp(0.35f, 0.55f, Next01()),
                    startSize = Mathf.Lerp(0.2f, 0.45f, Next01()) * _viewScale,
                    rotation = Next01() * 360f,
                    startColor = new Color(0.86f * light, 0.9f * light, 0.95f * light, Mathf.Lerp(0.38f, 0.6f, Next01()))
                }, 1);
            }
        }

        /// <summary>Углы видимой земли (плоскость y = 0) по лучам через углы кадра и масштаб по дистанции до центра кадра.</summary>
        private bool ViewGround()
        {
            Ray centre = _camera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f));
            float centreDistance = centre.direction.y < -0.02f ? -centre.origin.y / centre.direction.y : MaxGroundDistance;
            _viewScale = Mathf.Clamp(centreDistance / ReferenceViewDistance, 1f, 2.6f);
            for (int i = 0; i < 4; i++)
            {
                Ray ray = _camera.ViewportPointToRay(new Vector3(ViewportCorners[i].x, ViewportCorners[i].y, 0f));
                float distance = ray.direction.y < -0.02f ? -ray.origin.y / ray.direction.y : MaxGroundDistance;
                distance = Mathf.Clamp(distance, 0f, MaxGroundDistance);
                Vector3 point = ray.origin + ray.direction * distance;
                point.y = 0f;
                _corners[i] = point;
            }
            return true;
        }

        /// <summary>Точка видимой земли: u — поперёк кадра, v — от низа (0) к верху (1), дальше 1 — за верхний край.</summary>
        private Vector3 GroundPoint(float u, float v)
        {
            Vector3 near = Vector3.LerpUnclamped(_corners[0], _corners[1], u);
            Vector3 far = Vector3.LerpUnclamped(_corners[2], _corners[3], u);
            Vector3 point = Vector3.LerpUnclamped(near, far, v);
            point.y = 0f;
            return point;
        }

        private void EnsureSystems()
        {
            if (Ready) return;
            _streakTexture = CreateStreakTexture();
            _rippleTexture = CreateRippleTexture();
            _streakMaterial = RoaMovementFx.CreateParticleMaterial("RainStreakMaterial", _streakTexture);
            _rippleMaterial = RoaMovementFx.CreateParticleMaterial("RainRippleMaterial", _rippleTexture);
            bool mobile = Application.isMobilePlatform;
            _streaks = CreateSystem("RainStreaks", mobile ? MobileStreakCapacity : DesktopStreakCapacity,
                ParticleSystemRenderMode.Stretch, _streakMaterial, null, null);
            ParticleSystemRenderer streakRenderer = _streaks.GetComponent<ParticleSystemRenderer>();
            streakRenderer.velocityScale = 0.045f;
            streakRenderer.lengthScale = 1.2f;
            _ripples = CreateSystem("RainRipples", mobile ? MobileRippleCapacity : DesktopRippleCapacity,
                ParticleSystemRenderMode.HorizontalBillboard, _rippleMaterial, RippleFade(), RippleGrowth());
        }

        private ParticleSystem CreateSystem(string name, int capacity, ParticleSystemRenderMode mode,
                                            Material material, Gradient fade, AnimationCurve growth)
        {
            var child = new GameObject(name);
            child.transform.SetParent(transform, false);
            var system = child.AddComponent<ParticleSystem>();
            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = capacity;
            main.startSpeed = 0f;
            main.gravityModifier = 0f;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var emission = system.emission;
            emission.enabled = false;
            var shape = system.shape;
            shape.enabled = false;
            if (fade != null)
            {
                var color = system.colorOverLifetime;
                color.enabled = true;
                color.color = fade;
            }
            if (growth != null)
            {
                var size = system.sizeOverLifetime;
                size.enabled = true;
                size.size = new ParticleSystem.MinMaxCurve(1f, growth);
            }
            ParticleSystemRenderer renderer = child.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = mode;
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            system.Play();
            return system;
        }

        private static Gradient RippleFade()
        {
            return new Gradient
            {
                colorKeys = new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                alphaKeys = new[]
                {
                    new GradientAlphaKey(0.9f, 0f),
                    new GradientAlphaKey(0.55f, 0.45f),
                    new GradientAlphaKey(0f, 1f)
                }
            };
        }

        private static AnimationCurve RippleGrowth()
        {
            return new AnimationCurve(new Keyframe(0f, 0.25f), new Keyframe(0.35f, 0.75f), new Keyframe(1f, 1f));
        }

        /// <summary>Мягкое пятно: растянутое по скорости, оно становится струёй с мягкими концами.</summary>
        private static Texture2D CreateStreakTexture()
        {
            var texture = NewTexture("ProceduralRainStreak");
            var pixels = new Color32[TextureSize * TextureSize];
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float nx = ((x + 0.5f) / TextureSize - 0.5f) * 2f;
                float ny = ((y + 0.5f) / TextureSize - 0.5f) * 2f;
                float alpha = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(1f - Mathf.Sqrt(nx * nx + ny * ny)));
                pixels[y * TextureSize + x] = new Color(1f, 1f, 1f, alpha);
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        /// <summary>Тонкое кольцо с бледной серединой — круг на воде от капли.</summary>
        private static Texture2D CreateRippleTexture()
        {
            var texture = NewTexture("ProceduralRainRipple");
            var pixels = new Color32[TextureSize * TextureSize];
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float nx = ((x + 0.5f) / TextureSize - 0.5f) * 2f;
                float ny = ((y + 0.5f) / TextureSize - 0.5f) * 2f;
                float radius = Mathf.Sqrt(nx * nx + ny * ny);
                float ring = Mathf.Clamp01(1f - Mathf.Abs(radius - 0.78f) / 0.12f);
                float inner = radius < 0.7f ? 0.12f * (1f - radius / 0.7f) : 0f;
                float alpha = Mathf.Clamp01(ring * ring + inner);
                pixels[y * TextureSize + x] = new Color(1f, 1f, 1f, alpha);
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Texture2D NewTexture(string name)
        {
            return new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false, true)
            {
                name = name,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
        }

        private float Next01()
        {
            _random ^= _random << 13;
            _random ^= _random >> 17;
            _random ^= _random << 5;
            return (_random & 0x00ffffffu) / 16777215f;
        }

        private static void Dispose(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
