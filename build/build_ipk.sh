#!/bin/sh
# build_ipk.sh - 本地构建 luci-app-easyfan.ipk
# 源文件从 openwrt-feed/files/ 读取，输出到 dev/
# 用法: wsl -e bash /mnt/c/.../dev/build_ipk.sh
# 规范: gnu tar, 成员顺序 debian-binary → data.tar.gz → control.tar.gz, gzip -n, root:root, 644/755

set -e

PKG_NAME=luci-app-easyfan
PKG_VERSION=1.0.2
PKG_RELEASE=1

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$DEV_DIR/.." && pwd)"
SRC_DIR="$ROOT_DIR/openwrt-feed/files"
BUILD=/tmp/ipk_build

echo "Dev:   $DEV_DIR"
echo "Root:  $ROOT_DIR"
echo "Src:   $SRC_DIR"
echo "Build: $BUILD"

rm -rf "$BUILD"
mkdir -p "$BUILD/data" "$BUILD/control"

# ===================== control =====================
cat > "$BUILD/control/control" << CTRL
Package: ${PKG_NAME}
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: libc, luci-base, kmod-hwmon-core, kmod-hwmon-pwmfan
Provides: ${PKG_NAME}-any
Section: luci
Architecture: all
Description:  Three-stage PWM fan control for OpenWrt. Idle/Normal/Mid/Full speed with temperature thresholds.
CTRL

cat > "$BUILD/control/conffiles" << 'CONF'
/etc/config/easyfan
CONF

cat > "$BUILD/control/postinst" << 'POST'
#!/bin/sh
[ -x /etc/init.d/easyfan ] && /etc/init.d/easyfan enable
[ -x /etc/init.d/easyfan ] && /etc/init.d/easyfan start 2>/dev/null
exit 0
POST
chmod +x "$BUILD/control/postinst"

cat > "$BUILD/control/prerm" << 'PRE'
#!/bin/sh
[ -x /etc/init.d/easyfan ] && /etc/init.d/easyfan stop 2>/dev/null
exit 0
PRE
chmod +x "$BUILD/control/prerm"

cat > "$BUILD/control/postrm" << 'POSTRM'
#!/bin/sh
rm -f /etc/config/easyfan
rm -f /etc/config/easyfan-opkg
exit 0
POSTRM
chmod +x "$BUILD/control/postrm"

# ===================== data =====================

# --- etc/config/easyfan (UCI) ---
mkdir -p "$BUILD/data/etc/config"
cp "$SRC_DIR/easyfan" "$BUILD/data/etc/config/easyfan"

# --- etc/init.d/easyfan ---
mkdir -p "$BUILD/data/etc/init.d"
cp "$SRC_DIR/easyfan.init" "$BUILD/data/etc/init.d/easyfan"

# --- usr/bin/easyfan_loop ---
mkdir -p "$BUILD/data/usr/bin"
cp "$SRC_DIR/easyfan_loop" "$BUILD/data/usr/bin/easyfan_loop"

# --- www/luci-static/resources/view/easyfan.js ---
mkdir -p "$BUILD/data/www/luci-static/resources/view"
cp "$SRC_DIR/easyfan.js" "$BUILD/data/www/luci-static/resources/view/easyfan.js"

# --- www/luci-static/resources/view/easyfan.css ---
cp "$SRC_DIR/easyfan.css" "$BUILD/data/www/luci-static/resources/view/easyfan.css"

# --- usr/share/luci/menu.d/luci-app-easyfan.json ---
mkdir -p "$BUILD/data/usr/share/luci/menu.d"
cp "$SRC_DIR/luci-app-easyfan.json" "$BUILD/data/usr/share/luci/menu.d/luci-app-easyfan.json"

# --- usr/share/rpcd/acl.d/luci-app-easyfan.json ---
mkdir -p "$BUILD/data/usr/share/rpcd/acl.d"
cp "$SRC_DIR/luci-app-easyfan-acl.json" "$BUILD/data/usr/share/rpcd/acl.d/luci-app-easyfan.json"

# --- lib/upgrade/keep.d/luci-app-easyfan ---
mkdir -p "$BUILD/data/lib/upgrade/keep.d"
cat > "$BUILD/data/lib/upgrade/keep.d/luci-app-easyfan" << 'KEEP'
/etc/config/
KEEP

# ===================== 打包 =====================
echo "2.0" > "$BUILD/debian-binary"

# 转换 CRLF → LF（源文件可能在 Windows 上保存为 CRLF）
find "$BUILD/data" -type f -exec sed -i 's/\r$//' {} \;
find "$BUILD/control" -type f -exec sed -i 's/\r$//' {} \;

# 设置权限
find "$BUILD/data" -type d -exec chmod 755 {} \;
find "$BUILD/data" -type f -exec chmod 644 {} \;
chmod 755 "$BUILD/data/etc/init.d/easyfan"
chmod 755 "$BUILD/data/usr/bin/easyfan_loop"

find "$BUILD/control" -type d -exec chmod 755 {} \;
find "$BUILD/control" -type f -exec chmod 644 {} \;
chmod 755 "$BUILD/control/postinst" "$BUILD/control/prerm" "$BUILD/control/postrm"

# 内层 data.tar.gz
cd "$BUILD/data"
tar --format=gnu --numeric-owner --owner=0 --group=0 --sort=name -cf - ./* | gzip -n > "$BUILD/data.tar.gz"

# Installed-Size = data.tar 解开后的字节数（与官方 ipkg-build 口径一致）
INSTALLED_SIZE=$(zcat "$BUILD/data.tar.gz" | wc -c | tr -d ' ')
echo "Installed-Size: $INSTALLED_SIZE" >> "$BUILD/control/control"

# 内层 control.tar.gz
cd "$BUILD/control"
tar --format=gnu --numeric-owner --owner=0 --group=0 --sort=name -cf - ./* | gzip -n > "$BUILD/control.tar.gz"

# 外层 ipk
cd "$BUILD"
OUTPUT="$DEV_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"
tar --format=gnu --numeric-owner --owner=0 --group=0 --sort=name -cf - ./debian-binary ./data.tar.gz ./control.tar.gz | gzip -n > "$OUTPUT"

echo "========================================="
echo "Built: $OUTPUT"
ls -la "$OUTPUT"
echo "========================================="
