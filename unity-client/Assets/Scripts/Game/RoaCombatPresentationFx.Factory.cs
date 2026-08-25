using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaCombatPresentationFx
    {
        private void EnsurePools()
        {
            if (_muzzleMesh == null) _muzzleMesh = CreateMuzzleMesh();
            while (_tracers.Count < InitialTracerPool) _tracers.Add(CreateTracer());
            while (_flashes.Count < InitialFlashPool) _flashes.Add(CreateFlash());
            while (_impacts.Count < InitialImpactPool) _impacts.Add(CreateImpact());
        }

        private TracerFx AcquireTracer()
        {
            TracerFx oldest = _tracers[0];
            for (int i = 0; i < _tracers.Count; i++)
            {
                TracerFx candidate = _tracers[i];
                if (!candidate.Active) return candidate;
                if (candidate.Started < oldest.Started) oldest = candidate;
            }
            return oldest;
        }

        private FlashFx AcquireFlash()
        {
            FlashFx oldest = _flashes[0];
            for (int i = 0; i < _flashes.Count; i++)
            {
                FlashFx candidate = _flashes[i];
                if (!candidate.Active) return candidate;
                if (candidate.Started < oldest.Started) oldest = candidate;
            }
            return oldest;
        }

        private ImpactFx AcquireImpact()
        {
            ImpactFx oldest = _impacts[0];
            for (int i = 0; i < _impacts.Count; i++)
            {
                ImpactFx candidate = _impacts[i];
                if (!candidate.Active) return candidate;
                if (candidate.Started < oldest.Started) oldest = candidate;
            }
            return oldest;
        }

        private TracerFx CreateTracer()
        {
            var root = new GameObject("PolishedTracerFx");
            root.transform.SetParent(transform, false);
            var line = root.AddComponent<LineRenderer>();
            Material material = CreateTransparentMaterial(Color.white, true);
            line.sharedMaterial = material;
            line.useWorldSpace = true;
            line.positionCount = 2;
            line.widthCurve = new AnimationCurve(
                new Keyframe(0f, 0f), new Keyframe(0.42f, 1f), new Keyframe(1f, 0.34f));
            line.numCapVertices = 3;
            line.numCornerVertices = 2;
            line.alignment = LineAlignment.View;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            root.SetActive(false);
            return new TracerFx { Root = root, Line = line, Material = material };
        }

        private FlashFx CreateFlash()
        {
            var root = new GameObject("DirectionalMuzzleFlash");
            root.transform.SetParent(transform, false);
            var filter = root.AddComponent<MeshFilter>();
            filter.sharedMesh = _muzzleMesh;
            var renderer = root.AddComponent<MeshRenderer>();
            Material material = CreateTransparentMaterial(Color.white, true);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            Light light = root.AddComponent<Light>();
            light.type = LightType.Point;
            light.shadows = LightShadows.None;
            root.SetActive(false);
            return new FlashFx { Root = root, Renderer = renderer, Material = material, Light = light };
        }

        private ImpactFx CreateImpact()
        {
            var root = new GameObject("LayeredImpactFx");
            root.transform.SetParent(transform, false);
            Material coreMaterial = CreateTransparentMaterial(Color.white, true);
            Renderer core = CreateSphere(root.transform, "ImpactCore", coreMaterial);
            Material sparkMaterial = CreateTransparentMaterial(Color.white, true);
            var sparks = new LineRenderer[ImpactSparkCount];
            for (int i = 0; i < sparks.Length; i++)
                sparks[i] = CreateSparkLine(root.transform, "Spark" + i, sparkMaterial, 0.026f);
            root.SetActive(false);
            return new ImpactFx
            {
                Root = root,
                Core = core,
                CoreMaterial = coreMaterial,
                Sparks = sparks,
                SparkMaterial = sparkMaterial,
                Velocities = new Vector3[ImpactSparkCount]
            };
        }

        private static LineRenderer CreateRing(Transform parent, string name, Material material, float width)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var ring = go.AddComponent<LineRenderer>();
            ring.sharedMaterial = material;
            ring.useWorldSpace = false;
            ring.loop = true;
            ring.positionCount = 48;
            ring.widthMultiplier = width;
            ring.numCapVertices = 2;
            ring.alignment = LineAlignment.View;
            ring.shadowCastingMode = ShadowCastingMode.Off;
            ring.receiveShadows = false;
            for (int i = 0; i < ring.positionCount; i++)
            {
                float angle = i / (float)ring.positionCount * Mathf.PI * 2f;
                ring.SetPosition(i, new Vector3(Mathf.Cos(angle), 0.025f, Mathf.Sin(angle)));
            }
            return ring;
        }

        private static LineRenderer CreateSparkLine(
            Transform parent, string name, Material material, float width)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var line = go.AddComponent<LineRenderer>();
            line.sharedMaterial = material;
            line.useWorldSpace = false;
            line.positionCount = 2;
            line.widthMultiplier = width;
            line.widthCurve = new AnimationCurve(
                new Keyframe(0f, 0f), new Keyframe(0.3f, 1f), new Keyframe(1f, 0.2f));
            line.numCapVertices = 2;
            line.alignment = LineAlignment.View;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }

        private static Renderer CreateSphere(Transform parent, string name, Material material)
        {
            GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = name;
            sphere.transform.SetParent(parent, false);
            Collider collider = sphere.GetComponent<Collider>();
            if (collider != null)
            {
                collider.enabled = false;
                UnityEngine.Object.Destroy(collider);
            }
            Renderer renderer = sphere.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
        }

        private static Mesh CreateMuzzleMesh()
        {
            const int points = 12;
            var vertices = new Vector3[points + 2];
            var triangles = new int[points * 6];
            vertices[0] = Vector3.zero;
            vertices[points + 1] = new Vector3(0f, 0f, 1f);
            for (int i = 0; i < points; i++)
            {
                float angle = i / (float)points * Mathf.PI * 2f;
                float radius = i % 2 == 0 ? 1f : 0.46f;
                vertices[i + 1] = new Vector3(
                    Mathf.Cos(angle) * radius, Mathf.Sin(angle) * radius, 0.08f);
                int next = (i + 1) % points + 1;
                int offset = i * 6;
                triangles[offset] = 0;
                triangles[offset + 1] = next;
                triangles[offset + 2] = i + 1;
                triangles[offset + 3] = i + 1;
                triangles[offset + 4] = next;
                triangles[offset + 5] = points + 1;
            }
            var mesh = new Mesh { name = "ProceduralMuzzleBurst" };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Texture2D CreateDamageVignette()
        {
            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false, true)
            {
                name = "ProceduralDamageVignette",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float nx = (x + 0.5f) / size;
                    float ny = (y + 0.5f) / size;
                    float edgeDistance = Mathf.Min(
                        Mathf.Min(nx, 1f - nx), Mathf.Min(ny, 1f - ny)) * 2f;
                    float edge = Mathf.Pow(1f - Mathf.Clamp01(edgeDistance), 2.6f);
                    pixels[y * size + x] = new Color(0.55f, 0.015f, 0.005f, edge * 0.78f);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Gradient TracerGradient(Color color)
        {
            return new Gradient
            {
                colorKeys = new[]
                {
                    new GradientColorKey(Color.Lerp(color, Color.white, 0.12f), 0f),
                    new GradientColorKey(color, 0.58f),
                    new GradientColorKey(Color.Lerp(color, Color.white, 0.72f), 1f)
                },
                alphaKeys = new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(0.82f, 0.24f),
                    new GradientAlphaKey(1f, 1f)
                }
            };
        }

        private static float TracerWidth(string weaponId)
        {
            switch (weaponId ?? string.Empty)
            {
                case "rocketLauncher": return 0.105f;
                case "plasmaRifle": return 0.092f;
                case "laserPistol": return 0.068f;
                case "shotgun": return 0.052f;
                case "machineGun": return 0.043f;
                default: return 0.048f;
            }
        }

        private static Material CreateTransparentMaterial(Color color, bool additive)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Color");
            var material = new Material(shader);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_SrcBlend"))
                material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend"))
                material.SetFloat("_DstBlend",
                    (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent;
            SetMaterialColor(material, color, color.a > 0f ? color.a : 1f, additive ? 2f : 0f);
            return material;
        }

        private static void SetMaterialColor(
            Material material, Color color, float alpha, float emission)
        {
            if (material == null) return;
            color.a = alpha;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (emission > 0f && material.HasProperty("_EmissionColor"))
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor",
                    new Color(color.r * emission, color.g * emission, color.b * emission, 1f));
            }
        }

        private static void SetMaterialAlpha(Material material, float alpha)
        {
            if (material == null) return;
            if (material.HasProperty("_BaseColor"))
            {
                Color color = material.GetColor("_BaseColor");
                color.a = alpha;
                material.SetColor("_BaseColor", color);
            }
            if (material.HasProperty("_Color"))
            {
                Color color = material.GetColor("_Color");
                color.a = alpha;
                material.SetColor("_Color", color);
            }
        }

        private float Next01()
        {
            _variation = _variation * 1664525u + 1013904223u;
            return ((_variation >> 8) & 0xffffu) / 65535f;
        }

        private void DestroyPools()
        {
            Clear();
            for (int i = 0; i < _tracers.Count; i++)
            {
                DestroyMaterial(_tracers[i].Material);
                if (_tracers[i].Root != null) Destroy(_tracers[i].Root);
            }
            for (int i = 0; i < _flashes.Count; i++)
            {
                DestroyMaterial(_flashes[i].Material);
                if (_flashes[i].Root != null) Destroy(_flashes[i].Root);
            }
            for (int i = 0; i < _impacts.Count; i++)
            {
                DestroyMaterial(_impacts[i].CoreMaterial);
                DestroyMaterial(_impacts[i].SparkMaterial);
                if (_impacts[i].Root != null) Destroy(_impacts[i].Root);
            }
            _tracers.Clear();
            _flashes.Clear();
            _impacts.Clear();
        }

        private void DestroyMaterial(Material material)
        {
            if (material != null) Destroy(material);
        }
    }
}
