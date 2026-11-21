Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DesktopCursorProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    private delegate bool EnumWindow(IntPtr window, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindow callback, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int length);

    public static void Sample() {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        var timer = Stopwatch.StartNew();
        var seen = new HashSet<string>();
        var className = new StringBuilder(256);
        long nextOverlaySample = 0;
        EnumWindow observeOverlay = (window, data) => {
            if (IsWindowVisible(window) && GetClassName(window, className, className.Capacity) > 0) {
                string name = className.ToString();
                if (name.StartsWith("WindowsMCPControl_") && seen.Add(name)) {
                    Console.WriteLine("overlay {0}", name);
                }
            }
            return true;
        };
        while (true) {
            Point point;
            if (!GetCursorPos(out point)) throw new InvalidOperationException("Could not sample the cursor.");
            Console.WriteLine("{0} {1} {2}", timer.ElapsedMilliseconds, point.X, point.Y);
            if (timer.ElapsedMilliseconds >= nextOverlaySample) {
                EnumWindows(observeOverlay, IntPtr.Zero);
                nextOverlaySample = timer.ElapsedMilliseconds + 40;
            }
            Thread.Sleep(10);
        }
    }
}
'@
[DesktopCursorProbe]::Sample()
