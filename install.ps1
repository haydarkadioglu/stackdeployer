# StackDeployer Universal Installer for Windows
# PowerShell script for cross-platform installation

param(
    [string]$InstallDir = "C:\StackDeployer",
    [int]$Port = 8001,
    [switch]$UseDocker = $false,
    [switch]$Force = $false
)

# Colors for output
$Colors = @{
    Red = "Red"
    Green = "Green"
    Yellow = "Yellow"
    Blue = "Blue"
    White = "White"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host "[StackDeployer] $Message" -ForegroundColor $Colors[$Color]
}

function Write-Success {
    param([string]$Message)
    Write-ColorOutput $Message "Green"
}

function Write-Warning {
    param([string]$Message)
    Write-ColorOutput $Message "Yellow"
}

function Write-Error {
    param([string]$Message)
    Write-ColorOutput $Message "Red"
}

function Write-Log {
    param([string]$Message)
    Write-ColorOutput $Message "Blue"
}

# Check if running as Administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Check WSL2 availability
function Test-WSL2 {
    try {
        $wsl = wsl --list 2>$null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

# Check Docker availability
function Test-Docker {
    try {
        $docker = docker --version 2>$null
        $compose = docker-compose --version 2>$null
        return ($docker -and $compose -and (docker info 2>$null))
    }
    catch {
        return $false
    }
}

# Install Chocolatey if not present
function Install-Chocolatey {
    if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Log "Installing Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        refreshenv
    }
}

# Install dependencies via Chocolatey
function Install-Dependencies {
    Write-Log "Installing dependencies..."
    
    $packages = @(
        "git",
        "nodejs",
        "python3",
        "vscode"
    )
    
    foreach ($package in $packages) {
        if (!(Get-Command $package -ErrorAction SilentlyContinue)) {
            Write-Log "Installing $package..."
            choco install $package -y
        }
    }
    
    # Install PM2 globally
    if (!(Get-Command pm2 -ErrorAction SilentlyContinue)) {
        Write-Log "Installing PM2..."
        npm install -g pm2
    }
}

# Generate random secret
function New-Secret {
    try {
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 32
        $random.GetBytes($bytes)
        return ($bytes | ForEach-Object { "{0:x2}" -f $_ }) -join ""
    }
    catch {
        # Fallback to simpler method
        return -join ('a'..'z' + 'A'..'Z' + '0'..'9' | Get-Random -Count 32)
    }
}

# Create environment file
function New-EnvironmentFile {
    param([string]$BackendDir)
    
    $envFile = Join-Path $BackendDir ".env"
    
    if (!(Test-Path $envFile)) {
        Write-Log "Creating environment file..."
        
        $secret = New-Secret
        $envContent = @"
app_env=production
database_url=sqlite:///$BackendDir/stackdeployer.db
jwt_secret=$secret
jwt_algorithm=HS256
jwt_access_token_expire_minutes=60
cors_origins=http://localhost:3000,http://127.0.0.1:3000
allowed_project_roots=C:\StackDeployer\projects,C:\projects
"@
        
        $envContent | Out-File -FilePath $envFile -Encoding UTF8
    }
}

# Install using WSL2
function Install-WSL2 {
    Write-Log "Installing via WSL2..."
    
    if (!(Test-WSL2)) {
        Write-Error "WSL2 is not installed or not available."
        Write-Log "Please install WSL2 first: https://docs.microsoft.com/en-us/windows/wsl/install"
        return $false
    }
    
    # Copy files to WSL and run Linux installer
    $wslCommand = @"
cd /mnt$((Get-Location).DriveLetter.ToLower())$((Get-Location).Path.Substring(2).Replace('\','/'))
sudo bash install.sh
"@
    
    wsl bash -c $wslCommand
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "WSL2 installation complete!"
        return $true
    }
    
    Write-Error "WSL2 installation failed"
    return $false
}

# Install using Docker
function Install-Docker {
    Write-Log "Installing using Docker..."
    
    if (!(Test-Docker)) {
        Write-Error "Docker is not available. Please install Docker Desktop first."
        return $false
    }
    
    # Create docker-compose override
    $overrideContent = @"
version: '3.8'
services:
  stackdeployer:
    environment:
      - APP_ENV=production
      - JWT_SECRET=$(New-Secret)
    ports:
      - "$($Port):8001"
"@
    
    $overrideContent | Out-File -FilePath "docker-compose.override.yml" -Encoding UTF8
    
    # Start services
    docker-compose up -d
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker installation complete!"
        return $true
    }
    
    Write-Error "Docker installation failed"
    return $false
}

# Install natively on Windows
function Install-Native {
    Write-Log "Installing natively on Windows..."
    
    # Check administrator privileges
    if (!(Test-Administrator)) {
        Write-Error "Administrator privileges required for native installation."
        Write-Log "Please run PowerShell as Administrator."
        return $false
    }
    
    # Create installation directory
    if (!(Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force
    }
    
    # Copy source files
    $sourceDir = Get-Location
    $backendDir = Join-Path $InstallDir "backend"
    $frontendDir = Join-Path $InstallDir "frontend"
    
    Copy-Item -Path "$sourceDir\backend\*" -Destination $backendDir -Recurse -Force
    Copy-Item -Path "$sourceDir\frontend\*" -Destination $frontendDir -Recurse -Force
    
    # Setup Python environment
    Set-Location $backendDir
    python -m venv .venv
    .\.venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    
    # Build frontend
    Set-Location $frontendDir
    npm install
    npm run build
    
    # Create environment file
    New-EnvironmentFile -BackendDir $backendDir
    
    # Run migrations
    Set-Location $backendDir
    .\.venv\Scripts\Activate.ps1
    alembic upgrade head
    
    # Create Windows service
    $serviceName = "StackDeployer"
    $servicePath = Join-Path $backendDir ".venv\Scripts\python.exe"
    $serviceArgs = "-m uvicorn app.main:app --host 127.0.0.1 --port $Port"
    
    # Remove existing service if present
    if (Get-Service $serviceName -ErrorAction SilentlyContinue) {
        Stop-Service $serviceName
        Remove-Service $serviceName
    }
    
    # Create new service
    New-Service -Name $serviceName -BinaryPathName "`"$servicePath`" $serviceArgs" -DisplayName "StackDeployer Control Plane" -StartupType Automatic
    Start-Service $serviceName
    
    Write-Success "Native Windows installation complete!"
    return $true
}

# Health check
function Test-Health {
    Write-Log "Performing health check..."
    
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/v1/health" -TimeoutSec 10
        Write-Success "StackDeployer is running and healthy!"
        return $true
    }
    catch {
        Write-Warning "Health check failed. StackDeployer may not be running properly."
        return $false
    }
}

# Show post-installation information
function Show-PostInstall {
    $message = @"

Installation Complete!

Next Steps:
1. Bootstrap admin user:
   curl -X POST http://localhost:$Port/api/v1/auth/bootstrap `
     -H "Content-Type: application/json" `
     -d '{"username":"admin","password":"YOUR_STRONG_PASSWORD"}'

2. Access the panel:
   http://localhost:$Port

3. Check service status:
   Get-Service StackDeployer

Documentation:
- https://github.com/haydarkadioglu/stackdeployer
- Check README.md for detailed usage

"@
    
    Write-Host $message -ForegroundColor Green
}

# Main installation function
function Start-Installation {
    Write-Log "Starting StackDeployer installation..."
    Write-Log "Platform: Windows"
    
    # Determine installation method
    $installMethod = "native"
    
    if ($UseDocker -and (Test-Docker)) {
        $installMethod = "docker"
        Write-Log "Docker detected, using Docker installation"
    }
    elseif ((Test-WSL2) -and !$Force) {
        $installMethod = "wsl"
        Write-Log "WSL2 detected, using WSL2 installation"
    }
    
    # Check dependencies for native installation
    if ($installMethod -eq "native") {
        if (!(Test-Administrator)) {
            Write-Error "Administrator privileges required for native installation."
            Write-Log "Please run PowerShell as Administrator or use -UseDocker switch."
            exit 1
        }
        
        Install-Chocolatey
        Install-Dependencies
    }
    
    # Perform installation
    $success = $false
    
    switch ($installMethod) {
        "docker" {
            $success = Install-Docker
        }
        "wsl" {
            $success = Install-WSL2
        }
        "native" {
            $success = Install-Native
        }
    }
    
    if (!$success) {
        Write-Error "Installation failed!"
        exit 1
    }
    
    # Health check
    Start-Sleep 3
    Test-Health
    
    # Show next steps
    Show-PostInstall
}

# Script entry point
try {
    Start-Installation
}
catch {
    Write-Error "Installation failed with error: $($_.Exception.Message)"
    exit 1
}
