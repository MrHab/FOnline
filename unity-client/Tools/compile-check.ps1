param(
    [string]$UnityData = 'D:\Games\6000.5.8f1\Editor\Data'
)

$ErrorActionPreference = 'Stop'

$client = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$csc = Join-Path $UnityData 'DotNetSdk\sdk\8.0.318\Roslyn\bincore\csc.dll'
$dotnet = Join-Path $UnityData 'NetCoreRuntime\dotnet.exe'
$netstandard = Join-Path $UnityData 'NetStandard\ref\2.1.0\netstandard.dll'

foreach ($required in @($csc, $dotnet, $netstandard)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing: $required. Pass -UnityData when Unity is installed elsewhere."
    }
}

$scriptAssemblies = Join-Path $client 'Library\ScriptAssemblies'
if (-not (Test-Path -LiteralPath $scriptAssemblies)) {
    throw 'Library\ScriptAssemblies is missing. Open the project in Unity once.'
}

$tempBase = [System.IO.Path]::GetTempPath()
$work = Join-Path $tempBase ('roa-unity-compile-' + [Guid]::NewGuid().ToString('N'))
$resolvedWork = [System.IO.Path]::GetFullPath($work)
$resolvedTemp = [System.IO.Path]::GetFullPath($tempBase)
if (-not $resolvedWork.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe temporary path: $resolvedWork"
}

New-Item -ItemType Directory -Path $resolvedWork | Out-Null

try {
    $references = [System.Collections.Generic.List[string]]::new()
    $references.Add('-r:"' + $netstandard + '"')

    $referencePatterns = @(
        (Join-Path $UnityData 'NetStandard\compat\2.1.0\shims\netstandard\*.dll'),
        (Join-Path $UnityData 'NetStandard\compat\2.1.0\shims\unity\*.dll'),
        (Join-Path $UnityData 'Managed\UnityEngine\UnityEngine*.dll'),
        (Join-Path $UnityData 'Managed\UnityEngine\UnityEditor*.dll'),
        (Join-Path $client 'Library\PackageCache\com.unity.nuget.newtonsoft-json@*\Runtime\Newtonsoft.Json.dll'),
        (Join-Path $scriptAssemblies 'glTFast*.dll'),
        (Join-Path $scriptAssemblies 'Unity.RenderPipelines*.dll')
    )

    foreach ($pattern in $referencePatterns) {
        foreach ($file in Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue) {
            $references.Add('-r:"' + $file.FullName + '"')
        }
    }

    $uguiRoot = Join-Path $UnityData 'Resources\PackageManager\ProjectTemplates'
    $uguiReference = Get-ChildItem -LiteralPath $uguiRoot -Recurse -File -Filter 'UnityEngine.UI.dll' |
        Select-Object -First 1
    if ($null -eq $uguiReference) { throw 'UnityEngine.UI.dll is missing from the Unity installation.' }
    $references.Add('-r:"' + $uguiReference.FullName + '"')

    $sources = @(Get-ChildItem -LiteralPath (Join-Path $client 'Assets\Scripts'), (Join-Path $client 'Assets\Editor') `
        -Recurse -File -Filter '*.cs' | Sort-Object FullName | ForEach-Object { '"' + $_.FullName + '"' })

    $refsPath = Join-Path $resolvedWork 'refs.rsp'
    $sourcesPath = Join-Path $resolvedWork 'sources.rsp'
    [System.IO.File]::WriteAllLines($refsPath, $references, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllLines($sourcesPath, $sources, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Compiling $($sources.Count) files..."
    $outputAssembly = Join-Path $resolvedWork 'RoaCompileCheck.dll'
    & $dotnet $csc -nologo -target:library -langversion:9 -nostdlib+ -noconfig `
        -nowarn:1701 ("-out:" + $outputAssembly) `
        "@$refsPath" "@$sourcesPath"
    if ($LASTEXITCODE -ne 0) { throw "Compiler exited with code $LASTEXITCODE." }

    Write-Host 'Compilation completed without errors or warnings.'
}
finally {
    if ([System.IO.Directory]::Exists($resolvedWork)) {
        [System.IO.Directory]::Delete($resolvedWork, $true)
    }
}
