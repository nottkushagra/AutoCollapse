/**
 * AutoCollapse — Popup Script
 *
 * Settings are loaded from chrome.storage.sync on open.
 * Changes are NOT auto-saved — user must click "Save".
 * "Restore Defaults" resets the form to defaults (does NOT save until Save is clicked).
 */

document.addEventListener('DOMContentLoaded', async function() {

  // ── DOM ─────────────────────────────────────────────────────
  var versionEl       = document.getElementById('version-text');
  var groupCountEl    = document.getElementById('group-count');
  var actionStatusEl  = document.getElementById('action-status');
  var collapseBtn     = document.getElementById('btn-collapse-all');
  var expandBtn       = document.getElementById('btn-expand-all');

  var autoCollapseChk = document.getElementById('setting-auto-collapse');
  var timerChk        = document.getElementById('setting-timer-enabled');
  var timerRow        = document.getElementById('timer-row');
  var timerValueInput = document.getElementById('setting-timer-value');
  var timerUnitSelect = document.getElementById('setting-timer-unit');
  var restoreBtn      = document.getElementById('btn-restore-defaults');
  var saveBtn         = document.getElementById('btn-save');
  var settingsStatus  = document.getElementById('settings-status');

  var tabNav          = document.getElementById('tab-nav');
  var tabMain         = document.getElementById('tab-main');
  var tabAnalytics    = document.getElementById('tab-analytics');

  var statSwitchesVal  = document.getElementById('stat-switches-value');
  var statCollapsesVal = document.getElementById('stat-collapses-value');
  var statTopGroupVal  = document.getElementById('stat-top-group-value');
  var activityChart    = document.getElementById('activity-chart');
  var resetBtn         = document.getElementById('btn-reset-stats');
  var resetStatusEl    = document.getElementById('reset-status');

  // ── Defaults ────────────────────────────────────────────────
  var DEFAULTS = {
    autoCollapseEnabled: true,
    timerEnabled: false,
    timerValue: 5,
    timerUnit: 'minutes',
  };

  // ── Version ─────────────────────────────────────────────────
  var manifest = chrome.runtime.getManifest();
  if (versionEl) versionEl.textContent = 'v' + manifest.version;

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════

  async function updateGroupCount() {
    try {
      var groups = await chrome.tabGroups.query({});
      if (groups.length === 0) {
        groupCountEl.textContent = 'No tab groups';
      } else {
        groupCountEl.innerHTML =
          '<span class="content__group-count__number">' + groups.length + '</span> ' +
          'tab group' + (groups.length === 1 ? '' : 's');
      }
    } catch (err) {
      groupCountEl.textContent = 'Unable to count groups';
    }
  }

  var actionTimeout = null;
  function showActionStatus(msg, type) {
    if (actionTimeout) clearTimeout(actionTimeout);
    actionStatusEl.className = 'content__status content__status--' + (type || 'success');
    actionStatusEl.textContent = msg;
    actionTimeout = setTimeout(function() { actionStatusEl.textContent = ''; }, 2500);
  }

  var settingsTimeout = null;
  function showSettingsStatus(msg, type) {
    if (settingsTimeout) clearTimeout(settingsTimeout);
    settingsStatus.className = 'settings__status settings__status--' + (type || 'success');
    settingsStatus.textContent = msg;
    settingsTimeout = setTimeout(function() { settingsStatus.textContent = ''; }, 3000);
  }

  function showTimerRow(visible) {
    if (visible) {
      timerRow.classList.remove('settings__timer-row--hidden');
    } else {
      timerRow.classList.add('settings__timer-row--hidden');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIONS
  // ══════════════════════════════════════════════════════════════

  collapseBtn.addEventListener('click', async function() {
    collapseBtn.disabled = true;
    expandBtn.disabled = true;
    try {
      var groups = await chrome.tabGroups.query({});
      if (groups.length === 0) {
        showActionStatus('No tab groups found', 'error');
        return;
      }
      var expanded = [];
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].collapsed === false) expanded.push(groups[i]);
      }
      if (expanded.length === 0) {
        showActionStatus('All groups already collapsed', 'success');
        return;
      }
      for (var j = 0; j < expanded.length; j++) {
        await chrome.tabGroups.update(expanded[j].id, { collapsed: true });
      }
      showActionStatus('Collapsed ' + expanded.length + ' group' + (expanded.length === 1 ? '' : 's'), 'success');
    } catch (err) {
      showActionStatus('Failed: ' + err.message, 'error');
    } finally {
      collapseBtn.disabled = false;
      expandBtn.disabled = false;
      await updateGroupCount();
    }
  });

  expandBtn.addEventListener('click', async function() {
    collapseBtn.disabled = true;
    expandBtn.disabled = true;
    try {
      var groups = await chrome.tabGroups.query({});
      if (groups.length === 0) {
        showActionStatus('No tab groups found', 'error');
        return;
      }
      var collapsed = [];
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].collapsed === true) collapsed.push(groups[i]);
      }
      if (collapsed.length === 0) {
        showActionStatus('All groups already expanded', 'success');
        return;
      }
      for (var j = 0; j < collapsed.length; j++) {
        await chrome.tabGroups.update(collapsed[j].id, { collapsed: false });
      }
      showActionStatus('Expanded ' + collapsed.length + ' group' + (collapsed.length === 1 ? '' : 's'), 'success');
    } catch (err) {
      showActionStatus('Failed: ' + err.message, 'error');
    } finally {
      collapseBtn.disabled = false;
      expandBtn.disabled = false;
      await updateGroupCount();
    }
  });

  // ══════════════════════════════════════════════════════════════
  // TAB NAVIGATION
  // ══════════════════════════════════════════════════════════════

  var panels = { main: tabMain, analytics: tabAnalytics };

  tabNav.addEventListener('click', function(e) {
    var btn = e.target.closest('.tab-nav__btn');
    if (!btn || !btn.dataset.tab) return;

    var name = btn.dataset.tab;
    var buttons = tabNav.querySelectorAll('.tab-nav__btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('tab-nav__btn--active', buttons[i].dataset.tab === name);
    }
    for (var key in panels) {
      panels[key].classList.toggle('tab-content--active', key === name);
    }
    if (name === 'analytics') loadAnalytics();
  });

  // ══════════════════════════════════════════════════════════════
  // SETTINGS — Load / Apply / Save / Restore
  // ══════════════════════════════════════════════════════════════

  /**
   * Apply settings object to the form UI.
   */
  function applyToForm(s) {
    autoCollapseChk.checked = (s.autoCollapseEnabled === true);
    timerChk.checked = (s.timerEnabled === true);
    timerValueInput.value = s.timerValue || 5;
    timerUnitSelect.value = s.timerUnit || 'minutes';
    showTimerRow(s.timerEnabled === true);
  }

  /**
   * Read the form UI into a settings object.
   */
  function readFromForm() {
    var value = parseInt(timerValueInput.value, 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 999) value = 999;

    return {
      autoCollapseEnabled: autoCollapseChk.checked,
      timerEnabled: timerChk.checked,
      timerValue: value,
      timerUnit: timerUnitSelect.value,
    };
  }

  /**
   * Validate timer input. Returns error message or null if valid.
   */
  function validateForm() {
    var value = parseInt(timerValueInput.value, 10);
    if (timerChk.checked) {
      if (isNaN(value) || value < 1) {
        return 'Timer value must be at least 1';
      }
      if (value > 999) {
        return 'Timer value must be 999 or less';
      }
      // Chrome alarms minimum is 30 seconds
      if (timerUnitSelect.value === 'seconds' && value < 30) {
        return 'Minimum timer is 30 seconds (Chrome limit)';
      }
    }
    return null;
  }

  // Load settings on popup open
  async function loadSettings() {
    try {
      var settings = await chrome.storage.sync.get(DEFAULTS);
      applyToForm(settings);
      console.log('[AutoCollapse] Loaded settings:', JSON.stringify(settings));
    } catch (err) {
      console.error('[AutoCollapse] loadSettings error:', err);
      applyToForm(DEFAULTS);
    }
  }

  // Show/hide timer row when toggle changes
  timerChk.addEventListener('change', function() {
    showTimerRow(timerChk.checked);
  });

  // Save button
  saveBtn.addEventListener('click', async function() {
    var error = validateForm();
    if (error) {
      showSettingsStatus('✗ ' + error, 'error');
      return;
    }

    var settings = readFromForm();

    try {
      await chrome.storage.sync.set(settings);
      showSettingsStatus('✓ Settings saved successfully', 'success');
      console.log('[AutoCollapse] Saved:', JSON.stringify(settings));
    } catch (err) {
      console.error('[AutoCollapse] Save error:', err);
      showSettingsStatus('✗ Failed to save: ' + err.message, 'error');
    }
  });

  // Restore Defaults button
  restoreBtn.addEventListener('click', function() {
    applyToForm(DEFAULTS);
    showSettingsStatus('Defaults restored — click Save to apply', 'success');
  });

  // ══════════════════════════════════════════════════════════════
  // ANALYTICS
  // ══════════════════════════════════════════════════════════════

  async function loadAnalytics() {
    try {
      var result = await chrome.storage.local.get('stats');
      var stats = result.stats || {};

      statSwitchesVal.textContent = formatNum(stats.totalSwitches || 0);
      statCollapsesVal.textContent = formatNum(stats.totalCollapses || 0);

      var topGroup = getTopGroup(stats.groupsUsage || {});
      statTopGroupVal.textContent = topGroup || '—';

      renderChart(stats.dailySwitches || []);
    } catch (err) {
      statSwitchesVal.textContent = '0';
      statCollapsesVal.textContent = '0';
      statTopGroupVal.textContent = '—';
      renderChart([]);
    }
  }

  function formatNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function getTopGroup(usage) {
    var entries = Object.entries(usage);
    if (entries.length === 0) return null;
    entries.sort(function(a, b) { return b[1] - a[1]; });
    return entries[0][0];
  }

  function renderChart(dailySwitches) {
    activityChart.innerHTML = '';
    activityChart.classList.remove('analytics__chart--empty');

    var days = [];
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var dateStr = d.toISOString().split('T')[0];
      var entry = null;
      for (var j = 0; j < dailySwitches.length; j++) {
        if (dailySwitches[j].date === dateStr) { entry = dailySwitches[j]; break; }
      }
      days.push({ label: dayNames[d.getDay()], count: entry ? entry.count : 0 });
    }

    var maxCount = 1;
    var allZero = true;
    for (var k = 0; k < days.length; k++) {
      if (days[k].count > maxCount) maxCount = days[k].count;
      if (days[k].count > 0) allZero = false;
    }

    if (allZero) {
      activityChart.classList.add('analytics__chart--empty');
      activityChart.textContent = 'No activity yet';
      return;
    }

    for (var m = 0; m < days.length; m++) {
      var bar = document.createElement('div');
      bar.className = 'chart-bar';
      var fill = document.createElement('div');
      fill.className = 'chart-bar__fill';
      var h = days[m].count === 0 ? 2 : Math.max(4, (days[m].count / maxCount) * 80);
      fill.style.height = h + 'px';
      fill.setAttribute('data-count', days[m].count);
      var label = document.createElement('span');
      label.className = 'chart-bar__label';
      label.textContent = days[m].label;
      bar.appendChild(fill);
      bar.appendChild(label);
      activityChart.appendChild(bar);
    }
  }

  resetBtn.addEventListener('click', async function() {
    try {
      await chrome.storage.local.set({
        stats: { totalSwitches: 0, totalCollapses: 0, groupsUsage: {}, dailySwitches: [], lastResetDate: new Date().toISOString().split('T')[0] }
      });
      await loadAnalytics();
      resetStatusEl.textContent = '✓ Stats reset';
      setTimeout(function() { resetStatusEl.textContent = ''; }, 2000);
    } catch (err) {
      resetStatusEl.textContent = '✗ Reset failed';
      setTimeout(function() { resetStatusEl.textContent = ''; }, 2000);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════

  await updateGroupCount();
  await loadSettings();

  console.log('[AutoCollapse] Popup ready. v' + manifest.version);
});
