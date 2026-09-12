Shader "Realm of Ashes/Kromka Global Water"
{
    Properties
    {
        _NormalMap ("MEP Water Normal", 2D) = "bump" {}
        _ShallowColor ("Shallow Color", Color) = (0.08, 0.42, 0.46, 0.88)
        _DeepColor ("Deep Color", Color) = (0.018, 0.12, 0.16, 0.92)
        _FoamColor ("Mineral Edge Color", Color) = (0.30, 0.58, 0.57, 1)
        _Opacity ("Opacity", Range(0.35, 1)) = 0.88
        _NormalScale ("Normal Strength", Range(0, 2)) = 0.55
        _NormalTiling ("Strategic Ripple Tiling", Range(0.05, 2)) = 0.48
        _FlowSpeed ("Flow Speed", Range(0, 0.12)) = 0.016
        _Smoothness ("Smoothness", Range(0, 1)) = 0.84
        _FresnelPower ("Fresnel Power", Range(1, 8)) = 4.2
        _MineralVeil ("Mineral Veil", Range(0, 0.5)) = 0.10
        _ToxicPulse ("Toxic Pulse", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-20"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardWater"
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

            TEXTURE2D(_NormalMap); SAMPLER(sampler_NormalMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _ShallowColor;
                float4 _DeepColor;
                float4 _FoamColor;
                float _Opacity;
                float _NormalScale;
                float _NormalTiling;
                float _FlowSpeed;
                float _Smoothness;
                float _FresnelPower;
                float _MineralVeil;
                float _ToxicPulse;
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
                float2 uv : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldUv = input.positionWS.xz * _NormalTiling;
                float2 flow = _Time.y * float2(_FlowSpeed, _FlowSpeed * 0.63);
                half3 rippleA = UnpackNormalScale(SAMPLE_TEXTURE2D(
                    _NormalMap, sampler_NormalMap, worldUv + flow), _NormalScale);
                float2 crossUv = float2(-worldUv.y, worldUv.x) * 0.73
                    + float2(0.37, 0.61) - flow * 0.71;
                half3 rippleB = UnpackNormalScale(SAMPLE_TEXTURE2D(
                    _NormalMap, sampler_NormalMap, crossUv), _NormalScale * 0.62);
                half3 normalWS = normalize(half3(
                    rippleA.x + rippleB.x * 0.55,
                    1.75,
                    rippleA.y + rippleB.y * 0.55));

                half3 viewDirection = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                half fresnel = pow(1.0 - saturate(dot(normalWS, viewDirection)),
                    _FresnelPower);
                half rippleTone = saturate(0.48 + rippleA.x * 0.18 + rippleB.y * 0.14);
                half3 water = lerp(_DeepColor.rgb, _ShallowColor.rgb,
                    rippleTone * 0.52 + fresnel * 0.24);
                half broadRiffle = sin((input.positionWS.x + input.positionWS.z) * 0.73
                    + _Time.y * _FlowSpeed * 5.0) * 0.5 + 0.5;
                broadRiffle *= sin((input.positionWS.x - input.positionWS.z) * 0.41
                    - _Time.y * _FlowSpeed * 3.0) * 0.5 + 0.5;
                water *= lerp(0.89, 1.08, broadRiffle);

                Light mainLight = GetMainLight();
                half3 reflected = reflect(-mainLight.direction, normalWS);
                half specular = pow(saturate(dot(reflected, viewDirection)),
                    lerp(22.0, 96.0, _Smoothness));
                half shore = pow(1.0 - saturate(input.uv.x), 2.4);
                half mineral = saturate(abs(rippleA.x - rippleB.y) * 0.65
                    + fresnel * 0.22 + shore * 0.72) * _MineralVeil;
                half toxicPulse = (sin(_Time.y * 0.42
                    + input.positionWS.x * 0.29 + input.positionWS.z * 0.23)
                    * 0.5 + 0.5) * _ToxicPulse;
                water = lerp(water, _FoamColor.rgb, mineral + toxicPulse * 0.10);
                water += mainLight.color * specular * (0.10 + _Smoothness * 0.34);
                water = MixFog(water, input.fogFactor);
                half shorePresence = smoothstep(0.0, 0.46, input.uv.x);
                half alpha = saturate(_Opacity + fresnel * 0.08
                    + toxicPulse * 0.035) * lerp(0.48, 1.0, shorePresence);
                return half4(water, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
