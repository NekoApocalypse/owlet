"""Session-only SSH bridge. No service, listener on TCP, or persistent install."""
import base64
import concurrent.futures
import fcntl
import hashlib
import json
import os
import pty
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import uuid
import urllib.parse
import stat as stat_module

output_lock = threading.Lock()
terminals = {}
terminal_pending = {}
terminal_lock = threading.Lock()
def session_directory():
    # Keep operating when the server's root volume is full. All candidates are
    # user-writable temporary parents; nothing is installed or changed globally.
    for parent in [os.environ.get("OWLET_TMPDIR") or os.environ.get("LWR_TMPDIR"), "/tmp", "/var/tmp", "/mnt/FAST", os.path.expanduser("~")]:
        if not parent:
            continue
        try:
            info = os.statvfs(parent)
            if info.f_bavail * info.f_frsize < 64 * 1024 * 1024:
                continue
            return tempfile.mkdtemp(prefix="lwr-%s-" % os.getuid(), dir=parent)
        except OSError:
            continue
    raise RuntimeError("No writable temporary location with 64 MiB free. Set remote LWR_TMPDIR to an available directory.")

session_dir = session_directory()
socket_path = os.path.join(session_dir, "open.sock")
bin_dir = os.path.join(session_dir, "bin")
os.mkdir(bin_dir)
stopping = False
MAX_TEXT = 4 * 1024 * 1024
MAX_IMAGE = 16 * 1024 * 1024
snapshots = {}
snapshot_lock = threading.Lock()
save_lock = threading.Lock()

def put_snapshot(data):
    with snapshot_lock:
        if sum(len(item) for item in snapshots.values()) + len(data) > 64 * 1024 * 1024:
            raise ValueError("Transfer queue full; try again when current transfers finish")
        token = uuid.uuid4().hex
        snapshots[token] = data
        return token

def stat_file(path):
    path = resolve(path)
    info = os.stat(path)
    return {"path": path, "directory": os.path.isdir(path), "size": info.st_size,
            "stamp": str(info.st_mtime_ns) + ":" + str(info.st_ctime_ns) + ":" + str(info.st_size)}

def image_path(args):
    if "source" not in args:
        return resolve(args["path"])
    source = args.get("source", args.get("path", ""))
    parsed = urllib.parse.urlsplit(source)
    if parsed.scheme or parsed.netloc:
        raise ValueError("Online and local-device image URLs are not loaded")
    source = urllib.parse.unquote(parsed.path)
    base = os.path.dirname(resolve(args.get("document", args.get("path", "/"))))
    root = resolve(args.get("root", base))
    candidates = []
    if source.startswith("/"):
        candidates = [resolve(source)]
    elif source.startswith("./") or source.startswith("../"):
        candidates = [os.path.normpath(os.path.join(base, source))]
    else:
        candidates.append(os.path.normpath(os.path.join(base, source)))
        if os.path.commonpath([root, base]) == root:
            while base != root:
                base = os.path.dirname(base)
                candidates.append(os.path.normpath(os.path.join(base, source)))
        else:
            candidates.append(os.path.normpath(os.path.join(root, source)))
    for candidate in dict.fromkeys(candidates):
        if os.path.isfile(candidate):
            return candidate
    raise ValueError("Image not found. Tried: " + " | ".join(candidates))

def open_snapshot(args, image=False):
    path = image_path(args) if image else resolve(args["path"])
    limit = MAX_IMAGE if image else MAX_TEXT
    before = stat_file(path)
    with open(path, "rb") as file:
        data = file.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Images are limited to 16 MiB" if image else "Text files are limited to 4 MiB")
    mime = None
    if image:
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".bmp": "image/bmp"}.get(os.path.splitext(path)[1].lower())
        if not mime:
            raise ValueError("Unsupported image format (SVG opens as source)")
    else:
        if b"\x00" in data:
            raise ValueError("This appears to be a binary file")
        data.decode("utf-8")
    # A changing file will be retried by the user/poller, never silently cached as current.
    if stat_file(path)["stamp"] != before["stamp"]:
        raise ValueError("File changed while reading; try again")
    return {"path": path, "token": put_snapshot(data), "size": len(data), "revision": revision(data), "stamp": before["stamp"], "mime": mime}

def emit(value):
    with output_lock:
        sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
        sys.stdout.flush()

def resolve(path):
    if not isinstance(path, str) or "\x00" in path:
        raise ValueError("Invalid path")
    return os.path.abspath(os.path.expanduser(path))

def revision(data):
    return hashlib.sha256(data).hexdigest()

def read_text(path):
    path = resolve(path)
    with open(path, "rb") as file:
        data = file.read(MAX_TEXT + 1)
    if len(data) > MAX_TEXT:
        raise ValueError("Text files are limited to 4 MiB in this preview")
    if b"\x00" in data:
        raise ValueError("This appears to be a binary file")
    return {"path": path, "text": data.decode("utf-8"), "revision": revision(data)}

def list_dir(path, offset=0):
    path = resolve(path)
    entries = []
    with os.scandir(path) as directory:
        for index, entry in enumerate(directory):
            if index < offset:
                continue
            try:
                directory_entry = entry.is_dir()
                entries.append({"name": entry.name, "path": entry.path, "directory": directory_entry, "symlink": entry.is_symlink()})
            except OSError:
                continue
            if len(entries) >= 101:
                break
    more = len(entries) > 100
    entries = entries[:100]
    entries.sort(key=lambda item: (not item["directory"], item["name"].lower()))
    return {"path": path, "entries": entries, "next": offset + 100 if more else None}

def save_file(args):
    path = os.path.realpath(resolve(args["path"]))
    # Respect symlinks, preserve permissions, and refuse an observed stale version.
    with open(path, "rb") as file:
        original = file.read(MAX_TEXT + 1)
    if revision(original) != args.get("revision"):
        raise ValueError("CONFLICT: The remote file changed. Compare or reload before saving.")
    data = args["text"].encode("utf-8")
    if len(data) > MAX_TEXT:
        raise ValueError("Text files are limited to 4 MiB")
    fd, temporary = tempfile.mkstemp(prefix=".lwr-save-", dir=os.path.dirname(path))
    try:
        os.fchmod(fd, os.stat(path).st_mode & 0o777)
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        with open(path, "rb") as file:
            if revision(file.read(MAX_TEXT + 1)) != args.get("revision"):
                raise ValueError("CONFLICT: The remote file changed during save.")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"revision": revision(data), "stamp": stat_file(path)["stamp"]}

def import_peacock(args):
    # This is the only operation that reads VS Code settings. Never called at startup.
    path = os.path.join(resolve(args["root"]), ".vscode", "settings.json")
    with open(path, "rb") as file:
        raw = file.read(65537)
    if len(raw) > 65536:
        raise ValueError("VS Code settings import is limited to 64 KiB")
    text = raw.decode("utf-8-sig")
    # JSONC: preserve quoted strings, removing comments and trailing commas only
    # outside strings (URLs and escaped quotes must survive).
    tokens = r'"(?:[^"\\]|\\.)*"|//[^\r\n]*|/\*[\s\S]*?\*/'
    text = re.sub(tokens, lambda match: match.group(0) if match.group(0).startswith('"') else ' ', text)
    text = re.sub(r'"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])',
                  lambda match: match.group(0) if match.group(0).startswith('"') else '', text)
    settings = json.loads(text)
    if not isinstance(settings, dict):
        raise ValueError("VS Code settings must be an object")
    field = "peacock.remoteColor" if settings.get("peacock.remoteColor") else "peacock.color"
    color = settings.get(field)
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("No six-digit peacock.remoteColor or peacock.color found in .vscode/settings.json")
    return {"color": color.lower(), "source": path, "field": field}

def project_settings(args, write=False):
    root = os.path.realpath(resolve(args["root"]))
    if not os.path.isdir(root):
        raise ValueError("Project root must be a directory")
    directory = os.path.join(root, ".owlet")
    path = os.path.join(directory, "settings.json")
    if os.path.islink(directory) or os.path.islink(path):
        raise ValueError("Project settings must not be symlinks")
    try:
        with open(path, "rb") as file:
            raw = file.read(16385)
        if len(raw) > 16384:
            raise ValueError("Project settings are limited to 16 KiB")
        settings = json.loads(raw.decode("utf-8"))
        current_revision = revision(raw)
    except FileNotFoundError:
        settings, current_revision = {}, None
    if not isinstance(settings, dict):
        raise ValueError("Project settings must be a JSON object")
    color = settings.get("peacock.color")
    if color is not None and (not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
        raise ValueError("peacock.color must be a #RRGGBB color")
    if write:
        if "revision" not in args or args["revision"] != current_revision:
            raise ValueError("CONFLICT: Project settings changed. Reload settings before saving.")
        color = args.get("color")
        if color is not None and (not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
            raise ValueError("Use a #RRGGBB color")
        if color is None:
            settings.pop("peacock.color", None)
        else:
            settings["peacock.color"] = color.lower()
        text = json.dumps(settings, ensure_ascii=False, indent=2) + "\n"
        if len(text.encode("utf-8")) > 16384:
            raise ValueError("Project settings are limited to 16 KiB")
        if current_revision is not None:
            save_file({"path": path, "text": text, "revision": current_revision})
        elif color is not None:
            os.makedirs(directory, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".settings-", dir=directory)
            try:
                with os.fdopen(fd, "wb") as file:
                    file.write(text.encode("utf-8"))
                    file.flush()
                    os.fsync(file.fileno())
                # Atomic create-if-absent: never replace a newly created agent config.
                os.link(temporary, path)
            finally:
                os.unlink(temporary)
        return project_settings(args)
    return {"path": path, "color": color, "revision": current_revision,
            "stamp": stat_file(path)["stamp"] if current_revision is not None else None}

def terminal_output(identifier, process, fd):
    try:
        while True:
            data = os.read(fd, 2048)
            if not data:
                break
            emit({"event": "terminal-data", "terminal": identifier, "data": base64.b64encode(data).decode("ascii")})
    except OSError:
        pass
    finally:
        with terminal_lock:
            terminals.pop(identifier, None)
            terminal_pending.pop(identifier, None)
        try:
            os.close(fd)
        except OSError:
            pass
        status = process.wait()
        emit({"event": "terminal-exit", "terminal": identifier, "status": status})

def start_terminal(args):
    identifier = args["terminal"]
    cwd = resolve(args["path"])
    if not os.path.isdir(cwd):
        raise ValueError("Terminal working directory does not exist")
    rows = max(1, min(1000, int(args.get("rows", 24))))
    cols = max(1, min(1000, int(args.get("cols", 80))))
    with terminal_lock:
        if identifier in terminals:
            raise ValueError("Terminal already exists")
        # Do not run Python after fork() in this multithreaded helper. A fresh,
        # single-threaded interpreter acquires the controlling PTY and execs Bash.
        fd, slave = pty.openpty()
        environment = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", LWR_SOCKET=socket_path, TMPDIR=session_dir, LWR_TERMINAL_ID=identifier)
        # A full root disk makes pyenv's startup rehash retry its lock for 60s.
        # Bound that wait in this shell only; respect an explicitly set timeout.
        environment.setdefault("PYENV_REHASH_TIMEOUT", "2")
        child_code = 'import os,sys,fcntl,termios;fcntl.ioctl(0,termios.TIOCSCTTY,0);os.execv("/bin/bash",["bash","--rcfile",sys.argv[1],"-i"])'
        try:
            process = subprocess.Popen([sys.executable, "-c", child_code, os.path.join(session_dir, "bashrc")], stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=environment, start_new_session=True, close_fds=True)
        except Exception:
            os.close(fd)
            raise
        finally:
            os.close(slave)
        pid = process.pid
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        terminals[identifier] = (pid, fd)
        terminal_pending[identifier] = bytearray()
    threading.Thread(target=terminal_output, args=(identifier, process, fd), daemon=True).start()
    return {"terminal": identifier}

uploads = {}
downloads = {}

def fs_scoped(root, path, allow_root=False):
    if not isinstance(root, str) or not isinstance(path, str) or not os.path.isabs(root) or not os.path.isabs(path) or "\x00" in path:
        raise ValueError("Choose an absolute workspace path")
    root, path = os.path.abspath(root), os.path.abspath(path)
    if os.path.commonpath([root, path]) != root or (not allow_root and path == root):
        raise ValueError("Choose an item inside the workspace; the root cannot be changed")
    parent = os.path.realpath(path if allow_root else os.path.dirname(path))
    if os.path.commonpath([os.path.realpath(root), parent]) != os.path.realpath(root):
        raise ValueError("This path leaves the workspace through a symbolic link")
    return path

def fs_name(directory, name):
    if not isinstance(name, str) or not name.strip() or name in (".", "..") or any(c in name for c in ("/", "\\", "\x00")) or len(name) > 255:
        raise ValueError("Enter a single file or folder name")
    return os.path.join(directory, name)

def fs_info(path):
    s = os.lstat(path)
    return {"path": path, "directory": stat_module.S_ISDIR(s.st_mode), "symlink": stat_module.S_ISLNK(s.st_mode), "revision": f"{s.st_dev}:{s.st_ino}:{s.st_mtime_ns}:{s.st_ctime_ns}:{s.st_size}", "size": s.st_size}

def move_no_replace(path, destination):
    # Linux renameat2 supplies atomic no-replace for directories and symlinks.
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None: raise ValueError("Safe moves require renameat2 on this server")
    if rename(-100, os.fsencode(path), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), destination)

def copy_tree(source, destination, budget):
    budget[0] += 1
    if budget[0] > 20000: raise ValueError('Copy is limited to 20,000 files and folders at a time')
    before = fs_info(source)
    if before['symlink']: raise ValueError('Copying symbolic links is not supported yet')
    if before['directory']:
        os.mkdir(destination)
        for name in os.listdir(source): copy_tree(os.path.join(source,name), os.path.join(destination,name), budget)
    else:
        if not stat_module.S_ISREG(os.lstat(source).st_mode): raise ValueError('Copy regular files and folders only')
        shutil.copy2(source, destination)
    if fs_info(source)['revision'] != before['revision']: raise ValueError('Source changed during copy; retry')

def fs_operation(args):
    op = args["op"]
    if op in ("create-file", "create-folder"):
        path = fs_name(fs_scoped(args["root"], args["directory"], True), args["name"])
        if op == "create-folder": os.mkdir(path)
        else:
            with open(path, "xb"): pass
        return fs_info(path)
    path = fs_scoped(args["root"], args["path"])
    current = fs_info(path)
    if op == "inspect": return current
    if args.get("revision") != current["revision"]:
        raise ValueError("The selected item changed. Review the action again")
    if op == "copy":
        destination = fs_scoped(args['root'], args['destination'])
        if os.path.commonpath([path,destination]) == path: raise ValueError('A folder cannot be copied into itself')
        if os.path.lexists(destination): raise ValueError('Destination already exists. Choose another name')
        staging = tempfile.mkdtemp(prefix='.owlet-copy-',dir=os.path.dirname(destination))
        try:
            copied = os.path.join(staging,'content')
            copy_tree(path,copied,[0])
            move_no_replace(copied,destination)
            return fs_info(destination)
        finally: shutil.rmtree(staging,ignore_errors=True)
    if op == "delete":
        if current["directory"] and not current["symlink"]: shutil.rmtree(path)
        else: os.unlink(path)
        return {"path": path}
    if op == "move":
        destination = fs_scoped(args["root"], args["destination"])
        if os.path.commonpath([path, destination]) == path: raise ValueError("A folder cannot be moved into itself")
        if os.path.lexists(destination): raise ValueError("Destination already exists. Choose another name")
        move_no_replace(path, destination)
        return {**fs_info(destination), "previous": path}
    raise ValueError("Unsupported file action")

def file_transfer(method, args):
    if method == "upload-start":
        if len(uploads) >= 4: raise ValueError("Too many transfers")
        size = args["size"]
        if not isinstance(size, int) or size < 0: raise ValueError("Invalid file size")
        directory = fs_scoped(args["root"], args["directory"], True)
        destination = fs_name(directory, args["name"])
        if os.path.lexists(destination): raise ValueError("Destination already exists. Choose another name")
        token = uuid.uuid4().hex
        temp = os.path.join(directory, ".owlet-upload-" + token)
        file = open(temp, "xb")
        uploads[token] = {"file": file, "temp": temp, "destination": destination, "size": size, "offset": 0}
        return {"token": token}
    if method.startswith("upload-"):
        item = uploads[args["token"]]
        if method == "upload-chunk":
            data = base64.b64decode(args["data"], validate=True)
            if args["offset"] != item["offset"] or len(data) > 16384 or item["offset"] + len(data) > item["size"]: raise ValueError("Invalid upload chunk")
            item["file"].write(data)
            item["offset"] += len(data)
            return {"offset": item["offset"]}
        try:
            if method == "upload-finish":
                if item["offset"] != item["size"]: raise ValueError("Incomplete upload")
                item["file"].flush()
                os.fsync(item["file"].fileno())
                os.link(item["temp"], item["destination"])
                return {"path": item["destination"]}
            if method != "upload-abort": raise ValueError("Unknown transfer action")
        finally:
            item["file"].close()
            os.unlink(item["temp"])
            uploads.pop(args["token"], None)
        return None
    if method == "download-open":
        if len(downloads) >= 4: raise ValueError("Too many transfers")
        path = fs_scoped(args["root"], args["path"])
        before = fs_info(path)
        if before["symlink"] or before["directory"]: raise ValueError("Download a regular file, not a folder or symbolic link")
        file = os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW), "rb")
        if not stat_module.S_ISREG(os.fstat(file.fileno()).st_mode):
            file.close()
            raise ValueError("Download a regular file")
        token = uuid.uuid4().hex
        downloads[token] = {"file": file, "path": path, "revision": before["revision"], "size": before["size"]}
        return {"token": token, "size": before["size"]}
    if method.startswith("download-"):
        item = downloads[args["token"]]
        if method == "download-chunk":
            item["file"].seek(max(0, int(args["offset"])))
            return {"data": base64.b64encode(item["file"].read(16384)).decode("ascii")}
        try:
            if method == "download-finish" and fs_info(item["path"])["revision"] != item["revision"]:
                raise ValueError("File changed during download; retry")
        finally:
            item["file"].close()
            downloads.pop(args["token"], None)
        return None
    raise ValueError("Unsupported transfer action")

def dispatch(method, args):
    if method == "fs-operation":
        with save_lock: return fs_operation(args)
    if method.startswith(("upload-", "download-")):
        with save_lock: return file_transfer(method, args)
    if method == "import-peacock":
        return import_peacock(args)
    if method == "project-settings":
        return project_settings(args)
    if method == "project-color":
        with save_lock:
            return project_settings(args, write=True)
    if method == "list":
        return list_dir(args["path"], max(0, int(args.get("offset", 0))))
    if method == "read-open" or method == "image-open":
        return open_snapshot(args, method == "image-open")
    if method == "file-chunk":
        with snapshot_lock:
            data = snapshots[args["token"]]
            offset = max(0, int(args["offset"]))
            return {"data": base64.b64encode(data[offset:offset + 8192]).decode("ascii")}
    if method == "file-release":
        with snapshot_lock:
            snapshots.pop(args["token"], None)
        return None
    if method == "save":
        with save_lock:
            return save_file(args)
    if method == "stat":
        return stat_file(args["path"])
    if method == "stats":
        results = []
        for path in args["paths"][:200]:
            try:
                results.append(stat_file(path))
            except OSError as error:
                results.append({"path": path, "error": str(error)})
        return results
    if method == "terminal-start":
        return start_terminal(args)
    if method == "terminal-input":
        with terminal_lock:
            pair = terminals.get(args["terminal"])
            data = base64.b64decode(args["data"])
            pending = terminal_pending.get(args["terminal"])
            if pair and pending is not None:
                if len(pending) + len(data) <= 65536:
                    pending.extend(data)
            elif pair:
                os.write(pair[1], data)
        return None
    if method == "terminal-resize":
        with terminal_lock:
            pair = terminals.get(args["terminal"])
        if pair:
            rows = max(1, min(1000, int(args["rows"])))
            cols = max(1, min(1000, int(args["cols"])))
            fcntl.ioctl(pair[1], termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        return None
    if method == "terminal-close":
        with terminal_lock:
            pair = terminals.get(args["terminal"])
        if pair:
            try:
                os.killpg(pair[0], signal.SIGHUP)
            except ProcessLookupError:
                pass
        return None
    raise ValueError("Unknown method: " + str(method))

def handle(request):
    try:
        result = dispatch(request["method"], request.get("args", {}))
        if "id" in request:
            emit({"id": request["id"], "result": result})
    except Exception as error:
        if "id" in request:
            emit({"id": request["id"], "error": str(error)})

launcher = '''#!/usr/bin/env python3
import json, os, socket, sys
path = os.path.abspath(os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "."))
try:
    client = socket.socket(socket.AF_UNIX)
    client.settimeout(5)
    client.connect(os.environ.get("OWLET_SOCKET") or os.environ.get("LWR_SOCKET", ""))
    message = {"terminalReady": os.environ.get("LWR_TERMINAL_ID")} if sys.argv[1:] == ["--session-ready"] else {"path": path, "cwd": os.getcwd()}
    client.sendall((json.dumps(message) + "\\n").encode())
    reply = client.recv(4096).decode()
    if reply != "ok":
        raise RuntimeError(reply)
except Exception as error:
    print("owlet: " + str(error) + ". Run from a connected Owlet terminal.", file=sys.stderr)
    sys.exit(1)
'''
for name in ["owlet", "lwr"]:
    with open(os.path.join(bin_dir, name), "w") as file:
        file.write(launcher)
    os.chmod(os.path.join(bin_dir, name), 0o700)
with open(os.path.join(session_dir, "bashrc"), "w") as file:
    file.write('[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n')
    file.write("export PATH=" + repr(bin_dir) + ':"$PATH"\n')
    file.write("export LWR_SOCKET=" + repr(socket_path) + "\n")
    file.write("export OWLET_SOCKET=" + repr(socket_path) + "\n")
    file.write(repr(os.path.join(bin_dir, "owlet")) + " --session-ready\n")

listener = socket.socket(socket.AF_UNIX)
listener.bind(socket_path)
os.chmod(socket_path, 0o600)
listener.listen(8)
listener.settimeout(1)

def accept_opens():
    while not stopping:
        try:
            connection, _ = listener.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        with connection:
            connection.settimeout(3)
            try:
                payload = b""
                while b"\n" not in payload and len(payload) < 16384:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    payload += chunk
                request = json.loads(payload)
                if "terminalReady" in request:
                    identifier = request["terminalReady"]
                    with terminal_lock:
                        pending = terminal_pending.pop(identifier, None)
                        pair = terminals.get(identifier)
                        if pair and pending:
                            os.write(pair[1], pending)
                    connection.sendall(b"ok")
                    emit({"event": "terminal-ready", "terminal": identifier})
                    continue
                path = resolve(request["path"])
                if not os.path.exists(path):
                    raise ValueError("Path does not exist")
                emit({"event": "open", "path": path, "cwd": resolve(request.get("cwd", os.path.dirname(path))), "directory": os.path.isdir(path)})
                connection.sendall(b"ok")
            except Exception as error:
                try:
                    connection.sendall(str(error).encode())
                except OSError:
                    pass

threading.Thread(target=accept_opens, daemon=True).start()
emit({"event": "ready", "home": os.path.expanduser("~"), "socket": socket_path, "platform": sys.platform})
pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
try:
    for line in sys.stdin:
        request = json.loads(line)
        if request.get("method", "").startswith("terminal-"):
            handle(request)
        else:
            pool.submit(handle, request)
finally:
    stopping = True
    listener.close()
    for pid, fd in list(terminals.values()):
        try:
            os.killpg(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
    pool.shutdown(wait=True)
    for token in list(uploads):
        try: file_transfer("upload-abort", {"token": token})
        except OSError: pass
    for item in downloads.values(): item["file"].close()
    shutil.rmtree(session_dir, ignore_errors=True)
