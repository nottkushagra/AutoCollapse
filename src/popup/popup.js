/**
 * AutoCollapse — Popup Script
 *
 * This script runs every time the popup opens.
 * When the user clicks away, the popup closes and this script dies.
 * That's why we NEVER store important state here — use chrome.storage instead.
 *
 * MILESTONE 2: Collapse All / Expand All buttons
 *
 * NEW CONCEPTS IN THIS FILE:
 * 1. chrome.tabGroups.query({})    — returns an array of ALL tab groups
 * 2. chrome.tabGroups.update(id, props) — changes properties of a group (like collapsed)
 * 3. Promise.all([...])            — runs multiple async operations in PARALLEL
 * 4. try/catch                     — handles errors gracefully instead of crashing
 * 5. button.disabled               — prevents double-clicks during async operations
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ── Cache DOM Elements ──────────────────────────────────────
  // We look these up ONCE and reuse them. This is faster than
  // calling getElementById() every time we need an element.
  const versionEl     = document.getElementById('version-text');
  const groupCountEl  = document.getElementById('group-count');
  const statusEl      = document.getElementById('action-status');
  const collapseBtn   = document.getElementById('btn-collapse-all');
  const expandBtn     = document.getElementById('btn-expand-all');

  // ── Display Version ─────────────────────────────────────────
  const manifest = chrome.runtime.getManifest();
  if (versionEl) {
    versionEl.textContent = `v${manifest.version}`;
  }

  // ── Helper: Update Group Count ──────────────────────────────
  // This function is called on load AND after every action,
  // so the count always reflects the current state.
  async function updateGroupCount() {
    try {
      const groups = await chrome.tabGroups.query({});
      const count = groups.length;

      if (count === 0) {
        groupCountEl.innerHTML = 'No tab groups';
      } else {
        // innerHTML is safe here because we control the content (no user input)
        groupCountEl.innerHTML =
          `<span class="content__group-count__number">${count}</span> ` +
          `tab group${count === 1 ? '' : 's'}`;
      }

      return count;
    } catch (err) {
      console.error('[AutoCollapse] Failed to query groups:', err);
      groupCountEl.textContent = 'Unable to count groups';
      return 0;
    }
  }

  // ── Helper: Show Status Message ─────────────────────────────
  // Shows a temporary message below the buttons.
  // `type` can be 'success' or 'error'.
  // The message auto-clears after 2.5 seconds.
  let statusTimeout = null;

  function showStatus(message, type = 'success') {
    // Clear any existing timeout so messages don't overlap
    if (statusTimeout) {
      clearTimeout(statusTimeout);
    }

    // Remove old CSS classes, add the new one
    statusEl.className = 'content__action-status';
    statusEl.classList.add(`content__action-status--${type}`);
    statusEl.textContent = message;

    // Force the browser to restart the fade-in animation
    // Without this, if you click twice quickly, the animation won't replay
    statusEl.style.animation = 'none';
    // This line forces a DOM reflow — the browser re-reads the element
    // It looks like a no-op but it's a well-known trick to restart CSS animations
    statusEl.offsetHeight; // eslint-disable-line no-unused-expressions
    statusEl.style.animation = '';

    // Auto-clear after 2.5 seconds
    statusTimeout = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'content__action-status';
    }, 2500);
  }

  // ── Helper: Set Buttons Enabled/Disabled ────────────────────
  // Prevents double-clicks while an operation is in progress.
  function setButtonsEnabled(enabled) {
    collapseBtn.disabled = !enabled;
    expandBtn.disabled = !enabled;
  }

  // ── Core Action: Collapse All Groups ────────────────────────
  async function collapseAllGroups() {
    setButtonsEnabled(false);

    try {
      const groups = await chrome.tabGroups.query({});

      if (groups.length === 0) {
        showStatus('⚠️ No tab groups to collapse', 'error');
        return;
      }

      // Filter to only groups that aren't already collapsed
      // (No point updating groups that are already in the right state)
      const expanded = groups.filter(g => !g.collapsed);

      if (expanded.length === 0) {
        showStatus('All groups already collapsed', 'success');
        return;
      }

      // Collapse all expanded groups IN PARALLEL using Promise.all
      // This is faster than doing them one-by-one with sequential awaits
      await Promise.all(
        expanded.map(group =>
          chrome.tabGroups.update(group.id, { collapsed: true })
        )
      );

      showStatus(`✅ Collapsed ${expanded.length} group${expanded.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      console.error('[AutoCollapse] Collapse failed:', err);
      showStatus('❌ Failed to collapse groups', 'error');
    } finally {
      // ALWAYS re-enable buttons and refresh count, even if an error occurred.
      // `finally` runs whether try succeeded OR catch caught an error.
      setButtonsEnabled(true);
      await updateGroupCount();
    }
  }

  // ── Core Action: Expand All Groups ──────────────────────────
  async function expandAllGroups() {
    setButtonsEnabled(false);

    try {
      const groups = await chrome.tabGroups.query({});

      if (groups.length === 0) {
        showStatus('⚠️ No tab groups to expand', 'error');
        return;
      }

      const collapsed = groups.filter(g => g.collapsed);

      if (collapsed.length === 0) {
        showStatus('All groups already expanded', 'success');
        return;
      }

      await Promise.all(
        collapsed.map(group =>
          chrome.tabGroups.update(group.id, { collapsed: false })
        )
      );

      showStatus(`✅ Expanded ${collapsed.length} group${collapsed.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      console.error('[AutoCollapse] Expand failed:', err);
      showStatus('❌ Failed to expand groups', 'error');
    } finally {
      setButtonsEnabled(true);
      await updateGroupCount();
    }
  }

  // ── Wire Up Event Listeners ─────────────────────────────────
  // We use addEventListener (not onclick) because:
  // 1. Chrome Extensions block inline event handlers (CSP)
  // 2. addEventListener lets you attach multiple listeners to the same element
  // 3. It's the modern standard
  collapseBtn.addEventListener('click', collapseAllGroups);
  expandBtn.addEventListener('click', expandAllGroups);

  // ── Initial Load ────────────────────────────────────────────
  await updateGroupCount();

  console.log('[AutoCollapse] Popup opened. Version:', manifest.version);
});
