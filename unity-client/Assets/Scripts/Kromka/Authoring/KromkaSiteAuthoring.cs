using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>
    /// Площадка места внутри сектора: аванпост, точка добычи или кланбаза, которые стоят
    /// прямо в зоне, без портала (src/server/zone-sites.js). Прямоугольник — позиция и
    /// поворот объекта вокруг Y плюс размер по земле. Безопасный островок (Safe) — там
    /// не стреляют и туда не заходят враждебные существа. Экспорт пишет строку в
    /// `sites` определения зоны; id — прежний id места.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaSiteAuthoring : MonoBehaviour
    {
        [SerializeField] private string _siteId = string.Empty;
        [SerializeField] private string _displayName = string.Empty;
        [SerializeField] private string _kind = string.Empty;
        [SerializeField] private bool _safe;
        [SerializeField] private Vector2 _size = new Vector2(30f, 30f);

        public string SiteId => _siteId;
        public string DisplayName => _displayName;
        public string Kind => _kind;
        public bool Safe => _safe;
        /// <summary>Ширина (вдоль локальной X) и глубина (вдоль локальной Z) в метрах.</summary>
        public Vector2 Size => _size;

        public void Configure(string siteId, string displayName, string kind, bool safe, Vector2 size)
        {
            _siteId = siteId ?? string.Empty;
            _displayName = displayName ?? string.Empty;
            _kind = kind ?? string.Empty;
            _safe = safe;
            _size = new Vector2(Mathf.Max(1f, size.x), Mathf.Max(1f, size.y));
        }

        private void OnValidate()
        {
            _size = new Vector2(Mathf.Max(1f, _size.x), Mathf.Max(1f, _size.y));
        }

        private void OnDrawGizmos()
        {
            Gizmos.color = _safe ? new Color(0.35f, 1f, 0.45f, 0.9f) : new Color(1f, 0.8f, 0.25f, 0.9f);
            Matrix4x4 previous = Gizmos.matrix;
            Gizmos.matrix = Matrix4x4.TRS(transform.position, Quaternion.Euler(0f, transform.eulerAngles.y, 0f), Vector3.one);
            Gizmos.DrawWireCube(new Vector3(0f, 0.05f, 0f), new Vector3(_size.x, 0.1f, _size.y));
            Gizmos.matrix = previous;
        }
    }
}
