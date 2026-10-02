Shader "Realm of Ashes/Railway Ballast"
{
    Properties
    {
        [MainColor] _BaseColor ("Crushed stone colour", Color) = (0.48, 0.49, 0.47, 1)
        _StoneScale ("Stones per metre", Float) = 16
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "ForwardBallast"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _StoneScale;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half fog : TEXCOORD2;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs p = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = p.positionCS;
                output.positionWS = p.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.fog = ComputeFogFactor(p.positionCS.z);
                return output;
            }
            float2 Hash(float2 p)
            {
                return frac(sin(float2(dot(p, float2(127.1,311.7)),
                    dot(p,float2(269.5,183.3)))) * 43758.5453);
            }
            half4 Frag(Varyings input) : SV_Target
            {
                // Irregular angular cells: pale stone faces and dark voids between
                // them, at ballast size rather than the size of a ground texture.
                float2 p = input.positionWS.xz * _StoneScale;
                float2 cell = floor(p), local = frac(p);
                float nearest = 10, second = 10;
                float2 stone = 0;
                [unroll] for (int y = -1; y <= 1; y++)
                [unroll] for (int x = -1; x <= 1; x++)
                {
                    float2 neighbour = float2(x,y);
                    float2 seed = Hash(cell + neighbour);
                    float2 delta = neighbour + 0.15 + seed * 0.7 - local;
                    float d = dot(delta, delta);
                    if (d < nearest) { second = nearest; nearest = d; stone = seed; }
                    else second = min(second, d);
                }
                float detail = 1 - smoothstep(0.75, 2.5, max(fwidth(p.x), fwidth(p.y)));
                float face = smoothstep(0.012, 0.095, second - nearest);
                half shade = lerp(0.97, lerp(0.46, 0.78 + stone.x * 0.46, face), detail);
                half3 albedo = _BaseColor.rgb * shade;
                albedo *= lerp(0.93, 1.04, Hash(floor(input.positionWS.xz * 0.9)).x);
                half3 normal = normalize(input.normalWS + half3((stone.x - 0.5) * 0.36,
                    0, (stone.y - 0.5) * 0.36) * detail * face);
                InputData lighting = (InputData)0;
                lighting.positionWS = input.positionWS;
                lighting.normalWS = normal;
                lighting.viewDirectionWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                lighting.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                lighting.bakedGI = SampleSH(normal);
                lighting.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                lighting.shadowMask = half4(1,1,1,1);
                SurfaceData surface = (SurfaceData)0;
                surface.albedo = albedo;
                surface.alpha = 1;
                surface.smoothness = 0.06;
                surface.occlusion = lerp(1, lerp(0.6,1,face), detail);
                half4 color = UniversalFragmentPBR(lighting, surface);
                color.rgb = MixFog(color.rgb, input.fog);
                return color;
            }
            ENDHLSL
        }
    }
}
