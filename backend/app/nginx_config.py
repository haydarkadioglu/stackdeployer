from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import subprocess


class NginxConfigError(RuntimeError):
    pass


@dataclass(slots=True)
class NginxSiteConfig:
    site_name: str
    domain: str
    upstream_host: str = "127.0.0.1"
    upstream_port: int = 8000
    websocket_support: bool = True


class NginxManager:
    def __init__(
        self,
        sites_available_dir: str = "/etc/nginx/sites-available",
        sites_enabled_dir: str = "/etc/nginx/sites-enabled",
        nginx_binary: str = "nginx",
    ) -> None:
        self.sites_available_dir = Path(sites_available_dir)
        self.sites_enabled_dir = Path(sites_enabled_dir)
        self.nginx_binary = nginx_binary

    def render_site_config(self, config: NginxSiteConfig) -> str:
        self._validate_site_name(config.site_name)
        self._validate_domain(config.domain)

        websocket_map = ""
        proxy_upgrade_line = ""
        if config.websocket_support:
            websocket_map = (
                "map $http_upgrade $connection_upgrade {\n"
                "    default upgrade;\n"
                "    '' close;\n"
                "}\n\n"
            )
            proxy_upgrade_line = (
                "        proxy_set_header Upgrade $http_upgrade;\n"
                "        proxy_set_header Connection $connection_upgrade;\n"
            )

        return (
            f"{websocket_map}"
            "server {\n"
            "    listen 80;\n"
            f"    server_name {config.domain};\n\n"
            "    location / {\n"
            f"        proxy_pass http://{config.upstream_host}:{config.upstream_port};\n"
            "        proxy_http_version 1.1;\n"
            "        proxy_set_header Host $host;\n"
            "        proxy_set_header X-Real-IP $remote_addr;\n"
            "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
            "        proxy_set_header X-Forwarded-Proto $scheme;\n"
            f"{proxy_upgrade_line}"
            "        proxy_read_timeout 300s;\n"
            "        proxy_connect_timeout 30s;\n"
            "    }\n"
            "}\n"
        )

    def apply_site(self, config: NginxSiteConfig) -> Path:
        self.sites_available_dir.mkdir(parents=True, exist_ok=True)
        self.sites_enabled_dir.mkdir(parents=True, exist_ok=True)

        config_text = self.render_site_config(config)
        available_path = self.sites_available_dir / config.site_name
        enabled_path = self.sites_enabled_dir / config.site_name
        temp_path = available_path.with_suffix(".tmp")
        backup_path = available_path.with_suffix(".bak")

        had_existing = available_path.exists()
        previous_content = available_path.read_text(encoding="utf-8") if had_existing else ""

        temp_path.write_text(config_text, encoding="utf-8")

        try:
            if had_existing:
                available_path.replace(backup_path)

            temp_path.replace(available_path)
            self._ensure_symlink(enabled_path, available_path)

            self.validate_config()
            self.reload()
        except Exception as exc:
            if available_path.exists():
                available_path.unlink(missing_ok=True)

            if had_existing and backup_path.exists():
                backup_path.replace(available_path)

            if not had_existing and available_path.exists():
                available_path.unlink(missing_ok=True)

            if had_existing:
                available_path.write_text(previous_content, encoding="utf-8")

            raise NginxConfigError(f"Failed to apply nginx site '{config.site_name}': {exc}") from exc
        finally:
            temp_path.unlink(missing_ok=True)
            backup_path.unlink(missing_ok=True)

        return available_path

    def remove_site(self, site_name: str) -> None:
        self._validate_site_name(site_name)

        available_path = self.sites_available_dir / site_name
        enabled_path = self.sites_enabled_dir / site_name

        enabled_path.unlink(missing_ok=True)
        available_path.unlink(missing_ok=True)

        self.validate_config()
        self.reload()

    def validate_config(self) -> None:
        result = self._run([self.nginx_binary, "-t"])
        if result.returncode != 0:
            raise NginxConfigError(result.stderr.strip() or "nginx -t failed")

    def reload(self) -> None:
        result = self._run([self.nginx_binary, "-s", "reload"])
        if result.returncode != 0:
            raise NginxConfigError(result.stderr.strip() or "nginx reload failed")

    def _ensure_symlink(self, enabled_path: Path, available_path: Path) -> None:
        if enabled_path.exists() or enabled_path.is_symlink():
            enabled_path.unlink(missing_ok=True)
        enabled_path.symlink_to(available_path)

    @staticmethod
    def _validate_domain(domain: str) -> None:
        pattern = r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,}$"
        if not re.match(pattern, domain):
            raise ValueError(f"Invalid domain: {domain}")

    @staticmethod
    def _validate_site_name(site_name: str) -> None:
        if not re.match(r"^[a-zA-Z0-9._-]+$", site_name):
            raise ValueError(f"Invalid site name: {site_name}")

    @staticmethod
    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            text=True,
            capture_output=True,
            check=False,
        )
