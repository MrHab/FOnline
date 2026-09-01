using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Lightweight, pooled ground feedback for collision-resolved local movement.
    /// The authoritative controller and audio cadence stay unchanged; this class
    /// only turns an accepted footstep cue into a small scuff and airborne dust.
    /// </summary>
    public sealed class RoaMovementFx : MonoBehaviour
    {
        public readonly struct EmissionPlan
        {
            public readonly int PuffCount;
            public readonly int ScuffCount;
            public readonly float Lifetime;
            public readonly float PuffSize;
            public readonly float ScuffSize;
            public readonly float Alpha;

            public EmissionPlan(int puffCount, int scuffCount, float lifetime,
                                float puffSize, float scuffSize, float alpha)
            {
                PuffCount = puffCount;
                ScuffCount = scuffCount;
                Lifetime = lifetime;
                PuffSize = puffSize;
                ScuffSize = scuffSize;
                Alpha = alpha;
            }
        }

        public struct ActorStepState
        {
            public Vector3 LastPosition;
            public float NextStepAt;
            public bool Initialized;
            public bool RightFoot;
        }

        private const int PuffCapacityValue = 96;
        private const int ScuffCapacityValue = 24;
        private const int DustTextureSizeValue = 64;
        private const float PuffLiftMin = 0.16f;
        private const float PuffLiftMax = 0.58f;

        private RoaAudio _audio;
        private ParticleSystem _puffs;
        private ParticleSystem _scuffs;
        private Material _puffMaterial;
        private Material _scuffMaterial;
        private Texture2D _softParticle;
        private uint _randomState = 0x9e3779b9u;

        public int ActorStepCount { get; private set; }
        public bool Ready { get { return _puffs != null && _scuffs != null; } }
        public int PuffCapacity { get { return _puffs != null ? _puffs.main.maxParticles : 0; } }
        public int ScuffCapacity { get { return _scuffs != null ? _scuffs.main.maxParticles : 0; } }
        public int DustTextureSize { get { return _softParticle != null ? _softParticle.width : 0; } }
        public int ActiveParticleCount
        {
            get { return (_puffs != null ? _puffs.particleCount : 0)
                + (_scuffs != null ? _scuffs.particleCount : 0); }
        }

        public void Configure(RoaAudio audio)
        {
            EnsureSystems();
            if (_audio == audio) return;
            if (_audio != null) _audio.Footstep -= EmitFootstep;
            _audio = audio;
            if (_audio != null) _audio.Footstep += EmitFootstep;
        }

        private void Awake()
        {
            EnsureSystems();
        }

        private void OnDestroy()
        {
            if (_audio != null) _audio.Footstep -= EmitFootstep;
            _audio = null;
            Dispose(_puffMaterial);
            Dispose(_scuffMaterial);
            Dispose(_softParticle);
            _puffMaterial = null;
            _scuffMaterial = null;
            _softParticle = null;
        }

        public static EmissionPlan PlanFor(float speed, bool crouching, bool mobile)
        {
            float pace = Mathf.InverseLerp(0.35f, 6.6f, Mathf.Max(0f, speed));
            int count = crouching ? 1 : Mathf.RoundToInt(Mathf.Lerp(3f, 7f, pace));
            if (mobile && count > 2) count--;
            return new EmissionPlan(
                Mathf.Clamp(count, 1, 7),
                crouching ? 0 : 1,
                Mathf.Lerp(0.46f, 0.82f, pace) * (crouching ? 0.72f : 1f),
                Mathf.Lerp(0.14f, 0.29f, pace) * (crouching ? 0.64f : 1f),
                Mathf.Lerp(0.30f, 0.52f, pace),
                Mathf.Lerp(0.30f, 0.58f, pace) * (crouching ? 0.46f : 1f));
        }

        public static Vector3 FootOffset(Vector3 planarVelocity, bool rightFoot)
        {
            planarVelocity.y = 0f;
            if (planarVelocity.sqrMagnitude < 0.0001f) return Vector3.zero;
            Vector3 lateral = Vector3.Cross(Vector3.up, planarVelocity.normalized);
            return lateral * (rightFoot ? 0.13f : -0.13f);
        }

        public static float ActorFxMaxDistance(bool mobile)
        {
            return mobile ? 15f : 24f;
        }

        public static bool IsActorFxInRange(Vector3 actorPosition, Vector3 observerPosition, bool mobile)
        {
            Vector3 delta = actorPosition - observerPosition;
            delta.y = 0f;
            float maxDistance = ActorFxMaxDistance(mobile);
            return delta.sqrMagnitude <= maxDistance * maxDistance;
        }

        public static bool TryPlanActorStep(ref ActorStepState state, Vector3 position,
                                            Vector3 velocity, bool moving, bool visible,
                                            bool crouching, float now, out RoaAudio.FootstepCue cue)
        {
            cue = default(RoaAudio.FootstepCue);
            velocity.y = 0f;
            float speed = velocity.magnitude;
            if (!state.Initialized)
            {
                state.Initialized = true;
                state.LastPosition = position;
                state.NextStepAt = now + 0.12f;
                return false;
            }

            Vector3 delta = position - state.LastPosition;
            delta.y = 0f;
            state.LastPosition = position;
            if (delta.sqrMagnitude > 7.5625f)
            {
                state.NextStepAt = now + 0.14f;
                return false;
            }

            if (!visible || !moving || speed < 0.28f)
            {
                state.NextStepAt = now + 0.10f;
                return false;
            }
            if (delta.sqrMagnitude < 0.000004f || now < state.NextStepAt) return false;

            state.RightFoot = !state.RightFoot;
            cue = new RoaAudio.FootstepCue
            {
                Position = position,
                Velocity = velocity,
                Speed = speed,
                Crouching = crouching,
                RightFoot = state.RightFoot
            };
            float cadence = Mathf.Lerp(0.62f, 0.29f, Mathf.InverseLerp(0.4f, 7f, speed));
            state.NextStepAt = now + cadence * (crouching ? 1.22f : 1f);
            return true;
        }

        public bool TrackActor(ref ActorStepState state, Vector3 position, Vector3 velocity,
                               bool moving, bool visible, bool crouching, Vector3 observerPosition)
        {
            bool active = visible && IsActorFxInRange(position, observerPosition, Application.isMobilePlatform);
            if (!TryPlanActorStep(ref state, position, velocity, moving, active, crouching,
                                  Time.unscaledTime, out RoaAudio.FootstepCue cue)) return false;
            EmitActorStep(cue);
            return true;
        }

        /// <summary>Reuses the single audio and particle pools for every visible actor.</summary>
        public void EmitActorStep(RoaAudio.FootstepCue cue)
        {
            ActorStepCount++;
            _audio?.PlayActorFootstep(cue);
            EmitFootstep(cue);
        }

        /// <summary>Public for deterministic editor probes; runtime calls it through RoaAudio.Footstep.</summary>
        public void EmitFootstep(RoaAudio.FootstepCue cue)
        {
            if (!isActiveAndEnabled || cue.Speed < 0.28f) return;
            EnsureSystems();
            if (!Ready) return;

            bool mobile = Application.isMobilePlatform;
            EmissionPlan plan = PlanFor(cue.Speed, cue.Crouching, mobile);
            Vector3 planar = cue.Velocity;
            planar.y = 0f;
            Vector3 forward = planar.sqrMagnitude > 0.0001f ? planar.normalized : Vector3.forward;
            Vector3 side = Vector3.Cross(Vector3.up, forward).normalized;
            Vector3 origin = cue.Position + FootOffset(planar, cue.RightFoot) + Vector3.up * 0.018f;
            float pace = Mathf.InverseLerp(0.35f, 6.6f, cue.Speed);

            for (int i = 0; i < plan.PuffCount; i++)
            {
                float lateral = SignedRandom() * Mathf.Lerp(0.035f, 0.13f, pace);
                float rear = Mathf.Lerp(0.015f, 0.16f, pace) * Next01();
                Vector3 position = origin + side * lateral - forward * rear;
                Vector3 velocity = side * SignedRandom() * Mathf.Lerp(0.06f, 0.27f, pace)
                    - forward * Mathf.Lerp(0.03f, 0.21f, pace) * Next01()
                    + Vector3.up * Mathf.Lerp(PuffLiftMin, PuffLiftMax, Next01())
                        * Mathf.Lerp(0.84f, 1.08f, pace);
                Color tint = Color.Lerp(
                    new Color(0.60f, 0.48f, 0.34f, plan.Alpha),
                    new Color(0.88f, 0.71f, 0.46f, plan.Alpha * 0.92f), Next01());

                var emit = new ParticleSystem.EmitParams
                {
                    position = position,
                    velocity = velocity,
                    startLifetime = plan.Lifetime * Mathf.Lerp(0.78f, 1.18f, Next01()),
                    startSize = plan.PuffSize * Mathf.Lerp(0.72f, 1.24f, Next01()),
                    rotation = SignedRandom() * 180f,
                    startColor = tint
                };
                _puffs.Emit(emit, 1);
            }

            if (plan.ScuffCount > 0)
            {
                var scuff = new ParticleSystem.EmitParams
                {
                    position = origin + Vector3.up * 0.004f,
                    velocity = Vector3.zero,
                    startLifetime = Mathf.Lerp(0.28f, 0.44f, pace),
                    startSize = plan.ScuffSize,
                    startColor = new Color(0.66f, 0.49f, 0.30f, plan.Alpha * 0.72f)
                };
                _scuffs.Emit(scuff, 1);
            }
        }

        private void EnsureSystems()
        {
            if (Ready) return;
            _softParticle = CreateSoftParticle();
            _puffMaterial = CreateParticleMaterial("MovementDustPuffMaterial", _softParticle);
            _scuffMaterial = CreateParticleMaterial("MovementDustScuffMaterial", _softParticle);
            _puffs = CreateSystem("MovementDustPuffs", PuffCapacityValue,
                ParticleSystemRenderMode.Billboard, _puffMaterial, PuffGradient(), PuffSizeCurve());
            _scuffs = CreateSystem("MovementGroundScuffs", ScuffCapacityValue,
                ParticleSystemRenderMode.HorizontalBillboard, _scuffMaterial, ScuffGradient(), ScuffSizeCurve());
        }

        private ParticleSystem CreateSystem(string name, int capacity, ParticleSystemRenderMode mode,
                                            Material material, Gradient fade, AnimationCurve sizeCurve)
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
            main.startLifetime = 0.6f;
            main.startSize = 0.16f;
            main.gravityModifier = 0.015f;

            var emission = system.emission;
            emission.enabled = false;
            var shape = system.shape;
            shape.enabled = false;
            var color = system.colorOverLifetime;
            color.enabled = true;
            color.color = fade;
            var size = system.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, sizeCurve);

            ParticleSystemRenderer renderer = child.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = mode;
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingFudge = 1f;
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            system.Play();
            return system;
        }

        private static Gradient PuffGradient()
        {
            return new Gradient
            {
                colorKeys = new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(new Color(0.88f, 0.82f, 0.72f), 1f)
                },
                alphaKeys = new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(1f, 0.06f),
                    new GradientAlphaKey(0.76f, 0.58f),
                    new GradientAlphaKey(0f, 1f)
                }
            };
        }

        private static Gradient ScuffGradient()
        {
            return new Gradient
            {
                colorKeys = new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(new Color(0.74f, 0.67f, 0.56f), 1f)
                },
                alphaKeys = new[]
                {
                    new GradientAlphaKey(0.86f, 0f),
                    new GradientAlphaKey(0.40f, 0.55f),
                    new GradientAlphaKey(0f, 1f)
                }
            };
        }

        private static AnimationCurve PuffSizeCurve()
        {
            return new AnimationCurve(
                new Keyframe(0f, 0.48f),
                new Keyframe(0.22f, 1f),
                new Keyframe(1f, 1.58f));
        }

        private static AnimationCurve ScuffSizeCurve()
        {
            return new AnimationCurve(
                new Keyframe(0f, 0.72f),
                new Keyframe(1f, 1.18f));
        }

        private static Texture2D CreateSoftParticle()
        {
            const int size = DustTextureSizeValue;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false, true)
            {
                name = "ProceduralMovementDust",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float nx = ((x + 0.5f) / size - 0.5f) * 2f;
                float ny = ((y + 0.5f) / size - 0.5f) * 2f;
                float radial = Mathf.Clamp01(1f - nx * nx - ny * ny);
                float body = Mathf.SmoothStep(0f, 1f, radial);
                float grain = 0.92f + 0.08f * Mathf.Sin((x * 17.13f + y * 31.71f) * 0.37f);
                float alpha = Mathf.Pow(body, 1.12f) * grain;
                pixels[y * size + x] = new Color(1f, 1f, 1f, alpha);
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Material CreateParticleMaterial(string name, Texture2D texture)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Particles/Unlit")
                ?? Shader.Find("Particles/Standard Unlit")
                ?? Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default")
                ?? Shader.Find("Unlit/Transparent");
            var material = new Material(shader) { name = name };
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_Mode")) material.SetFloat("_Mode", 2f);
            if (material.HasProperty("_AlphaClip")) material.SetFloat("_AlphaClip", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            if (material.HasProperty("_Color")) material.SetColor("_Color", Color.white);
            if (material.HasProperty("_ColorMode")) material.SetFloat("_ColorMode", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.EnableKeyword("_ALPHABLEND_ON");
            material.DisableKeyword("_ALPHATEST_ON");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent;
            return material;
        }

        private float Next01()
        {
            _randomState ^= _randomState << 13;
            _randomState ^= _randomState >> 17;
            _randomState ^= _randomState << 5;
            return (_randomState & 0x00ffffffu) / 16777215f;
        }

        private float SignedRandom()
        {
            return Next01() * 2f - 1f;
        }

        private static void Dispose(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
