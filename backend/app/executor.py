from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shlex
import subprocess
from typing import Callable


class ExecutorError(RuntimeError):
    pass


LogCallback = Callable[[str], None]


@dataclass(slots=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


@dataclass(slots=True)
class DeploymentPlan:
    repo_url: str
    target_dir: Path
    stack: str | None = None
    branch: str = "main"
    build_command: str | None = None
    start_command: str | None = None
    internal_port: int | None = None
    service_type: str = "web"


class Executor:
    def __init__(self, pm2_binary: str = "pm2") -> None:
        self.pm2_binary = pm2_binary

    def run(
        self,
        args: list[str],
        cwd: str | Path | None = None,
        timeout: int | None = None,
        stream: LogCallback | None = None,
    ) -> CommandResult:
        process = subprocess.Popen(
            args,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            stdout, stderr = process.communicate()
            raise ExecutorError(f"Command timed out: {' '.join(args)}") from exc

        if stream:
            for line in stdout.splitlines():
                stream(line)
            for line in stderr.splitlines():
                stream(line)

        return CommandResult(
            command=args,
            returncode=process.returncode,
            stdout=stdout,
            stderr=stderr,
        )

    def clone_or_update(self, repo_url: str, target_dir: str | Path, branch: str = "main") -> CommandResult:
        target_path = Path(target_dir)
        if (target_path / ".git").exists():
            result = self.run(["git", "fetch", "origin"], cwd=target_path)
            self._ensure_success(result, "git fetch failed")
            result = self.run(["git", "checkout", branch], cwd=target_path)
            self._ensure_success(result, f"git checkout {branch} failed")
            result = self.run(["git", "pull", "origin", branch], cwd=target_path)
            self._ensure_success(result, f"git pull origin {branch} failed")
            return result

        target_path.parent.mkdir(parents=True, exist_ok=True)
        result = self.run(["git", "clone", "-b", branch, repo_url, str(target_path)])
        self._ensure_success(result, "git clone failed")
        return result

    def detect_stack(self, project_dir: str | Path) -> str:
        root = Path(project_dir)
        if (root / "package.json").exists():
            return "node"
        if (root / "requirements.txt").exists() or (root / "pyproject.toml").exists():
            return "python"
        raise ExecutorError(f"Unable to detect tech stack in {root}")

    def detect_python_framework(self, project_dir: str | Path) -> str:
        root = Path(project_dir)

        if (root / "manage.py").exists():
            return "django"

        requirements = root / "requirements.txt"
        if requirements.exists():
            content = requirements.read_text(encoding="utf-8", errors="ignore").lower()
            if "fastapi" in content:
                return "fastapi"
            if "flask" in content:
                return "flask"
            if "django" in content:
                return "django"

        pyproject = root / "pyproject.toml"
        if pyproject.exists():
            content = pyproject.read_text(encoding="utf-8", errors="ignore").lower()
            if "fastapi" in content:
                return "fastapi"
            if "flask" in content:
                return "flask"
            if "django" in content:
                return "django"

        app_main = root / "app" / "main.py"
        if app_main.exists():
            content = app_main.read_text(encoding="utf-8", errors="ignore")
            if "FastAPI(" in content:
                return "fastapi"

        flask_main = root / "app.py"
        if flask_main.exists():
            content = flask_main.read_text(encoding="utf-8", errors="ignore")
            if "Flask(" in content:
                return "flask"

        return "python"

    def suggest_commands(
        self,
        project_dir: str | Path | None,
        stack: str,
        service_type: str,
        port: int,
    ) -> tuple[str | None, str | None, str | None]:
        normalized = stack.lower()

        if normalized == "node":
            start = "npm start"
            if service_type == "worker":
                start = "node worker.js"
            return "npm run build", start, None

        if normalized == "python":
            framework = "python"
            if project_dir:
                framework = self.detect_python_framework(project_dir)

            if framework == "fastapi":
                return None, f"uvicorn app.main:app --host 0.0.0.0 --port {port}", framework
            if framework == "django":
                return None, f"python manage.py runserver 0.0.0.0:{port}", framework
            if framework == "flask":
                return None, f"flask run --host 0.0.0.0 --port {port}", framework

            if service_type == "worker":
                return None, "python worker.py", framework

            return None, f"uvicorn app.main:app --host 0.0.0.0 --port {port}", framework

        return None, None, None

    def install_dependencies(self, project_dir: str | Path, stack: str | None = None) -> CommandResult:
        resolved_stack = stack or self.detect_stack(project_dir)
        root = Path(project_dir)

        if resolved_stack == "node":
            result = self.run(["npm", "install"], cwd=root)
            self._ensure_success(result, "npm install failed")
            return result

        if resolved_stack == "python":
            requirements_file = root / "requirements.txt"
            if requirements_file.exists():
                result = self.run(["pip", "install", "-r", "requirements.txt"], cwd=root)
                self._ensure_success(result, "pip install requirements failed")
                return result
            result = self.run(["pip", "install", "."], cwd=root)
            self._ensure_success(result, "pip install . failed")
            return result

        raise ExecutorError(f"Unsupported stack: {resolved_stack}")

    def build_project(self, project_dir: str | Path, stack: str | None = None, command: str | None = None) -> CommandResult:
        root = Path(project_dir)

        if command:
            args = shlex.split(command)
            result = self.run(args, cwd=root)
            self._ensure_success(result, f"Build command failed: {command}")
            return result

        resolved_stack = stack or self.detect_stack(root)
        if resolved_stack == "node":
            result = self.run(["npm", "run", "build"], cwd=root)
            if result.returncode != 0:
                return result
            return result

        return CommandResult(command=["noop"], returncode=0, stdout="No build step required", stderr="")

    def pm2_start(
        self,
        app_name: str,
        project_dir: str | Path,
        script: str,
        args: list[str] | None = None,
    ) -> CommandResult:
        command = [
            self.pm2_binary,
            "start",
            script,
            "--name",
            app_name,
            "--cwd",
            str(project_dir),
        ]
        if args:
            command.extend(["--", *args])
        result = self.run(command)
        self._ensure_success(result, "pm2 start failed")
        return result

    def pm2_restart(self, app_name: str) -> CommandResult:
        result = self.run([self.pm2_binary, "restart", app_name])
        self._ensure_success(result, f"pm2 restart failed: {app_name}")
        return result

    def pm2_stop(self, app_name: str) -> CommandResult:
        result = self.run([self.pm2_binary, "stop", app_name])
        self._ensure_success(result, f"pm2 stop failed: {app_name}")
        return result

    def pm2_delete(self, app_name: str) -> CommandResult:
        result = self.run([self.pm2_binary, "delete", app_name])
        self._ensure_success(result, f"pm2 delete failed: {app_name}")
        return result

    def pm2_status(self, app_name: str | None = None) -> CommandResult:
        command = [self.pm2_binary, "status"]
        if app_name:
            command.append(app_name)
        result = self.run(command)
        self._ensure_success(result, "pm2 status failed")
        return result

    def deploy(self, plan: DeploymentPlan, stream: LogCallback | None = None) -> None:
        stream = stream or (lambda _line: None)

        stream(f"Preparing deployment for {plan.repo_url}")
        self.clone_or_update(plan.repo_url, plan.target_dir, plan.branch)

        stack = plan.stack or self.detect_stack(plan.target_dir)
        stream(f"Detected stack: {stack}")

        self.install_dependencies(plan.target_dir, stack=stack)
        stream("Dependencies installed")

        build_result = self.build_project(plan.target_dir, stack=stack, command=plan.build_command)
        if build_result.returncode == 0:
            stream("Build completed")
        else:
            stream("Build failed")
            raise ExecutorError(build_result.stderr or "Build failed")

        resolved_start_command = plan.start_command
        if not resolved_start_command:
            _build, suggested_start, framework = self.suggest_commands(
                plan.target_dir,
                stack=stack,
                service_type=plan.service_type,
                port=plan.internal_port or 8000,
            )
            resolved_start_command = suggested_start
            if framework:
                stream(f"Detected python framework: {framework}")

        if resolved_start_command:
            parts = shlex.split(resolved_start_command)
            script = parts[0]
            extra_args = parts[1:] if len(parts) > 1 else None
            app_name = plan.target_dir.name
            self.pm2_start(app_name, plan.target_dir, script, extra_args)
            stream(f"PM2 service started: {app_name}")

    @staticmethod
    def _ensure_success(result: CommandResult, error_message: str) -> None:
        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip()
            raise ExecutorError(f"{error_message}: {details}")
