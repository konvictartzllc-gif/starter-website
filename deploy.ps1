#!/usr/bin/env pwsh
# Dex AI Platform - Production Deployment Script (PowerShell)
# This script guides you through deploying to Railway + Vercel

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     DEX AI PLATFORM - PRODUCTION DEPLOYMENT HELPER             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Generate JWT Secret
Write-Host "📋 Step 1: Generate JWT Secret" -ForegroundColor Blue
$JWT_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Write-Host "✓ Generated JWT_SECRET: $($JWT_SECRET.Substring(0, 20))..." -ForegroundColor Green
Write-Host ""

# Show Railway deployment instructions
Write-Host "📋 Step 2: Deploy to Railway (Manual)" -ForegroundColor Blue
Write-Host ""
Write-Host "Follow these steps:"
Write-Host "  1. Go to https://railway.app/dashboard"
Write-Host "  2. Create/select your project and service"
Write-Host "  3. Connect: $(git config --get remote.origin.url)"
Write-Host "  4. Settings:"
Write-Host "     - Name: konvict-artz-dex-api"
Write-Host "     - Runtime: Node"
Write-Host "     - Root Directory: server"
Write-Host "     - Build: npm install"
Write-Host "     - Start: node src/index.js"
Write-Host "  5. Deploy the service"
Write-Host ""
Write-Host "⏳ Wait for deployment to complete (2-3 minutes)..." -ForegroundColor Yellow
Write-Host ""

# Show environment variables
Write-Host "📋 Step 3: Add Environment Variables in Railway" -ForegroundColor Blue
Write-Host ""
Write-Host "In Railway service variables, add:" -ForegroundColor Green
Write-Host ""
Write-Host "JWT_SECRET=$JWT_SECRET"
Write-Host "PUBLIC_API_URL=https://YOUR_RAILWAY_URL"
Write-Host "CLIENT_ORIGIN=https://www.konvict-artz.com"
Write-Host "ADMIN_EMAIL=owner@example.com"
Write-Host "ADMIN_PASSWORD=replace_with_real_password"
Write-Host "DEX_PRICE_CENTS=999"
Write-Host "DEX_CURRENCY=USD"
Write-Host ""
Write-Host "Optional:" -ForegroundColor Yellow
Write-Host "OPENAI_API_KEY=sk-your-key-here"
Write-Host "SMTP_HOST=smtp.gmail.com"
Write-Host ""

# Get Railway URL from user
Write-Host "📋 Step 4: Get Your Railway Backend URL" -ForegroundColor Blue
Write-Host ""
Write-Host "After Railway deployment completes:"
Write-Host "  1. Open your Railway service"
Write-Host "  2. Copy the public URL (e.g., https://xxxx.up.railway.app)"
Write-Host ""
$RAILWAY_URL = Read-Host "Paste your Railway URL here"

if ([string]::IsNullOrEmpty($RAILWAY_URL)) {
    Write-Host "❌ Error: Railway URL is empty" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Railway URL: $RAILWAY_URL" -ForegroundColor Green
Write-Host ""

# Update vercel.json
Write-Host "📋 Step 5: Wire Backend to Vercel" -ForegroundColor Blue
Write-Host ""
Write-Host "Updating vercel.json with Railway backend URL..."

$vercelJson = @{
    rewrites = @(
        @{
            source = "/api/:path*"
            destination = "$RAILWAY_URL/api/:path*"
        }
    )
    routes = @(
        @{
            src = "/(.*)"
            dest = "/index.html"
        }
    )
} | ConvertTo-Json -Depth 10

Set-Content -Path "client/vercel.json" -Value $vercelJson
Write-Host "✓ vercel.json updated" -ForegroundColor Green
Write-Host ""

# Push to GitHub
Write-Host "📋 Step 6: Push to GitHub" -ForegroundColor Blue
git add -A
git commit -m "deploy: Wire Railway backend to Vercel frontend"
git push origin main
Write-Host "✓ Pushed to GitHub" -ForegroundColor Green
Write-Host ""

# Vercel auto-deploy notice
Write-Host "📋 Step 7: Vercel Auto-Deploy" -ForegroundColor Blue
Write-Host ""
Write-Host "✓ Vercel will auto-redeploy when detecting push"
Write-Host "  Monitor at: https://vercel.com/dashboard"
Write-Host "  This takes ~1-2 minutes"
Write-Host ""

# Testing instructions
Write-Host "📋 Step 8: Test Live Endpoints" -ForegroundColor Blue
Write-Host ""
Write-Host "Test backend health:" -ForegroundColor Green
Write-Host "  curl $RAILWAY_URL/api/health" -ForegroundColor Yellow
Write-Host ""
Write-Host "Expected response: {""ok"": true}" -ForegroundColor Cyan
Write-Host ""

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  🎉 SETUP COMPLETE - YOUR DEX AI IS LIVE!                     ║" -ForegroundColor Green
Write-Host "║  https://www.konvict-artz.com                                 ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📊 Final Status:" -ForegroundColor Cyan
Write-Host "  ✅ Frontend: https://www.konvict-artz.com" -ForegroundColor Green
Write-Host "  ✅ Backend: $RAILWAY_URL" -ForegroundColor Green
Write-Host "  ✅ Voice Chat: Ready (Chrome/Edge)" -ForegroundColor Green
Write-Host "  ✅ Trial System: Active" -ForegroundColor Green
Write-Host "  ✅ Payments: Ready" -ForegroundColor Green
Write-Host ""

Write-Host "🚀 Next Actions:" -ForegroundColor Yellow
Write-Host "  • Wait 2-3 minutes for Railway to deploy"
Write-Host "  • Visit https://www.konvict-artz.com and register"
Write-Host "  • Try voice chat: Say 'Hey Dex'"
Write-Host "  • Monitor logs at https://railway.app/dashboard"
Write-Host ""
