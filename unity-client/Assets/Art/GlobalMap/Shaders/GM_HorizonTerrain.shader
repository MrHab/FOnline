Shader "Universal Render Pipeline/Realm of Ashes/Global Map Horizon"
{
    Properties
    {
        _DesertMap ("Desert", 2D) = "white" {}
        _RockyMap ("Rocky", 2D) = "white" {}
        _SaltMap ("Salt", 2D) = "white" {}
        _Tint ("Horizon tint", Color) = (0.78, 0.70, 0.56, 1)
        _WorldTiling ("World tiling", Float) = 0.10
        _Roughness ("Roughness", Range(0, 1)) = 0.84
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry-5"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_DesertMap);
            SAMPLER(sampler_DesertMap);
            TEXTURE2D(_RockyMap);
            SAMPLER(sampler_RockyMap);
            TEXTURE2D(_SaltMap);
            SAMPLER(sampler_SaltMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _DesertMap_ST;
                float4 _RockyMap_ST;
                float4 _SaltMap_ST;
                half4 _Tint;
                float _WorldTiling;
                float _Roughness;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                half4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half4 weights : COLOR;
                half fogFactor : TEXCOORD2;
                float4 shadowCoord : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.weights = input.color;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                output.shadowCoord = GetShadowCoord(positions);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 uv = input.positionWS.xz * max(0.001, _WorldTiling);
                half3 weights = max(input.weights.rgb, half3(0.001h, 0.001h, 0.001h));
                weights /= weights.x + weights.y + weights.z;
                half3 desert = SAMPLE_TEXTURE2D(_DesertMap, sampler_DesertMap, uv).rgb;
                half3 rocky = SAMPLE_TEXTURE2D(_RockyMap, sampler_RockyMap, uv * 0.91 + 0.17).rgb;
                half3 salt = SAMPLE_TEXTURE2D(_SaltMap, sampler_SaltMap, uv * 1.13 + 0.31).rgb;
                half3 albedo = (desert * weights.x + rocky * weights.y + salt * weights.z)
                    * _Tint.rgb;

                Light mainLight = GetMainLight(input.shadowCoord);
                half3 normalWS = normalize(input.normalWS);
                half ndl = saturate(dot(normalWS, mainLight.direction));
                half shadow = mainLight.distanceAttenuation * mainLight.shadowAttenuation;
                half3 lighting = SampleSH(normalWS) + mainLight.color * ndl * shadow;
                half3 color = albedo * max(lighting, half3(0.22h, 0.22h, 0.22h));
                color = MixFog(color, input.fogFactor);
                return half4(color, 1.0h);
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
    }
}
