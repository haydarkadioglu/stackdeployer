#!/bin/bash
set -euo pipefail

# Function to log messages
log() {
    echo "[stackdeployer-start] $*"
}

# Function to check if database is ready
wait_for_db() {
    log "Waiting for database to be ready..."
    if [ -n "${DATABASE_URL:-}" ]; then
        # Extract host from DATABASE_URL
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        if [ -n "$DB_HOST" ] && [ "$DB_HOST" != "localhost" ]; then
            while ! nc -z "$DB_HOST" 5432; do
                log "Database is not ready yet. Waiting..."
                sleep 2
            done
            log "Database is ready!"
        fi
    fi
}

# Function to run migrations
run_migrations() {
    log "Running database migrations..."
    cd /app
    if [ -d "alembic" ]; then
        alembic upgrade head
    else
        log "No alembic directory found, skipping migrations"
    fi
}

# Function to start backend
start_backend() {
    log "Starting StackDeployer backend..."
    cd /app
    exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}
}

# Function to start nginx (if in production)
start_nginx() {
    if [ "${APP_ENV:-}" = "production" ]; then
        log "Starting nginx..."
        nginx -g "daemon off;" &
    fi
}

# Main execution
main() {
    log "Starting StackDeployer..."
    
    # Wait for database if using external DB
    wait_for_db
    
    # Run migrations
    run_migrations
    
    # Start nginx in background if production
    start_nginx
    
    # Start backend (this will block)
    start_backend
}

# Run main function
main "$@"
