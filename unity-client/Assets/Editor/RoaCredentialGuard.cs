using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Не даёт учётным данным попасть в сохранённую сцену.
    ///
    /// У RoaGameBootstrap есть отладочный авто-вход с логином и паролем.
    /// Поля сериализуемые, поэтому любое сохранение сцены с заполненным паролем
    /// утащило бы его в репозиторий. Это уже случалось дважды: сцена сохранялась
    /// попутно, при добавлении компонентов, когда авто-вход был настроен
    /// для прогона.
    ///
    /// Перед каждым сохранением сцены поля очищаются, а авто-вход выключается.
    /// Полагаться на внимательность здесь нельзя: ошибка тихая и заметна только
    /// при просмотре diff.
    /// </summary>
    public sealed class RoaCredentialGuard : UnityEditor.AssetModificationProcessor
    {
        private static string[] OnWillSaveAssets(string[] paths)
        {
            foreach (RoaGameBootstrap boot in Object.FindObjectsByType<RoaGameBootstrap>(
                         FindObjectsInactive.Include))
            {
                if (boot == null) continue;

                bool dirty = boot.AutoLoginOnStart
                    || !string.IsNullOrEmpty(boot.AutoLoginName)
                    || !string.IsNullOrEmpty(boot.AutoLoginPassword);

                if (!dirty) continue;

                boot.AutoLoginOnStart = false;
                boot.AutoLoginName = string.Empty;
                boot.AutoLoginPassword = string.Empty;

                EditorUtility.SetDirty(boot);

                Debug.Log("[ROA] Учётные данные авто-входа очищены перед сохранением сцены.");
            }

            return paths;
        }
    }
}
