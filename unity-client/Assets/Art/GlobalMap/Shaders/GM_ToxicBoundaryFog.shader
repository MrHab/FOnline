Shader "Universal Render Pipeline/Realm of Ashes/Global Map Toxic Boundary Fog"
{
    Properties
    {
        _ToxicColor ("Toxic fog", Color) = (0.055, 0.20, 0.025, 1)
        _DarkColor ("Dense shadow", Color) = (0.003, 0.018, 0.003, 1)
        _GlowColor ("Poison glow", Color) = (0.16, 0.32, 0.045, 1)
        _BoundaryColor ("Danger boundary", Color) = (0.30, 0.44, 0.05, 1)
        _Density ("Density", Range(0, 1)) = 0.96
        _NoiseScale ("Noise scale", Float) = 0.075
        _FlowSpeed ("Flow speed", Vector) = (0.035, 0.018, -0.026, 0.029)
        _PulseSpeed ("Pulse speed", Float) = 0.52
        _VerticalMotion ("Vertical motion", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent+20"
        }

        Pass
        {
            Name "ToxicBoundaryFog"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            Cull Off
            ZWrite Off
            ZTest LEqual

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ToxicColor;
                half4 _DarkColor;
                half4 _GlowColor;
                half4 _BoundaryColor;
                float4 _FlowSpeed;
                float _Density;
                float _NoiseScale;
                float _PulseSpeed;
                float _VerticalMotion;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                half4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half4 fogData : COLOR;
                half fogFactor : TEXCOORD1;
            };

            float FogPattern(float2 position, float phase)
            {
                float time = _Time.y;
                float2 uvA = position * max(0.001, _NoiseScale)
                    + _FlowSpeed.xy * time + phase;
                float2 uvB = position * max(0.001, _NoiseScale * 1.73)
                    + _FlowSpeed.zw * time - phase * 0.71;
                float broad = sin(uvA.x * 2.31 + sin(uvA.y * 1.47));
                float curled = cos(uvB.y * 2.67 - cos(uvB.x * 1.83));
                float veins = sin((uvA.x + uvB.y) * 3.19 + time * _PulseSpeed);
                return saturate(0.52 + broad * 0.22 + curled * 0.18 + veins * 0.10);
            }

            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 positionOS = input.positionOS.xyz;
                float3 seedPositionWS = TransformObjectToWorld(positionOS);
                float drift = sin(seedPositionWS.x * 0.071 + seedPositionWS.z * 0.043
                    + _Time.y * (0.34 + input.color.b * 0.16) + input.color.g * 6.28318);
                positionOS.y += drift * _VerticalMotion * (0.24 + input.color.b * 0.72);

                VertexPositionInputs positions = GetVertexPositionInputs(positionOS);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.fogData = input.color;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float outside = max(abs(input.positionWS.x), abs(input.positionWS.z)) - 45.0;
                half perimeter = smoothstep(-3.50h, 0.15h, outside)
                    * (1.0h - smoothstep(86.0h, 120.0h, outside));
                half boundary = smoothstep(4.5h, 6.0h, outside)
                    * (1.0h - smoothstep(9.0h, 11.5h, outside));
                float cloud = FogPattern(input.positionWS.xz, 0.0);
                float pulse = 0.94 + sin(_Time.y * _PulseSpeed
                    + input.positionWS.x * 0.045 + input.positionWS.z * 0.031) * 0.06;
                half cloudAlpha = smoothstep(0.18h, 0.88h, cloud);
                // The perimeter veil stays dense even in the darker noise pockets so the
                // authored ground/horizon texture join can never show through the fog.
                half alpha = saturate(perimeter
                    * (_Density * lerp(0.82h, 0.99h, cloudAlpha) * pulse + 0.26h)
                    + boundary * 0.04h);
                clip(alpha - 0.008h);

                half3 color = lerp(_DarkColor.rgb, _ToxicColor.rgb, cloud);
                half glow = smoothstep(0.74h, 0.97h, cloud) * 0.14h;
                color += _GlowColor.rgb * glow
                    + _BoundaryColor.rgb * boundary * (0.12h + cloud * 0.10h);
                float cameraDistance = distance(input.positionWS, GetCameraPositionWS());
                alpha *= smoothstep(2.0h, 8.0h, cameraDistance);
                alpha *= ComputeFogIntensity(input.fogFactor);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
