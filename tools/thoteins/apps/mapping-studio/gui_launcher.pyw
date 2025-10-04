import os
import subprocess 
import threading 
import time 
import tkinter as tk 
from tkinter import ttk, messagebox, filedialog  
import sys 
import shutil
import csv
import json

HERE = os.path.dirname(os.path.abspath(__file__))
# Compute Thoteins project root (two levels up from mapping-studio)
_up2 = os.path.dirname(os.path.dirname(HERE))  # Thoteins
TH_ROOT = _up2 if os.path.basename(_up2).lower() == "thoteins" else os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "Thoteins")
# Obsolete Dear PyGui mapper removed; no mapper logs/PID

# Prompter writer paths
PROMPTER_DIR = os.path.join(TH_ROOT, "apps", "protein-portrait-prompter")
WRITER_LOGDIR = os.path.join(TH_ROOT, "logs", "prompter")
WRITER_LOGFILE = os.path.join(WRITER_LOGDIR, "writer.log")

# Database paths
SCRIPTS_DIR = os.path.join(TH_ROOT, "scripts")
DB_CSV = os.path.join(TH_ROOT, "data", "proteins", "features.csv")
PERSONA_CSV = os.path.join(TH_ROOT, "data", "proteins", "persona.csv")


def _ensure_dirs():
    os.makedirs(WRITER_LOGDIR, exist_ok=True)


def _which(cmd: str) -> bool:
    try:
        subprocess.check_call(["where", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
        return True
    except Exception:
        return False


def _python_cmds():
    # Prefer pythonw to avoid console windows; fallback to py -3w if available
    if _which("pythonw"):
        return ("pythonw", "python")
    if _which("py"):
        return ("py -3w", "py -3")
    # Fallbacks 
    exe = sys.executable or "python"
    return (exe, exe) 

def _run(cmd: str, cwd: str = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)


def _read_pid():
    try:
        with open(PIDFILE, "r", encoding="ascii") as f:
            return int(f.read().strip())
    except Exception:
        return None


def _pid_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        # Windows tasklist check
        out = subprocess.check_output(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], text=True, shell=True)
        return str(pid) in out
    except Exception:
        return False


class LauncherUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Thoteins Launcher")
        self.root.geometry("780x520")
        self.root.minsize(720, 480)
        _ensure_dirs()
        os.makedirs(WRITER_LOGDIR, exist_ok=True)
        self._writer_proc = None

        # Header
        header = ttk.Frame(root)
        header.pack(fill=tk.X, padx=10, pady=8)
        ttk.Label(header, text="Thoteins", font=("Segoe UI", 14, "bold")).pack(side=tk.LEFT)
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(header, textvariable=self.status_var).pack(side=tk.RIGHT)

        # Controls
        controls = ttk.Frame(root)
        controls.pack(fill=tk.X, padx=10)
        # No external mapper; use the Tk editor below

        # Python selector removed from GUI; launcher will auto-pick a console Python

        # Prompter controls (local writer + browser)
        prompter = ttk.Frame(root)
        prompter.pack(fill=tk.X, padx=10, pady=(8,0))
        ttk.Label(prompter, text="Protein Portrait Prompter", font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)
        self.writer_status = tk.StringVar(value="Writer: Unknown")
        ttk.Label(prompter, textvariable=self.writer_status).pack(side=tk.RIGHT)

        pctrl = ttk.Frame(root)
        pctrl.pack(fill=tk.X, padx=10)
        ttk.Button(pctrl, text="Start Prompter", command=self.start_prompter).pack(side=tk.LEFT, padx=4)
        ttk.Button(pctrl, text="Open in Browser", command=self.open_prompter).pack(side=tk.LEFT, padx=4)
        ttk.Button(pctrl, text="Stop Prompter", command=self.stop_prompter).pack(side=tk.LEFT, padx=4)
        ttk.Button(pctrl, text="Open Writer Logs", command=self.open_writer_logs).pack(side=tk.LEFT, padx=12)
        ttk.Button(pctrl, text="Open Mapping Editor (Tk)", command=self.open_mapping_editor).pack(side=tk.LEFT, padx=12)

        # Database controls (features.csv)
        dbf = ttk.Frame(root)
        dbf.pack(fill=tk.X, padx=10, pady=(8,0))
        ttk.Label(dbf, text="Database (features.csv)", font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)

        dbctrl = ttk.Frame(root)
        dbctrl.pack(fill=tk.X, padx=10)
        ttk.Button(dbctrl, text="Open Database File", command=self.open_database_file).pack(side=tk.LEFT, padx=4)
        ttk.Button(dbctrl, text="Rebuild Database", command=self.rebuild_database).pack(side=tk.LEFT, padx=4)

        # Persona controls (persona.csv)
        pnf = ttk.Frame(root)
        pnf.pack(fill=tk.X, padx=10, pady=(8,0))
        ttk.Label(pnf, text="Persona (persona.csv)", font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)

        pnctrl = ttk.Frame(root)
        pnctrl.pack(fill=tk.X, padx=10)
        ttk.Button(pnctrl, text="Open Persona File", command=self.open_persona_file).pack(side=tk.LEFT, padx=4)
        ttk.Button(pnctrl, text="Rebuild Persona", command=self.rebuild_persona).pack(side=tk.LEFT, padx=4)

        # AI/Data tools
        aitools = ttk.Frame(root)
        aitools.pack(fill=tk.X, padx=10, pady=(8,0))
        ttk.Label(aitools, text="AI Tools", font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)

        aictrl = ttk.Frame(root)
        aictrl.pack(fill=tk.X, padx=10)
        ttk.Button(aictrl, text="Map Aesthetics (AI)", command=self.map_aesthetics).pack(side=tk.LEFT, padx=4)
        ttk.Button(aictrl, text="Show Unmapped Families", command=self.show_unmapped).pack(side=tk.LEFT, padx=4)
        ttk.Button(aictrl, text="Update Aesthetics Wiki", command=self.update_aesthetics_wiki).pack(side=tk.LEFT, padx=4)

        # Log view (used for status and command output)
        log_frame = ttk.Frame(root)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=8)
        self.log_text = tk.Text(log_frame, wrap=tk.NONE, height=20, bg="#f6f4ef")
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.insert(tk.END, "Ready. Use Mapping Editor (Tk) and Prompter controls.\n")
        self.log_text.configure(state=tk.DISABLED)

        # Footer note
        ttk.Label(root, text="Status and command output appear below.", foreground="#5a564f").pack(anchor=tk.W, padx=12, pady=4)

        # Timers
        self.root.after(800, self.refresh_writer_status)

    def status(self, msg: str):
        try:
            self.status_var.set(str(msg))
        except Exception:
            pass

    def _append(self, line: str):
        try:
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.insert(tk.END, str(line))
            self.log_text.see(tk.END)
            self.log_text.configure(state=tk.DISABLED)
        except Exception:
            pass

    def console_python(self) -> str:
        """Return a console-capable Python command string.
        Prefer sys.executable (python.exe). If it's pythonw.exe, switch to python.exe.
        Fall back to 'py -3' or 'python'.
        """
        try:
            exe = sys.executable or ""
            if exe and exe.lower().endswith("pythonw.exe"):
                cand = exe[:-11] + "python.exe"
                if os.path.exists(cand):
                    return cand
            if exe:
                return exe
            if shutil.which("py"):
                return "py -3"
            if shutil.which("python"):
                return "python"
        except Exception:
            pass
        return "python"

    def install_deps(self):
        pyw, py = _python_cmds()
        self._append("Checking dependencies...\n")
        def task():
            try:
                subprocess.run(f"{py} -u check_deps.py", cwd=HERE, shell=True)
                # Always run pip install to update (idempotent)
                self._append("Installing/updating packages (this may take a minute)...\n")
                subprocess.run(f"{py} -m pip install -r requirements.txt", cwd=HERE, shell=True)
                self._append("Dependencies installed.\n")
            except Exception as e:
                self._append(f"Error installing deps: {e}\n")
        threading.Thread(target=task, daemon=True).start()

    def start_app(self):
        pyw, py = _python_cmds()
        pid = _read_pid()
        if pid and _pid_alive(pid):
            messagebox.showinfo("Mapping Studio", f"Already running (PID {pid}).")
            return
        _ensure_dirs()
        self._append("Checking dependencies...\n")
        # Ensure dependencies first (non-blocking UI)
        def _deps():
            try:
                r = subprocess.run(f"{py} -u check_deps.py", cwd=HERE, shell=True)
                if r.returncode != 0:
                    self._append("Installing required packages. This may take a minute...\n")
                    subprocess.run(f"{py} -m pip install -r requirements.txt", cwd=HERE, shell=True)
            except Exception as e:
                self._append(f"Dependency check failed: {e}\n")
        threading.Thread(target=_deps, daemon=True).start()

        self._append("Starting Mapping Studio...\n")
        def task():
            try:
                # Append log header
                with open(LOGFILE, "a", encoding="utf-8") as lf:
                    lf.write("\n==== Launching Mapping Studio ====" + time.strftime(" %Y-%m-%d %H:%M:%S") + "\n")
                # Start the launcher with pythonw and redirect output to log
                logf = open(LOGFILE, "a", encoding="utf-8")
                cmd = f"{pyw} -u launcher.py"
                subprocess.Popen(cmd, cwd=HERE, shell=True, stdout=logf, stderr=subprocess.STDOUT)
                time.sleep(2.0)
                self.refresh_status()
                self._append("Started (if no window appears, see log below).\n")
            except Exception as e:
                self._append(f"Start failed: {e}\n")
        threading.Thread(target=task, daemon=True).start()

    def stop_app(self):
        pid = _read_pid()
        if not pid:
            messagebox.showinfo("Mapping Studio", "Not running (no PID file).")
            return
        self._append(f"Stopping PID {pid}...\n")
        try:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
            try:
                os.remove(PIDFILE)
            except Exception:
                pass
            time.sleep(0.8)
            self.refresh_status()
            self._append("Stopped.\n")
        except Exception as e:
            self._append(f"Stop failed: {e}\n")

    def open_logs(self):
        _ensure_dirs()
        os.startfile(LOGDIR)

    # ----- Prompter/writer controls -----
    def _writer_running(self) -> bool:
        try:
            if self._writer_proc and (self._writer_proc.poll() is None):
                return True
        except Exception:
            pass
        return False

    def refresh_writer_status(self):
        if self._writer_running():
            self.writer_status.set("Writer: Running (http://127.0.0.1:8787)")
        else:
            self.writer_status.set("Writer: Not running")
        self.root.after(1000, self.refresh_writer_status)

    def start_prompter(self):
        if self._writer_running():
            self._append("Writer already running.\n")
        else:
            try:
                os.makedirs(WRITER_LOGDIR, exist_ok=True)
                logf = open(WRITER_LOGFILE, "a", encoding="utf-8")
                # Prefer pythonw to avoid extra console
                pyw, py = _python_cmds()
                cmd = f"{pyw} -u local_writer.py"
                self._writer_proc = subprocess.Popen(cmd, cwd=PROMPTER_DIR, shell=True, stdout=logf, stderr=subprocess.STDOUT)
                self._append("Starting Prompter writer/server...\n")
                self.root.after(800, self.open_prompter)
            except Exception as e:
                self._append(f"Start Prompter failed: {e}\n")

    def open_prompter(self):
        try:
            url = "http://127.0.0.1:8787/prompter/"
            os.startfile(url)
            self._append("Opened Prompter in browser. Closing the tab will request server shutdown.\n")
        except Exception as e:
            self._append(f"Open Prompter failed: {e}\n")

    def stop_prompter(self):
        try:
            # ask server to shutdown gracefully
            import urllib.request
            urllib.request.urlopen("http://127.0.0.1:8787/shutdown", data=b"", timeout=2)
        except Exception:
            pass
        # fallback: kill process if still alive after a moment
        def later_check():
            try:
                if self._writer_running():
                    self._writer_proc.terminate()
            except Exception:
                pass
            self._append("Prompter stopped.\n")
        self.root.after(1000, later_check)

    def open_writer_logs(self):
        try:
            os.startfile(WRITER_LOGDIR)
        except Exception:
            self._append("No writer logs yet.\n")

    # ----- Database helpers -----
    def open_database_file(self):
        try:
            if os.path.exists(DB_CSV):
                os.startfile(DB_CSV)
                self._append("Opened database CSV.\n")
            else:
                os.makedirs(os.path.dirname(DB_CSV), exist_ok=True)
                self._append("Database file not found. Click 'Rebuild Database' to create it.\n")
        except Exception as e:
            self._append(f"Open database failed: {e}\n")

    def rebuild_database(self):
        py = self.console_python()
        self._append("Rebuilding database (features.csv)...\n")
        def task():
            try:
                py_cmd = f'"{py}"' if os.path.exists(py) else py
                cmd = f"{py_cmd} -u protein_db.py rebuild"
                r = subprocess.run(cmd, cwd=SCRIPTS_DIR, shell=True, capture_output=True, text=True)
                if r.stdout:
                    self.root.after(0, lambda: self._append(r.stdout + ("\n" if not r.stdout.endswith("\n") else "")))
                if r.stderr:
                    self.root.after(0, lambda: self._append(r.stderr + ("\n" if not r.stderr.endswith("\n") else "")))
                self.root.after(0, lambda: self._append(f"Command: {cmd} (exit {r.returncode})\n"))
                if r.returncode == 0:
                    self.root.after(0, lambda: self._append("Database rebuilt.\n"))
                else:
                    self.root.after(0, lambda: self._append(f"Database rebuild failed (code {r.returncode}).\n"))
            except Exception as e:
                self.root.after(0, lambda: self._append(f"Rebuild failed: {e}\n"))
        threading.Thread(target=task, daemon=True).start()

    def open_persona_file(self):
        try:
            if os.path.exists(PERSONA_CSV):
                os.startfile(PERSONA_CSV)
                self._append("Opened persona CSV.\n")
            else:
                os.makedirs(os.path.dirname(PERSONA_CSV), exist_ok=True)
                self._append("Persona file not found. Click 'Rebuild Persona' to create it.\n")
        except Exception as e:
            self._append(f"Open persona failed: {e}\n")

    def rebuild_persona(self):
        py = self.console_python()
        self._append("Rebuilding persona (persona.csv)...\n")
        def task():
            try:
                py_cmd = f'"{py}"' if os.path.exists(py) else py
                cmd = f"{py_cmd} -u protein_db.py rebuild-persona"
                r = subprocess.run(cmd, cwd=SCRIPTS_DIR, shell=True, capture_output=True, text=True)
                if r.stdout:
                    self.root.after(0, lambda: self._append(r.stdout + ("\n" if not r.stdout.endswith("\n") else "")))
                if r.stderr:
                    self.root.after(0, lambda: self._append(r.stderr + ("\n" if not r.stderr.endswith("\n") else "")))
                self.root.after(0, lambda: self._append(f"Command: {cmd} (exit {r.returncode})\n"))
                if r.returncode == 0:
                    self.root.after(0, lambda: self._append("Persona rebuilt.\n"))
                else:
                    self.root.after(0, lambda: self._append(f"Persona rebuild failed (code {r.returncode}).\n"))
            except Exception as e:
                self.root.after(0, lambda: self._append(f"Persona rebuild failed: {e}\n"))
        threading.Thread(target=task, daemon=True).start()

    def map_aesthetics(self):
        py = self.console_python()
        self._append("Querying AI to map protein families to aesthetics...\n")
        self._append("This may take 1-2 minutes depending on how many families need mapping.\n")
        def task():
            try:
                py_cmd = f'"{py}"' if os.path.exists(py) else py
                cmd = f"{py_cmd} -u map_aesthetics.py --apply"
                r = subprocess.run(cmd, cwd=SCRIPTS_DIR, shell=True, capture_output=True, text=True, timeout=600)
                if r.stdout:
                    self.root.after(0, lambda: self._append(r.stdout + ("\n" if not r.stdout.endswith("\n") else "")))
                if r.stderr:
                    self.root.after(0, lambda: self._append(r.stderr + ("\n" if not r.stderr.endswith("\n") else "")))
                self.root.after(0, lambda: self._append(f"Command: {cmd} (exit {r.returncode})\n"))
                if r.returncode == 0:
                    self.root.after(0, lambda: self._append("\nAesthetic mapping complete!\n"))
                    self.root.after(0, lambda: self._append("Click 'Reload CSVs' in Mapping Studio to see new aesthetics.\n"))
                else:
                    self.root.after(0, lambda: self._append(f"Mapping failed (code {r.returncode}).\n"))
            except subprocess.TimeoutExpired:
                self.root.after(0, lambda: self._append("Mapping timed out (>10 min). Check gemini_suggestions.txt in data/aesthetics/\n"))
            except Exception as e:
                self.root.after(0, lambda: self._append(f"Mapping failed: {e}\n"))
        threading.Thread(target=task, daemon=True).start()

    def show_unmapped(self):
        py = self.console_python()
        self._append("Checking for unmapped protein families...\n")
        def task():
            try:
                py_cmd = f'"{py}"' if os.path.exists(py) else py
                cmd = f"{py_cmd} -u map_aesthetics.py"
                r = subprocess.run(cmd, cwd=SCRIPTS_DIR, shell=True, capture_output=True, text=True, timeout=30)
                if r.stdout:
                    self.root.after(0, lambda: self._append(r.stdout + ("\n" if not r.stdout.endswith("\n") else "")))
                if r.stderr:
                    self.root.after(0, lambda: self._append(r.stderr + ("\n" if not r.stderr.endswith("\n") else "")))
            except Exception as e:
                self.root.after(0, lambda: self._append(f"Check failed: {e}\n"))
        threading.Thread(target=task, daemon=True).start()

    def update_aesthetics_wiki(self):
        self._append("Updating Aesthetics Wiki not yet implemented.\n")
        self._append("Currently using cached wiki from data/aesthetics/Aesthetics_Wiki.txt\n")

    def export_mapping(self):
        # Ask the running app to export? Simpler: read the current config from file if we had one.
        # For now, we just point the user to export within the app.
        messagebox.showinfo("Export", "Use the Mapping Studio app's Export JSON button to save configuration.")

    def import_mapping(self):
        messagebox.showinfo("Import", "Use the Mapping Studio app's Import JSON button to load configuration.")

    def refresh_status(self):
        pid = _read_pid()
        if pid and _pid_alive(pid):
            self.status_var.set(f"Status: Running (PID {pid})")
        else:
            self.status_var.set("Status: Not running")
        self.root.after(1000, self.refresh_status)

    def tail_log_once(self):
        try:
            if os.path.exists(LOGFILE):
                with open(LOGFILE, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()[-200:]
            text = "".join(lines)
            self._set_log(text)
            # Append a snippet from writer log as well
            if os.path.exists(WRITER_LOGFILE):
                with open(WRITER_LOGFILE, "r", encoding="utf-8", errors="ignore") as wf:
                    wlines = wf.readlines()[-40:]
                if wlines:
                    self.log_text.configure(state=tk.NORMAL)
                    self.log_text.insert(tk.END, "\n[Prompter] " + "".join(wlines))
                    self.log_text.configure(state=tk.DISABLED)
        except Exception:
            pass
        self.root.after(1200, self.tail_log_once)

    def _set_log(self, text: str):
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete(1.0, tk.END)
        self.log_text.insert(tk.END, text)
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)

    # ----- Python diagnostics -----
    def _default_python(self) -> str:
        # Prefer sys.executable, else try py -3, else python
        if sys.executable:
            return sys.executable
        if _which("py"):
            return "py -3"
        return "python"

    def detect_python_candidates(self):
        cands = []
        seen = set()
        def add(cmd):
            if cmd and cmd not in seen:
                seen.add(cmd); cands.append(cmd)
        # sys.executable
        add(sys.executable or "")
        # Windows py launcher listings
        if _which("py"):
            add("py -3"); add("py")
            try:
                r = _run("py -0p")
                for line in (r.stdout or "").splitlines():
                    p = line.strip()
                    if p: add(p)
            except Exception:
                pass
        # Common names
        for name in ("python", "python3", "pythonw"):
            if shutil.which(name): add(name)
        return [c for c in cands if c]

    def choose_best_python(self) -> str:
        """Pick a working console Python automatically.
        Preference order: absolute python.exe from py -0p, then 'py', then python/python3, then sys.executable (if not pythonw).
        Validated by running a tiny -c test.
        """
        cand_list = []
        # Absolute exes from py -0p first
        try:
            if _which("py"):
                r = _run("py -0p")
                for line in (r.stdout or "").splitlines():
                    s = line.strip()
                    if s and s.lower().endswith("python.exe"):
                        cand_list.append(s)
        except Exception:
            pass
        # Then 'py'
        if _which("py"):
            cand_list.append("py")
        # Then common names
        for name in ("python", "python3"):
            if shutil.which(name): cand_list.append(name)
        # Finally sys.executable if not pythonw
        if sys.executable and not sys.executable.lower().endswith("pythonw.exe"):
            cand_list.append(sys.executable)
        # Deduplicate while keeping order
        seen = set(); ordered = []
        for c in cand_list:
            if c not in seen:
                seen.add(c); ordered.append(c)
        # Validate
        for cmd in ordered:
            try:
                r = _run(f"{cmd} -c \"import sys;print('ok')\"")
                if r.returncode == 0 and (r.stdout or '').strip().endswith('ok'):
                    return cmd
            except Exception:
                continue
        # Fallback
        return sys.executable or "python"

    def apply_python_choice(self):
        # Selector removed; reflect the auto-detected console Python instead.
        self.status(f"Using Python: {self.console_python()}")

    def diagnose_python(self):
        self._append("Diagnosing Python interpreters...\n")
        for cmd in self.detect_python_candidates():
            try:
                r = _run(f"{cmd} -V")
                ver = (r.stdout or r.stderr or "").strip()
                self._append(f" - {cmd}: {ver} (exit {r.returncode})\n")
            except Exception as e:
                self._append(f" - {cmd}: error {e}\n")
        self._append("Done.\n")

    # ----- Mapping Editor (Tk) -----
    def open_mapping_editor(self):
        try:
            MappingEditorTk(self.root)
        except Exception as e:
            self._append(f"Open editor failed: {e}\n")


class MappingEditorTk:
    def __init__(self, parent: tk.Tk):
        self.parent = parent
        self.win = tk.Toplevel(parent)
        self.win.title("Mapping Studio")
        self.win.geometry("1200x800")
        self.win.minsize(1000, 700)

        # Modern styling
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('TFrame', background='#f5f5f5')
        style.configure('Toolbar.TFrame', background='#ffffff')
        style.configure('Panel.TFrame', background='#ffffff')
        style.configure('TLabel', background='#f5f5f5', foreground='#333333')
        style.configure('Title.TLabel', font=('Segoe UI', 11, 'bold'), foreground='#1a1a1a')
        style.configure('Treeview', rowheight=25, font=('Segoe UI', 9))
        style.configure('Treeview.Heading', font=('Segoe UI', 9, 'bold'))

        # Repo paths
        self.root_dir = TH_ROOT
        self.data_dir = os.path.join(self.root_dir, "data")
        os.makedirs(self.data_dir, exist_ok=True)
        self.mapping_path = os.path.join(self.data_dir, "mapping.json")
        self.features_csv = os.path.join(self.root_dir, "data", "proteins", "features.csv")
        self.persona_csv = os.path.join(self.root_dir, "data", "proteins", "persona.csv")

        # State
        self.mapping = {"molecular": [], "human": [], "mappings": []}
        self.tokens_by_source = {}
        self.cur_map = None

        # Toolbar
        toolbar = ttk.Frame(self.win, style='Toolbar.TFrame')
        toolbar.pack(fill=tk.X, padx=0, pady=0)
        ttk.Button(toolbar, text="Reload CSVs", command=self.reload_csvs).pack(side=tk.LEFT, padx=12, pady=10)
        ttk.Button(toolbar, text="Save", command=self.save_mapping).pack(side=tk.LEFT, padx=(0, 12), pady=10)
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(toolbar, textvariable=self.status_var, background='#ffffff', foreground='#666666').pack(side=tk.RIGHT, padx=12, pady=10)

        # Main body with subtle background
        body = ttk.Frame(self.win)
        body.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

        # Left panel - Molecular fields
        left = ttk.Frame(body, style='Panel.TFrame')
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 6))
        ttk.Label(left, text="Molecular Properties", style='Title.TLabel', background='#ffffff').pack(anchor=tk.W, padx=12, pady=(12, 8))

        mol_container = ttk.Frame(left, style='Panel.TFrame')
        mol_container.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 12))
        mol_scroll = ttk.Scrollbar(mol_container)
        mol_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.lb_mol = tk.Listbox(mol_container, exportselection=False, yscrollcommand=mol_scroll.set,
                                  font=('Segoe UI', 9), relief=tk.FLAT, borderwidth=0, highlightthickness=1,
                                  highlightcolor='#4a90e2', highlightbackground='#dddddd')
        self.lb_mol.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        mol_scroll.config(command=self.lb_mol.yview)

        # Right panel - Human fields
        right = ttk.Frame(body, style='Panel.TFrame')
        right.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(6, 0))
        ttk.Label(right, text="Persona Attributes", style='Title.TLabel', background='#ffffff').pack(anchor=tk.W, padx=12, pady=(12, 8))

        hum_container = ttk.Frame(right, style='Panel.TFrame')
        hum_container.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 12))
        hum_scroll = ttk.Scrollbar(hum_container)
        hum_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.lb_hum = tk.Listbox(hum_container, exportselection=False, yscrollcommand=hum_scroll.set,
                                  font=('Segoe UI', 9), relief=tk.FLAT, borderwidth=0, highlightthickness=1,
                                  highlightcolor='#4a90e2', highlightbackground='#dddddd')
        self.lb_hum.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        hum_scroll.config(command=self.lb_hum.yview)

        # Center panel - Mappings
        center = ttk.Frame(body, style='Panel.TFrame')
        center.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=6)

        ttk.Label(center, text="Mappings", style='Title.TLabel', background='#ffffff').pack(anchor=tk.W, padx=12, pady=(12, 8))

        # Mapping controls
        pairbar = ttk.Frame(center, style='Panel.TFrame')
        pairbar.pack(fill=tk.X, padx=12, pady=(0, 8))
        ttk.Button(pairbar, text="Add Mapping", command=self.add_mapping_from_selection).pack(side=tk.LEFT)
        ttk.Button(pairbar, text="Delete", command=self.delete_selected_mapping).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(pairbar, text="Repair", command=self.repair_mapping_to_selection).pack(side=tk.LEFT, padx=(6, 0))

        # Scrollable Treeview for mappings
        tv_container = ttk.Frame(center, style='Panel.TFrame')
        tv_container.pack(fill=tk.BOTH, expand=True, padx=8)

        tv_scroll = ttk.Scrollbar(tv_container)
        tv_scroll.pack(side=tk.RIGHT, fill=tk.Y)

        self.maps_tv = ttk.Treeview(tv_container, columns=("source", "target", "type", "status"),
                                     show="headings", yscrollcommand=tv_scroll.set)
        for c in ("source", "target", "type", "status"):
            self.maps_tv.heading(c, text=c.title())
            self.maps_tv.column(c, width=140 if c != "status" else 110, anchor=tk.W)
        self.maps_tv.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tv_scroll.config(command=self.maps_tv.yview)
        self.maps_tv.bind("<<TreeviewSelect>>", self.on_mapping_select)

        # Scrollable editor area
        editor_label = ttk.Label(center, text="Editor", style='Title.TLabel', background='#ffffff')
        editor_label.pack(anchor=tk.W, padx=12, pady=(16, 8))

        editor_container = ttk.Frame(center, style='Panel.TFrame')
        editor_container.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 12))

        editor_scroll = ttk.Scrollbar(editor_container)
        editor_scroll.pack(side=tk.RIGHT, fill=tk.Y)

        self.editor_canvas = tk.Canvas(editor_container, yscrollcommand=editor_scroll.set,
                                        bg='#ffffff', relief=tk.FLAT, highlightthickness=0)
        self.editor_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        editor_scroll.config(command=self.editor_canvas.yview)

        self.editor = ttk.Frame(self.editor_canvas, style='Panel.TFrame')
        self.editor_window = self.editor_canvas.create_window((0, 0), window=self.editor, anchor=tk.NW)

        # Configure canvas scrolling
        self.editor.bind('<Configure>', lambda e: self.editor_canvas.configure(scrollregion=self.editor_canvas.bbox('all')))
        self.editor_canvas.bind('<Configure>', lambda e: self.editor_canvas.itemconfig(self.editor_window, width=e.width))

        # Load data and populate UI
        self.reload_csvs()
        self.load_mapping()
        self.refresh_lists()
        self.refresh_mapping_list()

    # ----- Data IO -----
    def load_mapping(self):
        try:
            if os.path.exists(self.mapping_path):
                with open(self.mapping_path, "r", encoding="utf-8") as f:
                    obj = json.load(f)
                if isinstance(obj, dict):
                    self.mapping.update({k: obj.get(k, self.mapping.get(k)) for k in ("molecular", "human", "mappings")})
        except Exception:
            pass

    def save_mapping(self):
        try:
            with open(self.mapping_path, "w", encoding="utf-8") as f:
                json.dump(self.mapping, f, indent=2)
            self.status("Saved mapping.json")
        except Exception as e:
            self.status(f"Save failed: {e}")

    def reload_csvs(self):
        mol, hum, tokens = self.discover_from_csv()
        self.mapping["molecular"] = mol
        self.mapping["human"] = hum
        self.tokens_by_source = tokens
        self.status("Reloaded CSVs")
        # Refresh UI lists and mapping statuses so newly added columns appear immediately
        try:
            self.refresh_lists()
            self.refresh_mapping_list()
        except Exception:
            pass

    def discover_from_csv(self):
        mol = []
        hum = []
        tokens = {}
        # features.csv
        if os.path.exists(self.features_csv):
            try:
                with open(self.features_csv, "r", encoding="utf-8", newline="") as f:
                    rdr = csv.DictReader(f)
                    headers = list(rdr.fieldnames or [])
                    rows = list(rdr)
                reserved = {"uniprot_id", "gene_symbol", "short_name", "full_name"}
                for h in headers:
                    if not h or h in reserved:
                        continue
                    vals = [str((r.get(h) or "").strip()) for r in rows]
                    non_empty = [v for v in vals if v != ""]
                    def all_numeric(vs):
                        try:
                            for v in vs:
                                float(v)
                            return True
                        except Exception:
                            return False
                    if non_empty and all_numeric(non_empty):
                        vtype = "numeric"
                    elif any(d in v for v in non_empty for d in ";|/"):
                        vtype = "set"
                    else:
                        vtype = "text"
                    mol.append({"name": h, "type": vtype})
                    # tokens for set/text columns
                    if vtype != "numeric":
                        toks = set()
                        for cell in non_empty:
                            parts = [cell]
                            if any(d in cell for d in ";|/"):
                                parts = [p.strip() for p in cell.replace("|",";").replace("/",";").split(";") if p.strip()]
                            for p in parts:
                                toks.add(p)
                        if toks:
                            tokens[h] = sorted(toks, key=lambda x: x.lower())
            except Exception:
                pass
        # persona.csv
        if os.path.exists(self.persona_csv):
            try:
                with open(self.persona_csv, "r", encoding="utf-8", newline="") as f:
                    rdr = csv.DictReader(f)
                    headers = list(rdr.fieldnames or [])
                    rows = list(rdr)
                reserved = {"uniprot_id", "gene_symbol", "short_name"}
                for h in headers:
                    if not h or h in reserved:
                        continue
                    vals = [str((r.get(h) or "").strip()) for r in rows]
                    non_empty = [v for v in vals if v != ""]
                    def all_numeric(vs):
                        try:
                            for v in vs:
                                float(v)
                            return True
                        except Exception:
                            return False
                    if non_empty and all_numeric(non_empty):
                        vtype = "numeric"
                    elif any(d in v for v in non_empty for d in ";|/"):
                        vtype = "set"
                    else:
                        vtype = "text"
                    hum.append({"name": h, "type": vtype})
            except Exception:
                pass
        return mol, hum, tokens

    # ----- Helpers -----
    def status(self, msg: str):
        self.status_var.set(msg)

    def next_map_id(self) -> str:
        try:
            ids = [m.get("id", "") for m in self.mapping.get("mappings", [])]
            nums = []
            for s in ids:
                s = str(s or "")
                if s.startswith("map-"):
                    try:
                        nums.append(int(s.split("-", 1)[1]))
                    except Exception:
                        pass
            n = (max(nums) if nums else 0) + 1
            return f"map-{n:04d}"
        except Exception:
            import time
            return f"map-{int(time.time())}"

    # ----- UI refresh -----
    def refresh_lists(self):
        self.lb_mol.delete(0, tk.END)
        for v in self.mapping.get("molecular", []):
            self.lb_mol.insert(tk.END, f"{v.get('name')} [{v.get('type')}]")
        self.lb_hum.delete(0, tk.END)
        for v in self.mapping.get("human", []):
            self.lb_hum.insert(tk.END, f"{v.get('name')} [{v.get('type')}]")

    def refresh_mapping_list(self):
        for row in self.maps_tv.get_children():
            self.maps_tv.delete(row)
        for m in self.mapping.get("mappings", []):
            self.maps_tv.insert("", tk.END, iid=m.get("id"), values=(m.get("source"), m.get("target"), m.get("type"), self.compute_mapping_status(m)))
        # Also reflect status in the header bar
        warn_count = sum(1 for m in self.mapping.get("mappings", []) if self.compute_mapping_status(m) != "ok")
        if warn_count:
            self.status(f"{warn_count} mapping(s) need attention")
        else:
            self.status("Ready")

    def compute_mapping_status(self, m: dict) -> str:
        src = (m.get("source") or "").strip()
        tgt = (m.get("target") or "").strip()
        mol_names = {v.get("name") for v in self.mapping.get("molecular", [])}
        hum_names = {v.get("name") for v in self.mapping.get("human", [])}
        if src not in mol_names or tgt not in hum_names:
            return "unpaired"
        if (m.get("type") or "").startswith("Categorical"):
            toks = self.tokens_by_source.get(src, [])
            if not toks:
                return "no tokens"
        return "ok"

    # ----- Actions -----
    def _parse_listbox_var(self, lb: tk.Listbox) -> str:
        idx = lb.curselection()
        if not idx:
            return ""
        text = lb.get(idx[0])
        # format: name [type]
        name = text.split(" [", 1)[0]
        return name

    def add_mapping_from_selection(self):
        src = self._parse_listbox_var(self.lb_mol)
        tgt = self._parse_listbox_var(self.lb_hum)
        if not src or not tgt:
            self.status("Select a source and a target first")
            return
        used_s = {m.get("source") for m in self.mapping.get("mappings", [])}
        used_t = {m.get("target") for m in self.mapping.get("mappings", [])}
        if src in used_s or tgt in used_t:
            self.status("One-to-one violation: already mapped")
            return
        mol = next((v for v in self.mapping.get("molecular", []) if v.get("name") == src), None)
        hum = next((v for v in self.mapping.get("human", []) if v.get("name") == tgt), None)
        if not mol or not hum:
            self.status("Source/target not discovered")
            return
        if (mol.get("type") == "numeric") and (hum.get("type") == "numeric"):
            newm = {"id": self.next_map_id(), "type": "Numeric (multiplier)", "source": src, "target": tgt, "multiplier": 1.0, "log": False}
        else:
            newm = {"id": self.next_map_id(), "type": "Categorical (bins)", "source": src, "target": tgt, "bins": {}}
        self.mapping.setdefault("mappings", []).append(newm)
        self.save_mapping()
        self.refresh_mapping_list()
        self.select_mapping(newm.get("id"))

    def delete_selected_mapping(self):
        sel = self.maps_tv.selection()
        if not sel:
            return
        map_id = sel[0]
        self.mapping["mappings"] = [m for m in self.mapping.get("mappings", []) if m.get("id") != map_id]
        self.save_mapping()
        self.refresh_mapping_list()
        self.clear_editor()

    def repair_mapping_to_selection(self):
        sel = self.maps_tv.selection()
        if not sel:
            return
        map_id = sel[0]
        m = next((mm for mm in self.mapping.get("mappings", []) if mm.get("id") == map_id), None)
        if not m:
            return
        src = self._parse_listbox_var(self.lb_mol); tgt = self._parse_listbox_var(self.lb_hum)
        if not src or not tgt:
            self.status("Select source and target in the side lists")
            return
        # one-to-one
        for mm in self.mapping.get("mappings", []):
            if mm is m: continue
            if mm.get("source") == src or mm.get("target") == tgt:
                self.status("One-to-one violation")
                return
        m["source"], m["target"] = src, tgt
        self.save_mapping()
        self.refresh_mapping_list()
        self.select_mapping(map_id)

    def on_mapping_select(self, event=None):
        sel = self.maps_tv.selection()
        if not sel:
            self.cur_map = None
            self.clear_editor()
            return
        map_id = sel[0]
        m = next((mm for mm in self.mapping.get("mappings", []) if mm.get("id") == map_id), None)
        self.cur_map = m
        self.render_editor(m)

    def clear_editor(self):
        for w in self.editor.winfo_children():
            w.destroy()

    def render_editor(self, m: dict):
        self.clear_editor()
        if not m:
            return
        ttk.Label(self.editor, text=f"Mapping: {m.get('source')} -> {m.get('target')}", font=("Segoe UI", 11, "bold")).pack(anchor=tk.W, pady=(0,6))
        t = m.get("type")
        if t == "Numeric (multiplier)":
            frm = ttk.Frame(self.editor); frm.pack(anchor=tk.W)
            ttk.Label(frm, text="multiplier").grid(row=0, column=0, sticky=tk.W)
            mul = tk.StringVar(value=str(m.get("multiplier", 1.0)))
            ent = ttk.Entry(frm, textvariable=mul, width=12)
            ent.grid(row=0, column=1, sticky=tk.W, padx=(6,0))
            lg = tk.BooleanVar(value=bool(m.get("log", False)))
            chk = ttk.Checkbutton(frm, text="log10", variable=lg)
            chk.grid(row=0, column=2, sticky=tk.W, padx=(12,0))
            def _num_changed(*_):
                try:
                    m["multiplier"] = float(mul.get())
                except Exception:
                    # do not overwrite with junk; ignore until valid
                    return
                m["log"] = bool(lg.get())
                self.save_mapping()
            mul.trace_add('write', _num_changed)
            lg.trace_add('write', _num_changed)
        elif t == "Categorical (bins)":
            src = m.get("source") or ""
            tokens = list(self.tokens_by_source.get(src, []))
            if not tokens:
                ttk.Label(self.editor, text="No tokens discovered for this source. Reload CSVs after fetching more data.").pack(anchor=tk.W)
            # table header
            head = ttk.Frame(self.editor); head.pack(fill=tk.X)
            ttk.Label(head, text="token", width=40).grid(row=0, column=0, sticky=tk.W)
            ttk.Label(head, text="persona value", width=40).grid(row=0, column=1, sticky=tk.W)
            grid = ttk.Frame(self.editor); grid.pack(fill=tk.BOTH, expand=True)
            bins = m.setdefault("bins", {})
            self._bin_vars = []
            for r, tok in enumerate(tokens):
                ttk.Label(grid, text=tok, width=40).grid(row=r, column=0, sticky=tk.W)
                val = tk.StringVar(value=bins.get(tok, ""))
                ent = ttk.Entry(grid, textvariable=val, width=46)
                ent.grid(row=r, column=1, sticky=tk.W, pady=1)
                self._bin_vars.append((tok, val))
                def _mk_cb(token_ref: str, var_ref: tk.StringVar):
                    def _on_change(*_):
                        m.setdefault("bins", {})[token_ref] = var_ref.get().strip()
                        self.save_mapping()
                    return _on_change
                val.trace_add('write', _mk_cb(tok, val))
            # Autosave engaged via per-row traces; no extra Apply button needed
        else:
            ttk.Label(self.editor, text="(no editor)" ).pack(anchor=tk.W)

    def select_mapping(self, map_id: str):
        try:
            self.maps_tv.selection_set(map_id)
            self.maps_tv.see(map_id)
            self.on_mapping_select()
        except Exception:
            pass

    def _append(self, line: str):
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, line)
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)


if __name__ == "__main__":
    root = tk.Tk()
    LauncherUI(root)
    root.mainloop()
