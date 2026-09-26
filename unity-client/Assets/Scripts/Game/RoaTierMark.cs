using System;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Место метки тира на префабе в его собственных координатах: обмотка поперёк
    /// тонкой части, мазок краски сверху или кольцо у основания. Считает редактор
    /// по вершинам префаба (RoaTierMarkLayout) — в сборке вершины пака не читаются.
    /// </summary>
    [Serializable]
    public sealed class RoaTierMarkPlacement
    {
        public bool valid;
        /// <summary>Цилиндр (обмотка, кольцо, пятно краски) или брусок (полоса на плоской вещи).</summary>
        public bool round;
        public Vector3 position;
        public Quaternion rotation = Quaternion.identity;
        public Vector3 scale = Vector3.one;
    }

    /// <summary>
    /// Метка тира: небольшая деталь цвета тира на родной модели (изолента, краска),
    /// по которой тир виден, а сама вещь сохраняет свой вид.
    /// </summary>
    public static class RoaTierMark
    {
        public const string ChildName = "TierMark";
        private static Mesh _box;
        private static Texture2D _paintBase;

        public static void Attach(GameObject root, RoaTierMarkPlacement placement, int tier)
        {
            if (root == null) return;
            Transform old = root.transform.Find(ChildName);
            if (old != null)
            {
                if (Application.isPlaying) UnityEngine.Object.Destroy(old.gameObject);
                else UnityEngine.Object.DestroyImmediate(old.gameObject);
            }
            if (placement == null || !placement.valid || tier < 1) return;
            Renderer source = root.GetComponentInChildren<Renderer>(true);
            if (source == null || source.sharedMaterial == null) return;

            var mark = new GameObject(ChildName);
            mark.layer = root.layer;
            mark.transform.SetParent(root.transform, false);
            mark.transform.localPosition = placement.position;
            mark.transform.localRotation = placement.rotation;
            mark.transform.localScale = placement.scale;
            mark.AddComponent<MeshFilter>().sharedMesh = placement.round ? Cylinder : Box;
            var renderer = mark.AddComponent<MeshRenderer>();
            // Материал самой модели: тот же шейдер пака, что уже есть в сборке.
            renderer.sharedMaterial = source.sharedMaterial;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var block = new MaterialPropertyBlock();
            Color color = RoaTierData.TierColor(tier);
            block.SetColor("_BaseColor", color);
            block.SetColor("_Color", color);
            block.SetTexture("_Albedo_Map", PaintBase);
            block.SetTexture("_BaseMap", PaintBase);
            block.SetTexture("_MainTex", PaintBase);
            renderer.SetPropertyBlock(block);
        }

        /// <summary>Светло-серая подложка: краска метки читается цветом тира без выгорания.</summary>
        private static Texture2D PaintBase
        {
            get
            {
                if (_paintBase != null) return _paintBase;
                _paintBase = new Texture2D(4, 4, TextureFormat.RGBA32, false) { name = "RoaTierMarkPaint", hideFlags = HideFlags.DontSave };
                var pixels = new Color32[16];
                for (int i = 0; i < pixels.Length; i++) pixels[i] = new Color32(170, 170, 170, 255);
                _paintBase.SetPixels32(pixels);
                _paintBase.Apply(false, true);
                return _paintBase;
            }
        }

        private static Mesh _cylinder;

        /// <summary>Цилиндр радиуса 0.5 и высоты 1 вдоль Y (центр в нуле), 16 граней.</summary>
        private static Mesh Cylinder
        {
            get
            {
                if (_cylinder != null) return _cylinder;
                const int sides = 16;
                var vertices = new System.Collections.Generic.List<Vector3>();
                var normals = new System.Collections.Generic.List<Vector3>();
                var triangles = new System.Collections.Generic.List<int>();
                for (int i = 0; i < sides; i++)
                {
                    float a0 = i * Mathf.PI * 2f / sides, a1 = (i + 1) * Mathf.PI * 2f / sides;
                    Vector3 p0 = new Vector3(Mathf.Cos(a0) * 0.5f, 0f, Mathf.Sin(a0) * 0.5f);
                    Vector3 p1 = new Vector3(Mathf.Cos(a1) * 0.5f, 0f, Mathf.Sin(a1) * 0.5f);
                    Vector3 n = ((p0 + p1) * 0.5f).normalized;
                    int s = vertices.Count;
                    vertices.AddRange(new[] { p0 + Vector3.down * 0.5f, p1 + Vector3.down * 0.5f, p1 + Vector3.up * 0.5f, p0 + Vector3.up * 0.5f });
                    normals.AddRange(new[] { n, n, n, n });
                    triangles.AddRange(new[] { s, s + 2, s + 1, s, s + 3, s + 2 });
                    int t = vertices.Count;
                    vertices.AddRange(new[] { Vector3.up * 0.5f, p1 + Vector3.up * 0.5f, p0 + Vector3.up * 0.5f });
                    normals.AddRange(new[] { Vector3.up, Vector3.up, Vector3.up });
                    triangles.AddRange(new[] { t, t + 1, t + 2 });
                    int b = vertices.Count;
                    vertices.AddRange(new[] { Vector3.down * 0.5f, p0 + Vector3.down * 0.5f, p1 + Vector3.down * 0.5f });
                    normals.AddRange(new[] { Vector3.down, Vector3.down, Vector3.down });
                    triangles.AddRange(new[] { b, b + 1, b + 2 });
                }
                _cylinder = new Mesh { name = "RoaTierMarkCylinder", hideFlags = HideFlags.DontSave };
                _cylinder.SetVertices(vertices);
                _cylinder.SetNormals(normals);
                _cylinder.SetTriangles(triangles, 0);
                _cylinder.RecalculateBounds();
                return _cylinder;
            }
        }

        /// <summary>Единичный куб с плоскими гранями (центр в нуле).</summary>
        private static Mesh Box
        {
            get
            {
                if (_box != null) return _box;
                Vector3[] n = { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
                var vertices = new Vector3[24];
                var normals = new Vector3[24];
                var uv = new Vector2[24];
                var triangles = new int[36];
                for (int f = 0; f < 6; f++)
                {
                    Vector3 normal = n[f];
                    Vector3 u = Mathf.Abs(normal.y) > 0.5f ? Vector3.right : Vector3.up;
                    Vector3 v = Vector3.Cross(normal, u);
                    Vector3 c = normal * 0.5f;
                    Vector3[] corners = { c - u * 0.5f - v * 0.5f, c + u * 0.5f - v * 0.5f, c + u * 0.5f + v * 0.5f, c - u * 0.5f + v * 0.5f };
                    for (int i = 0; i < 4; i++)
                    {
                        vertices[f * 4 + i] = corners[i];
                        normals[f * 4 + i] = normal;
                        uv[f * 4 + i] = new Vector2(i == 1 || i == 2 ? 1f : 0f, i >= 2 ? 1f : 0f);
                    }
                    bool outward = Vector3.Dot(Vector3.Cross(corners[1] - corners[0], corners[2] - corners[0]), normal) > 0f;
                    // Unity рисует лицевой гранью обход по часовой стрелке; Cross здесь левый.
                    int[] order = outward ? new[] { 0, 1, 2, 0, 2, 3 } : new[] { 0, 2, 1, 0, 3, 2 };
                    for (int i = 0; i < 6; i++) triangles[f * 6 + i] = f * 4 + order[i];
                }
                _box = new Mesh { name = "RoaTierMarkBox", vertices = vertices, normals = normals, uv = uv, triangles = triangles, hideFlags = HideFlags.DontSave };
                _box.RecalculateBounds();
                return _box;
            }
        }
    }
}
