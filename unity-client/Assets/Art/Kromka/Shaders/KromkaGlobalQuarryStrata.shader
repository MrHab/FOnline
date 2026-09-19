Shader "Realm of Ashes/Kromka Global Quarry Strata"
{
    Properties
    {
        _MainTex ("Direct MEP Rock Surface", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Aggregate Surface", 2D) = "gray" {}
        _Tint ("Strata Tint", Color) = (0.58, 0.29, 0.16, 1)
        _DarkTint ("Cut Tint", Color) = (0.18, 0.08, 0.04, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 8)) = 2.8
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.1, 1)) = 0.66
        _EdgeFade ("Edge Fade", Range(0.05, 0.8)) = 0.28
        _Breakup ("Broken Strata", Range(0, 1)) = 0.62
        _Oxide ("Oxide Staining", Range(0, 1)) = 0.75
        _Dust ("Dry Dust", Range(0, 1)) = 0.25
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-45"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardQuarryStrata"
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
                float _Breakup;
                float _Oxide;
                float _Dust;
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
                half3 rock = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.17, _Seed * 0.29)).rgb;
                half3 aggregate = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.11, _Seed * 0.07)).rgb;
                half rockLuma = dot(rock, half3(0.299, 0.587, 0.114));
                half longNoise = sin(input.uv.y * 4.13 + _Seed * 1.73) * 0.5 + 0.5;
                half fissure = smoothstep(0.24, 0.76,
                    rockLuma * 0.55 + aggregate.g * 0.26 + longNoise * 0.19);
                half3 baseAlbedo = lerp(rock, aggregate, 0.34) * _Tint.rgb * 1.70;
                half3 cutAlbedo = lerp(_DarkTint.rgb, baseAlbedo, fissure * 0.72);
                half oxideMask = saturate((1.0 - rockLuma) * 0.58 + longNoise * 0.42)
                    * _Oxide;
                half3 oxidised = cutAlbedo * half3(1.14, 0.72, 0.46)
                    + half3(0.045, 0.010, 0.0);
                half3 albedo = lerp(cutAlbedo, oxidised, oxideMask * 0.52);
                albedo = lerp(albedo, albedo * 1.20 + half3(0.035, 0.028, 0.018),
                    _Dust * (0.28 + aggregate.r * 0.22));
                albedo *= lerp(0.76, 1.20, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.74;
                half3 direct = mainLight.color * (0.27 + diffuse * 0.73);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.16, 0.78,
                    fissure + longNoise * _Breakup * 0.34);
                half alpha = _Opacity * band * lerp(0.20, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
