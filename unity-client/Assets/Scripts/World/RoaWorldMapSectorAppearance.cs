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
        public GameObject DesktopDetail;
        public GameObject MobileDetail;
        public Mesh DesktopGround;
        public Mesh MobileGround;
        public Mesh[] SurfaceCovers;
        private bool _mobile;
        private RoaMeshSurfaceHeight _heightMesh;
        private Mesh _heightSource;
        private Mesh[] _coverSource;
        private RoaMeshSurfaceHeight[] _coverHeights;
        public void SetMobile(bool mobile)
        {
            _mobile=mobile;
            if(DesktopDetail!=null)DesktopDetail.SetActive(!mobile);
            if(MobileDetail!=null)MobileDetail.SetActive(mobile);
        }
#if UNITY_EDITOR
        // Original scene references make repeated baking reversible and idempotent.
        public MeshRenderer[] OriginalRenderers;
        public Mesh[] OriginalMeshes;
        public bool[] OriginalEnabled;
#endif

        public bool TryHeight(Vector2 point, out float height)
        {
            height = 0f;
            if (point.x < MapMin.x || point.x > MapMax.x || point.y < MapMin.y || point.y > MapMax.y)return false;
            Mesh source=_mobile?MobileGround:DesktopGround;
            if(source!=null)
            {
                if(_heightSource!=source){_heightMesh=new RoaMeshSurfaceHeight(source);_heightSource=source;}
                Bounds bounds=_heightMesh.Bounds;
                float px=Mathf.Lerp(bounds.min.x,bounds.max.x,(point.x-MapMin.x)/(MapMax.x-MapMin.x));
                float pz=Mathf.Lerp(bounds.max.z,bounds.min.z,(point.y-MapMin.y)/(MapMax.y-MapMin.y));
                if(!_heightMesh.TryHeight(px,pz,out float local))return false;
                if(_coverSource!=SurfaceCovers)
                {
                    _coverSource=SurfaceCovers;
                    _coverHeights=SurfaceCovers==null?null:System.Array.ConvertAll(SurfaceCovers,m=>new RoaMeshSurfaceHeight(m));
                }
                if(_coverHeights!=null)foreach(var cover in _coverHeights)
                    if(cover.TryHeight(px,pz,out float above))local=Mathf.Max(local,above);
                height=transform.localPosition.y+local*transform.localScale.y;return true;
            }
            if(Heights == null || HeightSide < 2 || Heights.Length != HeightSide * HeightSide)return false;
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
