/**
 * AutoCollapse — Popup Script
 *
 * This script runs every time the popup opens.
 * When the user clicks away, the popup closes and this script dies.
 * That's why we NEVER store important state here — use chrome.storage instead.
 *
 * IMPORTANT PATTERN: DOMContentLoaded
 * We wrap our initialization in this event to make sure all HTML elements
 * exist before we try to access them. Without this, getElementById()
 * might return null if the script runs before the HTML is parsed.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Display the extension version from manifest.json
  // chrome.runtime.getManifest() returns the parsed manifest.json object
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.getElementById('version-text');

  if (versionElement) {
    versionElement.textContent = `v${manifest.version}`;
  }

  // Log to the popup's console (visible via right-click → Inspect on the popup)
  console.log('[AutoCollapse] Popup opened. Version:', manifest.version);
});
