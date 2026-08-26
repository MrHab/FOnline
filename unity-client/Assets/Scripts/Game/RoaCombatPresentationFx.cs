using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// High-readability procedural combat presentation. The server still owns
    /// damage, hit tests and timing; this component only renders accepted relays.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed partial class RoaCombatPresentationFx : MonoBehaviour
    {
        private sealed class TracerFx
        {
            public GameObject Root;
            public LineRenderer Line;
            public Material Material;
            public Vector3 Start;
            public Vector3 End;
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
            public Vector3 BaseScale;
            public float Started;
            public float Life;
            public bool Active;
        }

        private sealed class ImpactFx
        {
            public GameObject Root;
            public Renderer Core;
            public Material CoreMaterial;
            public LineRenderer[] Sparks;
            public Material SparkMaterial;
            public Vector3[] Velocities;
            public Color Color;
            public float Started;
            public float Life;
            public float Scale;
            public bool Active;
            public bool Visible;
        }

        private sealed class ExplosionFx
        {
            public GameObject Root;
            public LineRenderer ShockRing;
            public Material ShockMaterial;
            public LineRenderer HeatRing;
            public Material HeatMaterial;
            public Renderer Core;
            public Material CoreMaterial;
            public Renderer Glow;
            public Material GlowMaterial;
            public Renderer[] Smoke;
            public Material SmokeMaterial;
            public Vector3[] SmokeOffsets;
            public LineRenderer[] Embers;
            public Material EmberMaterial;
            public Vector3[] EmberVelocities;
            public Light Light;
            public float Radius;
            public float Started;
            public const float Life = 0.96f;
        }

        private const int InitialTracerPool = 28;
        private const int InitialFlashPool = 18;
        private const int InitialImpactPool = 24;
        private const int ImpactSparkCount = 6;
        private const int ExplosionSmokeCount = 6;
        private const int ExplosionEmberCount = 10;
        private const int MaxExplosions = 8;

        public RoaCameraRig CameraRig;

        private readonly List<TracerFx> _tracers = new List<TracerFx>();
        private readonly List<FlashFx> _flashes = new List<FlashFx>();
        private readonly List<ImpactFx> _impacts = new List<ImpactFx>();
        private readonly List<ExplosionFx> _explosions = new List<ExplosionFx>();
        private Mesh _muzzleMesh;
        private Texture2D _damageVignette;
        private float _damageStarted = -10f;
        private float _damageStrength;
        private uint _variation = 0x7a4f31c9u;

        public int ActiveTracerCount { get { return CountTracers(); } }
        public int ActiveFlashCount { get { return CountFlashes(); } }
        public int ActiveImpactCount { get { return CountImpacts(); } }
        public int ActiveExplosionCount { get { return _explosions.Count; } }

        private void Awake()
        {
            _muzzleMesh = CreateMuzzleMesh();
            _damageVignette = CreateDamageVignette();
            EnsureDamageCanvas();
            EnsurePools();
            Debug.Log("[ROA] Combat VFX ready: " + _tracers.Count + " moving tracers, "
                + _flashes.Count + " muzzle bursts, " + _impacts.Count + " spark impacts");
        }

        private void OnDisable()
        {
            Clear();
        }

        private void OnDestroy()
        {
            DestroyPools();
            DestroyDamageCanvas();
            if (_muzzleMesh != null) Destroy(_muzzleMesh);
            if (_damageVignette != null) Destroy(_damageVignette);
        }

        public void PlayShot(Vector3 start, Vector3 end, string weaponId,
                             RoaCombatFx.WeaponFxProfile profile)
        {
            EnsurePools();
            Vector3 direction = end - start;
            float distance = direction.magnitude;
            if (distance < 0.05f) return;
            direction /= distance;

            TracerFx tracer = AcquireTracer();
            tracer.Start = start;
            tracer.End = end;
            tracer.Started = Time.unscaledTime;
            tracer.Life = Mathf.Max(0.11f, profile.TracerLife);
            tracer.Line.widthMultiplier = TracerWidth(weaponId);
            tracer.Line.colorGradient = TracerGradient(profile.Tracer);
            SetMaterialColor(tracer.Material, profile.Tracer, 0.96f, 2.2f);
            tracer.Active = true;
            tracer.Root.SetActive(true);
            UpdateTracer(tracer, 0f);

            FlashFx flash = AcquireFlash();
            float flashLength = weaponId == "rocketLauncher" ? 0.9f
                : weaponId == "shotgun" ? 0.66f
                : weaponId == "plasmaRifle" ? 0.58f : 0.46f;
            float flashWidth = weaponId == "rocketLauncher" ? 0.2f
                : weaponId == "shotgun" ? 0.18f : 0.125f;
            flash.Root.transform.position = start;
            flash.Root.transform.rotation = Quaternion.LookRotation(direction, Vector3.up);
            flash.BaseScale = new Vector3(flashWidth, flashWidth, flashLength);
            flash.Root.transform.localScale = flash.BaseScale;
            flash.Color = profile.Flash;
            SetMaterialColor(flash.Material, profile.Flash, 0.98f, 3.5f);
            flash.Light.color = profile.Light;
            flash.Light.intensity = weaponId == "rocketLauncher" ? 5.4f : 3.2f;
            flash.Light.range = weaponId == "rocketLauncher" ? 4.8f : 3.3f;
            flash.Started = Time.unscaledTime;
            flash.Life = Mathf.Max(0.065f, profile.FlashLife);
            flash.Active = true;
            flash.Root.SetActive(true);
        }

        public void PlayMiss(Vector3 point, Vector3 source, string weaponId,
                             RoaCombatFx.WeaponFxProfile profile)
        {
            EnsurePools();
            Vector3 direction = point - source;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) direction = Vector3.forward;
            else direction.Normalize();

            ImpactFx impact = AcquireImpact();
            impact.Root.transform.position = point;
            impact.Color = Color.Lerp(new Color(0.72f, 0.61f, 0.43f), profile.Tracer, 0.18f);
            impact.Started = Time.unscaledTime;
            impact.Life = 0.27f;
            impact.Scale = 0.76f;
            impact.Active = true;
            impact.Visible = true;
            impact.Root.SetActive(true);
            ConfigureImpact(impact, direction, weaponId);
            UpdateImpact(impact, 0f);
        }

        public void PlayConfirmedHit(Vector3 target, Vector3 source, string weaponId,
                                     bool critical, bool killed)
        {
            EnsurePools();
            Vector3 direction = target - source;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) direction = Vector3.forward;
            else direction.Normalize();

            ImpactFx impact = AcquireImpact();
            impact.Root.transform.position = new Vector3(
                target.x, Mathf.Max(0.88f, target.y + 1.02f), target.z);
            impact.Color = killed
                ? new Color(1f, 0.28f, 0.12f)
                : critical ? new Color(1f, 0.78f, 0.18f) : new Color(1f, 0.48f, 0.30f);
            impact.Started = Time.unscaledTime;
            impact.Life = killed ? 0.46f : critical ? 0.39f : 0.32f;
            impact.Scale = killed ? 1.6f : critical ? 1.35f : 1.16f;
            impact.Active = true;
            impact.Visible = true;
            impact.Root.SetActive(true);
            ConfigureImpact(impact, direction, weaponId);
            UpdateImpact(impact, 0f);
        }

        public void PlayExplosion(Vector3 center, float radius)
        {
            radius = Mathf.Max(1.4f, radius);
            if (_explosions.Count >= MaxExplosions)
            {
                DestroyExplosion(_explosions[0]);
                _explosions.RemoveAt(0);
            }
            ExplosionFx fx = CreateExplosion(center, radius);
            _explosions.Add(fx);
            UpdateExplosion(fx, 0f);

            if (CameraRig != null && CameraRig.Target != null)
            {
                float distance = Vector3.Distance(CameraRig.Target.position, center);
                float falloff = 1f - Mathf.InverseLerp(radius * 1.2f, radius * 7f, distance);
                CameraRig.AddImpulse(0.22f * Mathf.Clamp01(falloff));
            }
        }

        public void PlayDamagePulse(int damage)
        {
            float strength = Mathf.Lerp(0.28f, 0.82f, Mathf.InverseLerp(2f, 55f, damage));
            _damageStrength = Mathf.Max(_damageStrength, strength);
            _damageStarted = Time.unscaledTime;
            _damageHasDirection = false;
            EnsureDamageCanvas();
            CameraRig?.AddImpulse(Mathf.Lerp(0.045f, 0.14f, strength));
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
                _impacts[i].Visible = false;
                if (_impacts[i].Root != null) _impacts[i].Root.SetActive(false);
            }
            for (int i = _explosions.Count - 1; i >= 0; i--) DestroyExplosion(_explosions[i]);
            _explosions.Clear();
            _damageStrength = 0f;
            _damageHasDirection = false;
            ClearDamageFeedback();
        }

        private void Update()
        {
            float now = Time.unscaledTime;
            UpdateTracers(now);
            UpdateFlashes(now);
            UpdateImpacts(now);
            for (int i = _explosions.Count - 1; i >= 0; i--)
            {
                ExplosionFx fx = _explosions[i];
                float t = Mathf.Clamp01((now - fx.Started) / ExplosionFx.Life);
                if (t >= 1f)
                {
                    DestroyExplosion(fx);
                    _explosions.RemoveAt(i);
                }
                else UpdateExplosion(fx, t);
            }
            UpdateDamageFeedback(now);
        }
    }
}
