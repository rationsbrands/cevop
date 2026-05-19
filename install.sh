#!/bin/bash
echo "📦 Installing all Cevop dependencies..."

echo "→ Server"
npm install --prefix server

echo "→ Customer PWA"
npm install --prefix apps/customer-pwa

echo "→ Service Display"    
npm install --prefix apps/service-display

echo "→ Admin Dashboard"
npm install --prefix apps/admin-dashboard

echo "→ Ops Dashboard"
npm install --prefix apps/ops-dashboard

echo ""
echo "✅ All dependencies installed."
echo ""
echo "Next steps:"
echo "  1. cp .env.example server/.env  (edit DATABASE_URL and JWT_SECRET)"
echo "  2. cd server && npm run db:migrate && npm run db:seed"
echo "  3. ./start-dev.sh"
