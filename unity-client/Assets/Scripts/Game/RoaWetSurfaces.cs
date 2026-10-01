using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Мокрые предметы, растения, машины и персонажи в дождь. Шейдеры не правятся —
    /// освещаемые материалы локального мира (всё с _BaseColor и _Smoothness: URP Lit, атлас
    /// Synty Generic_Basic — на нём почти всё окружение, персонажи и оружие, — и материалы
    /// glTF) меняют свои значения: цвет темнеет (пористое — сильнее, гладкое и металл —
    /// слабее), гладкость растёт до мокрого блеска. Каждое значение помнит, что записала
    /// сюда влажность; если его поменял кто-то ещё (окраска, эффект), новое значение
    /// становится сухим, прозрачность не трогается вовсе. Когда погода сохнет, земля
    /// уходит или объект выключается, сухие значения возвращаются — материалы-ассеты в
    /// редакторе не остаются мокрыми после Play Mode. Слои UI, карты мира и превью
    /// персонажа не трогаются. Влажность ставит RoaWeather: max(дождь, намокание земли).
    /// </summary>
    public sealed class RoaWetSurfaces : MonoBehaviour
    {
        private sealed class Entry
        {
            public Material Material;
            public bool Gltf;
            public Color DryColor;
            public float DrySmoothness;
            public float Metallic;
            public Color WrittenColor;
            public float WrittenValue;
            public bool Written;
        }

        public const float ScanInterval = 3f;
        public const float ApplyInterval = 0.25f;
        /// <summary>UI (5), карта мира (RoaWorldMap3D.MapLayer), превью персонажа (RoaCharacterPreview.PreviewLayer).</summary>
        public const int ExcludedLayers = (1 << 5) | (1 << RoaWorldMap3D.MapLayer) | (1 << RoaCharacterPreview.PreviewLayer);

        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int SmoothnessId = Shader.PropertyToID("_Smoothness");
        private static readonly int MetallicId = Shader.PropertyToID("_Metallic");
        private static readonly int SurfaceId = Shader.PropertyToID("_Surface");
        private static readonly int GltfColorId = Shader.PropertyToID("baseColorFactor");
        private static readonly int GltfRoughnessId = Shader.PropertyToID("roughnessFactor");
        private static readonly int GltfMetallicId = Shader.PropertyToID("metallicFactor");
        private static readonly List<RoaWetSurfaces> Instances = new List<RoaWetSurfaces>();

        private readonly Dictionary<Material, Entry> _entries = new Dictionary<Material, Entry>();
        private readonly List<Entry> _list = new List<Entry>();
        private readonly HashSet<Material> _rejected = new HashSet<Material>();
        private readonly List<Material> _buffer = new List<Material>();
        private float _target;
        private float _applied;
        private float _nextScan;
        private float _nextApply;
        private bool _dirty;
        private bool _active;

        public float Wetness { get { return _target; } }
        public float AppliedWetness { get { return _applied; } }
        public int MaterialCount { get { return _list.Count; } }
        public bool LocalWorldActive { get { return _active; } }

        /// <summary>Влажность предметов 0..1 (RoaWeather).</summary>
        public void SetWetness(float value)
        {
            _target = Mathf.Clamp01(value);
        }

        /// <summary>Мир зоны есть или нет. Без мира всё сухое и реестр пуст.</summary>
        public void SetLocalWorldActive(bool active)
        {
            if (_active == active) return;
            _active = active;
            if (!active) RestoreAll();
            else
            {
                // В Edit Mode (пробы) OnEnable не зовётся: регистрируемся и здесь.
                if (!Instances.Contains(this)) Instances.Add(this);
                _nextScan = 0f;
            }
        }

        /// <summary>Собрать материалы сейчас (новая зона, пробы); иначе — раз в три секунды, пока мокро.</summary>
        public void Rescan()
        {
            Scan();
            _nextScan = Time.unscaledTime + ScanInterval;
        }

        /// <summary>Записать влажность сейчас, без ожидания (пробы).</summary>
        public void ApplyNow()
        {
            Apply(_target);
        }

        /// <summary>Сухие значения обратно во все материалы; реестр пуст.</summary>
        public void RestoreAll()
        {
            for (int i = 0; i < _list.Count; i++)
            {
                Entry entry = _list[i];
                if (entry.Material == null) continue;
                Color current = GetColor(entry);
                if (!entry.Written || SameRgb(current, entry.WrittenColor))
                    SetColor(entry, new Color(entry.DryColor.r, entry.DryColor.g, entry.DryColor.b, current.a));
                if (!entry.Written || Mathf.Abs(GetValue(entry) - entry.WrittenValue) < 0.0001f)
                    SetValue(entry, entry.Gltf ? 1f - entry.DrySmoothness : entry.DrySmoothness);
            }
            _entries.Clear();
            _list.Clear();
            _rejected.Clear();
            _applied = 0f;
            _dirty = false;
        }

        /// <summary>Для выхода из Play Mode в редакторе: вернуть сухое во всех экземплярах.</summary>
        public static void RestoreEverywhere()
        {
            for (int i = 0; i < Instances.Count; i++)
                if (Instances[i] != null) Instances[i].RestoreAll();
        }

        /// <summary>
        /// Копия материала, снятая в дождь, должна начать сухой: вернуть в неё сухой цвет и
        /// гладкость источника (RoaRoofCutaway копирует материалы крыш при загрузке зоны).
        /// </summary>
        public static void CopyDry(Material source, Material copy)
        {
            if (source == null || copy == null) return;
            for (int i = 0; i < Instances.Count; i++)
            {
                RoaWetSurfaces owner = Instances[i];
                if (owner == null || !owner._entries.TryGetValue(source, out Entry entry)) continue;
                Color alpha = GetColor(new Entry { Material = copy, Gltf = entry.Gltf });
                var dry = new Entry { Material = copy, Gltf = entry.Gltf };
                SetColor(dry, new Color(entry.DryColor.r, entry.DryColor.g, entry.DryColor.b, alpha.a));
                SetValue(dry, entry.Gltf ? 1f - entry.DrySmoothness : entry.DrySmoothness);
                return;
            }
        }

        /// <summary>Сухое значение цвета и гладкости материала в реестре (пробы).</summary>
        public bool TryGetDry(Material material, out Color color, out float smoothness)
        {
            color = default(Color);
            smoothness = 0f;
            if (material == null || !_entries.TryGetValue(material, out Entry entry)) return false;
            color = entry.DryColor;
            smoothness = entry.DrySmoothness;
            return true;
        }

        private void OnEnable()
        {
            if (!Instances.Contains(this)) Instances.Add(this);
            Application.quitting += RestoreAll;
        }

        private void OnDisable()
        {
            Application.quitting -= RestoreAll;
            RestoreAll();
            Instances.Remove(this);
        }

        private void Update()
        {
            if (!_active) return;
            float now = Time.unscaledTime;
            bool wet = _target > 0.001f || _applied > 0.001f;
            if (wet && now >= _nextScan)
            {
                Scan();
                _nextScan = now + ScanInterval;
            }
            if (now >= _nextApply && (_dirty || Mathf.Abs(_target - _applied) > 0.005f
                || (_target == 0f && _applied != 0f)))
            {
                Apply(_target);
                _nextApply = now + ApplyInterval;
            }
        }

        private void Scan()
        {
            Renderer[] renderers = FindObjectsByType<Renderer>(FindObjectsInactive.Exclude);
            for (int r = 0; r < renderers.Length; r++)
            {
                Renderer renderer = renderers[r];
                if (renderer == null || (ExcludedLayers & (1 << renderer.gameObject.layer)) != 0) continue;
                if (renderer is ParticleSystemRenderer || renderer is TrailRenderer || renderer is LineRenderer
                    || renderer is SpriteRenderer || renderer is BillboardRenderer) continue;
                renderer.GetSharedMaterials(_buffer);
                for (int m = 0; m < _buffer.Count; m++) Register(_buffer[m]);
            }
            _buffer.Clear();
        }

        private void Register(Material material)
        {
            if (material == null || _entries.ContainsKey(material) || _rejected.Contains(material)) return;
            // Освещаемое с цветом и гладкостью: URP Lit/Simple Lit, Synty Generic_Basic и т. п.;
            // у частиц, неосвещаемого и своих шейдеров (земля, буря) гладкости _Smoothness нет.
            bool urp = material.HasProperty(BaseColorId) && material.HasProperty(SmoothnessId);
            bool gltf = !urp && material.HasProperty(GltfColorId) && material.HasProperty(GltfRoughnessId);
            if (!urp && !gltf)
            {
                _rejected.Add(material);
                return;
            }
            // Прозрачное (стекло, тающая крыша) не мочим сейчас — посмотрим на следующем обходе.
            if (material.renderQueue >= 2600) return;
            if (urp && material.HasProperty(SurfaceId) && material.GetFloat(SurfaceId) > 0.5f) return;
            var entry = new Entry { Material = material, Gltf = gltf };
            entry.DryColor = GetColor(entry);
            entry.DrySmoothness = gltf ? 1f - material.GetFloat(GltfRoughnessId) : material.GetFloat(SmoothnessId);
            int metallicId = gltf ? GltfMetallicId : MetallicId;
            entry.Metallic = material.HasProperty(metallicId) ? Mathf.Clamp01(material.GetFloat(metallicId)) : 0f;
            _entries[material] = entry;
            _list.Add(entry);
            _dirty = true;
        }

        private void Apply(float wetness)
        {
            bool removed = false;
            for (int i = _list.Count - 1; i >= 0; i--)
            {
                Entry entry = _list[i];
                if (entry.Material == null)
                {
                    _list.RemoveAt(i);
                    removed = true;
                    continue;
                }
                Color current = GetColor(entry);
                // Цвет поменял кто-то ещё — это новый сухой цвет.
                if (entry.Written && !SameRgb(current, entry.WrittenColor)) entry.DryColor = current;
                float value = GetValue(entry);
                if (entry.Written && Mathf.Abs(value - entry.WrittenValue) > 0.0001f)
                    entry.DrySmoothness = entry.Gltf ? 1f - value : value;

                WetValues(entry.DryColor, entry.DrySmoothness, entry.Metallic, wetness, out Color wet, out float smoothness);
                wet.a = current.a;
                float written = entry.Gltf ? 1f - smoothness : smoothness;
                SetColor(entry, wet);
                SetValue(entry, written);
                entry.WrittenColor = wet;
                entry.WrittenValue = written;
                entry.Written = true;
            }
            if (removed)
            {
                // Уничтоженные материалы (выгруженная зона) — пересобрать словарь без них.
                _entries.Clear();
                for (int i = 0; i < _list.Count; i++) _entries[_list[i].Material] = _list[i];
            }
            _applied = wetness;
            _dirty = false;
        }

        /// <summary>
        /// Мокрый цвет и гладкость: пористое и шершавое темнеет до 30%, гладкое и металл —
        /// до 10% и меньше; гладкость растёт до 0,6–0,82.
        /// </summary>
        public static void WetValues(Color dry, float drySmoothness, float metallic, float wetness,
                                     out Color wet, out float smoothness)
        {
            wetness = Mathf.Clamp01(wetness);
            float darken = Mathf.Lerp(0.3f, 0.1f, Mathf.Clamp01(drySmoothness * 1.6f)) * (1f - 0.7f * metallic);
            float factor = 1f - darken * wetness;
            wet = new Color(dry.r * factor, dry.g * factor, dry.b * factor, dry.a);
            float wetGloss = Mathf.Max(drySmoothness, Mathf.Lerp(0.6f, 0.82f, drySmoothness));
            smoothness = Mathf.Lerp(drySmoothness, wetGloss, wetness);
        }

        private static bool SameRgb(Color a, Color b)
        {
            return Mathf.Abs(a.r - b.r) < 0.0005f && Mathf.Abs(a.g - b.g) < 0.0005f && Mathf.Abs(a.b - b.b) < 0.0005f;
        }

        private static Color GetColor(Entry entry)
        {
            return entry.Material.GetColor(entry.Gltf ? GltfColorId : BaseColorId);
        }

        private static void SetColor(Entry entry, Color color)
        {
            entry.Material.SetColor(entry.Gltf ? GltfColorId : BaseColorId, color);
        }

        private static float GetValue(Entry entry)
        {
            return entry.Material.GetFloat(entry.Gltf ? GltfRoughnessId : SmoothnessId);
        }

        private static void SetValue(Entry entry, float value)
        {
            entry.Material.SetFloat(entry.Gltf ? GltfRoughnessId : SmoothnessId, value);
        }
    }
}
