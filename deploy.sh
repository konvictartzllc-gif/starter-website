#!/bin/bash

set -e

echo "Dex AI Assistant deployment helper"
echo
echo "This script does not auto-push or auto-rewrite files anymore."
echo "It prints the current safe deployment settings for Render."
echo

echo "Render backend settings:"
echo "  Name: konvict-artz-backend"
echo "  Root Directory: server"
echo "  Build Command: npm install"
echo "  Start Command: node src/index.js"
echo

echo "After deployment, test these routes on your Render backend:"
echo "  /"
echo "  /health"
echo "  /api/health"
echo "  /api/diagnostics/providers"
echo

echo "Current source-of-truth files:"
echo "  - render.yaml"
echo "  - server/render.yaml"
echo "  - server/.env.example"
echo "  - DEPLOY_NOW.md"
echo

echo "Next step:"
echo "  Open DEPLOY_NOW.md and follow the live backend + Stripe proof flow."
