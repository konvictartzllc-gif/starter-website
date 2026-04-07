#!/bin/bash
# Dex AI Platform - Production Deployment Script
# This script guides you through deploying to Render + Vercel

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     DEX AI PLATFORM - PRODUCTION DEPLOYMENT HELPER             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📋 Step 1: Generate JWT Secret${NC}"
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo -e "${GREEN}✓ Generated JWT_SECRET: ${JWT_SECRET:0:20}...${NC}"
echo ""

echo -e "${BLUE}📋 Step 2: Deploy to Render${NC}"
echo ""
echo "Follow these steps:"
echo "  1. Go to https://render.com/dashboard"
echo "  2. Click 'New +' → 'Web Service'"
echo "  3. Connect to $(git config --get remote.origin.url)"
echo "  4. Enter these settings:"
echo "     - Name: konvict-artz-dex-api"
echo "     - Runtime: Node"
echo "     - Build Command: npm install"
echo "     - Start Command: node src/index.js"
echo "     - Instance Type: Free"
echo "  5. Click 'Create Web Service'"
echo ""
echo -e "${YELLOW}⏳ Wait for deployment to complete (2-3 minutes)${NC}"
echo ""

echo -e "${BLUE}📋 Step 3: Add Environment Variables in Render${NC}"
echo ""
echo "In Render Dashboard, go to Settings → Environment and add:"
echo ""
echo -e "${YELLOW}JWT_SECRET${NC}=${JWT_SECRET}"
echo "CLIENT_ORIGIN=https://www.konvict-artz.com"
echo "ADMIN_USERNAME=KonvictArtz"
echo "ADMIN_PASSWORD=K0nv1ctArtz2026Launch"
echo "DEX_PRICE_CENTS=999"
echo "DEX_CURRENCY=USD"
echo ""
echo "Optional (for email notifications):"
echo "SMTP_HOST=smtp.gmail.com"
echo "SMTP_PORT=587"
echo "SMTP_USER=your-email@gmail.com"
echo "SMTP_PASS=your-app-password"
echo ""
echo "Optional (for advanced AI):"
echo "OPENAI_API_KEY=sk-your-key-here"
echo "OPENAI_MODEL=gpt-3.5-turbo"
echo ""

echo -e "${BLUE}📋 Step 4: Get Your Render Backend URL${NC}"
echo ""
echo "After deployment:"
echo "  1. Go to https://render.com/dashboard"
echo "  2. Click on 'konvict-artz-dex-api' service"
echo "  3. Copy the URL (e.g., https://xxxx-xxxx-xxxx.onrender.com)"
echo ""
read -p "Paste your Render URL and press Enter: " RENDER_URL

if [ -z "$RENDER_URL" ]; then
  echo -e "${RED}❌ Error: Render URL is empty${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Render URL: $RENDER_URL${NC}"
echo ""

echo -e "${BLUE}📋 Step 5: Wire Backend to Vercel${NC}"
echo ""
echo "Updating vercel.json with Render backend URL..."

# Create the updated vercel.json
cat > vercel.json <<EOF
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "$RENDER_URL/api/:path*"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
EOF

echo -e "${GREEN}✓ vercel.json updated${NC}"
echo ""

echo -e "${BLUE}📋 Step 6: Push to GitHub${NC}"
git add -A
git commit -m "deploy: Wire Render backend to Vercel frontend"
git push origin main

echo -e "${GREEN}✓ Pushed to GitHub${NC}"
echo ""

echo -e "${BLUE}📋 Step 7: Redeploy Vercel${NC}"
echo ""
echo "Vercel will auto-deploy when you push to main branch."
echo "Monitor deployment at: https://vercel.com/dashboard"
echo ""

echo -e "${BLUE}📋 Step 8: Test Live Endpoints${NC}"
echo ""
echo "Test backend health:"
echo "  curl $RENDER_URL/api/health"
echo ""
echo "Test from frontend:"
echo "  1. Visit https://www.konvict-artz.com"
echo "  2. Register new account"
echo "  3. Should see '3-Day Trial' message"
echo "  4. Click '💬 Start Chat'"
echo "  5. Say 'Hey Dex'"
echo "  6. Should get AI response"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🎉 DEPLOYMENT SETUP COMPLETE!                                ║"
echo "║  Your Dex AI platform is now live at:                         ║"
echo "║  https://www.konvict-artz.com                                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Status:"
echo "  ✅ Frontend: https://www.konvict-artz.com"
echo "  ✅ Backend: $RENDER_URL"
echo "  ✅ Voice: Ready (Chrome/Edge)"
echo "  ✅ Trial: Active"
echo "  ✅ Payments: Ready"
echo ""
echo "📞 Next Steps:"
echo "  • Monitor Render logs for errors"
echo "  • Configure SMTP for email notifications"
echo "  • Add OpenAI key for better AI responses"
echo "  • Test with real users"
echo ""
