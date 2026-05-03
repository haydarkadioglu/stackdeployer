"""
Project Analyzer Service
Detects tech stack and suggests configurations from Git repository
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from .executor import Executor, LogCallback


@dataclass
class TechStack:
    name: str
    language: str
    framework: Optional[str] = None
    package_manager: Optional[str] = None
    build_command: Optional[str] = None
    start_command: Optional[str] = None
    default_port: Optional[int] = None
    service_type: str = "web"
    confidence: float = 0.0


@dataclass
class AnalysisResult:
    tech_stack: TechStack
    detected_files: List[str]
    package_info: Dict[str, str]
    suggestions: Dict[str, str]
    errors: List[str]


class ProjectAnalyzer:
    def __init__(self, executor: Optional[Executor] = None):
        self.executor = executor or Executor()
        self.patterns = self._load_patterns()

    def _load_patterns(self) -> Dict[str, Dict]:
        """Load detection patterns for different tech stacks"""
        return {
            "python": {
                "files": [
                    "requirements.txt",
                    "setup.py", 
                    "pyproject.toml",
                    "Pipfile",
                    "poetry.lock",
                    "manage.py",
                    "app.py",
                    "main.py",
                    "wsgi.py"
                ],
                "frameworks": {
                    "django": ["manage.py", "django.conf", "from django"],
                    "flask": ["from flask import Flask", "Flask(__name__)", "@app.route"],
                    "fastapi": ["from fastapi import FastAPI", "FastAPI()", "@app."],
                    "generic": ["if __name__ == '__main__':", "app.run(", "uvicorn"]
                },
                "package_managers": {
                    "pip": ["requirements.txt"],
                    "poetry": ["pyproject.toml", "poetry.lock"],
                    "pipenv": ["Pipfile", "Pipfile.lock"]
                },
                "build_commands": {
                    "pip": "pip install -r requirements.txt",
                    "poetry": "poetry install",
                    "pipenv": "pipenv install"
                },
                "start_commands": {
                    "django": "python manage.py runserver 0.0.0.0:$PORT",
                    "flask": "python app.py",
                    "fastapi": "uvicorn main:app --host 0.0.0.0 --port $PORT",
                    "generic": "python main.py"
                },
                "default_port": 8000
            },
            "node": {
                "files": [
                    "package.json",
                    "package-lock.json",
                    "yarn.lock",
                    "pnpm-lock.yaml",
                    "npm-shrinkwrap.json",
                    "server.js",
                    "app.js",
                    "index.js",
                    "next.config.js",
                    "nuxt.config.js"
                ],
                "frameworks": {
                    "express": ["express()", "require('express')", "app.listen"],
                    "next": ["next.config.js", "pages/", "next/"],
                    "nuxt": ["nuxt.config.js", "nuxt/"],
                    "react": ["react-dom", "ReactDOM.render"],
                    "vue": ["vue/", "Vue.createApp"],
                    "generic": ["node", "npm start"]
                },
                "package_managers": {
                    "npm": ["package.json", "package-lock.json"],
                    "yarn": ["yarn.lock"],
                    "pnpm": ["pnpm-lock.yaml"]
                },
                "build_commands": {
                    "npm": "npm install",
                    "yarn": "yarn install",
                    "pnpm": "pnpm install"
                },
                "start_commands": {
                    "express": "node server.js",
                    "next": "npm run dev",
                    "nuxt": "npm run dev",
                    "react": "npm start",
                    "vue": "npm run serve",
                    "generic": "npm start"
                },
                "default_port": 3000
            },
            "go": {
                "files": [
                    "go.mod",
                    "go.sum",
                    "main.go",
                    "server.go",
                    "main_test.go"
                ],
                "frameworks": {
                    "gin": ["gin-gonic/gin", "gin.Default()"],
                    "echo": ["labstack/echo", "echo.New()"],
                    "fiber": ["gofiber/fiber", "fiber.New()"],
                    "generic": ["net/http", "http.ListenAndServe"]
                },
                "package_managers": {
                    "go": ["go.mod"]
                },
                "build_commands": {
                    "go": "go mod download"
                },
                "start_commands": {
                    "gin": "go run main.go",
                    "echo": "go run main.go",
                    "fiber": "go run main.go",
                    "generic": "go run main.go"
                },
                "default_port": 8080
            },
            "java": {
                "files": [
                    "pom.xml",
                    "build.gradle",
                    "src/main/java",
                    "Application.java",
                    "Main.java"
                ],
                "frameworks": {
                    "spring": ["spring-boot", "@SpringBootApplication"],
                    "quarkus": ["quarkus", "quarkus-"],
                    "generic": ["public static void main"]
                },
                "package_managers": {
                    "maven": ["pom.xml"],
                    "gradle": ["build.gradle", "gradlew"]
                },
                "build_commands": {
                    "maven": "mvn clean install",
                    "gradle": "./gradlew build"
                },
                "start_commands": {
                    "spring": "java -jar target/*.jar",
                    "quarkus": "./gradlew quarkus:dev",
                    "generic": "java -jar app.jar"
                },
                "default_port": 8080
            }
        }

    def analyze_repository(self, repo_path: str, log_callback: Optional[LogCallback] = None) -> AnalysisResult:
        """Analyze a repository to detect tech stack and suggest configurations"""
        path = Path(repo_path)
        
        if not path.exists():
            return AnalysisResult(
                tech_stack=TechStack(name="unknown", language="unknown"),
                detected_files=[],
                package_info={},
                suggestions={},
                errors=[f"Repository path does not exist: {repo_path}"]
            )

        detected_files = []
        package_info = {}
        errors = []
        suggestions = {}

        # Scan for files
        try:
            for file_path in path.rglob("*"):
                if file_path.is_file() and not self._should_ignore_file(file_path):
                    detected_files.append(str(file_path.relative_to(path)))
        except Exception as e:
            errors.append(f"Error scanning files: {str(e)}")

        # Detect tech stack
        tech_stack = self._detect_tech_stack(detected_files, path, log_callback)
        
        # Extract package information
        package_info = self._extract_package_info(detected_files, path, tech_stack.language, log_callback)
        
        # Generate suggestions
        suggestions = self._generate_suggestions(tech_stack, package_info, detected_files)

        return AnalysisResult(
            tech_stack=tech_stack,
            detected_files=detected_files,
            package_info=package_info,
            suggestions=suggestions,
            errors=errors
        )

    def _should_ignore_file(self, file_path: Path) -> bool:
        """Check if file should be ignored during analysis"""
        ignore_patterns = [
            ".git/", "__pycache__/", "node_modules/", "target/", "build/",
            ".vscode/", ".idea/", "*.log", "*.tmp", ".env*"
        ]
        
        file_str = str(file_path)
        return any(pattern.replace("/", "") in file_str for pattern in ignore_patterns)

    def _detect_tech_stack(self, files: List[str], repo_path: Path, log_callback: Optional[LogCallback] = None) -> TechStack:
        """Detect the primary tech stack from files"""
        scores = {}
        
        for language, patterns in self.patterns.items():
            score = 0
            framework = None
            package_manager = None
            
            # Check for language files
            for pattern_file in patterns["files"]:
                if any(pattern_file in file for file in files):
                    score += 1
            
            # Detect framework
            for fw_name, fw_patterns in patterns["frameworks"].items():
                fw_score = 0
                for pattern in fw_patterns:
                    # Check in file names first
                    if any(pattern in file for file in files):
                        fw_score += 2
                    # Then check file contents
                    for file in files:
                        file_path = repo_path / file
                        if file_path.is_file() and file_path.suffix in ['.py', '.js', '.go', '.java']:
                            try:
                                content = file_path.read_text(encoding='utf-8', errors='ignore')
                                if pattern in content:
                                    fw_score += 3
                            except Exception:
                                pass
                
                if fw_score > 0 and fw_score > scores.get(language, {}).get("framework_score", 0):
                    framework = fw_name
                    scores.setdefault(language, {})["framework_score"] = fw_score
            
            # Detect package manager
            for pm_name, pm_patterns in patterns["package_managers"].items():
                if any(pattern in files for pattern in pm_patterns):
                    package_manager = pm_name
                    score += 2
            
            if score > 0:
                scores[language] = {
                    "score": score,
                    "framework": framework,
                    "package_manager": package_manager
                }

        # Determine best match
        if not scores:
            return TechStack(name="unknown", language="unknown")

        best_language = max(scores.keys(), key=lambda k: scores[k]["score"])
        best_info = scores[best_language]
        patterns = self.patterns[best_language]

        # Determine commands
        build_command = None
        start_command = None
        
        if best_info["package_manager"]:
            build_command = patterns["build_commands"].get(best_info["package_manager"])
        
        if best_info["framework"]:
            start_command = patterns["start_commands"].get(best_info["framework"])
        else:
            start_command = patterns["start_commands"].get("generic")

        # Calculate confidence
        max_possible_score = len(patterns["files"]) + 5  # framework + package manager
        confidence = min(best_info["score"] / max_possible_score, 1.0)

        return TechStack(
            name=f"{best_language}_{best_info['framework'] or 'generic'}",
            language=best_language,
            framework=best_info["framework"],
            package_manager=best_info["package_manager"],
            build_command=build_command,
            start_command=start_command,
            default_port=patterns.get("default_port"),
            service_type="web" if best_info["framework"] else "worker",
            confidence=confidence
        )

    def _extract_package_info(self, files: List[str], repo_path: Path, language: str, log_callback: Optional[LogCallback] = None) -> Dict[str, str]:
        """Extract package information from package files"""
        info = {}
        
        if language == "python":
            for file in files:
                if file == "requirements.txt":
                    try:
                        content = (repo_path / file).read_text(encoding='utf-8')
                        packages = [line.split('==')[0].strip() for line in content.split('\n') if line.strip() and not line.startswith('#')]
                        info["packages"] = ", ".join(packages[:10])  # First 10 packages
                        if len(packages) > 10:
                            info["packages"] += f" (and {len(packages) - 10} more)"
                    except Exception:
                        pass
                elif file == "pyproject.toml":
                    try:
                        content = (repo_path / file).read_text(encoding='utf-8')
                        # Simple TOML parsing for name and version
                        name_match = re.search(r'name\s*=\s*["\']([^"\']+)["\']', content)
                        version_match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
                        if name_match:
                            info["project_name"] = name_match.group(1)
                        if version_match:
                            info["version"] = version_match.group(1)
                    except Exception:
                        pass

        elif language == "node":
            if "package.json" in files:
                try:
                    content = (repo_path / "package.json").read_text(encoding='utf-8')
                    package_data = json.loads(content)
                    info["project_name"] = package_data.get("name", "unknown")
                    info["version"] = package_data.get("version", "unknown")
                    info["main"] = package_data.get("main", "index.js")
                    
                    # Get scripts
                    scripts = package_data.get("scripts", {})
                    if scripts:
                        info["scripts"] = ", ".join(f"{k}: {v}" for k, v in list(scripts.items())[:5])
                    
                    # Get dependencies count
                    deps = len(package_data.get("dependencies", {}))
                    dev_deps = len(package_data.get("devDependencies", {}))
                    info["dependencies"] = f"{deps} prod, {dev_deps} dev"
                except Exception:
                    pass

        return info

    def _generate_suggestions(self, tech_stack: TechStack, package_info: Dict[str, str], files: List[str]) -> Dict[str, str]:
        """Generate configuration suggestions based on analysis"""
        suggestions = {}
        
        # Basic suggestions
        if tech_stack.confidence < 0.5:
            suggestions["warning"] = "Low confidence detection. Please verify the suggested configuration."
        
        # Port suggestions
        if tech_stack.default_port:
            suggestions["internal_port"] = str(tech_stack.default_port)
        
        # Service type suggestions
        if tech_stack.framework:
            suggestions["service_type"] = "web"
        else:
            suggestions["service_type"] = "worker"
        
        # Environment suggestions
        env_vars = []
        
        if tech_stack.language == "python":
            env_vars.extend(["PYTHONPATH=/app", "PYTHONUNBUFFERED=1"])
            if tech_stack.framework == "django":
                env_vars.append("DJANGO_SETTINGS_MODULE=app.settings")
            elif tech_stack.framework == "fastapi":
                env_vars.append("PYTHONPATH=/app")
        
        elif tech_stack.language == "node":
            env_vars.extend(["NODE_ENV=production"])
            if tech_stack.framework == "next":
                env_vars.append("NEXT_TELEMETRY_DISABLED=1")
        
        if env_vars:
            suggestions["environment_variables"] = "\n".join(env_vars)
        
        # Health check suggestions
        if tech_stack.framework and tech_stack.default_port:
            suggestions["health_check_path"] = f"/health"
        
        return suggestions
