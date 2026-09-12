param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [ValidateSet('rest', 'arms-bent')][string]$Pose = 'rest',
    [switch]$IncludeHands,
    [string]$RenderLog = ''
)

# Diagnostic contact sheets only; never modifies source captures or game assets.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$reviewLogs = Join-Path $ProjectRoot 'unity-client/Logs'
$catalog = Get-Content (Join-Path $reviewLogs 'UpperSuitCandidate/manifest.json') -Raw | ConvertFrom-Json
$capturePrefix = 'coverage-fit'
$poseSuffix = ''
if ($Pose -ne 'rest') { $poseSuffix += "-$Pose" }
if ($IncludeHands) { $poseSuffix += '-hands' }
$capturePrefix += $poseSuffix
$font = New-Object System.Drawing.Font('Arial', 11)
try {
    foreach ($suitId in @('hazmatSuit', 'energySuit')) {
        $rows = @($catalog.files | Where-Object itemId -eq $suitId)
        if ($rows.Count -ne 6) { throw "Full six-body catalog required for $suitId" }
        foreach ($view in @('front', 'back', 'left', 'right', 'underarm')) {
            $sheet = New-Object System.Drawing.Bitmap(1260, 900)
            $drawing = [System.Drawing.Graphics]::FromImage($sheet)
            try {
                $drawing.Clear([System.Drawing.Color]::FromArgb(45, 45, 45))
                $drawing.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                for ($index = 0; $index -lt $rows.Count; $index++) {
                    $row = $rows[$index]
                    $capture = Join-Path $reviewLogs "$capturePrefix-$suitId-$($row.bodyId)-$view.png"
                    $logFile = if ($RenderLog) { $RenderLog } else {
                        Join-Path $reviewLogs "collar-sector-render-$suitId-$($row.bodyId).log"
                    }
                    $report = Get-Content (Join-Path $reviewLogs "$capturePrefix-$suitId-$($row.bodyId).json") -Raw | ConvertFrom-Json
                    if ($report.suitSha256 -ne $row.sha256 -or $report.version -ne $catalog.version -or
                        $report.pose -ne $Pose -or [bool]$report.includesHands -ne [bool]$IncludeHands) {
                        throw "Capture report does not match the requested model/pose: $capture"
                    }
                    $expected = "FIT_RENDER $($catalog.version) $($row.sha256) $capture"
                    if (!(Select-String -LiteralPath $logFile -Pattern $expected -SimpleMatch -Quiet)) {
                        throw "Capture provenance is not current: $capture"
                    }
                    $source = [System.Drawing.Image]::FromFile($capture)
                    try {
                        $x = ($index % 3) * 420
                        $y = [math]::Floor($index / 3) * 450
                        $drawing.DrawImage($source, [int]$x, [int]$y, 420, 420)
                        $drawing.DrawString("$($row.bodyId) / $($row.sha256.Substring(0, 8))", $font,
                            [System.Drawing.Brushes]::White, [single]($x + 8), [single]($y + 426))
                    } finally { $source.Dispose() }
                }
                $output = Join-Path $reviewLogs "suit-sheet-$($catalog.version)$poseSuffix-$suitId-$view.png"
                $sheet.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
                Write-Output $output
            } finally { $drawing.Dispose(); $sheet.Dispose() }
        }
    }
} finally { $font.Dispose() }
