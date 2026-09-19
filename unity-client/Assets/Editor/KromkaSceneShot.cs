#if UNITY_EDITOR
using System.IO;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>Renders one camera into a PNG at a fixed size; shared by the Play Mode audits.</summary>
    internal static class KromkaSceneShot
    {
        internal static void Capture(Camera camera, string path, int width, int height)
        {
            RenderTexture original = camera.targetTexture;
            RenderTexture active = RenderTexture.active;
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            Texture2D pixels = null;
            try
            {
                target.Create(); camera.targetTexture = target;
                camera.Render(); camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = original; RenderTexture.active = active;
                if (pixels != null) Object.DestroyImmediate(pixels);
                target.Release(); Object.DestroyImmediate(target);
            }
        }
    }
}
#endif
