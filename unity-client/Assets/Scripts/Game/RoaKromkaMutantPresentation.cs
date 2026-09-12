using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Лорный слой силуэта для существ Кромки. Базовые GLB служат только
    /// скелетом и походкой; постоянные формы здесь делают виды различимыми
    /// сверху ещё до наведения курсора.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaKromkaMutantPresentation : MonoBehaviour
    {
        private static readonly Dictionary<string, Material> Materials =
            new Dictionary<string, Material>(StringComparer.Ordinal);

        private string _creatureTypeId = string.Empty;
        private string _primaryAttackId = string.Empty;
        private Transform _silhouette;
        private Transform _tell;
        private Vector3 _tellScale = Vector3.one;
        private float _phase;
        private float _threatUntil;
        private float _impactUntil;

        public bool Active => !string.IsNullOrEmpty(_creatureTypeId);

        public void Configure(string creatureTypeId, string modelKey, string stableId)
        {
            _creatureTypeId = NormalizeCreatureType(creatureTypeId, modelKey);
            if (string.IsNullOrEmpty(_creatureTypeId)) return;

            _phase = StablePhase(stableId);
            GameObject holder = new GameObject("KromkaSilhouette:" + _creatureTypeId);
            holder.transform.SetParent(transform, false);
            _silhouette = holder.transform;
            BuildSilhouette();
        }

        public void SetThreat(float seconds, string attackId)
        {
            if (!Active) return;
            _primaryAttackId = attackId ?? string.Empty;
            _threatUntil = Mathf.Max(_threatUntil, Time.time + Mathf.Max(0.12f, seconds));
        }

        public void PlayImpact(string attackId)
        {
            if (!Active) return;
            _primaryAttackId = attackId ?? _primaryAttackId;
            _impactUntil = Time.time + 0.22f;
        }

        private void Update()
        {
            if (_silhouette == null) return;
            float breath = 1f + Mathf.Sin(Time.time * 2.1f + _phase) * 0.025f;
            _silhouette.localScale = Vector3.one * breath;

            if (_tell != null)
            {
                bool threat = Time.time < _threatUntil;
                bool impact = Time.time < _impactUntil;
                float pulse = threat ? 1f + Mathf.Sin(Time.time * 18f + _phase) * 0.24f : 1f;
                if (impact) pulse *= 1.32f;
                _tell.localScale = _tellScale * pulse;
                Renderer renderer = _tell.GetComponent<Renderer>();
                if (renderer != null) renderer.enabled = !string.IsNullOrEmpty(_primaryAttackId) || threat || impact;
            }
        }

        private void BuildSilhouette()
        {
            switch (_creatureTypeId)
            {
                case "burned": BuildBurned(); break;
                case "fold": BuildFold(); break;
                case "gari": BuildGari(); break;
                case "rykhlyak": BuildRykhlyak(); break;
                case "dustling": BuildDustling(); break;
                case "listener": BuildListener(); break;
                case "mourner": BuildMourner(); break;
                case "lantern": BuildLantern(); break;
            }
        }

        private void BuildBurned()
        {
            Color ember = new Color(1f, 0.25f, 0.05f, 1f);
            Add(PrimitiveType.Cube, "EmberFissureA", new Vector3(-0.18f, 1.08f, -0.24f), new Vector3(0.035f, 0.58f, 0.03f), new Vector3(0f, 0f, -14f), ember, true);
            Add(PrimitiveType.Cube, "EmberFissureB", new Vector3(0.14f, 0.88f, -0.25f), new Vector3(0.03f, 0.42f, 0.03f), new Vector3(0f, 0f, 22f), ember, true);
            _tell = Add(PrimitiveType.Sphere, "LungeTell", new Vector3(0.22f, 1.48f, -0.18f), Vector3.one * 0.13f, Vector3.zero, ember, true);
            RememberTellScale();
        }

        private void BuildFold()
        {
            Color tissue = new Color(0.34f, 0.16f, 0.22f, 1f);
            Add(PrimitiveType.Sphere, "TissueLeft", new Vector3(-0.48f, 0.86f, 0f), new Vector3(0.66f, 0.78f, 0.72f), Vector3.zero, tissue);
            Add(PrimitiveType.Sphere, "TissueRight", new Vector3(0.46f, 0.72f, 0.06f), new Vector3(0.72f, 0.64f, 0.78f), Vector3.zero, tissue);
            Add(PrimitiveType.Capsule, "LongArmLeft", new Vector3(-0.58f, 0.48f, 0.28f), new Vector3(0.22f, 0.72f, 0.22f), new Vector3(38f, 0f, 16f), tissue);
            Add(PrimitiveType.Capsule, "LongArmRight", new Vector3(0.58f, 0.46f, 0.28f), new Vector3(0.22f, 0.7f, 0.22f), new Vector3(38f, 0f, -16f), tissue);
            _tell = Add(PrimitiveType.Sphere, "SlamTell", new Vector3(0f, 1.18f, 0.08f), new Vector3(0.9f, 0.16f, 0.9f), Vector3.zero, new Color(0.75f, 0.25f, 0.35f), true);
            RememberTellScale();
        }

        private void BuildGari()
        {
            Color keratin = new Color(0.055f, 0.05f, 0.045f, 1f);
            for (int i = 0; i < 5; i++)
            {
                float z = -0.38f + i * 0.19f;
                float height = i == 2 ? 0.48f : 0.34f;
                Add(PrimitiveType.Cube, "KeratinPlate" + i, new Vector3(0f, 0.74f, z), new Vector3(0.08f, height, 0.22f), new Vector3(0f, 0f, 42f), keratin);
            }
            _tell = Add(PrimitiveType.Cube, "SprintTell", new Vector3(0f, 0.72f, -0.02f), new Vector3(0.16f, 0.12f, 0.95f), Vector3.zero, new Color(0.85f, 0.24f, 0.08f), true);
            RememberTellScale();
        }

        private void BuildRykhlyak()
        {
            Color bone = new Color(0.78f, 0.7f, 0.54f, 1f);
            Add(PrimitiveType.Sphere, "BoneShoulder", new Vector3(0f, 0.84f, 0.08f), new Vector3(1.18f, 0.38f, 0.92f), Vector3.zero, bone);
            Add(PrimitiveType.Capsule, "TuskLeft", new Vector3(-0.34f, 0.5f, 0.66f), new Vector3(0.1f, 0.46f, 0.1f), new Vector3(68f, 0f, -24f), bone);
            Add(PrimitiveType.Capsule, "TuskRight", new Vector3(0.34f, 0.5f, 0.66f), new Vector3(0.1f, 0.46f, 0.1f), new Vector3(68f, 0f, 24f), bone);
            _tell = Add(PrimitiveType.Sphere, "ChargeTell", new Vector3(0f, 0.89f, 0.18f), new Vector3(1.26f, 0.12f, 1f), Vector3.zero, new Color(1f, 0.72f, 0.18f), true);
            RememberTellScale();
        }

        private void BuildDustling()
        {
            Color shell = new Color(0.35f, 0.25f, 0.12f, 1f);
            for (int i = 0; i < 4; i++)
                Add(PrimitiveType.Sphere, "ColonySegment" + i, new Vector3(0f, 0.38f, -0.42f + i * 0.28f), new Vector3(0.72f - i * 0.06f, 0.3f, 0.46f), Vector3.zero, shell);
            for (int i = -1; i <= 1; i++)
                Add(PrimitiveType.Cube, "RaisedVent" + i, new Vector3(i * 0.22f, 0.63f, 0f), new Vector3(0.1f, 0.34f, 0.18f), new Vector3(0f, 0f, i * 16f), new Color(0.58f, 0.43f, 0.18f));
            _tell = Add(PrimitiveType.Sphere, "DustTell", new Vector3(0f, 0.45f, 0f), Vector3.one * 0.88f, Vector3.zero, new Color(0.9f, 0.58f, 0.12f), true);
            RememberTellScale();
        }

        private void BuildListener()
        {
            Color membrane = new Color(0.25f, 0.5f, 0.6f, 1f);
            Add(PrimitiveType.Cylinder, "EarLeft", new Vector3(-0.48f, 0.92f, 0.18f), new Vector3(0.5f, 0.055f, 0.5f), new Vector3(0f, 0f, 90f), membrane);
            Add(PrimitiveType.Cylinder, "EarRight", new Vector3(0.48f, 0.92f, 0.18f), new Vector3(0.5f, 0.055f, 0.5f), new Vector3(0f, 0f, 90f), membrane);
            _tell = Add(PrimitiveType.Sphere, "EchoTell", new Vector3(0f, 0.92f, 0.18f), new Vector3(1.18f, 0.08f, 1.18f), Vector3.zero, new Color(0.2f, 0.85f, 1f), true);
            RememberTellScale();
        }

        private void BuildMourner()
        {
            Color wing = new Color(0.08f, 0.065f, 0.12f, 1f);
            Add(PrimitiveType.Cube, "WingLeft", new Vector3(-0.48f, 0.98f, 0f), new Vector3(0.88f, 0.08f, 0.42f), new Vector3(0f, -18f, -22f), wing);
            Add(PrimitiveType.Cube, "WingRight", new Vector3(0.48f, 0.98f, 0f), new Vector3(0.88f, 0.08f, 0.42f), new Vector3(0f, 18f, 22f), wing);
            Add(PrimitiveType.Sphere, "VoiceSac", new Vector3(0f, 0.86f, 0.36f), new Vector3(0.28f, 0.22f, 0.22f), Vector3.zero, new Color(0.32f, 0.18f, 0.48f), true);
            _tell = Add(PrimitiveType.Sphere, "DiveTell", new Vector3(0f, 0.98f, 0f), new Vector3(1.72f, 0.08f, 0.82f), Vector3.zero, new Color(0.65f, 0.28f, 0.95f), true);
            RememberTellScale();
        }

        private void BuildLantern()
        {
            Color glow = new Color(0.12f, 0.95f, 0.78f, 1f);
            for (int i = -1; i <= 1; i++)
                Add(PrimitiveType.Sphere, "LanternBulb" + i, new Vector3(i * 0.34f, 1.22f - Mathf.Abs(i) * 0.08f, -0.04f), Vector3.one * (i == 0 ? 0.24f : 0.19f), Vector3.zero, glow, true);
            GameObject lightObject = new GameObject("SymbiontLight");
            lightObject.transform.SetParent(_silhouette, false);
            lightObject.transform.localPosition = new Vector3(0f, 1.18f, 0f);
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = glow;
            light.range = 3.2f;
            light.intensity = 1.1f;
            light.shadows = LightShadows.None;
            _tell = Add(PrimitiveType.Sphere, "PanicTell", new Vector3(0f, 1.18f, 0f), new Vector3(1f, 0.08f, 1f), Vector3.zero, Color.white, true);
            RememberTellScale();
        }

        private Transform Add(PrimitiveType primitive, string objectName, Vector3 position,
                              Vector3 scale, Vector3 rotation, Color color, bool emissive = false)
        {
            GameObject part = GameObject.CreatePrimitive(primitive);
            part.name = objectName;
            part.transform.SetParent(_silhouette, false);
            part.transform.localPosition = position;
            part.transform.localEulerAngles = rotation;
            part.transform.localScale = scale;
            Collider collider = part.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            Renderer renderer = part.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = MaterialFor(color, emissive);
            return part.transform;
        }

        private void RememberTellScale()
        {
            if (_tell == null) return;
            _tellScale = _tell.localScale;
            Renderer renderer = _tell.GetComponent<Renderer>();
            if (renderer != null) renderer.enabled = false;
        }

        private static Material MaterialFor(Color color, bool emissive)
        {
            string key = ColorUtility.ToHtmlStringRGBA(color) + (emissive ? ":e" : ":l");
            Material material;
            if (Materials.TryGetValue(key, out material) && material != null) return material;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            material = new Material(shader) { name = "KromkaMutant_" + key };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (emissive)
            {
                material.EnableKeyword("_EMISSION");
                if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * 2.4f);
            }
            Materials[key] = material;
            return material;
        }

        private static string NormalizeCreatureType(string creatureTypeId, string modelKey)
        {
            if (!string.IsNullOrEmpty(creatureTypeId)) return creatureTypeId.Trim().ToLowerInvariant();
            switch (modelKey ?? string.Empty)
            {
                case "kromkaBurned": return "burned";
                case "kromkaFold": return "fold";
                case "kromkaGari": return "gari";
                case "kromkaRykhlyak": return "rykhlyak";
                case "kromkaDustling": return "dustling";
                case "kromkaListener": return "listener";
                case "kromkaMourner": return "mourner";
                case "kromkaLantern": return "lantern";
                default: return string.Empty;
            }
        }

        private static float StablePhase(string value)
        {
            uint hash = 2166136261u;
            unchecked
            {
                foreach (char c in value ?? string.Empty)
                {
                    hash ^= c;
                    hash *= 16777619u;
                }
            }
            return (hash % 628u) / 100f;
        }
    }
}
