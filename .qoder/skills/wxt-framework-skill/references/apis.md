# WXT Extension APIs Reference

## Browser API Integration

WXT provides a unified browser API that works across all supported browsers (Chrome, Firefox, Edge, Safari).

### Unified API Access

```typescript
// No import needed - auto-imported globally
// Access browser APIs directly through the browser variable

// Runtime API
const tabs = await browser.tabs.query({ active: true, currentWindow: true });
const extensionInfo = await browser.runtime.getManifest();

// Storage API
const data = await browser.storage.local.get(['key']);
await browser.storage.local.set({ key: 'value' });

// Action API (unified for popup/button)
await browser.action.setBadgeText({ text: '5' });
await browser.action.setIcon({ path: 'icon/32.png' });
```

### Type Safety

```typescript
// Access types through Browser namespace
import type { Tabs, Runtime, Storage } from 'wxt/browser';

const tab: Browser.Tabs.Tab = await browser.tabs.create({
  url: 'https://example.com',
});

const message: Browser.Runtime.MessageSender = {
  id: 'extension-id',
  url: 'https://example.com',
};
```

### Feature Detection

```typescript
// Check API availability at runtime
export function isSidebarSupported(): boolean {
  return 'sidebarAction' in browser;
}

export function isSidePanelSupported(): boolean {
  return 'sidePanel' in browser;
}

// Usage
if (isSidebarSupported()) {
  await browser.sidebarAction.open();
} else if (isSidePanelSupported()) {
  await browser.sidePanel.open({ windowId: currentWindow.id });
} else {
  // Fallback behavior
  console.log('Neither sidebar nor side panel supported');
}
```

## Storage Management

### WXT Storage API (Recommended)

```typescript
import { storage } from 'wxt/storage';

// Define storage items with defaults and validation
const storageDefinition = {
  userPreferences: {
    defaultValue: {
      theme: 'light' as 'light' | 'dark',
      notifications: true,
      language: 'en',
    },
  },
  lastSyncTime: {
    defaultValue: null as string | null,
  },
  featureFlags: {
    defaultValue: {
      newUI: false,
      analytics: true,
    },
  },
};

// Type-safe storage operations
type StorageItems = typeof storageDefinition;

// Get item
const preferences = await storage.getItem<StorageItems['userPreferences']>(
  'local:userPreferences',
);

// Set item
await storage.setItem('local:lastSyncTime', new Date().toISOString());

// Remove item
await storage.removeItem('local:lastSyncTime');

// Watch for changes
const unwatch = storage.watch('local:userPreferences', (newValue, oldValue) => {
  console.log('Preferences changed:', oldValue, '→', newValue);
  updateTheme(newValue.theme);
});

// Clean up watcher
unwatch();
```

### Migration System

```typescript
// Define storage schema with versioning
const storageSchema = {
  version: 2,
  migrations: {
    // Migration from version 1 to 2
    1: (oldData: any) => {
      return {
        ...oldData,
        featureFlags: {
          newUI: false,
          analytics: oldData.analyticsEnabled ?? true,
        },
        // Remove deprecated fields
        analyticsEnabled: undefined,
      };
    },
    // Migration from version 2 to 3
    2: (oldData: any) => {
      return {
        ...oldData,
        userPreferences: {
          ...oldData.userPreferences,
          language: oldData.userPreferences.lang || 'en',
          // Remove old field
          lang: undefined,
        },
      };
    },
  },
};

// Apply migrations automatically
await storage.migrate(storageSchema);
```

### Storage Areas

```typescript
// Local storage (persistent)
await storage.setItem('local:userSettings', settings);

// Session storage (per-session)
await storage.setItem('session:temporaryData', tempData);

// Managed storage (admin-controlled, read-only)
const managedSettings = await storage.getItem('managed:adminSettings');

// Sync storage (synced across devices)
await storage.setItem('sync:userPreferences', preferences);
```

## Message Passing

### Background Script Message Handler

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleBackgroundMessage(message, sender, sendResponse);
    return true; // Keep message channel open for async response
  });
});

async function handleBackgroundMessage(
  message: any,
  sender: Browser.Runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  try {
    switch (message.type) {
      case 'GET_TAB_INFO':
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        sendResponse({ success: true, data: tabs[0] });
        break;

      case 'SAVE_DATA':
        await storage.setItem('local:savedData', message.data);
        sendResponse({ success: true });
        break;

      case 'GET_STORAGE_ITEM':
        const value = await storage.getItem(`local:${message.key}`);
        sendResponse({ success: true, data: value });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Message handling error:', error);
    sendResponse({ success: false, error: error.message });
  }
}
```

### Content Script Communication

```typescript
// entrypoints/content.ts
export default defineContentScript({
  matches: ['*://*.example.com/*'],

  main() {
    // Listen for messages from background
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handleContentMessage(message, sendResponse);
      return true;
    });

    // Send message to background
    sendMessageToBackground({ type: 'CONTENT_LOADED' });
  },
});

function handleContentMessage(
  message: any,
  sendResponse: (response?: any) => void,
) {
  switch (message.type) {
    case 'HIGHLIGHT_ELEMENTS':
      highlightElements(message.selector);
      sendResponse({ success: true });
      break;

    case 'GET_PAGE_INFO':
      sendResponse({
        success: true,
        data: {
          url: window.location.href,
          title: document.title,
          text: document.body.innerText.substring(0, 1000),
        },
      });
      break;
  }
}

function sendMessageToBackground(message: any) {
  browser.runtime
    .sendMessage(message)
    .then(response => {
      if (response?.success) {
        console.log('Message sent successfully');
      } else {
        console.error('Message failed:', response?.error);
      }
    })
    .catch(error => {
      console.error('Message error:', error);
    });
}
```

### Popup/Options Communication

```typescript
// entrypoints/popup/main.ts
async function getTabInfo() {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_TAB_INFO',
    });

    if (response.success) {
      updateUI(response.data);
    } else {
      showError(response.error);
    }
  } catch (error) {
    console.error('Failed to get tab info:', error);
  }
}

async function saveUserSettings(settings: any) {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'SAVE_DATA',
      data: settings,
    });

    if (response.success) {
      showSuccess('Settings saved!');
    } else {
      showError('Failed to save settings');
    }
  } catch (error) {
    console.error('Save error:', error);
  }
}
```

## Alarms and Background Tasks

### Alarm Management

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  // Create alarms
  setupAlarms();

  // Handle alarm events
  browser.alarms.onAlarm.addListener(handleAlarm);
});

function setupAlarms() {
  // Create a recurring alarm every hour
  browser.alarms.create('hourly-sync', {
    periodInMinutes: 60,
  });

  // Create a one-time alarm for 10 minutes from now
  browser.alarms.create('reminder', {
    delayInMinutes: 10,
  });

  // Create alarm with specific time
  const scheduledTime = new Date();
  scheduledTime.setHours(scheduledTime.getHours() + 1);

  browser.alarms.create('scheduled-task', {
    when: scheduledTime.getTime(),
  });
}

async function handleAlarm(alarm: Browser.Alarms.Alarm) {
  switch (alarm.name) {
    case 'hourly-sync':
      await performSync();
      break;

    case 'reminder':
      await showReminder();
      break;

    case 'scheduled-task':
      await executeScheduledTask();
      break;
  }
}

async function performSync() {
  try {
    // Perform sync operation
    const data = await fetchDataFromAPI();
    await storage.setItem('local:syncedData', data);
    await storage.setItem('local:lastSync', new Date().toISOString());
  } catch (error) {
    console.error('Sync failed:', error);
  }
}
```

### Idle Detection

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  // Monitor system idle state
  browser.idle.onStateChanged.addListener(handleIdleStateChange);

  // Set detection interval (15 seconds to 4 minutes)
  browser.idle.setDetectionInterval(60); // 1 minute
});

function handleIdleStateChange(newState: Browser.Idle.IdleState) {
  switch (newState) {
    case 'active':
      console.log('User is active');
      // Resume operations
      break;

    case 'idle':
      console.log('User is idle');
      // Pause non-essential operations
      break;

    case 'locked':
      console.log('System is locked');
      // Secure sensitive operations
      break;
  }
}
```

## Context Menus

### Menu Creation

```typescript
// entrypoints/background.ts
export default defineBackground(async () => {
  // Create context menus when extension is installed
  browser.runtime.onInstalled.addListener(createContextMenus);

  // Handle menu clicks
  browser.contextMenus.onClicked.addListener(handleContextMenuClick);
});

async function createContextMenus() {
  // Remove existing menus first
  await browser.contextMenus.removeAll();

  // Create parent menu
  browser.contextMenus.create({
    id: 'main-menu',
    title: 'My Extension',
    contexts: ['page', 'selection'],
  });

  // Create sub-menu items
  browser.contextMenus.create({
    id: 'save-selection',
    parentId: 'main-menu',
    title: 'Save Selection',
    contexts: ['selection'],
  });

  browser.contextMenus.create({
    id: 'analyze-page',
    parentId: 'main-menu',
    title: 'Analyze Page',
    contexts: ['page'],
  });

  // Create separator
  browser.contextMenus.create({
    id: 'separator',
    parentId: 'main-menu',
    type: 'separator',
    contexts: ['page', 'selection'],
  });

  // Create with keyboard shortcut
  browser.contextMenus.create({
    id: 'quick-action',
    title: 'Quick Action (Ctrl+Shift+Q)',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.example.com/*'],
  });
}

async function handleContextMenuClick(
  info: Browser.ContextMenus.OnClickData,
  tab?: Browser.Tabs.Tab,
) {
  try {
    switch (info.menuItemId) {
      case 'save-selection':
        await saveSelection(info.selectionText, tab);
        break;

      case 'analyze-page':
        await analyzePage(tab);
        break;

      case 'quick-action':
        await performQuickAction(tab);
        break;
    }
  } catch (error) {
    console.error('Context menu error:', error);
  }
}

async function saveSelection(selectionText: string, tab?: Browser.Tabs.Tab) {
  const savedItems = (await storage.getItem('local:savedItems')) || [];
  savedItems.push({
    text: selectionText,
    url: tab?.url,
    timestamp: new Date().toISOString(),
  });

  await storage.setItem('local:savedItems', savedItems);

  // Show notification
  await browser.notifications.create({
    type: 'basic',
    title: 'Selection Saved',
    message: `Saved: ${selectionText.substring(0, 50)}...`,
    iconUrl: 'icon/32.png',
  });
}
```

## Notifications

### Notification Management

```typescript
// Permission must be declared in manifest
// permissions: ['notifications']

async function showBasicNotification(title: string, message: string) {
  const notificationId = await browser.notifications.create({
    type: 'basic',
    title: title,
    message: message,
    iconUrl: 'icon/48.png',
  });

  return notificationId;
}

async function showProgressNotification(
  title: string,
  message: string,
  progress: number,
) {
  const notificationId = await browser.notifications.create({
    type: 'progress',
    title: title,
    message: message,
    iconUrl: 'icon/48.png',
    progress: Math.min(100, Math.max(0, progress)),
  });

  return notificationId;
}

// Handle notification clicks
browser.notifications.onClicked.addListener(notificationId => {
  console.log('Notification clicked:', notificationId);
  // Handle notification interaction
  browser.notifications.clear(notificationId);
});

// Handle notification close
browser.notifications.onClosed.addListener((notificationId, byUser) => {
  console.log('Notification closed:', notificationId, 'by user:', byUser);
});
```

## Permissions Management

### Dynamic Permissions

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  // Handle permission requests
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REQUEST_PERMISSIONS') {
      requestPermissions(message.permissions)
        .then(result => sendResponse({ success: true, granted: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open
    }
  });
});

async function requestPermissions(permissions: string[]): Promise<boolean> {
  try {
    // Check if permissions are already granted
    const existing = await browser.permissions.getAll();
    const needed = permissions.filter(p => !existing.permissions?.includes(p));

    if (needed.length === 0) {
      return true; // Already have all permissions
    }

    // Request missing permissions
    const granted = await browser.permissions.request({
      permissions: needed,
    });

    return granted;
  } catch (error) {
    console.error('Permission request failed:', error);
    return false;
  }
}

// Usage example
async function enableTabCapture() {
  const granted = await requestPermissions(['tabCapture']);
  if (granted) {
    // Proceed with tab capture functionality
    startTabCapture();
  } else {
    // Handle permission denial
    showPermissionDeniedMessage();
  }
}
```

### Permission Checking

```typescript
async function checkPermissions(
  requiredPermissions: string[],
): Promise<boolean> {
  try {
    const permissions = await browser.permissions.getAll();
    const hasAll = requiredPermissions.every(p =>
      permissions.permissions?.includes(p),
    );

    return hasAll;
  } catch (error) {
    console.error('Permission check failed:', error);
    return false;
  }
}

// Usage
const hasStoragePermission = await checkPermissions(['storage']);
const hasAllPermissions = await checkPermissions([
  'storage',
  'tabs',
  'activeTab',
]);
```

## Cross-browser Compatibility

### Browser Detection

```typescript
// Utility functions for browser detection
export function isChrome(): boolean {
  return (
    /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor)
  );
}

export function isFirefox(): boolean {
  return /Firefox/.test(navigator.userAgent);
}

export function isSafari(): boolean {
  return (
    /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
  );
}

export function isEdge(): boolean {
  return /Edg/.test(navigator.userAgent);
}

// Usage
if (isFirefox()) {
  // Firefox-specific code
  await browser.sidebarAction.open();
} else if (isChrome() || isEdge()) {
  // Chromium-based browser code
  await browser.sidePanel.open({ windowId: currentWindow.id });
}
```

### API Fallbacks

```typescript
// Universal badge setting function
async function setBadgeText(text: string, tabId?: number) {
  try {
    if ('action' in browser) {
      // MV3 and modern browsers
      await browser.action.setBadgeText({ text, tabId });
    } else if ('browserAction' in browser) {
      // MV2 fallback
      await browser.browserAction.setBadgeText({ text, tabId });
    }
  } catch (error) {
    console.error('Failed to set badge text:', error);
  }
}

// Universal badge color setting
async function setBadgeBackgroundColor(
  color: string | number[],
  tabId?: number,
) {
  try {
    if ('action' in browser) {
      await browser.action.setBadgeBackgroundColor({ color, tabId });
    } else if ('browserAction' in browser) {
      await browser.browserAction.setBadgeBackgroundColor({ color, tabId });
    }
  } catch (error) {
    console.error('Failed to set badge background:', error);
  }
}
```

This API reference covers the essential browser extension APIs available through WXT, including unified API access, storage management, message passing, alarms, context menus, notifications, and cross-browser compatibility patterns.
