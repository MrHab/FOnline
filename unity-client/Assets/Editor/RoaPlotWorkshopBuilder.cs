#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Мастерские на участках города, как в Albion: своя постройка у каждого
    /// ремесла, вывеска с пиктограммой, рабочее место, мощёный двор на весь участок
    /// и витрина товара у улицы, а у рабочего места стоит мастер (его ставит
    /// сервер). Префаб собран из моделей PolygonApocalypse в их родном размере;
    /// лицевая сторона — +Z.
    ///
    /// Преграду набора задаёт узел KitCollision: коробка по твёрдым частям
    /// (постройка, станки, штабели). Двор, витрина и место мастера в неё не входят.
    ///
    /// Префабы строятся только этим генератором: правьте таблицы Workshops и Signs
    /// и запускайте «Realm of Ashes/PolygonApocalypse/Build plot workshops».
    /// </summary>
    public static class RoaPlotWorkshopBuilder
    {
        internal const string PrefabDir = "Assets/Prefabs/Kromka/RecoveredEnvironment";
        private const string Pack = "Assets/Synty/PolygonApocalypse/Prefabs/";
        private const string ArtDir = "Assets/Prefabs/Kromka/PlotWorkshops";
        /// <summary>Рабочая линия: всё твёрдое дальше неё (к улице) — отдельная преграда.</summary>
        private const float WorkLine = 0.8f;

        private readonly struct Part
        {
            internal readonly string Model;
            internal readonly Vector3 Position;
            internal readonly float Yaw;
            internal readonly float Roll;
            internal readonly bool Solid;

            internal Part(string model, float x, float z, float yaw, float y, bool solid, float roll = 0f)
            {
                Model = model;
                Position = new Vector3(x, y, z);
                Yaw = yaw;
                Roll = roll;
                Solid = solid;
            }
        }

        private static Part P(string model, float x, float z, float yaw = 0f, float y = 0f) => new Part(model, x, z, yaw, y, true);
        /// <summary>Двор, витрина, мелочь: преграды не даёт.</summary>
        private static Part Flat(string model, float x, float z, float yaw = 0f, float y = 0f) => new Part(model, x, z, yaw, y, false);
        /// <summary>Ствол, положенный на бок (на стол или ящик).</summary>
        private static Part Gun(string model, float x, float z, float yaw, float y) => new Part("Weapons/Guns/" + model, x, z, yaw, y, false, 90f);

        /// <summary>
        /// Гараж из модулей бункера: контейнерные стены с трёх сторон, крыша из
        /// профлиста, открытый фасад. Модуль стены 5 м, плита крыши 2,5 × 2,5 м.
        /// </summary>
        private static IEnumerable<Part> Garage(float left, float right, float back, float front, float height = 3f)
        {
            for (float x = left + 5f; x <= right + 0.01f; x += 5f)
                yield return P("Buildings/SM_Bld_Bunker_Wall_Container_x2_01", x, back);
            yield return P("Buildings/SM_Bld_Bunker_Wall_Container_x2_01", left, back, 90f);
            yield return P("Buildings/SM_Bld_Bunker_Wall_Container_x2_01", right, back, 90f);
            for (float x = left + 2.5f; x <= right + 0.01f; x += 2.5f)
                for (float z = back; z < front - 0.01f; z += 2.5f)
                    yield return P("Buildings/SM_Bld_Bunker_Ceiling_Corrugated_01", x, z, 0f, height);
        }

        /// <summary>
        /// Ангар-полубочка: дуги из профлиста по 2,5 м и глухой торец. Модули
        /// бункера кладут ангар вдоль X; здесь он поворачивается вокруг своего
        /// центра так, чтобы открытый торец смотрел на улицу (+Z). Ширина 5 м.
        /// </summary>
        private static IEnumerable<Part> Quonset(float centreX, float centreZ, int rings)
        {
            float length = rings * 2.5f;
            var parts = new List<Part>();
            for (int ring = 0; ring < rings; ring++)
            {
                float x = -length / 2f + (ring + 1) * 2.5f;
                parts.Add(P("Buildings/SM_Bld_Bunker_Wall_Curved_Corrugated_01", x, -2.5f));
                parts.Add(P("Buildings/SM_Bld_Bunker_Wall_Curved_Corrugated_01", x - 2.5f, 2.5f, 180f));
            }
            // После поворота конец +X уходит назад (−Z): глухой торец — у задней стены.
            parts.Add(P("Buildings/SM_Bld_Bunker_Wall_Curved_End_Metal_x2_01", length / 2f, 0f, 0f, 1.53f));
            Quaternion rotation = Quaternion.Euler(0f, 90f, 0f);
            foreach (Part part in parts)
            {
                Vector3 at = rotation * part.Position;
                yield return new Part(part.Model, at.x + centreX, at.z + centreZ, part.Yaw + 90f, part.Position.y, part.Solid);
            }
        }

        /// <summary>
        /// Основание участка: бетонные плиты бункера 2,5 × 2,5 м на весь участок
        /// 14 × 14 м (утоплены, сверху 3 см) — мастерская стоит на фундаменте, а не
        /// на голой земле. Прежнюю площадку участка клиент на застроенном участке
        /// прячет. Под витриной поверх бетона — дощатый настил, под боковой массой —
        /// каменные плиты.
        /// </summary>
        private static IEnumerable<Part> Yard()
        {
            const string slab = "Buildings/SM_Bld_Bunker_Concrete_Floor_01";
            // Плита кладётся от угла: (x, z) — её правый ближний край, сетка −6,25…+6,25.
            for (float x = -3.75f; x <= 6.26f; x += 2.5f)
                for (float z = -6.25f; z <= 3.76f; z += 2.5f)
                    yield return Flat(slab, x, z, 0f, -0.22f);
            yield return Flat("Buildings/SM_Bld_Bunker_Floor_Wood_01", -1.25f, 1.25f, 0f, -0.19f);
            yield return Flat("Buildings/SM_Bld_Bunker_Floor_Stone_01", 6.25f, 1.25f, 0f, -0.2f);
        }

        // Ключ станка сервера → мастерская. Координаты в метрах от центра участка;
        // участок 14 × 14 м без ограды (её пролёты город на застроенном участке
        // убирает), табличка торгов на (0, +4), мастер —
        // у рабочего места (точка masterAt в src/server/city-builder.js). Витрина
        // товара — одна плотная группа слева от дорожки, справа — высокая масса.
        private static readonly Dictionary<string, Part[]> Workshops = new Dictionary<string, Part[]>(StringComparer.Ordinal)
        {
            // Кузня оружейника: открытый контейнер со стойкой и столом стволов,
            // горн в бочке, наковальня с искрами, стрельбище, витрина оружия.
            ["weapon"] = new[]
            {
                P("Props/SM_Prop_Wall_Junk_Container_01", -0.6f, -4.3f),
                P("Props/SM_Prop_Table_02", 3.0f, -4.6f, 90f),
                Gun("SM_Wep_AssaultRifle_01", 3.0f, -5.1f, 0f, 0.74f),
                Gun("SM_Wep_Shotgun_01", 3.1f, -4.2f, 10f, 0.74f),
                P("Props/SM_Prop_Barrel_Open_01", 2.3f, -1.4f),
                Flat("FX/FX_Fire_01", 2.3f, -1.4f, 0f, 1.0f),
                Flat("FX/FX_Smoke_Small_01", 2.3f, -1.4f, 0f, 1.8f),
                // Наковальня на крепком ящике, а не на бочке, что покатится.
                P("Props/SM_Prop_Crate_01", 0.5f, -1.3f, 0f),
                P("Props/SM_Prop_Anvil_01", 0.5f, -1.3f, 90f, 0.82f),
                Flat("FX/Fx_Sparks_01", 0.5f, -1.3f, 0f, 1.35f),
                P("Props/SM_Prop_Barricade_Metal_01", 5.3f, -3.3f, 90f),
                P("Props/SM_Prop_Target_01", 4.3f, -4.4f, -90f),
                P("Props/SM_Prop_Target_02", 4.3f, -3.3f, -90f),
                P("Props/SM_Prop_Target_01", 4.3f, -2.2f, -90f),
                P("Props/SM_Prop_Crate_Large_01", -4.6f, -1.6f),
                P("Props/SM_Prop_Crate_02", -4.6f, -1.6f, 90f, 0.79f),
                // Витрина: стол со стволами вплотную к ящикам с оружием.
                Flat("Props/SM_Prop_Table_02", -2.4f, 2.4f),
                Gun("SM_Wep_HuntingRifle_01", -2.9f, 2.4f, 90f, 0.74f),
                Gun("SM_Wep_SubMGun_01", -2.2f, 2.3f, 70f, 0.74f),
                Gun("SM_Wep_Revolver_01", -1.7f, 2.5f, 100f, 0.74f),
                Flat("Props/SM_Prop_Crate_Open_01", -3.2f, 3.3f, 10f),
                // Справа: пристрелочный рубеж — вал из мешков за двумя мишенями (мишени
                // нарисованы, см. Decors).
                P("Props/SM_Prop_Barricade_Metal_01", 4.7f, 1.8f),
            }.Concat(Yard()).ToArray(),

            // Патронная: армейская палатка, штабель ящиков в три яруса, мешки с
            // песком, стол набивки лент и витрина раскрытых ящиков.
            ["ammo"] = new[]
            {
                P("Buildings/SM_Bld_Military_Tent_01", -2.2f, -2.8f),
                // У входа в палатку: штабели ящиков по бокам полога.
                P("Props/SM_Prop_Crate_Large_01", -4.4f, 0.8f, 5f),
                P("Props/SM_Prop_Crate_01", -4.4f, 0.8f, 20f, 0.79f),
                P("Props/SM_Prop_Crate_Large_02", 0.45f, 1.05f, 90f),
                P("Props/SM_Prop_SupplyPile_01", 3.4f, -4.4f),
                P("Props/SM_Prop_Crate_Large_01", 4.1f, -1.6f, 5f),
                P("Props/SM_Prop_Crate_Large_02", 5.0f, -2.5f, 90f),
                P("Props/SM_Prop_Crate_01", 4.1f, -1.6f, 30f, 0.79f),
                P("Props/SM_Prop_Table_02", 2.2f, -0.2f),
                Flat("Props/SM_Prop_Ammo_Box_Open_01", 1.6f, -0.2f, 10f, 0.71f),
                Flat("Props/SM_Prop_Ammo_Box_Belt_01", 2.4f, -0.1f, -20f, 0.71f),
                Flat("Props/SM_Prop_Ammo_Box_01", 2.9f, -0.3f, 5f, 0.71f),
                // Витрина: поддон с раскрытыми ящиками вплотную к ящику патронов.
                Flat("Props/SM_Prop_Pallet_01", -2.9f, 2.4f),
                Flat("Props/SM_Prop_Ammo_Box_Open_01", -3.2f, 2.3f, 20f, 0.23f),
                Flat("Props/SM_Prop_Ammo_Box_Open_01", -2.6f, 2.6f, -15f, 0.23f),
                Flat("Props/SM_Prop_Ammo_Box_Belt_01", -2.9f, 2.0f, 70f, 0.23f),
                Flat("Props/SM_Prop_Crate_Open_02", -1.6f, 2.6f, 90f),
                // Справа: ящики снабжения с большим ящиком сверху.
                P("Props/SM_Prop_SupplyPile_02", 4.4f, 2.0f, 90f),
            }.Concat(Yard()).ToArray(),

            // Мастерская инструментальщицы: ангар-полубочка со стеллажами, у входа
            // верстак с тисками, стеллаж у стены, фонарь; витрина — поддон досок,
            // жёлтая тачка и красные баллоны.
            ["tools"] = Quonset(-1.4f, -3.2f, 2).Concat(new[]
            {
                P("Props/SM_Prop_WorkShelf_01", -2.6f, -3.9f, 90f),
                P("Props/SM_Prop_WorkShelf_01", -1.4f, -5.2f),
                P("Props/SM_Prop_WorkShelf_01", -0.2f, -3.9f, -90f),
                // В проёме, под лампой: верстак с тисками лицом к улице.
                // Верстак у правой стороны проёма: вход в ангар остаётся свободным.
                P("Props/SM_Prop_Table_02", -0.2f, -1.3f),
                Flat("Props/SM_Prop_Vice_01", 0.2f, -1.3f, 0f, 0.71f),
                Flat("Props/SM_Prop_ToolBox_01", -0.7f, -1.3f, -15f, 0.71f),
                Flat("Props/SM_Prop_Generator_01", -3.2f, -1.6f, 90f),
                P("Props/SM_Prop_WorkShelf_01", 1.8f, -2.6f, -90f),
                P("Props/SM_Prop_Table_02", 2.4f, -0.3f),
                Flat("Props/SM_Prop_Vice_01", 3.0f, -0.3f, 0f, 0.71f),
                Flat("Props/SM_Prop_ToolBox_01", 2.0f, -0.3f, 20f, 0.71f),
                Flat("Props/SM_Prop_Drill_01", 2.5f, -0.2f, 70f, 0.71f),
                P("Props/SM_Prop_Crate_01", 4.3f, -4.2f, 15f),
                P("Props/SM_Prop_Crate_01", 4.2f, -4.2f, 40f, 0.82f),
                P("Props/SM_Prop_LightPole_01", 5.3f, -1.9f, -90f),
                P("Props/SM_Prop_Pipes_Rusted_02", -4.9f, -2.8f, 90f),
                // Витрина: поддон досок с ящиком инструмента, тачка, баллоны.
                Flat("Props/SM_Prop_Table_02", -2.6f, 2.3f),
                Flat("Props/SM_Prop_ToolBox_01", -3.1f, 2.3f, 10f, 0.71f),
                Flat("Props/SM_Prop_Drill_01", -2.4f, 2.4f, 60f, 0.71f),
                Flat("Props/SM_Prop_Tool_Bucket_01", -2.0f, 2.2f, 0f, 0.71f),
                Flat("Props/SM_Prop_Wheelbarrow_01", -2.3f, 3.35f, 90f),
                // Справа: шкафы с инструментом и штабель досок на поддоне.
                P("Props/SM_Prop_WorkShelf_01", 5.5f, 1.45f, -90f),
                P("Props/SM_Prop_WorkShelf_01", 5.5f, 3.45f, -90f),
                // Товар на стеллажах: ящики с инструментом и канистра на верхней полке.
                P("Props/SM_Prop_ToolBox_01", 5.5f, 1.1f, -90f, 1.84f),
                P("Props/SM_Prop_GasCan_01", 5.5f, 1.8f, -90f, 1.84f),
                P("Props/SM_Prop_ToolBox_01", 5.5f, 3.2f, -80f, 1.84f),
                P("Props/SM_Prop_Tool_Bucket_01", 5.5f, 3.8f, 0f, 1.84f),
                P("Props/SM_Prop_Pallet_02", 4.2f, 2.5f, 90f),
                Flat("Props/SM_Prop_Plank_Block_01", 4.2f, 2.5f, 90f, 0.23f),
                Flat("Props/SM_Prop_Plank_Block_01", 4.2f, 2.5f, 90f, 0.34f),
                Flat("Props/SM_Prop_Plank_Block_01", 4.2f, 2.5f, 90f, 0.45f),
                Flat("Props/SM_Prop_Plank_Block_01", 4.2f, 2.5f, 90f, 0.56f),
                Flat("Props/SM_Prop_Plank_Block_01", 4.2f, 2.5f, 90f, 0.67f),
                // Цветной акцент у входа в ангар: красные баллоны.
                Flat("Props/SM_Prop_Propane_01", -4.5f, -0.3f),
                Flat("Props/SM_Prop_Propane_01", -4.2f, -0.5f),
                Flat("Props/SM_Prop_Barrel_Coloured_01", -4.4f, 0.4f),
            }).Concat(Yard()).ToArray(),

            // Ремонтная: гараж из контейнерных стен под профлистом, машина с
            // открытым капотом, прожектор, башня из шин; витрина — аккумуляторы,
            // колёса и канистры.
            ["repair"] = Garage(-5f, 5f, -5.6f, -0.6f).Concat(new[]
            {
                P("Props/SM_Prop_Car_Wrecked_OpenBoot_01", -1.8f, -1.8f, 180f),
                Flat("Props/SM_Prop_Car_Wrecked_Wheel_03", -4.1f, 2.6f, 40f),
                Flat("Props/SM_Prop_Barrel_Stand_01", -3.5f, -1.2f, 0f),
                Flat("Props/SM_Prop_ToolBox_01", 0.0f, -0.9f, 30f),
                P("Props/SM_Prop_Workbench_01", 3.9f, -3.4f, -90f),
                // Башня шин: широкая тракторная покрышка плашмя внизу, стопка поменьше
                // на ней — узкое под широким не устоит.
                P("Props/SM_Prop_Tractor_Tire_01", -4.6f, 0.9f),
                P("Props/SM_Prop_Tire_Pile_02", -4.55f, 0.9f, 60f, 0.53f),
                P("Props/SM_Prop_CarBattery_Table", 2.6f, -0.1f),
                Flat("FX/Fx_Sparks_01", -1.8f, -1.2f, 0f, 1.0f),
                // Витрина: поддон аккумуляторов, колёса и канистры рядом.
                Flat("Props/SM_Prop_Pallet_03", -2.9f, 2.4f),
                Flat("Props/SM_Prop_CarBattery_01", -3.2f, 2.3f, 10f, 0.23f),
                Flat("Props/SM_Prop_CarBattery_02", -2.6f, 2.5f, -20f, 0.23f),
                Flat("Props/SM_Prop_Car_Wrecked_Wheel_01", -1.9f, 3.1f, 30f),
                Flat("Props/SM_Prop_GasCan_01", -3.0f, 3.3f, 20f),
                // Справа: штабель снятых колёс, так же широким вниз.
                P("Props/SM_Prop_Tractor_Tire_01", 4.9f, 2.3f),
                P("Props/SM_Prop_Tire_Pile_02", 4.95f, 2.3f, 30f, 0.53f),
            }).Concat(Yard()).ToArray(),

            // Подстанция энергетика: морской контейнер с рядом солнечных панелей,
            // трансформатор и генератор за сеткой справа, столб ЛЭП и прожектор
            // слева; витрина — аккумуляторы и катушка кабеля.
            ["energy"] = new[]
            {
                P("Props/SM_Prop_Shipping_Container_01", -0.4f, -4.5f, 90f),
                Flat("Props/SM_Prop_Solar_Panel_01", -1.55f, -4.5f, 90f, 2.6f),
                Flat("Props/SM_Prop_Solar_Panel_01", -0.3f, -4.5f, 90f, 2.6f),
                Flat("Props/SM_Prop_Solar_Panel_01", 0.95f, -4.5f, 90f, 2.6f),
                Flat("Props/SM_Prop_Solar_Panel_01", 2.2f, -4.5f, 90f, 2.6f),
                Flat("Props/SM_Prop_PowerBoxes_01", 1.8f, -3.15f),
                P("Props/SM_Prop_Transformer_01", 4.85f, -4.1f, 90f),
                P("Props/SM_Prop_Generator_01", 3.6f, -1.2f, -90f),
                // Столб вплотную к углу контейнера: ввод питания виден без провода.
                P("Props/SM_Prop_Powerpole_01", -4.1f, -3.4f, 90f),
                P("Props/SM_Prop_Floodlights_01", -4.3f, -0.6f, 160f),
                // Витрина: аккумуляторы на поддоне и катушка кабеля рядом.
                Flat("Props/SM_Prop_Pallet_01", -2.8f, 2.4f),
                Flat("Props/SM_Prop_CarBattery_01", -3.1f, 2.3f, 10f, 0.23f),
                Flat("Props/SM_Prop_CarBattery_02", -2.5f, 2.6f, -25f, 0.23f),
                Flat("Props/SM_Prop_CarBattery_01", -2.6f, 1.95f, 80f, 0.23f),
                // Справа: катушки кабеля в два яруса и стол с аккумуляторами.
                P("Props/SM_Prop_Spool_01", 4.6f, 1.2f),
                P("Props/SM_Prop_Spool_01", 4.6f, 1.2f, 40f, 1.02f),
                P("Props/SM_Prop_CarBattery_Table", 4.9f, 3.05f),
            }.Concat(Yard()).ToArray(),

            // Химическая лаборатория: карантинный купол входом к улице, душ
            // дезактивации, трубы с вентилями и дымом, стол с баллонами сбоку,
            // пирамида бочек с опасным грузом, витрина канистр.
            ["chem"] = new[]
            {
                // У купола проёмы на четыре стороны; шлюз-душ стоит перед уличным (+Z).
                P("Buildings/SM_Bld_Quarantine_DomeTent_01", -1.8f, -2.7f),
                P("Props/SM_Prop_Pipes_Valves_01", 4.6f, -5.0f),
                Flat("FX/FX_Smoke_Small_01", 4.6f, -5.0f, 0f, 3.0f),
                P("Props/SM_Prop_Decontamination_Shower_01", -1.8f, 1.45f),
                P("Props/SM_Prop_Gas_Table_01", 4.3f, -0.3f, 90f),
                P("Props/SM_Prop_Medical_Shelf_01", 2.55f, -1.0f),
                // Витрина: канистры, баллоны и медицинский контейнер вплотную.
                Flat("Props/SM_Prop_Pallet_01", -3.2f, 3.2f),
                Flat("Props/SM_Prop_GasCan_01", -3.5f, 3.1f, 15f, 0.23f),
                Flat("Props/SM_Prop_GasCan_01", -3.1f, 3.3f, -20f, 0.23f),
                Flat("Props/SM_Prop_Propane_01", -2.8f, 2.9f, 0f, 0.23f),
                Flat("Props/SM_Prop_Medical_Container_01", -3.4f, 3.6f, 20f, 0.23f),
                Flat("Props/SM_Prop_GasCan_01", -0.4f, 2.0f, 60f),
                Flat("Props/SM_Prop_GasCan_01", -3.1f, 2.0f, -30f),
                // Справа: пирамида бочек и опасный груз.
                P("Props/SM_Prop_BarrelStack_02", 4.4f, 2.7f, 90f),
                P("Props/SM_Prop_Barrel_Nuke_01", 3.75f, 4.35f, 40f),
                P("Props/SM_Prop_Barrel_Warning_01", 4.75f, 4.6f),
            }.Concat(Yard()).ToArray(),
        };

        /// <summary>
        /// Вывеска ремесла, как у зданий Albion: ржавая табличка в рамке с
        /// пиктограммой ремесла и словом. Рисуется в текстуру шрифтом игры, поэтому
        /// кириллица одинакова в редакторе и в WebGL. Posts — два столба под
        /// табличкой (стоит сама), иначе она висит на фасаде.
        /// </summary>
        private readonly struct Sign
        {
            internal readonly string Text;
            internal readonly string Icon;
            internal readonly Color Paint;
            internal readonly Vector3 Position;
            internal readonly bool Posts;

            internal Sign(string text, string icon, Color paint, float x, float y, float z, bool posts = false)
            {
                Text = text;
                Icon = icon;
                Paint = paint;
                Position = new Vector3(x, y, z);
                Posts = posts;
            }
        }

        private static readonly Dictionary<string, Sign> Signs = new Dictionary<string, Sign>(StringComparer.Ordinal)
        {
            ["weapon"] = new Sign("ОРУЖЕЙНАЯ", "crosshair", new Color(1f, 0.86f, 0.42f), -0.6f, 3.4f, -2.95f),
            ["ammo"] = new Sign("ПАТРОНЫ", "bullet", new Color(1f, 0.8f, 0.25f), 3.0f, 2.4f, -2.35f, true),
            ["tools"] = new Sign("ИНСТРУМЕНТ", "hammer", new Color(0.96f, 0.96f, 0.94f), -1.4f, 2.4f, -0.62f),
            ["repair"] = new Sign("РЕМОНТ", "wrench", new Color(1f, 0.6f, 0.2f), 0f, 3.5f, -0.6f),
            ["energy"] = new Sign("ЭНЕРГИЯ", "bolt", new Color(1f, 0.9f, 0.25f), -0.9f, 1.95f, -3.23f),
            ["chem"] = new Sign("ХИМИЯ", "flask", new Color(0.5f, 1f, 0.4f), 4.6f, 2.55f, -4.75f),
        };

        private const int SignWidth = 1024;
        private const int SignHeight = 320;
        private static readonly Vector2 SignSize = new Vector2(3.0f, 0.9375f);

        /// <summary>Нарисовать табличку: ржавый лист, рамка с болтами, пиктограмма, слово.</summary>
        private static Material SignMaterial(string key, Sign sign)
        {
            int wordWidth = SignWidth - SignHeight;
            float[] word = WordMask(sign.Text, wordWidth, SignHeight);
            float[] icon = IconMask(sign.Icon, SignHeight);
            var paintMask = new float[SignWidth * SignHeight];
            for (int y = 0; y < SignHeight; y++)
            {
                for (int x = 0; x < SignHeight; x++) paintMask[y * SignWidth + x] = icon[y * SignHeight + x];
                for (int x = 0; x < wordWidth; x++)
                {
                    int at = y * SignWidth + SignHeight - 40 + x;
                    if (SignHeight - 40 + x >= SignWidth) break;
                    paintMask[at] = Mathf.Max(paintMask[at], word[y * wordWidth + x]);
                }
            }
            float[] bold = Dilate(paintMask, SignWidth, SignHeight, 2);
            float[] outline = Dilate(bold, SignWidth, SignHeight, 6);
            var ink = new Color(0.07f, 0.06f, 0.05f);
            Color[] pixels = Plate();
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = Color.Lerp(pixels[i], ink, outline[i]);
                pixels[i] = Color.Lerp(pixels[i], sign.Paint, bold[i]);
                pixels[i].a = 1f;
            }
            return SaveMaterial("sign_" + key, pixels);
        }

        /// <summary>Изнанка таблички: тот же лист, без надписи.</summary>
        private static Material BackMaterial() => SaveMaterial("sign_back", Plate());

        private static Color[] Plate()
        {
            // Тёмный ржавый лист и светлый кант: краска читается и издалека.
            var rust = new Color(0.17f, 0.12f, 0.1f);
            var frame = new Color(0.86f, 0.76f, 0.5f);
            var pixels = new Color[SignWidth * SignHeight];
            for (int y = 0; y < SignHeight; y++)
                for (int x = 0; x < SignWidth; x++)
                {
                    int edge = Mathf.Min(Mathf.Min(x, SignWidth - 1 - x), Mathf.Min(y, SignHeight - 1 - y));
                    // Потёки ржавчины — полосы разной темноты.
                    float streak = 0.9f + 0.1f * Mathf.PerlinNoise(x * 0.004f, y * 0.06f);
                    Color colour = edge < 14 ? frame * (0.85f + 0.15f * (edge / 14f)) : rust * streak;
                    colour.a = 1f;
                    pixels[y * SignWidth + x] = colour;
                }
            foreach (Vector2 bolt in new[] { new Vector2(40, 40), new Vector2(SignWidth - 40, 40),
                         new Vector2(40, SignHeight - 40), new Vector2(SignWidth - 40, SignHeight - 40) })
                for (int y = -10; y <= 10; y++)
                    for (int x = -10; x <= 10; x++)
                        if (x * x + y * y <= 100) pixels[((int)bolt.y + y) * SignWidth + (int)bolt.x + x] = new Color(0.62f, 0.58f, 0.52f);
            return pixels;
        }

        private static Material SaveMaterial(string name, Color[] pixels) => SaveMaterial(name, pixels, SignWidth, SignHeight, false);

        private static Material SaveMaterial(string name, Color[] pixels, int width, int height, bool clip)
        {
            if (!AssetDatabase.IsValidFolder(ArtDir)) AssetDatabase.CreateFolder("Assets/Prefabs/Kromka", "PlotWorkshops");
            string texturePath = ArtDir + "/" + name + ".png";
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            texture.SetPixels(pixels);
            texture.Apply();
            File.WriteAllBytes(Path.GetFullPath(texturePath), texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(texturePath, ImportAssetOptions.ForceUpdate);
            var importer = (TextureImporter)AssetImporter.GetAtPath(texturePath);
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.mipmapEnabled = true;
            importer.alphaIsTransparency = clip;
            importer.SaveAndReimport();

            string materialPath = ArtDir + "/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            if (material == null)
            {
                material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(material, materialPath);
            }
            material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath));
            material.SetColor("_BaseColor", Color.white);
            material.SetFloat("_AlphaClip", clip ? 1f : 0f);
            material.SetFloat("_Cutoff", 0.5f);
            if (clip) material.EnableKeyword("_ALPHATEST_ON");
            else material.DisableKeyword("_ALPHATEST_ON");
            material.SetFloat("_Smoothness", clip ? 0.05f : 0.2f);
            material.SetFloat("_Metallic", clip ? 0f : 0.3f);
            material.SetFloat("_Cull", (float)UnityEngine.Rendering.CullMode.Back);
            material.renderQueue = (int)(clip ? UnityEngine.Rendering.RenderQueue.AlphaTest : UnityEngine.Rendering.RenderQueue.Geometry);
            EditorUtility.SetDirty(material);
            return material;
        }

        /// <summary>Маска слова: шрифт игры, белое на чёрном, вписано в width × height.</summary>
        private static float[] WordMask(string text, int width, int height)
        {
            Scene scene = EditorSceneManager.NewPreviewScene();
            RenderTexture target = null;
            try
            {
                Font font = RealmOfAshes.Game.RoaUiFont.Default;
                var word = new GameObject("Word");
                SceneManager.MoveGameObjectToScene(word, scene);
                var mesh = word.AddComponent<TextMesh>();
                mesh.font = font;
                mesh.fontSize = 160;
                mesh.fontStyle = FontStyle.Bold;
                mesh.characterSize = 0.1f;
                mesh.anchor = TextAnchor.MiddleCenter;
                mesh.alignment = TextAlignment.Center;
                mesh.color = Color.white;
                mesh.text = text;
                var renderer = word.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = font.material;
                Bounds bounds = renderer.bounds;
                var cameraObject = new GameObject("Camera");
                SceneManager.MoveGameObjectToScene(cameraObject, scene);
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.scene = scene;
                camera.orthographic = true;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.black;
                camera.orthographicSize = Mathf.Max(bounds.extents.y * 1.3f, bounds.extents.x * height / width * 1.06f);
                camera.transform.position = bounds.center + Vector3.back * 5f;
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                camera.targetTexture = target;
                camera.Render();
                RenderTexture previous = RenderTexture.active;
                RenderTexture.active = target;
                var readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                RenderTexture.active = previous;
                camera.targetTexture = null;
                Color[] pixels = readback.GetPixels();
                UnityEngine.Object.DestroyImmediate(readback);
                var mask = new float[pixels.Length];
                for (int i = 0; i < pixels.Length; i++)
                    mask[i] = Mathf.Max(pixels[i].r, Mathf.Max(pixels[i].g, pixels[i].b));
                return mask;
            }
            finally
            {
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                EditorSceneManager.ClosePreviewScene(scene);
            }
        }

        /// <summary>Пиктограмма ремесла, нарисованная фигурами в квадрате size × size.</summary>
        private static float[] IconMask(string icon, int size)
        {
            Func<float, float, bool> inside = IconShape(icon);
            var mask = new float[size * size];
            const int samples = 3;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    int hits = 0;
                    for (int sy = 0; sy < samples; sy++)
                        for (int sx = 0; sx < samples; sx++)
                        {
                            float u = (x + (sx + 0.5f) / samples) / size;
                            float v = (y + (sy + 0.5f) / samples) / size;
                            // Поле пиктограммы — квадрат с отступом, без рамки таблички.
                            u = (u - 0.14f) / 0.72f;
                            v = (v - 0.14f) / 0.72f;
                            if (u >= 0f && u <= 1f && v >= 0f && v <= 1f && inside(u, v)) hits++;
                        }
                    mask[y * size + x] = hits / (float)(samples * samples);
                }
            return mask;
        }

        private static Vector2 Turn(float u, float v, float degrees)
        {
            float r = degrees * Mathf.Deg2Rad;
            float du = u - 0.5f, dv = v - 0.5f;
            return new Vector2(0.5f + du * Mathf.Cos(r) - dv * Mathf.Sin(r), 0.5f + du * Mathf.Sin(r) + dv * Mathf.Cos(r));
        }

        private static bool Box(float u, float v, float u0, float v0, float u1, float v1) => u >= u0 && u <= u1 && v >= v0 && v <= v1;

        private static bool Disc(float u, float v, float cu, float cv, float r) => (u - cu) * (u - cu) + (v - cv) * (v - cv) <= r * r;

        private static Func<float, float, bool> IconShape(string icon)
        {
            switch (icon)
            {
                case "bullet":
                    return (u, v) =>
                    {
                        Vector2 p = Turn(u, v, -20f);
                        return Box(p.x, p.y, 0.36f, 0.08f, 0.64f, 0.56f) || Box(p.x, p.y, 0.32f, 0.04f, 0.68f, 0.12f)
                            || (p.y >= 0.56f && p.y <= 0.96f
                                && Mathf.Abs(p.x - 0.5f) <= 0.14f * Mathf.Sqrt(Mathf.Max(0f, 1f - (p.y - 0.56f) / 0.4f)));
                    };
                case "crosshair":
                    return (u, v) =>
                    {
                        float d = Mathf.Sqrt((u - 0.5f) * (u - 0.5f) + (v - 0.5f) * (v - 0.5f));
                        bool ring = d >= 0.3f && d <= 0.38f;
                        bool cross = (Mathf.Abs(u - 0.5f) <= 0.035f && (v < 0.4f || v > 0.6f))
                            || (Mathf.Abs(v - 0.5f) <= 0.035f && (u < 0.4f || u > 0.6f));
                        return ring || cross || d <= 0.05f;
                    };
                case "hammer":
                    return (u, v) =>
                    {
                        Vector2 p = Turn(u, v, 35f);
                        return Box(p.x, p.y, 0.45f, 0.04f, 0.55f, 0.72f) || Box(p.x, p.y, 0.22f, 0.68f, 0.78f, 0.9f);
                    };
                case "wrench":
                    return (u, v) =>
                    {
                        Vector2 p = Turn(u, v, -40f);
                        bool handle = Box(p.x, p.y, 0.44f, 0.04f, 0.56f, 0.66f);
                        bool head = Disc(p.x, p.y, 0.5f, 0.76f, 0.2f) && !Box(p.x, p.y, 0.43f, 0.74f, 0.57f, 1f);
                        return handle || head;
                    };
                case "bolt":
                    return (u, v) => InPolygon(u, v, new[]
                    {
                        new Vector2(0.62f, 0.98f), new Vector2(0.22f, 0.44f), new Vector2(0.48f, 0.44f),
                        new Vector2(0.36f, 0.02f), new Vector2(0.8f, 0.6f), new Vector2(0.54f, 0.6f)
                    });
                case "flask":
                    return (u, v) => Box(u, v, 0.42f, 0.6f, 0.58f, 0.92f) || Box(u, v, 0.36f, 0.88f, 0.64f, 0.96f)
                        || InPolygon(u, v, new[]
                        {
                            new Vector2(0.42f, 0.62f), new Vector2(0.58f, 0.62f), new Vector2(0.84f, 0.1f), new Vector2(0.16f, 0.1f)
                        });
                default:
                    throw new ArgumentException("Unknown sign icon: " + icon);
            }
        }

        private static bool InPolygon(float u, float v, Vector2[] polygon)
        {
            bool inside = false;
            for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
            {
                if ((polygon[i].y > v) != (polygon[j].y > v)
                    && u < (polygon[j].x - polygon[i].x) * (v - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)
                    inside = !inside;
            }
            return inside;
        }

        /// <summary>Утолщить маску на radius пикселей (максимум по квадрату).</summary>
        private static float[] Dilate(float[] mask, int width, int height, int radius)
        {
            var rows = new float[mask.Length];
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    float best = 0f;
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int sx = x + dx;
                        if (sx >= 0 && sx < width) best = Mathf.Max(best, mask[y * width + sx]);
                    }
                    rows[y * width + x] = best;
                }
            var result = new float[mask.Length];
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    float best = 0f;
                    for (int dy = -radius; dy <= radius; dy++)
                    {
                        int sy = y + dy;
                        if (sy >= 0 && sy < height) best = Mathf.Max(best, rows[sy * width + x]);
                    }
                    result[y * width + x] = best;
                }
            return result;
        }

        /// <summary>Поставить вывеску: табличка с лица и изнанки, при нужде на двух столбах.</summary>
        private static void PlaceSign(Transform root, string key, Sign sign, Material back)
        {
            var holder = new GameObject("Sign");
            holder.transform.SetParent(root, false);
            holder.transform.localPosition = sign.Position;
            Mesh quad = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
            // Встроенный квад смотрит в −Z: лицо разворачивается к улице, изнанка — нет.
            foreach ((string name, Material material, float yaw, float z) in new[]
            {
                ("Face", SignMaterial(key, sign), 180f, 0.02f),
                ("Back", back, 0f, -0.02f)
            })
            {
                var plate = new GameObject(name);
                plate.transform.SetParent(holder.transform, false);
                plate.transform.localPosition = new Vector3(0f, 0f, z);
                plate.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
                plate.transform.localScale = new Vector3(SignSize.x, SignSize.y, 1f);
                plate.AddComponent<MeshFilter>().sharedMesh = quad;
                plate.AddComponent<MeshRenderer>().sharedMaterial = material;
            }
            if (!sign.Posts) return;
            foreach (float side in new[] { -1.15f, 1.15f })
            {
                var post = (GameObject)PrefabUtility.InstantiatePrefab(
                    AssetDatabase.LoadAssetAtPath<GameObject>(Pack + "Props/SM_Prop_Wood_Pole_01.prefab"));
                post.transform.SetParent(holder.transform, false);
                post.transform.localPosition = new Vector3(side, -sign.Position.y, -0.12f);
                foreach (Collider collider in post.GetComponentsInChildren<Collider>(true))
                    UnityEngine.Object.DestroyImmediate(collider);
            }
        }

        private static Bounds Footprint(List<Renderer> meshes)
        {
            Bounds bounds = meshes[0].bounds;
            foreach (Renderer renderer in meshes) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static bool Overlaps(Bounds a, Bounds b) =>
            a.min.x < b.max.x && b.min.x < a.max.x && a.min.z < b.max.z && b.min.z < a.max.z;

        /// <summary>
        /// Нарисованная деталь на плоскости: мишень, перфощит с инструментом,
        /// разметка шлюза, знак опасности. Ground — лежит на земле.
        /// </summary>
        private readonly struct Decor
        {
            internal readonly string Paint;
            internal readonly Vector3 Position;
            internal readonly Vector2 Size;
            internal readonly bool Ground;
            internal readonly float Yaw;
            internal readonly bool Posts;

            internal Decor(string paint, float x, float y, float z, float width, float height, bool ground, float yaw = 0f, bool posts = false)
            {
                Paint = paint;
                Position = new Vector3(x, y, z);
                Size = new Vector2(width, height);
                Ground = ground;
                Yaw = yaw;
                Posts = posts;
            }
        }

        private static readonly Dictionary<string, Decor[]> Decors = new Dictionary<string, Decor[]>(StringComparer.Ordinal)
        {
            ["weapon"] = new[]
            {
                new Decor("target", 4.1f, 1.45f, 2.3f, 1f, 1f, false, 0f, true),
                new Decor("target", 5.3f, 1.45f, 2.9f, 1f, 1f, false, 0f, true),
            },
            ["tools"] = new[]
            {
                new Decor("pegboard", 3.4f, 1.35f, -1.7f, 2.2f, 1.3f, false, 0f, true),
            },
            ["energy"] = new[]
            {
                new Decor("hazard", 4.85f, 0.035f, -4.1f, 3.6f, 2.6f, true, 90f),
                new Decor("danger", 4.85f, 1.35f, -2.35f, 0.9f, 0.9f, false, 0f, true),
            },
            ["chem"] = new[]
            {
                new Decor("hazard", -1.8f, 0.035f, 2.35f, 2.2f, 0.9f, true),
            },
        };

        private static readonly Dictionary<string, Material> PaintCache = new Dictionary<string, Material>(StringComparer.Ordinal);

        private static Material Paint(string paint)
        {
            if (PaintCache.TryGetValue(paint, out Material cached) && cached != null) return cached;
            Material material;
            switch (paint)
            {
                case "target": material = SaveMaterial("paint_target", TargetPixels(256), 256, 256, false); break;
                case "pegboard": material = SaveMaterial("paint_pegboard", PegboardPixels(512, 304), 512, 304, false); break;
                case "hazard": material = SaveMaterial("paint_hazard", HazardPixels(512, 208), 512, 208, false); break;
                case "danger": material = SaveMaterial("paint_danger", DangerPixels(256, 256), 256, 256, false); break;
                case "cable": material = SaveMaterial("paint_cable", Solid(8, new Color(0.06f, 0.06f, 0.06f)), 8, 8, false); break;
                default: throw new ArgumentException("Unknown paint: " + paint);
            }
            PaintCache[paint] = material;
            return material;
        }

        /// <summary>Мишень на фанерном щите: красно-белые кольца и яблочко.</summary>
        private static Color[] TargetPixels(int size)
        {
            var board = new Color(0.86f, 0.8f, 0.66f);
            var red = new Color(0.82f, 0.12f, 0.1f);
            var white = new Color(0.96f, 0.95f, 0.9f);
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = (x + 0.5f) / size - 0.5f, v = (y + 0.5f) / size - 0.5f;
                    float d = Mathf.Sqrt(u * u + v * v);
                    Color colour = board;
                    if (d < 0.46f) colour = Mathf.FloorToInt(d / 0.092f) % 2 == 0 ? red : white;
                    int edge = Mathf.Min(Mathf.Min(x, size - 1 - x), Mathf.Min(y, size - 1 - y));
                    if (edge < 6) colour = new Color(0.45f, 0.33f, 0.22f);
                    colour.a = 1f;
                    pixels[y * size + x] = colour;
                }
            return pixels;
        }

        /// <summary>Перфощит: дырчатая доска с белыми силуэтами молотка и ключей.</summary>
        private static Color[] PegboardPixels(int width, int height)
        {
            var board = new Color(0.55f, 0.4f, 0.26f);
            var hole = new Color(0.2f, 0.14f, 0.1f);
            var paint = new Color(0.93f, 0.93f, 0.9f);
            var pixels = new Color[width * height];
            string[] tools = { "hammer", "wrench", "wrench", "hammer" };
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    Color colour = board;
                    if (x % 24 == 12 && y % 24 == 12) colour = hole;
                    int slot = x * tools.Length / width;
                    float cell = (float)width / tools.Length;
                    float u = (x - slot * cell) / cell, v = y / (float)height;
                    u = (u - 0.08f) / 0.84f;
                    v = (v - 0.08f) / 0.84f;
                    if (u >= 0f && u <= 1f && v >= 0f && v <= 1f && IconShape(tools[slot])(u, v)) colour = paint;
                    int edge = Mathf.Min(Mathf.Min(x, width - 1 - x), Mathf.Min(y, height - 1 - y));
                    if (edge < 8) colour = new Color(0.3f, 0.22f, 0.15f);
                    colour.a = 1f;
                    pixels[y * width + x] = colour;
                }
            return pixels;
        }

        /// <summary>
        /// Знак высокого напряжения: чёрная молния в жёлтом треугольнике. Без слова —
        /// мелкая надпись с игровой камеры не читается, а знак узнают сразу.
        /// </summary>
        private static Color[] DangerPixels(int width, int height)
        {
            Func<float, float, bool> bolt = IconShape("bolt");
            var yellow = new Color(0.96f, 0.8f, 0.12f);
            var ink = new Color(0.07f, 0.07f, 0.07f);
            var pixels = new Color[width * height];
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    Color colour = yellow;
                    float u = ((x + 0.5f) - width / 2f) / height + 0.5f, v = (y + 0.5f) / height;
                    float bu = (u - 0.2f) / 0.6f, bv = (v - 0.12f) / 0.76f;
                    if (bu >= 0f && bu <= 1f && bv >= 0f && bv <= 1f && bolt(bu, bv)) colour = ink;
                    int edge = Mathf.Min(Mathf.Min(x, width - 1 - x), Mathf.Min(y, height - 1 - y));
                    if (edge < 12) colour = ink;
                    colour.a = 1f;
                    pixels[y * width + x] = colour;
                }
            return pixels;
        }

        private static Color[] Solid(int size, Color colour)
        {
            var pixels = new Color[size * size];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = colour;
            return pixels;
        }

        /// <summary>Разметка шлюза: жёлто-чёрные косые полосы.</summary>
        private static Color[] HazardPixels(int width, int height)
        {
            var pixels = new Color[width * height];
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    bool yellow = ((x + y) / 40) % 2 == 0;
                    Color colour = yellow ? new Color(0.95f, 0.78f, 0.1f) : new Color(0.08f, 0.08f, 0.08f);
                    int edge = Mathf.Min(Mathf.Min(x, width - 1 - x), Mathf.Min(y, height - 1 - y));
                    if (edge < 10) colour = new Color(0.08f, 0.08f, 0.08f);
                    colour.a = 1f;
                    pixels[y * width + x] = colour;
                }
            return pixels;
        }

        /// <summary>Поставить нарисованную деталь; на столбах — щит на двух опорах.</summary>
        private static void PlaceDecor(Transform root, Decor decor)
        {
            var holder = new GameObject("Decor_" + decor.Paint);
            holder.transform.SetParent(root, false);
            holder.transform.localPosition = decor.Position;
            holder.transform.localRotation = Quaternion.Euler(0f, decor.Yaw, 0f);
            var plate = new GameObject("Plate");
            plate.transform.SetParent(holder.transform, false);
            // Встроенный квад смотрит в −Z: на земле он кладётся лицом вверх,
            // стоячий — разворачивается лицом к улице.
            plate.transform.localRotation = decor.Ground ? Quaternion.Euler(90f, 0f, 0f) : Quaternion.Euler(0f, 180f, 0f);
            plate.transform.localScale = new Vector3(decor.Size.x, decor.Size.y, 1f);
            plate.AddComponent<MeshFilter>().sharedMesh = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
            var renderer = plate.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = Paint(decor.Paint);
            if (decor.Ground) renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            if (decor.Ground || !decor.Posts) return;
            // Изнанка щита и две опоры (столб закопан так, чтобы верх был чуть выше щита).
            var back = new GameObject("Back");
            back.transform.SetParent(holder.transform, false);
            back.transform.localPosition = new Vector3(0f, 0f, -0.03f);
            back.transform.localScale = new Vector3(decor.Size.x, decor.Size.y, 1f);
            back.AddComponent<MeshFilter>().sharedMesh = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
            back.AddComponent<MeshRenderer>().sharedMaterial = SaveMaterial("sign_back", Plate());
            foreach (float side in new[] { -decor.Size.x / 2f + 0.08f, decor.Size.x / 2f - 0.08f })
            {
                var post = (GameObject)PrefabUtility.InstantiatePrefab(
                    AssetDatabase.LoadAssetAtPath<GameObject>(Pack + "Props/SM_Prop_Wood_Pole_01.prefab"));
                post.transform.SetParent(holder.transform, false);
                float top = decor.Size.y / 2f + 0.15f;
                post.transform.localPosition = new Vector3(side, top - 3f, -0.1f);
                foreach (Collider collider in post.GetComponentsInChildren<Collider>(true))
                    UnityEngine.Object.DestroyImmediate(collider);
            }
        }

        /// <summary>
        /// Тёплый свет в проёме: лампа под крышей и точечный свет без теней, чтобы
        /// вход не был чёрной дырой и мастерскую было видно ночью.
        /// </summary>
        private static readonly Dictionary<string, Vector3[]> Lamps = new Dictionary<string, Vector3[]>(StringComparer.Ordinal)
        {
            ["weapon"] = new[] { new Vector3(-0.6f, 2.2f, -3.2f) },
            ["ammo"] = new[] { new Vector3(-2.2f, 1.8f, -1.2f) },
            ["tools"] = new[] { new Vector3(-1.4f, 2.3f, -0.9f), new Vector3(-1.4f, 2.3f, -3.4f) },
            ["repair"] = new[] { new Vector3(-1.8f, 2.45f, -0.9f), new Vector3(2.4f, 2.45f, -1.4f) },
            ["energy"] = new[] { new Vector3(1.8f, 2.05f, -3.35f) },
            ["chem"] = new[] { new Vector3(-1.8f, 2.6f, 1.2f) },
        };

        private static void PlaceLamp(Transform root, Vector3 at, float intensity)
        {
            var lamp = (GameObject)PrefabUtility.InstantiatePrefab(
                AssetDatabase.LoadAssetAtPath<GameObject>(Pack + "Props/SM_Prop_Bunker_Light_01.prefab"));
            lamp.transform.SetParent(root, false);
            lamp.transform.localPosition = at + Vector3.up * 0.4f;
            var glow = new GameObject("Glow");
            glow.transform.SetParent(root, false);
            glow.transform.localPosition = at;
            Light light = glow.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, 0.78f, 0.45f);
            light.range = 6f;
            light.intensity = intensity;
            light.shadows = LightShadows.None;
        }

        /// <summary>Провисающий кабель: цепочка тонких отрезков между двумя точками.</summary>
        private static void PlaceCable(Transform root, Vector3 from, Vector3 to, float sag)
        {
            const int segments = 8;
            Mesh cylinder = Resources.GetBuiltinResource<Mesh>("Cylinder.fbx");
            Material material = Paint("cable");
            Vector3 Point(float t) => Vector3.Lerp(from, to, t) + Vector3.down * sag * 4f * t * (1f - t);
            for (int i = 0; i < segments; i++)
            {
                Vector3 a = Point(i / (float)segments), b = Point((i + 1) / (float)segments);
                var piece = new GameObject("Cable" + i);
                piece.transform.SetParent(root, false);
                piece.transform.localPosition = (a + b) / 2f;
                piece.transform.localRotation = Quaternion.FromToRotation(Vector3.up, b - a);
                // Встроенный цилиндр — 2 м в высоту: половина длины отрезка по Y.
                piece.transform.localScale = new Vector3(0.04f, (b - a).magnitude / 2f, 0.04f);
                piece.AddComponent<MeshFilter>().sharedMesh = cylinder;
                var renderer = piece.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
        }

        /// <summary>Ключи станков сервера, для которых строится мастерская.</summary>
        internal static IEnumerable<string> Keys => Workshops.Keys;

        internal static string PrefabPath(string key) => PrefabDir + "/plot_workshop_" + key + ".prefab";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Build plot workshops")]
        public static void Build()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Workshops are built in Edit Mode.");
            PaintCache.Clear();
            Material back = BackMaterial();
            var built = new List<string>();
            foreach (KeyValuePair<string, Part[]> workshop in Workshops)
            {
                var root = new GameObject("plot_workshop_" + workshop.Key);
                try
                {
                    // Преграды: постройка с рабочим местом — одна коробка, а каждая
                    // твёрдая вещь двора перед рабочей линией — своя, иначе общая
                    // коробка закрыла бы двор, где стоит мастер.
                    var building = new List<Renderer>();
                    var yardMasses = new List<List<Renderer>>();
                    foreach (Part part in workshop.Value)
                    {
                        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Pack + part.Model + ".prefab");
                        if (prefab == null) throw new InvalidOperationException("PolygonApocalypse prefab is missing: " + part.Model);
                        var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                        instance.transform.SetParent(root.transform, false);
                        instance.transform.localPosition = part.Position;
                        instance.transform.localRotation = Quaternion.Euler(0f, part.Yaw, part.Roll);
                        // Коллизию постройки строит сервер из набора, у моделей своей нет.
                        foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true))
                            UnityEngine.Object.DestroyImmediate(collider);
                        // Мастерская в работе, а не брошена: зелень на машинах и хламе гасится.
                        foreach (Transform node in instance.GetComponentsInChildren<Transform>(true))
                            if (node != instance.transform && node.name.IndexOf("Overgrowth", StringComparison.OrdinalIgnoreCase) >= 0)
                                node.gameObject.SetActive(false);
                        if (!part.Solid) continue;
                        List<Renderer> meshes = instance.GetComponentsInChildren<Renderer>(true)
                            .Where(renderer => renderer.enabled && !(renderer is ParticleSystemRenderer)).ToList();
                        if (part.Position.z <= WorkLine) { building.AddRange(meshes); continue; }
                        // Поставленное на другую вещь (ящик на штабеле) — одна масса с ней.
                        Bounds footprint = Footprint(meshes);
                        List<Renderer> under = yardMasses.FirstOrDefault(mass => Overlaps(Footprint(mass), footprint));
                        if (under != null) under.AddRange(meshes);
                        else yardMasses.Add(meshes);
                    }
                    if (Signs.TryGetValue(workshop.Key, out Sign sign)) PlaceSign(root.transform, workshop.Key, sign, back);
                    if (Decors.TryGetValue(workshop.Key, out Decor[] decors))
                        foreach (Decor decor in decors) PlaceDecor(root.transform, decor);
                    if (Lamps.TryGetValue(workshop.Key, out Vector3[] lamps))
                        foreach (Vector3 lamp in lamps) PlaceLamp(root.transform, lamp, workshop.Key == "ammo" ? 2.7f : 1.8f);
                    // Ввод питания: кабель с траверсы столба на крышу контейнера.
                    if (workshop.Key == "energy")
                    {
                        PlaceCable(root.transform, new Vector3(-4.1f, 6.0f, -2.3f), new Vector3(-3.55f, 2.2f, -3.9f), 0.5f);
                        PlaceCable(root.transform, new Vector3(-4.1f, 6.0f, -4.5f), new Vector3(-3.55f, 2.2f, -5.0f), 0.5f);
                    }
                    // По коробкам набор зон пишет collisionParts.
                    var collision = new GameObject(RoaZoneKitMeasureProbe.KitCollisionName);
                    collision.transform.SetParent(root.transform, false);
                    foreach (List<Renderer> mass in new[] { building }.Concat(yardMasses))
                    {
                        if (mass.Count == 0) continue;
                        Bounds bounds = mass[0].bounds;
                        foreach (Renderer renderer in mass) bounds.Encapsulate(renderer.bounds);
                        var box = collision.AddComponent<BoxCollider>();
                        box.center = bounds.center;
                        box.size = bounds.size;
                    }
                    string path = PrefabPath(workshop.Key);
                    PrefabUtility.SaveAsPrefabAsset(root, path, out bool saved);
                    if (!saved) throw new IOException("Could not save " + path);
                    built.Add(path);
                }
                finally { UnityEngine.Object.DestroyImmediate(root); }
            }
            AssetDatabase.SaveAssets();
            Debug.Log("[PLOT WORKSHOPS] built " + built.Count + ": " + string.Join(", ", built));
        }
    }
}
#endif
