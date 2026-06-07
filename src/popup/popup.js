/**
 * AutoCollapse — Popup Script
 *
 * This file handles all the logic for the popup UI:
 * - Loading and saving settings to/from chrome.storage.sync
 * - Collapse All / Expand All button actions
 * - Tab navigation between Main and Analytics views
 * - Rendering the analytics dashboard and 7-day chart
 * - Form validation and status messages
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * - The popup is DESTROYED when closed and RECREATED when opened.
 *   All variables are lost between opens. That's why we load from
 *   chrome.storage every time.
 * - Settings are NOT auto-saved. Users must click "Save" explicitly.
 *   "Restore Defaults" only changes the form — it doesn't save until
 *   the user clicks Save.
 * - This file has access to Chrome APIs (chrome.tabGroups, chrome.storage, etc.)
 *   because it's an extension page, not a regular web page.
 *
 * ARCHITECTURE:
 * - Everything is wrapped in a DOMContentLoaded listener to ensure
 *   all HTML elements exist before we try to access them.
 * - DOM references are cached at the top for performance.
 * - Functions are organized by feature: helpers, actions, tabs, settings, analytics.
 */

document.addEventListener('DOMContentLoaded', async function() {

  // ── DOM References ──────────────────────────────────────────
  // We get references to all DOM elements ONCE at startup.
  // This is faster than calling getElementById every time we need an element.
  // If any ID is wrong, we'll get null here — easy to spot during testing.

  // Header
  var versionEl       = document.getElementById('version-text');

  // Main tab - group info and actions
  var groupCountEl    = document.getElementById('group-count');
  var actionStatusEl  = document.getElementById('action-status');
  var collapseBtn     = document.getElementById('btn-collapse-all');
  var expandBtn       = document.getElementById('btn-expand-all');

  // Settings controls
  var autoCollapseChk = document.getElementById('setting-auto-collapse');
  var timerChk        = document.getElementById('setting-timer-enabled');
  var timerRow        = document.getElementById('timer-row');
  var timerValueInput = document.getElementById('setting-timer-value');
  var timerUnitSelect = document.getElementById('setting-timer-unit');
  var restoreBtn      = document.getElementById('btn-restore-defaults');
  var saveBtn         = document.getElementById('btn-save');
  var settingsStatus  = document.getElementById('settings-status');

  // Tab navigation
  var tabNav          = document.getElementById('tab-nav');
  var tabMain         = document.getElementById('tab-main');
  var tabAnalytics    = document.getElementById('tab-analytics');

  // Analytics tab elements
  var statSwitchesVal  = document.getElementById('stat-switches-value');
  var statCollapsesVal = document.getElementById('stat-collapses-value');
  var statTopGroupVal  = document.getElementById('stat-top-group-value');
  var activityChart    = document.getElementById('activity-chart');
  var resetBtn         = document.getElementById('btn-reset-stats');
  var resetStatusEl    = document.getElementById('reset-status');

  // ── Defaults ────────────────────────────────────────────────
  // Same defaults as the service worker. Duplicated here because the popup
  // and service worker are separate JavaScript contexts — they don't share
  // variables. They share data through chrome.storage instead.
  var DEFAULTS = {
    autoCollapseEnabled: true,
    timerEnabled: false,
    timerValue: 5,
    timerUnit: 'minutes',
  };

  // ── Version Display ─────────────────────────────────────────
  // Read the version from manifest.json so we only maintain it in one place.
  // chrome.runtime.getManifest() returns the parsed manifest.json object.
  var manifest = chrome.runtime.getManifest();
  if (versionEl) versionEl.textContent = 'v' + manifest.version;

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════

  /**
   * Count all tab groups across all windows and display the count.
   *
   * Called on popup open and after collapse/expand actions.
   * Shows "No tab groups" if there are none, or "3 tab groups" with
   * the number highlighted in the accent color.
   *
   * Uses innerHTML (not textContent) because the number gets a styled <span>.
   */
  async function updateGroupCount() {
    try {
      var groups = await chrome.tabGroups.query({});
      if (groups.length === 0) {
        groupCountEl.textContent = 'No tab groups';
      } else {
        // Pluralization: "1 tab group" vs "3 tab groups"
        groupCountEl.innerHTML =
          '<span class="content__group-count__number">' + groups.length + '</span> ' +
          'tab group' + (groups.length === 1 ? '' : 's');
      }
    } catch (err) {
      groupCountEl.textContent = 'Unable to count groups';
    }
  }

  /**
   * Show a temporary status message for action buttons.
   *
   * The message auto-clears after 2.5 seconds.
   * If a new message is shown before the old one clears,
   * the old timer is cancelled to prevent premature clearing.
   *
   * @param {string} msg - The message to display
   * @param {string} type - 'success' or 'error' (controls color via CSS class)
   */
  var actionTimeout = null;
  function showActionStatus(msg, type) {
    if (actionTimeout) clearTimeout(actionTimeout);
    actionStatusEl.className = 'content__status content__status--' + (type || 'success');
    actionStatusEl.textContent = msg;
    actionTimeout = setTimeout(function() { actionStatusEl.textContent = ''; }, 2500);
  }

  /**
   * Show a temporary status message for settings operations.
   * Same pattern as showActionStatus but for the settings section.
   *
   * @param {string} msg - The message to display
   * @param {string} type - 'success' or 'error'
   */
  var settingsTimeout = null;
  function showSettingsStatus(msg, type) {
    if (settingsTimeout) clearTimeout(settingsTimeout);
    settingsStatus.className = 'settings__status settings__status--' + (type || 'success');
    settingsStatus.textContent = msg;
    settingsTimeout = setTimeout(function() { settingsStatus.textContent = ''; }, 3000);
  }

  /**
   * Show or hide the timer configuration row.
   *
   * Uses a CSS modifier class (--hidden) that sets max-height: 0 and opacity: 0,
   * creating a smooth collapse/expand animation via CSS transitions.
   *
   * @param {boolean} visible - Whether to show the timer row
   */
  function showTimerRow(visible) {
    if (visible) {
      timerRow.classList.remove('settings__timer-row--hidden');
    } else {
      timerRow.classList.add('settings__timer-row--hidden');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIONS — Collapse All / Expand All buttons
  // ══════════════════════════════════════════════════════════════

  /**
   * Collapse All button handler.
   *
   * Flow:
   * 1. Disable both buttons (prevent double-clicks)
   * 2. Query all tab groups
   * 3. Filter for expanded groups only
   * 4. Collapse each one sequentially
   * 5. Show status message
   * 6. Re-enable buttons (in finally block — always runs, even on error)
   * 7. Update the group count display
   *
   * Unlike the service worker's safeGroupUpdate, we don't retry here.
   * The popup is interactive — if it fails, the user can see and click again.
   */
  collapseBtn.addEventListener('click', async function() {
    // Disable buttons to prevent conflicting operations
    collapseBtn.disabled = true;
    expandBtn.disabled = true;
    try {
      var groups = await chrome.tabGroups.query({});
      if (groups.length === 0) {
        showActionStatus('No tab groups found', 'error');
        return;
      }

      // Filter: only collapse groups that are currently expanded
      var expanded = [];
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].collapsed === false) expanded.push(groups[i]);
      }

      if (expanded.length === 0) {
        showActionStatus('All groups already collapsed', 'success');
        return;
      }

      // Collapse each group sequentially
      for (var j = 0; j < expanded.length; j++) {
        await chrome.tabGroups.update(expanded[j].id, { collapsed: true });
      }

      showActionStatus('Collapsed ' + expanded.length + ' group' + (expanded.length === 1 ? '' : 's'), 'success');
    } catch (err) {
      showActionStatus('Failed: ' + err.message, 'error');
    } finally {
      // Always re-enable buttons, even if an error occurred.
      // Without 'finally', an error would leave buttons permanently disabled.
      collapseBtn.disabled = false;
      expandBtn.disabled = false;
      await updateGroupCount();
    }
  });

  /**
   * Expand All button handler.
   * Mirror of the collapse handler — same pattern, opposite operation.
   */
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
  //
  // Uses event delegation: one click handler on the parent <nav>,
  // instead of a separate handler on each button. This is more
  // efficient and automatically handles future buttons added to the nav.
  //
  // How it works:
  // 1. Click happens anywhere in the nav
  // 2. e.target.closest('.tab-nav__btn') finds the clicked button
  // 3. Read data-tab attribute to know which panel to show
  // 4. Toggle --active class on all buttons and panels
  // 5. Lazy-load analytics when switching to that tab
  // ══════════════════════════════════════════════════════════════

  var panels = { main: tabMain, analytics: tabAnalytics };

  tabNav.addEventListener('click', function(e) {
    // Find the button that was clicked (even if user clicked text inside the button)
    var btn = e.target.closest('.tab-nav__btn');
    if (!btn || !btn.dataset.tab) return; // Clicked outside a button — ignore

    var name = btn.dataset.tab; // "main" or "analytics"

    // Update button active states
    var buttons = tabNav.querySelectorAll('.tab-nav__btn');
    for (var i = 0; i < buttons.length; i++) {
      // classList.toggle(class, condition) — adds class if true, removes if false
      buttons[i].classList.toggle('tab-nav__btn--active', buttons[i].dataset.tab === name);
    }

    // Show/hide content panels
    for (var key in panels) {
      panels[key].classList.toggle('tab-content--active', key === name);
    }

    // Lazy-load analytics only when the user switches to that tab.
    // This avoids an unnecessary chrome.storage.local.get() on every popup open.
    if (name === 'analytics') loadAnalytics();
  });

  // ══════════════════════════════════════════════════════════════
  // SETTINGS — Load / Apply / Save / Restore
  //
  // Settings flow:
  // 1. Popup opens → loadSettings() reads from chrome.storage.sync
  // 2. User changes toggles/inputs
  // 3. User clicks Save → validateForm() → readFromForm() → storage.sync.set()
  // 4. Service worker's onChanged listener picks up the new values
  //
  // "Restore Defaults" only changes the form UI. It does NOT save.
  // The user must click Save to persist the defaults.
  // ══════════════════════════════════════════════════════════════

  /**
   * Apply a settings object to the form UI elements.
   * Used when loading settings from storage or restoring defaults.
   *
   * @param {Object} s - Settings object with autoCollapseEnabled, timerEnabled, etc.
   */
  function applyToForm(s) {
    autoCollapseChk.checked = (s.autoCollapseEnabled === true);
    timerChk.checked = (s.timerEnabled === true);
    timerValueInput.value = s.timerValue || 5;
    timerUnitSelect.value = s.timerUnit || 'minutes';
    showTimerRow(s.timerEnabled === true);
  }

  /**
   * Read the current form values into a settings object.
   * This is the inverse of applyToForm — form → object instead of object → form.
   *
   * Includes input sanitization: clamps timerValue to [1, 999].
   *
   * @returns {Object} Settings object ready to save to storage
   */
  function readFromForm() {
    var value = parseInt(timerValueInput.value, 10);
    // Sanitize: NaN or out-of-range values get clamped
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
   * Validate the timer settings before saving.
   *
   * Returns an error message string if invalid, or null if valid.
   * This pattern makes the caller simple:
   *   var error = validateForm();
   *   if (error) { showError(error); return; }
   *
   * Validation rules:
   * - Timer value must be 1-999
   * - If unit is seconds, minimum is 10 (hybrid timer system supports sub-30s)
   * - Only validates when timer is enabled (disabled timer = values don't matter)
   *
   * @returns {string|null} Error message or null if valid
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
      // Minimum 10 seconds. For timers under 30s, the service worker uses
      // setTimeout (worker stays awake ~30s after tab activity). For timers
      // >= 30s, it uses chrome.alarms (survives worker sleep).
      if (timerUnitSelect.value === 'seconds' && value < 10) {
        return 'Minimum timer is 10 seconds';
      }
    }
    return null; // Valid!
  }

  /**
   * Load settings from chrome.storage.sync and apply them to the form.
   * Called once when the popup opens.
   *
   * If storage fails (very rare), we apply defaults instead of showing
   * an empty/broken form.
   */
  async function loadSettings() {
    try {
      var settings = await chrome.storage.sync.get(DEFAULTS);
      applyToForm(settings);
      console.log('[AutoCollapse] Loaded settings:', JSON.stringify(settings));
    } catch (err) {
      console.error('[AutoCollapse] loadSettings error:', err);
      applyToForm(DEFAULTS); // Fallback to defaults
    }
  }

  // Show/hide timer configuration row when the timer toggle changes.
  // This provides immediate visual feedback — the row slides in/out
  // using CSS transitions (max-height + opacity animation).
  timerChk.addEventListener('change', function() {
    showTimerRow(timerChk.checked);
  });

  /**
   * Save button click handler.
   *
   * Flow:
   * 1. Validate form (check timer values)
   * 2. Read form values into object
   * 3. Save to chrome.storage.sync
   * 4. Show success/error message
   *
   * When we save to sync, the service worker's chrome.storage.onChanged
   * listener fires automatically — no need to send a message.
   */
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

  /**
   * Restore Defaults button click handler.
   *
   * IMPORTANT: This only changes the form UI — it does NOT save to storage.
   * The user must click Save to actually apply the defaults.
   * This two-step process prevents accidental settings changes.
   */
  restoreBtn.addEventListener('click', function() {
    applyToForm(DEFAULTS);
    showSettingsStatus('Defaults restored — click Save to apply', 'success');
  });

  // ══════════════════════════════════════════════════════════════
  // ANALYTICS
  //
  // Analytics data is stored in chrome.storage.local (device-specific).
  // It's loaded lazily — only when the user switches to the Analytics tab.
  //
  // Three displays:
  // 1. Stat cards: totalSwitches, totalCollapses, most used group
  // 2. 7-day bar chart: daily switch activity
  // 3. Reset button: clears all analytics data
  // ══════════════════════════════════════════════════════════════

  /**
   * Load analytics data from storage and render the dashboard.
   * Called when the user switches to the Analytics tab.
   */
  async function loadAnalytics() {
    try {
      var result = await chrome.storage.local.get('stats');
      var stats = result.stats || {};

      // Update stat card values
      statSwitchesVal.textContent = formatNum(stats.totalSwitches || 0);
      statCollapsesVal.textContent = formatNum(stats.totalCollapses || 0);

      // Find the most-used group
      var topGroup = getTopGroup(stats.groupsUsage || {});
      statTopGroupVal.textContent = topGroup || '—'; // Em dash if no data

      // Render the 7-day chart
      renderChart(stats.dailySwitches || []);
    } catch (err) {
      // If analytics fail to load, show zeros instead of crashing
      statSwitchesVal.textContent = '0';
      statCollapsesVal.textContent = '0';
      statTopGroupVal.textContent = '—';
      renderChart([]);
    }
  }

  /**
   * Format a number for display. Large numbers get abbreviated.
   *
   * Examples:
   *   formatNum(42)    → "42"
   *   formatNum(1500)  → "1.5k"
   *   formatNum(0)     → "0"
   *
   * @param {number} n - The number to format
   * @returns {string} Formatted string
   */
  function formatNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  /**
   * Find the most-used group from the usage map.
   *
   * @param {Object} usage - Map of { groupName: usageCount }
   * @returns {string|null} Name of the most-used group, or null if no data
   */
  function getTopGroup(usage) {
    var entries = Object.entries(usage);
    if (entries.length === 0) return null;
    // Sort descending by count, take the first entry's name
    entries.sort(function(a, b) { return b[1] - a[1]; });
    return entries[0][0];
  }

  /**
   * Render the 7-day activity bar chart.
   *
   * This builds the chart using DOM elements (no library needed for 7 bars).
   * Each bar's height is proportional to the day's count relative to the max count.
   *
   * DESIGN CHOICES:
   * - Built with DOM manipulation, not a library (keeps extension lightweight)
   * - Bars scale relative to the max value (tallest bar = 80px)
   * - Zero-count days show a 2px line (visible but clearly "no data")
   * - Hover tooltips use CSS ::after with attr(data-count) — no JS needed
   * - Empty state shows "No activity yet" instead of flat bars
   *
   * @param {Array} dailySwitches - Array of { date: "2026-06-07", count: 12 }
   */
  function renderChart(dailySwitches) {
    // Clear previous chart content
    activityChart.innerHTML = '';
    activityChart.classList.remove('analytics__chart--empty');

    // Generate the last 7 calendar days (oldest to newest, left to right)
    var days = [];
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (var i = 6; i >= 0; i--) {
      // Create a date object for (today - i) days
      var d = new Date();
      d.setDate(d.getDate() - i);

      // Convert to "2026-06-07" format for matching against stored data
      var dateStr = d.toISOString().split('T')[0];

      // Find matching entry in dailySwitches
      var entry = null;
      for (var j = 0; j < dailySwitches.length; j++) {
        if (dailySwitches[j].date === dateStr) { entry = dailySwitches[j]; break; }
      }

      // Build day data: label (e.g., "Mon") and count (0 if no data)
      days.push({ label: dayNames[d.getDay()], count: entry ? entry.count : 0 });
    }

    // Find the maximum count for scaling bar heights.
    // Start at 1 (not 0) to avoid division-by-zero.
    var maxCount = 1;
    var allZero = true;
    for (var k = 0; k < days.length; k++) {
      if (days[k].count > maxCount) maxCount = days[k].count;
      if (days[k].count > 0) allZero = false;
    }

    // Empty state: show a message instead of flat bars
    if (allZero) {
      activityChart.classList.add('analytics__chart--empty');
      activityChart.textContent = 'No activity yet';
      return;
    }

    // Build DOM elements for each bar
    for (var m = 0; m < days.length; m++) {
      // Container for the bar + label
      var bar = document.createElement('div');
      bar.className = 'chart-bar';

      // The colored fill (height represents the count)
      var fill = document.createElement('div');
      fill.className = 'chart-bar__fill';

      // Height calculation:
      // - Zero count → 2px (a thin line showing "this day existed")
      // - Non-zero → proportional to max, minimum 4px (visible even for small values)
      // - Max count → 80px
      var h = days[m].count === 0 ? 2 : Math.max(4, (days[m].count / maxCount) * 80);
      fill.style.height = h + 'px';

      // Store the count as a data attribute for CSS hover tooltip.
      // CSS uses content: attr(data-count) to display this on hover.
      fill.setAttribute('data-count', days[m].count);

      // Day label (e.g., "Mon", "Tue")
      var label = document.createElement('span');
      label.className = 'chart-bar__label';
      label.textContent = days[m].label;

      // Assemble: fill + label → bar → chart
      bar.appendChild(fill);
      bar.appendChild(label);
      activityChart.appendChild(bar);
    }
  }

  /**
   * Reset All Stats button handler.
   * Clears analytics data and refreshes the display.
   */
  resetBtn.addEventListener('click', async function() {
    try {
      await chrome.storage.local.set({
        stats: { totalSwitches: 0, totalCollapses: 0, groupsUsage: {}, dailySwitches: [], lastResetDate: new Date().toISOString().split('T')[0] }
      });
      await loadAnalytics(); // Refresh the display
      resetStatusEl.textContent = '✓ Stats reset';
      setTimeout(function() { resetStatusEl.textContent = ''; }, 2000);
    } catch (err) {
      resetStatusEl.textContent = '✗ Reset failed';
      setTimeout(function() { resetStatusEl.textContent = ''; }, 2000);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // INITIALIZATION
  //
  // These run once when the popup first opens:
  // 1. Count and display tab groups
  // 2. Load settings from storage into the form
  //
  // Analytics are NOT loaded here — they load lazily when the user
  // clicks the Analytics tab (see tab navigation handler above).
  // ══════════════════════════════════════════════════════════════

  await updateGroupCount();
  await loadSettings();

  console.log('[AutoCollapse] Popup ready. v' + manifest.version);
});
