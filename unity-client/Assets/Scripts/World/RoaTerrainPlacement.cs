using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Ground offset of a native-size authored object after terrain projection.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaTerrainPlacement : MonoBehaviour
    {
        public float GroundOffset;
    }
}
