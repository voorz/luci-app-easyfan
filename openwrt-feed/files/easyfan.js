'use strict';
'require dom';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require view';

const PKG_NAME = 'luci-app-easyfan';
const GITHUB_REPO = 'voorz/luci-app-easyfan';

// Fetch installed version and install date via opkg
function getInstalledInfo() {
	return fs.exec('/bin/opkg', ['status', PKG_NAME]).then(function(res) {
		const out = res.stdout || '';
		const version = (out.match(/^Version: (.+)$/m) || [])[1] || '-';
		return { version: version.trim() };
	});
}

// Fetch latest release info from GitHub API (browser-side fetch)
function getLatestRelease() {
	return fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', {
		headers: { 'Accept': 'application/vnd.github+json' }
	}).then(function(res) { return res.json(); }).then(function(data) {
		return {
			tag: data.tag_name || '',
			date: data.published_at ? data.published_at.split('T')[0] : '',
			assetName: (data.assets || []).map(function(a) { return a.name; })
				.filter(function(n) { return n.match(/^luci-app-easyfan_.*_all\.ipk$/); })[0] || '',
			assetUrl: (data.assets || []).map(function(a) { return a.browser_download_url; })
				.filter(function(u) { return u.match(/luci-app-easyfan_.*_all\.ipk$/); })[0] || ''
		};
	});
}

// Compare version strings like '1.0.1-1' vs '1.0.2-1'
function isNewer(remote, local) {
	const r = remote.split(/[.-]/).map(Number);
	const l = local.split(/[.-]/).map(Number);
	for (let i = 0; i < Math.max(r.length, l.length); i++) {
		if ((r[i] || 0) > (l[i] || 0)) return true;
		if ((r[i] || 0) < (l[i] || 0)) return false;
	}
	return false;
}

// Download and install ipk, then restart service
var isUpgrading = false;
function doUpgrade(assetUrl, btn, statusEl) {
	if (isUpgrading) return;
	isUpgrading = true;
	btn.disabled = true;
	statusEl.textContent = _('下载中...');
	return fs.exec('/usr/bin/curl', ['-fsSL', '-o', '/tmp/easyfan_upgrade.ipk', assetUrl])
		.then(function() {
			statusEl.textContent = _('安装中...');
			return fs.exec('/bin/opkg', ['install', '--force-reinstall', '/tmp/easyfan_upgrade.ipk']);
		})
		.then(function() {
			return fs.exec('/etc/init.d/easyfan', ['restart']);
		})
		.then(function() {
			statusEl.textContent = _('升级成功，正在刷新...');
			setTimeout(function() { window.location.reload(); }, 2000);
		})
		.catch(function(err) {
			isUpgrading = false;
			btn.disabled = false;
			statusEl.textContent = _('升级失败: %s').format(err.message || err);
			setTimeout(function() { statusEl.textContent = ''; }, 5000);
		});
}

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

const HISTORY_WINDOW_MS = 2 * 60 * 1000;
const TIME_GRID_INTERVAL_MS = 10 * 1000;
const TIME_LABEL_INTERVAL_MS = 30 * 1000;
const VALUE_GRID_DIVISIONS = 4;

function serviceRunning(result) {
	const instances = result?.easyfan?.instances || {};

	return Object.keys(instances).some(function(name) {
		return instances[name].running === true;
	});
}

function parseStatus(text) {
	const status = {};

	String(text || '').split(/\n/).forEach(function(line) {
		const separator = line.indexOf('=');

		if (separator > 0)
			status[line.substring(0, separator)] = line.substring(separator + 1);
	});

	return status;
}

function validStatusNumber(value) {
	if (!value && value !== 0)
		return null;
	const number = Number(value);

	return Number.isFinite(number) && number > 0 ? number : null;
}

function appendHistory(history, running, status) {
	const now = Date.now();
	const temperature = validStatusNumber(status.temperature_mc);
	const pwm = validStatusNumber(status.pwm);
	const rpm = validStatusNumber(status.rpm);

	history.push({
		time: now,
		temperature: running && temperature != null ? temperature / 1000 : null,
		speed: running && pwm != null ? Math.round(pwm * 100 / 255) : null,
		rpm: running ? rpm : null
	});

	while (history.length && history[0].time < now - HISTORY_WINDOW_MS)
		history.shift();
}

function chartScale(history, key, minimumMax, step) {
	let maximum = minimumMax;

	history.forEach(function(sample) {
		if (sample[key] != null)
			maximum = Math.max(maximum, sample[key]);
	});

	return Math.ceil(maximum / step) * step;
}

function drawChart(canvas, history, key, options) {
	const style = window.getComputedStyle(canvas);
	const width = Math.max(canvas.clientWidth, 1);
	const height = Math.max(canvas.clientHeight, 1);
	const ratio = Math.min(window.devicePixelRatio || 1, 2);
	const context = canvas.getContext('2d');
	const padding = { left: 28, right: 5, top: 6, bottom: 14 };
	const plotWidth = Math.max(width - padding.left - padding.right, 1);
	const plotHeight = Math.max(height - padding.top - padding.bottom, 1);
	const plotBottom = padding.top + plotHeight;
	const now = history.length ? history[history.length - 1].time : Date.now();
	const start = now - HISTORY_WINDOW_MS;
	const maximum = chartScale(history, key, options.minimumMax, options.step);
	const lineColor = style.getPropertyValue('--easyfan-chart-line').trim() || '#1976d2';
	const fillColor = style.getPropertyValue('--easyfan-chart-fill').trim() || 'rgba(25, 118, 210, .2)';
	const labelColor = style.color || '#666';
	const gridColor = 'rgba(127, 127, 127, .2)';
	let segment = [];

	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, width, height);

	context.strokeStyle = gridColor;
	context.lineWidth = 1;
	context.beginPath();
	for (let elapsed = 0; elapsed <= HISTORY_WINDOW_MS; elapsed += TIME_GRID_INTERVAL_MS) {
		const x = padding.left + plotWidth * elapsed / HISTORY_WINDOW_MS;
		context.moveTo(x, padding.top);
		context.lineTo(x, plotBottom);
	}
	for (let division = 0; division <= VALUE_GRID_DIVISIONS; division++) {
		const y = padding.top + plotHeight * division / VALUE_GRID_DIVISIONS;
		context.moveTo(padding.left, y);
		context.lineTo(padding.left + plotWidth, y);
	}
	context.stroke();

	context.fillStyle = labelColor;
	context.font = '9px sans-serif';
	context.textAlign = 'right';
	context.textBaseline = 'top';
	context.fillText(options.format(maximum), padding.left - 4, padding.top - 1);
	context.textBaseline = 'bottom';
	context.fillText(options.format(0), padding.left - 4, plotBottom + 1);
	context.textBaseline = 'middle';
	context.fillText(options.format(maximum / 2), padding.left - 4,
		padding.top + plotHeight / 2);

	context.textBaseline = 'bottom';
	for (let elapsed = 0; elapsed <= HISTORY_WINDOW_MS; elapsed += TIME_LABEL_INTERVAL_MS) {
		const x = padding.left + plotWidth * elapsed / HISTORY_WINDOW_MS;
		const remaining = (HISTORY_WINDOW_MS - elapsed) / 1000;
		context.textAlign = elapsed === 0 ? 'left' :
			elapsed === HISTORY_WINDOW_MS ? 'right' : 'center';
		context.fillText(remaining ? '-%ds'.format(remaining) : '0', x, height);
	}

	function point(sample) {
		return {
			x: padding.left + (sample.time - start) / HISTORY_WINDOW_MS * plotWidth,
			y: plotBottom - sample[key] / maximum * plotHeight
		};
	}

	function drawSegment() {
		if (!segment.length)
			return;

		if (segment.length > 1) {
			context.beginPath();
			context.moveTo(segment[0].x, plotBottom);
			segment.forEach(function(item) { context.lineTo(item.x, item.y); });
			context.lineTo(segment[segment.length - 1].x, plotBottom);
			context.closePath();
			context.fillStyle = fillColor;
			context.fill();

			context.beginPath();
			segment.forEach(function(item, index) {
				if (index)
					context.lineTo(item.x, item.y);
				else
					context.moveTo(item.x, item.y);
			});
			context.strokeStyle = lineColor;
			context.lineWidth = 1.5;
			context.lineJoin = 'round';
			context.stroke();
		} else {
			context.beginPath();
			context.arc(segment[0].x, segment[0].y, 2, 0, Math.PI * 2);
			context.fillStyle = lineColor;
			context.fill();
		}

		segment = [];
	}

	history.forEach(function(sample) {
		if (sample[key] == null) {
			drawSegment();
			return;
		}
		segment.push(point(sample));
	});
	drawSegment();
}

function statusMetric(title, value, unit, chartClass) {
	const canvas = E('canvas', {
		'class': 'easyfan-chart easyfan-chart-%s'.format(chartClass),
		'role': 'img',
		'aria-label': title
	});
	const children = [
		E('span', { 'class': 'easyfan-metric-label' }, title),
		E('div', { 'class': 'easyfan-metric-reading' }, [
			E('span', { 'class': 'easyfan-metric-value' }, value),
			unit ? E('span', { 'class': 'easyfan-metric-unit' }, unit) : ''
		]),
		E('div', { 'class': 'easyfan-chart-wrap' }, canvas)
	];

	return {
		node: E('div', { 'class': 'easyfan-metric' }, children),
		canvas: canvas
	};
}

function statusDetail(title, value) {
	return E('div', { 'class': 'easyfan-detail' }, [
		E('span', { 'class': 'easyfan-detail-label' }, title),
		E('span', { 'class': 'easyfan-detail-value' }, value)
	]);
}

function renderStatus(node, running, status, history) {
	const temp = status.temperature_mc;
	const pwm = status.pwm;
	const rpm = status.rpm;
	const tempValid = Number.isFinite(Number(temp)) && Number(temp) > 0;
	const pwmValid = Number.isFinite(Number(pwm)) && Number(pwm) >= 0;
	const rpmValid = Number.isFinite(Number(rpm)) && Number(rpm) > 0;
	const speedPct = pwmValid ? Math.round(pwm * 100 / 255) : null;
	const fault = status.error
		? E('span', { 'class': 'label warning' }, status.error)
		: !rpmValid
			? E('span', { 'class': 'label warning' }, _('DTS不支持'))
			: E('span', { 'class': 'easyfan-ok' }, _('正常'));
	const temperatureMetric = statusMetric(_('温度'),
		tempValid ? '%.1f'.format(temp / 1000) : '-', tempValid ? '°C' : '', 'temperature');
	const speedMetric = statusMetric(_('转速'), speedPct != null ? '%d%%'.format(speedPct) : '-',
		speedPct != null ? '' : '', 'pwm');
	const rpmMetric = statusMetric(_('风扇转速'), rpmValid ? String(rpm) : '0',
		rpmValid ? 'RPM' : 'RPM', 'rpm');

	dom.content(node, E('div', { 'class': 'easyfan-status' }, [
		E('div', { 'class': 'easyfan-status-head' }, [
			E('span', { 'class': 'easyfan-status-title' }, _('运行状态')),
			E('span', { 'class': running ? 'label success' : 'label warning' },
				running ? _('运行中') : _('已停止'))
		]),
		E('div', { 'class': 'easyfan-metrics' }, [
			temperatureMetric.node,
			speedMetric.node,
			rpmMetric.node
		]),
		E('div', { 'class': 'easyfan-details' }, [
			statusDetail(_('温度传感器'), status.thermal_file || '-'),
			statusDetail(_('PWM设备'), status.fan_file || '-'),
			statusDetail(_('状态'), fault)
		])
	]));

	drawChart(temperatureMetric.canvas, history, 'temperature', {
		minimumMax: 100,
		step: 10,
		format: function(value) { return '%d°'.format(value); }
	});
	drawChart(speedMetric.canvas, history, 'speed', {
		minimumMax: 100,
		step: 100,
		format: function(value) { return '%d%%'.format(value); }
	});
	drawChart(rpmMetric.canvas, history, 'rpm', {
		minimumMax: 1000,
		step: 500,
		format: function(value) { return String(value); }
	});

	// Redraw charts on container resize to prevent CSS stretching
	const wrap = node.querySelector('.easyfan-metrics');
	if (wrap && !wrap._easyfanResizeObserver) {
		const charts = [temperatureMetric, speedMetric, rpmMetric];
		wrap._easyfanResizeObserver = new ResizeObserver(function() {
			drawChart(charts[0].canvas, history, 'temperature', {
				minimumMax: 100, step: 10,
				format: function(v) { return '%d°'.format(v); }
			});
			drawChart(charts[1].canvas, history, 'speed', {
				minimumMax: 100, step: 100,
				format: function(v) { return '%d%%'.format(v); }
			});
			drawChart(charts[2].canvas, history, 'rpm', {
				minimumMax: 1000, step: 500,
				format: function(v) { return String(v); }
			});
		});
		wrap._easyfanResizeObserver.observe(wrap);
	}
}

function validateAutoPath(sectionId, value) {
	if (value === 'auto' || value?.startsWith('/'))
		return true;

	return _('请输入"auto"或绝对sysfs路径。');
}

// --- Custom CBI control: temperature + speed slider on one row ---
// Renders a temperature number input and a speed range slider side by side.
// Manages two UCI keys: one for temperature, one for speed.
const TempSpeedPair = form.Value.extend({
	__name__: 'easyfan.TempSpeedPair',

	renderWidget(section_id, option_index, cfgvalue) {
		const tempKey = this.temp_key;
		const speedKey = this.speed_key;
		const tempVal = uci.get('easyfan', section_id, tempKey) || this.temp_default;
		const speedVal = uci.get('easyfan', section_id, speedKey) || this.speed_default;
		const cbid = this.cbid(section_id);

		const display = E('span', { 'class': 'easyfan-pair-speed-display' }, speedVal + '%');

		const widget = E('div', { 'class': 'easyfan-pair-row' }, [
			E('div', { 'class': 'easyfan-pair-temp' }, [
				E('input', {
					'type': 'number',
					'class': 'easyfan-pair-temp-input',
					'value': tempVal,
					'min': String(this.temp_min ?? -40),
					'max': String(this.temp_max ?? 200),
					'data-temp-key': tempKey,
					'id': '%s.temp'.format(cbid)
				}),
				E('span', { 'class': 'easyfan-pair-temp-unit' }, '°C')
			]),
			E('div', { 'class': 'easyfan-pair-slider' }, [
				E('input', {
					'type': 'range',
					'class': 'easyfan-speed-range',
					'value': speedVal,
					'min': '1',
					'max': '100',
					'step': '1',
					'data-speed-key': speedKey,
					'id': '%s.speed'.format(cbid),
					'input': function(ev) {
						display.textContent = ev.target.value + '%';
					}
				}),
				display
			])
		]);

		return widget;
	},

	// This option itself maps to the speed key for UCI read/write
	cfgvalue(section_id) {
		return uci.get('easyfan', section_id, this.speed_key) || this.speed_default;
	},

	// Read actual values from DOM instead of relying on CBI widget
	formvalue(section_id) {
		const cbid = this.cbid(section_id);
		const speedEl = document.getElementById('%s.speed'.format(cbid));
		return speedEl ? speedEl.value : this.speed_default;
	},

	// Override parse to always call write (bypass rmempty/optional null check)
	parse(section_id) {
		if (!this.isActive(section_id))
			return Promise.resolve();
		return Promise.resolve(this.write(section_id, this.formvalue(section_id)));
	},

	write(section_id, formvalue) {
		// Read temp and speed from the rendered DOM
		const cbid = this.cbid(section_id);
		const tempEl = document.getElementById('%s.temp'.format(cbid));
		const speedEl = document.getElementById('%s.speed'.format(cbid));

		if (tempEl)
			uci.set('easyfan', section_id, this.temp_key, tempEl.value);
		if (speedEl)
			uci.set('easyfan', section_id, this.speed_key, speedEl.value);
	},

	// Skip default CBI write since we handle it in our custom write
	remove(section_id) {
		// Still write on remove to preserve values
		this.write(section_id, null);
	}
});

// --- Custom CBI control: idle speed slider (no temperature input) ---
// Renders a speed range slider with percentage display, inside the same
// .easyfan-pair-row container as TempSpeedPair for visual consistency.
const IdleSpeedSlider = form.Value.extend({
	__name__: 'easyfan.IdleSpeedSlider',

	renderWidget(section_id, option_index, cfgvalue) {
		const speedVal = uci.get('easyfan', section_id, this.option) || this.default || '10';
		const tempNormal = uci.get('easyfan', section_id, 'temp_normal') || '30';
		const cbid = this.cbid(section_id);

		const display = E('span', { 'class': 'easyfan-pair-speed-display' }, speedVal + '%');

		const widget = E('div', { 'class': 'easyfan-pair-row' }, [
			E('div', { 'class': 'easyfan-pair-temp easyfan-pair-temp-placeholder' }, [
				E('span', { 'class': 'easyfan-pair-temp-text' }, '< %d°C'.format(tempNormal))
			]),
			E('div', { 'class': 'easyfan-pair-slider' }, [
				E('input', {
					'type': 'range',
					'class': 'easyfan-speed-range',
					'value': speedVal,
					'min': String(this.min ?? 1),
					'max': String(this.max ?? 100),
					'step': String(this.step ?? 1),
					'id': '%s.speed'.format(cbid),
					'input': function(ev) {
						display.textContent = ev.target.value + '%';
					}
				}),
				display
			])
		]);

		return widget;
	},

	cfgvalue(section_id) {
		return uci.get('easyfan', section_id, this.option) || this.default || '10';
	},

	formvalue(section_id) {
		const cbid = this.cbid(section_id);
		const speedEl = document.getElementById('%s.speed'.format(cbid));
		return speedEl ? speedEl.value : (this.default || '10');
	},

	parse(section_id) {
		if (!this.isActive(section_id))
			return Promise.resolve();
		return Promise.resolve(this.write(section_id, this.formvalue(section_id)));
	},

	remove(section_id) {
		this.write(section_id, this.default || '10');
	}
});


return view.extend({
	load() {
		return Promise.all([
			uci.load('easyfan'),
			getInstalledInfo()
		]).then(function(results) {
			return results[1];
		});
	},

	render(installed) {
		let m, s, o;

		// --- Version + check-update header ---
		const statusEl = E('span', { 'class': 'easyfan-status-text' });
		let upgradeUrl = null;

		const versionBar = E('div', { 'class': 'easyfan-version-bar' }, [
			E('span', { 'class': 'easyfan-version-label' }, _('版本')),
			E('span', { 'class': 'easyfan-version-value' }, installed ? installed.version : '-'),
			statusEl,
			E('button', {
				'class': 'cbi-button easyfan-check-update-btn',
				'click': function() {
					const btn = this;
					if (isUpgrading) return;

					// If we already found an update, clicking means upgrade
					if (upgradeUrl) {
						doUpgrade(upgradeUrl, btn, statusEl);
						return;
					}

					// Otherwise, check for updates
					btn.disabled = true;
					statusEl.textContent = _('检查中...');
					getLatestRelease().then(function(release) {
						const localVer = installed ? installed.version : '0';
						const remoteVer = release.tag.replace(/^v/, '');
						if (release.assetUrl && isNewer(remoteVer, localVer)) {
							upgradeUrl = release.assetUrl;
							btn.textContent = _('点击更新');
							btn.disabled = false;
							statusEl.textContent = _('发现新版本 %s (%s)').format(remoteVer, release.date);
						} else {
							btn.disabled = false;
							statusEl.textContent = _('已是最新');
							setTimeout(function() {
								if (!isUpgrading && !upgradeUrl)
									statusEl.textContent = '';
							}, 3000);
						}
					}).catch(function() {
						btn.disabled = false;
						statusEl.textContent = _('检查失败');
						setTimeout(function() {
							if (!isUpgrading && !upgradeUrl)
								statusEl.textContent = '';
						}, 3000);
					});
				}
			}, _('检查更新'))
		]);

		m = new form.Map('easyfan', _('风扇控制'),
			_('基于温度的三段式风扇转速控制。低于标准温度时以微速静音运行，达到全速温度后以100%转速运行。'));

		// --- Status section (chart) ---
		s = m.section(form.TypedSection, 'easyfan', _('运行状态'));
		s.anonymous = true;
		s.addremove = false;
		s.render = function() {
			const history = [];
			const node = E('div', { 'class': 'cbi-section easyfan-runtime' }, [
				E('link', {
					'rel': 'stylesheet',
					'href': L.resource('view/easyfan.css')
				}),
				E('div', { 'class': 'cbi-section-node' }, _('正在收集数据...'))
			]);
			const statusNode = node.lastElementChild;

			poll.add(function() {
				return Promise.all([
					L.resolveDefault(callServiceList('easyfan'), {}),
					L.resolveDefault(fs.read_direct('/var/run/easyfan.status'), '')
				]).then(function(result) {
					const running = serviceRunning(result[0]);
					const status = parseStatus(result[1]);
					appendHistory(history, running, status);
					renderStatus(statusNode, running, status, history);
				});
			}, 5);

			return node;
		};

		// --- Settings section (CBI with tabs) ---
		s = m.section(form.NamedSection, 'settings', 'easyfan', _('设置'));
		s.addremove = false;
		s.tab('curve', _('温度与转速'));
		s.tab('hardware', _('硬件'));
		s.tab('safety', _('安全'));

		// --- Tab: 温度与转速 ---
		o = s.taboption('curve', form.Flag, 'enabled', _('启用'));
		o.default = o.disabled;
		o.rmempty = false;
		o.description = _('启用后，风扇将根据温度自动调节转速。');

		// Idle speed - custom slider (no temperature threshold, same container as TempSpeedPair)
	o = s.taboption('curve', IdleSpeedSlider, 'speed_idle', _('默认转速'));
	o.min = 1;
	o.max = 100;
	o.step = 1;
	o.default = '10';
	o.rmempty = false;
	o.description = _('风扇始终处于工作状态的默认转速。');

		// Normal: temperature + speed on one row
		o = s.taboption('curve', TempSpeedPair, 'speed_normal', _('标准'));
		o.temp_key = 'temp_normal';
		o.speed_key = 'speed_normal';
		o.temp_default = '30';
		o.speed_default = '30';
		o.temp_min = -40;
		o.temp_max = 200;
	o.rmempty = false;
	o.description = _('达到标准温度时升至标准转速。');

		// Mid: temperature + speed on one row
		o = s.taboption('curve', TempSpeedPair, 'speed_mid', _('中速'));
		o.temp_key = 'temp_mid';
		o.speed_key = 'speed_mid';
		o.temp_default = '35';
		o.speed_default = '50';
		o.temp_min = -39;
		o.temp_max = 250;
	o.rmempty = false;
	o.description = _('达到中速温度时升至中速。');

		// Full: temperature + speed on one row
		o = s.taboption('curve', TempSpeedPair, 'speed_full', _('全速'));
		o.temp_key = 'temp_full';
		o.speed_key = 'speed_full';
		o.temp_default = '40';
		o.speed_default = '100';
		o.temp_min = -38;
		o.temp_max = 260;
	o.rmempty = false;
	o.description = _('达到全速温度时以100%全速运行。');

		o = s.taboption('curve', form.Value, 'hysteresis', _('降温延迟'));
		o.default = '2';
		o.datatype = 'range(0,50)';
		o.rmempty = false;
		o.description = _('温度需低于升温阈值多少度才降速，避免频繁切换。单位：°C。');

		o = s.taboption('curve', form.Value, 'interval', _('轮询间隔'));
		o.default = '5';
		o.datatype = 'range(1,300)';
		o.rmempty = false;
		o.description = _('多久读取一次温度并更新转速。单位：秒。');

		// --- Tab: 硬件 ---
		o = s.taboption('hardware', form.Value, 'thermal_file', _('温度传感器'));
		o.default = 'auto';
		o.rmempty = false;
		o.validate = validateAutoPath;
		o.description = _('使用"auto"自动选择CPU或SoC温度传感器，或手动输入sysfs路径。');

		o = s.taboption('hardware', form.Value, 'fan_file', _('PWM输出'));
		o.default = 'auto';
		o.rmempty = false;
		o.validate = validateAutoPath;
		o.description = _('使用"auto"自动选择可写入的hwmon pwmN输出，或手动输入路径。');

		o = s.taboption('hardware', form.Value, 'enable_file', _('PWM模式控制'));
		o.default = 'auto';
		o.rmempty = false;
		o.validate = validateAutoPath;
		o.description = _('可选的 pwmN_enable 路径，用于切换为手动PWM模式。"auto"时自动匹配。');

		o = s.taboption('hardware', form.Value, 'temp_div', _('温度除数'));
		o.default = '1000';
		o.value('1');
		o.value('1000');
		o.datatype = 'range(1,1000000)';
		o.rmempty = false;
		o.description = _('将原始传感器数值除以此值后用于计算。标准Linux温度输入用1000；直接报整数的传感器用1。');

		// --- Tab: 安全 ---
		o = s.taboption('safety', form.Value, 'fail_safe_speed', _('传感器故障转速'));
		o.default = '100';
		o.datatype = 'range(0,100)';
		o.rmempty = false;
		o.description = _('温度传感器读取失败时的转速百分比。保持100%最安全。');

		o = s.taboption('safety', form.Value, 'exit_speed', _('服务退出转速'));
		o.default = '100';
		o.datatype = 'range(0,100)';
		o.rmempty = false;
		o.description = _('服务停止时的转速百分比。保持100%以防止失去散热。');

		o = s.taboption('safety', form.Flag, 'debug', _('调试日志'));
		o.default = o.disabled;
		o.rmempty = false;
		o.description = _('每次轮询时将温度、转速和RPM写入系统日志。');

		return Promise.all([ m.render(), Promise.resolve(versionBar) ]).then(function(nodes) {
			const wrapper = E('div', {}, [ nodes[1], nodes[0] ]);
			return wrapper;
		});
	}
});
