/**
 * AutoCollapse — Service Worker (Background Script)
 *
 * This file is the "brain" of the extension. It runs invisibly in the background,
 * listening for Chrome events (tab switches, window focus changes, timer alarms)
 * and reacting by collapsing/expanding tab groups.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * - This file has NO access to HTML or the DOM. It's pure logic.
 * - It runs as a "service worker," meaning Chrome can put it to sleep when idle
 *   and wake it up when an event fires. Global variables reset on sleep!
 * - All event listeners MUST be registered at the top level (not inside functions
 *   or setTimeout). Chrome needs to see them when the worker first loads.
 * - Use chrome.storage (not variables) to persist data between sleep cycles.
 * - Use chrome.alarms (not setTimeout) for timers longer than 30 seconds.
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
// These objects define the "factory settings" for AutoCollapse.
// They're used when:
//   1. The extension is installed for the first time (to populate storage)
//   2. Reading from storage (as fallback if a key doesn't exist yet)
//   3. The user clicks "Restore Defaults" in the popup

const DEFAULT_SETTINGS = {
  autoCollapseEnabled: true,   // Master on/off switch for auto-collapse
  timerEnabled: false,          // Inactivity timer (off by default — it's advanced)
  timerValue: 5,                // Timer duration (number part)
  timerUnit: 'minutes',         // Timer duration (unit part): 'seconds' | 'minutes'
};

const DEFAULT_STATS = {
  totalSwitches: 0,             // How many times the user switched tabs
  totalCollapses: 0,            // How many groups were collapsed in total
  groupsUsage: {},              // { "Research": 15, "Code": 20 } — tracks most-used groups
  dailySwitches: [],            // [{ date: "2026-06-07", count: 12 }] — last 7 days
  lastResetDate: null,          // When stats were last reset (for display purposes)
};

// Alarm name constant — using a constant prevents typos.
// If you wrote 'autocollpase-timer' in one place, the alarm create/clear
// would target different alarms and the bug would be very hard to find.
const ALARM_TIMER = 'autocollapse-timer';

// Debounce timer ID — used to prevent processing every rapid tab switch.
// This is an in-memory variable that resets when the worker sleeps.
// That's fine — debouncing only matters during rapid-fire events (while awake).
let pendingTimer = null;

// Inactivity timeout ID — used for short timers (< 30 seconds).
// Chrome alarms have a 30-second minimum, so for shorter timers we use
// setTimeout instead. The service worker stays awake ~30s after tab activity,
// so short setTimeout timers will fire before the worker sleeps.
let inactivityTimeout = null;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Load user settings from Chrome sync storage.
 *
 * HOW chrome.storage.sync.get(defaults) WORKS:
 * - For each key in 'defaults', if the key exists in storage → use stored value
 * - If the key does NOT exist → use the default value
 * - This is NOT the same as get() then merging — Chrome does it for you
 *
 * WHY the try/catch:
 * Storage can fail during Chrome startup or in rare edge cases.
 * If it does, we return the defaults so the extension keeps working.
 *
 * @returns {Promise<Object>} Settings object with all fields guaranteed present
 */
async function getSettings() {
  try {
    return await chrome.storage.sync.get(DEFAULT_SETTINGS);
  } catch (err) {
    console.error('[AutoCollapse] getSettings error:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Promise-based delay. Allows: await delay(500);
 *
 * Used for:
 * 1. Startup delay (let Chrome initialize before querying tabs)
 * 2. Retry backoff in safeGroupUpdate (wait before retrying)
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Convert timer value + unit to total seconds.
 *
 * Used by the hybrid timer system to determine whether to use
 * setTimeout (< 30s) or chrome.alarms (>= 30s).
 *
 * Minimum allowed: 10 seconds (enforced in popup validation).
 *
 * Examples:
 *   timerToSeconds(5, 'minutes')  → 300
 *   timerToSeconds(90, 'seconds') → 90
 *   timerToSeconds(10, 'seconds') → 10
 *
 * @param {number} value - The timer duration number
 * @param {string} unit - Either 'seconds' or 'minutes'
 * @returns {number} Duration in seconds (minimum 10)
 */
function timerToSeconds(value, unit) {
  var seconds;
  if (unit === 'seconds') {
    seconds = value;
  } else {
    seconds = value * 60;
  }
  // Minimum 10 seconds
  return Math.max(10, seconds);
}

/**
 * Update a single tab group with retry on transient Chrome errors.
 *
 * WHY RETRY IS NEEDED:
 * Chrome's tabGroups.update() sometimes throws "cannot be edited right now"
 * when a group is mid-animation (collapsing/expanding). This is a transient
 * error that resolves itself after a short delay.
 *
 * RETRY STRATEGY:
 * - Attempt 1: try immediately
 * - Attempt 2: wait 200ms, try again
 * - Attempt 3: wait 400ms, try again
 * - Give up after 3 attempts
 *
 * SPECIAL CASES:
 * - "No group" / "No tab group" → the group was deleted by the user
 *   between our query and this update. This is harmless, so we skip silently.
 *
 * @param {number} groupId - The tab group ID to update
 * @param {Object} props - Properties to update (e.g., { collapsed: true })
 * @returns {Promise<boolean>} true if update succeeded, false if it failed
 */
async function safeGroupUpdate(groupId, props) {
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      await chrome.tabGroups.update(groupId, props);
      return true;
    } catch (err) {
      var msg = err.message || String(err);

      // Transient error: Chrome is busy with this group. Wait and retry.
      if (msg.includes('cannot be edited') && attempt < 3) {
        await delay(200 * attempt); // Exponential backoff: 200ms, 400ms
        continue;
      }

      // Group was deleted: the user closed the group between our query
      // and this update. This is expected and harmless.
      if (msg.includes('No group') || msg.includes('No tab group')) {
        return false; // group deleted, skip silently
      }

      // Unexpected error: log it so we can debug later
      console.error('[AutoCollapse] Group', groupId, 'update failed:', msg);
      return false;
    }
  }
  return false;
}

/**
 * Collapse ALL expanded groups in a specific window (or all windows).
 *
 * USAGE:
 * - collapseAllGroups(windowId) → only collapse groups in that window
 *   Used when: user clicks an ungrouped tab (Rule 3)
 *
 * - collapseAllGroups() → collapse groups in ALL windows
 *   Used when: inactivity timer fires
 *
 * The function only updates groups that are currently expanded.
 * Already-collapsed groups are skipped (no unnecessary API calls).
 *
 * Updates are sequential (not parallel) to avoid Chrome's "cannot be edited" errors.
 *
 * @param {number} [windowId] - Optional. If provided, only collapse in this window.
 * @returns {Promise<number>} Number of groups that were collapsed
 */
async function collapseAllGroups(windowId) {
  // Empty query {} = all windows. { windowId: X } = specific window.
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
 * Track an analytics event after a tab switch.
 *
 * This records:
 * 1. Total switches (incrementing counter)
 * 2. Total collapses (incrementing counter)
 * 3. Group usage (which group was switched to)
 * 4. Daily activity (for the 7-day chart)
 *
 * Analytics are stored in chrome.storage.local (not sync) because:
 * - They're device-specific (your work laptop activity ≠ home desktop)
 * - They can get large (sync has a 100KB limit)
 *
 * Analytics NEVER cause the extension to crash. If storage fails,
 * we log the error and move on. Auto-collapse is more important than stats.
 *
 * @param {string|null} groupTitle - Name of the group switched to, or null for ungrouped
 * @param {number} collapsedCount - How many groups were collapsed in this switch
 */
async function trackEvent(groupTitle, collapsedCount) {
  try {
    var result = await chrome.storage.local.get({ stats: { ...DEFAULT_STATS } });
    var stats = result.stats;

    // Increment counters. The || 0 prevents NaN if the value is somehow undefined.
    stats.totalSwitches = (stats.totalSwitches || 0) + 1;
    stats.totalCollapses = (stats.totalCollapses || 0) + collapsedCount;

    // Track which group was used (skip for ungrouped tabs where groupTitle is null)
    if (groupTitle) {
      if (!stats.groupsUsage) stats.groupsUsage = {};
      stats.groupsUsage[groupTitle] = (stats.groupsUsage[groupTitle] || 0) + 1;

      // Cap at 20 groups to prevent unbounded storage growth.
      // Sort by usage count (descending) and keep only the top 20.
      var entries = Object.entries(stats.groupsUsage);
      if (entries.length > 20) {
        entries.sort(function(a, b) { return b[1] - a[1]; });
        stats.groupsUsage = Object.fromEntries(entries.slice(0, 20));
      }
    }

    // Track daily activity for the 7-day chart.
    // Each entry is { date: "2026-06-07", count: 12 }.
    if (!stats.dailySwitches) stats.dailySwitches = [];
    var today = new Date().toISOString().split('T')[0]; // "2026-06-07"

    // Find today's entry (if it exists)
    var todayEntry = null;
    for (var i = 0; i < stats.dailySwitches.length; i++) {
      if (stats.dailySwitches[i].date === today) {
        todayEntry = stats.dailySwitches[i];
        break;
      }
    }

    if (todayEntry) {
      todayEntry.count += 1; // Increment existing day
    } else {
      stats.dailySwitches.push({ date: today, count: 1 }); // Add new day
    }

    // Keep only the last 7 days to prevent unbounded growth
    if (stats.dailySwitches.length > 7) {
      stats.dailySwitches = stats.dailySwitches.slice(-7);
    }

    await chrome.storage.local.set({ stats: stats });
  } catch (err) {
    // Analytics should never break auto-collapse. Log and move on.
    console.error('[AutoCollapse] Analytics error:', err);
  }
}

// ── Core Logic ────────────────────────────────────────────────

/**
 * Main auto-collapse handler — the heart of AutoCollapse.
 *
 * Called every time the user switches tabs. Determines what to do
 * based on the active tab's group membership.
 *
 * RULES:
 * 1. (Active Group): Expand active group, collapse others.
 * 2. (Group Switch): Old collapses, new expands.
 * 3. (Ungrouped Tab): Collapse ALL groups. Zero remain expanded.
 * 4. (Single Group): Keep it expanded if active.
 *
 * This function is STATELESS — it doesn't remember what the previous
 * group was. Instead, it computes the correct action from scratch each time.
 * This is important because service workers can sleep and lose all state.
 *
 * @param {number} tabId - The ID of the tab the user just switched to
 */
async function handleTabSwitch(tabId) {
  try {
    // Step 1: Load settings. If auto-collapse is disabled, stop immediately.
    var settings = await getSettings();

    if (settings.autoCollapseEnabled !== true) {
      // Note: we use !== true (not === false) as a safety check.
      // If autoCollapseEnabled is undefined (corrupted storage), this catches it.
      return;
    }

    // Step 2: Get the tab's info (especially groupId and windowId).
    // This can fail if the tab was closed between the event firing and now.
    var tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      return; // Tab was closed — nothing to do
    }

    var windowId = tab.windowId;

    // ── RULE 3: Ungrouped tab → collapse ALL groups ──
    // When the user clicks a tab not in any group, they're saying
    // "I don't want to work in any group right now."
    // groupId is -1 for ungrouped tabs. We also check undefined/null for safety.
    if (tab.groupId === undefined || tab.groupId === null || tab.groupId === -1) {
      console.log('[AutoCollapse] Ungrouped tab', tabId, '→ collapsing all groups');
      var count = await collapseAllGroups(windowId);
      await trackEvent(null, count); // null = no group to attribute
      await resetTimer(settings);
      return;
    }

    // ── RULES 1, 2, 4: Tab is in a group ──
    var activeGroupId = tab.groupId;

    // Query all groups in this window to know what we're working with
    var groups = await chrome.tabGroups.query({ windowId: windowId });
    if (groups.length === 0) return; // No groups in this window (shouldn't happen, but be safe)

    // Find the active group's details (we need its title for analytics)
    var activeGroup = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === activeGroupId) {
        activeGroup = groups[i];
        break;
      }
    }

    // Get the group title for analytics. Unnamed groups have title: "" (empty string),
    // which is falsy, so || 'Untitled' gives us a readable label.
    var activeTitle = activeGroup ? (activeGroup.title || 'Untitled') : null;

    console.log('[AutoCollapse] Tab', tabId, '→ group "' + (activeTitle || activeGroupId) + '" | Total groups:', groups.length);

    // RULE 4: Single group — just make sure it's expanded.
    // With only one group, there's nothing to collapse. Early return for efficiency.
    if (groups.length === 1) {
      if (activeGroup && activeGroup.collapsed === true) {
        await safeGroupUpdate(activeGroupId, { collapsed: false });
      }
      await trackEvent(activeTitle, 0); // 0 collapses
      await resetTimer(settings);
      return;
    }

    // RULES 1 & 2: Multiple groups — the main auto-collapse logic.
    // ORDER MATTERS: expand active group FIRST, then collapse others.
    // If we collapsed first, all groups would briefly be collapsed,
    // causing a visual flicker for the user.

    // Step A: Expand the active group (if it's currently collapsed)
    if (activeGroup && activeGroup.collapsed === true) {
      await safeGroupUpdate(activeGroupId, { collapsed: false });
    }

    // Step B: Collapse every OTHER group (sequential to avoid Chrome errors)
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

    // Track analytics and reset the inactivity timer
    await trackEvent(activeTitle, collapsedCount);
    await resetTimer(settings);

  } catch (err) {
    // Top-level safety net. If anything unexpected goes wrong, log it
    // instead of letting the service worker crash silently.
    console.error('[AutoCollapse] handleTabSwitch error:', err);
  }
}

// ── Timer ─────────────────────────────────────────────────────

/**
 * Reset (restart) the inactivity timer.
 *
 * Called after EVERY tab switch to restart the countdown.
 * The timer measures inactivity — any activity resets it.
 *
 * HYBRID TIMER APPROACH:
 * - Timers < 30 seconds: Use setTimeout.
 *   The service worker stays awake ~30s after tab activity, so short
 *   timers will fire before the worker sleeps. This allows 10-second timers.
 * - Timers >= 30 seconds: Use chrome.alarms.
 *   These survive worker sleep cycles. Chrome enforces a 0.5-minute minimum
 *   for alarms, which is exactly 30 seconds.
 *
 * Flow:
 * 1. Clear any existing timer (both setTimeout and chrome.alarms)
 * 2. If timer is enabled AND auto-collapse is on → set new timer
 * 3. If either is disabled → no timer
 *
 * @param {Object} settings - Current settings from storage
 */
async function resetTimer(settings) {
  try {
    // Always clear both timer types first — prevents stale timers from firing
    if (inactivityTimeout !== null) {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = null;
    }
    await chrome.alarms.clear(ALARM_TIMER);

    // Only create a timer if both timer and auto-collapse are enabled
    if (settings.timerEnabled === true && settings.autoCollapseEnabled === true) {
      var totalSeconds = timerToSeconds(settings.timerValue || 5, settings.timerUnit || 'minutes');

      if (totalSeconds < 30) {
        // SHORT TIMER: Use setTimeout (worker is awake from recent tab activity)
        inactivityTimeout = setTimeout(function() {
          inactivityTimeout = null;
          handleTimerExpired();
        }, totalSeconds * 1000);
        console.log('[AutoCollapse] Timer set (setTimeout):', totalSeconds, 'seconds');
      } else {
        // LONG TIMER: Use chrome.alarms (survives worker sleep)
        var minutes = Math.max(0.5, totalSeconds / 60);
        await chrome.alarms.create(ALARM_TIMER, { delayInMinutes: minutes });
        console.log('[AutoCollapse] Timer set (alarm):', settings.timerValue, settings.timerUnit, '(' + minutes.toFixed(2) + ' min)');
      }
    }
  } catch (err) {
    console.error('[AutoCollapse] resetTimer error:', err);
  }
}

/**
 * Handle timer expiration — collapse ALL groups in ALL windows.
 *
 * This fires when the user hasn't switched tabs for the configured duration.
 * Unlike handleTabSwitch (which only affects one window), the timer
 * collapses groups across ALL windows — the user is fully idle.
 *
 * Safety checks:
 * - Verify auto-collapse is still enabled (user might have disabled it)
 * - Skip if no groups are expanded (nothing to do)
 */
async function handleTimerExpired() {
  try {
    var settings = await getSettings();
    if (settings.autoCollapseEnabled !== true) return;

    // Query ALL groups across ALL windows (empty query = everything)
    var groups = await chrome.tabGroups.query({});
    var expanded = 0;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].collapsed === false) expanded++;
    }

    // If nothing is expanded, there's nothing to do
    if (expanded === 0) return;

    // Collapse every expanded group
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
// EVENT LISTENERS
//
// CRITICAL RULE: All listeners must be registered at the TOP LEVEL
// of the service worker file. If you put them inside a function,
// setTimeout, or if-block, Chrome might not see them and won't
// wake the worker when that event fires.
//
// These are all synchronous registrations — the callbacks inside
// can be async, but the addListener() call itself must be synchronous.
// ══════════════════════════════════════════════════════════════

// ── Install / Update ──────────────────────────────────────────
// Fires when:
// - The extension is installed for the first time (reason: 'install')
// - The extension is updated to a new version (reason: 'update')
// - Chrome itself is updated (reason: 'chrome_update')
chrome.runtime.onInstalled.addListener(async function(details) {
  console.log('[AutoCollapse] onInstalled:', details.reason);

  if (details.reason === 'install') {
    // First install: save default settings and empty analytics
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ stats: { ...DEFAULT_STATS } });
    console.log('[AutoCollapse] Defaults saved.');
  } else if (details.reason === 'update') {
    // Extension updated: merge defaults with existing settings.
    // This ensures new settings added in the update get their defaults
    // without overwriting the user's existing preferences.
    // Example: if v1.1 adds a new setting 'collapseDelay', it gets
    // the default value while 'autoCollapseEnabled' keeps the user's choice.
    var existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    var merged = { ...DEFAULT_SETTINGS, ...existing };
    await chrome.storage.sync.set(merged);
    console.log('[AutoCollapse] Settings merged:', JSON.stringify(merged));
  }
});

// ── Browser Startup (RULE 5) ─────────────────────────────────
// Fires when Chrome starts, NOT on extension install/reload.
// Purpose: Apply auto-collapse rules to the tab state Chrome restored.
chrome.runtime.onStartup.addListener(async function() {
  console.log('[AutoCollapse] Browser startup detected.');

  try {
    // Wait 500ms for Chrome to finish initializing tabs and groups.
    // Without this delay, chrome.tabs.query might return incomplete results.
    await delay(500);

    // Find the active tab in the most recently focused window
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
// Fires every time the user switches to a different tab.
// This is the MAIN EVENT that drives auto-collapse.
//
// DEBOUNCE: When the user rapidly switches tabs (e.g., holding Ctrl+Tab),
// this event fires for every intermediate tab. Without debouncing, we'd
// process each one — causing visual flickering and unnecessary API calls.
//
// The 50ms debounce means: "Wait 50ms after the last switch. If no more
// switches happen, process it. If another switch happens within 50ms,
// cancel the previous and wait again."
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
// Fires when the user switches between Chrome windows.
// We apply auto-collapse rules to the newly focused window.
//
// WINDOW_ID_NONE (-1) means Chrome lost focus entirely — the user
// switched to a different app (VS Code, Slack, etc.). We ignore this
// because there's no Chrome window to operate on.
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
// Fires when any chrome.alarms alarm triggers.
// We check the alarm name to see if it's our inactivity timer.
// (This pattern makes it safe to add more alarms later.)
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === ALARM_TIMER) {
    handleTimerExpired();
  }
});

// ── Settings Changed ──────────────────────────────────────────
// Fires when ANY chrome.storage value changes.
// We only care about sync storage changes (settings), not local (analytics).
//
// This is how the popup communicates with the service worker:
// 1. User saves settings in popup → popup writes to chrome.storage.sync
// 2. This listener fires in the service worker
// 3. Service worker updates the alarm accordingly
//
// No direct messaging needed — storage acts as a shared database.
chrome.storage.onChanged.addListener(async function(changes, areaName) {
  if (areaName !== 'sync') return; // Ignore local storage changes (analytics)

  console.log('[AutoCollapse] Settings changed:', Object.keys(changes));

  // If timer was disabled, immediately clear both timer types
  // (don't wait for them to fire — that would be confusing)
  if (changes.timerEnabled && changes.timerEnabled.newValue === false) {
    if (inactivityTimeout !== null) {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = null;
    }
    await chrome.alarms.clear(ALARM_TIMER);
    console.log('[AutoCollapse] Timer cleared.');
  }

  // If any timer setting changed and timer is enabled, update the alarm
  if (changes.timerValue || changes.timerUnit || changes.timerEnabled) {
    var settings = await getSettings();
    if (settings.timerEnabled === true && settings.autoCollapseEnabled === true) {
      await resetTimer(settings);
    }
  }

  // If auto-collapse was disabled entirely, clear the timer too
  // (no point timing inactivity if auto-collapse is off)
  if (changes.autoCollapseEnabled && changes.autoCollapseEnabled.newValue === false) {
    if (inactivityTimeout !== null) {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = null;
    }
    await chrome.alarms.clear(ALARM_TIMER);
  }
});

// ── Startup Log ───────────────────────────────────────────────
// This runs immediately when the service worker loads.
// It's useful for confirming the worker is alive in DevTools.
console.log('[AutoCollapse] Service worker loaded.');
