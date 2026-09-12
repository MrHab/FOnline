Shader "Realm of Ashes/Kromka Global Route"
{
    Properties
    {
        _MainTex ("Direct MEP Surface", 2D) = "white" {}
        _WearTex ("Direct MEP Wear Surface", 2D) = "gray" {}
        _Tint ("Surface Tint", Color) = (0.52, 0.42, 0.25, 1)
        _WearTint ("Wear Tint", Color) = (0.68, 0.62, 0.52, 1)
        _DetailTiling ("Detail Tiling", Range(0.1, 6)) = 1.8
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.34
        _MacroBlend ("Macro Blend", Range(0, 0.7)) = 0.28
        _Opacity ("Opacity", Range(0.2, 1)) = 0.86
        _EdgeFade ("Edge Fade", Range(0.05, 0.6)) = 0.24
        _WearTiling ("Wear Tiling", Range(0.1, 3)) = 1.0
        _WearStrength ("Wear Strength", Range(0, 1)) = 0.6
        _Ruts ("Wheel Ruts", Range(0, 1)) = 0.7
        _EdgeDust ("Edge Mineral Dust", Range(0, 1)) = 0.5
        _WetLowlands ("Lowland Grime", Range(0, 1)) = 0.3
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
        _Roughness ("Roughness", Range(0, 1)) = 0.88
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-40"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardRoute"
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
            TEXTURE2D(_WearTex); SAMPLER(sampler_WearTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _WearTint;
                float _DetailTiling;
                float _MacroTiling;
                float _MacroBlend;
                float _Opacity;
                float _EdgeFade;
                float _WearTiling;
                float _WearStrength;
                float _Ruts;
                float _EdgeDust;
                float _WetLowlands;
                float _Seed;
                float _Roughness;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fogFactor : TEXCOORD3;
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
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldUv = input.positionWS.xz;
                half3 detail = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(0.17, 0.43)).rgb;
                half3 macro = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(0.61, 0.29)).rgb;
                half broadWear = sin((worldUv.x + worldUv.y) * 0.31) * 0.5 + 0.5;
                half3 albedo = lerp(detail, macro, _MacroBlend) * _Tint.rgb * 1.62;
                albedo *= lerp(0.91, 1.07, broadWear);

                float2 wearUv = worldUv * _WearTiling
                    + float2(_Seed * 0.173, _Seed * 0.317);
                half3 wearFine = SAMPLE_TEXTURE2D(_WearTex, sampler_WearTex, wearUv).rgb;
                half3 wearMacro = SAMPLE_TEXTURE2D(_WearTex, sampler_WearTex,
                    float2(-wearUv.y, wearUv.x) * 0.23 + float2(0.37, 0.71)).rgb;
                half wearLuma = dot(wearFine, half3(0.299, 0.587, 0.114));
                half routeCross = saturate(input.uv.x);
                half longitudinal = sin(input.uv.y * 1.73 + _Seed * 2.11) * 0.5 + 0.5;
                half fineBreakup = smoothstep(0.22, 0.78,
                    wearLuma * 0.67 + longitudinal * 0.33);
                half centreWear = smoothstep(0.18, 0.92, routeCross)
                    * fineBreakup * _WearStrength;
                half rutBand = 1.0 - smoothstep(0.045, 0.19, abs(routeCross - 0.43));
                half wheelRuts = rutBand * lerp(0.48, 1.0, fineBreakup) * _Ruts;
                half edgeMineral = pow(saturate(1.0 - routeCross), 1.35)
                    * lerp(0.58, 1.0, fineBreakup) * _EdgeDust;
                half lowland = (1.0 - smoothstep(0.16, 0.78, input.positionWS.y))
                    * smoothstep(0.32, 0.72, 1.0 - wearLuma) * _WetLowlands;
                half wearMask = saturate(centreWear * 0.42 + wheelRuts * 0.82
                    + edgeMineral * 0.72 + lowland * 0.58);
                half3 wearAlbedo = lerp(wearFine, wearMacro, 0.38)
                    * _WearTint.rgb * 1.74;
                albedo = lerp(albedo, wearAlbedo, wearMask * 0.62);
                albedo *= 1.0 - wheelRuts * 0.11 - lowland * 0.08;

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.74;
                half3 direct = mainLight.color * (0.28 + diffuse * 0.72);
                half3 lit = albedo * (ambient + direct);
                lit = MixFog(lit, input.fogFactor);
                half edge = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half raggedEdge = lerp(0.76, 1.0, fineBreakup);
                half opacity = _Opacity * lerp(0.28, 1.0, edge) * raggedEdge;
                return half4(lit, opacity);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
