[CmdletBinding()]
param(
    [string]$UnityExe = 'D:\Games\6000.5.8f1\Editor\Unity.exe',
    [string]$OutputDirectory = '',
    [string]$ProductName = 'RealmOfAshes',
    [string]$MirrorBase = [Environment]::GetFolderPath('CommonDocuments'),
    [switch]$KeepMirror
)

$ErrorActionPreference = 'Stop'

function Invoke-UnityBatch {
    param(
        [string[]]$Arguments,
        [string]$Phase
    )

    $process = Start-Process -FilePath $UnityExe -ArgumentList $Arguments `
        -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "Unity $Phase failed with exit code $($process.ExitCode)."
    }
}

function Assert-CleanUnityLog {
    param(
        [string]$Path,
        [string]$Phase
    )

    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Unity $Phase did not create its log: $Path"
    }

    $diagnostics = @(Select-String -LiteralPath $Path -Pattern @(
        'Unable to parse',
        'Script attached to .* is missing',
        'error CS[0-9]+',
        'Fatal Error',
        'Aborting batchmode'
    ))
    if ($diagnostics.Count -gt 0) {
        $details = ($diagnostics | ForEach-Object Line) -join [Environment]::NewLine
        throw "Unity $Phase reported invalid project state:$([Environment]::NewLine)$details"
    }
}

if (!(Test-Path -LiteralPath $UnityExe -PathType Leaf)) {
    throw "Unity editor not found: $UnityExe"
}
if ([string]::IsNullOrWhiteSpace($MirrorBase)) {
    throw 'MirrorBase is empty.'
}
if ($MirrorBase -match '[^\x00-\x7F]') {
    throw "MirrorBase must contain ASCII characters only: $MirrorBase"
}
if ($ProductName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
    throw "ProductName contains invalid filename characters: $ProductName"
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$mirrorParent = [IO.Path]::GetFullPath((Join-Path $MirrorBase 'RoaUnityBuild'))
$mirrorRoot = [IO.Path]::GetFullPath((Join-Path $mirrorParent ('run-' + [Guid]::NewGuid().ToString('N'))))
$mirrorProject = Join-Path $mirrorRoot 'Project'
$mirrorBuild = Join-Path $mirrorRoot 'Player'
$importLog = Join-Path $mirrorRoot 'import.log'
$buildLog = Join-Path $mirrorRoot 'build.log'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $projectRoot ("Build\Windows-$stamp")
}
$outputFullPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputFullPath) {
    throw "Output directory already exists: $outputFullPath"
}

try {
    New-Item -ItemType Directory -Path $mirrorProject -Force | Out-Null
    & robocopy $projectRoot $mirrorProject /E /XD Library Temp Logs obj Build /NFL /NDL /NJH /NJS /NP | Out-Null
    $copyExit = $LASTEXITCODE
    if ($copyExit -gt 7) {
        throw "Failed to create ASCII Unity mirror (robocopy exit code $copyExit)."
    }

    Invoke-UnityBatch -Phase 'import' -Arguments @(
        '-batchmode', '-nographics', '-projectPath', $mirrorProject,
        '-logFile', $importLog, '-quit'
    )
    Assert-CleanUnityLog -Path $importLog -Phase 'import'

    $playerExe = Join-Path $mirrorBuild ($ProductName + '.exe')
    Invoke-UnityBatch -Phase 'Windows build' -Arguments @(
        '-batchmode', '-nographics', '-projectPath', $mirrorProject,
        '-buildWindows64Player', $playerExe, '-logFile', $buildLog, '-quit'
    )
    Assert-CleanUnityLog -Path $buildLog -Phase 'Windows build'
    if (!(Select-String -LiteralPath $buildLog -Pattern 'Build Finished, Result: Success\.' -Quiet)) {
        throw 'Unity did not report a successful Windows build.'
    }
    if (!(Test-Path -LiteralPath $playerExe -PathType Leaf)) {
        throw "Windows player executable is missing: $playerExe"
    }

    New-Item -ItemType Directory -Path $outputFullPath | Out-Null
    Copy-Item -Path (Join-Path $mirrorBuild '*') -Destination $outputFullPath -Recurse -Force
    Write-Output "Windows player built successfully: $outputFullPath"
}
finally {
    if (!$KeepMirror -and (Test-Path -LiteralPath $mirrorRoot)) {
        $expectedPrefix = $mirrorParent.TrimEnd('\') + '\'
        $leaf = Split-Path -Leaf $mirrorRoot
        $insideExpectedRoot = $mirrorRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
        if ($insideExpectedRoot -and $leaf -like 'run-*') {
            Remove-Item -LiteralPath $mirrorRoot -Recurse -Force
        }
        else {
            Write-Warning "Refusing to remove unexpected mirror path: $mirrorRoot"
        }
    }
}
