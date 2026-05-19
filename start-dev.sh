#!/bin/bash
set -e

echo "🚀 Starting Cevop development environment..."

check_port_free() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ Port $port is already in use. Stop the process using it and re-run start-dev.sh." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

check_port_free 4000
check_port_free 5173
check_port_free 5174
check_port_free 5175
check_port_free 5176

# Start server
(cd server && npm run dev) &
SERVER_PID=$!

# Wait for server
sleep 3

# Start customer PWA
(cd apps/customer-pwa && npm run dev) &
PWA_PID=$!

# Start admin dashboard
(cd apps/admin-dashboard && npm run dev) &
ADMIN_PID=$!

# Start service display
(cd apps/service-display && npm run dev) &
SERVICE_PID=$!

# Start ops dashboard
(cd apps/ops-dashboard && npm run dev) &
OPS_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cevop is running!"
echo ""
echo "  Customer PWA:     http://localhost:5173"
echo "  Admin Dashboard:  http://localhost:5175"
echo "  Service Display:  http://localhost:5174"
echo "  Ops Panel:        http://localhost:5176  ← Cevop internal"
echo "  API Server:       http://localhost:4000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wait
