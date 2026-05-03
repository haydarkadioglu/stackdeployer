# StackDeployer

StackDeployer is a self-hosted control plane for deploying multiple projects (FastAPI, Node.js, mixed stacks) on a single VPS with **universal cross-platform installation**.

## Supported Operating Systems
- **Linux:** Ubuntu 22.04+, Debian 12+
- **macOS:** 10.15+ with Homebrew
- **Windows:** 10/11 with WSL2 or Docker Desktop

## Supported Technology Stacks
- **Python:** FastAPI, Django, Flask, generic Python workers
- **Node.js:** Express, Next.js, React, Vue, generic Node.js apps
- **Go:** Gin, Echo, Fiber, generic Go services
- **Java:** Spring Boot, Quarkus, generic Java apps

Service modes:
- **web:** HTTP service with optional domain and Nginx mapping
- **worker:** Background or console process without public route requirement

## 🚀 Quick Start

### Universal Installation (Recommended)

**Linux/macOS:**
```bash
curl -sSL https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install-universal.sh | bash
```

**Windows:**
```powershell
irm https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install.ps1 | iex
```

**Docker:**
```bash
git clone https://github.com/haydarkadioglu/stackdeployer
cd stackdeployer
docker-compose up -d
```

### Post-Installation Setup

1. **Bootstrap Admin User:**
```bash
curl -X POST http://localhost:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_STRONG_PASSWORD"}'
```

2. **Access Dashboard:**
- URL: `http://localhost:8001`
- Login with admin credentials

3. **Verify Health:**
```bash
curl http://localhost:8001/api/v1/health
```

## 🎯 Features

### Smart Tech Stack Detection
- **Automatic Analysis:** Detects Python, Node.js, Go, Java projects from Git repositories
- **Intelligent Suggestions:** Suggests build commands, start commands, and configurations
- **Framework Support:** Recognizes Django, FastAPI, Flask, Express, Next.js, Spring Boot, etc.

### Cross-Platform Installation
- **Universal Installer:** One command works on Linux, macOS, and Windows
- **Docker Support:** Containerized deployment with Docker Compose
- **Development Mode:** Quick setup for local development

### Advanced Deployment Management
- **Project Analytics:** Real-time monitoring and logging
- **Domain Management:** Automatic Nginx configuration and SSL setup
- **Process Control:** PM2 integration for process lifecycle management

## 📋 API Documentation

### Tech Stack Analysis
```bash
# Analyze a repository
curl -X POST http://localhost:8001/api/v1/analyzer/analyze \
  -H "Content-Type: application/json" \
  -d '{"git_url":"https://github.com/your-repo"}'

# Get supported tech stacks
curl http://localhost:8001/api/v1/analyzer/tech-stacks

# Validate project configuration
curl "http://localhost:8001/api/v1/analyzer/validate-project?git_url=...&tech_stack=..."
```

### Project Management
```bash
# Create project with auto-detected configuration
curl -X POST http://localhost:8001/api/v1/projects \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "git_url": "https://github.com/user/repo",
    "tech_stack": "python_fastapi",
    "service_type": "web",
    "internal_port": 8000
  }'
```

## 🔧 Configuration

### Environment Variables
```bash
# Production
APP_ENV=production
DATABASE_URL=postgresql://user:pass@localhost:5432/stackdeployer
JWT_SECRET=your-very-secure-secret
CORS_ORIGINS=https://yourdomain.com

# Development
APP_ENV=development
DATABASE_URL=sqlite:///./stackdeployer.db
JWT_SECRET=dev-secret-change-in-production
```

### Docker Configuration
```yaml
# docker-compose.yml override example
version: '3.8'
services:
  stackdeployer:
    environment:
      - APP_ENV=production
      - JWT_SECRET=your-custom-secret
    ports:
      - "8001:8001"
```

## 🌐 Domain & SSL Setup

### Custom Domain Configuration
1. **DNS Setup:** Create `A` record pointing to your VPS IP
2. **Project Creation:** Add project in StackDeployer dashboard
3. **Nginx Configuration:** Apply domain mapping via API or UI

```bash
curl -X POST http://localhost:8001/api/v1/projects/<PROJECT_ID>/nginx/apply \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"site_name":"myapp","domain":"app.example.com"}'
```

### SSL Certificate Setup
```bash
# Automatic SSL via Certbot
sudo certbot --nginx -d app.example.com

# Or via StackDeployer API
curl -X POST http://localhost:8001/api/v1/projects/<PROJECT_ID>/ssl/issue \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com"}'
## 🛠️ Development

### Local Development Setup
```bash
# Clone repository
git clone https://github.com/haydarkadioglu/stackdeployer
cd stackdeployer

# Backend setup
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create environment file
echo "app_env=development" > .env

# Run migrations
alembic upgrade head

# Start backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

### Docker Development
```bash
# Development with hot reload
docker-compose up

# Production build
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 📚 Documentation

- **[Universal Installer Guide](README-UNIVERSAL-INSTALLER.md)** - Complete installation instructions
- **[API Documentation](http://localhost:8001/docs)** - Interactive API docs (after installation)
- **[Cleanup Report](CLEANUP.md)** - Recent changes and removed files

## 🔍 Troubleshooting

### Common Issues

**Installation fails on Windows:**
```powershell
# Use Docker method
docker-compose up -d

# Or install WSL2 first
wsl --install
```

**Port conflicts:**
```bash
# Change port
APP_PORT=8002 bash install-universal.sh

# Or check what's using the port
netstat -tulpn | grep :8001
```

**Backend won't start:**
```bash
# Check environment variables
cat backend/.env

# Check logs
docker-compose logs stackdeployer
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Repository:** https://github.com/haydarkadioglu/stackdeployer
- **Issues:** https://github.com/haydarkadioglu/stackdeployer/issues
- **Discussions:** https://github.com/haydarkadioglu/stackdeployer/discussions

## 🚀 Current Capabilities

### Backend Features
- **Project CRUD API** - Complete project lifecycle management
- **Tech Stack Detection** - Automatic analysis and configuration suggestions
- **Service Types** - `web` and `worker` process management
- **JWT Authentication** - Secure user authentication and authorization
- **Deployment Executor** - Git cloning, building, and PM2 lifecycle management
- **Nginx Automation** - Dynamic site configuration with validation
- **Realtime Logging** - WebSocket-based log streaming
- **SSL Management** - Automated certificate handling via Certbot
- **Database Migrations** - Alembic-based schema management

### Frontend Features
- **Modern React Dashboard** - Intuitive project management interface
- **Real-time Updates** - Live status monitoring and logs
- **Project Wizard** - Step-by-step project creation with auto-detection
- **Domain Management** - Easy domain and SSL configuration
- **Responsive Design** - Works on desktop and mobile devices

## 🧪 Testing

### Backend Tests
```bash
cd backend
python -m pytest -q
```

### Integration Tests
```bash
# Test tech stack detection
curl -X POST http://localhost:8001/api/v1/analyzer/analyze \
  -H "Content-Type: application/json" \
  -d '{"git_url":"https://github.com/django/django"}'

# Test API health
curl http://localhost:8001/api/v1/health
```

## 📖 Additional Documentation

For detailed setup, configuration, and troubleshooting information:
- **[Universal Installer Guide](README-UNIVERSAL-INSTALLER.md)** - Complete installation instructions
- **[Migration Guide](docs/MIGRATION.md)** - Upgrade from legacy installations
- **[API Documentation](http://localhost:8001/docs)** - Interactive API docs (after installation)
- **[Cleanup Report](CLEANUP.md)** - Recent changes and removed files
- **[Legacy Setup](docs/DETAILED_SETUP.md)** - Historical installation documentation (deprecated)

---

**StackDeployer** - Simplify your deployment workflow with intelligent project management and cross-platform installation.
