// Reports where the open app windows are, front-most first, so snow can settle
// on their top edges. No native modules and no extra permissions:
//   - Windows: a small PowerShell helper that calls user32 / dwmapi.
//   - macOS:   a small JavaScript for Automation helper that calls
//              CGWindowListCopyWindowInfo (window bounds need no Screen Recording permission).
// Each helper prints one JSON line whenever the window list changes:
//   [{ "id": 123, "x": 10, "y": 20, "w": 800, "h": 600 }, ...]

const { spawn } = require('child_process');
const readline = require('readline');

const POLL_MS = 250;

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SnowWindows {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);

  public static string List(uint skipPid) {
    var sb = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;          // WS_EX_TOOLWINDOW
      if (GetWindowTextLength(h) == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == skipPid) return true;                                // our own snow windows
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden UWP windows
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Progman" || c == "WorkerW") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true; // visible frame, without invisible resize borders
      if (r.R - r.L < 120 || r.B - r.T < 60) return true;
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.L).Append(",\"y\":").Append(r.T)
        .Append(",\"w\":").Append(r.R - r.L).Append(",\"h\":").Append(r.B - r.T).Append('}');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
"@
try { [void][SnowWindows]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
$last = ''
$n = 0
while ($true) {
  $s = [SnowWindows]::List(__PID__)
  if ($s -ne $last) {
    try { [Console]::Out.WriteLine($s); [Console]::Out.Flush() } catch { exit }
    $last = $s
  }
  $n++
  if (($n % 20) -eq 0 -and -not (Get-Process -Id __PID__ -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds __POLL__
}
`;

const MAC_SCRIPT = String.raw`
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run() {
  var out = $.NSFileHandle.fileHandleWithStandardOutput;
  var skip = __PID__;
  var last = '';
  var n = 0;
  while (true) {
    // kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
    var ref = $.CGWindowListCopyWindowInfo(1 | 16, 0);
    var list = ObjC.deepUnwrap(ObjC.castRefToObject(ref)) || [];
    var wins = [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.kCGWindowLayer !== 0 || w.kCGWindowOwnerPID === skip) continue; // normal app windows only
      if (w.kCGWindowAlpha !== undefined && w.kCGWindowAlpha < 0.1) continue;
      var b = w.kCGWindowBounds;
      if (!b || b.Width < 120 || b.Height < 60) continue;
      wins.push({ id: w.kCGWindowNumber, x: b.X, y: b.Y, w: b.Width, h: b.Height });
    }
    var s = JSON.stringify(wins);
    if (s !== last) {
      out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
      last = s;
    }
    n++;
    if (n % 20 === 0 && $.NSRunningApplication.runningApplicationWithProcessIdentifier(skip).isNil()) return;
    delay(__POLL_S__);
  }
}
`;

/**
 * Start watching windows. Calls onUpdate(windows) with rects in screen DIPs
 * (the same coordinates Electron uses), front-most window first.
 * Returns a stop() function. Does nothing on unsupported platforms.
 */
function startWindowTracker(onUpdate, { toDip } = {}) {
  let child;
  if (process.platform === 'win32') {
    const script = WINDOWS_SCRIPT.replace(/__PID__/g, String(process.pid)).replace('__POLL__', String(POLL_MS));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else if (process.platform === 'darwin') {
    const script = MAC_SCRIPT.replace(/__PID__/g, String(process.pid)).replace('__POLL_S__', String(POLL_MS / 1000));
    child = spawn('osascript', ['-l', 'JavaScript', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    return () => {};
  }

  let stopped = false;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let wins;
    try {
      wins = JSON.parse(line);
    } catch {
      return;
    }
    if (!Array.isArray(wins)) return;
    onUpdate(toDip ? wins.map(toDip) : wins);
  });
  child.stderr.on('data', (d) => console.warn('[window-tracker]', String(d).trim()));
  child.on('exit', (code) => {
    if (!stopped) console.warn('[window-tracker] helper exited with code', code);
  });
  child.on('error', (err) => console.warn('[window-tracker] could not start helper', err.message));

  return () => {
    stopped = true;
    rl.close();
    child.kill();
  };
}

module.exports = { startWindowTracker };
