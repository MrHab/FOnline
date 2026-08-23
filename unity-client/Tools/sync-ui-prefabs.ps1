[CmdletBinding()]
param(
    [string]$UnityExe = 'D:\Games\6000.5.8f1\Editor\Unity.exe',
    [string]$MirrorBase = [Environment]::GetFolderPath('CommonDocuments'),
    [switch]$KeepMirror
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path -LiteralPath $UnityExe -PathType Leaf)) {
    throw "Unity editor not found: $UnityExe"
}
if ([string]::IsNullOrWhiteSpace($MirrorBase) -or $MirrorBase -match '[^\x00-\x7F]') {
    throw "MirrorBase must be a non-empty ASCII path: $MirrorBase"
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$mirrorParent = [IO.Path]::GetFullPath((Join-Path $MirrorBase 'RoaUnityUiSync'))
$mirrorRoot = [IO.Path]::GetFullPath((Join-Path $mirrorParent ('run-' + [Guid]::NewGuid().ToString('N'))))
$mirrorProject = Join-Path $mirrorRoot 'Project'
$logPath = Join-Path $mirrorRoot 'ui-prefabs.log'

try {
    New-Item -ItemType Directory -Path $mirrorProject -Force | Out-Null
    & robocopy $projectRoot $mirrorProject /E /XD Library Temp Logs obj Build /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to create ASCII Unity mirror (robocopy exit code $LASTEXITCODE)."
    }

    $arguments = @(
        '-batchmode', '-nographics', '-projectPath', $mirrorProject,
        '-executeMethod', 'RealmOfAshes.EditorTools.RoaUiPrefabGenerator.Build',
        '-logFile', $logPath, '-quit'
    )
    $process = Start-Process -FilePath $UnityExe -ArgumentList $arguments `
        -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "Unity UI Prefab generation failed with exit code $($process.ExitCode). See $logPath"
    }

    $generated = Join-Path $mirrorProject 'Assets\Resources\RealmUi\Prefabs'
    if (!(Test-Path -LiteralPath (Join-Path $generated 'RoaUiRoot.prefab') -PathType Leaf)) {
        throw "Unity did not generate RoaUiRoot.prefab. See $logPath"
    }
    if (!(Select-String -LiteralPath $logPath -Pattern '\[ROA UI PREFABS\]' -Quiet)) {
        throw "Unity did not report a successful UI Prefab generation. See $logPath"
    }

    $targetRealmUi = Join-Path $projectRoot 'Assets\Resources\RealmUi'
    Copy-Item -LiteralPath $generated -Destination $targetRealmUi -Recurse -Force
    Copy-Item -LiteralPath ($generated + '.meta') -Destination $targetRealmUi -Force

    $generatedMobile = Join-Path $mirrorProject 'Assets\Resources\RealmUi\mobile'
    if (Test-Path -LiteralPath $generatedMobile -PathType Container) {
        Copy-Item -LiteralPath $generatedMobile -Destination $targetRealmUi -Recurse -Force
        Copy-Item -LiteralPath ($generatedMobile + '.meta') -Destination $targetRealmUi -Force
    }

    Write-Output "Unity UI Prefabs synchronized: $targetRealmUi"
}
finally {
    if (!$KeepMirror -and (Test-Path -LiteralPath $mirrorRoot)) {
        $separator = [IO.Path]::DirectorySeparatorChar
        $expectedPrefix = $mirrorParent.TrimEnd($separator) + $separator
        $leaf = Split-Path -Leaf $mirrorRoot
        $insideExpectedRoot = $mirrorRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
        if ($insideExpectedRoot -and $leaf -like "run-*") {
            Remove-Item -LiteralPath $mirrorRoot -Recurse -Force
        }
        else {
            Write-Warning "Refusing to remove unexpected mirror path: $mirrorRoot"
        }
    }
}
