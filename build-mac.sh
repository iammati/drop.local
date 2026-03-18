#!/bin/bash

# Drop Local - macOS Build Script
# Builds production DMG installer for Apple Silicon Macs

set -e  # Exit on error

echo "🚀 Building Drop Local for macOS ARM64..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Build frontend
echo -e "${BLUE}[1/4]${NC} Building frontend with Vite..."
bun run build

# Step 2: Build Electrobun app
echo -e "${BLUE}[2/4]${NC} Building Electrobun app bundle..."
bunx electrobun build --env=stable --target=mac

# Step 3: Create DMG installer
echo -e "${BLUE}[3/4]${NC} Creating DMG installer..."
rm -f drop-local-mac-arm64.dmg
hdiutil create \
  -volname "Drop Local" \
  -srcfolder build/stable-macos-arm64/drop-local.app \
  -ov \
  -format UDZO \
  drop-local-mac-arm64.dmg

# Step 4: Show results
echo -e "${BLUE}[4/4]${NC} Build complete!"
echo ""
echo -e "${GREEN}✅ DMG installer created:${NC}"
ls -lh drop-local-mac-arm64.dmg
echo ""
echo "📦 Location: $(pwd)/drop-local-mac-arm64.dmg"
echo ""
echo "🎉 Ready to share! Your friends can:"
echo "   1. Download the DMG"
echo "   2. Double-click to mount"
echo "   3. Drag app to Applications"
echo "   4. Right-click → Open (first time only)"
echo ""
