# luci-app-easyfan

A lightweight PWM fan control LuCI app for OpenWrt.

## Features

- Three-stage fan speed based on CPU/SoC temperature thresholds
- Configurable idle, normal, mid, and full speed percentages
- Temperature hysteresis to prevent frequent switching
- Polling-interval-based switch confirmation
- Auto-detection of thermal sensors and PWM outputs via hwmon sysfs
- Real-time status charts (temperature, speed, RPM) in the web UI

## Install

One-line install on the router (fetches the latest release package and
installs it):

```sh
curl -fsSL https://raw.githubusercontent.com/voorz/luci-app-easyfan/main/install.sh | sh
```

To install a specific version:

```sh
VERSION=4.0.0-1 sh -c "$(curl -fsSL https://raw.githubusercontent.com/voorz/luci-app-easyfan/main/install.sh)"
```

Or install a release package manually:

```sh
opkg install luci-app-easyfan_*_all.ipk
```

Then navigate to **Services → Easy Fan** in the LuCI web interface.
