using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Собирает живые точки пустоши в один меш с несколькими материалами. Формы
    /// повторяют смысловые семейства маркеров web-клиента, но не создают сотни
    /// отдельных GameObject при каждом пятсекундном снимке симуляции.
    /// </summary>
    internal sealed class RoaGlobalMapSiteMeshBuilder
    {
        private const float VisualScale = 1.45f;
        private sealed class Bucket
        {
            public Color Color;
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<int> Triangles = new List<int>();
        }

        private readonly Dictionary<string, Bucket> _buckets = new Dictionary<string, Bucket>();
        private Vector3 _markerOrigin;
        public int MarkerCount { get; private set; }

        public void AddSite(JObject site, Vector3 origin, Color accent)
        {
            if (site == null) return;
            MarkerCount++;
            _markerOrigin = origin;
            AddRing(origin + Vector3.up * 0.02f, 0.5f, 0.42f,
                    new Color(accent.r, accent.g, accent.b, 0.72f), 24);

            string key = ModelKey(site);
            switch (Family(key))
            {
                case "caravan": AddCaravan(origin, accent); break;
                case "wreck": AddWreck(origin, accent); break;
                case "water": AddWater(origin, accent); break;
                case "ore": AddOre(origin, accent); break;
                case "scrap": AddScrap(origin, accent); break;
                case "chemical": AddChemical(origin, accent); break;
                case "electronics": AddElectronics(origin, accent); break;
                case "oil": AddOil(origin, accent); break;
                case "outpost": AddOutpost(origin, accent); break;
                case "production": AddProduction(origin, accent); break;
                case "lair": AddLair(origin, accent); break;
                case "clinic": AddClinic(origin, accent); break;
                case "farm": AddFarm(origin, accent); break;
                case "shrine": AddShrine(origin, accent); break;
                default: AddDefault(origin, accent); break;
            }
        }

        public GameObject Build(string name, Transform parent, Func<Color, Material> materialFactory, out Mesh mesh)
        {
            mesh = null;
            if (_buckets.Count == 0) return null;

            var vertices = new List<Vector3>();
            var submeshes = new List<int[]>();
            var materials = new List<Material>();
            foreach (Bucket bucket in _buckets.Values)
            {
                int offset = vertices.Count;
                vertices.AddRange(bucket.Vertices);
                int[] triangles = new int[bucket.Triangles.Count];
                for (int i = 0; i < triangles.Length; i++) triangles[i] = bucket.Triangles[i] + offset;
                submeshes.Add(triangles);
                materials.Add(materialFactory(bucket.Color));
            }

            mesh = new Mesh { name = name };
            if (vertices.Count > 65535) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.subMeshCount = submeshes.Count;
            for (int i = 0; i < submeshes.Count; i++) mesh.SetTriangles(submeshes[i], i, false);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            target.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = target.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = materials.ToArray();
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            return target;
        }

        private void AddCaravan(Vector3 o, Color accent)
        {
            AddCone(o + new Vector3(-0.22f, 0.2f, -0.05f), 0.2f, 0.36f, 4, Hex(0xc8b274), Quaternion.Euler(0f, 45f, 0f));
            AddCone(o + new Vector3(0.18f, 0.18f, 0.12f), 0.18f, 0.32f, 4, Hex(0x9f8f62), Quaternion.Euler(0f, -45f, 0f));
            AddBox(o + new Vector3(0.3f, 0.13f, -0.2f), new Vector3(0.34f, 0.16f, 0.22f), Hex(0x6b5234), Quaternion.Euler(0f, 18f, 0f));
            AddOctahedron(o + new Vector3(-0.02f, 0.12f, -0.25f), new Vector3(0.1f, 0.14f, 0.1f), Hex(0xff9d3b));
        }

        private void AddWreck(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.16f, 0f), new Vector3(0.68f, 0.2f, 0.32f), Hex(0x6d6658), Quaternion.Euler(0f, -13f, 0f));
            AddBox(o + new Vector3(-0.25f, 0.3f, 0.01f), new Vector3(0.28f, 0.22f, 0.3f), Hex(0x8b876f), Quaternion.Euler(0f, -13f, 0f));
            foreach (float x in new[] { -0.26f, 0.26f })
            {
                AddCylinder(o + new Vector3(x, 0.09f, 0.2f), 0.08f, 0.06f, 10, Hex(0x11100d), Quaternion.Euler(90f, 0f, 0f));
                AddCylinder(o + new Vector3(x, 0.09f, -0.19f), 0.075f, 0.06f, 10, Hex(0x11100d), Quaternion.Euler(90f, 0f, 0f));
            }
        }

        private void AddWater(Vector3 o, Color accent)
        {
            AddCylinder(o + new Vector3(-0.08f, 0.24f, 0f), 0.2f, 0.4f, 14, Hex(0x5da8c8), Quaternion.identity);
            AddCylinder(o + new Vector3(0.28f, 0.18f, 0f), 0.04f, 0.55f, 8, Hex(0x2f3f45), Quaternion.Euler(0f, 0f, 90f));
            AddBox(o + new Vector3(-0.32f, 0.1f, 0.14f), new Vector3(0.16f, 0.16f, 0.16f), Hex(0x29454f), Quaternion.identity);
            AddOctahedron(o + new Vector3(0.43f, 0.17f, 0.02f), new Vector3(0.12f, 0.18f, 0.12f), Hex(0x79d5ff));
        }

        private void AddOre(Vector3 o, Color accent)
        {
            AddCone(o + new Vector3(-0.08f, 0.2f, 0f), 0.4f, 0.38f, 4, Hex(0x61574c), Quaternion.Euler(0f, 45f, 0f));
            AddOctahedron(o + new Vector3(-0.3f, 0.13f, 0.19f), new Vector3(0.18f, 0.22f, 0.16f), Hex(0x9a9282));
            AddOctahedron(o + new Vector3(0.28f, 0.1f, 0.16f), new Vector3(0.13f, 0.16f, 0.12f), Hex(0xbdb08b));
            AddCylinder(o + new Vector3(0.12f, 0.35f, -0.16f), 0.024f, 0.52f, 6, accent, Quaternion.Euler(0f, 0f, 45f));
        }

        private void AddScrap(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.08f, 0f), new Vector3(0.66f, 0.1f, 0.36f), Hex(0x2a2c2b), Quaternion.Euler(0f, 12f, 0f));
            AddBox(o + new Vector3(-0.1f, 0.19f, 0.03f), new Vector3(0.46f, 0.08f, 0.22f), Hex(0x9b7b4d), Quaternion.Euler(5f, -24f, 7f));
            AddBox(o + new Vector3(0.13f, 0.29f, -0.04f), new Vector3(0.4f, 0.07f, 0.18f), Hex(0x64706c), Quaternion.Euler(-4f, 27f, -5f));
            AddCylinder(o + new Vector3(0.31f, 0.16f, 0.18f), 0.14f, 0.07f, 10, Hex(0x161514), Quaternion.Euler(90f, 0f, 0f));
            AddCone(o + new Vector3(-0.33f, 0.27f, -0.18f), 0.06f, 0.34f, 4, accent, Quaternion.Euler(0f, 0f, -20f));
        }

        private void AddChemical(Vector3 o, Color accent)
        {
            AddCylinder(o + new Vector3(-0.18f, 0.23f, 0f), 0.17f, 0.38f, 12, Hex(0x3b4d2c), Quaternion.identity);
            AddCylinder(o + new Vector3(0.17f, 0.19f, 0.08f), 0.13f, 0.3f, 12, Hex(0x6c7044), Quaternion.identity);
            AddCylinder(o + new Vector3(0.34f, 0.06f, -0.17f), 0.18f, 0.045f, 14, Hex(0x9de05c), Quaternion.identity);
            AddBox(o + new Vector3(0f, 0.09f, -0.23f), new Vector3(0.62f, 0.05f, 0.14f), Hex(0x222820), Quaternion.Euler(0f, 16f, 0f));
        }

        private void AddElectronics(Vector3 o, Color accent)
        {
            AddCylinder(o + new Vector3(0f, 0.43f, 0f), 0.024f, 0.82f, 8, Hex(0x2f3540), Quaternion.identity);
            AddBox(o + new Vector3(0.18f, 0.62f, 0.08f), new Vector3(0.42f, 0.2f, 0.04f), Hex(0x284d62), Quaternion.Euler(10f, 20f, 0f));
            AddBox(o + new Vector3(-0.22f, 0.4f, -0.04f), new Vector3(0.32f, 0.18f, 0.04f), Hex(0x3f6b7a), Quaternion.Euler(-12f, -20f, 0f));
            AddOctahedron(o + new Vector3(0f, 0.9f, 0f), Vector3.one * 0.12f, accent);
        }

        private void AddOil(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.05f, 0f), new Vector3(0.78f, 0.08f, 0.42f), Hex(0x2b2016), Quaternion.identity);
            AddCylinder(o + new Vector3(-0.2f, 0.34f, 0f), 0.025f, 0.68f, 6, Hex(0x5c4229), Quaternion.Euler(0f, 0f, 16f));
            AddCylinder(o + new Vector3(0.08f, 0.34f, 0f), 0.025f, 0.68f, 6, Hex(0x5c4229), Quaternion.Euler(0f, 0f, -16f));
            AddBox(o + new Vector3(0.05f, 0.68f, 0f), new Vector3(0.82f, 0.07f, 0.09f), Hex(0xb88746), Quaternion.Euler(0f, 0f, -14f));
            AddCylinder(o + new Vector3(0.34f, 0.19f, 0.18f), 0.14f, 0.3f, 12, Hex(0x11100c), Quaternion.identity);
        }

        private void AddOutpost(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.1f, 0f), new Vector3(0.56f, 0.16f, 0.42f), Hex(0x4b3a24), Quaternion.identity);
            AddCylinder(o + new Vector3(-0.22f, 0.42f, -0.15f), 0.03f, 0.64f, 6, Hex(0x3b2a19), Quaternion.identity);
            AddCylinder(o + new Vector3(0.22f, 0.42f, -0.15f), 0.03f, 0.64f, 6, Hex(0x3b2a19), Quaternion.identity);
            AddBox(o + new Vector3(0f, 0.74f, -0.15f), new Vector3(0.52f, 0.08f, 0.2f), Hex(0x725431), Quaternion.identity);
            AddBox(o + new Vector3(0.31f, 0.81f, -0.15f), new Vector3(0.23f, 0.17f, 0.035f), accent, Quaternion.identity);
        }

        private void AddProduction(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.2f, 0f), new Vector3(0.64f, 0.3f, 0.44f), Hex(0x3b342a), Quaternion.identity);
            AddCone(o + new Vector3(-0.08f, 0.48f, 0f), 0.38f, 0.24f, 4, Hex(0x5b4a35), Quaternion.Euler(0f, 45f, 0f));
            AddCylinder(o + new Vector3(0.3f, 0.62f, 0.07f), 0.065f, 0.66f, 9, Hex(0x1f1f1b), Quaternion.identity);
            AddBox(o + new Vector3(-0.17f, 0.4f, 0.24f), new Vector3(0.3f, 0.06f, 0.16f), accent, Quaternion.identity);
        }

        private void AddLair(Vector3 o, Color accent)
        {
            AddCone(o + new Vector3(-0.12f, 0.22f, -0.02f), 0.42f, 0.45f, 5, Hex(0x4a4539), Quaternion.Euler(0f, 35f, 0f));
            AddCone(o + new Vector3(0.25f, 0.18f, -0.07f), 0.29f, 0.36f, 5, Hex(0x5b513d), Quaternion.Euler(0f, -22f, 0f));
            AddBox(o + new Vector3(-0.02f, 0.12f, 0.21f), new Vector3(0.42f, 0.12f, 0.18f), Hex(0x0c0908), Quaternion.identity);
            AddCone(o + new Vector3(-0.36f, 0.27f, -0.15f), 0.055f, 0.3f, 4, accent, Quaternion.Euler(0f, 0f, -18f));
        }

        private void AddClinic(Vector3 o, Color accent)
        {
            AddCone(o + new Vector3(-0.12f, 0.2f, 0f), 0.25f, 0.32f, 4, Hex(0xd8d0b0), Quaternion.Euler(0f, 45f, 0f));
            AddCylinder(o + new Vector3(0.31f, 0.36f, -0.1f), 0.022f, 0.64f, 7, Hex(0x3a2c1b), Quaternion.identity);
            AddBox(o + new Vector3(0.31f, 0.68f, -0.1f), new Vector3(0.26f, 0.19f, 0.035f), Hex(0xf1e8c5), Quaternion.identity);
            AddBox(o + new Vector3(0.31f, 0.68f, -0.075f), new Vector3(0.17f, 0.04f, 0.025f), Hex(0xc84632), Quaternion.identity);
            AddBox(o + new Vector3(0.31f, 0.68f, -0.074f), new Vector3(0.04f, 0.15f, 0.025f), Hex(0xc84632), Quaternion.identity);
        }

        private void AddFarm(Vector3 o, Color accent)
        {
            AddBox(o + new Vector3(0f, 0.035f, 0f), new Vector3(0.74f, 0.05f, 0.5f), Hex(0x6a5638), Quaternion.Euler(0f, 8f, 0f));
            foreach (float z in new[] { -0.15f, 0f, 0.15f })
                AddBox(o + new Vector3(-0.12f, 0.075f, z), new Vector3(0.44f, 0.035f, 0.045f), Hex(0x83904e), Quaternion.Euler(0f, 8f, 0f));
            AddCylinder(o + new Vector3(0.27f, 0.22f, -0.1f), 0.11f, 0.34f, 10, Hex(0x78684b), Quaternion.identity);
            AddBox(o + new Vector3(0.25f, 0.14f, 0.2f), new Vector3(0.25f, 0.22f, 0.2f), Hex(0x4b3a24), Quaternion.identity);
            AddCone(o + new Vector3(0.25f, 0.31f, 0.2f), 0.2f, 0.17f, 4, accent, Quaternion.Euler(0f, 45f, 0f));
        }

        private void AddShrine(Vector3 o, Color accent)
        {
            AddCylinder(o + new Vector3(0f, 0.34f, 0f), 0.035f, 0.66f, 6, Hex(0x4d3928), Quaternion.identity);
            AddBox(o + new Vector3(0f, 0.55f, 0f), new Vector3(0.46f, 0.055f, 0.07f), Hex(0x7d5a38), Quaternion.identity);
            AddCone(o + new Vector3(0f, 0.78f, 0f), 0.1f, 0.25f, 4, accent, Quaternion.Euler(0f, 45f, 0f));
            AddOctahedron(o + new Vector3(-0.25f, 0.09f, 0.16f), new Vector3(0.13f, 0.1f, 0.12f), Hex(0xc99a52));
        }

        private void AddDefault(Vector3 o, Color accent)
        {
            AddCylinder(o + new Vector3(0f, 0.22f, 0f), 0.09f, 0.38f, 9, accent, Quaternion.identity);
            AddOctahedron(o + new Vector3(0f, 0.5f, 0f), Vector3.one * 0.22f, accent);
        }

        private static string Family(string key)
        {
            switch (key)
            {
                case "caravan_camp": return "caravan";
                case "wrecked_truck": return "wreck";
                case "water_pocket": case "water": case "dry_water_pump": return "water";
                case "ore_scars": case "prospector_claim": case "ore": case "iron_mine": case "klim_quarry": return "ore";
                case "scrap_cache": case "raider_pickup": case "scrap_fields": case "tire_depot": case "scrap": case "ammoparts": return "scrap";
                case "tech_wreck": case "relay_beacon": case "electronics": case "silicon_ridge": case "relay_outpost": return "electronics";
                case "chemicals": case "chem_spring": return "chemical";
                case "oil": return "oil";
                case "old_klim_watch": case "road_outpost": case "scrap_outpost": case "outpost": return "outpost";
                case "ammo_works": case "scrap_foundry": case "relay_workshop": case "solar_array": case "military_depot": case "production": return "production";
                case "beast_tracks": case "ghoul_ruins": case "mutant_marks": case "old_bunker_vent": case "ant_tunnels": case "mutant_crater": case "radscorpion_nest": case "gecko_canyon": case "ant_hive": case "lair": return "lair";
                case "field_clinic": return "clinic";
                case "old_klim_farm": case "burned_farmstead": return "farm";
                case "road_shrine": return "shrine";
                default: return key;
            }
        }

        private static string ModelKey(JObject site)
        {
            string activity = site["activityKind"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            if (!string.IsNullOrEmpty(activity)) return activity;
            string identity = ((site["id"]?.ToString() ?? string.Empty) + " " + (site["locationId"]?.ToString() ?? string.Empty)).ToLowerInvariant();
            if (identity.Contains("drywaterpump")) return "dry_water_pump";
            if (identity.Contains("oldklimfarm") || identity.Contains("resourceoldklimfarm")) return "old_klim_farm";
            if (identity.Contains("scrapfields")) return "scrap_fields";
            if (identity.Contains("ironmine")) return "iron_mine";
            if (identity.Contains("klimquarry")) return "klim_quarry";
            if (identity.Contains("chemspring")) return "chem_spring";
            if (identity.Contains("siliconridge")) return "silicon_ridge";
            if (identity.Contains("tiredepot")) return "tire_depot";
            if (identity.Contains("mutantcrater")) return "mutant_crater";
            if (identity.Contains("radscorpionnest")) return "radscorpion_nest";
            if (identity.Contains("geckocanyon")) return "gecko_canyon";
            if (identity.Contains("anthive")) return "ant_hive";
            if (identity.Contains("roadoutpost")) return "road_outpost";
            if (identity.Contains("scrapoutpost")) return "scrap_outpost";
            if (identity.Contains("relayoutpost")) return "relay_outpost";
            if (identity.Contains("klimammoworks")) return "ammo_works";
            if (identity.Contains("scrapfoundry")) return "scrap_foundry";
            if (identity.Contains("relayworkshop")) return "relay_workshop";
            if (identity.Contains("solararray")) return "solar_array";
            if (identity.Contains("olddepot")) return "military_depot";

            string type = site["type"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            if (type == "outpost" || type == "production" || type == "lair") return type;
            return PrimaryResource(site, type);
        }

        private static string PrimaryResource(JObject site, string fallback)
        {
            foreach (string key in new[] { "oil", "water", "ore", "scrap", "ammoParts", "chemicals", "electronics" })
            {
                float output = Number(site["output"]?[key]);
                float stockpile = Number(site["stockpile"]?[key]) * 0.02f;
                if (output > 0f || stockpile > 0f) return key.ToLowerInvariant();
            }
            return string.IsNullOrEmpty(fallback) ? "point" : fallback;
        }

        private static float Number(JToken token)
        {
            if (token == null) return 0f;
            // JValue.ToString() форматирует double текущей культурой (ru-RU даёт "173,3"),
            // и инвариантный разбор такой строки молча возвращал fallback. Числовые токены
            // читаем напрямую, строки разбираем инвариантно.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();
            float value;
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out value) ? value : 0f;
        }

        private Bucket GetBucket(Color color)
        {
            Color32 value = color;
            string key = value.r + ":" + value.g + ":" + value.b + ":" + value.a;
            Bucket bucket;
            if (_buckets.TryGetValue(key, out bucket)) return bucket;
            bucket = new Bucket { Color = color };
            _buckets.Add(key, bucket);
            return bucket;
        }

        private void AddRing(Vector3 center, float outer, float inner, Color color, int segments)
        {
            center = ScalePosition(center);
            outer *= VisualScale;
            inner *= VisualScale;
            Bucket bucket = GetBucket(color);
            for (int i = 0; i < segments; i++)
            {
                float a0 = i / (float)segments * Mathf.PI * 2f;
                float a1 = (i + 1) / (float)segments * Mathf.PI * 2f;
                Vector3 o0 = center + new Vector3(Mathf.Cos(a0) * outer, 0f, Mathf.Sin(a0) * outer);
                Vector3 o1 = center + new Vector3(Mathf.Cos(a1) * outer, 0f, Mathf.Sin(a1) * outer);
                Vector3 i0 = center + new Vector3(Mathf.Cos(a0) * inner, 0f, Mathf.Sin(a0) * inner);
                Vector3 i1 = center + new Vector3(Mathf.Cos(a1) * inner, 0f, Mathf.Sin(a1) * inner);
                AddQuad(bucket, o0, o1, i0, i1);
            }
        }

        private void AddBox(Vector3 center, Vector3 size, Color color, Quaternion rotation)
        {
            center = ScalePosition(center);
            size *= VisualScale;
            Vector3 h = size * 0.5f;
            Vector3[] p =
            {
                new Vector3(-h.x,-h.y,-h.z), new Vector3(h.x,-h.y,-h.z),
                new Vector3(-h.x,h.y,-h.z), new Vector3(h.x,h.y,-h.z),
                new Vector3(-h.x,-h.y,h.z), new Vector3(h.x,-h.y,h.z),
                new Vector3(-h.x,h.y,h.z), new Vector3(h.x,h.y,h.z)
            };
            for (int i = 0; i < p.Length; i++) p[i] = center + rotation * p[i];
            Bucket b = GetBucket(color);
            AddQuad(b, p[4], p[5], p[6], p[7]);
            AddQuad(b, p[1], p[0], p[3], p[2]);
            AddQuad(b, p[0], p[4], p[2], p[6]);
            AddQuad(b, p[5], p[1], p[7], p[3]);
            AddQuad(b, p[2], p[3], p[6], p[7]);
            AddQuad(b, p[0], p[1], p[4], p[5]);
        }

        private void AddCylinder(Vector3 center, float radius, float height, int segments, Color color, Quaternion rotation)
        {
            center = ScalePosition(center);
            radius *= VisualScale;
            height *= VisualScale;
            Bucket b = GetBucket(color);
            float half = height * 0.5f;
            Vector3 topCenter = center + rotation * new Vector3(0f, half, 0f);
            Vector3 bottomCenter = center + rotation * new Vector3(0f, -half, 0f);
            for (int i = 0; i < segments; i++)
            {
                float a0 = i / (float)segments * Mathf.PI * 2f;
                float a1 = (i + 1) / (float)segments * Mathf.PI * 2f;
                Vector3 r0 = new Vector3(Mathf.Cos(a0) * radius, 0f, Mathf.Sin(a0) * radius);
                Vector3 r1 = new Vector3(Mathf.Cos(a1) * radius, 0f, Mathf.Sin(a1) * radius);
                Vector3 b0 = center + rotation * (r0 + Vector3.down * half);
                Vector3 b1 = center + rotation * (r1 + Vector3.down * half);
                Vector3 t0 = center + rotation * (r0 + Vector3.up * half);
                Vector3 t1 = center + rotation * (r1 + Vector3.up * half);
                AddQuad(b, b0, b1, t0, t1);
                AddTriangle(b, topCenter, t0, t1);
                AddTriangle(b, bottomCenter, b1, b0);
            }
        }

        private void AddCone(Vector3 center, float radius, float height, int segments, Color color, Quaternion rotation)
        {
            center = ScalePosition(center);
            radius *= VisualScale;
            height *= VisualScale;
            Bucket b = GetBucket(color);
            float half = height * 0.5f;
            Vector3 tip = center + rotation * new Vector3(0f, half, 0f);
            Vector3 baseCenter = center + rotation * new Vector3(0f, -half, 0f);
            for (int i = 0; i < segments; i++)
            {
                float a0 = i / (float)segments * Mathf.PI * 2f;
                float a1 = (i + 1) / (float)segments * Mathf.PI * 2f;
                Vector3 p0 = center + rotation * new Vector3(Mathf.Cos(a0) * radius, -half, Mathf.Sin(a0) * radius);
                Vector3 p1 = center + rotation * new Vector3(Mathf.Cos(a1) * radius, -half, Mathf.Sin(a1) * radius);
                AddTriangle(b, p0, tip, p1);
                AddTriangle(b, baseCenter, p1, p0);
            }
        }

        private void AddOctahedron(Vector3 center, Vector3 size, Color color)
        {
            center = ScalePosition(center);
            size *= VisualScale;
            Vector3 x = new Vector3(size.x * 0.5f, 0f, 0f);
            Vector3 y = new Vector3(0f, size.y * 0.5f, 0f);
            Vector3 z = new Vector3(0f, 0f, size.z * 0.5f);
            Bucket b = GetBucket(color);
            AddTriangle(b, center + y, center + x, center + z);
            AddTriangle(b, center + y, center - z, center + x);
            AddTriangle(b, center + y, center - x, center - z);
            AddTriangle(b, center + y, center + z, center - x);
            AddTriangle(b, center - y, center + z, center + x);
            AddTriangle(b, center - y, center + x, center - z);
            AddTriangle(b, center - y, center - z, center - x);
            AddTriangle(b, center - y, center - x, center + z);
        }

        private static void AddQuad(Bucket bucket, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
        {
            int start = bucket.Vertices.Count;
            bucket.Vertices.Add(a); bucket.Vertices.Add(b); bucket.Vertices.Add(c); bucket.Vertices.Add(d);
            bucket.Triangles.Add(start); bucket.Triangles.Add(start + 2); bucket.Triangles.Add(start + 1);
            bucket.Triangles.Add(start + 2); bucket.Triangles.Add(start + 3); bucket.Triangles.Add(start + 1);
        }

        private static void AddTriangle(Bucket bucket, Vector3 a, Vector3 b, Vector3 c)
        {
            int start = bucket.Vertices.Count;
            bucket.Vertices.Add(a); bucket.Vertices.Add(b); bucket.Vertices.Add(c);
            bucket.Triangles.Add(start); bucket.Triangles.Add(start + 1); bucket.Triangles.Add(start + 2);
        }

        private Vector3 ScalePosition(Vector3 point)
        {
            return _markerOrigin + (point - _markerOrigin) * VisualScale;
        }

        private static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f, 1f);
        }
    }
}
