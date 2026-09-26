// Optional GUI entry point for this project's desktop shortcuts. Compiled during
// installation, using Windows' .NET Framework; it does not modify Copilot.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class CopilotChineseEntry
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length > 1 || (args.Length == 1 && args[0] != "--stop" && args[0] != "--check"))
                throw new ArgumentException("Supported arguments: --stop, --check");
            string local = AppDomain.CurrentDomain.BaseDirectory;
            string root = Directory.GetParent(local.TrimEnd(Path.DirectorySeparatorChar)).FullName;
            var json = new JavaScriptSerializer();
            if (args.Length == 1 && args[0] == "--check")
            {
                bool noConsole = GetConsoleWindow() == IntPtr.Zero;
                File.WriteAllText(Path.Combine(local, "bootstrap-check.json"), json.Serialize(new { noConsole = noConsole }));
                return noConsole ? 0 : 1;
            }
            var runtime = json.Deserialize<Dictionary<string, string>>(File.ReadAllText(Path.Combine(local, "runtime.json")));
            string node = runtime["node"];
            string script = Path.Combine(root, "src", "launcher.mjs");
            if (!Path.IsPathRooted(node) || !File.Exists(node) || !File.Exists(script))
                throw new FileNotFoundException("Run install.ps1 again to repair the Node.js path or project location.");
            var start = new ProcessStartInfo {
                FileName = node,
                Arguments = "\"" + script + "\" --quiet" + (args.Length == 1 ? " --stop" : ""),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (Process child = Process.Start(start)) { }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "GitHub Copilot Chinese UI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
