using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Runtime terrain, fog, map markers and combat FX construct materials with
    /// Shader.Find. Unity's standalone build stripping cannot see those string
    /// references, so the URP shaders must remain in GraphicsSettings explicitly.
    /// </summary>
    public sealed class RoaRuntimeShaderGuard : IPreprocessBuildWithReport
    {
        private const string GraphicsSettingsPath = "ProjectSettings/GraphicsSettings.asset";
        private static readonly string[] RequiredShaders =
        {
            "Universal Render Pipeline/Lit",
            "Universal Render Pipeline/Unlit",
            // glTFast loads these graphs by name at runtime. Without explicit
            // references a standalone player replaces every downloaded GLB
            // material with the magenta error shader.
            "Shader Graphs/glTF-pbrMetallicRoughness",
            "Shader Graphs/glTF-pbrSpecularGlossiness",
            "Shader Graphs/glTF-unlit",
            "Shader Graphs/glTF-pbrMetallicRoughness-Clearcoat"
        };

        public int callbackOrder => -1000;

        [InitializeOnLoadMethod]
        private static void ScheduleEditorCheck()
        {
            EditorApplication.delayCall -= CheckAfterEditorLoad;
            EditorApplication.delayCall += CheckAfterEditorLoad;
        }

        private static void CheckAfterEditorLoad()
        {
            EditorApplication.delayCall -= CheckAfterEditorLoad;
            try
            {
                EnsureIncluded(false);
            }
            catch (System.Exception error)
            {
                Debug.LogError("[ROA-SHADERS] Не удалось проверить runtime-shader: " + error.Message);
            }
        }

        public void OnPreprocessBuild(BuildReport report)
        {
            try
            {
                EnsureIncluded(true);
            }
            catch (System.Exception error)
            {
                throw new BuildFailedException("ROA runtime shaders are not configured: " + error.Message);
            }
        }

        [MenuItem("Realm of Ashes/Проверить runtime-shader")]
        private static void CheckFromMenu()
        {
            EnsureIncluded(true);
        }

        private static void EnsureIncluded(bool logWhenUnchanged)
        {
            Object[] settingsAssets = AssetDatabase.LoadAllAssetsAtPath(GraphicsSettingsPath);
            if (settingsAssets == null || settingsAssets.Length == 0)
                throw new System.InvalidOperationException("GraphicsSettings asset not found.");

            var serialized = new SerializedObject(settingsAssets[0]);
            SerializedProperty list = serialized.FindProperty("m_AlwaysIncludedShaders");
            if (list == null || !list.isArray)
                throw new System.InvalidOperationException("m_AlwaysIncludedShaders is unavailable.");

            bool changed = false;
            foreach (string shaderName in RequiredShaders)
            {
                Shader shader = Shader.Find(shaderName);
                if (shader == null)
                    throw new System.InvalidOperationException("Shader not found: " + shaderName);
                if (Contains(list, shader)) continue;

                int index = list.arraySize;
                list.InsertArrayElementAtIndex(index);
                list.GetArrayElementAtIndex(index).objectReferenceValue = shader;
                changed = true;
            }

            if (changed)
            {
                serialized.ApplyModifiedPropertiesWithoutUndo();
                AssetDatabase.SaveAssets();
                Debug.Log("[ROA-SHADERS] runtime и glTFast shader добавлены в Always Included Shaders.");
            }
            else if (logWhenUnchanged)
            {
                Debug.Log("[ROA-SHADERS] runtime и glTFast shader уже включены в player build.");
            }
        }

        private static bool Contains(SerializedProperty list, Shader shader)
        {
            for (int i = 0; i < list.arraySize; i++)
            {
                if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader) return true;
            }
            return false;
        }
    }
}
