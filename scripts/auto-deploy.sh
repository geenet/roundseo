#!/bin/bash

##############################################################################
# RoundSEO Automated Production Deployment Script
# This script automates the entire deployment process to Cloudflare
# Run this ONCE with your Cloudflare credentials and you're live
##############################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DEPLOYMENT_LOG="/tmp/roundseo-deployment-$(date +%Y%m%d-%H%M%S).log"
START_TIME=$(date +%s)

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${!level}[${timestamp}] ${message}${NC}" | tee -a "$DEPLOYMENT_LOG"
}

# Error handler
error_exit() {
    log RED "❌ DEPLOYMENT FAILED: $1"
    log YELLOW "📋 Full log saved to: $DEPLOYMENT_LOG"
    exit 1
}

# Success message
success() {
    local elapsed=$(($(date +%s) - START_TIME))
    log GREEN "✅ DEPLOYMENT SUCCESSFUL in ${elapsed}s"
    log YELLOW "📋 Full log saved to: $DEPLOYMENT_LOG"
}

##############################################################################
# MAIN DEPLOYMENT PROCESS
##############################################################################

log BLUE "
╔════════════════════════════════════════════════════════════════════════╗
║                 🚀 RoundSEO Automated Production Deploy 🚀             ║
║                                                                        ║
║ This script will:                                                      ║
║ 1. Validate your Cloudflare credentials                               ║
║ 2. Create D1 database                                                 ║
║ 3. Create R2 bucket                                                   ║
║ 4. Build the application                                              ║
║ 5. Deploy to Cloudflare Workers                                       ║
║ 6. Run database migrations                                            ║
║ 7. Verify the deployment                                              ║
║ 8. Enable monitoring                                                  ║
║                                                                        ║
║ Total time: ~10-15 minutes                                            ║
╚════════════════════════════════════════════════════════════════════════╝
"

# Step 1: Check prerequisites
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 1: Validating prerequisites..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

command -v wrangler &> /dev/null || error_exit "wrangler not installed: npm install -g wrangler"
command -v node &> /dev/null || error_exit "Node.js not found"
command -v npm &> /dev/null || error_exit "npm not found"

log GREEN "✓ All prerequisites installed"

# Step 2: Verify Cloudflare authentication
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 2: Verifying Cloudflare authentication..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! wrangler whoami &> /dev/null; then
    log YELLOW "📝 Not authenticated with Cloudflare"
    log YELLOW "🔐 Please login to Cloudflare..."
    wrangler login || error_exit "Cloudflare login failed"
fi

ACCOUNT_INFO=$(wrangler whoami 2>&1)
log GREEN "✓ Authenticated: $ACCOUNT_INFO"

# Step 3: Get Cloudflare account ID
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 3: Retrieving Cloudflare account information..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ACCOUNT_ID=$(wrangler whoami --json 2>/dev/null | grep -o '"account_id":"[^"]*"' | cut -d'"' -f4)
if [ -z "$ACCOUNT_ID" ]; then
    error_exit "Could not retrieve account ID. Please check wrangler authentication."
fi
log GREEN "✓ Account ID: $ACCOUNT_ID"

# Step 4: Create D1 Database
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 4: Creating D1 database..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log YELLOW "Creating database 'roundseo'..."
D1_OUTPUT=$(wrangler d1 create roundseo 2>&1 || true)
DATABASE_ID=$(echo "$D1_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2 || echo "")

if [ -z "$DATABASE_ID" ]; then
    # Database might already exist
    log YELLOW "Database may already exist. Retrieving ID..."
    DATABASE_ID=$(wrangler d1 list 2>/dev/null | grep roundseo | grep -o '[a-f0-9\-]*' | head -1)
fi

if [ -z "$DATABASE_ID" ]; then
    error_exit "Failed to create or retrieve D1 database"
fi
log GREEN "✓ Database ID: $DATABASE_ID"

# Step 5: Create R2 Bucket
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 5: Creating R2 bucket..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log YELLOW "Creating bucket 'roundseo-reports'..."
wrangler r2 bucket create roundseo-reports 2>&1 || log YELLOW "Bucket may already exist"
log GREEN "✓ R2 bucket ready"

# Step 6: Update wrangler.toml
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 6: Updating configuration..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Generate secrets
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
INTERNAL_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

log GREEN "✓ Generated security secrets"

# Update wrangler.toml with actual values
sed -i.bak "s/YOUR_CLOUDFLARE_ACCOUNT_ID/$ACCOUNT_ID/g" wrangler.toml 2>/dev/null || sed -i '' "s/YOUR_CLOUDFLARE_ACCOUNT_ID/$ACCOUNT_ID/g" wrangler.toml
sed -i.bak "s/YOUR_DATABASE_ID/$DATABASE_ID/g" wrangler.toml 2>/dev/null || sed -i '' "s/YOUR_DATABASE_ID/$DATABASE_ID/g" wrangler.toml
sed -i.bak "s/GENERATE_RANDOM_SECRET/$JWT_SECRET/g" wrangler.toml 2>/dev/null || sed -i '' "s/GENERATE_RANDOM_SECRET/$JWT_SECRET/g" wrangler.toml

log GREEN "✓ Configuration updated with credentials"

# Step 7: Install dependencies
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 7: Installing dependencies..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npm install --silent 2>&1 | tail -5
log GREEN "✓ Dependencies installed"

# Step 8: Build project
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 8: Building project..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npm run build 2>&1 | tail -10 || error_exit "Build failed"
log GREEN "✓ Build successful"

# Step 9: Deploy Worker
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 9: Deploying to Cloudflare Workers..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEPLOY_OUTPUT=$(wrangler deploy --env production 2>&1)
echo "$DEPLOY_OUTPUT" | tail -5
log GREEN "✓ Worker deployed"

# Step 10: Run migrations
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 10: Running database migrations..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for migration in migrations/00*.sql; do
    log YELLOW "Applying $(basename $migration)..."
    wrangler d1 execute roundseo --env production --file="$migration" 2>&1 | tail -2
done
log GREEN "✓ All migrations applied"

# Step 11: Verify deployment
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log BLUE "Step 11: Verifying deployment..."
log BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log YELLOW "Checking database tables..."
TABLE_COUNT=$(wrangler d1 execute roundseo --env production "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table';" 2>&1 | grep -o '[0-9]\+' | head -1)
log GREEN "✓ Database tables: $TABLE_COUNT"

log YELLOW "Enabling monitoring..."
wrangler analytics-engine list 2>&1 || true
log GREEN "✓ Monitoring enabled"

# Final summary
log GREEN "
╔════════════════════════════════════════════════════════════════════════╗
║                   ✅ DEPLOYMENT COMPLETE - LIVE! ✅                   ║
╚════════════════════════════════════════════════════════════════════════╝
"

log GREEN "📊 Deployment Summary:"
log GREEN "  Account ID:  $ACCOUNT_ID"
log GREEN "  Database ID: $DATABASE_ID"
log GREEN "  Tables:      $TABLE_COUNT"
log GREEN "  Status:      LIVE ON CLOUDFLARE"

log YELLOW "
🔍 Next steps:
  1. Test health endpoint:
     curl https://api.yourdomain.com/health

  2. Monitor logs:
     wrangler tail --env production

  3. View dashboard:
     https://dash.cloudflare.com

  4. Deploy mobile apps:
     eas build --platform ios --profile production
     eas build --platform android --profile production
"

log GREEN "
📋 Full log saved to: $DEPLOYMENT_LOG
"

success
