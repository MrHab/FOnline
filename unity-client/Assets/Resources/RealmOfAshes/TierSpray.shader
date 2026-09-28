// Краска из баллончика поверх родного материала модели: второй проход той же
// геометрии рисует пятно цвета тира там, где поверхность попадает в объём метки
// (_SprayMatrix переводит координаты объекта в единичный объём: коробка, цилиндр или
// шар). Край пятна рваный и с брызгами, как у распылённой краски; освещение —
// матовое, тем же солнцем, тенями и точечными огнями, что и сама модель.
// Очередь — сразу за AlphaTest (2450): материалы пака рисуются там, краска должна позже.
Shader "RealmOfAshes/TierSpray"
{
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="AlphaTest+10" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        Pass
        {
            Name "TierSpray"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Offset -1, -1
            Cull Back

            HLSLPROGRAM
            #pragma target 2.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            float4x4 _SprayMatrix;
            half4 _SprayColor;
            float _SprayShape;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 sprayPos : TEXCOORD2;
                float fogFactor : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.sprayPos = mul(_SprayMatrix, float4(input.positionOS.xyz, 1)).xyz;
                output.fogFactor = ComputeFogFactor(position.positionCS.z);
                return output;
            }

            float Hash(float3 p)
            {
                p = frac(p * 0.3183099 + 0.1);
                p *= 17.0;
                return frac(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float Noise(float3 p)
            {
                float3 i = floor(p);
                float3 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(Hash(i), Hash(i + float3(1, 0, 0)), f.x),
                                 lerp(Hash(i + float3(0, 1, 0)), Hash(i + float3(1, 1, 0)), f.x), f.y),
                            lerp(lerp(Hash(i + float3(0, 0, 1)), Hash(i + float3(1, 0, 1)), f.x),
                                 lerp(Hash(i + float3(0, 1, 1)), Hash(i + float3(1, 1, 1)), f.x), f.y), f.z);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float3 p = input.sprayPos;
                // Расстояние в объёме метки: 0 в центре, 1 на границе.
                float d = _SprayShape < 0.5 ? max(abs(p.x), max(abs(p.y), abs(p.z))) * 2.0
                        : _SprayShape < 1.5 ? max(abs(p.y) * 2.0, length(p.xz) * 2.0)
                        : length(p) * 2.0;
                // Рваный край и брызги вокруг, как у баллончика.
                float edge = d + (Noise(p * 7.0) - 0.5) * 0.4;
                float body = 1.0 - smoothstep(0.55, 0.95, edge);
                // Брызги — круглые капли в случайных ячейках.
                float3 cell = p * 48.0;
                float drop = step(0.88, Hash(floor(cell))) * step(length(frac(cell) - 0.5), 0.32);
                float speck = drop * (1.0 - smoothstep(0.85, 1.35, d));
                float wear = lerp(0.72, 1.0, Noise(p * 22.0));
                float alpha = saturate(max(body * wear, speck * 0.75)) * _SprayColor.a;
                clip(alpha - 0.01);

                float3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight(TransformWorldToShadowCoord(input.positionWS));
                half3 light = mainLight.color * mainLight.distanceAttenuation * mainLight.shadowAttenuation
                    * saturate(dot(normalWS, mainLight.direction));
                light += SampleSH(normalWS);
            #if defined(_ADDITIONAL_LIGHTS)
                InputData inputData = (InputData)0;
                inputData.positionWS = input.positionWS;
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                uint pixelLightCount = GetAdditionalLightsCount();
                LIGHT_LOOP_BEGIN(pixelLightCount)
                    Light extra = GetAdditionalLight(lightIndex, input.positionWS, half4(1, 1, 1, 1));
                    light += extra.color * extra.distanceAttenuation * extra.shadowAttenuation
                        * saturate(dot(normalWS, extra.direction));
                LIGHT_LOOP_END
            #endif
                half3 color = MixFog(_SprayColor.rgb * light, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
