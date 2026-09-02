#if UNITY_EDITOR
using System;
using System.Text.RegularExpressions;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Единая бесшовная текстура земли глобальной карты.
    ///
    /// Художественное решение: вместо лоскута из трёх биомных материалов вся
    /// земля диорамы покрывается одной тайлящейся PBR-текстурой из
    /// TerrainSampleAssets. Каждый тайл 30×30 юнитов с UV 0..1 получает один
    /// материал GM_GroundUnified с ЦЕЛЫМ числом повторов на тайл — на стыках
    /// тайлов узор продолжается без швов (текстура бесшовная по своей
    /// природе, целое число повторов совмещает края).
    ///
    /// Текстура меняется константами Base/Normal ниже; инструмент
    /// идемпотентен, сцену сохраняет.
    /// </summary>
    public static class RoaGlobalMapUnifiedGroundAuthoring
    {
        // Пустошь — художественное решение 2026-09-02: ровно две текстуры
        // владельца — MEP_Sand_05 у воды и MEP_Dessert_Base_N дальше.
        // Анти-тайлинг каждого слоя — самоподмес повёрнутой выборкой.
        private const string BaseColorPath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_05.png";
        private const string DetailBPath = BaseColorPath;
        private const string MacroPath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Dessert_Base_N.png";
        private const string HorizonMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_HorizonTerrain.mat";
        private const string MaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_GroundUnified.mat";
        // Повторов детальной текстуры на юнит мира (мировые UV шейдера —
        // бесшовность стыков конструктивна). 0.4 → один повтор ≈ 2.5 юнита.
        private const float DetailTilingPerUnit = 0.045f;

        [MenuItem("Realm of Ashes/Авторинг/Единая текстура земли")]
        public static void Apply()
        {
            RoaUnityGlobalMapScene marker =
                RoaGlobalMapMountainsRiversAuthoring.FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");

            var baseColor = AssetDatabase.LoadAssetAtPath<Texture2D>(BaseColorPath)
                ?? throw new InvalidOperationException(
                    "Не найдена текстура: " + BaseColorPath);
            var detailB = AssetDatabase.LoadAssetAtPath<Texture2D>(DetailBPath);
            var macro = AssetDatabase.LoadAssetAtPath<Texture2D>(MacroPath);

            // Собственный шейдер с мировыми UV и анти-тайлингом: две
            // выборки разного поворота, макро-подмес и низкочастотная
            // вариация ломают видимую периодичность повторов.
            Shader ground = Shader.Find(
                "Universal Render Pipeline/Realm of Ashes/Global Map Unified Ground")
                ?? throw new InvalidOperationException(
                    "Шейдер единой земли не найден.");
            var material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(ground);
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            material.shader = ground;
            material.SetTexture("_SandMap", baseColor);
            material.SetTexture("_SandMapB", detailB != null ? detailB : baseColor);
            material.SetTexture("_DesertMap", macro != null ? macro : baseColor);
            // Нейтрально: цвет текстур владельца не искажается.
            material.SetColor("_Tint", Color.white);
            material.SetFloat("_DetailTiling", DetailTilingPerUnit);
            material.SetFloat("_MacroTiling", 0.02f);
            material.SetFloat("_MacroBlend", 0.5f);
            material.SetFloat("_VariationStrength", 0f);
            material.SetFloat("_Contrast", 1.25f);
            // Берег — вся западная колонна тайлов, как в ручной раскладке:
            // песок до x≈300 точек (−15 юнитов), рваная кромка ±6, переход 7.
            material.SetFloat("_ShoreX", -16f);
            material.SetFloat("_ShoreWidth", 7f);
            material.SetFloat("_ShoreJitter", 6f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);

            var pattern = new Regex("^GroundTile_(\\d+)_(\\d+)$");
            int assigned = 0;
            foreach (GameObject sceneRoot in
                     marker.gameObject.scene.GetRootGameObjects())
            foreach (Transform child in
                     sceneRoot.GetComponentsInChildren<Transform>(true))
            {
                if (!pattern.IsMatch(child.name)) continue;
                MeshRenderer renderer =
                    child.GetComponentInChildren<MeshRenderer>(true);
                if (renderer == null) continue;
                renderer.sharedMaterial = material;
                // Плита карты не кастует тени: иначе приподнятая кромка
                // рисует на горизонте огромное тёмное пятно.
                renderer.shadowCastingMode =
                    UnityEngine.Rendering.ShadowCastingMode.Off;
                assigned++;
            }

            // Горизонт-террейн — та же бесшовная текстура: все три слота
            // его шейдера получают снег (смесь одинакового = одинаковое),
            // тёплый тинт заменяется холодным. Сам ассет материала не
            // меняется — его GUID запинен контрактом.
            // Горизонт-террейн получает ТОТ ЖЕ материал земли: мировые UV
            // продолжают узор через стык — линия края исчезает.
            GameObject horizonInstance = GameObject.Find("HorizonTerrain_AUTHORED");
            if (horizonInstance != null)
            {
                MeshRenderer horizonRenderer =
                    horizonInstance.GetComponentInChildren<MeshRenderer>(true);
                if (horizonRenderer != null)
                {
                    horizonRenderer.sharedMaterial = material;
                    horizonRenderer.shadowCastingMode =
                        UnityEngine.Rendering.ShadowCastingMode.Off;
                }
            }

            var horizon = AssetDatabase.LoadAssetAtPath<Material>(HorizonMaterialPath);
            if (horizon != null)
            {
                if (horizon.HasProperty("_DesertMap"))
                    horizon.SetTexture("_DesertMap",
                        macro != null ? macro : baseColor);
                if (horizon.HasProperty("_RockyMap"))
                    horizon.SetTexture("_RockyMap",
                        macro != null ? macro : baseColor);
                if (horizon.HasProperty("_SaltMap"))
                    horizon.SetTexture("_SaltMap", baseColor);
                if (horizon.HasProperty("_Tint"))
                    // Темнее, в тон пустоши: прямоугольник диорамы не должен
                    // выделяться на фоне горизонта.
                    horizon.SetColor("_Tint",
                        new Color(0.66f, 0.58f, 0.48f, 1f));
                EditorUtility.SetDirty(horizon);
            }

            RoaGlobalMapMountainsRiversAuthoring.ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[ЕДИНАЯ ЗЕМЛЯ] тайлов покрыто: " + assigned
                + (horizon != null ? "; горизонт покрыт той же текстурой" : "")
                + "; текстура: " + System.IO.Path.GetFileNameWithoutExtension(
                    BaseColorPath) + ", шейдер анти-тайлинга. Сцена сохранена.");
        }
    }
}
#endif
