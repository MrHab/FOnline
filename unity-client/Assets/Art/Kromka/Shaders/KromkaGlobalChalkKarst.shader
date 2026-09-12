Shader "Realm of Ashes/Kromka Global Chalk Karst"
{
    Properties
    {
        _MainTex ("Direct MEP Chalk Surface", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Limestone Surface", 2D) = "gray" {}
        _Tint ("Mineral Tint", Color) = (0.86, 0.82, 0.68, 1)
        _DarkTint ("Erosion Tint", Color) = (0.24, 0.21, 0.16, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.4
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.40
        _Opacity ("Opacity", Range(0.05, 1)) = 0.58
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.30
        _MineralStrength ("Mineral Bloom", Range(0, 1)) = 0.76
        _Erosion ("Karst Erosion", Range(0, 1)) = 0.42
        _Dust ("Chalk Dust", Range(0, 1)) = 0.66
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-43"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardChalkKarst"
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
                float _MineralStrength;
                float _Erosion;
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
                half3 chalk = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.13, _Seed * 0.27)).rgb;
                half3 limestone = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.19, _Seed * 0.07)).rgb;
                half chalkLuma = dot(chalk, half3(0.299, 0.587, 0.114));
                half stoneLuma = dot(limestone, half3(0.299, 0.587, 0.114));
                half washNoise = sin(input.uv.y * 3.79 + _Seed * 1.91) * 0.5 + 0.5;
                half mineral = smoothstep(0.22, 0.78,
                    chalkLuma * 0.52 + stoneLuma * 0.28 + washNoise * 0.20);
                half3 pale = lerp(limestone, chalk, 0.58) * _Tint.rgb * 1.68;
                pale = lerp(pale, pale * 1.18 + half3(0.05, 0.045, 0.030),
                    mineral * _MineralStrength * _Dust);
                half erosionMask = saturate((1.0 - stoneLuma) * 0.62
                    + (1.0 - washNoise) * 0.38) * _Erosion;
                half3 albedo = lerp(pale, _DarkTint.rgb * (0.78 + limestone * 0.30),
                    erosionMask);
                albedo *= lerp(0.78, 1.16, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.74;
                half3 direct = mainLight.color * (0.28 + diffuse * 0.72);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.14, 0.82,
                    mineral + washNoise * (0.18 + _Dust * 0.22));
                half alpha = _Opacity * band * lerp(0.25, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
