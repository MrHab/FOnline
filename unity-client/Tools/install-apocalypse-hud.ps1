param(
    [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Assets/Synty')
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $project 'Assets/Resources/ApocalypseHud'
if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Synty package not found at $Source. Import Apocalypse HUD into unity-client/Assets/Synty first."
}

# Keep the purchased source files outside Git. These are the sprites actually
# loaded by the client; their Unity import settings (including slice borders)
# are copied from the owner's local package.
$names = @(
    'ICON_Apocalpyse_Inventory_Backpack_01.png',
    'ICON_Apocalpyse_Inventory_Notes_01.png',
    'ICON_Apocalpyse_Inventory_Weapon_01.png',
    'ICON_Apocalpyse_Map_Message_01.png',
    'ICON_Apocalpyse_Map_Quest_01.png',
    'ICON_Apocalpyse_Map_Target_01.png',
    'ICON_Apocalpyse_Map_Unknown_01.png',
    'ICON_Apocalpyse_Map_Vehicle_01.png',
    'ICON_Input_PC_Arrow_Down_Clean.png',
    'ICON_Input_PC_Tab_Clean.png',
    'ICON_Input_Xbox_Button_Menu_Clean.png',
    'ICON_SM_Wep_CrossBow_Bolt_01.png',
    'ICON_SM_Wep_Pistol_Ammo_01.png',
    'SPR_Apocalypse_Bar_MetalRusty_01.png',
    'SPR_Apocalypse_Box_Background_01.png',
    'SPR_Apocalypse_Box_Metal_04.png',
    'SPR_Apocalypse_Dial_Background_01.png',
    'SPR_HUD_Apocalypse_Frame_Large_03_Clean.png',
    'SPR_HUD_Apocalypse_Map_Player_01.png',
    'SairaCondensed-Regular.ttf'
)

$wanted = @{}
foreach ($name in $names) { $wanted[$name] = $true }
$found = @{}
Get-ChildItem -LiteralPath $Source -Recurse -File | ForEach-Object {
    if (-not $wanted.ContainsKey($_.Name)) { return }
    if ($found.ContainsKey($_.Name)) { throw "Duplicate Synty asset name: $($_.Name)" }
    $found[$_.Name] = $_.FullName
}
foreach ($name in $names) {
    if (-not $found.ContainsKey($name)) { throw "Missing Synty asset: $name" }
    if (-not (Test-Path -LiteralPath ($found[$name] + '.meta'))) {
        throw "Missing Unity import settings: $name.meta"
    }
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$installed = 0
foreach ($name in $names) {
    $target = Join-Path $destination $name
    $targetMeta = $target + '.meta'
    $exists = Test-Path -LiteralPath $target
    $metaExists = Test-Path -LiteralPath $targetMeta
    if ($exists -and $metaExists) { continue }
    if ($exists -or $metaExists) { throw "Incomplete local installation: $name" }

    $meta = [IO.File]::ReadAllText($found[$name] + '.meta')
    $guidLine = [regex]::new('(?m)^guid: [0-9a-f]{32}\r?$')
    if (-not $guidLine.IsMatch($meta)) { throw "Invalid Unity metadata: $name.meta" }
    $guid = [guid]::NewGuid().ToString('N')
    $meta = $guidLine.Replace($meta, ('guid: ' + $guid), 1)
    Copy-Item -LiteralPath $found[$name] -Destination $target
    [IO.File]::WriteAllText($targetMeta, $meta)
    $installed++
}

$fontLicense = Get-ChildItem -LiteralPath $Source -Recurse -File -Filter 'OFL.txt' |
    Select-Object -First 1
if ($fontLicense -and -not (Test-Path -LiteralPath (Join-Path $destination 'OFL.txt'))) {
    Copy-Item -LiteralPath $fontLicense.FullName -Destination (Join-Path $destination 'OFL.txt')
}
Write-Host "Apocalypse HUD ready: $installed new assets in $destination"
