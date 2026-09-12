using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Small recognisable teaching props shared by the editor and runtime.</summary>
    public static class RoaTutorialProps
    {
        public static GameObject Build(string kind, Transform parent)
        {
            var root = new GameObject("Tutorial_" + kind);
            root.transform.SetParent(parent, false);
            if (Application.isPlaying) root.AddComponent<RoaTutorialPropMaterials>();
            Color wood = new Color(0.39f, 0.24f, 0.12f);
            Color steel = new Color(0.23f, 0.27f, 0.28f);
            Color concrete = new Color(0.58f, 0.57f, 0.50f);
            if (kind == "medkit")
            {
                root.AddComponent<RoaItemPropView>();
            }
            else if (kind == "truck")
            {
                Part(root, "Chassis", PrimitiveType.Cube, new Vector3(0, .65f, 0), new Vector3(2.2f, .35f, 4.8f), steel);
                Part(root, "Cab", PrimitiveType.Cube, new Vector3(0, 1.4f, 1.4f), new Vector3(2.1f, 1.4f, 1.65f), new Color(.36f, .39f, .25f));
                Part(root, "Windscreen", PrimitiveType.Cube, new Vector3(0, 1.68f, 2.24f), new Vector3(1.7f, .55f, .04f), new Color(.12f, .21f, .23f));
                Part(root, "Cargo", PrimitiveType.Cube, new Vector3(0, 1.1f, -1f), new Vector3(2.15f, .75f, 2.9f), wood);
                foreach (float x in new[] { -1.15f, 1.15f })
                    foreach (float z in new[] { -1.5f, 1.5f })
                    {
                        var wheel = Part(root, "Wheel", PrimitiveType.Cylinder, new Vector3(x, .48f, z), new Vector3(.9f, .18f, .9f), new Color(.08f, .08f, .07f));
                        wheel.transform.localRotation = Quaternion.Euler(0, 0, 90);
                    }
            }
            else if (kind == "gate")
            {
                Part(root, "Post", PrimitiveType.Cube, new Vector3(0, 1.25f, 0), new Vector3(.3f, 2.5f, .3f), steel);
                Part(root, "Mark", PrimitiveType.Cube, new Vector3(0, 2.2f, -.18f), new Vector3(.55f, .45f, .06f), new Color(.8f, .58f, .18f));
            }
            else if (kind == "cot")
            {
                Part(root, "Canvas", PrimitiveType.Cube, new Vector3(0, .52f, 0), new Vector3(.95f, .12f, 2f), new Color(.65f, .62f, .45f));
                foreach (float x in new[] { -.45f, .45f })
                    foreach (float z in new[] { -.8f, .8f })
                        Part(root, "Leg", PrimitiveType.Cube, new Vector3(x, .25f, z), new Vector3(.08f, .5f, .08f), steel);
            }
            else if (kind == "target")
            {
                Part(root, "Stand", PrimitiveType.Cube, new Vector3(0, .75f, 0), new Vector3(.12f, 1.5f, .15f), wood);
                Part(root, "Foot", PrimitiveType.Cube, new Vector3(0, .08f, 0), new Vector3(1.1f, .16f, .65f), wood);
                for (int i = 0; i < 5; i++)
                {
                    float size = 1.5f - i * .27f;
                    var disk = Part(root, "Ring" + i, PrimitiveType.Cylinder,
                        new Vector3(0, 1.65f, -.02f - i * .016f), new Vector3(size, .022f, size),
                        i == 4 ? new Color(.76f, .13f, .08f) : (i % 2 == 0 ? new Color(.88f, .83f, .66f) : steel));
                    disk.transform.localRotation = Quaternion.Euler(90, 0, 0);
                }
            }
            else if (kind == "bench")
            {
                Part(root, "Worktop", PrimitiveType.Cube, new Vector3(0, .95f, 0), new Vector3(2.4f, .18f, 1.2f), wood);
                for (int x = -1; x <= 1; x += 2)
                    for (int z = -1; z <= 1; z += 2)
                        Part(root, "Leg", PrimitiveType.Cube, new Vector3(x, .45f, z * .45f), new Vector3(.14f, .9f, .14f), steel);
                Part(root, "ToolBoard", PrimitiveType.Cube, new Vector3(0, 1.45f, .5f), new Vector3(2.3f, .9f, .12f), steel);
                Part(root, "Vise", PrimitiveType.Cube, new Vector3(-.7f, 1.12f, -.2f), new Vector3(.42f, .25f, .33f), concrete);
                for (int i = 0; i < 4; i++)
                    Part(root, "Tool", PrimitiveType.Cube, new Vector3(-.6f + i * .4f, 1.5f, .40f), new Vector3(.055f, .45f, .055f), concrete);
            }
            else if (kind == "crate")
            {
                Part(root, "Box", PrimitiveType.Cube, new Vector3(0, .4f, 0), new Vector3(1.2f, .8f, .85f), wood);
                for (int i = -1; i <= 1; i += 2)
                    Part(root, "Strap", PrimitiveType.Cube, new Vector3(i * .4f, .43f, 0), new Vector3(.09f, .9f, .91f), steel);
                Part(root, "Lid", PrimitiveType.Cube, new Vector3(0, .84f, 0), new Vector3(1.24f, .1f, .9f), concrete);
            }
            else if (kind == "cover")
            {
                Part(root, "Concrete", PrimitiveType.Cube, new Vector3(0, .58f, 0), new Vector3(3.2f, 1.16f, .8f), concrete);
                for (int i = -1; i <= 1; i += 2)
                    Part(root, "Base", PrimitiveType.Cube, new Vector3(i * 1.1f, .1f, 0), new Vector3(.6f, .2f, 1.15f), concrete);
            }
            else if (kind == "ore")
            {
                for (int i = 0; i < 5; i++)
                {
                    var rock = Part(root, "Ore", PrimitiveType.Sphere,
                        new Vector3((i % 3 - 1) * .42f, .23f + (i % 2) * .13f, (i / 3f - .65f) * .55f),
                        new Vector3(.7f, .62f, .8f), i % 2 == 0 ? steel : new Color(.47f, .3f, .2f));
                    rock.transform.localRotation = Quaternion.Euler(i * 23, i * 47, i * 16);
                }
            }
            else if (kind == "wood")
            {
                for (int i = 0; i < 3; i++)
                {
                    var log = Part(root, "Log", PrimitiveType.Cylinder,
                        new Vector3(0, .22f + (i == 2 ? .3f : 0), (i % 2 - .5f) * .36f),
                        new Vector3(.32f, 1.2f, .32f), wood);
                    log.transform.localRotation = Quaternion.Euler(0, 0, 90);
                }
            }
            return root;
        }

        private static GameObject Part(GameObject root, string name, PrimitiveType type,
            Vector3 position, Vector3 scale, Color color)
        {
            var part = GameObject.CreatePrimitive(type);
            part.name = name;
            part.transform.SetParent(root.transform, false);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            var collider = part.GetComponent<Collider>();
            collider.enabled = false;
            if (Application.isPlaying) Object.Destroy(collider); else Object.DestroyImmediate(collider);
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { name = "Tutorial_" + ColorUtility.ToHtmlStringRGB(color), color = color };
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .05f);
            root.GetComponent<RoaTutorialPropMaterials>()?.Own(material);
            part.GetComponent<Renderer>().sharedMaterial = material;
            return part;
        }
    }
}
