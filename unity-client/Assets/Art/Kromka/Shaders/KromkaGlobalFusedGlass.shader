Shader "Realm of Ashes/Kromka Global Fused Glass"
{
    Properties
    {
        _MainTex ("Direct MEP Mineral Surface", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Stone Surface", 2D) = "gray" {}
        _Tint ("Glass Tint", Color) = (0.18, 0.72, 0.75, 1)
        _DarkTint ("Scorched Tint", Color) = (0.035, 0.08, 0.09, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.8
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.44
        _Opacity ("Opacity", Range(0.05, 1)) = 0.72
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.30
        _Crystalline ("Crystalline Breakup", Range(0, 1)) = 0.82
        _Scorch ("Thermal Scorch", Range(0, 1)) = 0.12
        _EmissionStrength ("Cold Emission", Range(0, 1)) = 0.22
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-44"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardFusedGlass"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_SecondaryTex); SAMPLER(sampler_SecondaryTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _DarkTint;
                float _DetailTiling;
                float _MacroTiling;
                float _Opacity;
                float _EdgeFade;
                float _Crystalline;
                float _Scorch;
                float _EmissionStrength;
                float _Seed;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fogFactor : TEXCOORD3;
                half4 color : COLOR;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                output.color = input.color;
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldUv = input.positionWS.xz;
                half3 mineral = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.17, _Seed * 0.31)).rgb;
                half3 stone = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.23, _Seed * 0.09)).rgb;
                half mineralLuma = dot(mineral, half3(0.299, 0.587, 0.114));
                half stoneLuma = dot(stone, half3(0.299, 0.587, 0.114));
                half shardNoise = sin(input.uv.y * 5.17 + _Seed * 2.31) * 0.5 + 0.5;
                half crystalline = smoothstep(0.24, 0.78,
                    mineralLuma * 0.54 + stoneLuma * 0.25 + shardNoise * 0.21);
                half3 glassAlbedo = lerp(_DarkTint.rgb,
                    mineral * _Tint.rgb * 1.78, crystalline * _Crystalline);
                half scorchMask = saturate((1.0 - stoneLuma) * 0.62
                    + (1.0 - shardNoise) * 0.38) * _Scorch;
                half3 albedo = lerp(glassAlbedo,
                    _DarkTint.rgb * (0.72 + stone * 0.28), scorchMask);
                albedo *= lerp(0.76, 1.18, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.72;
                half3 direct = mainLight.color * (0.25 + diffuse * 0.75);
                half3 emission = _Tint.rgb * _EmissionStrength
                    * crystalline * (0.30 + shardNoise * 0.70);
                half3 lit = MixFog(albedo * (ambient + direct) + emission,
                    input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.12, 0.82,
                    crystalline + shardNoise * _Crystalline * 0.28);
                half alpha = _Opacity * band * lerp(0.24, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
