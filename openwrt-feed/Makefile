# OpenWrt package Makefile for luci-app-easyfan
# Builds both .ipk (OpenWrt 24 and earlier) and .apk (OpenWrt 25+)
#
# Usage:
#   1. Clone OpenWrt buildroot
#   2. Copy this directory to package/feeds/luci-app-easyfan/
#   3. Run: make package/luci-app-easyfan/compile V=s
#   4. Find package in bin/packages/<arch>/base/

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-easyfan
PKG_VERSION:=1.2.2
PKG_RELEASE:=1

PKG_MAINTAINER:=Your Name <you@example.com>
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-easyfan
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI Easy Fan
  DEPENDS:=+luci-base +kmod-hwmon-core +kmod-hwmon-pwmfan
  PKGARCH:=all
endef

define Package/luci-app-easyfan/description
  Three-stage PWM Easy Fan for OpenWrt with LuCI web interface.
  Idle/Normal/Mid/Full speed with temperature thresholds and hysteresis.
  Directly writes PWM to hwmon sysfs, bypassing kernel thermal governor.
endef

# No build step needed - all files are shell scripts and JavaScript
define Build/Compile
endef

define Package/luci-app-easyfan/install
	# LuCI JavaScript view
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./files/easyfan.js \
		$(1)/www/luci-static/resources/view/easyfan.js

	# LuCI CSS
	$(INSTALL_DATA) ./files/easyfan.css \
		$(1)/www/luci-static/resources/view/easyfan.css

	# LuCI menu entry
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/luci-app-easyfan.json \
		$(1)/usr/share/luci/menu.d/luci-app-easyfan.json

	# rpcd ACL
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-app-easyfan-acl.json \
		$(1)/usr/share/rpcd/acl.d/luci-app-easyfan.json

	# Easy Fan daemon
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/easyfan_loop \
		$(1)/usr/bin/easyfan_loop

	# Init script
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/easyfan.init \
		$(1)/etc/init.d/easyfan

	# UCI default config
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/easyfan \
		$(1)/etc/config/easyfan
endef

define Package/luci-app-easyfan/conffiles
/etc/config/easyfan
endef

define Package/luci-app-easyfan/postinst
#!/bin/sh
[ -f /etc/init.d/easyfan ] && /etc/init.d/easyfan enable
[ -f /etc/init.d/easyfan ] && /etc/init.d/easyfan start
exit 0
endef

define Package/luci-app-easyfan/prerm
#!/bin/sh
[ -f /etc/init.d/easyfan ] && /etc/init.d/easyfan stop
[ -f /etc/init.d/easyfan ] && /etc/init.d/easyfan disable
exit 0
endef

$(eval $(call BuildPackage,luci-app-easyfan))
