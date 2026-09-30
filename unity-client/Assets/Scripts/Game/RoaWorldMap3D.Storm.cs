using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Буря выброса на карте мира: полоса между задней и передней кромкой, лежащая
    /// на рельефе, со светящейся передней кромкой и стрелками хода. Кромки считает
    /// тот же RoaRadiationStormPath, что двигает стену в сцене зоны, по тем же
    /// серверным часам, поэтому на карте и в зоне буря стоит в одной точке.
    /// Полоса видна и за краем мира (на поле StormMarginKm) — там, откуда буря
    /// наползает.
    /// </summary>
    public sealed partial class RoaWorldMap3D
    {
        public const float StormMarginKm = 45f;
        private const float StormLift = 0.09f;
        private const float StormStepKm = 2.5f;
        private const float StormArrowEveryKm = 48f;
        private const float StormRebuildSeconds = 0.1f;

        private static readonly Color StormGlow = new Color(0.72f, 1f, 0.38f, 1f);
        private static readonly Color StormBody = new Color(0.36f, 0.45f, 0.2f, 1f);
        private static readonly Color StormTail = new Color(0.3f, 0.34f, 0.22f, 1f);

        private GameObject _stormView;
        private Mesh _stormBand;
        private Mesh _stormArrows;
        private Material _stormBandMaterial;
        private Material _stormArrowMaterial;
        private float _stormBuiltAt = -10f;
        private string _stormBuiltId = string.Empty;
        private readonly List<Vector3> _stormVertices = new List<Vector3>();
        private readonly List<Vector2> _stormUvs = new List<Vector2>();
        private readonly List<Color> _stormColors = new List<Color>();
        private readonly List<int> _stormTriangles = new List<int>();

        // Ряды поперёк полосы: смещение от кромки (км), какая кромка, прозрачность, цвет и uv.y.
        private static readonly (float offset, bool lead, float alpha, int tone, float v)[] StormRows =
        {
            (5f, true, 0f, 0, 0.1f),
            (1.2f, true, 0.45f, 0, 0.12f),
            (0f, true, 0.95f, 0, 0.14f),
            (-2.5f, true, 0.88f, 1, 0.25f),
            (-14f, true, 0.78f, 1, 0.45f),
            (9f, false, 0.66f, 1, 0.7f),
            (0f, false, 0.36f, 2, 0.85f),
            (-6f, false, 0f, 2, 0.9f)
        };

        public bool HasStorm { get { return _stormView != null && _stormView.activeSelf; } }

        /// <summary>Показать бурю на момент серверного времени nowMs; null — убрать.</summary>
        public void ShowStorm(RoaRadiationStormPath path, double nowMs)
        {
            if (_root == null) return;
            if (path == null)
            {
                if (_stormView != null) _stormView.SetActive(false);
                return;
            }
            if (_stormView != null && _stormView.activeSelf && _stormBuiltId == path.Id
                && Time.unscaledTime - _stormBuiltAt < StormRebuildSeconds) return;
            EnsureStormView();
            _stormBuiltAt = Time.unscaledTime;
            _stormBuiltId = path.Id;
            bool visible = BuildStormBand(path, nowMs);
            if (visible) BuildStormArrows(path, nowMs);
            if (_stormView.activeSelf != visible) _stormView.SetActive(visible);
        }

        /// <summary>
        /// Точка передней кромки, ближайшая к точке карты near (для подписи бури);
        /// false — кромка вне поля карты.
        /// </summary>
        public static bool StormLeadPoint(RoaRadiationStormPath path, double nowMs, Vector2 near, float widthKm, float heightKm, out Vector2 point)
        {
            double q = path.Across(near.x, near.y);
            double p = path.LeadAt(q, nowMs);
            point = path.PointAt(p, q);
            return point.x >= -StormMarginKm && point.y >= -StormMarginKm
                && point.x <= widthKm + StormMarginKm && point.y <= heightKm + StormMarginKm;
        }

        private bool BuildStormBand(RoaRadiationStormPath path, double nowMs)
        {
            _stormVertices.Clear();
            _stormUvs.Clear();
            _stormColors.Clear();
            _stormTriangles.Clear();
            float minX = -StormMarginKm, minY = -StormMarginKm;
            float maxX = _widthKm + StormMarginKm, maxY = _heightKm + StormMarginKm;
            double qMin = double.MaxValue, qMax = double.MinValue, pMin = double.MaxValue, pMax = double.MinValue;
            foreach (Vector2 corner in new[] { new Vector2(minX, minY), new Vector2(maxX, minY), new Vector2(minX, maxY), new Vector2(maxX, maxY) })
            {
                double q = path.Across(corner.x, corner.y);
                double p = path.Along(corner.x, corner.y);
                if (q < qMin) qMin = q;
                if (q > qMax) qMax = q;
                if (p < pMin) pMin = p;
                if (p > pMax) pMax = p;
            }
            double line = path.LeadLineKm(nowMs);
            // Вся полоса ещё до поля карты или уже за ним — рисовать нечего.
            if (line + path.WaveKm + 6d < pMin || line - path.WidthKm - path.WaveKm - 6d > pMax) return false;

            int columns = Mathf.Clamp(Mathf.CeilToInt((float)((qMax - qMin) / StormStepKm)), 2, 400);
            int rows = StormRows.Length;
            for (int c = 0; c <= columns; c++)
            {
                double q = qMin + (qMax - qMin) * c / columns;
                double lead = path.LeadAt(q, nowMs);
                double trail = path.TrailAt(q, nowMs);
                foreach (var row in StormRows)
                {
                    double p = (row.lead ? lead : trail) + row.offset;
                    // Передние ряды не заходят за задние там, где полоса тонкая.
                    if (row.lead && row.offset < 0f) p = System.Math.Max(p, trail + 1d);
                    if (!row.lead && row.offset > 0f) p = System.Math.Min(p, lead - 3d);
                    Vector2 point = path.PointAt(p, q);
                    // Поле карты режет полосу: точка за полем ложится на его край.
                    point = new Vector2(Mathf.Clamp(point.x, minX, maxX), Mathf.Clamp(point.y, minY, maxY));
                    _stormVertices.Add(StormLocal(point));
                    // Узор шума — в километрах по обеим осям (иначе он тянется штрихами);
                    // +10 уводит uv.y от нижнего края шейдера стены.
                    _stormUvs.Add(new Vector2((float)(q * 0.12d), 10f + (float)((lead - p) * 0.12d)));
                    Color tone = row.tone == 0 ? StormGlow : row.tone == 1 ? StormBody : StormTail;
                    tone.a = row.alpha;
                    _stormColors.Add(tone);
                }
            }
            for (int c = 0; c < columns; c++)
            {
                for (int r = 0; r < rows - 1; r++)
                {
                    int a = c * rows + r;
                    int b = a + rows;
                    _stormTriangles.Add(a); _stormTriangles.Add(b); _stormTriangles.Add(a + 1);
                    _stormTriangles.Add(a + 1); _stormTriangles.Add(b); _stormTriangles.Add(b + 1);
                }
            }
            _stormBand.Clear();
            _stormBand.SetVertices(_stormVertices);
            _stormBand.SetUVs(0, _stormUvs);
            _stormBand.SetColors(_stormColors);
            _stormBand.SetTriangles(_stormTriangles, 0);
            _stormBand.RecalculateBounds();
            return true;
        }

        /// <summary>Стрелки хода бури перед передней кромкой, по одной на StormArrowEveryKm.</summary>
        private void BuildStormArrows(RoaRadiationStormPath path, double nowMs)
        {
            var data = new MeshBuilder();
            double qMin = path.Across(0f, 0f), qMax = qMin;
            foreach (Vector2 corner in new[] { new Vector2(_widthKm, 0f), new Vector2(0f, _heightKm), new Vector2(_widthKm, _heightKm) })
            {
                double q = path.Across(corner.x, corner.y);
                if (q < qMin) qMin = q;
                if (q > qMax) qMax = q;
            }
            var forward = new Vector2((float)path.DirX, (float)path.DirY);
            var side = new Vector2(-forward.y, forward.x);
            var color = new Color(StormGlow.r, StormGlow.g, StormGlow.b, 0.85f);
            double first = System.Math.Ceiling(qMin / StormArrowEveryKm) * StormArrowEveryKm;
            for (double q = first; q <= qMax; q += StormArrowEveryKm)
            {
                Vector2 tip = path.PointAt(path.LeadAt(q, nowMs) + 9d, q);
                if (tip.x < 0f || tip.y < 0f || tip.x > _widthKm || tip.y > _heightKm) continue;
                Vector2 back = tip - forward * 5f;
                int start = data.Vertices.Count;
                data.Vertices.Add(StormLocal(tip, 0.02f));
                data.Vertices.Add(StormLocal(back + side * 3.2f, 0.02f));
                data.Vertices.Add(StormLocal(back - side * 3.2f, 0.02f));
                data.Colors.Add(color);
                data.Colors.Add(new Color(color.r, color.g, color.b, 0.35f));
                data.Colors.Add(new Color(color.r, color.g, color.b, 0.35f));
                data.Triangles.Add(start); data.Triangles.Add(start + 1); data.Triangles.Add(start + 2);
            }
            _stormArrows.Clear();
            _stormArrows.SetVertices(data.Vertices);
            _stormArrows.SetColors(data.Colors);
            _stormArrows.SetTriangles(data.Triangles, 0);
            _stormArrows.RecalculateBounds();
        }

        /// <summary>Точка полосы над рельефом; за краем мира рельеф берётся с края.</summary>
        private Vector3 StormLocal(Vector2 point, float extraLift = 0f)
        {
            var ground = new Vector2(Mathf.Clamp(point.x, 0f, _widthKm), Mathf.Clamp(point.y, 0f, _heightKm));
            return new Vector3((point.x - _widthKm * 0.5f) * WorldScale, ReliefAt(ground) + StormLift + extraLift,
                (_heightKm * 0.5f - point.y) * WorldScale);
        }

        private void EnsureStormView()
        {
            if (_stormView != null) return;
            _stormView = new GameObject("WorldMapStorm");
            _stormView.layer = MapLayer;
            _stormView.transform.SetParent(_root, false);
            Shader shader = Resources.Load<Shader>("RealmOfAshes/StormWall");
            if (shader == null) shader = Shader.Find("RealmOfAshes/Storm Wall");
            if (shader != null)
            {
                _stormBandMaterial = new Material(shader) { name = "WorldMapStormBand", renderQueue = 3005 };
                _stormBandMaterial.SetFloat("_TopFade", 0f);
                _stormBandMaterial.SetFloat("_Glow", 0f);
                // Тон полосы задают цвета вершин (светящаяся кромка, тёмное тело): пыль — светлая.
                _stormBandMaterial.SetColor("_DustColor", new Color(0.95f, 0.95f, 0.9f, 1f));
                _stormBandMaterial.SetVector("_NoiseScale", new Vector4(2.6f, 3.4f, 0f, 0f));
                _stormBandMaterial.SetVector("_Scroll", new Vector4(0.05f, 0.12f, 0f, 0f));
            }
            else _stormBandMaterial = OverlayMaterial(3005);
            _stormArrowMaterial = OverlayMaterial(3006);
            _stormBand = StormMeshObject("StormBand", _stormBandMaterial);
            _stormArrows = StormMeshObject("StormArrows", _stormArrowMaterial);
        }

        private Mesh StormMeshObject(string name, Material material)
        {
            var mesh = new Mesh { name = "WorldMap" + name };
            mesh.MarkDynamic();
            _meshes.Add(mesh);
            var go = new GameObject(name);
            go.layer = MapLayer;
            go.transform.SetParent(_stormView.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return mesh;
        }

        /// <summary>Сцена карты выгружена (телефон) или окно разрушено: полосу строить заново.</summary>
        private void ReleaseStorm()
        {
            if (_stormView != null) Discard(_stormView);
            if (_stormBandMaterial != null && !_materials.Contains(_stormBandMaterial)) Discard(_stormBandMaterial);
            _stormView = null;
            _stormBand = _stormArrows = null;
            _stormBandMaterial = _stormArrowMaterial = null;
            _stormBuiltId = string.Empty;
        }
    }
}
