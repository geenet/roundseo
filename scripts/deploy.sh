#!/bin/bash

# RoundSEO Cloudflare Deployment Script
# This script deploys RoundSEO to Cloudflare Workers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 RoundSEO Deployment to Cloudflare${NC}\n"

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler CLI not found. Install with: npm install -g wrangler${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install npm${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}\n"

# Get environment
echo -e "${YELLOW}🔧 Deployment Environment${NC}"
echo "1. Development (local)"
echo "2. Staging"
echo "3. Production"
read -p "Select environment [1-3]: " ENV_CHOICE

case $ENV_CHOICE in
    1) ENV="development" ;;
    2) ENV="staging" ;;
    3) ENV="production" ;;
    *) echo "Invalid choice"; exit 1 ;;
esac

echo -e "${GREEN}Environment: $ENV${NC}\n"

# Confirm for production
if [ "$ENV" = "production" ]; then
    echo -e "${RED}⚠️  PRODUCTION DEPLOYMENT${NC}"
    read -p "Type 'yes' to confirm production deployment: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Cancelled"
        exit 1
    fi
fi

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install

# Build project
echo -e "${YELLOW}🔨 Building project...${NC}"
npm run build

# Check wrangler.toml configuration
echo -e "${YELLOW}🔐 Verifying configuration...${NC}"
if grep -q "YOUR_CLOUDFLARE_ACCOUNT_ID" wrangler.toml; then
    echo -e "${RED}❌ wrangler.toml not configured. Please update with your credentials${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Configuration verified${NC}\n"

# Deploy
echo -e "${YELLOW}🚀 Deploying to Cloudflare...${NC}"
wrangler deploy --env $ENV

echo -e "${GREEN}✓ Deployment successful${NC}\n"
echo "For PageSpeed audits, set the provider key once with:"
echo "wrangler secret put GOOGLE_PAGESPEED_API_KEY --env $ENV"
echo ""

# Run migrations
echo -e "${YELLOW}📊 Running database migrations...${NC}"
echo "Run the following command to apply migrations:"
echo ""
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/001_initial_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/002_crawl_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/003_keywords_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/004_reports_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/005_audit_evidence_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/006_operating_workflow_schema.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/007_finding_evidence.sql"
echo "wrangler d1 execute roundseo --env $ENV --file=migrations/008_performance_audits.sql"
echo ""

# Verify deployment
echo -e "${YELLOW}🔍 Verifying deployment...${NC}"
WORKER_URL="https://roundseo-api-$ENV.YOUR_DOMAIN.workers.dev"
echo "Worker URL: $WORKER_URL"
echo ""
echo "Test with: curl https://api.yourdomain.com/health"

echo -e "${GREEN}✅ Deployment complete!${NC}\n"

echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Apply database migrations (see commands above)"
echo "2. Configure environment variables"
echo "3. Test API endpoints"
echo "4. Deploy mobile app"
echo "5. Monitor logs with: wrangler tail --env $ENV"

exit 0
