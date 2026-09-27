using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Где у каждой модели предмета лежат места для рук: рукоять со спуском,
    /// затыльник приклада, низ цевья по длине ствола, древко и боёк. Меши пака в
    /// сборке нечитаемы, поэтому всё снято в редакторе с вершин модели
    /// (Realm of Ashes/Animation/Bake hold anchors) и хранится здесь, в
    /// пространстве корня префаба: у огнестрела ствол идёт по +Z, у ближнего
    /// оружия и инструментов рукоять — по +Y снизу вверх.
    /// </summary>
    public sealed class RoaHoldAnchors : ScriptableObject
    {
        private const string ResourcePath = "RealmOfAshes/HoldAnchors";

        [Serializable]
        public sealed class Entry
        {
            public string prefab;
            public bool firearm;
            public Vector3 min;
            public Vector3 max;

            // Огнестрел.
            public Vector3 trigger;
            /// <summary>Ось рукояти: верх (под спуском) и низ, по центру сечения.</summary>
            public Vector3 gripTop;
            public Vector3 gripBottom;
            public float gripRadius;
            /// <summary>Рукоять найдена по сечениям (иначе — оценка от спуска).</summary>
            public bool gripMeasured;
            /// <summary>Центр затыльника приклада и его высота.</summary>
            public Vector3 butt;
            public float buttHeight;
            public Vector3 muzzle;
            /// <summary>Ось канала ствола (x, y) — середина сечения у дула.</summary>
            public Vector2 bore;
            /// <summary>
            /// Сечения впереди спуска через 2 см: x — середина, y — низ, z —
            /// положение по стволу, w — полуширина.
            /// </summary>
            public Vector4[] underside = Array.Empty<Vector4>();
            /// <summary>Верх тех же сечений (для ручки для переноски сверху).</summary>
            public float[] top = Array.Empty<float>();
            /// <summary>Отдельная деталь-рукоять (помпа, передняя ручка), если есть.</summary>
            public bool hasHandle;
            public Vector3 handleCentre;
            public Vector3 handleSize;
            public bool hasMagazine;
            public Vector3 magazineCentre;

            // Ближнее оружие и инструменты.
            /// <summary>Торец рукояти (низ) и конец древка там, где начинается боёк.</summary>
            public Vector3 haftBottom;
            public Vector3 haftTop;
            public float haftRadius;
            public Vector3 headCentre;
            /// <summary>Куда от оси древка выступает боёк (лезвие топора, крюк, лопата).</summary>
            public Vector3 headSide;
            /// <summary>Длинная ось модели (0 — x, 1 — y, 2 — z) и ширина сечений через 1 см вдоль неё.</summary>
            public int longAxis;
            public float[] widths = Array.Empty<float>();
        }

        [SerializeField] private List<Entry> entries = new List<Entry>();

        private static RoaHoldAnchors _instance;
        private Dictionary<string, Entry> _byPrefab;

        public static Entry Find(string prefabName)
        {
            if (string.IsNullOrEmpty(prefabName)) return null;
            if (_instance == null) _instance = Resources.Load<RoaHoldAnchors>(ResourcePath);
            if (_instance == null) return null;
            if (_instance._byPrefab == null)
            {
                _instance._byPrefab = new Dictionary<string, Entry>(StringComparer.Ordinal);
                foreach (Entry entry in _instance.entries)
                    if (entry != null && !string.IsNullOrEmpty(entry.prefab)) _instance._byPrefab[entry.prefab] = entry;
            }
            return _instance._byPrefab.TryGetValue(prefabName, out Entry found) ? found : null;
        }

#if UNITY_EDITOR
        public List<Entry> Entries => entries;
        public void ResetCache() => _byPrefab = null;
#endif
    }
}
