# WXT Configuration Reference

## wxt.config.ts Options

### Core Configuration

```typescript
export default defineConfig({
  // Project structure
  srcDir: 'src', // Source directory
  outDir: '.output', // Output directory
  publicDir: 'public', // Static assets directory
  entrypointsDir: 'entrypoints', // Entrypoints directory
  modulesDir: 'modules', // Local modules directory

  // Extension metadata
  manifest: {
    name: '__MSG_extensionName__', // Supports i18n
    version: '1.0.0',
    description: '__MSG_extensionDescription__',

    // Permissions and host permissions
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['*://*/*'], // Use carefully in production

    // Action configuration (unified for popup)
    action: {
      default_popup: 'popup.html',
      default_title: 'My Extension',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },

    // Browser override pages
    chrome_url_overrides: {
      newtab: 'newtab.html',
      bookmarks: 'bookmarks.html',
      history: 'history.html',
    },

    // Content security policy
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },

  // Build configuration
  build: {
    manifestVersion: '3', // or '2'
    browser: 'chrome', // Target browser
    mode: 'development', // or 'production'

    // Output customization
    zip: {
      name: 'my-extension-{version}-{browser}.zip',
      sourcesTemplate: 'sources-{version}.zip',
    },
  },

  // Development configuration
  dev: {
    server: {
      port: 3000,
      strictPort: false,
    },
    reloadCommand: 'Alt+R', // Hot reload shortcut
  },

  // Vite configuration
  vite: () => ({
    plugins: [
      // Add framework plugins here
    ],
    build: {
      rollupOptions: {
        external: ['some-external-dependency'],
      },
    },
    define: {
      __VERSION__: JSON.stringify('1.0.0'),
    },
  }),

  // Hooks
  hooks: {
    'build:manifestGenerated': manifest => {
      // Modify generated manifest
      manifest.minimum_chrome_version = '92';
    },
    'build:done': () => {
      // Post-build actions
      console.log('Build completed!');
    },
  },
});
```

## Runtime Configuration (app.config.ts)

```typescript
export default defineAppConfig({
  // Application settings
  theme: 'light',
  language: 'en',
  features: {
    analytics: true,
    notifications: false,
  },

  // Environment-specific settings
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://api.example.com',
    timeout: 5000,
  },
});

// Usage in components
const config = useAppConfig();
console.log(config.theme); // 'light'
```

## Browser Startup Configuration (web-ext.config.ts)

```typescript
import { defineRunnerConfig } from 'wxt';

export default defineRunnerConfig({
  // Browser startup options
  startUrls: ['https://example.com', 'https://developer.chrome.com'],

  // Chromium-specific arguments
  chromiumArgs: [
    '--auto-open-devtools-for-tabs',
    '--disable-web-security', // Development only!
  ],

  // Firefox-specific arguments
  firefoxArgs: ['--devtools'],

  // Profile management
  profile: {
    name: 'wxt-dev',
    keepChanges: true, // Keep profile between runs
  },
});
```

## Environment Variables

### File Structure

```
.env                    # Development variables
.env.local              # Local development (gitignored)
.env.publish            # Production build variables
.env.publish.local      # Local production (gitignored)
```

### Variable Usage

```typescript
// In any file
const apiUrl = import.meta.env.API_URL;
const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;

// Type-safe access
interface ImportMetaEnv {
  readonly API_URL: string;
  readonly ENABLE_FEATURE_X: string; // 'true' or 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### Common Environment Variables

```bash
# Development
NODE_ENV=development
WXT_MODE=development
WXT_BROWSER=chrome

# Build
NODE_ENV=production
WXT_MODE=production

# Custom variables
API_BASE_URL=https://api.example.com
FEATURE_FLAG_NEW_UI=true
ANALYTICS_ID=UA-XXXXXXXXX-X
```

## Manifest Configuration Patterns

### Cross-browser Manifest

```typescript
export default defineConfig({
  manifest: {
    // Base manifest (MV3 format)
    name: 'Cross-browser Extension',
    version: '1.0.0',
    manifest_version: 3,

    // Browser-specific overrides
    browser_specific_settings: {
      gecko: {
        id: 'extension@example.com',
        strict_min_version: '109.0',
      },
    },

    // Permissions that work across browsers
    permissions: ['storage', 'activeTab'],

    // Host permissions with fallbacks
    host_permissions:
      process.env.NODE_ENV === 'development'
        ? ['*://*/*'] // Development: all hosts
        : ['*://specific-site.com/*'], // Production: specific hosts
  },
});
```

### MV2/MV3 Compatibility

```typescript
export default defineConfig({
  manifest: {
    // MV3 format (WXT handles MV2 conversion)
    action: {
      default_popup: 'popup.html',
    },

    // MV2 equivalent will be generated automatically:
    // browser_action: { default_popup: 'popup.html' }
  },

  // Explicit version targeting
  build: {
    manifestVersion: process.env.TARGET_MV === '2' ? '2' : '3',
  },
});
```

### Internationalization (i18n)

```typescript
export default defineConfig({
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en'
  }
});

// _locales/en/messages.json
{
  "extensionName": {
    "message": "My Extension",
    "description": "Extension name"
  },
  "extensionDescription": {
    "message": "A powerful browser extension",
    "description": "Extension description"
  }
}
```

## Advanced Configuration Examples

### Multiple Entry Points Configuration

```typescript
export default defineConfig({
  entrypoints: {
    // Include/exclude specific entrypoints
    include: ['background', 'popup', 'content'],
    exclude: ['devtools'], // Exclude in production
  },

  manifest: {
    // Conditional manifest entries
    ...(process.env.NODE_ENV === 'development' && {
      permissions: ['management', 'debugger'],
    }),
  },
});
```

### Custom Build Hooks

```typescript
export default defineConfig({
  hooks: {
    // Pre-build hook
    'build:before': async () => {
      // Generate version info
      const version = await generateVersion();
      process.env.EXTENSION_VERSION = version;
    },

    // Post-manifest hook
    'build:manifestGenerated': manifest => {
      // Add build timestamp
      manifest.version_name = `${manifest.version} (${new Date().toISOString()})`;
    },

    // Post-build hook
    'build:done': buildOutput => {
      // Copy additional files
      copyAssets(buildOutput);
    },
  },
});
```

### Framework-specific Configurations

#### Vue Configuration

```typescript
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  vite: () => ({
    plugins: [vue()],
    vue: {
      template: {
        compilerOptions: {
          isCustomElement: tag => tag.startsWith('wxt-'),
        },
      },
    },
  }),
});
```

#### React Configuration

```typescript
import react from '@vitejs/plugin-react';

export default defineConfig({
  vite: () => ({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
  }),
});
```

#### Svelte Configuration

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  vite: () => ({
    plugins: [svelte()],
  }),
});
```

### Module Configuration

```typescript
// Local module example
// modules/my-module/index.ts
import { addViteConfig } from 'wxt/modules';

export default defineWxtModule({
  name: 'my-module',

  setup(wxt) {
    // Add Vite plugin
    addViteConfig(wxt, () => ({
      define: {
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      },
    }));

    // Modify manifest
    wxt.hooks.hook('build:manifestGenerated', manifest => {
      manifest.permissions.push('notifications');
    });
  },
});

// Usage in wxt.config.ts
export default defineConfig({
  modules: ['@wxt-dev/module-vue', './modules/my-module'],
});
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["chrome", "node"]
  },
  "include": ["src/**/*", "entrypoints/**/*", "wxt.config.ts", "app.config.ts"]
}
```

This configuration reference provides comprehensive guidance for all WXT configuration options, from basic setup to advanced customization patterns.
