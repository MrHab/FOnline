using System.Threading.Tasks;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Authored world prop using the same downloaded model as inventory drops.</summary>
    public sealed class RoaItemPropView : MonoBehaviour
    {
        public string ItemId = "medkit";
        private GameObject _model;
        private int _request;
        public bool Ready => _model != null;

        private void OnEnable()
        {
            if (Application.isPlaying) _ = Load(RoaGameBootstrap.ActiveBaseUrl);
        }

        public async Task Load(string origin)
        {
            int request = ++_request;
            if (_model != null) { _model.SetActive(false); Destroy(_model); _model = null; }
            GameObject loaded = await RoaItemModelCatalog.InstantiateInactive(origin, ItemId, transform);
            if (this == null || request != _request || !isActiveAndEnabled)
            {
                if (loaded != null) Destroy(loaded);
                return;
            }
            if (loaded == null) return;
            // Tutorial anchors historically denote the case handle. Keep that
            // authored placement while replacing all visible procedural parts.
            Transform grip = RoaItemModelCatalog.FindSocket(loaded.transform, "socket_grip_r");
            if (grip != null) loaded.transform.position += transform.position - grip.position;
            _model = loaded;
            var gate = GetComponentInParent<RoaVisibilityGate>();
            if (gate != null) { gate.Invalidate(); gate.SetVisible(gate.IsVisible); }
            loaded.SetActive(true);
        }

        private void OnDisable()
        {
            ++_request;
            if (_model != null) { _model.SetActive(false); Destroy(_model); _model = null; }
        }

        private void OnDrawGizmosSelected()
        {
            if (Ready) return;
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.color = Color.green;
            Gizmos.DrawWireCube(new Vector3(0, -.12f, 0), new Vector3(.30f, .25f, .12f));
        }
    }
}
