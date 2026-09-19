Shader "Realm of Ashes/Kromka Outer Nuclear Scorch"
{
    Properties
    {
        _MainTex ("MEP Scorched Stone", 2D) = "gray" {}
        _InnerTint ("Impact Bowl", Color) = (0.038, 0.028, 0.021, 1)
        _AshTint ("Scorched Ash", Color) = (0.18, 0.135, 0.095, 1)
        _RimTint ("Burnt Rim", Color) = (0.235, 0.092, 0.030, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.6
        _Opacity ("Opacity", Range(0.05, 1)) = 0.94
        _RimCentre ("Rim Centre", Range(0.2, 1.2)) = 0.82
        _RimWidth ("Rim Width", Range(0.05, 0.5)) = 0.22
        _AmbientFloor ("Strategic Ambient Floor", Range(0, 1)) = 0.58
        _Seed ("Pattern Seed", Range(0, 8)) = 5.43
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-42"
            "RenderPipeline"="UniversalPipeline"
        }

        Pass
        {
            Name "ForwardScorchedCrater"
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

            CBUFFER_START(UnityPerMaterial)
                float4 _InnerTint;
                float4 _AshTint;
                float4 _RimTint;
                float _DetailTiling;
                float _Opacity;
                float _RimCentre;
                float _RimWidth;
                float _AmbientFloor;
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
                float radius = max(0.0, input.uv.x);
                float2 worldUv = input.positionWS.xz * _DetailTiling
                    + float2(_Seed * 0.19, _Seed * 0.37);
                half3 stone = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv).rgb;
                half stoneLuma = dot(stone, half3(0.299, 0.587, 0.114));

                half bowlBlend = smoothstep(0.10, 0.69, radius);
                half3 albedo = lerp(_InnerTint.rgb, _AshTint.rgb, bowlBlend);
                half rim = 1.0 - smoothstep(0.0, _RimWidth,
                    abs(radius - _RimCentre));
                half fracturedRim = rim * lerp(0.44, 0.90, stoneLuma);
                albedo = lerp(albedo, _RimTint.rgb, fracturedRim * 0.72);
                albedo *= lerp(0.72, 1.22, stoneLuma);

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half lighting = _AmbientFloor + diffuse * (1.0 - _AmbientFloor);
                half3 lit = albedo * mainLight.color * lighting;
                lit = MixFog(lit, input.fogFactor);

                half alpha = saturate(_Opacity * input.color.a);
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
