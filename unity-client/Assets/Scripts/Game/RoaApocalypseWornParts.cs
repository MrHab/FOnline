using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// PolygonApocalypse attachment prefabs worn over armor (metal plates, pouches,
    /// radios) and the dark "burnt" metal material for plates. Built by
    /// RoaApocalypseWornPartsBuilder; the prefabs are authored in character space.
    /// </summary>
    public sealed class RoaApocalypseWornParts : ScriptableObject
    {
        public const string ResourcePath = "RealmOfAshes/PolygonApocalypseWornParts";

        [Serializable]
        public sealed class Part
        {
            public string name;
            public GameObject prefab;
        }

        [SerializeField] private Material metal;
        // The pack character wearing the metal shoulder plates (SM_Chr_Criminal_Male_01).
        [SerializeField] private GameObject plateDonor;
        [SerializeField] private List<Part> parts = new List<Part>();

        private static RoaApocalypseWornParts _instance;
        private Dictionary<string, GameObject> _byName;

        private static RoaApocalypseWornParts Instance =>
            _instance != null ? _instance : (_instance = Resources.Load<RoaApocalypseWornParts>(ResourcePath));

        /// <summary>Dark worn metal for plates; the default atlas paints them rust-orange.</summary>
        public static Material Metal => Instance != null ? Instance.metal : null;

        /// <summary>Pack character whose metal shoulder plates armor borrows, with their authored pose.</summary>
        public static GameObject PlateDonor => Instance != null ? Instance.plateDonor : null;

        /// <summary>Attachment prefab by its pack name without the SM_Chr_Attach_ prefix.</summary>
        public static GameObject Get(string name)
        {
            RoaApocalypseWornParts catalog = Instance;
            if (catalog == null || string.IsNullOrEmpty(name)) return null;
            if (catalog._byName == null)
            {
                catalog._byName = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (Part part in catalog.parts)
                    if (part != null && part.prefab != null && !string.IsNullOrEmpty(part.name))
                        catalog._byName[part.name] = part.prefab;
            }
            return catalog._byName.TryGetValue(name, out GameObject prefab) ? prefab : null;
        }

        public void Configure(Material metalMaterial, GameObject metalPlateDonor, List<Part> wornParts)
        {
            metal = metalMaterial;
            plateDonor = metalPlateDonor;
            parts = wornParts;
            _byName = null;
            _instance = null;
        }
    }
}
