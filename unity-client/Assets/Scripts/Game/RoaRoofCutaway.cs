using System;
using System.Collections.Generic;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Makes authored cutaway roofs translucent when the character can see the
    /// floor below them or when the roof is physically between the camera and
    /// the character. This ports the authored-roof branch of the web client's
    /// trader cutaway renderer (02d2/02d3).
    /// </summary>
    public sealed class RoaRoofCutaway : MonoBehaviour
    {
        public const float CutawayOpacity = 0.24f;
        public const float ReleaseDelay = 0.22f;

        private const float RefreshInterval = 0.12f;
        private const float PlayerEyeHeight = 1.12f;

        private sealed class MaterialState
        {
            public Material Material;
            public bool HasBaseColor;
            public Color BaseColor;
            public bool HasLegacyColor;
            public Color LegacyColor;
            public int RenderQueue;
            public bool TransparentKeyword;
            public bool SurfaceKeyword;
            public bool HasSurface;
            public float Surface;
            public bool HasBlend;
            public float Blend;
            public bool HasSrcBlend;
            public float SrcBlend;
            public bool HasDstBlend;
            public float DstBlend;
            public bool HasZWrite;
            public float ZWrite;
        }

        private sealed class Roof
        {
            public string Id;
            public GameObject Root;
            public Bounds Bounds;
            public readonly List<MaterialState> Materials = new List<MaterialState>();
            public readonly List<Renderer> Renderers = new List<Renderer>();
            public bool Faded;
            public float ReleaseSince = -1f;
        }

        private readonly List<Roof> _roofs = new List<Roof>();
        private RoaFogOfWar _fog;
        private RoaCameraRig _cameraRig;
        private RoaPlayerController _player;
        private float _elapsed;
        private int _lastFogVersion = -1;

        public int RoofCount { get { return _roofs.Count; } }
        public int FadedCount { get; private set; }

        public void Configure(RoaFogOfWar fog, RoaCameraRig cameraRig)
        {
            _fog = fog;
            _cameraRig = cameraRig;
        }

        public void SetPlayer(RoaPlayerController player)
        {
            _player = player;
            _elapsed = RefreshInterval;
        }

        public void Build(LocationDefinition location, RoaLocationLoader loader)
        {
            Clear();
            if (location == null || loader == null || location.Objects == null) return;

            for (int i = 0; i < location.Objects.Count; i++)
            {
                LocationObject entry = location.Objects[i];
                if (!IsCutawayRoof(entry)) continue;

                GameObject root;
                if (!loader.TryGetObjectRoot(entry.Id, out root) || root == null) continue;

                var renderers = new List<Renderer>();
                root.GetComponentsInChildren(true, renderers);
                if (renderers.Count == 0) continue;

                var roof = new Roof { Id = entry.Id, Root = root, Bounds = renderers[0].bounds };
                for (int r = 0; r < renderers.Count; r++)
                {
                    Renderer renderer = renderers[r];
                    if (renderer == null) continue;
                    roof.Renderers.Add(renderer);
                    roof.Bounds.Encapsulate(renderer.bounds);
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                    renderer.receiveShadows = false;

                    Material[] shared = renderer.sharedMaterials;
                    var owned = new Material[shared.Length];
                    for (int m = 0; m < shared.Length; m++)
                    {
                        if (shared[m] == null) continue;
                        owned[m] = new Material(shared[m])
                        {
                            name = shared[m].name + " (roof cutaway)"
                        };
                        roof.Materials.Add(Capture(owned[m]));
                    }
                    renderer.sharedMaterials = owned;
                }

                _roofs.Add(roof);
            }

            _elapsed = RefreshInterval;
            _lastFogVersion = -1;
            Debug.Log("[ROA] Roof cutaway: " + _roofs.Count + " authored roof(s)");
        }

        public void Clear()
        {
            for (int i = 0; i < _roofs.Count; i++)
            {
                Roof roof = _roofs[i];
                ApplyOpacity(roof, 1f);
                for (int m = 0; m < roof.Materials.Count; m++)
                {
                    Material material = roof.Materials[m].Material;
                    if (material == null) continue;
                    if (Application.isPlaying) Destroy(material);
                    else DestroyImmediate(material);
                }
            }
            _roofs.Clear();
            FadedCount = 0;
            _lastFogVersion = -1;
            _elapsed = 0f;
        }

        private void OnDisable()
        {
            for (int i = 0; i < _roofs.Count; i++) ApplyOpacity(_roofs[i], 1f);
            FadedCount = 0;
        }

        private void OnDestroy()
        {
            Clear();
        }

        private void LateUpdate()
        {
            if (_roofs.Count == 0 || _player == null || _cameraRig == null) return;

            _elapsed += Time.unscaledDeltaTime;
            int fogVersion = _fog != null ? _fog.Version : -1;
            if (_elapsed < RefreshInterval && fogVersion == _lastFogVersion) return;

            _elapsed = 0f;
            _lastFogVersion = fogVersion;
            float now = Time.unscaledTime;
            int faded = 0;

            Vector3 playerPoint = _player.transform.position + Vector3.up * PlayerEyeHeight;
            Vector3 cameraPoint = _cameraRig.transform.position;
            Func<Vector3, bool> visible = _fog != null && _fog.Ready
                ? new Func<Vector3, bool>(point => _fog.IsVisible(point))
                : null;

            for (int i = 0; i < _roofs.Count; i++)
            {
                Roof roof = _roofs[i];
                if (roof.Root == null) continue;

                bool raw = ShouldCutaway(roof.Bounds, playerPoint, cameraPoint, visible);
                bool cutaway = StableCutaway(roof, raw, now);
                if (cutaway) faded++;
                if (roof.Faded == cutaway) continue;

                roof.Faded = cutaway;
                ApplyOpacity(roof, cutaway ? CutawayOpacity : 1f);
            }

            FadedCount = faded;
        }

        private static bool StableCutaway(Roof roof, bool raw, float now)
        {
            if (raw)
            {
                roof.ReleaseSince = -1f;
                return true;
            }
            if (!roof.Faded)
            {
                roof.ReleaseSince = -1f;
                return false;
            }
            if (roof.ReleaseSince < 0f)
            {
                roof.ReleaseSince = now;
                return true;
            }
            if (now - roof.ReleaseSince < ReleaseDelay) return true;
            roof.ReleaseSince = -1f;
            return false;
        }

        /// <summary>Pure cutaway test exposed for the editor parity probe.</summary>
        public static bool ShouldCutaway(Bounds roof, Vector3 playerPoint, Vector3 cameraPoint,
                                         Func<Vector3, bool> gameplayVisible)
        {
            if (AnyFootprintSampleVisible(roof, gameplayVisible)) return true;
            if (OccludesPlayer(roof, playerPoint, cameraPoint)) return true;
            return ProjectionCoversVisibleGround(roof, cameraPoint, gameplayVisible);
        }

        public static bool OccludesPlayer(Bounds roof, Vector3 playerPoint, Vector3 cameraPoint)
        {
            Vector3 direction = playerPoint - cameraPoint;
            float length = direction.magnitude;
            if (length <= 0.001f) return false;
            var ray = new Ray(cameraPoint, direction / length);
            float distance;
            return roof.IntersectRay(ray, out distance) && distance > 0.02f && distance < length - 0.08f;
        }

        public static bool AnyFootprintSampleVisible(Bounds roof, Func<Vector3, bool> gameplayVisible)
        {
            if (gameplayVisible == null) return false;
            Vector3 min = roof.min;
            Vector3 max = roof.max;
            float cx = roof.center.x;
            float cz = roof.center.z;
            var samples = new[]
            {
                new Vector3(cx, 0.1f, cz),
                new Vector3(min.x, 0.1f, min.z), new Vector3(min.x, 0.1f, max.z),
                new Vector3(max.x, 0.1f, min.z), new Vector3(max.x, 0.1f, max.z),
                new Vector3(cx, 0.1f, min.z), new Vector3(cx, 0.1f, max.z),
                new Vector3(min.x, 0.1f, cz), new Vector3(max.x, 0.1f, cz)
            };
            for (int i = 0; i < samples.Length; i++)
                if (gameplayVisible(samples[i])) return true;
            return false;
        }

        public static bool ProjectionCoversVisibleGround(Bounds roof, Vector3 cameraPoint,
                                                         Func<Vector3, bool> gameplayVisible)
        {
            if (gameplayVisible == null) return false;
            Vector3 min = roof.min;
            Vector3 max = roof.max;
            Vector3 center = roof.center;
            var points = new[]
            {
                center,
                new Vector3(min.x, center.y, min.z), new Vector3(min.x, center.y, max.z),
                new Vector3(max.x, center.y, min.z), new Vector3(max.x, center.y, max.z),
                new Vector3(center.x, max.y, center.z),
                new Vector3(min.x, max.y, center.z), new Vector3(max.x, max.y, center.z),
                new Vector3(center.x, max.y, min.z), new Vector3(center.x, max.y, max.z)
            };

            for (int i = 0; i < points.Length; i++)
            {
                Vector3 direction = points[i] - cameraPoint;
                if (Mathf.Abs(direction.y) < 0.0001f) continue;
                float t = (0.1f - cameraPoint.y) / direction.y;
                if (t <= 0f) continue;
                Vector3 ground = cameraPoint + direction * t;
                ground.y = 0.1f;
                if (gameplayVisible(ground)) return true;
            }
            return false;
        }

        private static bool IsCutawayRoof(LocationObject entry)
        {
            if (entry == null) return false;
            if (entry.Tags != null)
            {
                for (int i = 0; i < entry.Tags.Count; i++)
                {
                    string tag = (entry.Tags[i] ?? string.Empty).Trim().ToLowerInvariant();
                    if (tag == "trader-cutaway" || tag == "roof-cutaway") return true;
                }
            }
            return entry.Occlusion != null && (bool?)entry.Occlusion["cutaway"] == true;
        }

        private static MaterialState Capture(Material material)
        {
            var state = new MaterialState
            {
                Material = material,
                HasBaseColor = material.HasProperty("_BaseColor"),
                HasLegacyColor = material.HasProperty("_Color"),
                RenderQueue = material.renderQueue,
                TransparentKeyword = material.IsKeywordEnabled("_SURFACE_TYPE_TRANSPARENT"),
                SurfaceKeyword = material.IsKeywordEnabled("_ALPHAPREMULTIPLY_ON"),
                HasSurface = material.HasProperty("_Surface"),
                HasBlend = material.HasProperty("_Blend"),
                HasSrcBlend = material.HasProperty("_SrcBlend"),
                HasDstBlend = material.HasProperty("_DstBlend"),
                HasZWrite = material.HasProperty("_ZWrite")
            };
            if (state.HasBaseColor) state.BaseColor = material.GetColor("_BaseColor");
            if (state.HasLegacyColor) state.LegacyColor = material.GetColor("_Color");
            if (state.HasSurface) state.Surface = material.GetFloat("_Surface");
            if (state.HasBlend) state.Blend = material.GetFloat("_Blend");
            if (state.HasSrcBlend) state.SrcBlend = material.GetFloat("_SrcBlend");
            if (state.HasDstBlend) state.DstBlend = material.GetFloat("_DstBlend");
            if (state.HasZWrite) state.ZWrite = material.GetFloat("_ZWrite");
            return state;
        }

        private static void ApplyOpacity(Roof roof, float opacity)
        {
            bool transparent = opacity < 0.999f;
            for (int i = 0; i < roof.Materials.Count; i++)
            {
                MaterialState state = roof.Materials[i];
                Material material = state.Material;
                if (material == null) continue;

                if (state.HasBaseColor)
                {
                    Color color = state.BaseColor;
                    color.a = transparent ? Mathf.Min(color.a, opacity) : state.BaseColor.a;
                    material.SetColor("_BaseColor", color);
                }
                if (state.HasLegacyColor)
                {
                    Color color = state.LegacyColor;
                    color.a = transparent ? Mathf.Min(color.a, opacity) : state.LegacyColor.a;
                    material.SetColor("_Color", color);
                }

                if (transparent)
                {
                    if (state.HasSurface) material.SetFloat("_Surface", 1f);
                    if (state.HasBlend) material.SetFloat("_Blend", 0f);
                    if (state.HasSrcBlend) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                    if (state.HasDstBlend) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                    if (state.HasZWrite) material.SetFloat("_ZWrite", 0f);
                    material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                    material.SetOverrideTag("RenderType", "Transparent");
                    material.renderQueue = (int)RenderQueue.Transparent;
                }
                else
                {
                    if (state.HasSurface) material.SetFloat("_Surface", state.Surface);
                    if (state.HasBlend) material.SetFloat("_Blend", state.Blend);
                    if (state.HasSrcBlend) material.SetFloat("_SrcBlend", state.SrcBlend);
                    if (state.HasDstBlend) material.SetFloat("_DstBlend", state.DstBlend);
                    if (state.HasZWrite) material.SetFloat("_ZWrite", state.ZWrite);
                    if (state.TransparentKeyword) material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    else material.DisableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    if (state.SurfaceKeyword) material.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                    else material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                    material.SetOverrideTag("RenderType", state.Surface > 0.5f ? "Transparent" : string.Empty);
                    material.renderQueue = state.RenderQueue;
                }
            }
        }
    }
}
