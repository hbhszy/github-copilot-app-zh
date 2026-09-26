// WScript.Shell uses an ANSI path setter on some Windows installations. Use
// IShellLinkW explicitly so links work across system locales, including emoji.
// https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace CopilotChinese
{
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLinkObject { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
        InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr itemList);
        void SetIDList(IntPtr itemList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    // A managed snapshot, not a retained COM handle. Reading never calls Resolve
    // (which may search for moved targets or show UI), and never saves the file.
    public sealed class ShortcutFile
    {
        private const int Capacity = 32768;
        private readonly string file;
        public string TargetPath { get; set; }
        public string Arguments { get; set; }
        public string WorkingDirectory { get; set; }
        public string Description { get; set; }
        public string IconLocation { get; set; }

        public ShortcutFile(string path)
        {
            if (!Path.IsPathRooted(path) || !string.Equals(Path.GetExtension(path), ".lnk", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("An absolute .lnk path is required.");
            file = Path.GetFullPath(path);
            TargetPath = Arguments = WorkingDirectory = Description = "";
            IconLocation = ",0";
            if (!File.Exists(file)) return;
            object instance = new ShellLinkObject();
            try
            {
                ((IPersistFile)instance).Load(file, 0);
                var link = (IShellLinkW)instance;
                var buffer = new StringBuilder(Capacity);
                link.GetPath(buffer, buffer.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH
                TargetPath = buffer.ToString();
                buffer.Clear(); link.GetArguments(buffer, buffer.Capacity);
                Arguments = buffer.ToString();
                buffer.Clear(); link.GetWorkingDirectory(buffer, buffer.Capacity);
                WorkingDirectory = buffer.ToString();
                buffer.Clear(); link.GetDescription(buffer, buffer.Capacity);
                Description = buffer.ToString();
                int index;
                buffer.Clear(); link.GetIconLocation(buffer, buffer.Capacity, out index);
                IconLocation = buffer.ToString() + "," + index.ToString(CultureInfo.InvariantCulture);
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }

        public void Save()
        {
            if (string.IsNullOrEmpty(TargetPath) || !Path.IsPathRooted(TargetPath))
                throw new ArgumentException("The shortcut target must be an absolute path.");
            string icon = IconLocation ?? "";
            int index = 0;
            int comma = icon.LastIndexOf(',');
            if (comma >= 0)
            {
                if (!int.TryParse(icon.Substring(comma + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out index))
                    throw new ArgumentException("Invalid shortcut icon index.");
                icon = icon.Substring(0, comma);
            }
            object instance = new ShellLinkObject();
            try
            {
                // Preserve unrelated existing shell-link properties on repair.
                if (File.Exists(file)) ((IPersistFile)instance).Load(file, 0);
                var link = (IShellLinkW)instance;
                link.SetPath(TargetPath);
                link.SetArguments(Arguments ?? "");
                link.SetWorkingDirectory(WorkingDirectory ?? "");
                link.SetDescription(Description ?? "");
                link.SetIconLocation(icon, index);
                ((IPersistFile)instance).Save(file, true);
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
