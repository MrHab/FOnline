using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Curated environment models shipped through Resources. Keeping the palette in a
    /// ScriptableObject lets runtime locations reuse the same approved MEP prefabs without
    /// scene references, AssetDatabase calls or generated substitute meshes.
    /// </summary>
    public sealed class RoaEnvironmentPalette : ScriptableObject
    {
        public const string ResourceKey = "RealmOfAshes/EnvironmentPalette";

        [SerializeField] private GameObject[] _dryScrubs;
        [SerializeField] private GameObject[] _stones;
        [SerializeField] private GameObject[] _groundAccents;
        [SerializeField] private GameObject[] _distantRidges;

        public int DryScrubCount { get { return Length(_dryScrubs); } }
        public int StoneCount { get { return Length(_stones); } }
        public int GroundAccentCount { get { return Length(_groundAccents); } }
        public int DistantRidgeCount { get { return Length(_distantRidges); } }

        public bool Ready
        {
            get
            {
                return DryScrubCount >= 3 && StoneCount >= 4
                    && GroundAccentCount >= 3 && DistantRidgeCount >= 4;
            }
        }

        public GameObject PickDryScrub(int index, int seed)
        {
            return Pick(_dryScrubs, index, seed, 4409);
        }

        public GameObject PickStone(int index, int seed)
        {
            return Pick(_stones, index, seed, 4421);
        }

        public GameObject PickGroundAccent(int index, int seed)
        {
            return Pick(_groundAccents, index, seed, 4423);
        }

        public GameObject PickDistantRidge(int index, int seed)
        {
            return Pick(_distantRidges, index, seed, 4441);
        }

        private static int Length(GameObject[] values)
        {
            return values != null ? values.Length : 0;
        }

        private static GameObject Pick(GameObject[] values, int index, int seed, int salt)
        {
            if (values == null || values.Length == 0) return null;
            unchecked
            {
                uint value = (uint)(index + salt) * 0x85ebca6bu;
                value ^= (uint)(seed + salt * 17) * 0x27d4eb2du;
                value ^= value >> 15;
                return values[value % (uint)values.Length];
            }
        }
    }
}
