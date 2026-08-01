#!/usr/bin/env python3

import argparse
import copy
from contextlib import contextmanager
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import sys
import select
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import fcntl as _fcntl
except ImportError:  # pragma: no cover - exercised on non-POSIX Python
    _fcntl = None

REPOSITORY = "sweetcornna/mathodology"
DEFAULT_REF = "main"
DOWNLOAD_ENV = "SEARCH_MCP_DOWNLOAD_DIR"
DOWNLOAD_DIR = "~/.cache/search-mcp/downloads"
CONTRACT_TOKENS = (
    "dual-source-default: WebSearch + mcp__search__search",
    "single-source-mode: explicit degradation",
    "search_backend: combined",
)
DOWNLOAD_CONTRACT_TOKENS = (
    "mcp__search__download",
    "SEARCH_MCP_DOWNLOAD_DIR",
)
LEGACY_CONTRACT_TOKENS = (
    "is the primary evidence toolchain",
    "use them as the primary path",
    "Do not use `download`. It is disabled by default",
)
REQUIRED_AGENT_TOOLS = (
    "WebSearch",
    "mcp__search__search",
    "mcp__search__download",
)
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 4096
INSTALL_TIMEOUT_SECONDS = 15 * 60
INSTALL_TERM_GRACE_SECONDS = 1
INSTALL_REAP_TIMEOUT_SECONDS = 10
INSTALL_LOG_TAIL_BYTES = 64 * 1024
MCP_REFRESH_TIMEOUT_SECONDS = 120
GIT_REMOTE_TIMEOUT_SECONDS = 15

_GROUP_SUPERVISOR_PROGRAM = """
import json
import os
import subprocess
import sys
import time

status_fd = int(sys.argv[1])
command = json.loads(sys.argv[2])
try:
    child = subprocess.Popen(command)
    payload = {"returncode": child.wait()}
except OSError as exc:
    payload = {"error": str(exc), "errno": exc.errno}
os.write(status_fd, (json.dumps(payload) + "\\n").encode("utf-8"))
os.close(status_fd)
while True:
    time.sleep(3600)
"""


class UpdateError(Exception):
    pass


class ConfigurationError(UpdateError):
    pass


class SnapshotError(UpdateError):
    pass


class RollbackError(UpdateError):
    def __init__(self, original_error, rollback_error, phase):
        self.original_error = original_error
        self.rollback_error = rollback_error
        self.phase = phase
        super().__init__(
            f"{phase}: {type(rollback_error).__name__}: {rollback_error}; "
            f"original failure: {type(original_error).__name__}: {original_error}"
        )


def note(message):
    print(f"mathodology-update: {message}", file=sys.stderr)


def _resolved_project_path(project):
    expanded = Path(project).expanduser()
    return Path(os.path.realpath(os.path.abspath(os.fspath(expanded))))


def _project_lock_path(project):
    resolved = _resolved_project_path(project)
    try:
        project_stat = resolved.stat()
    except OSError as exc:
        raise UpdateError(f"cannot identify project for update locking: {resolved}: {exc}") from exc
    if project_stat.st_ino:
        key = f"inode:{project_stat.st_dev}:{project_stat.st_ino}"
    else:
        key = f"path:{os.path.normcase(os.fspath(resolved))}"
    digest = hashlib.sha256(os.fsencode(key)).hexdigest()
    return Path(tempfile.gettempdir()) / f"mathodology-update-{digest}.lock"


def _lock_open_flags(exclusive):
    flags = os.O_WRONLY if exclusive else os.O_RDWR
    flags |= os.O_CREAT
    if exclusive:
        flags |= os.O_EXCL
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    return flags


def _raise_lock_busy(resolved, lock_path, cause):
    raise UpdateError(
        f"another update is already running for {resolved} "
        f"(lock: {lock_path})"
    ) from cause


def _close_lock_descriptor(descriptor, lock_path):
    try:
        os.close(descriptor)
    except OSError as exc:
        note(f"update lock descriptor could not be closed ({lock_path}: {exc})")


@contextmanager
def _project_update_lock(project):
    resolved = _resolved_project_path(project)
    lock_path = _project_lock_path(resolved)
    lock_api = _fcntl if os.name == "posix" else None
    if lock_api is not None:
        try:
            descriptor = os.open(lock_path, _lock_open_flags(exclusive=False), 0o600)
        except OSError as exc:
            raise UpdateError(
                f"cannot open update lock for {resolved} at {lock_path}: {exc}"
            ) from exc
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise UpdateError(f"update lock is not a regular file: {lock_path}")
            try:
                lock_api.flock(descriptor, lock_api.LOCK_EX | lock_api.LOCK_NB)
            except OSError as exc:
                if exc.errno in (errno.EACCES, errno.EAGAIN):
                    _raise_lock_busy(resolved, lock_path, exc)
                raise UpdateError(
                    f"cannot acquire update lock for {resolved} at {lock_path}: {exc}"
                ) from exc
            yield resolved
        finally:
            _close_lock_descriptor(descriptor, lock_path)
        return

    try:
        descriptor = os.open(lock_path, _lock_open_flags(exclusive=True), 0o600)
    except FileExistsError as exc:
        _raise_lock_busy(resolved, lock_path, exc)
    except OSError as exc:
        raise UpdateError(
            f"cannot create update lock for {resolved} at {lock_path}: {exc}"
        ) from exc
    try:
        metadata = f"pid={os.getpid()}\nproject={resolved}\n".encode("utf-8")
        try:
            os.write(descriptor, metadata)
        except OSError:
            pass
        yield resolved
    finally:
        _close_lock_descriptor(descriptor, lock_path)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            note(f"fallback update lock could not be removed ({lock_path}: {exc})")


def _request(url):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "mathodology-project-updater",
    }
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=headers)


def resolve_ref(ref):
    if len(ref) == 40 and all(ch in "0123456789abcdefABCDEF" for ch in ref):
        return ref.lower()
    encoded = urllib.parse.quote(ref, safe="")
    url = f"https://api.github.com/repos/{REPOSITORY}/commits/{encoded}"
    try:
        with urllib.request.urlopen(_request(url), timeout=30) as response:
            payload = json.load(response)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise UpdateError(f"cannot resolve ref {ref!r}: {exc}") from exc
    sha = payload.get("sha") if isinstance(payload, dict) else None
    if not isinstance(sha, str) or len(sha) != 40:
        raise UpdateError(f"GitHub returned no immutable commit for ref {ref!r}")
    return sha.lower()


def download_archive(sha, destination):
    url = _archive_source(sha)
    try:
        with urllib.request.urlopen(_request(url), timeout=60) as response:
            with destination.open("wb") as output:
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ARCHIVE_BYTES:
                        raise SnapshotError("source archive exceeds 50 MiB")
                    output.write(chunk)
    except (OSError, urllib.error.URLError) as exc:
        raise UpdateError(f"cannot download commit {sha}: {exc}") from exc


def _archive_relative(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise SnapshotError(f"unsafe archive member: {name}")
    if len(path.parts) < 2:
        return PurePosixPath()
    return PurePosixPath(*path.parts[1:])


def _wanted_snapshot_path(relative):
    if not relative.parts:
        return False
    text = relative.as_posix()
    if text == ".mcp.json":
        return True
    if text.startswith(".claude/skills/mathodology-"):
        return True
    if text.startswith(".claude/agents/mathodology-"):
        return True
    if text.startswith(".claude/workflows/mathodology-"):
        return True
    return False


def _extract_snapshot(archive, destination):
    total = 0
    try:
        source = tarfile.open(archive, "r:gz")
    except (OSError, tarfile.TarError) as exc:
        raise SnapshotError(f"cannot read source archive: {exc}") from exc
    with source:
        member_count = 0
        while True:
            member = source.next()
            if member is None:
                break
            member_count += 1
            if member_count > MAX_ARCHIVE_MEMBERS:
                raise SnapshotError(
                    f"source archive exceeds {MAX_ARCHIVE_MEMBERS} members"
                )
            source.members.clear()
            relative = _archive_relative(member.name)
            if not _wanted_snapshot_path(relative):
                continue
            if member.issym() or member.islnk() or member.isdev():
                raise SnapshotError(f"snapshot contains unsupported link or device: {member.name}")
            target = destination.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            total += member.size
            if total > MAX_EXTRACTED_BYTES:
                raise SnapshotError("selected snapshot content exceeds 100 MiB")
            target.parent.mkdir(parents=True, exist_ok=True)
            extracted = source.extractfile(member)
            if extracted is None:
                raise SnapshotError(f"cannot extract snapshot member: {member.name}")
            with extracted, target.open("wb") as output:
                remaining = member.size
                while remaining:
                    chunk = extracted.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise SnapshotError(f"truncated snapshot member: {member.name}")
                    output.write(chunk)
                    remaining -= len(chunk)
                if extracted.read(1):
                    raise SnapshotError(f"snapshot member exceeds declared size: {member.name}")
            os.chmod(target, member.mode & 0o777)
    return inspect_snapshot(destination)


def extract_snapshot(archive, destination):
    staging = Path(
        tempfile.mkdtemp(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
        )
    )
    try:
        try:
            inventory = _extract_snapshot(archive, staging)
        except SnapshotError:
            raise
        except (OSError, tarfile.TarError) as exc:
            raise SnapshotError(f"cannot extract source archive: {exc}") from exc
        _remove(destination)
        os.replace(staging, destination)
        return inventory
    finally:
        _remove(staging)


def _update_digest_from_file(digest, path):
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                return
            digest.update(chunk)


def _sha256_file(path):
    digest = hashlib.sha256()
    _update_digest_from_file(digest, path)
    return digest.hexdigest()


def compute_skill_folder_hashes(skills_root, names):
    if not names:
        return {}
    paths = {}
    files = {}
    for name in names:
        skill_dir = skills_root / name
        relative_paths = []
        for path in skill_dir.rglob("*"):
            relative = path.relative_to(skill_dir)
            if ".git" in relative.parts or "node_modules" in relative.parts:
                continue
            if path.is_file() and not path.is_symlink():
                relative_text = relative.as_posix()
                relative_paths.append(relative_text)
                files[(name, relative_text)] = path
        paths[name] = relative_paths
    node = shutil.which("node")
    if not node:
        raise ConfigurationError("Node.js is required to compute skills CLI-compatible hashes")
    program = (
        "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{"
        "const p=JSON.parse(s);for(const k of Object.keys(p))"
        "p[k].sort((a,b)=>a.localeCompare(b));process.stdout.write(JSON.stringify(p))})"
    )
    try:
        completed = subprocess.run(
            [node, "-e", program],
            input=json.dumps(paths),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise UpdateError(f"Node.js could not order skill files for hashing: {exc}") from exc
    if completed.returncode != 0:
        raise UpdateError("Node.js could not order skill files for hashing")
    try:
        ordered = json.loads(completed.stdout)
    except ValueError as exc:
        raise UpdateError("Node.js returned invalid skill hash ordering") from exc
    if not isinstance(ordered, dict) or set(ordered) != set(paths):
        raise UpdateError("Node.js returned incomplete skill hash ordering")
    hashes = {}
    for name, relative_paths in ordered.items():
        if not isinstance(relative_paths, list) or sorted(relative_paths) != sorted(paths[name]):
            raise UpdateError(f"Node.js returned incomplete skill hash ordering for {name}")
        digest = hashlib.sha256()
        for relative in relative_paths:
            digest.update(relative.encode("utf-8"))
            _update_digest_from_file(digest, files[(name, relative)])
        hashes[name] = digest.hexdigest()
    return hashes


def inspect_snapshot(root):
    skills_root = root / ".claude" / "skills"
    agents_root = root / ".claude" / "agents"
    workflows_root = root / ".claude" / "workflows"
    skills = sorted(
        path.name
        for path in skills_root.glob("mathodology-*")
        if path.is_dir() and (path / "SKILL.md").is_file()
    )
    agents = sorted(path.name for path in agents_root.glob("mathodology-*.md") if path.is_file())
    workflows = sorted(
        path.name for path in workflows_root.glob("mathodology-*.md") if path.is_file()
    )
    if not skills:
        raise SnapshotError("snapshot contains no Mathodology skills")
    if not agents:
        raise SnapshotError("snapshot contains no Mathodology agents")
    if not workflows:
        raise SnapshotError("snapshot contains no Mathodology workflows")
    mcp = root / ".mcp.json"
    if not mcp.is_file():
        raise SnapshotError("snapshot is missing .mcp.json")
    try:
        shipped_mcp = json.loads(mcp.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SnapshotError(f"snapshot .mcp.json is invalid: {exc}") from exc
    search = shipped_mcp.get("mcpServers", {}).get("search", {})
    if not _canonical_search(search):
        raise SnapshotError("snapshot search MCP registration is not canonical")
    if not search.get("env", {}).get(DOWNLOAD_ENV):
        raise SnapshotError("snapshot search MCP registration does not enable download")
    return {
        "skills": skills,
        "skill_hashes": compute_skill_folder_hashes(skills_root, skills),
        "agents": agents,
        "agent_hashes": {
            name: _sha256_file(agents_root / name)
            for name in agents
        },
        "workflows": workflows,
        "workflow_hashes": {
            name: _sha256_file(workflows_root / name)
            for name in workflows
        },
        "mcp": shipped_mcp,
    }


def evidence_contract_state(project):
    skill = (
        project
        / ".claude"
        / "skills"
        / "mathodology-evidence-search"
        / "SKILL.md"
    )
    try:
        text = skill.read_text(encoding="utf-8")
    except OSError:
        return "absent"
    if all(token in text for token in CONTRACT_TOKENS):
        return "current"
    if all(token in text for token in DOWNLOAD_CONTRACT_TOKENS):
        return "download-aware"
    if all(token in text for token in LEGACY_CONTRACT_TOKENS):
        return "legacy"
    return "unknown"


def _canonical_search(search):
    return (
        isinstance(search, dict)
        and set(search).issubset({"command", "args", "env"})
        and search.get("command") == "uvx"
        and search.get("args") == ["free-search-mcp"]
    )


def _mcp_state(observed_status, action, data, result_status=None):
    return {
        "observed_status": observed_status,
        "action": action,
        "result_status": result_status or observed_status,
        "data": data,
    }


def classify_mcp(project):
    path = project / ".mcp.json"
    if path.is_symlink():
        raise ConfigurationError(".mcp.json must not be a symbolic link")
    if not path.exists():
        return _mcp_state("missing", "install", None, "installed")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigurationError(f"existing .mcp.json is invalid and was not changed: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigurationError("existing .mcp.json must contain a JSON object")
    servers = data.get("mcpServers")
    if servers is None:
        return _mcp_state("missing", "preserve", data)
    if not isinstance(servers, dict):
        raise ConfigurationError("existing .mcp.json mcpServers must be an object")
    search = servers.get("search")
    if search is None:
        return _mcp_state("missing", "preserve", data)
    if not _canonical_search(search):
        return _mcp_state("custom", "preserve", data)
    env = search.get("env")
    if env is not None and not isinstance(env, dict):
        return _mcp_state("custom", "preserve", data)
    if isinstance(env, dict) and set(env) - {DOWNLOAD_ENV}:
        return _mcp_state("custom", "preserve", data)
    if isinstance(env, dict) and DOWNLOAD_ENV in env:
        download_dir = env[DOWNLOAD_ENV]
        if isinstance(download_dir, str) and download_dir.strip():
            return _mcp_state("installed", "preserve", data)
        if download_dir in (None, ""):
            return _mcp_state("download-disabled", "preserve", data)
        return _mcp_state("custom", "preserve", data)
    if env:
        return _mcp_state("custom", "preserve", data)
    contract = evidence_contract_state(project)
    if contract == "legacy":
        migrated = copy.deepcopy(data)
        migrated.setdefault("mcpServers", {}).setdefault("search", {}).setdefault("env", {})[
            DOWNLOAD_ENV
        ] = DOWNLOAD_DIR
        return _mcp_state("legacy", "write", migrated, "migrated")
    if contract in ("current", "download-aware"):
        return _mcp_state("download-disabled", "preserve", data)
    return _mcp_state("missing", "preserve", data)


def _remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.is_dir():
        shutil.rmtree(path)


def _atomic_write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    temporary = Path(temporary_name)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(text)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=target.parent,
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_copytree(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
        )
    )
    try:
        shutil.copytree(source, temporary, dirs_exist_ok=True)
        os.replace(temporary, target)
    finally:
        _remove(temporary)


def _managed_paths(project):
    paths = []
    skills = project / ".claude" / "skills"
    agents = project / ".claude" / "agents"
    workflows = project / ".claude" / "workflows"
    if skills.is_dir():
        paths.extend(
            path
            for path in skills.glob("mathodology-*")
            if path.exists() or path.is_symlink()
        )
    if agents.is_dir():
        paths.extend(
            path
            for path in agents.glob("mathodology-*.md")
            if path.exists() or path.is_symlink()
        )
    if workflows.is_dir():
        paths.extend(
            path
            for path in workflows.glob("mathodology-*.md")
            if path.exists() or path.is_symlink()
        )
    paths.extend(
        path
        for path in (project / "skills-lock.json", project / ".mcp.json")
        if path.exists() or path.is_symlink()
    )
    return paths


def _reject_managed_symlinks(project):
    roots = (
        project / ".claude",
        project / ".claude" / "skills",
        project / ".claude" / "agents",
        project / ".claude" / "workflows",
    )
    for path in roots:
        if path.is_symlink():
            raise ConfigurationError(f"managed root must not be a symbolic link: {path}")
    for path in _managed_paths(project):
        if path.is_symlink():
            raise ConfigurationError(f"managed path must not be a symbolic link: {path}")
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_symlink():
                    raise ConfigurationError(f"managed path contains a symbolic link: {child}")


def backup_project(
    project,
    backup,
    kinds=("skills", "agents", "workflows"),
    files=("skills-lock.json", ".mcp.json"),
):
    _reject_managed_symlinks(project)
    manifest = {
        "files": {},
        "dirs": {},
        "roots": {
            ".claude": (project / ".claude").is_dir(),
            **{
                kind: (project / ".claude" / kind).is_dir()
                for kind in kinds
            },
        },
    }
    for name in files:
        source = project / name
        manifest["files"][name] = source.exists()
        if source.exists():
            target = backup / "files" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    patterns = {
        "skills": "mathodology-*",
        "agents": "mathodology-*.md",
        "workflows": "mathodology-*.md",
    }
    for kind in kinds:
        source_root = project / ".claude" / kind
        pattern = patterns[kind]
        names = []
        if source_root.is_dir():
            for source in sorted(source_root.glob(pattern)):
                names.append(source.name)
                target = backup / kind / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                if source.is_dir():
                    shutil.copytree(source, target)
                else:
                    shutil.copy2(source, target)
        manifest["dirs"][kind] = names
    (backup / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _read_backup_manifest(backup):
    try:
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UpdateError(f"cannot read rollback manifest: {exc}") from exc
    if not isinstance(manifest, dict):
        raise UpdateError("rollback manifest must contain an object")
    if not all(isinstance(manifest.get(key), dict) for key in ("files", "dirs", "roots")):
        raise UpdateError("rollback manifest is incomplete")
    return manifest


def _path_state(path):
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return ("absent",)
    permissions = stat.S_IMODE(mode)
    if stat.S_ISLNK(mode):
        return ("symlink", permissions, os.readlink(path))
    if stat.S_ISREG(mode):
        return ("file", permissions, _sha256_file(path))
    if stat.S_ISDIR(mode):
        entries = []
        for child in sorted(path.rglob("*"), key=lambda item: item.relative_to(path).as_posix()):
            relative = child.relative_to(path).as_posix()
            child_mode = child.lstat().st_mode
            child_permissions = stat.S_IMODE(child_mode)
            if stat.S_ISLNK(child_mode):
                entries.append((relative, "symlink", child_permissions, os.readlink(child)))
            elif stat.S_ISREG(child_mode):
                entries.append((relative, "file", child_permissions, _sha256_file(child)))
            elif stat.S_ISDIR(child_mode):
                entries.append((relative, "dir", child_permissions))
            else:
                entries.append((relative, "other", stat.S_IFMT(child_mode), child_permissions))
        return ("dir", permissions, tuple(entries))
    return ("other", stat.S_IFMT(mode), permissions)


def _validate_restored_project(project, backup):
    manifest = _read_backup_manifest(backup)
    claude_root = project / ".claude"
    if manifest["roots"].get(".claude") and (
        claude_root.is_symlink() or not claude_root.is_dir()
    ):
        raise UpdateError("rollback verification failed: .claude root was not restored")
    patterns = {
        "skills": "mathodology-*",
        "agents": "mathodology-*.md",
        "workflows": "mathodology-*.md",
    }
    for kind, expected_names in manifest["dirs"].items():
        target_root = claude_root / kind
        if manifest["roots"].get(kind) and (
            target_root.is_symlink() or not target_root.is_dir()
        ):
            raise UpdateError(
                f"rollback verification failed: .claude/{kind} root was not restored"
            )
        actual_names = sorted(
            target.name
            for target in target_root.glob(patterns[kind])
            if target.exists() or target.is_symlink()
        )
        if actual_names != expected_names:
            raise UpdateError(
                f"rollback verification failed: {kind} inventory mismatch; "
                f"expected {expected_names}, got {actual_names}"
            )
        for name in expected_names:
            source = backup / kind / name
            target = target_root / name
            if _path_state(target) != _path_state(source):
                raise UpdateError(
                    f"rollback verification failed: restored {kind} content differs: {name}"
                )
    for name, existed in manifest["files"].items():
        target = project / name
        target_present = target.exists() or target.is_symlink()
        if target_present != existed:
            state = "present" if target_present else "absent"
            expected = "present" if existed else "absent"
            raise UpdateError(
                f"rollback verification failed: {name} is {state}, expected {expected}"
            )
        if existed and _path_state(target) != _path_state(backup / "files" / name):
            raise UpdateError(
                f"rollback verification failed: restored file content differs: {name}"
            )


def restore_project(project, backup):
    manifest = _read_backup_manifest(backup)
    claude_root = project / ".claude"
    if claude_root.is_symlink() or (claude_root.exists() and not claude_root.is_dir()):
        _remove(claude_root)
    if manifest["roots"].get(".claude"):
        claude_root.mkdir(parents=True, exist_ok=True)
    patterns = {
        "skills": "mathodology-*",
        "agents": "mathodology-*.md",
        "workflows": "mathodology-*.md",
    }
    for kind in manifest["dirs"]:
        target_root = claude_root / kind
        pattern = patterns[kind]
        if target_root.is_symlink() or (target_root.exists() and not target_root.is_dir()):
            _remove(target_root)
        elif target_root.is_dir():
            for target in target_root.glob(pattern):
                _remove(target)
        if manifest["roots"].get(kind):
            target_root.mkdir(parents=True, exist_ok=True)
        source_root = backup / kind
        for name in manifest["dirs"].get(kind, []):
            source = source_root / name
            target = target_root / name
            if source.is_dir():
                _atomic_copytree(source, target)
            else:
                _atomic_copy(source, target)
    for name, existed in manifest["files"].items():
        target = project / name
        if existed:
            _atomic_copy(backup / "files" / name, target)
        else:
            _remove(target)
    for kind in manifest["dirs"]:
        target = project / ".claude" / kind
        if not manifest["roots"].get(kind) and target.is_dir() and not any(target.iterdir()):
            target.rmdir()
    claude = project / ".claude"
    if not manifest["roots"].get(".claude") and claude.is_dir() and not any(claude.iterdir()):
        claude.rmdir()


def read_lock(project):
    path = project / "skills-lock.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigurationError(f"skills-lock.json is invalid: {exc}") from exc
    skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(skills, dict):
        raise ConfigurationError("skills-lock.json must contain a skills object")
    if data.get("version") != 1:
        raise ConfigurationError("skills-lock.json must use supported schema version 1")
    return skills


def _archive_source(sha):
    return f"https://codeload.github.com/{REPOSITORY}/tar.gz/{sha}"


def expected_skill_locks(sha, inventory):
    source = _archive_source(sha)
    return {
        name: {
            "source": source,
            "sourceType": "download",
            "skillPath": f".claude/skills/{name}/SKILL.md",
            "computedHash": inventory["skill_hashes"][name],
        }
        for name in inventory["skills"]
    }


def reconcile_skill_locks(project, sha, inventory):
    path = project / "skills-lock.json"
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise UpdateError(f"cannot reconcile skills-lock.json: {exc}") from exc
        skills = data.get("skills") if isinstance(data, dict) else None
        if not isinstance(skills, dict):
            raise UpdateError("cannot reconcile skills-lock.json without a skills object")
    else:
        data = {"version": 1, "skills": {}}
        skills = data["skills"]
    for name in list(skills):
        if name.startswith("mathodology-"):
            del skills[name]
    skills.update(expected_skill_locks(sha, inventory))
    data["skills"] = {name: skills[name] for name in sorted(skills)}
    _atomic_write_text(path, json.dumps(data, indent=2) + "\n")


def _log_tail(path):
    with path.open("rb") as source:
        source.seek(0, os.SEEK_END)
        size = source.tell()
        source.seek(max(0, size - INSTALL_LOG_TAIL_BYTES))
        return source.read().decode("utf-8", errors="replace").strip()


def _supports_waitid():
    return (
        os.name == "posix"
        and callable(getattr(os, "waitid", None))
        and all(
            hasattr(os, name)
            for name in ("P_PID", "WEXITED", "WNOWAIT", "WNOHANG", "CLD_EXITED")
        )
    )


def _wait_supervised_process(process, timeout):
    descriptor = process._mathodology_status_fd
    ready, _, _ = select.select([descriptor], [], [], timeout)
    if not ready:
        raise subprocess.TimeoutExpired(process.args, timeout)
    try:
        data = os.read(descriptor, 64 * 1024)
    finally:
        os.close(descriptor)
        process._mathodology_status_fd = None
    if not data:
        raise OSError(errno.EIO, "process-group supervisor exited without a result")
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise OSError(errno.EIO, "process-group supervisor returned invalid data") from exc
    if not isinstance(payload, dict):
        raise OSError(errno.EIO, "process-group supervisor returned invalid data")
    if "error" in payload:
        raise OSError(payload.get("errno") or errno.EIO, str(payload["error"]))
    returncode = payload.get("returncode")
    if not isinstance(returncode, int):
        raise OSError(errno.EIO, "process-group supervisor returned no exit status")
    process._mathodology_leader_reaped = False
    return returncode


def _wait_installer(process, timeout):
    """Wait for the installer leader to exit without reaping it on POSIX.

    Leaving the leader unreaped keeps its pid -- and therefore the process group
    id -- reserved, so the group signals sent during cleanup cannot reach an
    unrelated group that recycled the number.
    """
    if getattr(process, "_mathodology_status_fd", None) is not None:
        return _wait_supervised_process(process, timeout)
    if not _supports_waitid():
        returncode = process.wait(timeout=timeout)
        process._mathodology_leader_reaped = True
        return returncode
    process._mathodology_leader_reaped = False
    deadline = time.monotonic() + timeout
    while True:
        state = os.waitid(
            os.P_PID,
            process.pid,
            os.WEXITED | os.WNOWAIT | os.WNOHANG,
        )
        if state is not None:
            if state.si_code == os.CLD_EXITED:
                return state.si_status
            return -state.si_status
        if time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired(process.args, timeout)
        time.sleep(0.05)


def _killpg(process, sig, subject="installer"):
    """Signal a child process group; report whether anything received it.

    A sandbox may deny group signals outright (EPERM). Cleanup is best effort and
    must never turn an otherwise successful install into a failure, so the denial
    is surfaced as a note rather than raised.
    """
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        return False
    except PermissionError:
        note(f"{subject} process group could not be signalled (permission denied)")
        return False
    return True


def _reap_installer(process, subject="installer"):
    try:
        process.wait(timeout=INSTALL_REAP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        note(f"{subject} process could not be reaped within the cleanup timeout")


def _close_supervisor_status(process):
    descriptor = getattr(process, "_mathodology_status_fd", None)
    if descriptor is None:
        return
    process._mathodology_status_fd = None
    try:
        os.close(descriptor)
    except OSError:
        pass


def _terminate_installer(process, grace=INSTALL_TERM_GRACE_SECONDS, subject="installer"):
    """Terminate every surviving process in a child group, then reap its leader.

    ``grace`` is the window the whole group gets to exit on its own; pass 0 once
    the leader has already exited so a clean install adds no cleanup latency.
    """
    if os.name == "posix":
        term_sent = False
        if grace > 0:
            term_sent = _killpg(process, signal.SIGTERM, subject=subject)
            if term_sent:
                time.sleep(grace)
        kill_sent = _killpg(process, signal.SIGKILL, subject=subject)
        if not term_sent and not kill_sent and (
            grace > 0 or getattr(process, "_mathodology_supervised", False)
        ):
            try:
                process.kill()
            except (OSError, ProcessLookupError):
                pass
        _reap_installer(process, subject=subject)
        _close_supervisor_status(process)
        return
    if os.name == "nt":
        if grace > 0:
            _run_taskkill(process, force=False, subject=subject)
            time.sleep(grace)
        _run_taskkill(process, force=True, subject=subject)
    elif grace > 0:
        process.terminate()
    try:
        process.wait(timeout=INSTALL_REAP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        _reap_installer(process, subject=subject)
    _close_supervisor_status(process)


def _run_taskkill(process, force, subject="installer"):
    command = ["taskkill", "/PID", str(process.pid), "/T"]
    if force:
        command.append("/F")
    try:
        subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=INSTALL_REAP_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        note(f"taskkill could not terminate the {subject} process tree")


def _group_popen_kwargs():
    if os.name == "posix":
        return {"start_new_session": True}
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {}


def _start_grouped_process(command, cwd=None, stdout=None, stderr=None):
    if os.name == "posix" and not _supports_waitid():
        read_descriptor, write_descriptor = os.pipe()
        serialized_command = json.dumps([os.fspath(part) for part in command])
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    _GROUP_SUPERVISOR_PROGRAM,
                    str(write_descriptor),
                    serialized_command,
                ],
                cwd=cwd,
                stdout=stdout,
                stderr=stderr,
                pass_fds=(write_descriptor,),
                start_new_session=True,
            )
        except BaseException:
            os.close(read_descriptor)
            raise
        finally:
            os.close(write_descriptor)
        process._mathodology_status_fd = read_descriptor
        process._mathodology_leader_reaped = False
        process._mathodology_supervised = True
        return process
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=stdout,
        stderr=stderr,
        **_group_popen_kwargs(),
    )
    process._mathodology_status_fd = None
    process._mathodology_supervised = False
    return process


def _run_grouped_command(command, timeout, cwd=None, capture_stdout=False, subject="subprocess"):
    output = tempfile.TemporaryFile() if capture_stdout else None
    try:
        process = _start_grouped_process(
            command,
            cwd=cwd,
            stdout=output if output is not None else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            returncode = _wait_installer(process, timeout)
        except BaseException:
            try:
                _terminate_installer(process, subject=subject)
            except Exception as cleanup_exc:  # noqa: BLE001
                note(f"{subject} cleanup failed: {cleanup_exc}")
            raise
        if not getattr(process, "_mathodology_leader_reaped", False):
            try:
                _terminate_installer(process, grace=0, subject=subject)
            except Exception as cleanup_exc:  # noqa: BLE001
                note(f"{subject} cleanup failed: {cleanup_exc}")
        stdout = None
        if output is not None:
            output.seek(0)
            stdout = output.read().decode("utf-8", errors="replace")
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr=None)
    finally:
        if output is not None:
            output.close()


def run_skills_install(project, snapshot):
    npx = shutil.which("npx")
    if not npx:
        raise ConfigurationError("npx is required; install Node.js and retry")
    command = [
        npx,
        "-y",
        "skills@latest",
        "add",
        str(snapshot),
        "--copy",
        "--yes",
        "--skill",
        "*",
        "--agent",
        "claude-code",
    ]
    with tempfile.TemporaryDirectory(prefix="mathodology-install-log-") as temp_name:
        stdout_path = Path(temp_name) / "stdout.log"
        stderr_path = Path(temp_name) / "stderr.log"
        try:
            with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
                process = _start_grouped_process(
                    command,
                    cwd=project,
                    stdout=stdout,
                    stderr=stderr,
                )
                try:
                    returncode = _wait_installer(process, INSTALL_TIMEOUT_SECONDS)
                except BaseException as exc:
                    try:
                        _terminate_installer(process)
                    except Exception as cleanup_exc:  # noqa: BLE001
                        note(f"installer cleanup failed: {cleanup_exc}")
                    raise exc
        except subprocess.TimeoutExpired as exc:
            raise UpdateError(
                f"skills CLI exceeded {INSTALL_TIMEOUT_SECONDS} seconds"
            ) from exc
        except OSError as exc:
            raise UpdateError(f"skills CLI could not start: {exc}") from exc
        # The leader has exited but descendants it spawned may still be running
        # and writing into the project; clear the group before the transaction
        # proceeds or rolls back. Cleanup problems must not mask the install
        # result, so this stays outside the OSError translation above.
        if not getattr(process, "_mathodology_leader_reaped", False):
            try:
                _terminate_installer(process, grace=0)
            except Exception as cleanup_exc:  # noqa: BLE001
                note(f"installer cleanup failed: {cleanup_exc}")
        if returncode != 0:
            detail = _log_tail(stderr_path) or _log_tail(stdout_path)
            if detail:
                note(detail)
            raise UpdateError(
                f"skills CLI failed with exit status {returncode}"
            )


def sync_files(project, snapshot, inventory, kinds=("agents", "workflows")):
    for kind in kinds:
        names = inventory[kind]
        target_root = project / ".claude" / kind
        source_root = snapshot / ".claude" / kind
        target_root.mkdir(parents=True, exist_ok=True)
        for target in target_root.glob("mathodology-*.md"):
            if target.name not in names:
                _remove(target)
        for name in names:
            source = source_root / name
            target = target_root / name
            _atomic_copy(source, target)


def apply_mcp(project, shipped_mcp, mcp_state):
    if mcp_state["action"] == "preserve":
        return
    target = project / ".mcp.json"
    data = shipped_mcp if mcp_state["action"] == "install" else mcp_state["data"]
    _atomic_write_text(target, json.dumps(data, indent=2) + "\n")


def validate_install(project, sha, inventory, foreign_lock):
    _reject_managed_symlinks(project)
    skills_root = project / ".claude" / "skills"
    installed_skills = sorted(
        path.name
        for path in skills_root.glob("mathodology-*")
        if path.is_dir() and (path / "SKILL.md").is_file()
    )
    if installed_skills != inventory["skills"]:
        raise UpdateError(
            f"installed skill inventory mismatch: expected {inventory['skills']}, got {installed_skills}"
        )
    installed_hashes = compute_skill_folder_hashes(skills_root, inventory["skills"])
    for name, expected_hash in inventory["skill_hashes"].items():
        if installed_hashes[name] != expected_hash:
            raise UpdateError(f"installed skill content mismatch: {name}")
    lock = read_lock(project)
    expected_locks = expected_skill_locks(sha, inventory)
    for name, expected in expected_locks.items():
        if lock.get(name) != expected:
            raise UpdateError(f"skills-lock.json entry mismatch: {name}")
    for name, value in foreign_lock.items():
        if lock.get(name) != value:
            raise UpdateError(f"skills CLI changed unrelated lock entry: {name}")
    for kind, expected in (("agents", inventory["agents"]), ("workflows", inventory["workflows"])):
        root = project / ".claude" / kind
        actual = sorted(
            path.name
            for path in root.glob("mathodology-*.md")
            if path.is_file()
        )
        if actual != expected:
            raise UpdateError(f"installed {kind} inventory mismatch: expected {expected}, got {actual}")
        expected_hashes = inventory[f"{kind[:-1]}_hashes"]
        for name in expected:
            actual_hash = _sha256_file(root / name)
            if actual_hash != expected_hashes[name]:
                raise UpdateError(f"installed {kind} content mismatch: {name}")
    evidence = (
        project
        / ".claude"
        / "skills"
        / "mathodology-evidence-search"
        / "SKILL.md"
    ).read_text(encoding="utf-8")
    if not all(token in evidence for token in CONTRACT_TOKENS):
        raise UpdateError("installed evidence skill lacks the combined discovery contract")
    agent = (
        project / ".claude" / "agents" / "mathodology-evidence-researcher.md"
    ).read_text(encoding="utf-8")
    if not all(tool in agent for tool in REQUIRED_AGENT_TOOLS):
        raise UpdateError("installed evidence researcher lacks required discovery/download tools")


def refresh_mcp_package():
    uvx = shutil.which("uvx")
    if not uvx:
        note("uvx not found; search MCP package refresh skipped")
        return "skipped"
    try:
        completed = _run_grouped_command(
            [uvx, "free-search-mcp@latest", "--help"],
            timeout=MCP_REFRESH_TIMEOUT_SECONDS,
            subject="search MCP refresh",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        note(f"search MCP package refresh could not complete ({exc}); project update remains valid")
        return "failed"
    if completed.returncode != 0:
        note("search MCP package refresh failed; project update remains valid")
        return "failed"
    return "refreshed"


def _is_repository_remote(remote):
    remote = remote.strip().lower()
    if remote.startswith("git@github.com:"):
        path = remote.split(":", 1)[1]
    else:
        parsed = urllib.parse.urlparse(remote)
        if parsed.hostname != "github.com":
            return False
        path = parsed.path
    path = path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return path == REPOSITORY


def _is_mathodology_clone(project):
    if not (project / ".git").exists() or not shutil.which("git"):
        return False
    try:
        completed = _run_grouped_command(
            ["git", "-C", str(project), "remote", "get-url", "origin"],
            timeout=GIT_REMOTE_TIMEOUT_SECONDS,
            capture_stdout=True,
            subject="git origin probe",
        )
    except subprocess.TimeoutExpired as exc:
        raise ConfigurationError(
            f"git origin probe exceeded {GIT_REMOTE_TIMEOUT_SECONDS} seconds; "
            "refusing to update a repository with an unknown origin"
        ) from exc
    except OSError as exc:
        raise ConfigurationError(
            f"git origin probe could not start; refusing to update a repository "
            f"with an unknown origin: {exc}"
        ) from exc
    return completed.returncode == 0 and _is_repository_remote(completed.stdout)


def summarize_check(project, sha, inventory, mcp_state, include_details=False):
    _reject_managed_symlinks(project)
    lock = read_lock(project)
    skills_root = project / ".claude" / "skills"
    present_skill_names = [
        name for name in inventory["skills"] if (skills_root / name / "SKILL.md").is_file()
    ]
    actual_skill_hashes = compute_skill_folder_hashes(skills_root, present_skill_names)
    current_locks = expected_skill_locks(sha, inventory)
    skill_content_current = sum(
        1
        for name in present_skill_names
        if actual_skill_hashes[name] == inventory["skill_hashes"][name]
    )
    lock_entries_current = sum(
        1 for name, expected in current_locks.items() if lock.get(name) == expected
    )

    def file_counts(kind, names):
        root = project / ".claude" / kind
        hashes = inventory[f"{kind[:-1]}_hashes"]
        present = 0
        current = 0
        for name in names:
            path = root / name
            if not path.is_file():
                continue
            present += 1
            if _sha256_file(path) == hashes[name]:
                current += 1
        return present, current

    present_agents, current_agents = file_counts("agents", inventory["agents"])
    present_workflows, current_workflows = file_counts("workflows", inventory["workflows"])
    stale_skills = sum(
        1
        for path in skills_root.glob("mathodology-*")
        if path.name not in inventory["skills"]
    )
    stale_agents = sum(
        1
        for path in (project / ".claude" / "agents").glob("mathodology-*.md")
        if path.name not in inventory["agents"]
    )
    stale_workflows = sum(
        1
        for path in (project / ".claude" / "workflows").glob("mathodology-*.md")
        if path.name not in inventory["workflows"]
    )
    stale_locks = sum(
        1
        for name in lock
        if name.startswith("mathodology-") and name not in inventory["skills"]
    )
    result = {
        "mode": "check",
        "resolved_sha": sha,
        "skills": len(present_skill_names),
        "skills_current": skill_content_current,
        "skills_expected": len(inventory["skills"]),
        "lock_entries": sum(1 for name in inventory["skills"] if name in lock),
        "lock_entries_current": lock_entries_current,
        "agents": present_agents,
        "agents_current": current_agents,
        "agents_expected": len(inventory["agents"]),
        "workflows": present_workflows,
        "workflows_current": current_workflows,
        "workflows_expected": len(inventory["workflows"]),
        "stale_managed": stale_skills + stale_agents + stale_workflows + stale_locks,
        "mcp_status": mcp_state["observed_status"],
        "mcp_action": mcp_state["action"],
        "mcp_package": "not-run",
    }
    if include_details:
        result.update(
            stale_skills=stale_skills,
            stale_agents=stale_agents,
            stale_workflows=stale_workflows,
            stale_locks=stale_locks,
        )
    return result


def _restore_after_failure(project, backup, original_error):
    try:
        restore_project(project, backup)
    except BaseException as rollback_error:
        failure = RollbackError(
            original_error,
            rollback_error,
            "rollback restore failed",
        )
        raise failure from original_error
    try:
        _validate_restored_project(project, backup)
    except BaseException as rollback_error:
        failure = RollbackError(
            original_error,
            rollback_error,
            "post-restore verification failed",
        )
        raise failure from original_error


def _remove_rollback_workspace(path):
    shutil.rmtree(path)


@contextmanager
def _rollback_workspace():
    path = Path(tempfile.mkdtemp(prefix="mathodology-rollback-"))
    try:
        yield path
    finally:
        try:
            _remove_rollback_workspace(path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            note(f"rollback workspace could not be removed ({path}: {exc})")


def execute_update(project, sha, snapshot, inventory, skills_installer=run_skills_install, refresher=refresh_mcp_package):
    with _project_update_lock(project) as locked_project:
        return _execute_update_locked(
            locked_project,
            sha,
            snapshot,
            inventory,
            skills_installer=skills_installer,
            refresher=refresher,
        )


def _execute_update_locked(project, sha, snapshot, inventory, skills_installer, refresher):
    if _is_mathodology_clone(project):
        raise ConfigurationError(
            "this target is a Mathodology git clone; use git pull --ff-only and repository validation"
        )
    mcp_state = classify_mcp(project)
    check = summarize_check(
        project,
        sha,
        inventory,
        mcp_state,
        include_details=True,
    )
    if (
        check["skills_current"] == check["skills_expected"]
        and check["lock_entries_current"] == check["skills_expected"]
        and check["agents_current"] == check["agents_expected"]
        and check["workflows_current"] == check["workflows_expected"]
        and check["stale_managed"] == 0
        and mcp_state["action"] == "preserve"
    ):
        return {
            "mode": "update",
            "resolved_sha": sha,
            "skills": len(inventory["skills"]),
            "agents": len(inventory["agents"]),
            "workflows": len(inventory["workflows"]),
            "mcp_status": mcp_state["observed_status"],
            "mcp_package": refresher(),
        }
    original_lock = read_lock(project)
    foreign_lock = {
        name: copy.deepcopy(value)
        for name, value in original_lock.items()
        if not name.startswith("mathodology-")
    }
    skills_changed = check["skills_current"] != check["skills_expected"]
    locks_changed = (
        check["lock_entries_current"] != check["skills_expected"]
        or any(
            name.startswith("mathodology-")
            and name not in inventory["skills"]
            for name in original_lock
        )
    )
    agents_changed = check["agents_current"] != check["agents_expected"]
    workflows_changed = check["workflows_current"] != check["workflows_expected"]
    kinds = tuple(
        kind
        for kind, changed in (
            ("skills", skills_changed or check["stale_skills"] > 0),
            ("agents", agents_changed or check["stale_agents"] > 0),
            ("workflows", workflows_changed or check["stale_workflows"] > 0),
        )
        if changed
    )
    files = tuple(
        name
        for name, changed in (
            ("skills-lock.json", locks_changed or skills_changed),
            (".mcp.json", mcp_state["action"] != "preserve"),
        )
        if changed
    )
    with _rollback_workspace() as backup:
        backup_project(project, backup, kinds=kinds, files=files)
        try:
            if skills_changed:
                skills_installer(project, snapshot)
                _reject_managed_symlinks(project)
            if "skills" in kinds:
                skills_root = project / ".claude" / "skills"
                for target in skills_root.glob("mathodology-*"):
                    if target.name not in inventory["skills"]:
                        _remove(target)
            if locks_changed or skills_changed:
                reconcile_skill_locks(project, sha, inventory)
            file_kinds = tuple(
                kind
                for kind in ("agents", "workflows")
                if kind in kinds
            )
            if file_kinds:
                sync_files(project, snapshot, inventory, kinds=file_kinds)
            apply_mcp(project, inventory["mcp"], mcp_state)
            validate_install(project, sha, inventory, foreign_lock)
        except BaseException as original_error:
            _restore_after_failure(project, backup, original_error)
            raise
    package_status = refresher()
    return {
        "mode": "update",
        "resolved_sha": sha,
        "skills": len(inventory["skills"]),
        "agents": len(inventory["agents"]),
        "workflows": len(inventory["workflows"]),
        "mcp_status": mcp_state["result_status"],
        "mcp_package": package_status,
    }


def _write_fixture_snapshot(root):
    skill_names = [
        "mathodology-agent-pipeline",
        "mathodology-award-gates",
        "mathodology-dev-test-release",
        "mathodology-evidence-search",
        "mathodology-gateway-api",
        "mathodology-project-orientation",
        "mathodology-skill-authoring",
        "mathodology-web-ui",
        "mathodology-whole-project",
    ]
    for name in skill_names:
        path = root / ".claude" / "skills" / name / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        body = f"---\nname: {name}\ndescription: Use when testing.\n---\n"
        if name == "mathodology-evidence-search":
            body += "\n" + "\n".join(CONTRACT_TOKENS) + "\n"
        path.write_text(body, encoding="utf-8")
    for index in range(9):
        name = "mathodology-evidence-researcher.md" if index == 0 else f"mathodology-agent-{index}.md"
        path = root / ".claude" / "agents" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        text = "\n".join(REQUIRED_AGENT_TOOLS) if index == 0 else "agent\n"
        path.write_text(text, encoding="utf-8")
    for index in range(2):
        path = root / ".claude" / "workflows" / f"mathodology-workflow-{index}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("workflow\n", encoding="utf-8")
    mcp = {
        "mcpServers": {
            "search": {
                "command": "uvx",
                "args": ["free-search-mcp"],
                "env": {DOWNLOAD_ENV: DOWNLOAD_DIR},
            }
        }
    }
    (root / ".mcp.json").write_text(json.dumps(mcp), encoding="utf-8")


def _fake_installer(snapshot, failure=None):
    inventory = inspect_snapshot(snapshot)

    def install(project, source_snapshot):
        target_root = project / ".claude" / "skills"
        target_root.mkdir(parents=True, exist_ok=True)
        for name in inventory["skills"]:
            target = target_root / name
            _remove(target)
            shutil.copytree(
                source_snapshot / ".claude" / "skills" / name,
                target,
            )
        lock_path = project / "skills-lock.json"
        existing = {}
        if lock_path.exists():
            existing = json.loads(lock_path.read_text(encoding="utf-8")).get("skills", {})
        for name in inventory["skills"]:
            existing[name] = {
                "source": REPOSITORY,
                "sourceType": "github",
                "ref": "fixture",
                "computedHash": "fixture",
            }
        lock_path.write_text(
            json.dumps({"version": 1, "skills": existing}, indent=2) + "\n",
            encoding="utf-8",
        )
        if failure is not None:
            raise failure

    return install


def _tree_digest(root):
    digest = hashlib.sha256()
    if not root.exists():
        return "absent"
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            _update_digest_from_file(digest, path)
    return digest.hexdigest()


def self_test():
    failures = []

    def check(label, condition):
        if condition:
            print(f"PASS self-test[{label}]")
        else:
            failures.append(label)
            print(f"FAIL self-test[{label}]")

    with tempfile.TemporaryDirectory(prefix="mathodology-updater-test-") as temp_name:
        temp = Path(temp_name)
        snapshot = temp / "snapshot"
        snapshot.mkdir()
        _write_fixture_snapshot(snapshot)
        inventory = inspect_snapshot(snapshot)

        locked_project = temp / "locked-project"
        locked_project.mkdir()
        if os.name == "posix":
            locked_alias = temp / "locked-project-alias"
            locked_alias.symlink_to(locked_project, target_is_directory=True)
        else:
            locked_alias = locked_project / ".." / locked_project.name
        case_alias = locked_project.parent / locked_project.name.swapcase()
        try:
            same_casefolded_project = os.path.samefile(locked_project, case_alias)
        except OSError:
            case_identity_ok = True
        else:
            case_identity_ok = (
                not same_casefolded_project
                or _project_lock_path(locked_project) == _project_lock_path(case_alias)
            )
        lock_calls = []
        lock_error = None
        lock_timed_out = False
        lock_installer_impl = _fake_installer(snapshot)

        def lock_installer(project, source_snapshot):
            lock_calls.append("installer")
            lock_installer_impl(project, source_snapshot)

        started = time.monotonic()
        previous_alarm_handler = None
        with _project_update_lock(locked_project):
            try:
                if os.name == "posix" and hasattr(signal, "setitimer"):
                    previous_alarm_handler = signal.signal(
                        signal.SIGALRM,
                        lambda *_: (_ for _ in ()).throw(
                            TimeoutError("lock acquisition waited")
                        ),
                    )
                    signal.setitimer(signal.ITIMER_REAL, 1)
                execute_update(
                    locked_alias,
                    "0" * 40,
                    snapshot,
                    inventory,
                    skills_installer=lock_installer,
                    refresher=lambda: lock_calls.append("refresher") or "skipped",
                )
            except UpdateError as exc:
                lock_error = exc
            except TimeoutError:
                lock_timed_out = True
            finally:
                if previous_alarm_handler is not None:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                    signal.signal(signal.SIGALRM, previous_alarm_handler)
        check(
            "project-lock-realpath-contention-nonblocking",
            not lock_timed_out
            and isinstance(lock_error, UpdateError)
            and "another update is already running" in str(lock_error)
            and time.monotonic() - started < 1
            and lock_calls == []
            and _project_lock_path(locked_project) == _project_lock_path(locked_alias)
            and _project_lock_path(locked_project).parent == Path(tempfile.gettempdir())
            and case_identity_ok,
        )

        locked_target = temp / "locked-target"
        retargeted_target = temp / "retargeted-target"
        locked_target.mkdir()
        retargeted_target.mkdir()
        retargeted_alias = temp / "retargeted-alias"
        if os.name == "posix":
            retargeted_alias.symlink_to(locked_target, target_is_directory=True)
        else:
            retargeted_alias = retargeted_target
        original_project_lock = globals()["_project_update_lock"]
        bound_installer_impl = _fake_installer(snapshot)
        bound_installer_projects = []

        @contextmanager
        def retargeting_lock(project):
            if os.name == "posix":
                retargeted_alias.unlink()
                retargeted_alias.symlink_to(retargeted_target, target_is_directory=True)
            yield locked_target

        def bound_installer(project, source_snapshot):
            bound_installer_projects.append(project)
            bound_installer_impl(project, source_snapshot)

        try:
            globals()["_project_update_lock"] = retargeting_lock
            execute_update(
                retargeted_alias,
                "9" * 40,
                snapshot,
                inventory,
                skills_installer=bound_installer,
                refresher=lambda: "skipped",
            )
        finally:
            globals()["_project_update_lock"] = original_project_lock
        check(
            "project-lock-binds-resolved-target",
            bound_installer_projects == [locked_target]
            and (locked_target / ".mcp.json").is_file()
            and not (retargeted_target / ".mcp.json").exists(),
        )

        fallback_project = temp / "fallback-lock-project"
        fallback_project.mkdir()
        fallback_lock_path = _project_lock_path(fallback_project)
        original_fcntl = globals()["_fcntl"]
        fallback_blocked = False
        fallback_reacquired = False
        try:
            globals()["_fcntl"] = None
            with _project_update_lock(fallback_project):
                try:
                    with _project_update_lock(fallback_project):
                        pass
                except UpdateError as exc:
                    fallback_blocked = "another update is already running" in str(exc)
            lock_removed = not fallback_lock_path.exists()
            with _project_update_lock(fallback_project):
                fallback_reacquired = True
        finally:
            globals()["_fcntl"] = original_fcntl
            fallback_lock_path.unlink(missing_ok=True)
        check(
            "project-lock-o-excl-fallback-release",
            fallback_blocked and lock_removed and fallback_reacquired,
        )

        project = temp / "fresh"
        project.mkdir()
        foreign = project / ".claude" / "agents" / "user-agent.md"
        foreign.parent.mkdir(parents=True)
        foreign.write_text("keep\n", encoding="utf-8")
        check_result = summarize_check(
            project,
            "a" * 40,
            inventory,
            classify_mcp(project),
        )
        check(
            "fresh-check-observed-state",
            check_result["mcp_status"] == "missing"
            and check_result["mcp_action"] == "install"
            and check_result["skills_current"] == 0
            and check_result["lock_entries_current"] == 0,
        )
        result = execute_update(
            project,
            "a" * 40,
            snapshot,
            inventory,
            skills_installer=_fake_installer(snapshot),
            refresher=lambda: "skipped",
        )
        check(
            "fresh-install",
            result["skills"] == len(inventory["skills"])
            and result["mcp_status"] == "installed"
            and (project / ".mcp.json").is_file(),
        )
        check("unrelated-file-preserved", foreign.read_text(encoding="utf-8") == "keep\n")
        current_check = summarize_check(
            project,
            "a" * 40,
            inventory,
            classify_mcp(project),
        )
        check(
            "current-check-exact",
            current_check["skills_current"] == len(inventory["skills"])
            and current_check["lock_entries_current"] == len(inventory["skills"])
            and current_check["agents_current"] == len(inventory["agents"])
            and current_check["workflows_current"] == len(inventory["workflows"])
            and current_check["stale_managed"] == 0,
        )
        current_digest = _tree_digest(project)
        refresh_calls = []

        def unexpected_installer(*args):
            raise AssertionError("current install must not invoke skills CLI")

        current_result = execute_update(
            project,
            "a" * 40,
            snapshot,
            inventory,
            skills_installer=unexpected_installer,
            refresher=lambda: refresh_calls.append(True) or "refreshed",
        )
        check(
            "current-update-skips-transaction",
            current_result["mcp_package"] == "refreshed"
            and refresh_calls == [True]
            and _tree_digest(project) == current_digest,
        )
        stale_lock_data = json.loads(
            (project / "skills-lock.json").read_text(encoding="utf-8")
        )
        stale_lock_data["skills"]["mathodology-retired"] = {"source": "retired"}
        (project / "skills-lock.json").write_text(
            json.dumps(stale_lock_data),
            encoding="utf-8",
        )
        check(
            "check-detects-stale-lock",
            summarize_check(
                project,
                "a" * 40,
                inventory,
                classify_mcp(project),
            )["stale_managed"]
            == 1,
        )
        execute_update(
            project,
            "a" * 40,
            snapshot,
            inventory,
            skills_installer=unexpected_installer,
            refresher=lambda: "skipped",
        )
        repaired_lock = json.loads(
            (project / "skills-lock.json").read_text(encoding="utf-8")
        )["skills"]
        check(
            "lock-only-update-skips-installer",
            "mathodology-retired" not in repaired_lock,
        )
        changed_agent = (
            project
            / ".claude"
            / "agents"
            / inventory["agents"][0]
        )
        changed_agent.write_text("drift\n", encoding="utf-8")
        execute_update(
            project,
            "a" * 40,
            snapshot,
            inventory,
            skills_installer=unexpected_installer,
            refresher=lambda: "skipped",
        )
        check(
            "agent-only-update-skips-installer",
            _sha256_file(changed_agent)
            == inventory["agent_hashes"][changed_agent.name],
        )
        (project / ".mcp.json").unlink()
        mcp_only_result = execute_update(
            project,
            "a" * 40,
            snapshot,
            inventory,
            skills_installer=unexpected_installer,
            refresher=lambda: "skipped",
        )
        check(
            "mcp-only-update-skips-installer",
            mcp_only_result["mcp_status"] == "installed"
            and (project / ".mcp.json").is_file(),
        )
        changed_skill = (
            project
            / ".claude"
            / "skills"
            / "mathodology-agent-pipeline"
            / "SKILL.md"
        )
        changed_skill.write_text(
            changed_skill.read_text(encoding="utf-8") + "local change\n",
            encoding="utf-8",
        )
        changed_lock = json.loads((project / "skills-lock.json").read_text(encoding="utf-8"))
        changed_lock["skills"]["mathodology-agent-pipeline"]["computedHash"] = "wrong"
        (project / "skills-lock.json").write_text(json.dumps(changed_lock), encoding="utf-8")
        drift_check = summarize_check(
            project,
            "a" * 40,
            inventory,
            classify_mcp(project),
        )
        check(
            "check-detects-content-and-lock-drift",
            drift_check["skills_current"] == len(inventory["skills"]) - 1
            and drift_check["lock_entries_current"] == len(inventory["skills"]) - 1,
        )

        legacy = temp / "legacy"
        legacy.mkdir()
        old_skill = legacy / ".claude" / "skills" / "mathodology-evidence-search" / "SKILL.md"
        old_skill.parent.mkdir(parents=True)
        old_skill.write_text("\n".join(LEGACY_CONTRACT_TOKENS), encoding="utf-8")
        stale = legacy / ".claude" / "agents" / "mathodology-stale.md"
        stale.parent.mkdir(parents=True)
        stale.write_text("stale\n", encoding="utf-8")
        stale_skill = legacy / ".claude" / "skills" / "mathodology-retired" / "SKILL.md"
        stale_skill.parent.mkdir(parents=True)
        stale_skill.write_text("retired\n", encoding="utf-8")
        legacy_mcp = {
            "mcpServers": {
                "search": {"command": "uvx", "args": ["free-search-mcp"]},
                "foreign": {"command": "foreign"},
            }
        }
        (legacy / ".mcp.json").write_text(json.dumps(legacy_mcp), encoding="utf-8")
        foreign_entry = {"source": "other/repo", "computedHash": "unchanged"}
        retired_entry = {"source": REPOSITORY, "computedHash": "retired"}
        (legacy / "skills-lock.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "skills": {
                        "foreign-skill": foreign_entry,
                        "mathodology-retired": retired_entry,
                    },
                }
            ),
            encoding="utf-8",
        )
        legacy_state = classify_mcp(legacy)
        check(
            "legacy-mcp-state-is-explicit",
            legacy_state["observed_status"] == "legacy"
            and legacy_state["action"] == "write"
            and legacy_state["result_status"] == "migrated",
        )
        result = execute_update(
            legacy,
            "b" * 40,
            snapshot,
            inventory,
            skills_installer=_fake_installer(snapshot),
            refresher=lambda: "skipped",
        )
        migrated = json.loads((legacy / ".mcp.json").read_text(encoding="utf-8"))
        lock = json.loads((legacy / "skills-lock.json").read_text(encoding="utf-8"))["skills"]
        expected_locks = expected_skill_locks("b" * 40, inventory)
        check(
            "legacy-lock-reconciled",
            {name: value for name, value in lock.items() if name.startswith("mathodology-")}
            == expected_locks,
        )
        check("foreign-lock-preserved", lock.get("foreign-skill") == foreign_entry)
        check("legacy-mcp-migrated", result["mcp_status"] == "migrated" and migrated["mcpServers"]["search"]["env"][DOWNLOAD_ENV] == DOWNLOAD_DIR)
        check("foreign-mcp-preserved", migrated["mcpServers"].get("foreign") == {"command": "foreign"})

        private_mcp = temp / "private-mcp"
        private_mcp.mkdir()
        private_skill = (
            private_mcp
            / ".claude"
            / "skills"
            / "mathodology-evidence-search"
            / "SKILL.md"
        )
        private_skill.parent.mkdir(parents=True)
        private_skill.write_text("\n".join(LEGACY_CONTRACT_TOKENS), encoding="utf-8")
        private_mcp_path = private_mcp / ".mcp.json"
        private_mcp_path.write_text(json.dumps(legacy_mcp), encoding="utf-8")
        os.chmod(private_mcp_path, 0o600)
        private_state = classify_mcp(private_mcp)
        apply_mcp(private_mcp, inventory["mcp"], private_state)
        check("mcp-mode-preserved", private_mcp_path.stat().st_mode & 0o777 == 0o600)
        check("stale-agent-removed", not stale.exists())
        check(
            "stale-skill-and-lock-removed",
            not stale_skill.exists() and "mathodology-retired" not in lock,
        )

        disabled = temp / "disabled"
        shutil.copytree(project, disabled)
        disabled_mcp = {"mcpServers": {"search": {"command": "uvx", "args": ["free-search-mcp"]}}}
        (disabled / ".mcp.json").write_text(json.dumps(disabled_mcp), encoding="utf-8")
        state = classify_mcp(disabled)
        check("intentional-download-disabled", state["observed_status"] == "download-disabled" and state["action"] == "preserve")

        download_aware = temp / "download-aware"
        download_aware.mkdir()
        download_skill = (
            download_aware
            / ".claude"
            / "skills"
            / "mathodology-evidence-search"
            / "SKILL.md"
        )
        download_skill.parent.mkdir(parents=True)
        download_skill.write_text("\n".join(DOWNLOAD_CONTRACT_TOKENS), encoding="utf-8")
        (download_aware / ".mcp.json").write_text(json.dumps(disabled_mcp), encoding="utf-8")
        state = classify_mcp(download_aware)
        check(
            "v0.11-download-opt-out-preserved",
            state["observed_status"] == "download-disabled" and state["action"] == "preserve",
        )

        unknown = temp / "unknown-evidence"
        unknown.mkdir()
        unknown_skill = (
            unknown
            / ".claude"
            / "skills"
            / "mathodology-evidence-search"
            / "SKILL.md"
        )
        unknown_skill.parent.mkdir(parents=True)
        unknown_skill.write_text("custom evidence instructions\n", encoding="utf-8")
        unknown_mcp_path = unknown / ".mcp.json"
        unknown_mcp_path.write_text(json.dumps(disabled_mcp), encoding="utf-8")
        unknown_before = unknown_mcp_path.read_bytes()
        state = classify_mcp(unknown)
        check(
            "unknown-evidence-config-preserved",
            state["observed_status"] == "missing"
            and state["action"] == "preserve"
            and unknown_mcp_path.read_bytes() == unknown_before,
        )

        custom = temp / "custom"
        custom.mkdir()
        custom_mcp = {"mcpServers": {"search": {"command": "python", "args": ["server.py"]}}}
        (custom / ".mcp.json").write_text(json.dumps(custom_mcp), encoding="utf-8")
        before = (custom / ".mcp.json").read_bytes()
        state = classify_mcp(custom)
        check("custom-mcp-preserved", state["observed_status"] == "custom" and (custom / ".mcp.json").read_bytes() == before)

        extended = temp / "extended-canonical"
        extended.mkdir()
        extended_skill = (
            extended
            / ".claude"
            / "skills"
            / "mathodology-evidence-search"
            / "SKILL.md"
        )
        extended_skill.parent.mkdir(parents=True)
        extended_skill.write_text("legacy evidence contract\n", encoding="utf-8")
        extended_mcp = {
            "mcpServers": {
                "search": {
                    "command": "uvx",
                    "args": ["free-search-mcp"],
                    "cwd": "/custom/server",
                }
            }
        }
        (extended / ".mcp.json").write_text(json.dumps(extended_mcp), encoding="utf-8")
        state = classify_mcp(extended)
        check("extended-search-config-preserved", state["observed_status"] == "custom" and state["action"] == "preserve")

        custom_env = temp / "custom-env"
        custom_env.mkdir()
        custom_env_skill = (
            custom_env
            / ".claude"
            / "skills"
            / "mathodology-evidence-search"
            / "SKILL.md"
        )
        custom_env_skill.parent.mkdir(parents=True)
        custom_env_skill.write_text("legacy evidence contract\n", encoding="utf-8")
        custom_env_mcp = {
            "mcpServers": {
                "search": {
                    "command": "uvx",
                    "args": ["free-search-mcp"],
                    "env": {"CUSTOM_SEARCH_MODE": "private"},
                }
            }
        }
        (custom_env / ".mcp.json").write_text(json.dumps(custom_env_mcp), encoding="utf-8")
        state = classify_mcp(custom_env)
        check("custom-search-env-preserved", state["observed_status"] == "custom" and state["action"] == "preserve")

        typed_env = temp / "typed-env"
        typed_env.mkdir()
        typed_env_mcp = {
            "mcpServers": {
                "search": {
                    "command": "uvx",
                    "args": ["free-search-mcp"],
                    "env": {DOWNLOAD_ENV: True},
                }
            }
        }
        (typed_env / ".mcp.json").write_text(json.dumps(typed_env_mcp), encoding="utf-8")
        state = classify_mcp(typed_env)
        check("nonstring-download-env-preserved", state["observed_status"] == "custom" and state["action"] == "preserve")

        mixed_env = temp / "mixed-env"
        mixed_env.mkdir()
        mixed_env_mcp = {
            "mcpServers": {
                "search": {
                    "command": "uvx",
                    "args": ["free-search-mcp"],
                    "env": {
                        DOWNLOAD_ENV: DOWNLOAD_DIR,
                        "CUSTOM_SEARCH_MODE": "private",
                    },
                }
            }
        }
        (mixed_env / ".mcp.json").write_text(json.dumps(mixed_env_mcp), encoding="utf-8")
        state = classify_mcp(mixed_env)
        check("mixed-search-env-preserved", state["observed_status"] == "custom" and state["action"] == "preserve")

        no_search = temp / "no-search"
        no_search.mkdir()
        no_search_data = {"mcpServers": {"other": {"command": "other"}}}
        (no_search / ".mcp.json").write_text(json.dumps(no_search_data), encoding="utf-8")
        state = classify_mcp(no_search)
        check("missing-search-preserved", state["observed_status"] == "missing" and state["action"] == "preserve")

        invalid = temp / "invalid"
        invalid.mkdir()
        (invalid / ".mcp.json").write_text("{broken", encoding="utf-8")
        try:
            classify_mcp(invalid)
            invalid_rejected = False
        except ConfigurationError:
            invalid_rejected = True
        check("invalid-mcp-rejected", invalid_rejected)

        unknown_lock = temp / "unknown-lock"
        unknown_lock.mkdir()
        unknown_lock_path = unknown_lock / "skills-lock.json"
        unknown_lock_path.write_text(
            json.dumps({"version": 2, "skills": {}}),
            encoding="utf-8",
        )
        unknown_lock_before = unknown_lock_path.read_bytes()
        try:
            read_lock(unknown_lock)
            unknown_lock_rejected = False
        except ConfigurationError:
            unknown_lock_rejected = True
        check(
            "unknown-lock-schema-rejected",
            unknown_lock_rejected and unknown_lock_path.read_bytes() == unknown_lock_before,
        )

        rollback = temp / "rollback"
        rollback.mkdir()
        original_skill = rollback / ".claude" / "skills" / "mathodology-old" / "SKILL.md"
        original_skill.parent.mkdir(parents=True)
        original_skill.write_text("original\n", encoding="utf-8")
        original_lock = {"version": 1, "skills": {"mathodology-old": {"source": "old"}}}
        (rollback / "skills-lock.json").write_text(json.dumps(original_lock), encoding="utf-8")
        before_digest = _tree_digest(rollback)
        try:
            execute_update(
                rollback,
                "c" * 40,
                snapshot,
                inventory,
                skills_installer=_fake_installer(
                    snapshot, UpdateError("simulated installer failure")
                ),
                refresher=lambda: "skipped",
            )
        except UpdateError:
            pass
        check("transaction-rollback", _tree_digest(rollback) == before_digest)

        interrupt = temp / "interrupt"
        shutil.copytree(rollback, interrupt)
        before_digest = _tree_digest(interrupt)
        try:
            execute_update(
                interrupt,
                "d" * 40,
                snapshot,
                inventory,
                skills_installer=_fake_installer(snapshot, KeyboardInterrupt()),
                refresher=lambda: "skipped",
            )
        except KeyboardInterrupt:
            pass
        check("interrupt-rollback", _tree_digest(interrupt) == before_digest)

        rollback_failure = temp / "rollback-failure"
        shutil.copytree(rollback, rollback_failure)
        primary_failure = UpdateError("primary update failure")
        secondary_failure = OSError("secondary restore failure")
        original_restore_project = globals()["restore_project"]
        original_remove_rollback_workspace = globals()["_remove_rollback_workspace"]
        failed_cleanup_paths = []

        def failing_restore(project, backup):
            raise secondary_failure

        def failing_rollback_cleanup(path):
            failed_cleanup_paths.append(path)
            raise OSError("secondary cleanup failure")

        rollback_exception = None
        try:
            globals()["restore_project"] = failing_restore
            globals()["_remove_rollback_workspace"] = failing_rollback_cleanup
            execute_update(
                rollback_failure,
                "1" * 40,
                snapshot,
                inventory,
                skills_installer=_fake_installer(snapshot, primary_failure),
                refresher=lambda: "skipped",
            )
        except BaseException as exc:
            rollback_exception = exc
        finally:
            globals()["restore_project"] = original_restore_project
            globals()["_remove_rollback_workspace"] = original_remove_rollback_workspace
            for failed_cleanup_path in failed_cleanup_paths:
                original_remove_rollback_workspace(failed_cleanup_path)
        check(
            "rollback-failure-preserves-original-cause",
            isinstance(rollback_exception, RollbackError)
            and rollback_exception.__cause__ is primary_failure
            and rollback_exception.original_error is primary_failure
            and rollback_exception.rollback_error is secondary_failure
            and rollback_exception.phase == "rollback restore failed"
            and "secondary restore failure" in str(rollback_exception)
            and len(failed_cleanup_paths) == 1,
        )

        corrupt_restore = temp / "corrupt-restore"
        shutil.copytree(rollback, corrupt_restore)
        verification_primary = UpdateError("verification-triggering failure")

        def restore_then_corrupt(project, backup):
            original_restore_project(project, backup)
            restored = (
                project
                / ".claude"
                / "skills"
                / "mathodology-old"
                / "SKILL.md"
            )
            restored.write_text("corrupted after restore\n", encoding="utf-8")

        verification_exception = None
        try:
            globals()["restore_project"] = restore_then_corrupt
            execute_update(
                corrupt_restore,
                "2" * 40,
                snapshot,
                inventory,
                skills_installer=_fake_installer(snapshot, verification_primary),
                refresher=lambda: "skipped",
            )
        except BaseException as exc:
            verification_exception = exc
        finally:
            globals()["restore_project"] = original_restore_project
        check(
            "post-restore-verification-detects-corruption",
            isinstance(verification_exception, RollbackError)
            and verification_exception.__cause__ is verification_primary
            and verification_exception.phase == "post-restore verification failed"
            and isinstance(verification_exception.rollback_error, UpdateError)
            and "rollback verification failed" in str(verification_exception.rollback_error),
        )

        empty_root_project = temp / "empty-root-restore"
        empty_workflows = empty_root_project / ".claude" / "workflows"
        empty_workflows.mkdir(parents=True)
        empty_root_backup = temp / "empty-root-backup"
        empty_root_backup.mkdir()
        backup_project(
            empty_root_project,
            empty_root_backup,
            kinds=("workflows",),
            files=(),
        )
        shutil.rmtree(empty_workflows)
        restore_project(empty_root_project, empty_root_backup)
        try:
            _validate_restored_project(empty_root_project, empty_root_backup)
            empty_root_valid = True
        except UpdateError:
            empty_root_valid = False
        check(
            "rollback-restores-empty-managed-root",
            empty_root_valid and empty_workflows.is_dir(),
        )

        injected = temp / "injected-symlink"
        injected.mkdir()
        injected_original = (
            injected / ".claude" / "skills" / "mathodology-old" / "SKILL.md"
        )
        injected_original.parent.mkdir(parents=True)
        injected_original.write_text("original\n", encoding="utf-8")
        outside_skill = temp / "outside-skill"
        outside_skill.mkdir()
        outside_marker = outside_skill / "marker.txt"
        outside_marker.write_text("outside\n", encoding="utf-8")
        injected_before = _tree_digest(injected)

        def symlink_installer(project, source_snapshot):
            target = project / ".claude" / "skills"
            shutil.rmtree(target)
            target.symlink_to(outside_skill, target_is_directory=True)

        try:
            execute_update(
                injected,
                "e" * 40,
                snapshot,
                inventory,
                skills_installer=symlink_installer,
                refresher=lambda: "skipped",
            )
        except ConfigurationError:
            pass
        check(
            "post-installer-symlink-rollback",
            _tree_digest(injected) == injected_before
            and outside_marker.read_text(encoding="utf-8") == "outside\n",
        )

        archive_source = temp / "archive-source"
        archive_source.mkdir()
        _write_fixture_snapshot(archive_source)
        archive = temp / "fixture.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            for path in archive_source.rglob("*"):
                output.add(path, arcname=f"mathodology-fixture/{path.relative_to(archive_source)}")
        extracted = temp / "extracted"
        extracted.mkdir()
        extracted_inventory = extract_snapshot(archive, extracted)
        check("archive-extraction", extracted_inventory["skills"] == inventory["skills"])

        member_archive = temp / "member-limit.tar.gz"
        with tarfile.open(member_archive, "w:gz") as output:
            for index in range(MAX_ARCHIVE_MEMBERS + 1):
                info = tarfile.TarInfo(f"mathodology-fixture/ignored-{index}")
                info.type = tarfile.DIRTYPE
                output.addfile(info)
        member_destination = temp / "member-limit"
        member_destination.mkdir()
        try:
            extract_snapshot(member_archive, member_destination)
            member_limit_rejected = False
        except SnapshotError:
            member_limit_rejected = True
        check("archive-member-limit", member_limit_rejected)

        malicious_cases = []
        for label, name, member_type in (
            ("traversal", "root/../.mcp.json", tarfile.REGTYPE),
            ("absolute", "/root/.mcp.json", tarfile.REGTYPE),
            ("symlink", "root/.mcp.json", tarfile.SYMTYPE),
            ("hardlink", "root/.mcp.json", tarfile.LNKTYPE),
            ("device", "root/.mcp.json", tarfile.CHRTYPE),
        ):
            path = temp / f"malicious-{label}.tar.gz"
            with tarfile.open(path, "w:gz") as output:
                info = tarfile.TarInfo(name)
                info.type = member_type
                info.linkname = "outside" if member_type in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ""
                if member_type == tarfile.REGTYPE:
                    info.size = 2
                    output.addfile(info, io.BytesIO(b"{}"))
                else:
                    output.addfile(info)
            malicious_cases.append((label, path))

        oversized = temp / "malicious-oversized.tar.gz"
        info = tarfile.TarInfo("root/.mcp.json")
        info.size = MAX_EXTRACTED_BYTES + 1
        with gzip.open(oversized, "wb") as output:
            output.write(info.tobuf())
        malicious_cases.append(("oversized", oversized))

        truncated = temp / "malicious-truncated.tar.gz"
        info = tarfile.TarInfo("root/.mcp.json")
        info.size = 16
        with gzip.open(truncated, "wb") as output:
            output.write(info.tobuf() + b"x")
        malicious_cases.append(("truncated", truncated))

        for label, path in malicious_cases:
            destination = temp / f"malicious-destination-{label}"
            destination.mkdir()
            marker = destination / "marker.txt"
            marker.write_text("preserve\n", encoding="utf-8")
            try:
                extract_snapshot(path, destination)
                rejected = False
            except SnapshotError:
                rejected = True
            check(
                f"archive-{label}-rejected-atomically",
                rejected
                and marker.read_text(encoding="utf-8") == "preserve\n"
                and list(destination.iterdir()) == [marker],
            )

        install_log = temp / "install.log"
        install_log.write_bytes(
            b"discarded-prefix\n"
            + b"x" * INSTALL_LOG_TAIL_BYTES
            + b"terminal-marker\n"
        )
        install_tail = _log_tail(install_log)
        check(
            "installer-log-tail-bounded",
            len(install_tail.encode("utf-8")) <= INSTALL_LOG_TAIL_BYTES
            and install_tail.endswith("terminal-marker")
            and "discarded-prefix" not in install_tail,
        )

        if os.name == "posix":
            process_group = temp / "process-group"
            process_group.mkdir()
            marker = process_group / "survivor.txt"
            npx = process_group / "npx"
            child = (
                "import os,signal,time,pathlib;"
                "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                "time.sleep(2);"
                f"pathlib.Path({str(marker)!r}).write_text('survived')"
            )
            parent = (
                "import signal,subprocess,sys,time;"
                "signal.signal(signal.SIGTERM,lambda *_: sys.exit(0));"
                f"subprocess.Popen([sys.executable,'-c',{child!r}]);"
                "time.sleep(60)"
            )
            npx.write_text(
                "#!/bin/sh\nexec "
                + subprocess.list2cmdline([sys.executable, "-c", parent])
                + "\n",
                encoding="utf-8",
            )
            npx.chmod(0o755)
            original_path = os.environ.get("PATH", "")
            original_timeout = globals()["INSTALL_TIMEOUT_SECONDS"]
            try:
                os.environ["PATH"] = str(process_group)
                globals()["INSTALL_TIMEOUT_SECONDS"] = 0.5
                try:
                    run_skills_install(process_group, snapshot)
                    timed_out = False
                except UpdateError as exc:
                    timed_out = "skills CLI exceeded" in str(exc)
                time.sleep(2.2)
            finally:
                os.environ["PATH"] = original_path
                globals()["INSTALL_TIMEOUT_SECONDS"] = original_timeout
            check(
                "installer-timeout-kills-process-group",
                timed_out and not marker.exists(),
            )

            for label, exit_code, expect_error in (
                ("success", 0, False),
                ("failure", 3, True),
            ):
                leaked_root = temp / f"process-group-{label}"
                leaked_root.mkdir()
                leaked_marker = leaked_root / "survivor.txt"
                orphan = (
                    "import signal,time,pathlib;"
                    "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                    "time.sleep(2);"
                    f"pathlib.Path({str(leaked_marker)!r}).write_text('leaked')"
                )
                exiting_parent = (
                    "import subprocess,sys;"
                    f"subprocess.Popen([sys.executable,'-c',{orphan!r}]);"
                    f"sys.exit({exit_code})"
                )
                leaked_npx = leaked_root / "npx"
                leaked_npx.write_text(
                    "#!/bin/sh\nexec "
                    + subprocess.list2cmdline(
                        [sys.executable, "-c", exiting_parent]
                    )
                    + "\n",
                    encoding="utf-8",
                )
                leaked_npx.chmod(0o755)
                try:
                    os.environ["PATH"] = str(leaked_root)
                    try:
                        run_skills_install(leaked_root, snapshot)
                        errored = False
                    except UpdateError:
                        errored = True
                finally:
                    os.environ["PATH"] = original_path
                time.sleep(2.2)
                check(
                    f"installer-{label}-kills-orphaned-descendants",
                    errored is expect_error and not leaked_marker.exists(),
                )

            denied_root = temp / "process-group-denied"
            denied_root.mkdir()
            denied_npx = denied_root / "npx"
            denied_npx.write_text(
                "#!/bin/sh\nexec "
                + subprocess.list2cmdline([sys.executable, "-c", "pass"])
                + "\n",
                encoding="utf-8",
            )
            denied_npx.chmod(0o755)
            original_killpg = os.killpg
            try:
                os.environ["PATH"] = str(denied_root)
                os.killpg = lambda *_: (_ for _ in ()).throw(
                    PermissionError(1, "Operation not permitted")
                )
                try:
                    run_skills_install(denied_root, snapshot)
                    install_survived_denied_cleanup = True
                except UpdateError:
                    install_survived_denied_cleanup = False
            finally:
                os.killpg = original_killpg
                os.environ["PATH"] = original_path
            check(
                "installer-cleanup-denial-does-not-fail-install",
                install_survived_denied_cleanup,
            )

            auxiliary_root = temp / "auxiliary-process-groups"
            auxiliary_root.mkdir()
            mcp_marker = auxiliary_root / "mcp-survivor.txt"
            git_marker = auxiliary_root / "git-survivor.txt"

            def write_timeout_probe(executable, marker):
                child = (
                    "import signal,time,pathlib;"
                    "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                    "time.sleep(1.5);"
                    f"pathlib.Path({str(marker)!r}).write_text('survived')"
                )
                parent = (
                    "import subprocess,sys,time;"
                    f"subprocess.Popen([sys.executable,'-c',{child!r}]);"
                    "time.sleep(5)"
                )
                executable.write_text(
                    "#!/bin/sh\nexec "
                    + subprocess.list2cmdline([sys.executable, "-c", parent])
                    + "\n",
                    encoding="utf-8",
                )
                executable.chmod(0o755)

            write_timeout_probe(auxiliary_root / "uvx", mcp_marker)
            write_timeout_probe(auxiliary_root / "git", git_marker)
            git_probe_project = auxiliary_root / "project"
            (git_probe_project / ".git").mkdir(parents=True)
            original_mcp_timeout = globals()["MCP_REFRESH_TIMEOUT_SECONDS"]
            original_git_timeout = globals()["GIT_REMOTE_TIMEOUT_SECONDS"]
            try:
                os.environ["PATH"] = str(auxiliary_root)
                globals()["MCP_REFRESH_TIMEOUT_SECONDS"] = 0.2
                globals()["GIT_REMOTE_TIMEOUT_SECONDS"] = 0.2
                mcp_timeout_status = refresh_mcp_package()
                try:
                    _is_mathodology_clone(git_probe_project)
                    git_timeout_rejected = False
                except ConfigurationError as exc:
                    git_timeout_rejected = "git origin probe exceeded" in str(exc)
                time.sleep(1.7)
            finally:
                os.environ["PATH"] = original_path
                globals()["MCP_REFRESH_TIMEOUT_SECONDS"] = original_mcp_timeout
                globals()["GIT_REMOTE_TIMEOUT_SECONDS"] = original_git_timeout
            original_grouped_command = globals()["_run_grouped_command"]
            original_which = shutil.which
            grouped_probe_calls = []

            def timeout_grouped_probe(command, **kwargs):
                grouped_probe_calls.append((command, kwargs))
                raise subprocess.TimeoutExpired(command, kwargs.get("timeout"))

            try:
                globals()["_run_grouped_command"] = timeout_grouped_probe
                shutil.which = lambda command: (
                    f"/probe/{command}"
                    if command in ("uvx", "git")
                    else original_which(command)
                )
                grouped_probe_mcp = refresh_mcp_package()
                try:
                    _is_mathodology_clone(git_probe_project)
                    grouped_probe_git = False
                except ConfigurationError as exc:
                    grouped_probe_git = "git origin probe exceeded" in str(exc)
            finally:
                globals()["_run_grouped_command"] = original_grouped_command
                shutil.which = original_which
            mcp_grouped_contract = any(
                kwargs.get("subject") == "search MCP refresh"
                and kwargs.get("timeout") == original_mcp_timeout
                for _, kwargs in grouped_probe_calls
            )
            git_grouped_contract = any(
                kwargs.get("subject") == "git origin probe"
                and kwargs.get("timeout") == original_git_timeout
                and kwargs.get("capture_stdout") is True
                for _, kwargs in grouped_probe_calls
            )
            check(
                "mcp-refresh-timeout-kills-process-group",
                mcp_timeout_status == "failed"
                and not mcp_marker.exists()
                and grouped_probe_mcp == "failed"
                and mcp_grouped_contract,
            )
            check(
                "git-remote-timeout-kills-process-group",
                git_timeout_rejected
                and not git_marker.exists()
                and grouped_probe_git
                and git_grouped_contract,
            )

            auxiliary_denied = temp / "auxiliary-process-group-denied"
            auxiliary_denied.mkdir()
            denied_uvx = auxiliary_denied / "uvx"
            denied_uvx.write_text(
                "#!/bin/sh\nexec "
                + subprocess.list2cmdline([sys.executable, "-c", "pass"])
                + "\n",
                encoding="utf-8",
            )
            denied_uvx.chmod(0o755)
            denied_git = auxiliary_denied / "git"
            denied_git.write_text(
                "#!/bin/sh\nprintf '%s\\n' "
                "'https://github.com/sweetcornna/mathodology.git'\n",
                encoding="utf-8",
            )
            denied_git.chmod(0o755)
            denied_git_project = auxiliary_denied / "project"
            (denied_git_project / ".git").mkdir(parents=True)
            original_killpg = os.killpg
            try:
                os.environ["PATH"] = str(auxiliary_denied)
                os.killpg = lambda *_: (_ for _ in ()).throw(
                    PermissionError(1, "Operation not permitted")
                )
                denied_mcp_status = refresh_mcp_package()
                denied_git_status = _is_mathodology_clone(denied_git_project)
                try:
                    denied_group_signal = not _killpg(
                        type("FixtureProcess", (), {"pid": os.getpid()})(),
                        signal.SIGKILL,
                        subject="auxiliary fixture",
                    )
                except PermissionError:
                    denied_group_signal = False
                slow_command = subprocess.list2cmdline(
                    [sys.executable, "-c", "import time;time.sleep(5)"]
                )
                denied_uvx.write_text(
                    "#!/bin/sh\nexec " + slow_command + "\n",
                    encoding="utf-8",
                )
                denied_git.write_text(
                    "#!/bin/sh\nexec " + slow_command + "\n",
                    encoding="utf-8",
                )
                globals()["MCP_REFRESH_TIMEOUT_SECONDS"] = 0.2
                globals()["GIT_REMOTE_TIMEOUT_SECONDS"] = 0.2
                denied_timeout_mcp_status = refresh_mcp_package()
                try:
                    _is_mathodology_clone(denied_git_project)
                    denied_timeout_git_status = False
                except ConfigurationError as exc:
                    denied_timeout_git_status = "git origin probe exceeded" in str(exc)
            finally:
                os.killpg = original_killpg
                os.environ["PATH"] = original_path
                globals()["MCP_REFRESH_TIMEOUT_SECONDS"] = original_mcp_timeout
                globals()["GIT_REMOTE_TIMEOUT_SECONDS"] = original_git_timeout
            check(
                "auxiliary-cleanup-denial-is-best-effort",
                denied_mcp_status == "refreshed"
                and denied_git_status
                and denied_group_signal
                and denied_timeout_mcp_status == "failed"
                and denied_timeout_git_status,
            )

            had_waitid = hasattr(os, "waitid")
            original_waitid = getattr(os, "waitid", None)

            def restore_waitid_attribute():
                if had_waitid:
                    os.waitid = original_waitid
                elif hasattr(os, "waitid"):
                    delattr(os, "waitid")

            waitid_npx_marker = auxiliary_denied / "waitid-npx-survivor.txt"
            waitid_mcp_marker = auxiliary_denied / "waitid-mcp-survivor.txt"
            waitid_git_marker = auxiliary_denied / "waitid-git-survivor.txt"

            def write_orphaning_success(executable, marker, stdout_line=None):
                orphan = (
                    "import signal,time,pathlib;"
                    "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                    "time.sleep(2);"
                    f"pathlib.Path({str(marker)!r}).write_text('survived')"
                )
                output = f"print({stdout_line!r},flush=True);" if stdout_line else ""
                parent = (
                    "import subprocess,sys;"
                    f"subprocess.Popen([sys.executable,'-c',{orphan!r}]);"
                    + output
                    + "sys.exit(0)"
                )
                executable.write_text(
                    "#!/bin/sh\nexec "
                    + subprocess.list2cmdline([sys.executable, "-c", parent])
                    + "\n",
                    encoding="utf-8",
                )
                executable.chmod(0o755)

            try:
                waitid_npx = auxiliary_denied / "npx"
                write_orphaning_success(
                    waitid_npx,
                    waitid_npx_marker,
                )
                write_orphaning_success(
                    denied_uvx,
                    waitid_mcp_marker,
                )
                write_orphaning_success(
                    denied_git,
                    waitid_git_marker,
                    stdout_line="https://github.com/sweetcornna/mathodology.git",
                )
                os.environ["PATH"] = str(auxiliary_denied)
                os.waitid = None
                try:
                    run_skills_install(auxiliary_denied, snapshot)
                    waitid_fallback_npx = True
                    waitid_fallback_mcp = refresh_mcp_package()
                    waitid_fallback_git = _is_mathodology_clone(denied_git_project)
                except Exception:
                    waitid_fallback_npx = False
                    waitid_fallback_mcp = "failed-unexpectedly"
                    waitid_fallback_git = False
                time.sleep(2.2)
            finally:
                restore_waitid_attribute()
                os.environ["PATH"] = original_path

            # Cleanup latency is not asserted here: a denied SIGTERM never
            # reaches the grace-period branch, so any such check is vacuous.
            # `auxiliary-cleanup-denial-is-best-effort` covers the EPERM contract.
            waitid_eperm_killpg = os.killpg
            try:
                simple_success = (
                    "#!/bin/sh\nexec "
                    + subprocess.list2cmdline([sys.executable, "-c", "pass"])
                    + "\n"
                )
                waitid_npx.write_text(simple_success, encoding="utf-8")
                denied_uvx.write_text(simple_success, encoding="utf-8")
                denied_git.write_text(
                    "#!/bin/sh\nprintf '%s\\n' "
                    "'https://github.com/sweetcornna/mathodology.git'\n",
                    encoding="utf-8",
                )
                os.environ["PATH"] = str(auxiliary_denied)
                os.waitid = None
                os.killpg = lambda *_: (_ for _ in ()).throw(
                    PermissionError(1, "Operation not permitted")
                )
                try:
                    run_skills_install(auxiliary_denied, snapshot)
                    waitid_eperm_npx = True
                    waitid_eperm_mcp = refresh_mcp_package()
                    waitid_eperm_git = _is_mathodology_clone(denied_git_project)
                except Exception:
                    waitid_eperm_npx = False
                    waitid_eperm_mcp = "failed-unexpectedly"
                    waitid_eperm_git = False
            finally:
                os.killpg = waitid_eperm_killpg
                restore_waitid_attribute()
                os.environ["PATH"] = original_path
            check(
                "grouped-process-waitid-fallback",
                waitid_fallback_npx
                and waitid_fallback_mcp == "refreshed"
                and waitid_fallback_git
                and not waitid_npx_marker.exists()
                and not waitid_mcp_marker.exists()
                and not waitid_git_marker.exists()
                and waitid_eperm_npx
                and waitid_eperm_mcp == "refreshed"
                and waitid_eperm_git,
            )

        symlink_project = temp / "symlink-root"
        symlink_project.mkdir()
        outside = temp / "outside-claude"
        outside.mkdir()
        (symlink_project / ".claude").symlink_to(outside, target_is_directory=True)
        try:
            backup_project(symlink_project, temp / "symlink-backup")
            symlink_rejected = False
        except ConfigurationError:
            symlink_rejected = True
        check("managed-root-symlink-rejected", symlink_rejected)

        check(
            "repository-remote-detection",
            all(
                _is_repository_remote(remote)
                for remote in (
                    "https://github.com/sweetcornna/mathodology.git",
                    "git@github.com:sweetcornna/mathodology.git",
                    "ssh://git@github.com/sweetcornna/mathodology.git",
                )
            )
            and not _is_repository_remote("https://github.com/other/mathodology.git")
            and not _is_repository_remote("https://evilgithub.com/sweetcornna/mathodology.git"),
        )

        original_which = shutil.which
        original_grouped_command = globals()["_run_grouped_command"]
        try:
            shutil.which = lambda command: None if command == "uvx" else original_which(command)
            missing_uvx_status = refresh_mcp_package()

            shutil.which = lambda command: "/missing/uvx" if command == "uvx" else original_which(command)

            def failed_launch(*args, **kwargs):
                raise FileNotFoundError("simulated launch failure")

            globals()["_run_grouped_command"] = failed_launch
            refresh_status = refresh_mcp_package()
        finally:
            shutil.which = original_which
            globals()["_run_grouped_command"] = original_grouped_command
        check("missing-uvx-nonfatal", missing_uvx_status == "skipped")
        check("mcp-refresh-launch-failure-nonfatal", refresh_status == "failed")

        try:
            shutil.which = lambda command: "/slow/uvx" if command == "uvx" else original_which(command)

            def timed_out(*args, **kwargs):
                raise subprocess.TimeoutExpired(args[0], kwargs.get("timeout"))

            globals()["_run_grouped_command"] = timed_out
            timeout_status = refresh_mcp_package()
        finally:
            shutil.which = original_which
            globals()["_run_grouped_command"] = original_grouped_command
        check("mcp-refresh-timeout-nonfatal", timeout_status == "failed")

    print("update-project self-test:", "OK" if not failures else "FAILED")
    return 0 if not failures else 1


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Update a full Mathodology Claude Code project install.")
    parser.add_argument("--project", default=".", help="target project directory (default: current directory)")
    parser.add_argument("--ref", default=DEFAULT_REF, help="branch, tag, or commit to install (default: main)")
    parser.add_argument("--check", action="store_true", help="diagnose without changing the target project")
    parser.add_argument("--self-test", action="store_true", help="run offline updater tests")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.self_test:
        return self_test()
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"mathodology-update: target is not a directory: {project}", file=sys.stderr)
        return 2
    try:
        sha = resolve_ref(args.ref)
        note(f"resolved {args.ref!r} to {sha}")
        with tempfile.TemporaryDirectory(prefix="mathodology-snapshot-") as temp_name:
            temp = Path(temp_name)
            archive = temp / "source.tar.gz"
            snapshot = temp / "snapshot"
            snapshot.mkdir()
            download_archive(sha, archive)
            inventory = extract_snapshot(archive, snapshot)
            if args.check:
                result = summarize_check(project, sha, inventory, classify_mcp(project))
            else:
                result = execute_update(project, sha, snapshot, inventory)
        print(json.dumps(result, sort_keys=True))
        return 0
    except ConfigurationError as exc:
        print(f"mathodology-update: configuration error: {exc}", file=sys.stderr)
        return 2
    except UpdateError as exc:
        print(f"mathodology-update: failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"mathodology-update: failed unexpectedly: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
