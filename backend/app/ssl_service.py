from __future__ import annotations

from datetime import datetime, timezone
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

    def certificate_status(self, domain: str) -> dict[str, object]:
        if not domain:
            raise SSLServiceError("domain is required")

        result = self._run([self.certbot_binary, "certificates", "-d", domain])
        output = (result.stdout or "") + ("\n" + result.stderr if result.stderr else "")

        if result.returncode != 0:
            raise SSLServiceError(result.stderr.strip() or "certbot certificates failed")

        cert_name_marker = f"Certificate Name: {domain}"
        if cert_name_marker not in output and f"Domains: {domain}" not in output:
            return {
                "domain": domain,
                "certificate_present": False,
                "expires_at": None,
                "days_remaining": None,
                "issuer": None,
                "raw_output": output.strip() or None,
            }

        expires_at: str | None = None
        days_remaining: int | None = None
        issuer: str | None = None

        for line in output.splitlines():
            stripped = line.strip()
            if "Expiry Date:" in stripped:
                after = stripped.split("Expiry Date:", 1)[1].strip()
                date_part = after.split("(", 1)[0].strip()
                expires_at = date_part or None
                if "VALID:" in after:
                    try:
                        valid_fragment = after.split("VALID:", 1)[1].split("days", 1)[0]
                        days_remaining = int(valid_fragment.strip())
                    except (ValueError, IndexError):
                        days_remaining = None
            elif stripped.startswith("Issuer:"):
                issuer = stripped.split("Issuer:", 1)[1].strip() or None

        if expires_at and days_remaining is None:
            try:
                expiry_dt = datetime.strptime(expires_at, "%Y-%m-%d %H:%M:%S+00:00")
                days_remaining = (expiry_dt.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days
            except ValueError:
                pass

        return {
            "domain": domain,
            "certificate_present": True,
            "expires_at": expires_at,
            "days_remaining": days_remaining,
            "issuer": issuer,
            "raw_output": output.strip() or None,
        }

    @staticmethod
    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            text=True,
            capture_output=True,
            check=False,
        )
