using System.Collections.Generic;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Снимок локации сверху для миникарты: ортографическая камера смотрит вниз и
    /// рисует собранный мир в RenderTexture один раз на локацию.
    ///
    /// Ориентация — север вверху, как у подложки-схемы и у маркеров: вправо — +X Unity
    /// (восток), вверх — +Z Unity (север, малые тайлы tz). Камера смотрит вниз с
    /// поворотом (90, 0, 0) — ровно эти оси и даёт. Сверяет RoaMinimapSnapshotProbe.
    ///
    /// Живые актёры в снимок не попадают: их скиновые меши на время кадра гасятся,
    /// иначе игрок и враги застыли бы на статичной картинке.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaMinimapSnapshot : MonoBehaviour
    {
        public const int DefaultPixels = 384;
        /// <summary>Слой интерфейса и слой сцены карты мира в снимок не входят.</summary>
        private const int UiLayer = 5;
        private const int WorldMapLayer = 30;

        public RenderTexture Texture { get; private set; }
        public string CapturedLocationId { get; private set; } = string.Empty;
        public int CaptureCount { get; private set; }

        private Camera _camera;

        /// <summary>Снять локацию сверху. `false` — снимать нечего (нет размеров карты).</summary>
        public bool Capture(LocationDefinition location, Color background, int pixels = DefaultPixels)
        {
            float width = location != null ? location.WorldWidth : 0f;
            float depth = location != null ? location.WorldDepth : 0f;
            if (width <= 0f || depth <= 0f) return false;
            EnsureTexture(Mathf.Clamp(pixels, 64, 1024));
            EnsureCamera();

            float half = Mathf.Max(width, depth) * 0.5f;
            _camera.orthographicSize = half;
            _camera.aspect = 1f;
            _camera.backgroundColor = background;
            _camera.transform.SetPositionAndRotation(new Vector3(0f, half + 160f, 0f), Quaternion.Euler(90f, 0f, 0f));
            _camera.nearClipPlane = 1f;
            _camera.farClipPlane = half * 2f + 400f;

            List<Renderer> hidden = HideLiveActors();
            RenderTexture previous = RenderTexture.active;
            try
            {
                RenderOnce(Texture);
            }
            finally
            {
                _camera.targetTexture = null;
                RenderTexture.active = previous;
                for (int i = 0; i < hidden.Count; i++) if (hidden[i] != null) hidden[i].enabled = true;
            }
            CapturedLocationId = location.Id ?? string.Empty;
            CaptureCount += 1;
            return true;
        }

        public void Forget()
        {
            CapturedLocationId = string.Empty;
        }

        /// <summary>
        /// Один кадр камеры в текстуру. В URP прямой Camera.Render() не поддержан, поэтому
        /// сперва идёт запрос рендера конвейера, и только если его нет — старый путь.
        /// </summary>
        private void RenderOnce(RenderTexture target)
        {
            var request = new UniversalRenderPipeline.SingleCameraRequest { destination = target };
            if (RenderPipeline.SupportsRenderRequest(_camera, request))
            {
                RenderPipeline.SubmitRenderRequest(_camera, request);
                return;
            }
            _camera.targetTexture = target;
            _camera.Render();
        }

        private void EnsureTexture(int pixels)
        {
            if (Texture != null && Texture.width == pixels) return;
            ReleaseTexture();
            Texture = new RenderTexture(pixels, pixels, 16, RenderTextureFormat.ARGB32)
            {
                name = "MinimapSnapshot",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                antiAliasing = 1
            };
            Texture.Create();
        }

        private void EnsureCamera()
        {
            if (_camera != null) return;
            var holder = new GameObject("MinimapSnapshotCamera");
            holder.transform.SetParent(transform, false);
            holder.hideFlags = HideFlags.DontSave;
            _camera = holder.AddComponent<Camera>();
            _camera.enabled = false;
            _camera.orthographic = true;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.cullingMask = ~((1 << UiLayer) | (1 << WorldMapLayer));
            _camera.allowHDR = false;
            _camera.allowMSAA = false;
            _camera.useOcclusionCulling = false;
        }

        /// <summary>Погасить живых актёров на один кадр: снимок — про землю и постройки.</summary>
        private static List<Renderer> HideLiveActors()
        {
            var hidden = new List<Renderer>(32);
            foreach (SkinnedMeshRenderer renderer in FindObjectsByType<SkinnedMeshRenderer>(FindObjectsSortMode.None))
            {
                if (renderer == null || !renderer.enabled) continue;
                renderer.enabled = false;
                hidden.Add(renderer);
            }
            return hidden;
        }

        private void ReleaseTexture()
        {
            if (Texture == null) return;
            Texture.Release();
            Destroy(Texture);
            Texture = null;
        }

        private void OnDestroy()
        {
            ReleaseTexture();
            if (_camera != null) Destroy(_camera.gameObject);
        }
    }
}
