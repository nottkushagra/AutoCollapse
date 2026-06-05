/**
 * AutoCollapse — Service Worker (Background Script)
 *
 * This file runs in the background as a service worker.
 * It has NO access to the DOM — it can only listen to Chrome events
 * and use Chrome APIs.
 *
 * IMPORTANT RULES FOR SERVICE WORKERS:
 * 1. They are "ephemeral" — Chrome can terminate them after ~30s of inactivity
 * 2. NEVER store state in global variables (they'll be lost when SW restarts)
 * 3. Use chrome.storage for any data that needs to persist
 * 4. All event listeners MUST be registered at the top level (synchronously)
 *
 * For Milestone 1, this file just logs that it loaded successfully.
 * In Milestone 4, this is where our auto-collapse logic will live.
 */

// This runs when the extension is first installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[AutoCollapse] Extension installed successfully! 🎉');
  } else if (details.reason === 'update') {
    console.log('[AutoCollapse] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// Log that the service worker has started
// (This runs every time Chrome restarts the service worker)
console.log('[AutoCollapse] Service worker loaded.');
