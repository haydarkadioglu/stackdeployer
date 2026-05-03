"""
Analyzer Router
API endpoints for project analysis and tech stack detection
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, List, Optional

from ..analyzer import ProjectAnalyzer, AnalysisResult, TechStack
from ..executor import Executor


class AnalyzeRequest(BaseModel):
    git_url: str = Field(..., description="Git repository URL to analyze")
    branch: str = Field(default="main", description="Git branch to analyze")
    local_path: Optional[str] = Field(default=None, description="Local path if already cloned")


class AnalyzeResponse(BaseModel):
    success: bool
    tech_stack: Dict
    detected_files: List[str]
    package_info: Dict[str, str]
    suggestions: Dict[str, str]
    errors: List[str]
    confidence: float


class TechStackSuggestion(BaseModel):
    name: str
    language: str
    framework: Optional[str]
    package_manager: Optional[str]
    build_command: Optional[str]
    start_command: Optional[str]
    default_port: Optional[int]
    service_type: str
    confidence: float


router = APIRouter(prefix="/analyzer", tags=["analyzer"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_repository(request: AnalyzeRequest) -> AnalyzeResponse:
    """Analyze a Git repository to detect tech stack and suggest configurations"""
    try:
        analyzer = ProjectAnalyzer()
        
        # If local_path not provided, we'd need to clone the repository first
        # For now, assume it's already cloned or analyze the URL structure
        if request.local_path:
            result = analyzer.analyze_repository(request.local_path)
        else:
            # For demo purposes, analyze based on URL patterns
            # In production, this would clone the repo first
            result = _analyze_from_url(request.git_url, analyzer)
        
        return AnalyzeResponse(
            success=True,
            tech_stack=_tech_stack_to_dict(result.tech_stack),
            detected_files=result.detected_files,
            package_info=result.package_info,
            suggestions=result.suggestions,
            errors=result.errors,
            confidence=result.tech_stack.confidence
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.get("/tech-stacks", response_model=List[TechStackSuggestion])
async def get_supported_tech_stacks() -> List[TechStackSuggestion]:
    """Get list of supported tech stacks with default configurations"""
    analyzer = ProjectAnalyzer()
    
    supported_stacks = []
    
    for language, patterns in analyzer.patterns.items():
        for framework, fw_patterns in patterns["frameworks"].items():
            if framework != "generic":
                stack = TechStack(
                    name=f"{language}_{framework}",
                    language=language,
                    framework=framework,
                    package_manager=list(patterns["package_managers"].keys())[0] if patterns["package_managers"] else None,
                    build_command=list(patterns["build_commands"].values())[0] if patterns["build_commands"] else None,
                    start_command=patterns["start_commands"].get(framework) or patterns["start_commands"].get("generic"),
                    default_port=patterns.get("default_port"),
                    service_type="web",
                    confidence=1.0
                )
                supported_stacks.append(TechStackSuggestion(
                    name=stack.name,
                    language=stack.language,
                    framework=stack.framework,
                    package_manager=stack.package_manager,
                    build_command=stack.build_command,
                    start_command=stack.start_command,
                    default_port=stack.default_port,
                    service_type=stack.service_type,
                    confidence=stack.confidence
                ))
    
    return supported_stacks


@router.get("/validate-project")
async def validate_project_config(
    git_url: str,
    tech_stack: str,
    build_command: Optional[str] = None,
    start_command: Optional[str] = None,
    internal_port: Optional[int] = None
) -> Dict:
    """Validate project configuration before deployment"""
    try:
        analyzer = ProjectAnalyzer()
        
        # Basic validation
        validation_result = {
            "valid": True,
            "warnings": [],
            "errors": [],
            "suggestions": {}
        }
        
        # Validate tech stack
        supported_languages = list(analyzer.patterns.keys())
        language = tech_stack.split("_")[0]
        
        if language not in supported_languages:
            validation_result["errors"].append(f"Unsupported tech stack: {tech_stack}")
            validation_result["valid"] = False
            return validation_result
        
        # Validate commands
        if not build_command:
            validation_result["warnings"].append("No build command specified")
        
        if not start_command:
            validation_result["errors"].append("Start command is required")
            validation_result["valid"] = False
        
        # Validate port
        if internal_port and (internal_port < 1024 or internal_port > 65535):
            validation_result["errors"].append("Port must be between 1024 and 65535")
            validation_result["valid"] = False
        
        # Suggest defaults if missing
        patterns = analyzer.patterns[language]
        
        if not internal_port and patterns.get("default_port"):
            validation_result["suggestions"]["internal_port"] = patterns["default_port"]
        
        if not build_command and patterns["build_commands"]:
            validation_result["suggestions"]["build_command"] = list(patterns["build_commands"].values())[0]
        
        return validation_result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")


def _tech_stack_to_dict(tech_stack: TechStack) -> Dict:
    """Convert TechStack to dictionary for response"""
    return {
        "name": tech_stack.name,
        "language": tech_stack.language,
        "framework": tech_stack.framework,
        "package_manager": tech_stack.package_manager,
        "build_command": tech_stack.build_command,
        "start_command": tech_stack.start_command,
        "default_port": tech_stack.default_port,
        "service_type": tech_stack.service_type,
        "confidence": tech_stack.confidence
    }


def _analyze_from_url(git_url: str, analyzer: ProjectAnalyzer) -> AnalysisResult:
    """Analyze repository from URL (placeholder implementation)"""
    # This is a simplified version that analyzes based on URL patterns
    # In production, this would:
    # 1. Clone the repository to a temporary location
    # 2. Run the full analysis
    # 3. Clean up the temporary files
    
    url_lower = git_url.lower()
    
    # Basic URL pattern detection
    if "django" in url_lower or "python" in url_lower:
        tech_stack = TechStack(
            name="python_django",
            language="python",
            framework="django",
            package_manager="pip",
            build_command="pip install -r requirements.txt",
            start_command="python manage.py runserver 0.0.0.0:$PORT",
            default_port=8000,
            service_type="web",
            confidence=0.6
        )
    elif "react" in url_lower or "next" in url_lower:
        tech_stack = TechStack(
            name="node_next",
            language="node",
            framework="next",
            package_manager="npm",
            build_command="npm install",
            start_command="npm run dev",
            default_port=3000,
            service_type="web",
            confidence=0.6
        )
    elif "fastapi" in url_lower:
        tech_stack = TechStack(
            name="python_fastapi",
            language="python",
            framework="fastapi",
            package_manager="pip",
            build_command="pip install -r requirements.txt",
            start_command="uvicorn main:app --host 0.0.0.0 --port $PORT",
            default_port=8000,
            service_type="web",
            confidence=0.7
        )
    else:
        tech_stack = TechStack(
            name="unknown",
            language="unknown",
            confidence=0.0
        )
    
    return AnalysisResult(
        tech_stack=tech_stack,
        detected_files=[],
        package_info={},
        suggestions={},
        errors=["URL-based analysis is limited. Clone repository for full analysis."]
    )
