#if UNITY_EDITOR
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Живая проверка главного инварианта экипировки: её skinned-меши должны
    /// ссылаться на кости тела, а не на уничтожаемый скелет собственного GLB.
    /// Запускается в Play Mode, чтобы использовать обычный асинхронный путь.
    /// </summary>
    public static class RoaEquipmentProbe
    {
        private const string Menu = "Realm of Ashes/Проверить экипировку персонажа";

        [MenuItem(Menu, true)]
        private static bool Validate()
        {
            return Application.isPlaying;
        }

        [MenuItem(Menu)]
        private static async void Run()
        {
            var host = new GameObject("EquipmentProbe");
            try
            {
                var view = host.AddComponent<RoaCharacterView>();
                var appearance = new JObject
                {
                    ["sex"] = "male",
                    ["bodyType"] = "medium",
                    ["faceId"] = "male_03",
                    ["hairId"] = "short_crop",
                    ["hairColorId"] = "hair_08"
                };
                await view.Load("http://127.0.0.1:3000", appearance);
                await view.EquipItems("http://127.0.0.1:3000", new JObject
                {
                    ["armor"] = "combatArmor",
                    ["helmet"] = "tacticalHelmet",
                    ["boots"] = "reinforcedBoots",
                    ["backpack"] = "backpack"
                });

                var bodyBones = new Dictionary<string, Transform>();
                foreach (SkinnedMeshRenderer renderer in host.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    if (IsEquipment(renderer.transform)) continue;
                    foreach (Transform bone in renderer.bones)
                        if (bone != null && !bodyBones.ContainsKey(bone.name)) bodyBones[bone.name] = bone;
                }

                int equipmentMeshes = 0;
                int reboundBones = 0;
                foreach (SkinnedMeshRenderer renderer in host.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    if (!IsEquipment(renderer.transform)) continue;
                    equipmentMeshes++;
                    foreach (Transform bone in renderer.bones)
                    {
                        if (bone == null || !bodyBones.TryGetValue(bone.name, out Transform expected)
                            || expected != bone)
                        {
                            Debug.LogError("[ЭКИПИРОВКА] меш " + renderer.name
                                + " остался на отдельном скелете: " + (bone != null ? bone.name : "null"));
                            return;
                        }
                        reboundBones++;
                    }
                }

                if (equipmentMeshes < 4 || reboundBones < equipmentMeshes * 65)
                {
                    Debug.LogError("[ЭКИПИРОВКА] неполный экземпляр: мешей=" + equipmentMeshes
                        + ", привязанных костей=" + reboundBones);
                    return;
                }

                Debug.Log("[ЭКИПИРОВКА] готово: мешей=" + equipmentMeshes
                    + ", все " + reboundBones + " ссылок ведут на живой скелет тела");
            }
            catch (System.Exception error)
            {
                Debug.LogError("[ЭКИПИРОВКА] сбой проверки: " + error);
            }
            finally
            {
                if (host != null) Object.Destroy(host);
            }
        }

        private static bool IsEquipment(Transform node)
        {
            for (Transform cursor = node; cursor != null; cursor = cursor.parent)
                if (cursor.name.StartsWith("Equipment:")) return true;
            return false;
        }
    }
}
#endif
