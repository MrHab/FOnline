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
    'SPR_Apocalypse_MouseCursor_Crosshair_01.png',
    'ICON_SM_Wep_Pistol_01.png',
    'ICON_SM_Wep_AssaultRifle_01.png',
    'ICON_SM_Wep_CrossBow_01.png',
    'ICON_SM_Wep_ChainSaw_01.png',
    'ICON_SM_Wep_FireAxe_01.png',
    'ICON_SM_Wep_Hammer_01.png',
    'ICON_SM_Wep_Pistol_Revolver_01.png',
    'ICON_SM_Wep_Shotgun_01_Apoc.png',
    'ICON_SM_Wep_HuntingRifle_01.png',
    'ICON_SM_Wep_Shotgun_01_Farm.png',
    'ICON_SM_Wep_RocketLauncher_01_Apoc.png',
    'ICON_SM_Wep_Pickaxe_01.png',
    'ICON_SM_Wep_WoodAxe_01.png',
    'ICON_SM_Item_Bullet_Large_01.png',
    'ICON_SM_Prop_GasCan_01.png',
    'ICON_SM_Wep_Shotgun_Ammo_01.png',
    'ICON_SM_Wep_RPG_Rocket_Seperate_01.png',
    'ICON_SM_Item_HealthKit_01.png',
    'ICON_SM_Item_Drink_Bottle_02.png',
    'ICON_SM_Item_Battery_01.png',
    'ICON_SM_Item_Pills_01.png',
    'ICON_SM_Prop_Wood_Stack_01.png',
    'ICON_SM_Prop_Scav_Scrap_13.png',
    'ICON_SM_Item_Bottle_01.png',
    'ICON_SM_Item_Meat_Cooked_01.png',
    'ICON_SM_Prop_Money_Strapped_04.png',
    'ICON_SM_Chr_Attach_Backpack_01.png',
    'SPR_Apocalypse_Bar_MetalRusty_01.png',
    'SPR_Apocalypse_Bar_MetalRounded_01.png',
    'SPR_Apocalypse_Box_Background_01.png',
    'SPR_Apocalypse_Box_Metal_04.png',
    'SPR_Apocalypse_Dial_Background_01.png',
    'SPR_HUD_Apocalypse_Frame_Large_03_Clean.png',
    'SPR_HUD_Apocalypse_Bar_Horizontal_01.png',
    'SPR_HUD_Apocalypse_Box_Medium_02.png',
    'SPR_HUD_Apocalypse_Box_Small_02.png',
    'SPR_HUD_Apocalypse_Map_Player_01.png',
    'SairaCondensed-Regular.ttf',
    'Button_Apocalypse_HotBar_Item_01.prefab',
    'HUD_Apocalypse_HealthBar_01.prefab',
    'Button_Apocalypse_Simple.prefab',
    'Button_Apocalypse_ActionBar_Item_01.prefab',
    'Slider_Apocalypse_Horizontal.prefab',
    'HUD_Apocalypse_Hotbar_01.prefab',
    'HUD_Apocalypse_WeaponWheel_01.prefab',
    'HUD_Apocalypse_CurrentWeapon_01.prefab',
    'HUD_Apocalypse_HealthStats_01.prefab',
    'HUD_Apocalypse_StatsList_01.prefab',
    'HUD_Apocalypse_Minimap_Box_02.prefab',
    'HUD_Apocalypse_WorldSpace_EnemyInfo_01.prefab',
    'HUD_Apocalypse_Event_BossBar_01.prefab',
    'HUD_Apocalypse_WorldSpace_DamageToaster_01.prefab',
    'HUD_Apocalypse_Interact_ContextSensitive_01.prefab',
    'HUD_Apocalypse_ItemPickupInfo_01.prefab',
    'HUD_Apocalypse_Objective_01.prefab',
    'HUD_Apocalypse_Event_TimedAction_01.prefab',
    'HUD_Apocalypse_EventLog_01.prefab',
    'HUD_Apocalypse_Event_Tooltip_01.prefab',
    'HUD_Apocalypse_Comms_01.prefab',
    'HUD_Apocalypse_Event_Loading_01.prefab',
    'HUD_Apocalypse_Event_Saving_01.prefab',
    'Screen_HUD_Apocalypse_ARPG_01.prefab',
    'HUD_Apocalypse_WeaponWheel_03.prefab',
    'HUD_Apocalypse_HotBar_03.prefab',
    'HUD_Apocalypse_HealthStats_01.prefab',
    'HUD_Apocalypse_CurrentWeapon_02.prefab',
    'HUD_Apocalypse_Compass_03.prefab',
    'HUD_Apocalypse_Interact_ContextSensitive_03.prefab',
    'HUD_Apocalypse_Event_LevelUp_01.prefab',
    'HUD_Apocalypse_WorldSpace_NameEnemy_01.prefab',
    'HUD_Apocalypse_WorldSpace_NameAlly_01.prefab',
    'HUD_Apocalypse_WorldSpace_Objective_01.prefab',
    'HUD_Apocalypse_Objective_02.prefab',
    'HUD_Apocalypse_Subtitles_01.prefab',
    'HUD_Apocalypse_ChatLog_01.prefab',
    'AssetDemo_Apocalypse_Input_ControlSet_01.prefab',
    'Input_Apocalypse_Hotkey_01.prefab'
)

$textExtensions = @('.prefab', '.asset', '.mat', '.anim', '.controller')
$dependencyExtensions = @('.prefab', '.asset', '.mat', '.anim', '.controller', '.png', '.ttf')
$guidLine = [regex]::new('(?m)^guid: ([0-9a-f]{32})\r?$')
$guidRef = [regex]::new('guid: ([0-9a-f]{32})')
$sourceByName = @{}
$sourceByGuid = @{}
Get-ChildItem -LiteralPath $Source -Recurse -File | Where-Object Extension -NE '.meta' |
    ForEach-Object {
        if ($sourceByName.ContainsKey($_.Name)) { throw "Duplicate Synty asset name: $($_.Name)" }
        $sourceByName[$_.Name] = $_
        $metaPath = $_.FullName + '.meta'
        if (-not (Test-Path -LiteralPath $metaPath)) { return }
        $match = $guidLine.Match([IO.File]::ReadAllText($metaPath))
        if ($match.Success) { $sourceByGuid[$match.Groups[1].Value] = $_ }
    }

# Follow the source GUID references through the selected prefabs. A prefab copied
# without its font/material/sprite dependencies renders as empty UI in a clean
# Unity project, even though it looks fine beside the owner's original package.
$selected = @{}
$queue = [System.Collections.Generic.Queue[object]]::new()
foreach ($name in $names) {
    if (-not $sourceByName.ContainsKey($name)) { throw "Missing Synty asset: $name" }
    $queue.Enqueue($sourceByName[$name])
}
while ($queue.Count -gt 0) {
    $file = $queue.Dequeue()
    if ($selected.ContainsKey($file.Name)) { continue }
    $selected[$file.Name] = $file
    if ($file.Extension -notin $textExtensions) { continue }
    $content = [IO.File]::ReadAllText($file.FullName)
    foreach ($match in $guidRef.Matches($content)) {
        $dependency = $sourceByGuid[$match.Groups[1].Value]
        if ($null -ne $dependency -and $dependency.Extension -in $dependencyExtensions -and
            -not $selected.ContainsKey($dependency.Name)) {
            $queue.Enqueue($dependency)
        }
    }
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$remap = @{}
$installed = 0
foreach ($file in $selected.Values) {
    $sourceMeta = [IO.File]::ReadAllText($file.FullName + '.meta')
    $sourceGuid = $guidLine.Match($sourceMeta)
    if (-not $sourceGuid.Success) { throw "Invalid Unity metadata: $($file.Name).meta" }
    $target = Join-Path $destination $file.Name
    $targetMeta = $target + '.meta'
    $exists = Test-Path -LiteralPath $target
    $metaExists = Test-Path -LiteralPath $targetMeta
    if ($exists -xor $metaExists) { throw "Incomplete local installation: $($file.Name)" }
    $newGuid = if ($metaExists) {
        $existingGuid = $guidLine.Match([IO.File]::ReadAllText($targetMeta))
        if (-not $existingGuid.Success) { throw "Invalid Unity metadata: $targetMeta" }
        $existingGuid.Groups[1].Value
    } else {
        $installed++
        [guid]::NewGuid().ToString('N')
    }
    $remap[$sourceGuid.Groups[1].Value] = $newGuid
}

$replaceGuid = [System.Text.RegularExpressions.MatchEvaluator] {
    param($match)
    $original = $match.Groups[1].Value
    if ($remap.ContainsKey($original)) { return 'guid: ' + $remap[$original] }
    return $match.Value
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
foreach ($file in $selected.Values) {
    $target = Join-Path $destination $file.Name
    $meta = $guidRef.Replace([IO.File]::ReadAllText($file.FullName + '.meta'), $replaceGuid)
    [IO.File]::WriteAllText($target + '.meta', $meta, $utf8)
    if ($file.Extension -in $textExtensions) {
        $content = $guidRef.Replace([IO.File]::ReadAllText($file.FullName), $replaceGuid)
        [IO.File]::WriteAllText($target, $content, $utf8)
    } else {
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
}

$fontLicense = Get-ChildItem -LiteralPath $Source -Recurse -File -Filter 'OFL.txt' |
    Select-Object -First 1
if ($fontLicense -and -not (Test-Path -LiteralPath (Join-Path $destination 'OFL.txt'))) {
    Copy-Item -LiteralPath $fontLicense.FullName -Destination (Join-Path $destination 'OFL.txt')
}
Write-Host "Apocalypse HUD ready: $($selected.Count) linked assets, $installed new in $destination"
