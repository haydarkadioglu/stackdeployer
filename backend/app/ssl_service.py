from __future__ import annotations

import subprocess
from typing import Sequence


class SSLServiceError(RuntimeError):
    pass


class SSLService:
    def __init__(self, certbot_binary: str = "certbot") -> None:
        self.certbot_binary = certbot_binary

    def issue_certificate(
        self,
        primary_domain: str,
        *,
        email: str,
        extra_domains: Sequence[str] | None = None,
    ) -> str:
        if not primary_domain:
            raise SSLServiceError("primary_domain is required")
        if not email:
            raise SSLServiceError("email is required for certbot")

        domains = [primary_domain]
        if extra_domains:
            domains.extend([d for d in extra_domains if d and d != primary_domain])

        cmd = [
            self.certbot_binary,
            "--nginx",
            "--non-interactive",
            "--agree-tos",
            "--redirect",
            "-m",
            email,
        ]
        for domain in domains:
            cmd.extend(["-d", domain])

        result = self._run(cmd)
        if result.returncode != 0:
            raise SSLServiceError(result.stderr.strip() or "certbot issue failed")

        return result.stdout.strip() or "certificate issued"

    def renew_certificates(self, *, dry_run: bool = False) -> str:
        cmd = [self.certbot_binary, "renew"]
        if dry_run:
            cmd.append("--dry-run")

        result = self._run(cmd)
        if result.returncode != 0:
            raise SSLServiceError(result.stderr.strip() or "certbot renew failed")

        return result.stdout.strip() or "renew completed"

    @staticmethod
    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            text=True,
            capture_output=True,
            check=False,
        )
