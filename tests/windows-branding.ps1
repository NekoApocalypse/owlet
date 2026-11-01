# Read-only inspection of Windows' actual taskbar properties and window icon.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwletWindowBranding {
  [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr pointer;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store {
    [PreserveSig] uint GetCount(out uint count);
    [PreserveSig] uint GetAt(uint index, out Key key);
    [PreserveSig] uint GetValue(ref Key key, out Value value);
    [PreserveSig] uint SetValue(ref Key key, ref Value value);
    [PreserveSig] uint Commit();
  }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Store store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static string Read(IntPtr window, uint id) {
    Guid iid = typeof(Store).GUID;
    Store store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref iid, out store));
    try {
      Key key = new Key { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id=id };
      Value value;
      Marshal.ThrowExceptionForHR((int)store.GetValue(ref key, out value));
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$expectedExe = Join-Path $root 'release\Owlet\Owlet.exe'
$process = @(Get-Process Owlet | Where-Object { $_.Path -eq $expectedExe -and $_.MainWindowHandle -ne 0 })
if ($process.Count -ne 1) { throw "Expected one packaged Owlet process with a visible window." }
$window = $process[0].MainWindowHandle
$appId = [OwletWindowBranding]::Read($window, 5)
$iconResource = [OwletWindowBranding]::Read($window, 3)
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'assets\icon-manifest.json') | ConvertFrom-Json
$expectedIcon = Join-Path $root "release\Owlet\resources\app\assets\$($manifest.icon)"
if ($appId -ne 'Owlet.Desktop') { throw "Incorrect native window AppUserModelID: $appId" }
if (-not $iconResource.Contains($expectedIcon)) { throw "Incorrect taskbar relaunch icon: $iconResource" }
$hicon = [OwletWindowBranding]::SendMessage($window, 127, [IntPtr]1, [IntPtr]::Zero)
if ($hicon -eq [IntPtr]::Zero) { throw 'Window has no large native icon.' }
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$bitmap = $icon.ToBitmap()
try { $bitmap.Save((Join-Path $root 'artifacts\native-window-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
finally { $bitmap.Dispose(); $icon.Dispose() }
$proof = [pscustomobject]@{ appId=$appId; taskbarIcon=$iconResource; executable=$expectedExe; nativeIconPresent=$true; verified=$true }
$proof | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'artifacts\windows-branding-results.json')
$proof | ConvertTo-Json
