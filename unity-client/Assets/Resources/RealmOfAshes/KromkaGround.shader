// Земля локальной сцены Кромки (RoaLocalTerrain). Три слоя:
//  - набор грунта зоны (бесшовная PBR-текстура Poly Haven по пресету грунта);
//  - гравий троп по маске, смешанный с грунтом по высоте;
//  - запечённая карта зоны (_BaseMap): крупные пятна, тропы, вода и гарь по карте сервера.
// Каждый набор читается дважды — под другим углом и шагом — и смешивается по
// низкочастотному шуму, чтобы повтор плитки не был виден. Влажность (_Wetness) приходит
// от погоды (RoaWorldLighting): впадины темнеют и блестят раньше бугров.
// После дождя (погода сервера через RoaWorldLighting): грязь (_Mud) проступает на тропах
// и в низинах, лужи (_Puddles) стоят там же и растут с уровнем воды, по воде в дождь
// (_Rain) расходятся круги. Вода с карты сервера — тёмная мутная гладь с рябью.
// Следы (RoaGroundPrints, глобальная карта _KromkaPrintMap вокруг камеры): отпечаток
// опускает грунт, стенки лепит наклон нормали, в мокрую погоду следы набирают воду.
// Освещение — полный PBR URP (UniversalFragmentPBR): солнце с тенями, допсвета (луна,
// контровой, молния), отражения проб и туман.
Shader "Realm of Ashes/Kromka Ground"
{
    Properties
    {
        [MainTexture] _BaseMap ("Zone map (baked)", 2D) = "white" {}
        [MainColor] _BaseColor ("Tint (hour of day)", Color) = (1, 1, 1, 1)
        _SurfaceMask ("Surface mask: R path, G scorch, B water", 2D) = "black" {}
        _MacroMean ("Zone map mean colour", Color) = (0.62, 0.5, 0.34, 1)
        _MacroStrength ("Zone map variation", Range(0, 1)) = 0.55

        _GroundAlbedo ("Ground albedo", 2D) = "grey" {}
        [Normal] _GroundNormal ("Ground normal", 2D) = "bump" {}
        _GroundMask ("Ground mask: R height, G roughness, B occlusion", 2D) = "grey" {}
        _GroundTiling ("Ground tile, m", Float) = 3.2
        _GroundTint ("Ground tint", Color) = (1, 1, 1, 1)
        _GroundSaturation ("Ground saturation", Range(0, 1.5)) = 1

        _PathAlbedo ("Path albedo", 2D) = "grey" {}
        [Normal] _PathNormal ("Path normal", 2D) = "bump" {}
        _PathMask ("Path mask", 2D) = "grey" {}
        _PathTiling ("Path tile, m", Float) = 2.6
        _PathTint ("Path tint", Color) = (1, 1, 1, 1)
        _PathSaturation ("Path saturation", Range(0, 1.5)) = 1
        _PathGroundColour ("Path takes ground colour", Range(0, 1)) = 0.5

        _MudAlbedo ("Mud albedo", 2D) = "grey" {}
        [Normal] _MudNormal ("Mud normal", 2D) = "bump" {}
        _MudMask ("Mud mask", 2D) = "grey" {}
        _MudTiling ("Mud tile, m", Float) = 3
        _MudTint ("Mud tint", Color) = (1, 1, 1, 1)
        _MudSaturation ("Mud saturation", Range(0, 1.5)) = 1
        _MudGroundColour ("Mud takes ground colour", Range(0, 1)) = 0.45
        _WaterColour ("Water colour", Color) = (0.07, 0.085, 0.075, 1)
        _GroundPrints ("Ground keeps prints", Range(0, 1)) = 0.5
        _PathPrints ("Path keeps prints", Range(0, 1)) = 0.3
        _MudPrints ("Mud keeps prints", Range(0, 1)) = 1

        _NormalStrength ("Normal strength", Range(0, 2)) = 1
        _DrySmoothness ("Dry smoothness", Range(0, 1)) = 0.3
        _Wetness ("Wetness", Range(0, 1)) = 0
        _Mud ("Mud", Range(0, 1)) = 0
        _Puddles ("Puddles", Range(0, 1)) = 0
        _Rain ("Rain", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" "RenderPipeline" = "UniversalPipeline" }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            // Телефон: без второй выборки против повтора.
            #pragma multi_compile_local _ _KROMKA_GROUND_LITE

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseMap);      SAMPLER(sampler_BaseMap);
            TEXTURE2D(_SurfaceMask);  SAMPLER(sampler_SurfaceMask);
            TEXTURE2D(_GroundAlbedo); SAMPLER(sampler_GroundAlbedo);
            TEXTURE2D(_GroundNormal); SAMPLER(sampler_GroundNormal);
            TEXTURE2D(_GroundMask);   SAMPLER(sampler_GroundMask);
            TEXTURE2D(_PathAlbedo);   SAMPLER(sampler_PathAlbedo);
            TEXTURE2D(_PathNormal);   SAMPLER(sampler_PathNormal);
            TEXTURE2D(_PathMask);     SAMPLER(sampler_PathMask);
            TEXTURE2D(_MudAlbedo);    SAMPLER(sampler_MudAlbedo);
            TEXTURE2D(_MudNormal);    SAMPLER(sampler_MudNormal);
            TEXTURE2D(_MudMask);      SAMPLER(sampler_MudMask);

            // Карта следов (RoaGroundPrints) — глобальная: xy окна — центр, z — 1/сторона в
            // метрах, w — 1/тексели; сила 0 — следов нет (вне мира, пробы).
            TEXTURE2D(_KromkaPrintMap); SAMPLER(sampler_KromkaPrintMap);
            float4 _KromkaPrintWindow;
            half _KromkaPrintStrength;

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _MacroMean;
                half _MacroStrength;
                float _GroundTiling;
                half4 _GroundTint;
                half _GroundSaturation;
                float _PathTiling;
                half4 _PathTint;
                half _PathSaturation;
                half _PathGroundColour;
                float _MudTiling;
                half4 _MudTint;
                half _MudSaturation;
                half _MudGroundColour;
                half4 _WaterColour;
                half _GroundPrints;
                half _PathPrints;
                half _MudPrints;
                half _NormalStrength;
                half _DrySmoothness;
                half _Wetness;
                half _Mud;
                half _Puddles;
                half _Rain;
            CBUFFER_END

        #if defined(_KROMKA_GROUND_LITE)
            #define RIPPLE_LAYERS 1
        #else
            #define RIPPLE_LAYERS 2
        #endif

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3 normalWS : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            #ifdef _ADDITIONAL_LIGHTS_VERTEX
                half3 vertexLight : TEXCOORD4;
            #endif
            #if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
                float4 shadowCoord : TEXCOORD5;
            #endif
            };

            struct Layer
            {
                half3 albedo;
                half2 normalXY;
                half height;
                half roughness;
                half occlusion;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output = (Varyings)0;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normal = GetVertexNormalInputs(input.normalOS);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.normalWS = normal.normalWS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.fogFactor = ComputeFogFactor(position.positionCS.z);
            #ifdef _ADDITIONAL_LIGHTS_VERTEX
                output.vertexLight = VertexLighting(position.positionWS, normal.normalWS);
            #endif
            #if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
                output.shadowCoord = GetShadowCoord(position);
            #endif
                return output;
            }

            float Hash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float ValueNoise(float2 p)
            {
                float2 cell = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = Hash21(cell);
                float b = Hash21(cell + float2(1, 0));
                float c = Hash21(cell + float2(0, 1));
                float d = Hash21(cell + float2(1, 1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            Layer ReadLayer(TEXTURE2D_PARAM(albedoMap, albedoSampler), TEXTURE2D_PARAM(normalMap, normalSampler),
                            TEXTURE2D_PARAM(maskMap, maskSampler), float2 uv)
            {
                Layer layer;
                layer.albedo = SAMPLE_TEXTURE2D(albedoMap, albedoSampler, uv).rgb;
                half3 normal = UnpackNormal(SAMPLE_TEXTURE2D(normalMap, normalSampler, uv));
                layer.normalXY = normal.xy;
                half3 mask = SAMPLE_TEXTURE2D(maskMap, maskSampler, uv).rgb;
                layer.height = mask.r;
                layer.roughness = mask.g;
                layer.occlusion = mask.b;
                return layer;
            }

            // Набор по миру: две выборки (вторая повёрнута на 38° и крупнее) смешаны по шуму
            // с учётом высоты — повтор плитки распадается на неправильные пятна.
            Layer SampleSet(TEXTURE2D_PARAM(albedoMap, albedoSampler), TEXTURE2D_PARAM(normalMap, normalSampler),
                            TEXTURE2D_PARAM(maskMap, maskSampler), float2 worldXZ, float tiling, float variation)
            {
                float2 uvA = worldXZ / max(0.25, tiling);
                Layer a = ReadLayer(TEXTURE2D_ARGS(albedoMap, albedoSampler), TEXTURE2D_ARGS(normalMap, normalSampler),
                                    TEXTURE2D_ARGS(maskMap, maskSampler), uvA);
            #if defined(_KROMKA_GROUND_LITE)
                return a;
            #else
                const float c = 0.788;
                const float s = 0.616;
                float2 uvB = float2(c * uvA.x - s * uvA.y, s * uvA.x + c * uvA.y) * 0.73 + float2(0.37, 0.61);
                Layer b = ReadLayer(TEXTURE2D_ARGS(albedoMap, albedoSampler), TEXTURE2D_ARGS(normalMap, normalSampler),
                                    TEXTURE2D_ARGS(maskMap, maskSampler), uvB);
                // Нормаль второй выборки — обратно в оси мира.
                b.normalXY = half2(c * b.normalXY.x + s * b.normalXY.y, -s * b.normalXY.x + c * b.normalXY.y);
                half w = saturate((variation - 0.5) * 3.0 + (b.height - a.height) * 1.5 + 0.5);
                Layer mixed;
                mixed.albedo = lerp(a.albedo, b.albedo, w);
                mixed.normalXY = lerp(a.normalXY, b.normalXY, w);
                mixed.height = lerp(a.height, b.height, w);
                mixed.roughness = lerp(a.roughness, b.roughness, w);
                mixed.occlusion = lerp(a.occlusion, b.occlusion, w);
                return mixed;
            #endif
            }

            // Круги от капель: клетки по 55 см, в каждой своя капля со своим сдвигом во времени.
            // В морось капает в немногих клетках, в ливень — почти во всех. xy — наклон
            // нормали, z — гребни: серое небо в ряби почти не меняется, гребни подсвечиваем.
            half3 RainRipples(float2 worldXZ, float time, half rain)
            {
                float3 total = float3(0, 0, 0);
                UNITY_UNROLL
                for (int layer = 0; layer < RIPPLE_LAYERS; layer++)
                {
                    float2 p = worldXZ / 0.55 + float2(layer * 0.37, layer * 0.71);
                    float2 cell = floor(p);
                    float2 f = frac(p);
                    float seed = Hash21(cell + layer * 17.13);
                    float active = step(seed, rain * 0.9 + 0.05);
                    float2 centre = 0.3 + 0.4 * float2(Hash21(cell + 3.17), Hash21(cell + 7.73));
                    float age = frac(time * 1.1 + seed * 7.0);
                    float2 delta = f - centre;
                    float d = length(delta);
                    float ring = d - age * 0.45;
                    float envelope = saturate(1.0 - abs(ring) / 0.07) * (1.0 - age) * active;
                    float wave = sin(ring * 70.0);
                    total.xy += delta / max(d, 0.001) * wave * envelope;
                    total.z += max(wave, 0.0) * envelope;
                }
                half strength = saturate(rain * 3.0);
                return half3(total.xy * 0.45 * strength, total.z * strength);
            }

            half3 Saturate(half3 colour, half saturation)
            {
                half luma = dot(colour, half3(0.2126, 0.7152, 0.0722));
                return max(lerp(half3(luma, luma, luma), colour, saturation), 0);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldXZ = input.positionWS.xz;
                float variation = ValueNoise(worldXZ * 0.071) * 0.7 + ValueNoise(worldXZ * 0.193 + 11.3) * 0.3;

                half3 macro = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv).rgb;
                half3 surface = SAMPLE_TEXTURE2D(_SurfaceMask, sampler_SurfaceMask, input.uv).rgb;

                Layer ground = SampleSet(TEXTURE2D_ARGS(_GroundAlbedo, sampler_GroundAlbedo),
                                         TEXTURE2D_ARGS(_GroundNormal, sampler_GroundNormal),
                                         TEXTURE2D_ARGS(_GroundMask, sampler_GroundMask),
                                         worldXZ, _GroundTiling, variation);
                ground.albedo = Saturate(ground.albedo * _GroundTint.rgb, _GroundSaturation);

                // Средний цвет набора зоны (самый мелкий mip): им подкрашены колея и грязь.
                half3 groundMean = Saturate(SAMPLE_TEXTURE2D_LOD(_GroundAlbedo, sampler_GroundAlbedo, float2(0.5, 0.5), 12).rgb
                    * _GroundTint.rgb, _GroundSaturation);

                Layer layer = ground;
                UNITY_BRANCH
                if (surface.r > 0.004)
                {
                    Layer path = SampleSet(TEXTURE2D_ARGS(_PathAlbedo, sampler_PathAlbedo),
                                           TEXTURE2D_ARGS(_PathNormal, sampler_PathNormal),
                                           TEXTURE2D_ARGS(_PathMask, sampler_PathMask),
                                           worldXZ, _PathTiling, 1.0 - variation);
                    // Колея из того же грунта: гравий троп подкрашен средним цветом набора зоны.
                    half3 pathMean = SAMPLE_TEXTURE2D_LOD(_PathAlbedo, sampler_PathAlbedo, float2(0.5, 0.5), 12).rgb * _PathTint.rgb;
                    path.albedo = Saturate(path.albedo * _PathTint.rgb, _PathSaturation)
                        * lerp(half3(1, 1, 1), groundMean / max(pathMean, half3(0.05, 0.05, 0.05)), _PathGroundColour);
                    // По высоте: на краю тропы камни колеи выступают над грунтом, а не тают.
                    half w = saturate((surface.r - 0.5) * 3.0 + (path.height - ground.height) * 1.2 + 0.5);
                    layer.albedo = lerp(ground.albedo, path.albedo, w);
                    layer.normalXY = lerp(ground.normalXY, path.normalXY, w);
                    layer.height = lerp(ground.height, path.height, w);
                    layer.roughness = lerp(ground.roughness, path.roughness, w);
                    layer.occlusion = lerp(ground.occlusion, path.occlusion, w);
                }

                // Крупные пятна запечённой карты: отношение к её среднему цвету, чтобы
                // собственный цвет набора остался, а гарь и светлые пятна проступили.
                half3 macroRatio = macro / max(_MacroMean.rgb, half3(0.05, 0.05, 0.05));
                half3 albedo = layer.albedo * clamp(lerp(half3(1, 1, 1), macroRatio, _MacroStrength), 0.35, 1.7);

                // Гарь: сажа в углублениях.
                half scorch = surface.g;
                albedo *= lerp(half3(1, 1, 1), half3(0.42, 0.38, 0.35) * (0.7 + 0.6 * layer.height), scorch * 0.85);
                layer.roughness = lerp(layer.roughness, 1.0, scorch * 0.5);

                // Низины — крупный шум по миру: в них сначала грязь, потом лужи.
                half basin = ValueNoise(worldXZ * 0.085 + 3.7) * 0.65 + ValueNoise(worldXZ * 0.21 - 5.1) * 0.35;

                // Грязь после дождя: проступает на тропах и в низинах, бугры гравия остаются сверху.
                half mudWeight = 0;
                UNITY_BRANCH
                if (_Mud > 0.01)
                {
                    const float mc = 0.616;
                    const float ms = 0.788;
                    float2 mudUV = float2(mc * worldXZ.x + ms * worldXZ.y, -ms * worldXZ.x + mc * worldXZ.y) / max(0.25, _MudTiling);
                    Layer mud = ReadLayer(TEXTURE2D_ARGS(_MudAlbedo, sampler_MudAlbedo), TEXTURE2D_ARGS(_MudNormal, sampler_MudNormal),
                                          TEXTURE2D_ARGS(_MudMask, sampler_MudMask), mudUV);
                    mud.normalXY = half2(mc * mud.normalXY.x - ms * mud.normalXY.y, ms * mud.normalXY.x + mc * mud.normalXY.y);
                    // Тропы раскисают целиком, открытый грунт — только в самых низких местах.
                    half affinity = surface.r * 0.6 + (1.0 - basin) * 0.55;
                    mudWeight = saturate((_Mud * affinity - layer.height * 0.35 - 0.2) * 3.5);
                    half3 mudMean = SAMPLE_TEXTURE2D_LOD(_MudAlbedo, sampler_MudAlbedo, float2(0.5, 0.5), 12).rgb * _MudTint.rgb;
                    half3 mudAlbedo = Saturate(mud.albedo * _MudTint.rgb, _MudSaturation)
                        * lerp(half3(1, 1, 1), groundMean / max(mudMean, half3(0.05, 0.05, 0.05)), _MudGroundColour);
                    albedo = lerp(albedo, mudAlbedo, mudWeight);
                    layer.normalXY = lerp(layer.normalXY, mud.normalXY, mudWeight);
                    layer.height = lerp(layer.height, mud.height * 0.6, mudWeight);
                    layer.roughness = lerp(layer.roughness, mud.roughness * 0.75, mudWeight);
                    layer.occlusion = lerp(layer.occlusion, mud.occlusion, mudWeight);
                }

                // Следы: глубину отпечатка на момент шага пишет RoaGroundPrints; здесь — только
                // местная поправка (тропа держит след хуже грунта, свежая грязь лучше, в воде
                // следов нет). Отпечаток опускает грунт — вода и темнота сначала в нём, стенки
                // лепит наклон нормали по соседним текселям карты (на телефоне без него).
                half printDepth = 0;
                half2 printSlope = half2(0, 0);
                UNITY_BRANCH
                if (_KromkaPrintStrength > 0.001)
                {
                    float2 printUV = (worldXZ - _KromkaPrintWindow.xy) * _KromkaPrintWindow.z + 0.5;
                    float2 edge = abs(printUV - 0.5);
                    half inWindow = saturate((0.5 - max(edge.x, edge.y)) * 30.0);
                    // Под грязью твёрдость тропы уже не важна: след держит сама грязь.
                    half keep = lerp(1.0, _PathPrints / max(_GroundPrints, 0.05), surface.r);
                    keep = min(lerp(keep, max(keep, _MudPrints / max(_GroundPrints, 0.05)), mudWeight), 1.5);
                    half scale = inWindow * keep * (1.0 - surface.b) * _KromkaPrintStrength;
                    half p0 = SAMPLE_TEXTURE2D_LOD(_KromkaPrintMap, sampler_KromkaPrintMap, printUV, 0).r;
                    printDepth = saturate(p0 * scale);
                #if !defined(_KROMKA_GROUND_LITE)
                    float texel = _KromkaPrintWindow.w;
                    half px = SAMPLE_TEXTURE2D_LOD(_KromkaPrintMap, sampler_KromkaPrintMap, printUV + float2(texel, 0), 0).r;
                    half pz = SAMPLE_TEXTURE2D_LOD(_KromkaPrintMap, sampler_KromkaPrintMap, printUV + float2(0, texel), 0).r;
                    // Полная глубина отпечатка — 3,5 см; наклон стенки — разница глубин на тексель.
                    half metresPerTexel = _KromkaPrintWindow.w / _KromkaPrintWindow.z;
                    printSlope = half2(px - p0, pz - p0) * (0.035 / metresPerTexel) * scale;
                #endif
                    // Подошва уплотняет и приглаживает грунт: внутри следа темнее и ровнее.
                    albedo *= 1.0 - printDepth * (0.2 + 0.1 * _Wetness);
                    layer.normalXY *= 1.0 - printDepth * 0.7;
                    layer.height = saturate(layer.height - printDepth * 0.55);
                    layer.roughness = lerp(layer.roughness, layer.roughness * 0.75, printDepth * 0.5);
                }

                half2 normalXY = layer.normalXY * _NormalStrength;
                half smoothness = (1.0 - layer.roughness) * _DrySmoothness;

                // Мокрая земля: вода сначала во впадинах — они темнеют и блестят раньше бугров,
                // плёнка сглаживает рельеф.
                half wet = saturate(_Wetness * (1.35 - layer.height * 0.7));
                albedo *= 1.0 - wet * (0.4 - 0.12 * layer.height);
                smoothness = lerp(smoothness, lerp(0.74, 0.46, layer.height), sqrt(wet));
                normalXY *= 1.0 - wet * 0.45;
                normalXY += printSlope;

                // Лужи: вода стоит в низинах и в колеях троп, сначала во впадинах текстуры; у
                // края — мелко (видно дно), к середине — тёмная гладь, отражающая небо.
                half puddle = 0;
                UNITY_BRANCH
                if (_Puddles > 0.01)
                {
                    // Пятна около двух метров (мелкий шум) с тягой к низинам и колеям троп.
                    half field = ValueNoise(worldXZ * 0.45 + 9.1) * 0.55 + ValueNoise(worldXZ * 1.1 - 2.3) * 0.2 + basin * 0.25;
                    half floorHeight = field * 0.75 + layer.height * 0.25 - surface.r * 0.15;
                    half level = _Puddles * 0.4;
                    // Кромка воды чёткая, вокруг — полоса набухшего тёмного грунта.
                    half soaked = saturate((level + 0.035 - floorHeight) / 0.035);
                    albedo *= 1.0 - soaked * 0.22;
                    smoothness = lerp(smoothness, max(smoothness, 0.8), soaked);
                    puddle = saturate((level - floorHeight) / 0.012);
                    half depth = saturate((level - floorHeight) / 0.05);
                    // Глубокие следы (в грязи) набирают воду раньше луж.
                    half printFill = saturate((printDepth - 0.3) * 2.5) * saturate(_Puddles * 3.0);
                    puddle = max(puddle, printFill);
                    depth = max(depth, printFill * 0.3);
                    half3 murky = albedo * 0.3 + _WaterColour.rgb * 0.5;
                    albedo = lerp(albedo, lerp(albedo * 0.72, murky, depth), puddle);
                    smoothness = lerp(smoothness, 0.965, puddle);
                    normalXY *= 1.0 - puddle * (0.65 + 0.35 * depth);
                }

                // Вода с карты сервера: тёмная мутная гладь, у берега — мокрое дно.
                half water = surface.b;
                half waterSurface = max(water, puddle);
                half rippleCrest = 0;
                UNITY_BRANCH
                if (waterSurface > 0.004)
                {
                    // Рябь — две бегущие выборки нормалей грунта с крупного mip (без производных),
                    // сильно смягчённые; в дождь поверх — круги от капель.
                    float t = _Time.y;
                    half2 waves = (UnpackNormal(SAMPLE_TEXTURE2D_LOD(_GroundNormal, sampler_GroundNormal,
                                        worldXZ * 0.11 + float2(t * 0.021, t * 0.013), 3)).xy
                                 + UnpackNormal(SAMPLE_TEXTURE2D_LOD(_GroundNormal, sampler_GroundNormal,
                                        worldXZ * 0.17 - float2(t * 0.017, -t * 0.025), 3)).xy) * 0.07;
                    half3 ripples = _Rain > 0.01 ? RainRipples(worldXZ, t, _Rain) : half3(0, 0, 0);
                    normalXY = lerp(normalXY, waves * water + ripples.xy, waterSurface);
                    rippleCrest = ripples.z * waterSurface;
                }
                half3 deepWater = lerp(_WaterColour.rgb, macro * 0.4, 0.25);
                albedo = lerp(albedo, lerp(albedo * 0.55, deepWater, saturate(water * 1.6 - 0.3)), water);
                smoothness = lerp(smoothness, 0.955, water);

                albedo *= _BaseColor.rgb;

                // Касательные — оси мира: X вдоль u, Z вдоль v (развёртка наборов идёт по XZ).
                half3 normalGeo = normalize(input.normalWS);
                half3 tangent = normalize(half3(1, 0, 0) - normalGeo * normalGeo.x);
                half3 bitangent = normalize(half3(0, 0, 1) - normalGeo * normalGeo.z);
                half normalZ = sqrt(saturate(1.0 - dot(normalXY, normalXY)));
                half3 normalWS = normalize(tangent * normalXY.x + bitangent * normalXY.y + normalGeo * normalZ);

                InputData inputData = (InputData)0;
                inputData.positionWS = input.positionWS;
                inputData.normalWS = normalWS;
                inputData.viewDirectionWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
            #if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
                inputData.shadowCoord = input.shadowCoord;
            #elif defined(MAIN_LIGHT_CALCULATE_SHADOWS)
                inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
            #else
                inputData.shadowCoord = float4(0, 0, 0, 0);
            #endif
                inputData.fogCoord = InitializeInputDataFog(float4(input.positionWS, 1.0), input.fogFactor);
            #ifdef _ADDITIONAL_LIGHTS_VERTEX
                inputData.vertexLighting = input.vertexLight;
            #endif
                inputData.bakedGI = SampleSH(normalWS);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                inputData.shadowMask = half4(1, 1, 1, 1);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = albedo;
                surfaceData.metallic = 0;
                surfaceData.specular = half3(0, 0, 0);
                surfaceData.smoothness = smoothness;
                surfaceData.normalTS = half3(normalXY, normalZ);
                surfaceData.occlusion = lerp(1.0, layer.occlusion, 0.8);
                surfaceData.alpha = 1;

                // Небо в воде. Камера смотрит почти сверху, Френель воды там 2–4 %, и лужа
                // читалась бы тёмным пятном; добавляем отражение неба из пробы, как при
                // пологом взгляде (приём многих игр). Круги от капель рябят это отражение.
                UNITY_BRANCH
                if (waterSurface > 0.004)
                {
                    half3 reflectDir = reflect(-inputData.viewDirectionWS, normalWS);
                    half grazing = 1.0 - saturate(dot(normalWS, inputData.viewDirectionWS));
                    half3 sky = GlossyEnvironmentReflection(reflectDir, input.positionWS, 0.04, 1.0, inputData.normalizedScreenSpaceUV);
                    surfaceData.emission = sky * (waterSurface * (0.16 + 0.34 * grazing * grazing * grazing) + rippleCrest * 0.3);
                }

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFog(color.rgb, inputData.fogCoord);
                color.a = 1;
                return color;
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/DepthOnly"
    }

    FallBack "Universal Render Pipeline/Lit"
}
