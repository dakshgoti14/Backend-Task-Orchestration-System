#!/bin/bash
# setup.sh — One-command local development setup
set -e

echo "=== Backend Task Orchestration System — Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose required"; exit 1; }

NODE_VERSION=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Node.js 20+ required (found $(node -v))"; exit 1
fi

echo "✓ Prerequisites check passed"

# Install dependencies
echo "Installing npm dependencies..."
npm ci

# Set up environment
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env from .env.example"
    echo "  → Edit .env with your settings before continuing"
fi

# Start infrastructure
echo "Starting PostgreSQL and Redis..."
docker-compose -f docker/docker-compose.yml up -d postgres redis

# Wait for services to be ready
echo "Waiting for services to be ready..."
until docker exec btos-postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 1
done
echo "✓ PostgreSQL ready"

until docker exec btos-redis redis-cli ping > /dev/null 2>&1; do
    sleep 1
done
echo "✓ Redis ready"

# Run migrations
echo "Running database migrations..."
npm run migrate

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Start the API:    npm run dev"
echo "Start a worker:   npm run worker"
echo "Run tests:        npm test"
echo ""
