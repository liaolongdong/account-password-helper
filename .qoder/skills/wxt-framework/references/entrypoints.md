# WXT Entrypoints Reference

## Entry Point Types and Configuration

### Background Scripts

Background scripts are the core of your extension, running in the background with access to extension APIs.

#### File Structure

```
entrypoints/
└── background.[jt]s
# or
entrypoints/
└── background/
    └── index.[jt]s
```

#### Basic Configuration

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  console.log('Background script loaded');

  // Add listeners and initialization logic here
  browser.runtime.onInstalled.addListener(details => {
    console.log('Extension installed:', details.reason);
  });
});
```

#### Advanced Configuration

```typescript
export default defineBackground({
  // MV3: service worker type (default)
  // MV2: can be 'persistent' or 'event' (default: event)
  type: 'module',
  persistent: false, // MV2 only

  // Build-time filtering
  include: ['chrome', 'firefox'], // Only include in these browsers
  exclude: ['safari'], // Exclude from these browsers

  // Main execution function (cannot be async)
  main() {
    // Extension initialization logic
    initializeAnalytics();
    setupMessageHandlers();
    registerAlarms();
  },
});
```

#### Best Practices

- Keep background scripts lightweight
- Handle errors gracefully to prevent crashes
- Clean up listeners and timers appropriately
- Use browser APIs only inside the main function

### Content Scripts

Content scripts run on web pages and can interact with the DOM.

#### File Patterns

```
entrypoints/
├── content.[jt]sx?                     # Main content script
├── {name}.content.[jt]sx?              # Named content script
└── {name}.content/
    └── index.[jt]sx?                   # Directory structure
```

#### Basic Configuration

```typescript
// entrypoints/content.ts
export default defineContentScript({
  // Required: URL patterns to match
  matches: ['*://*.example.com/*', '*://example.com/*'],

  // Optional: Exclude specific matches
  excludeMatches: ['*://exclude.example.com/*'],

  // Execution timing
  runAt: 'document_end', // 'document_start' | 'document_end' | 'document_idle'

  // Scripting world
  world: 'ISOLATED', // 'ISOLATED' (default) | 'MAIN'

  // Frame handling
  allFrames: false,
  matchAboutBlank: false,

  // CSS injection mode
  cssInjectionMode: 'manifest', // 'manifest' | 'manual' | 'ui'

  // Registration method
  registration: 'manifest', // 'manifest' (default) | 'runtime'

  // Build filtering
  include: undefined,
  exclude: undefined,

  // Main execution function
  main(ctx) {
    // Content script logic
    console.log('Content script loaded on:', window.location.href);

    // Clean up when script is invalidated
    ctx.onInvalidated(() => {
      console.log('Content script cleaned up');
    });
  },
});
```

#### Content Script Context

```typescript
main(ctx: ContentScriptContext) {
  // Create isolated scope for cleanup
  const cleanup = () => {
    document.removeEventListener('click', handleClick);
  };

  ctx.onInvalidated(cleanup);

  // Safe DOM manipulation
  const button = document.createElement('button');
  button.textContent = 'Extension Button';
  document.body.appendChild(button);
}
```

### Popup Pages

Popup pages appear when users click the extension icon.

#### File Structure

```
entrypoints/
└── popup/
    ├── index.html
    ├── main.[jt]sx?
    └── style.css
```

#### HTML Template

```html
<!-- entrypoints/popup/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>Extension Popup</title>
    <!-- MV2 popup type configuration -->
    <meta
      name="manifest.type"
      content="page_action"
    />
  </head>
  <body>
    <div id="app">
      <h1>My Extension</h1>
      <button id="action-btn">Do Something</button>
    </div>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

#### JavaScript Logic

```typescript
// entrypoints/popup/main.ts
document.addEventListener('DOMContentLoaded', async () => {
  const button = document.getElementById('action-btn');

  button?.addEventListener('click', async () => {
    // Send message to background script
    const response = await browser.runtime.sendMessage({
      type: 'POPUP_ACTION',
      data: 'user clicked button',
    });

    console.log('Response:', response);
  });
});
```

### Options Pages

Options pages provide user configuration interfaces.

#### File Structure

```
entrypoints/
└── options/
    ├── index.html
    ├── main.[jt]sx?
    └── style.css
```

#### HTML Template

```html
<!-- entrypoints/options/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>Extension Options</title>
  </head>
  <body>
    <div id="app">
      <h1>Extension Settings</h1>
      <form id="settings-form">
        <label>
          <input
            type="checkbox"
            id="notifications"
          />
          Enable Notifications
        </label>
        <button type="submit">Save Settings</button>
      </form>
    </div>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

#### JavaScript Logic

```typescript
// entrypoints/options/main.ts
import { storage } from 'wxt/storage';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form') as HTMLFormElement;
  const notificationsCheckbox = document.getElementById(
    'notifications',
  ) as HTMLInputElement;

  // Load current settings
  const settings = (await storage.getItem('local:settings')) || {
    notifications: true,
  };
  notificationsCheckbox.checked = settings.notifications;

  // Save settings
  form.addEventListener('submit', async e => {
    e.preventDefault();

    const newSettings = {
      notifications: notificationsCheckbox.checked,
    };

    await storage.setItem('local:settings', newSettings);
    console.log('Settings saved:', newSettings);
  });
});
```

### Side Panel (MV3)

Side panels provide persistent UI alongside web pages.

#### File Structure

```
entrypoints/
└── sidepanel/
    ├── index.html
    ├── main.[jt]sx?
    └── style.css
```

#### Configuration

```typescript
// entrypoints/sidepanel/index.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Side Panel</title>
</head>
<body>
  <div id="app">
    <h1>Side Panel Content</h1>
    <div id="content"></div>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

#### Manifest Configuration

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    side_panel: {
      default_path: 'sidepanel.html',
    },
    permissions: ['sidePanel'],
  },
});
```

### Devtools Panels

Devtools extensions add custom panels to browser developer tools.

#### File Structure

```
entrypoints/
└── devtools/
    ├── index.html
    ├── main.[jt]sx?
    └── panel.html
```

#### Devtools HTML

```html
<!-- entrypoints/devtools/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

#### Devtools Logic

```typescript
// entrypoints/devtools/main.ts
browser.devtools.panels
  .create(
    'My Panel', // Panel title
    'icon/16.png', // Icon path
    'devtools/panel.html', // Panel HTML file
  )
  .then(panel => {
    console.log('Devtools panel created');

    // Handle panel events
    panel.onShown.addListener(() => {
      console.log('Panel shown');
    });
  });
```

### Override Pages

Override pages replace built-in browser pages.

#### New Tab Override

```
entrypoints/
└── newtab/
    ├── index.html
    ├── main.[jt]sx?
    └── style.css
```

#### HTML Template

```html
<!-- entrypoints/newtab/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>New Tab</title>
  </head>
  <body>
    <div id="app">
      <h1>Welcome to New Tab</h1>
      <div class="quick-links">
        <!-- Quick links content -->
      </div>
    </div>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

#### Manifest Configuration

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
  },
});
```

### Unlisted Entrypoints

Unlisted entrypoints are not referenced in the manifest but can be used by other parts of your extension.

#### Welcome Page Example

```
entrypoints/
└── welcome/
    ├── index.html
    ├── main.[jt]sx?
    └── style.css
```

#### HTML with Unlisted Meta Tag

```html
<!-- entrypoints/welcome/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Welcome to My Extension</title>
    <!-- Exclude from all builds (unlisted) -->
    <meta
      name="manifest.exclude"
      content="['all']"
    />
  </head>
  <body>
    <div class="welcome-container">
      <h1>Welcome!</h1>
      <p>Thanks for installing our extension.</p>
      <button id="get-started">Get Started</button>
    </div>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

#### Opening Unlisted Pages

```typescript
// From background script
browser.tabs.create({
  url: browser.runtime.getURL('welcome.html'),
});
```

### Advanced Entry Point Patterns

#### Multiple Content Scripts

```
entrypoints/
├── content.ts              # Main content script
├── utils.content.ts        # Utility content script
└── features/
    └── analytics.content.ts # Feature-specific content script
```

#### Conditional Entry Points

```typescript
// entrypoints/background.ts
export default defineBackground({
  include:
    process.env.NODE_ENV === 'development'
      ? ['chrome', 'firefox', 'edge']
      : ['chrome', 'firefox'],

  main() {
    if (process.env.NODE_ENV === 'development') {
      setupDevTools();
    }

    // Common initialization
    initializeExtension();
  },
});
```

#### Shared Entry Point Logic

```typescript
// utils/entrypoint-helpers.ts
export function setupErrorHandling() {
  window.addEventListener('error', event => {
    console.error('Entry point error:', event.error);
  });
}

export function setupMessaging() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Common message handling logic
    return true; // Keep message channel open for async response
  });
}

// Usage in entrypoints
// entrypoints/popup/main.ts
import { setupErrorHandling, setupMessaging } from '@/utils/entrypoint-helpers';

setupErrorHandling();
setupMessaging();
```

This reference covers all entrypoint types supported by WXT, including their configuration options, best practices, and advanced patterns for building robust browser extensions.
