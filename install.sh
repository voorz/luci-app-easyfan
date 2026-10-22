#!/bin/sh
# luci-app-easyfan one-line installer for OpenWrt/ImmortalWrt.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/voorz/luci-app-easyfan/main/install.sh | sh
#
# Environment:
#   VERSION  Specific version to install (e.g. "1.0.1-1"), default: latest
#   REPO     GitHub repo (default: voorz/luci-app-easyfan)
set -eu

REPO="${REPO:-voorz/luci-app-easyfan}"
VERSION="${VERSION:-latest}"

log() { printf '[easyfan-install] %s\n' "$*"; }
err() { printf '[easyfan-install] ERROR: %s\n' "$*" >&2; }

# Must run on OpenWrt.
if [ ! -f /etc/openwrt_release ]; then
  err "This script is for OpenWrt/ImmortalWrt only."
  exit 1
fi

# Must be root.
if [ "$(id -u)" -ne 0 ]; then
  err "Please run as root."
  exit 1
fi

# Download tool.
if command -v curl >/dev/null 2>&1; then
  DL="curl -fsSL -o"
  FETCH="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  DL="wget -O"
  FETCH="wget -qO-"
else
  err "Need curl or wget."
  exit 1
fi

# Resolve release tag and asset name.
if [ "$VERSION" = "latest" ]; then
  log "Resolving latest release..."
  API="https://api.github.com/repos/$REPO/releases/latest"
  JSON=$($FETCH "$API")
  TAG=$(echo "$JSON" | grep '"tag_name"' | cut -d'"' -f4)
  ASSET=$(echo "$JSON" | grep '"name"' | cut -d'"' -f4 | grep '^luci-app-easyfan_.*_all\.ipk$' | sort -V | tail -1)
else
  # VERSION like "1.0.1-1" -> tag v1.0.0, asset luci-app-easyfan_1.0.0-1_all.ipk
  TAG="v$(echo "$VERSION" | sed 's/-[0-9]*$//')"
  ASSET="luci-app-easyfan_${VERSION}_all.ipk"
fi

if [ -z "${TAG:-}" ] || [ -z "${ASSET:-}" ]; then
  err "Could not find a release package for version $VERSION."
  exit 1
fi

BASE="https://github.com/$REPO/releases/download/$TAG"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

log "Downloading $ASSET ($TAG)..."
$DL "$TMPDIR/$ASSET" "$BASE/$ASSET"

log "Installing..."
opkg install "$TMPDIR/$ASSET"

log "Verifying..."
if /etc/init.d/easyfan enabled; then
  log "Service enabled."
else
  /etc/init.d/easyfan enable
fi
/etc/init.d/easyfan restart

# Make the LuCI menu entry show up without a reboot.
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null || true
/etc/init.d/rpcd restart 2>/dev/null || true

if pgrep -f "easyfan_loop" >/dev/null 2>&1; then
  log "easyfan is running. Done. Open LuCI -> Services -> Easy Fan."
else
  err "Daemon did not start. Check: logread | grep -i fan"
  exit 1
fi
