# Builds the Livanta Android APKs end to end. Usage:
#   powershell -ExecutionPolicy Bypass -File .\build-android.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-android.ps1 -SkipWeb   # reuse last out/ build
#
# OneDrive Files-On-Demand breaks Gradle ("not a regular file" / undeletable dirs),
# so the script re-materializes cloud files first, then pauses OneDrive sync for the
# Gradle step and restarts it afterwards.
param(
  [switch]$SkipWeb
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Gradle stamps versionName/versionCode on the APK, so android/app/build.gradle
# is the source for both the artifact name and the release guard. package.json
# must carry the same versionName, and the version code must always move
# forward: the stores reject a reused one and users cannot install an upgrade
# over an equal code.
$releasedVersionName = "0.1.1"
$releasedVersionCode = 5

$gradlePath = Join-Path $root "android\app\build.gradle"
$gradleText = Get-Content $gradlePath -Raw
$versionCodeMatch = [regex]::Match($gradleText, 'versionCode\s+(\d+)')
$versionNameMatch = [regex]::Match($gradleText, 'versionName\s+"([^"]+)"')
if (-not $versionCodeMatch.Success -or -not $versionNameMatch.Success) {
  throw "Could not read versionCode/versionName from $gradlePath."
}
$androidVersionCode = [int]$versionCodeMatch.Groups[1].Value
$androidVersionName = $versionNameMatch.Groups[1].Value
$packageVersion = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if ($packageVersion -ne $androidVersionName) {
  throw "package.json is $packageVersion but android versionName is $androidVersionName. Update both together."
}
if ($androidVersionName -eq $releasedVersionName -and $androidVersionCode -ne $releasedVersionCode) {
  throw "$releasedVersionName shipped as versionCode $releasedVersionCode; found $androidVersionCode. Never reuse or lower a version code."
}
if ($androidVersionName -ne $releasedVersionName -and $androidVersionCode -le $releasedVersionCode) {
  throw "versionName $androidVersionName must use a versionCode above $releasedVersionCode; found $androidVersionCode."
}

$env:JAVA_HOME = "$env:LOCALAPPDATA\Android\tools\jdk-21.0.12.1+1"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  throw "JDK 21 not found at $env:JAVA_HOME. It was installed as a portable Temurin zip; restore it or update JAVA_HOME in this script."
}
if (-not (Test-Path "$env:ANDROID_HOME\platforms\android-36")) {
  throw "Android SDK platform 36 not found at $env:ANDROID_HOME. Run sdkmanager 'platforms/android-36' 'build-tools/36.0.0' 'platform-tools'."
}

function Test-GradleManagedDir([System.IO.DirectoryInfo]$d) {
  $p = $d
  while ($null -ne $p) {
    if ($p.Name -eq ".gradle") { return $true }
    if ($p.Name -eq "build") {
      $parent = $p.Parent
      if ($null -ne $parent) {
        foreach ($g in @("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts")) {
          if (Test-Path -LiteralPath (Join-Path $parent.FullName $g)) { return $true }
        }
      }
    }
    if ($p.FullName -eq $root) { return $false }
    $p = $p.Parent
  }
  return $false
}

$gradleNames = @("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts")
$dirVerdict = @{}

function Test-GradleRelevantDir([string]$dir) {
  if ($dirVerdict.ContainsKey($dir)) { return $dirVerdict[$dir] }
  $result = $false
  $rel = if ($dir.Length -gt $root.Length) { $dir.Substring($root.Length + 1) } else { "" }
  if ($rel -like "android\*" -or $rel -like "out\*") {
    $result = $true
  } else {
    $p = [System.IO.DirectoryInfo]$dir
    while ($null -ne $p) {
      foreach ($g in $gradleNames) {
        if (Test-Path -LiteralPath (Join-Path $p.FullName $g)) { $result = $true; break }
      }
      if ($result -or $p.FullName -eq $root) { break }
      $p = $p.Parent
    }
  }
  $dirVerdict[$dir] = $result
  return $result
}

function Repair-OneDrivePlaceholders {
  $stage = Join-Path $env:TEMP "livanta-hydrate"
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

  $dirList = @(Get-ChildItem $root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -and
      (Test-GradleManagedDir $_)
    } |
    Sort-Object { $_.FullName.Length } -Descending)
  $removedDirs = 0
  foreach ($d in $dirList) {
    try {
      Remove-Item $d.FullName -Recurse -Force -ErrorAction Stop
      $removedDirs++
    } catch {
      Write-Warning "could not remove cloud directory $($d.FullName): $($_.Exception.Message)"
    }
  }

  $list = @(Get-ChildItem $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -and
      (Test-GradleRelevantDir $_.DirectoryName)
    })
  $hydratedFiles = 0
  foreach ($f in $list) {
    $rel = $f.FullName.Substring($root.Length + 1)
    $tmp = Join-Path $stage $rel
    New-Item -ItemType Directory -Force (Split-Path $tmp) | Out-Null
    Copy-Item $f.FullName $tmp -Force
  }
  foreach ($f in $list) {
    $rel = $f.FullName.Substring($root.Length + 1)
    Copy-Item (Join-Path $stage $rel) $f.FullName -Force
    $hydratedFiles++
  }
  Write-Host "onedrive repair: removed $removedDirs cloud directories, re-materialized $hydratedFiles cloud files"
}

function Stop-OneDriveSync {
  $proc = Get-Process OneDrive -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { return $null }
  $exe = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue).ExecutablePath
  if (-not $exe -or -not (Test-Path $exe)) {
    $candidates = @((Join-Path $env:OneDrive "OneDrive.exe"), (Join-Path $env:USERPROFILE "OneDrive\OneDrive.exe"), (Join-Path $env:ProgramFiles "Microsoft OneDrive\OneDrive.exe"), (Join-Path ${env:ProgramFiles(x86)} "OneDrive\OneDrive.exe"))
    $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  Stop-Process -Id $proc.Id -Force
  Start-Sleep -Seconds 3
  if (-not $exe) { Write-Warning "stopped OneDrive but could not determine its exe path; start it manually if it does not come back" }
  return $exe
}

Push-Location $root
$oneDriveExe = $null
try {
  if (-not $SkipWeb) {
    Write-Host "==> next build"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "web build failed" }
  }

  Write-Host "==> cap sync android"
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

  Repair-OneDrivePlaceholders

  Write-Host "==> pausing OneDrive sync for gradle"
  $oneDriveExe = Stop-OneDriveSync

  try {
    Write-Host "==> gradle assembleRelease assembleDebug"
    Push-Location (Join-Path $root "android")
    try {
      .\gradlew.bat assembleRelease assembleDebug --console=plain
      if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
    } finally {
      Pop-Location
    }
  } finally {
    if ($oneDriveExe -and (Test-Path $oneDriveExe)) {
      Start-Process $oneDriveExe
      Write-Host "==> OneDrive sync resumed"
    }
  }

  Write-Host "==> Livanta $androidVersionName (versionCode $androidVersionCode)"
  $outDir = Join-Path $root "output\android"
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $release = "android\app\build\outputs\apk\release\app-release.apk"
  $debug = "android\app\build\outputs\apk\debug\app-debug.apk"
  $releaseTarget = Join-Path $outDir "livanta-$androidVersionName-release.apk"
  if (Test-Path $releaseTarget) {
    throw "$releaseTarget already exists. Bump versionName and versionCode before building another release; a published artifact is never overwritten."
  }
  Copy-Item $release $releaseTarget
  Copy-Item $debug (Join-Path $outDir "livanta-$androidVersionName-debug.apk") -Force

  Get-ChildItem $outDir -Filter "*.apk" | Sort-Object Name | ForEach-Object {
    $hash = Get-FileHash $_.FullName -Algorithm SHA256
    Write-Host ("{0}  {1:N0} bytes  sha256={2}" -f $_.FullName, $_.Length, $hash.Hash)
  }
  Write-Host "done"
} finally {
  Pop-Location
}
