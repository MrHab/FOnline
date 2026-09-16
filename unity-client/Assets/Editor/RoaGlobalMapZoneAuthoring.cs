#if UNITY_EDITOR
using System.IO;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Печёт сохранённые меши и префабы для областей встреч и знака главаря.
    /// На глобальной карте запрещено создавать геометрию во время игры, поэтому
    /// контур области и шестиугольник главаря обязаны существовать как ассеты;
    /// карта только ставит, поворачивает, масштабирует и красит их.
    ///
    /// Формы берутся из <see cref="RoaGlobalMapZoneShapes"/> — того же файла, по
    /// которому карта проверяет попадание курсора внутрь области. Один источник:
    /// нарисованная граница и граница наведения не могут разойтись.
    ///
    /// Проход детерминированный: повторный запуск переписывает те же ассеты и не
    /// создаёт новых GUID.
    /// </summary>
    public static class RoaGlobalMapZoneAuthoring
    {
        private const string MeshFolder = "Assets/Art/GlobalMap/Meshes";
        private const string PrefabFolder = "Assets/Prefabs/GlobalMap";
        private const string FillMaterialPath = "Assets/Art/GlobalMap/Materials/GM_TerritoryFill.mat";
        private const string RimMaterialPath = "Assets/Art/GlobalMap/Materials/GM_TerritoryBorder.mat";

        // Обводка лежит чуть выше заливки, иначе прозрачные плоскости на одной
        // высоте мерцают на дальнем плане.
        private const float RimHeight = 0.02f;
        // Шестиугольник главаря приподнят над землёй: знак читается как метка,
        // а не как пятно на грунте.
        private const float BadgeFillHeight = 0.0f;
        private const float BadgeRimHeight = 0.015f;
        private const float BadgeRimOuter = 1.22f;

        // Отчёт уходит только в лог: пункт вызывается и внешней автоматикой
        // через RoaAgentGate, а модальное окно остановило бы редактор до клика.
        [MenuItem("Realm of Ashes/Глобальная карта/Собрать префабы зон встреч")]
        public static void Build()
        {
            Debug.Log("[ZONE PREFABS] " + BuildInternal());
        }

        /// <summary>Тот же проход без диалога — для пакетного режима и проб.</summary>
        public static string BuildInternal()
        {
            Directory.CreateDirectory(MeshFolder);
            Directory.CreateDirectory(PrefabFolder);
            Material fill = AssetDatabase.LoadAssetAtPath<Material>(FillMaterialPath);
            Material rim = AssetDatabase.LoadAssetAtPath<Material>(RimMaterialPath);
            if (fill == null || rim == null)
                throw new System.InvalidOperationException(
                    "Не найдены материалы карты: " + FillMaterialPath + " / " + RimMaterialPath);

            int prefabs = 0;
            string[] suffixes = { "A", "B", "C" };
            for (int i = 0; i < suffixes.Length && i < RoaGlobalMapZoneShapes.Count; i++)
            {
                Vector2[] silhouette = RoaGlobalMapZoneShapes.Silhouette(i + 1);
                Mesh fillMesh = SaveMesh(MeshFolder + "/GM_Mesh_ZoneFill_" + suffixes[i] + ".asset",
                    BuildFanMesh(silhouette, 1f, 0f));
                Mesh rimMesh = SaveMesh(MeshFolder + "/GM_Mesh_ZoneRim_" + suffixes[i] + ".asset",
                    BuildRimMesh(silhouette, RoaGlobalMapZoneShapes.RimWidth, RimHeight));
                SavePrefab(PrefabFolder + "/GM_ZoneArea_" + suffixes[i] + ".prefab",
                    "GM_ZoneArea_" + suffixes[i],
                    "Tint_ZoneFill", fillMesh, fill,
                    "Tint_ZoneRim", rimMesh, rim);
                prefabs++;
            }

            Vector2[] badge = RoaGlobalMapZoneShapes.BossBadge();
            Mesh badgeFill = SaveMesh(MeshFolder + "/GM_Mesh_BossBadgeFill.asset",
                BuildFanMesh(badge, 1f, BadgeFillHeight));
            Mesh badgeRim = SaveMesh(MeshFolder + "/GM_Mesh_BossBadgeRim.asset",
                BuildRingMesh(badge, 1f, BadgeRimOuter, BadgeRimHeight));
            SavePrefab(PrefabFolder + "/GM_BossBadge.prefab", "GM_BossBadge",
                "Tint_BadgeFill", badgeFill, fill,
                "Tint_BadgeRim", badgeRim, rim);
            prefabs++;

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            return "префабов собрано: " + prefabs + ", силуэтов: " + RoaGlobalMapZoneShapes.Count
                   + " (" + MeshFolder + ", " + PrefabFolder + ")";
        }

        // ------------------------------------------------------------------
        // Меши

        /// <summary>Заливка: веер треугольников из центра силуэта.</summary>
        private static Mesh BuildFanMesh(Vector2[] shape, float scale, float height)
        {
            var vertices = new Vector3[shape.Length + 1];
            var uv = new Vector2[vertices.Length];
            vertices[0] = new Vector3(0f, height, 0f);
            uv[0] = new Vector2(0.5f, 0.5f);
            for (int i = 0; i < shape.Length; i++)
            {
                vertices[i + 1] = MapVertex(shape[i] * scale, height);
                uv[i + 1] = new Vector2(shape[i].x * 0.5f + 0.5f, shape[i].y * 0.5f + 0.5f);
            }
            var triangles = new int[shape.Length * 3];
            for (int i = 0; i < shape.Length; i++)
            {
                int next = (i + 1) % shape.Length;
                WriteTriangle(triangles, i * 3, vertices, 0, i + 1, next + 1);
            }
            return Assemble(vertices, uv, triangles);
        }

        /// <summary>Обводка: замкнутая лента шириной width вдоль контура.</summary>
        private static Mesh BuildRimMesh(Vector2[] shape, float width, float height)
        {
            var vertices = new Vector3[shape.Length * 2];
            var uv = new Vector2[vertices.Length];
            for (int i = 0; i < shape.Length; i++)
            {
                float length = Mathf.Max(0.0001f, shape[i].magnitude);
                Vector2 inner = shape[i] * ((length - width) / length);
                Vector2 outer = shape[i] * ((length + width) / length);
                vertices[i * 2] = MapVertex(inner, height);
                vertices[i * 2 + 1] = MapVertex(outer, height);
                float along = (float)i / shape.Length;
                uv[i * 2] = new Vector2(along, 0f);
                uv[i * 2 + 1] = new Vector2(along, 1f);
            }
            return Assemble(vertices, uv, RibbonTriangles(shape.Length, vertices));
        }

        /// <summary>Кольцо знака: от радиуса контура до внешнего радиуса.</summary>
        private static Mesh BuildRingMesh(Vector2[] shape, float inner, float outer, float height)
        {
            var vertices = new Vector3[shape.Length * 2];
            var uv = new Vector2[vertices.Length];
            for (int i = 0; i < shape.Length; i++)
            {
                vertices[i * 2] = MapVertex(shape[i] * inner, height);
                vertices[i * 2 + 1] = MapVertex(shape[i] * outer, height);
                float along = (float)i / shape.Length;
                uv[i * 2] = new Vector2(along, 0f);
                uv[i * 2 + 1] = new Vector2(along, 1f);
            }
            return Assemble(vertices, uv, RibbonTriangles(shape.Length, vertices));
        }

        private static int[] RibbonTriangles(int segments, Vector3[] vertices)
        {
            var triangles = new int[segments * 6];
            for (int i = 0; i < segments; i++)
            {
                int next = (i + 1) % segments;
                WriteTriangle(triangles, i * 6, vertices, i * 2, i * 2 + 1, next * 2 + 1);
                WriteTriangle(triangles, i * 6 + 3, vertices, i * 2, next * 2 + 1, next * 2);
            }
            return triangles;
        }

        /// <summary>
        /// Вершина силуэта в локальных координатах префаба. Ось Y точек карты
        /// смотрит вниз по экрану, а ось Z мира — вверх, поэтому знак меняется:
        /// иначе поворот силуэта на карте пошёл бы в другую сторону, чем при
        /// проверке попадания курсора.
        /// </summary>
        private static Vector3 MapVertex(Vector2 point, float height)
        {
            return new Vector3(point.x, height, -point.y);
        }

        /// <summary>Треугольник всегда лицом вверх: карта смотрит на него сверху.</summary>
        private static void WriteTriangle(int[] triangles, int offset, Vector3[] vertices,
                                          int a, int b, int c)
        {
            Vector3 normal = Vector3.Cross(vertices[b] - vertices[a], vertices[c] - vertices[a]);
            triangles[offset] = a;
            triangles[offset + 1] = normal.y >= 0f ? b : c;
            triangles[offset + 2] = normal.y >= 0f ? c : b;
        }

        private static Mesh Assemble(Vector3[] vertices, Vector2[] uv, int[] triangles)
        {
            var mesh = new Mesh { vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh SaveMesh(string path, Mesh source)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                source.name = Path.GetFileNameWithoutExtension(path);
                AssetDatabase.CreateAsset(source, path);
                return source;
            }
            // Ассет с тем же GUID переписывается на месте: ссылки префабов и
            // сцен переживают повторный проход.
            existing.Clear();
            existing.name = Path.GetFileNameWithoutExtension(path);
            existing.vertices = source.vertices;
            existing.uv = source.uv;
            existing.triangles = source.triangles;
            existing.RecalculateNormals();
            existing.RecalculateTangents();
            existing.RecalculateBounds();
            Object.DestroyImmediate(source);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        // ------------------------------------------------------------------
        // Префабы

        private static void SavePrefab(string path, string name,
                                       string fillChild, Mesh fillMesh, Material fillMaterial,
                                       string rimChild, Mesh rimMesh, Material rimMaterial)
        {
            var root = new GameObject(name);
            try
            {
                AddPiece(root.transform, fillChild, fillMesh, fillMaterial);
                AddPiece(root.transform, rimChild, rimMesh, rimMaterial);
                PrefabUtility.SaveAsPrefabAsset(root, path);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static void AddPiece(Transform parent, string name, Mesh mesh, Material material)
        {
            var piece = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            piece.transform.SetParent(parent, false);
            piece.GetComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = piece.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            // Плоский знак на карте не отбрасывает и не принимает тени и не
            // участвует в motion vectors: он читается как разметка, а не как
            // предмет мира.
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
        }
    }
}
#endif
