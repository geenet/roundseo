#!/bin/bash
# One-command RoundSEO production deployment
# Run: ./scripts/DEPLOY_NOW.sh

echo "🚀 RoundSEO Production Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Prerequisites:"
echo "  ✓ Cloudflare account (free or paid)"
echo "  ✓ wrangler CLI: npm install -g wrangler"
echo "  ✓ wrangler login"
echo ""

read -p "Ready to deploy? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled"
    exit 1
fi

cd "$(dirname "$0")/.." || exit 1
exec ./scripts/auto-deploy.sh
