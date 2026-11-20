Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class DesktopCursorProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static void Sample() {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        var timer = Stopwatch.StartNew();
        while (true) {
            Point point;
            if (!GetCursorPos(out point)) throw new InvalidOperationException("Could not sample the cursor.");
            Console.WriteLine("{0} {1} {2}", timer.ElapsedMilliseconds, point.X, point.Y);
            Thread.Sleep(10);
        }
    }
}
'@
[DesktopCursorProbe]::Sample()
