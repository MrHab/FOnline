Shader "Universal Render Pipeline/Realm of Ashes/Global Map West Ocean"
{
    Properties
    {
        _DeepColor ("Deep water", Color) = (0.018, 0.105, 0.135, 1)
        _ShallowColor ("Shallow water", Color) = (0.105, 0.315, 0.330, 1)
        _FoamColor ("Coast foam", Color) = (0.72, 0.78, 0.65, 1)
        _WaveNormal ("Wave normal", 2D) = "bump" {}
        _WaveScale ("Wave scale", Float) = 0.055
        _WaveStrength ("Wave strength", Range(0, 1)) = 0.34
        _WaveSpeed ("Wave speed", Vector) = (0.018, 0.011, -0.012, 0.016)
        _Smoothness ("Smoothness", Range(0, 1)) = 0.78
        _FoamWidth ("Foam width", Range(0.01, 0.5)) = 0.16
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry-4"
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

            TEXTURE2D(_WaveNormal);
            SAMPLER(sampler_WaveNormal);

            CBUFFER_START(UnityPerMaterial)
                half4 _DeepColor;
                half4 _ShallowColor;
                half4 _FoamColor;
                float4 _WaveNormal_ST;
                float4 _WaveSpeed;
                float _WaveScale;
                float _WaveStrength;
                float _Smoothness;
                float _FoamWidth;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float2 uv : TEXCOORD1;
                half fogFactor : TEXCOORD2;
                float4 shadowCoord : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                output.shadowCoord = GetShadowCoord(positions);
                return output;
            }

            half3 DecodeWaveNormal(half4 packed)
            {
                half2 xy = packed.ag * 2.0h - 1.0h;
                return normalize(half3(xy.x, sqrt(saturate(1.0h - dot(xy, xy))), xy.y));
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 baseUv = input.positionWS.xz * max(0.001, _WaveScale);
                half3 waveA = DecodeWaveNormal(SAMPLE_TEXTURE2D(
                    _WaveNormal, sampler_WaveNormal,
                    baseUv + _Time.y * _WaveSpeed.xy));
                half3 waveB = DecodeWaveNormal(SAMPLE_TEXTURE2D(
                    _WaveNormal, sampler_WaveNormal,
                    baseUv * 1.63 + _Time.y * _WaveSpeed.zw));
                half3 normalWS = normalize(half3(
                    (waveA.x + waveB.x) * _WaveStrength,
                    1.0h,
                    (waveA.z + waveB.z) * _WaveStrength));

                Light mainLight = GetMainLight(input.shadowCoord);
                half ndl = saturate(dot(normalWS, mainLight.direction));
                half3 viewDirection = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                half3 halfDirection = SafeNormalize(mainLight.direction + viewDirection);
                half specular = pow(saturate(dot(normalWS, halfDirection)),
                    lerp(20.0h, 96.0h, _Smoothness));
                half fresnel = pow(1.0h - saturate(dot(normalWS, viewDirection)), 3.0h);

                half coast = smoothstep(0.50h, 1.0h, input.uv.x);
                half shoreLine = smoothstep(1.0h - max(0.01h, _FoamWidth), 1.0h,
                    input.uv.x);
                half foamNoise = saturate((waveA.x + waveB.z) * 0.55h + 0.5h);
                half foam = shoreLine * smoothstep(0.35h, 0.78h,
                    foamNoise + sin(input.positionWS.z * 1.35h + _Time.y * 0.8h) * 0.18h);

                half3 water = lerp(_DeepColor.rgb, _ShallowColor.rgb, coast);
                water *= lerp(0.56h, 1.0h, ndl * mainLight.shadowAttenuation);
                water += mainLight.color * (specular * 0.50h + fresnel * 0.16h);
                water = lerp(water, _FoamColor.rgb, foam * 0.72h);
                water = MixFog(water, input.fogFactor);
                return half4(water, 1.0h);
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
    }
}
