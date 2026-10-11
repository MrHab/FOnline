using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Editor-baked local sector displayed in the authored world map.</summary>
    public sealed class RoaWorldMapSectorAppearance : MonoBehaviour
    {
        public Vector2 MapMin = new Vector2(195.8f, 200f);
        public Vector2 MapMax = new Vector2(215.8f, 220f);
        public int HeightSide;
        public float[] Heights;
#if UNITY_EDITOR
        // Original scene references make repeated baking reversible and idempotent.
        public MeshRenderer[] OriginalRenderers;
        public Mesh[] OriginalMeshes;
        public bool[] OriginalEnabled;
#endif

        public bool TryHeight(Vector2 point, out float height)
        {
            height = 0f;
            if (point.x < MapMin.x || point.x > MapMax.x || point.y < MapMin.y || point.y > MapMax.y
                || Heights == null || HeightSide < 2 || Heights.Length != HeightSide * HeightSide) return false;
            float x = (point.x - MapMin.x) / (MapMax.x - MapMin.x) * (HeightSide - 1);
            float y = (MapMax.y - point.y) / (MapMax.y - MapMin.y) * (HeightSide - 1);
            int ix = Mathf.Min(Mathf.FloorToInt(x), HeightSide - 2);
            int iy = Mathf.Min(Mathf.FloorToInt(y), HeightSide - 2);
            float a = Mathf.Lerp(Heights[iy * HeightSide + ix], Heights[iy * HeightSide + ix + 1], x - ix);
            float b = Mathf.Lerp(Heights[(iy + 1) * HeightSide + ix], Heights[(iy + 1) * HeightSide + ix + 1], x - ix);
            height = Mathf.Lerp(a, b, y - iy);
            return true;
        }
    }
}
