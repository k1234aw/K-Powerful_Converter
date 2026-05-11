param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [Parameter(Mandatory = $true)]
  [string]$IconPath
)

$source = @"
using System;
using System.Runtime.InteropServices;

public static class ResourceWriter
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
}
"@

Add-Type -TypeDefinition $source

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "EXE not found: $ExePath"
}

if (-not (Test-Path -LiteralPath $IconPath)) {
  throw "Icon not found: $IconPath"
}

$iconBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $IconPath))
$reserved = [BitConverter]::ToUInt16($iconBytes, 0)
$type = [BitConverter]::ToUInt16($iconBytes, 2)
$count = [BitConverter]::ToUInt16($iconBytes, 4)

if ($reserved -ne 0 -or $type -ne 1 -or $count -lt 1) {
  throw "Invalid ICO file: $IconPath"
}

$group = New-Object System.Collections.Generic.List[byte]
$group.AddRange([BitConverter]::GetBytes([UInt16]0))
$group.AddRange([BitConverter]::GetBytes([UInt16]1))
$group.AddRange([BitConverter]::GetBytes([UInt16]$count))

$images = @()
for ($i = 0; $i -lt $count; $i++) {
  $entry = 6 + ($i * 16)
  $width = $iconBytes[$entry]
  $height = $iconBytes[$entry + 1]
  $colorCount = $iconBytes[$entry + 2]
  $planes = [BitConverter]::ToUInt16($iconBytes, $entry + 4)
  $bitCount = [BitConverter]::ToUInt16($iconBytes, $entry + 6)
  $bytesInRes = [BitConverter]::ToUInt32($iconBytes, $entry + 8)
  $imageOffset = [BitConverter]::ToUInt32($iconBytes, $entry + 12)
  $resourceId = [UInt16]($i + 1)

  $image = New-Object byte[] $bytesInRes
  [Array]::Copy($iconBytes, [int]$imageOffset, $image, 0, [int]$bytesInRes)
  $images += @{ Id = $resourceId; Bytes = $image }

  $group.Add($width)
  $group.Add($height)
  $group.Add($colorCount)
  $group.Add(0)
  $group.AddRange([BitConverter]::GetBytes([UInt16]$planes))
  $group.AddRange([BitConverter]::GetBytes([UInt16]$bitCount))
  $group.AddRange([BitConverter]::GetBytes([UInt32]$bytesInRes))
  $group.AddRange([BitConverter]::GetBytes([UInt16]$resourceId))
}

$exeFullPath = (Resolve-Path -LiteralPath $ExePath).Path
$handle = [ResourceWriter]::BeginUpdateResource($exeFullPath, $false)
if ($handle -eq [IntPtr]::Zero) {
  throw "BeginUpdateResource failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

$discard = $true
try {
  foreach ($image in $images) {
    $ok = [ResourceWriter]::UpdateResource($handle, [IntPtr]3, [IntPtr]$image.Id, 0, $image.Bytes, [uint32]$image.Bytes.Length)
    if (-not $ok) {
      throw "UpdateResource RT_ICON failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }

  $groupBytes = $group.ToArray()
  $ok = [ResourceWriter]::UpdateResource($handle, [IntPtr]14, [IntPtr]1, 0, $groupBytes, [uint32]$groupBytes.Length)
  if (-not $ok) {
    throw "UpdateResource RT_GROUP_ICON failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $discard = $false
}
finally {
  $ended = [ResourceWriter]::EndUpdateResource($handle, $discard)
  if (-not $ended) {
    throw "EndUpdateResource failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
}

Write-Output "Updated icon resources in $exeFullPath"
