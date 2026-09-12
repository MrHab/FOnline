using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Presentation actors, never combat/network entities. The private onboarding
    /// room owns the outcome; these anonymous casualties cannot replace quest NPCs
    /// or grant loot. One timeline also defines the skipped/reconnected aftermath.
    /// </summary>
    public sealed class RoaCaravanAmbushStage : MonoBehaviour
    {
        public const float Duration = 25f;
        public const int BrahminCount = 2;
        public const int AlliedCasualties = 3;
        public const int RaiderCasualties = 3;
        // The authored bridge occupies the middle of the map. Stage the attack
        // on its open southern approach, not behind its six-metre abutments.
        public static readonly Vector3 AmbushOffset = P(0,-18);

        public sealed class Role
        {
            public readonly string Id, Weapon;
            public readonly bool Raider;
            public readonly Vector3 Start, Cover;
            public readonly float FallsAt;
            public Role(string id, string weapon, bool raider, Vector3 start, Vector3 cover, float fallsAt)
            { Id = id; Weapon = weapon; Raider = raider; Start = start; Cover = cover; FallsAt = fallsAt; }
        }

        public static readonly Role[] Cast = {
            new Role("caravan_rearguard", "rifle", false, P(-2,-17), P(-3,-8), 12.2f),
            new Role("caravan_point_guard", "shotgun", false, P(-2,-14), P(-3,-6), 8.8f),
            new Role("caravan_loader", "pistol", false, P(3,-18), P(-5,-10), 10.5f),
            new Role("caravan_cover_guard", "rifle", false, P(3,-14), P(-5,-7), 0f),
            new Role("caravan_drover", "pistol", false, P(-2,-20), P(-5,-14), 0f),
            new Role("raider_ridge", "rifle", true, P(15,-3), P(8,-6), 14.3f),
            new Role("raider_flank", "pistol", true, P(16,-10), P(9,-11), 16.1f),
            new Role("raider_rusher", "shotgun", true, P(14,-18), P(7,-15), 11.4f),
            new Role("raider_retreat", "rifle", true, P(-16,-4), P(-10,-9), 0f)
        };

        private sealed class Performer
        {
            public Role Role;
            public Transform Root;
            public RoaCharacterView View;
            public bool Fallen;
        }

        private readonly List<Performer> _people = new List<Performer>();
        private readonly List<Transform> _brahmins = new List<Transform>();
        private readonly List<Material> _materials = new List<Material>();
        private Transform _scars;
        private readonly List<Transform> _blood = new List<Transform>();
        private ParticleSystem _smoke;
        private RoaCombatPresentationFx _fx;
        private RoaAudio _audio;
        private float _lastTime = -1f;
        private bool _disposed;
        public Task Loading { get; private set; }
        public bool Ready { get; private set; }
        public bool Aftermath { get; private set; }
        public string LoadError { get; private set; }
        public int LoadedPeople { get { return _people.FindAll(p => p.View != null && p.View.Ready).Count; } }
        public int LoadedBrahmins { get { return _brahmins.Count; } }
        public int FallenCount { get { return _people.FindAll(p => p.Fallen).Count; } }

        public void BeginLoad(string baseUrl, RoaCombatPresentationFx fx, RoaAudio audio)
        {
            if (Loading != null) return;
            _fx = fx;
            _audio = audio;
            Loading = LoadCast(baseUrl);
        }

        private async Task LoadCast(string baseUrl)
        {
            try
            {
                var loads = new List<Task>();
                for (int i = 0; i < Cast.Length; i++)
                {
                    var root = new GameObject(Cast[i].Id);
                    root.transform.SetParent(transform, false);
                    var model = new GameObject("Character");
                    model.transform.SetParent(root.transform, false);
                    var performer = new Performer { Role = Cast[i], Root = root.transform,
                        View = model.AddComponent<RoaCharacterView>() };
                    _people.Add(performer);
                    loads.Add(LoadPerson(performer, baseUrl, i));
                }
                for (int i = 0; i < BrahminCount; i++)
                {
                    var root = new GameObject("PackBrahmin_" + (i + 1));
                    root.transform.SetParent(transform, false);
                    if (!RoaModelPrefabCatalog.TryInstantiate(RoaEnemyModels.Url("brahmin"),
                            root.transform, out GameObject model))
                        throw new InvalidOperationException("The bundled brahmin prefab is missing.");
                    foreach (Collider collider in model.GetComponentsInChildren<Collider>(true))
                        collider.enabled = false;
                    var renderers = model.GetComponentsInChildren<Renderer>(true);
                    if (renderers.Length > 0)
                    {
                        Bounds bounds = renderers[0].bounds;
                        foreach (Renderer renderer in renderers) bounds.Encapsulate(renderer.bounds);
                        if (bounds.size.y > 0.1f) model.transform.localScale *= 1.85f / bounds.size.y;
                    }
                    AddPacks(root.transform);
                    _brahmins.Add(root.transform);
                }
                BuildScars();
                await Task.WhenAll(loads);
                if (_disposed || this == null) return;
                Ready = LoadedPeople == Cast.Length && LoadedBrahmins == BrahminCount;
                if (!Ready) throw new InvalidOperationException("Incomplete caravan cast.");
                // The owner chooses a pose only after activating this hidden
                // prewarm root. Starting a legacy clip while inactive would mark
                // it current without actually starting playback.
            }
            catch (Exception error)
            {
                if (_disposed || this == null) return;
                LoadError = error.Message;
                Debug.LogError("[КАТ-СЦЕНА КАРАВАНА] Cast load failed: " + error);
            }
        }

        private async Task LoadPerson(Performer actor, string baseUrl, int index)
        {
            bool female = index == 3 || index == 4;
            await actor.View.Load(baseUrl, new JObject {
                ["schema"] = "realm.character-appearance.v1",
                ["sex"] = female ? "female" : "male", ["bodyType"] = "medium",
                ["faceId"] = female ? "female_02" : "male_03",
                ["hairId"] = female ? "tied_back" : "short_crop",
                ["skinToneId"] = actor.Role.Raider ? "skin_04" : "skin_03",
                ["hairColorId"] = "hair_02"
            });
            if (_disposed || actor.Root == null) return;
            await Task.WhenAll(actor.View.EquipWeapon(baseUrl, actor.Role.Weapon),
                actor.View.EquipItems(baseUrl, new JObject {
                    ["armor"] = actor.Role.Raider || index == 2 || index == 4 ? "leather" : "ballisticVest",
                    ["boots"] = "boots", ["backpack"] = "backpack"
                }));
            if (!_disposed && actor.Root != null
                && (!actor.View.WeaponReady || actor.View.LoadedEquipmentSlotCount < 3))
                throw new InvalidOperationException("Missing weapon/equipment: " + actor.Role.Id);
        }

        public void SampleDeparture(float progress)
        {
            if (!Ready) return;
            Aftermath = false;
            _scars.gameObject.SetActive(false);
            for (int i = 0; i < _people.Count; i++)
            {
                Performer actor = _people[i];
                actor.Root.gameObject.SetActive(!actor.Role.Raider);
                if (actor.Role.Raider) continue;
                Vector3 from = P(actor.Role.Start.x, 19f + (actor.Role.Start.z - 14f) * -0.7f);
                Place(actor, from + P(0f, progress * 13f), Vector3.back * 1.6f);
            }
            for (int i = 0; i < _brahmins.Count; i++)
                PlaceBrahmin(i, P(1.1f, 15f - i * 4.5f + progress * 13f), true);
        }

        public void Sample(float seconds, bool instant = false)
        {
            if (!Ready) return;
            float time = Mathf.Clamp(seconds, 0f, Duration);
            Aftermath = time >= Duration;
            for (int i = 0; i < _people.Count; i++)
            {
                Performer actor = _people[i];
                Role role = actor.Role;
                bool dead = role.FallsAt > 0f && time >= role.FallsAt;
                bool retreat = role.FallsAt == 0f && time >= 18f;
                actor.Root.gameObject.SetActive((!role.Raider || time >= 4.4f)
                    && !(retreat && time >= 22f));
                Vector3 march = role.Start + P(0f, Mathf.Min(time,5.2f));
                float entering = Mathf.Clamp01((time - (role.Raider ? 4.4f : 5.2f)) / 2.8f);
                Vector3 position = Vector3.Lerp(role.Raider ? role.Start : role.Start + P(0,5.2f),
                    role.Cover, entering);
                if (!role.Raider && time < 5.2f) position = march;
                if (retreat) position += P(role.Raider ? -8f : -6f, role.Raider ? 9f : -5f)
                    * Mathf.Clamp01((time - 18f) / 4f);
                Vector3 velocity = time < 5.2f && !role.Raider ? Vector3.back
                    : entering > 0f && entering < 1f
                        ? (role.Cover - (role.Raider ? role.Start : role.Start + P(0,5.2f))) / 2.8f
                    : retreat ? P(-1f, role.Raider ? 1f : -1f) * 2f : Vector3.zero;
                if (dead) position = role.Cover;
                Place(actor, AmbushWorld(position), dead ? Vector3.zero : velocity);
                Vector3 source = (role.Raider ? _people[3] : _people[5]).Root.position;
                actor.View.SetAim(source + Vector3.up, time >= 5.2f && !dead && !retreat);
                if (dead && !actor.Fallen)
                {
                    actor.View.PrepareDeath(source);
                    actor.View.SetDead(true);
                    actor.Fallen = true;
                }
                else if (!dead && actor.Fallen)
                {
                    actor.View.SetDead(false);
                    actor.Fallen = false;
                }
                if (dead && instant) actor.View.SetCorpsePresentationImmediate();
            }
            for (int i = 0; i < _brahmins.Count; i++)
            {
                Vector3 march = P(1f, -15f - i * 3.2f + Mathf.Min(time, 5.2f));
                Vector3 shelter = P(1.8f + i * 3.3f, -15f - i * 2f);
                float bolt = Mathf.Clamp01((time - 5.5f) / 4.5f);
                PlaceBrahmin(i, AmbushWorld(Vector3.Lerp(march, shelter, bolt)), time < 10f);
            }
            _scars.gameObject.SetActive(time >= 5.3f);
            int casualty = 0;
            foreach (Role role in Cast)
                if (role.FallsAt > 0f) _blood[casualty++].gameObject.SetActive(time >= role.FallsAt);
            if (!instant && !Aftermath) PlayCrossedCues(_lastTime, time);
            _lastTime = time;
        }

        public void CompleteAftermath()
        {
            Sample(Duration, true);
        }

        private void Place(Performer actor, Vector3 position, Vector3 velocity)
        {
            actor.Root.position = position;
            float yaw = velocity.sqrMagnitude > 0.01f
                ? Quaternion.LookRotation(velocity).eulerAngles.y
                : actor.Role.Raider ? 270f : 90f;
            if (!actor.Fallen) actor.Root.rotation = Quaternion.Euler(0f,yaw,0f);
            actor.View.UpdateLocomotion(velocity, yaw, velocity.sqrMagnitude > 0.01f, false);
        }

        private void PlaceBrahmin(int index, Vector3 position, bool moving)
        {
            Transform root = _brahmins[index];
            Vector3 delta = position - root.position;
            root.position = position;
            if (moving && delta.sqrMagnitude > 0.00001f)
                root.rotation = Quaternion.LookRotation(delta.normalized);
            Animation animation = root.GetComponentInChildren<Animation>();
            string clip = moving ? "walk" : "idle";
            if (animation != null && animation.GetClip(clip) != null && !animation.IsPlaying(clip))
            { animation.wrapMode = WrapMode.Loop; animation.Play(clip); }
        }

        private void PlayCrossedCues(float previous, float time)
        {
            if (Crossed(previous, time, 5.3f)) Explode(P(3f,-8f), 4f);
            if (Crossed(previous, time, 10.1f)) Explode(P(-1f,-6f), 2.7f);
            if (Crossed(previous, time, 15.4f)) Explode(P(8f,-9f), 2.3f);
            for (int shot = 0; shot < 34; shot++)
            {
                if (!Crossed(previous, time, 5.65f + shot * 0.36f)) continue;
                int shooter = shot % 2 == 0 ? 5 + shot / 2 % 4 : shot / 2 % 5;
                int target = shooter >= 5 ? shot % 5 : 5 + shot % 4;
                Shoot(_people[shooter], _people[target]);
            }
        }

        private void Shoot(Performer shooter, Performer target)
        {
            if (shooter.Fallen || !shooter.Root.gameObject.activeSelf) return;
            Vector3 end = target.Root.position + Vector3.up * (target.Fallen ? 0.25f : 1.1f);
            Vector3 direction = (end - (shooter.Root.position + Vector3.up * 1.2f)).normalized;
            Vector3 start = shooter.Root.position + Vector3.up * 1.25f + direction * 0.6f;
            shooter.View.SetAim(end, true);
            shooter.View.PlayAttack();
            _fx?.PlayShot(start, end, shooter.Role.Weapon, RoaCombatFx.ProfileFor(shooter.Role.Weapon));
            _audio?.PlayShot(start, end, shooter.Role.Weapon);
            if (!target.Fallen) target.View.PlayHit(start, 6, false);
            _fx?.PlayConfirmedHit(target.Root.position, start, shooter.Role.Weapon, false, false);
        }

        private void Explode(Vector3 center, float radius)
        {
            _fx?.PlayExplosion(AmbushWorld(center), radius);
            _audio?.PlayExplosion(AmbushWorld(center), radius);
        }

        private void BuildScars()
        {
            _scars = new GameObject("AmbushAftermath_Scorch_Smoke").transform;
            _scars.SetParent(transform, false);
            Material scorch = Material(new Color(0.075f, 0.06f, 0.045f));
            Material blood = Material(new Color(0.18f, 0.025f, 0.018f));
            Disc("BlastScorch", AmbushWorld(P(3,-8)), new Vector3(4.2f,0.008f,3.4f), scorch);
            foreach (Role role in Cast)
                if (role.FallsAt > 0f)
                    _blood.Add(Disc("Casualty_" + role.Id, AmbushWorld(role.Cover),
                        new Vector3(0.75f,0.006f,0.48f), blood));
            Material timber = Material(new Color(0.18f,0.115f,0.055f));
            for (int i = 0; i < 8; i++)
            {
                GameObject debris = GameObject.CreatePrimitive(PrimitiveType.Cube);
                debris.name = i < 2 ? "SplitCargoCrate" : "BrokenCargoPlank";
                debris.transform.SetParent(_scars,false);
                float angle = i * 137.5f * Mathf.Deg2Rad;
                Vector3 point = P(3,-8) + new Vector3(Mathf.Cos(angle),0f,Mathf.Sin(angle)) * (0.5f + i * 0.18f);
                debris.transform.position = AmbushWorld(point) + Vector3.up * (i < 2 ? 0.28f : 0.07f);
                debris.transform.rotation = Quaternion.Euler(i < 2 ? 14f : 0f,i * 137.5f,i < 2 ? 22f : 0f);
                debris.transform.localScale = i < 2 ? new Vector3(0.8f,0.45f,0.55f) : new Vector3(1.1f,0.07f,0.13f);
                debris.GetComponent<Renderer>().sharedMaterial = timber;
                if (Application.isPlaying) Destroy(debris.GetComponent<Collider>());
                else DestroyImmediate(debris.GetComponent<Collider>());
            }
            var smokeObject = new GameObject("BurningCargoSmoke");
            smokeObject.transform.SetParent(_scars, false);
            smokeObject.transform.position = AmbushWorld(P(3,-8)) + Vector3.up * 0.25f;
            _smoke = smokeObject.AddComponent<ParticleSystem>();
            _smoke.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = _smoke.main;
            main.loop = true; main.startLifetime = 5f; main.startSpeed = 0.9f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.6f,1.3f);
            main.startColor = new Color(0.14f,0.13f,0.12f,0.5f);
            main.maxParticles = 45; main.useUnscaledTime = true;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var emission = _smoke.emission; emission.rateOverTime = 7f;
            var shape = _smoke.shape; shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 12f; shape.radius = 0.6f; shape.rotation = new Vector3(-90f,0f,0f);
            var velocity = _smoke.velocityOverLifetime; velocity.enabled = true;
            velocity.x = new ParticleSystem.MinMaxCurve(0.45f); velocity.y = new ParticleSystem.MinMaxCurve(0.6f);
            velocity.z = new ParticleSystem.MinMaxCurve(0.1f);
            var size = _smoke.sizeOverLifetime; size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0,0.5f,1,3f));
            var color = _smoke.colorOverLifetime; color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(new[] { new GradientColorKey(Color.white,0),new GradientColorKey(Color.white,1) },
                new[] { new GradientAlphaKey(0,0),new GradientAlphaKey(0.7f,0.15f),new GradientAlphaKey(0,1) });
            color.color = gradient;
            var renderer = _smoke.GetComponent<ParticleSystemRenderer>();
            var particle = new Material(Resources.Load<Shader>("RealmOfAshes/CaravanSmoke"));
            _materials.Add(particle);
            renderer.sharedMaterial = particle;
            _smoke.Play();
            _scars.gameObject.SetActive(false);
        }

        private void AddPacks(Transform brahmin)
        {
            Material canvas = Material(new Color(0.32f,0.29f,0.18f));
            for (int side = -1; side <= 1; side += 2)
            {
                GameObject pack = GameObject.CreatePrimitive(PrimitiveType.Cube);
                pack.name = "CaravanCanvasPannier";
                pack.transform.SetParent(brahmin,false);
                pack.transform.localPosition = new Vector3(side * 0.5f,1.12f,-0.25f);
                pack.transform.localScale = new Vector3(0.42f,0.55f,0.8f);
                pack.GetComponent<Renderer>().sharedMaterial = canvas;
                if (Application.isPlaying) Destroy(pack.GetComponent<Collider>());
                else DestroyImmediate(pack.GetComponent<Collider>());
            }
        }

        public static Vector3 AmbushWorld(Vector3 authored)
        {
            Vector3 point = authored + AmbushOffset;
            // The native raised asphalt surface is 0.465 m above the surrounding soil.
            point.y = Mathf.Abs(point.x) < 4.45f ? 0.48f : 0f;
            return point;
        }

        private Material Material(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Simple Lit")
                ?? Shader.Find("Universal Render Pipeline/Lit");
            var material = new Material(shader) { color = color };
            _materials.Add(material);
            return material;
        }

        private Transform Disc(string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject disc = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            disc.name = name;
            disc.transform.SetParent(_scars, false);
            disc.transform.position = position + Vector3.up * 0.016f;
            disc.transform.localScale = scale;
            if (Application.isPlaying) Destroy(disc.GetComponent<Collider>());
            else DestroyImmediate(disc.GetComponent<Collider>());
            disc.GetComponent<Renderer>().sharedMaterial = material;
            return disc.transform;
        }

        private void OnDestroy()
        {
            _disposed = true;
            foreach (Material material in _materials)
                if (Application.isPlaying) Destroy(material); else DestroyImmediate(material);
        }

        public static bool Crossed(float previous, float now, float cue) { return previous < cue && now >= cue; }
        private static Vector3 P(float x, float z) { return RoaCoords.ToUnity(x,z); }
    }
}
