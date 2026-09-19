Shader "Universal Render Pipeline/Realm of Ashes/Global Map Toxic Boundary Fog"
{
    Properties
    {
        _ToxicColor ("Toxic fog", Color) = (0.10, 0.33, 0.025, 1)
        _DarkColor ("Dense shadow", Color) = (0.002, 0.018, 0.002, 1)
        _GlowColor ("Poison glow", Color) = (0.33, 0.62, 0.05, 1)
        _BoundaryColor ("Danger boundary", Color) = (0.47, 0.68, 0.06, 1)
        _Density ("Density", Range(0, 1)) = 0.78
        _NoiseScale ("Noise scale", Float) = 0.082
        _FlowSpeed ("Flow speed", Vector) = (0.035, 0.018, -0.026, 0.029)
        _PulseSpeed ("Pulse speed", Float) = 0.52
        _VerticalMotion ("Vertical motion", Range(0, 1)) = 0.16
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
                float2 uv : TEXCOORD0;
                float2 billboardSize : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half4 fogData : COLOR;
                float2 uv : TEXCOORD1;
                half fogFactor : TEXCOORD2;
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
                float3 centerWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 positionWS = centerWS;
                if (input.color.b > 0.5h)
                {
                    float3 toCamera = normalize(GetCameraPositionWS() - centerWS);
                    float3 cameraRight = cross(float3(0.0, 1.0, 0.0), toCamera);
                    float rightLength = length(cameraRight);
                    cameraRight = rightLength > 0.001
                        ? cameraRight / rightLength : float3(1.0, 0.0, 0.0);
                    float2 corner = input.uv * 2.0 - 1.0;
                    float drift = sin(centerWS.x * 0.071 + centerWS.z * 0.043
                        + _Time.y * 0.42 + input.color.g * 6.28318);
                    positionWS += cameraRight * corner.x * input.billboardSize.x
                        + float3(0.0, corner.y * input.billboardSize.y, 0.0);
                    positionWS.y += drift * _VerticalMotion;
                }

                output.positionCS = TransformWorldToHClip(positionWS);
                output.positionWS = positionWS;
                output.fogData = input.color;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float outside = max(abs(input.positionWS.x), abs(input.positionWS.z)) - 45.0;
                half farFade = 1.0h - smoothstep(76.0h, 116.0h, outside);
                float cloud = FogPattern(input.positionWS.xz, input.fogData.g * 1.7);
                float pulse = 0.94 + sin(_Time.y * _PulseSpeed
                    + input.positionWS.x * 0.045 + input.positionWS.z * 0.031) * 0.06;
                half cloudAlpha = smoothstep(0.22h, 0.86h, cloud);
                half billboard = step(0.5h, input.fogData.b);

                half alpha;
                half boundary;
                if (billboard > 0.5h)
                {
                    float2 local = input.uv * 2.0 - 1.0;
                    float2 leftLocal = local - float2(-0.38, -0.12);
                    float2 rightLocal = local - float2(0.38, -0.10);
                    float2 crownLocal = local - float2(0.02, 0.26);
                    float2 skirtLocal = local - float2(0.0, -0.34);
                    half leftLobe = 1.0h - smoothstep(0.38h, 0.86h,
                        length(float2(leftLocal.x * 1.18, leftLocal.y)));
                    half rightLobe = 1.0h - smoothstep(0.36h, 0.84h,
                        length(float2(rightLocal.x * 1.14, rightLocal.y)));
                    half crownLobe = 1.0h - smoothstep(0.32h, 0.78h,
                        length(float2(crownLocal.x * 1.28, crownLocal.y)));
                    half skirtLobe = 1.0h - smoothstep(0.42h, 0.96h,
                        length(float2(skirtLocal.x * 0.82, skirtLocal.y * 1.45)));
                    half softShape = max(max(leftLobe, rightLobe),
                        max(crownLobe, skirtLobe));
                    float curl = (cloud - 0.5) * 0.24
                        + sin(local.x * 5.1 + local.y * 3.7
                            + input.fogData.g * 6.28318) * 0.035;
                    softShape = saturate(softShape + curl);
                    half grounded = smoothstep(-1.0h, -0.72h, local.y);
                    alpha = softShape * grounded * input.fogData.r * _Density
                        * lerp(0.62h, 0.96h, cloudAlpha) * pulse * farFade;
                    boundary = smoothstep(0.62h, 0.84h, softShape)
                        * (1.0h - smoothstep(0.86h, 1.0h, softShape));
                }
                else
                {
                    float edgeWarp = (cloud - 0.5) * 5.2
                        + sin(input.positionWS.x * 0.083 + input.positionWS.z * 0.057) * 0.85;
                    float scallopedOutside = outside + edgeWarp;
                    half body = smoothstep(-2.8h, 1.1h, scallopedOutside) * farFade;
                    half seamCover = 1.0h - smoothstep(0.25h, 4.2h,
                        abs(outside + edgeWarp * 0.42));
                    half brokenVeil = body * _Density * lerp(0.16h, 0.50h, cloudAlpha) * pulse;
                    alpha = max(seamCover * 0.66h, brokenVeil);
                    boundary = smoothstep(2.0h, 6.5h, scallopedOutside)
                        * (1.0h - smoothstep(10.0h, 16.0h, scallopedOutside));
                }
                clip(alpha - 0.012h);

                half3 color = lerp(_DarkColor.rgb, _ToxicColor.rgb,
                    saturate(0.22h + cloud * 0.78h));
                half glow = smoothstep(0.68h, 0.94h, cloud) * lerp(0.10h, 0.30h, billboard);
                color += _GlowColor.rgb * glow
                    + _BoundaryColor.rgb * boundary * (0.06h + cloud * 0.08h);
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
