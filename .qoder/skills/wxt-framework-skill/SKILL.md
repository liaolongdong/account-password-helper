---
name: wxt-framework
description: Expert guidance for building web extensions with WXT framework, following official documentation and best practices. Use when creating new web extensions, migrating existing extensions to WXT, configuring extension manifests, managing entrypoints, working with content scripts, or implementing extension APIs.
---

# WXT Framework Skill

## Overview

This skill provides comprehensive guidance for building web extensions using the WXT (Web Extension Toolkit) framework, following official documentation and best practices. It covers project setup, configuration, entrypoint management, and extension API usage.

## Core Capabilities

### 1. Project Setup and Initialization

- Bootstrap new WXT projects with official templates
- Configure package.json scripts for development workflows
- Set up TypeScript and build configurations
- Enable automatic browser startup during development

### 2. Project Structure Management

- Configure source directory structure (src/ option)
- Manage entrypoints directory organization
- Customize output and public directories
- Set up environment variables and runtime configuration

### 3. Entrypoint Configuration

- Background scripts (service workers for MV3)
- Content scripts with proper manifest options
- Popup, options, and sidepanel pages
- Devtools panels and overrides pages
- Unlisted entrypoints (welcome pages, injected scripts)

### 4. Extension APIs and Storage

- Use unified browser APIs across browsers
- Configure storage with proper permissions
- Handle runtime feature detection
- Manage cross-browser compatibility

### 5. Configuration and Manifest Management

- Dynamic manifest generation from wxt.config.ts
- Configure manifest options for different browsers
- Handle Manifest V2 and V3 compatibility
- Automatic icon discovery and inclusion

## Project Initialization

### Quick Start Template

Create a new WXT project:

```bash
# Using your preferred package manager
pnpm dlx wxt@latest init
# or
bunx wxt@latest init
# or
npx wxt@latest init
# or
yarn dlx wxt@latest init
```

### Manual Setup From Scratch

If creating without the CLI:

1. **Create and Initialize Project**

   ```bash
   mkdir my-extension
   cd my-extension
   npm init  # or yarn init / pnpm init
   npm install --save-dev wxt
   ```

2. **Basic Directory Structure**

   ```bash
   .output/
   assets/
   entrypoints/
   public/
   package.json
   tsconfig.json
   wxt.config.ts
   ```

3. **Essential package.json Scripts**
   ```json
   {
     "scripts": {
       "dev": "wxt",
       "dev:firefox": "wxt -b firefox",
       "build": "wxt build",
       "build:firefox": "wxt build -b firefox",
       "zip": "wxt zip",
       "zip:firefox": "wxt zip -b firefox",
       "postinstall": "wxt prepare"
     }
   }
   ```

## Project Structure Configuration

### Standard Structure

Default WXT project structure:

```
project-root/
├── .output/           # Build output
├── .wxt/             # Generated TypeScript config
├── assets/           # Processed assets
├── components/       # Auto-imported UI components
├── composables/      # Auto-imported Vue composables
├── entrypoints/      # Extension entrypoints
├── hooks/            # Auto-imported React/Solid hooks
├── modules/          # Local WXT modules
├── public/           # Static files (copied as-is)
├── utils/            # Auto-imported utilities
├── .env              # Environment variables
├── app.config.ts     # Runtime configuration
├── package.json
├── tsconfig.json
├── web-ext.config.ts # Browser startup config
└── wxt.config.ts     # Main WXT configuration
```

### Using src/ Directory

Enable src directory in `wxt.config.ts`:

```typescript
export default defineConfig({
  srcDir: 'src',
});
```

This moves source code to `src/` while keeping config files at root.

### Custom Directory Configuration

```typescript
export default defineConfig({
  srcDir: 'src',
  modulesDir: 'wxt-modules',
  outDir: 'dist',
  publicDir: 'static',
  entrypointsDir: 'entries',
});
```

## Entrypoint Management

### Background Scripts

**File:** `entrypoints/background.ts` or `entrypoints/background/index.ts`

```typescript
export default defineBackground(() => {
  // Executed when background is loaded
  console.log('Background script loaded');

  // Add event listeners here
  browser.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
  });
});
```

**With Manifest Options:**

```typescript
export default defineBackground({
  type: 'module', // For MV3 service workers
  persistent: false, // For MV2 (ignored in MV3)

  main() {
    // Background logic here
  },
});
```

### Content Scripts

**File:** `entrypoints/content.ts` or `entrypoints/{name}.content.ts`

```typescript
export default defineContentScript({
  matches: ['*://*.example.com/*'],
  runAt: 'document_end',
  world: 'ISOLATED', // or 'MAIN'

  main(ctx) {
    // Content script logic
    console.log('Content script loaded on:', window.location.href);

    // Clean up when script is invalidated
    ctx.onInvalidated(() => {
      console.log('Content script invalidated');
    });
  },
});
```

### Popup/Options Pages

**File:** `entrypoints/popup/index.html` or `entrypoints/options/index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>My Extension</title>
  </head>
  <body>
    <div id="app"></div>
    <script
      type="module"
      src="./main.ts"
    ></script>
  </body>
</html>
```

### Unlisted Entrypoints

For pages not referenced in manifest:

**File:** `entrypoints/welcome/index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Welcome</title>
    <!-- Unlisted page - not in manifest -->
    <meta
      name="manifest.exclude"
      content="['all']"
    />
  </head>
  <body>
    <h1>Welcome to My Extension!</h1>
  </body>
</html>
```

## Manifest Configuration

### Dynamic Manifest Generation

WXT generates manifest.json automatically from multiple sources:

1. Global options in `wxt.config.ts`
2. Entrypoint-specific options
3. WXT modules
4. Hooks

### Basic Configuration

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    name: 'My Extension',
    version: '1.0.0',
    description: 'A WXT-powered extension',

    // Permissions
    permissions: ['storage', 'activeTab'],

    // Host permissions
    host_permissions: ['*://*.example.com/*'],

    // Browser-specific settings
    action: {
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
  },
});
```

### Browser-Specific Configuration

```typescript
export default defineConfig({
  manifest: {
    // MV3 format (WXT converts for MV2 automatically)
    action: {
      default_popup: 'popup.html',
    },
  },

  // Target specific browsers
  browser: 'chrome', // or 'firefox', 'safari'

  // Development vs Production
  mode: 'development', // or 'production'
});
```

## Extension APIs

### Unified Browser API

WXT provides a unified `browser` API that works across browsers:

```typescript
// No import needed if auto-imports enabled
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  sendResponse({ received: true });
});

// Type-safe access
const tabs = await browser.tabs.query({ active: true, currentWindow: true });
```

### Storage API

```typescript
// Using WXT's built-in storage (recommended)
import { storage } from 'wxt/storage';

// Define storage items with defaults
const storageItems = {
  userPreferences: {
    defaultValue: { theme: 'light', notifications: true },
  },
  lastSync: {
    defaultValue: null,
  },
};

// Usage
const prefs = await storage.getItem('local:userPreferences');
await storage.setItem('local:lastSync', new Date().toISOString());
```

### Feature Detection

```typescript
// Check API availability at runtime
if (browser.sidebarAction) {
  // Sidebar API available
  await browser.sidebarAction.open();
} else {
  // Fallback for browsers without sidebar API
  console.log('Sidebar not supported');
}
```

## Frontend Framework Integration

### React Setup

```bash
# Install React template
pnpm dlx wxt@latest init my-react-extension --template react

# Or add to existing project
pnpm add react react-dom
```

### Vue Setup

```bash
# Install Vue template
pnpm dlx wxt@latest init my-vue-extension --template vue

# Or add to existing project
pnpm add vue @vitejs/plugin-vue
```

### Framework Configuration

```typescript
// wxt.config.ts
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  vite: {
    plugins: [vue()],
  },
});
```

## Development Workflow

### Auto-reload Setup

```typescript
// web-ext.config.ts
import { defineRunnerConfig } from 'wxt';

export default defineRunnerConfig({
  startUrls: ['https://example.com'],
  chromiumArgs: ['--auto-open-devtools-for-tabs'],
});
```

### Environment Variables

```bash
# .env
API_BASE_URL=https://api.example.com
FEATURE_FLAG_NEW_UI=true

# .env.publish
API_BASE_URL=https://api.production.com
```

Usage in code:

```typescript
const apiUrl = import.meta.env.API_BASE_URL;
const isNewUiEnabled = import.meta.env.FEATURE_FLAG_NEW_UI === 'true';
```

## Best Practices

### 1. Project Organization

- Use descriptive entrypoint names
- Keep related files in entrypoint directories
- Separate business logic from entrypoint code
- Use auto-imported utilities for common functions

### 2. Performance

- Minimize background script size
- Use content script CSS injection mode appropriately
- Implement proper cleanup in content scripts
- Lazy-load heavy dependencies

### 3. Cross-browser Compatibility

- Test on multiple browsers during development
- Use feature detection for browser-specific APIs
- Handle permission differences gracefully
- Validate manifest against browser requirements

### 4. Security

- Validate all inputs and messages
- Use secure storage for sensitive data
- Implement proper CSP headers
- Sanitize user-generated content

## Common Patterns

### Message Passing

```typescript
// Background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_DATA':
      // Handle request
      sendResponse({ data: 'response' });
      break;
  }
});

// Content script or popup
const response = await browser.runtime.sendMessage({ type: 'GET_DATA' });
```

### Storage Migration

```typescript
// Define storage schema with versioning
const storageSchema = {
  version: 2,
  migrations: {
    1: oldData => {
      // Migration from version 1 to 2
      return { ...oldData, newField: 'defaultValue' };
    },
  },
};
```

### Error Handling

```typescript
export default defineBackground(() => {
  try {
    // Extension initialization
    initializeExtension();
  } catch (error) {
    console.error('Extension initialization failed:', error);
    // Handle initialization errors gracefully
  }
});
```

## Resources

### Official Documentation

- [WXT Documentation](https://wxt.dev/)
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Firefox WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

### Community Resources

- [WXT GitHub Repository](https://github.com/wxt-dev/wxt)
- [Example Extensions](https://github.com/wxt-dev/wxt/tree/main/examples)
- [Community Discord](https://discord.gg/ZFsZ7GTQu2)

### Related Skills

- Frontend framework skills (Vue, React, Svelte)
- TypeScript configuration
- Browser extension development patterns
