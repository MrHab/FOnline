Shader "Realm of Ashes/Dam Road River"
{
    Properties
    {
        _NormalMap ("Water Normal", 2D) = "bump" {}
        _ShallowColor ("Current Color", Color) = (0.08, 0.34, 0.37, 1)
        _DeepColor ("Deep Color", Color) = (0.015, 0.10, 0.13, 1)
        _FoamColor ("Bank Foam", Color) = (0.45, 0.61, 0.57, 1)
        _NormalScale ("Ripple Strength", Range(0, 2)) = 0.7
        _NormalTiling ("Ripple Tiling", Range(0.05, 2)) = 0.48
        _FlowSpeed ("Current Speed", Range(0, 0.12)) = 0.016
        _Smoothness ("Reflection Sharpness", Range(0, 1)) = 0.85
        _FresnelPower ("Reflection Falloff", Range(1, 8)) = 4.2
        _MineralVeil ("Bank Foam Amount", Range(0, 0.5)) = 0.44
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "ForwardRiver"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            Cull Off

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_NormalMap); SAMPLER(sampler_NormalMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _ShallowColor;
                float4 _DeepColor;
                float4 _FoamColor;
                float _NormalScale;
                float _NormalTiling;
                float _FlowSpeed;
                float _Smoothness;
                float _FresnelPower;
                float _MineralVeil;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 flowUv : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 flowUv : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.flowUv = input.flowUv;
                output.fogFactor = ComputeFogFactor(position.positionCS.z);
                return output;
            }

            float RiverNoise(float2 coord)
            {
                float2 cell = floor(coord);
                float2 blend = frac(coord);
                blend = blend * blend * (3.0 - 2.0 * blend);
                float a = frac(sin(dot(cell, float2(127.1, 311.7))) * 43758.5453);
                float b = frac(sin(dot(cell + float2(1.0, 0.0),
                    float2(127.1, 311.7))) * 43758.5453);
                float c = frac(sin(dot(cell + float2(0.0, 1.0),
                    float2(127.1, 311.7))) * 43758.5453);
                float d = frac(sin(dot(cell + 1.0,
                    float2(127.1, 311.7))) * 43758.5453);
                return lerp(lerp(a, b, blend.x), lerp(c, d, blend.x), blend.y);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // UVs follow the curved centreline, so ripples travel through each bend.
                float2 along = input.flowUv.xy * _NormalTiling;
                float speed = _FlowSpeed * lerp(1.0, 1.8,
                    smoothstep(-72.0, -42.0, input.positionWS.z));
                float t = _Time.y * speed;
                half3 shortWave = UnpackNormalScale(SAMPLE_TEXTURE2D(_NormalMap,
                    sampler_NormalMap, along + float2(0.0, -t)), _NormalScale);
                half3 longWave = UnpackNormalScale(SAMPLE_TEXTURE2D(_NormalMap,
                    sampler_NormalMap, along * float2(0.62, 1.37)
                    + float2(0.31, -t * 0.71)), _NormalScale * 0.52);
                half3 normalWS = normalize(half3(shortWave.x + longWave.x * 0.65,
                    1.9, shortWave.y + longWave.y * 0.65));
                half3 view = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                half fresnel = pow(1.0 - saturate(dot(normalWS, view)), _FresnelPower);

                // Broad darker water in the middle, subtle moving glints in the current.
                half eddy = sin(along.y * 0.39 - t * 0.65
                    + sin(along.x * 0.55) * 0.8) * 0.5 + 0.5;
                half ripple = saturate(0.48 + shortWave.x * 0.38
                    + longWave.y * 0.30 + (eddy - 0.5) * 0.16);
                half3 water = lerp(_DeepColor.rgb, _ShallowColor.rgb,
                    ripple * 0.72 + fresnel * 0.18);
                // The bank reads shallower through color alone; the surface never
                // reveals submerged geometry or depends on a depth texture.
                float bankMetres = max(0.0, input.flowUv.z - abs(input.flowUv.x));
                half shallow = 1.0 - smoothstep(0.0, 9.0, bankMetres);
                water = lerp(water, _ShallowColor.rgb, shallow * 0.26);
                // Two moving noise scales break the current into irregular,
                // short highlights instead of synchronized waves across the bank.
                float2 current = float2(input.flowUv.x * 0.55,
                    input.flowUv.y * 0.65 - t * 2.4);
                half broad = RiverNoise(current);
                half detail = RiverNoise(current * float2(3.1, 4.7)
                    + float2(4.3, -t * 1.7));
                water *= lerp(0.97, 1.03, broad);
                half brokenCrest = smoothstep(0.68, 0.89, broad)
                    * smoothstep(0.44, 0.76, detail);
                water += _ShallowColor.rgb * brokenCrest * 0.09;
                water = lerp(water, half3(0.28, 0.32, 0.31), fresnel * 0.24);

                // The shoreline is measured in metres, not as a fraction of river width.
                half bank = 1.0 - smoothstep(0.0, 2.4, bankMetres);
                half foamBreakup = saturate(0.43 + shortWave.x * 0.6
                    + longWave.y * 0.22 + sin(along.y * 2.7 - t * 6.0) * 0.13);
                half foam = bank * bank * foamBreakup * _MineralVeil * 1.75;
                half contact = (1.0 - smoothstep(0.08, 0.65, bankMetres))
                    * smoothstep(0.31, 0.68, RiverNoise(input.positionWS.xz * 1.4
                        + float2(0.0, -t * 1.8)));
                foam = max(foam, contact * 0.45);
                water = lerp(water, _FoamColor.rgb, foam);

                Light sun = GetMainLight();
                half3 halfDirection = SafeNormalize(sun.direction + view);
                half glint = pow(saturate(dot(normalWS, halfDirection)),
                    lerp(30.0, 120.0, _Smoothness));
                water += sun.color * glint * (0.08 + _Smoothness * 0.28);
                water = MixFog(water, input.fogFactor);
                return half4(water, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
