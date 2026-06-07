/**
 * AutoCollapse — Service Worker
 *
 * BEHAVIOR RULES:
 * 1. Active Group: Keep active group expanded, collapse all others
 * 2. Group Switch: Old group collapses, new group expands
 * 3. Ungrouped Tab: Collapse ALL groups (zero expanded)
 * 4. Single Group: Allow it to stay expanded while active
 * 5. Browser Startup: Detect active tab, apply rules immediately
 * 6. Window Switch: Active window determines active group
 *
 * TIMER:
 * - Configurable in seconds or minutes
 * - On expiry: collapse ALL groups
 * - Any tab/group activity resets the timer
 * - Uses chrome.alarms (min 0.5 minutes = 30 seconds)
 */

// ── Defaults ──────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  autoCollapseEnabled: true,
  timerEnabled: false,
  timerValue: 5,
  timerUnit: 'minutes', // 'seconds' | 'minutes'
};

const DEFAULT_STATS = {
  totalSwitches: 0,
  totalCollapses: 0,
  groupsUsage: {},
  dailySwitches: [],
  lastResetDate: null,
};

const ALARM_TIMER = 'autocollapse-timer';

// Debounce: only the last rapid tab switch gets processed
let pendingTimer = null;

// ── Helpers ───────────────────────────────────────────────────

async function getSettings() {
  try {
    return await chrome.storage.sync.get(DEFAULT_SETTINGS);
  } catch (err) {
    console.error('[AutoCollapse] getSettings error:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Convert timer value + unit to minutes for chrome.alarms.
 * Chrome enforces minimum 0.5 minutes (30 seconds).
 */
function timerToMinutes(value, unit) {
  var minutes;
  if (unit === 'seconds') {
    minutes = value / 60;
  } else {
    minutes = value;
  }
  // Chrome minimum is 0.5 minutes
  return Math.max(0.5, minutes);
}

/**
 * Update a single tab group with retry on "cannot be edited" errors.
 */
async function safeGroupUpdate(groupId, props) {
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      await chrome.tabGroups.update(groupId, props);
      return true;
    } catch (err) {
      var msg = err.message || String(err);

      if (msg.includes('cannot be edited') && attempt < 3) {
        await delay(200 * attempt);
        continue;
      }

      if (msg.includes('No group') || msg.includes('No tab group')) {
        return false; // group deleted, skip silently
      }

      console.error('[AutoCollapse] Group', groupId, 'update failed:', msg);
      return false;
    }
  }
  return false;
}

/**
 * Collapse ALL expanded groups in a window (or all windows).
 */
async function collapseAllGroups(windowId) {
  var query = windowId ? { windowId: windowId } : {};
  var groups = await chrome.tabGroups.query(query);
  var collapsed = 0;

  for (var i = 0; i < groups.length; i++) {
    if (groups[i].collapsed === false) {
      var ok = await safeGroupUpdate(groups[i].id, { collapsed: true });
      if (ok) collapsed++;
    }
  }

  return collapsed;
}

/**
 * Track analytics.
 */
async function trackEvent(groupTitle, collapsedCount) {
  try {
    var result = await chrome.storage.local.get({ stats: { ...DEFAULT_STATS } });
    var stats = result.stats;

    stats.totalSwitches = (stats.totalSwitches || 0) + 1;
    stats.totalCollapses = (stats.totalCollapses || 0) + collapsedCount;

    if (groupTitle) {
      if (!stats.groupsUsage) stats.groupsUsage = {};
      stats.groupsUsage[groupTitle] = (stats.groupsUsage[groupTitle] || 0) + 1;
      var entries = Object.entries(stats.groupsUsage);
      if (entries.length > 20) {
        entries.sort(function(a, b) { return b[1] - a[1]; });
        stats.groupsUsage = Object.fromEntries(entries.slice(0, 20));
      }
    }

    if (!stats.dailySwitches) stats.dailySwitches = [];
    var today = new Date().toISOString().split('T')[0];
    var todayEntry = null;
    for (var i = 0; i < stats.dailySwitches.length; i++) {
      if (stats.dailySwitches[i].date === today) {
        todayEntry = stats.dailySwitches[i];
        break;
      }
    }
    if (todayEntry) {
      todayEntry.count += 1;
    } else {
      stats.dailySwitches.push({ date: today, count: 1 });
    }
    if (stats.dailySwitches.length > 7) {
      stats.dailySwitches = stats.dailySwitches.slice(-7);
    }

    await chrome.storage.local.set({ stats: stats });
  } catch (err) {
    console.error('[AutoCollapse] Analytics error:', err);
  }
}

// ── Core Logic ────────────────────────────────────────────────

/**
 * Main auto-collapse handler.
 *
 * RULE 1 (Active Group): Expand active group, collapse others.
 * RULE 2 (Group Switch): Old collapses, new expands.
 * RULE 3 (Ungrouped Tab): Collapse ALL groups. Zero remain expanded.
 * RULE 4 (Single Group): Keep it expanded if active.
 */
async function handleTabSwitch(tabId) {
  try {
    var settings = await getSettings();

    if (settings.autoCollapseEnabled !== true) {
      return;
    }

    // Get the tab
    var tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      return; // tab gone
    }

    var windowId = tab.windowId;

    // ── RULE 3: Ungrouped tab → collapse ALL groups ──
    if (tab.groupId === undefined || tab.groupId === null || tab.groupId === -1) {
      console.log('[AutoCollapse] Ungrouped tab', tabId, '→ collapsing all groups');
      var count = await collapseAllGroups(windowId);
      await trackEvent(null, count);
      await resetTimer(settings);
      return;
    }

    // ── RULES 1, 2, 4: Tab is in a group ──
    var activeGroupId = tab.groupId;

    var groups = await chrome.tabGroups.query({ windowId: windowId });
    if (groups.length === 0) return;

    // Find the active group object
    var activeGroup = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === activeGroupId) {
        activeGroup = groups[i];
        break;
      }
    }

    var activeTitle = activeGroup ? (activeGroup.title || 'Untitled') : null;

    console.log('[AutoCollapse] Tab', tabId, '→ group "' + (activeTitle || activeGroupId) + '" | Total groups:', groups.length);

    // RULE 4: Single group — just make sure it's expanded
    if (groups.length === 1) {
      if (activeGroup && activeGroup.collapsed === true) {
        await safeGroupUpdate(activeGroupId, { collapsed: false });
      }
      await trackEvent(activeTitle, 0);
      await resetTimer(settings);
      return;
    }

    // RULES 1 & 2: Multiple groups
    // Step 1: Expand active group
    if (activeGroup && activeGroup.collapsed === true) {
      await safeGroupUpdate(activeGroupId, { collapsed: false });
    }

    // Step 2: Collapse every other group (sequential to avoid Chrome errors)
    var collapsedCount = 0;
    for (var j = 0; j < groups.length; j++) {
      if (groups[j].id !== activeGroupId && groups[j].collapsed === false) {
        var ok = await safeGroupUpdate(groups[j].id, { collapsed: true });
        if (ok) collapsedCount++;
      }
    }

    if (collapsedCount > 0) {
      console.log('[AutoCollapse] Collapsed', collapsedCount, 'group(s)');
    }

    await trackEvent(activeTitle, collapsedCount);
    await resetTimer(settings);

  } catch (err) {
    console.error('[AutoCollapse] handleTabSwitch error:', err);
  }
}

// ── Timer ─────────────────────────────────────────────────────

/**
 * Reset the inactivity timer.
 * Called after every tab switch to restart the countdown.
 */
async function resetTimer(settings) {
  try {
    await chrome.alarms.clear(ALARM_TIMER);

    if (settings.timerEnabled === true && settings.autoCollapseEnabled === true) {
      var minutes = timerToMinutes(settings.timerValue || 5, settings.timerUnit || 'minutes');
      await chrome.alarms.create(ALARM_TIMER, { delayInMinutes: minutes });
      console.log('[AutoCollapse] Timer set:', settings.timerValue, settings.timerUnit, '(' + minutes.toFixed(2) + ' min)');
    }
  } catch (err) {
    console.error('[AutoCollapse] resetTimer error:', err);
  }
}

/**
 * Timer expired — collapse ALL groups in ALL windows.
 */
async function handleTimerExpired() {
  try {
    var settings = await getSettings();
    if (settings.autoCollapseEnabled !== true) return;

    var groups = await chrome.tabGroups.query({});
    var expanded = 0;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].collapsed === false) expanded++;
    }

    if (expanded === 0) return;

    for (var j = 0; j < groups.length; j++) {
      if (groups[j].collapsed === false) {
        await safeGroupUpdate(groups[j].id, { collapsed: true });
      }
    }

    console.log('[AutoCollapse] Timer expired: collapsed', expanded, 'group(s)');
  } catch (err) {
    console.error('[AutoCollapse] handleTimerExpired error:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// EVENT LISTENERS — all synchronous, top-level
// ══════════════════════════════════════════════════════════════

// ── Install / Update ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async function(details) {
  console.log('[AutoCollapse] onInstalled:', details.reason);

  if (details.reason === 'install') {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ stats: { ...DEFAULT_STATS } });
    console.log('[AutoCollapse] Defaults saved.');
  } else if (details.reason === 'update') {
    var existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    var merged = { ...DEFAULT_SETTINGS, ...existing };
    await chrome.storage.sync.set(merged);
    console.log('[AutoCollapse] Settings merged:', JSON.stringify(merged));
  }
});

// ── Browser Startup (RULE 5) ─────────────────────────────────
// Fires when Chrome starts, NOT on extension install/reload.
// Detects the active tab and applies collapse rules.
chrome.runtime.onStartup.addListener(async function() {
  console.log('[AutoCollapse] Browser startup detected.');

  try {
    // Small delay to let Chrome finish initializing tabs
    await delay(500);

    var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs.length > 0) {
      console.log('[AutoCollapse] Startup: processing active tab', tabs[0].id);
      await handleTabSwitch(tabs[0].id);
    }
  } catch (err) {
    console.error('[AutoCollapse] Startup error:', err);
  }
});

// ── Tab Activated (DEBOUNCED) ─────────────────────────────────
chrome.tabs.onActivated.addListener(function(activeInfo) {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
  }
  pendingTimer = setTimeout(function() {
    pendingTimer = null;
    handleTabSwitch(activeInfo.tabId);
  }, 50);
});

// ── Window Focus Changed (RULE 6) ─────────────────────────────
chrome.windows.onFocusChanged.addListener(async function(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  try {
    var tabs = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tabs.length > 0) {
      handleTabSwitch(tabs[0].id);
    }
  } catch (err) {
    console.error('[AutoCollapse] Window focus error:', err);
  }
});

// ── Alarm Handler ─────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === ALARM_TIMER) {
    handleTimerExpired();
  }
});

// ── Settings Changed ──────────────────────────────────────────
chrome.storage.onChanged.addListener(async function(changes, areaName) {
  if (areaName !== 'sync') return;

  console.log('[AutoCollapse] Settings changed:', Object.keys(changes));

  // If timer was disabled, clear the alarm
  if (changes.timerEnabled && changes.timerEnabled.newValue === false) {
    await chrome.alarms.clear(ALARM_TIMER);
    console.log('[AutoCollapse] Timer alarm cleared.');
  }

  // If timer settings changed and timer is enabled, reset the alarm
  if (changes.timerValue || changes.timerUnit || changes.timerEnabled) {
    var settings = await getSettings();
    if (settings.timerEnabled === true && settings.autoCollapseEnabled === true) {
      await resetTimer(settings);
    }
  }

  // If auto-collapse was disabled, clear timer too
  if (changes.autoCollapseEnabled && changes.autoCollapseEnabled.newValue === false) {
    await chrome.alarms.clear(ALARM_TIMER);
  }
});

// ── Startup Log ───────────────────────────────────────────────
console.log('[AutoCollapse] Service worker loaded.');
