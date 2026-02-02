#!/usr/bin/env node

/**
 * WXT Migration Helper
 * Helps migrate existing web extensions to WXT framework
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class WXTMigrationHelper {
  constructor(sourcePath, targetPath) {
    this.sourcePath = path.resolve(sourcePath);
    this.targetPath = path.resolve(targetPath || sourcePath + '-wxt');
    this.migrationReport = {
      filesMoved: [],
      filesModified: [],
      filesSkipped: [],
      issuesFound: [],
      recommendations: [],
    };
  }

  async migrate() {
    console.log(`🔄 Migrating extension from ${this.sourcePath} to WXT structure...`);

    try {
      // Analyze existing extension
      await this.analyzeExtension();

      // Create new WXT project structure
      this.createWXTStructure();

      // Migrate files
      this.migrateFiles();

      // Generate WXT configuration
      this.generateWXTConfig();

      // Install dependencies
      await this.installDependencies();

      // Validate migration
      await this.validateMigration();

      // Generate report
      this.generateReport();
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }
  }

  async analyzeExtension() {
    console.log('  Analyzing existing extension...');

    // Check for manifest.json
    const manifestPath = path.join(this.sourcePath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('No manifest.json found in source directory');
    }

    this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Analyze manifest version
    this.manifestVersion = this.manifest.manifest_version || 2;
    console.log(`  Found Manifest V${this.manifestVersion} extension`);

    // Analyze entrypoints
    this.analyzeEntrypoints();

    // Analyze assets
    this.analyzeAssets();

    // Check for build tools
    this.analyzeBuildTools();
  }

  analyzeEntrypoints() {
    this.entrypoints = {
      background: null,
      contentScripts: [],
      popup: null,
      options: null,
      devtools: null,
      overridePages: [],
    };

    // Background script
    if (this.manifest.background) {
      const background = this.manifest.background;
      if (background.service_worker) {
        this.entrypoints.background = background.service_worker;
      } else if (background.scripts && background.scripts.length > 0) {
        this.entrypoints.background = background.scripts[0];
      }
    }

    // Content scripts
    if (this.manifest.content_scripts) {
      this.entrypoints.contentScripts = this.manifest.content_scripts.map(cs => ({
        matches: cs.matches,
        js: cs.js || [],
        css: cs.css || [],
        run_at: cs.run_at,
        all_frames: cs.all_frames,
      }));
    }

    // Popup
    const action = this.manifest.action || this.manifest.browser_action || this.manifest.page_action;
    if (action && action.default_popup) {
      this.entrypoints.popup = action.default_popup;
    }

    // Options page
    if (this.manifest.options_page) {
      this.entrypoints.options = this.manifest.options_page;
    } else if (this.manifest.options_ui && this.manifest.options_ui.page) {
      this.entrypoints.options = this.manifest.options_ui.page;
    }

    // Devtools
    if (this.manifest.devtools_page) {
      this.entrypoints.devtools = this.manifest.devtools_page;
    }

    // Override pages
    if (this.manifest.chrome_url_overrides) {
      Object.keys(this.manifest.chrome_url_overrides).forEach(page => {
        this.entrypoints.overridePages.push({
          type: page,
          file: this.manifest.chrome_url_overrides[page],
        });
      });
    }
  }

  analyzeAssets() {
    this.assets = [];
    const commonAssetDirs = ['icons', 'images', 'assets', '_locales'];

    commonAssetDirs.forEach(dir => {
      const dirPath = path.join(this.sourcePath, dir);
      if (fs.existsSync(dirPath)) {
        this.assets.push(dir);
      }
    });

    // Find individual asset files
    const files = fs.readdirSync(this.sourcePath);
    const assetExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.ico'];

    files.forEach(file => {
      if (assetExtensions.some(ext => file.endsWith(ext))) {
        this.assets.push(file);
      }
    });
  }

  analyzeBuildTools() {
    this.buildTools = [];

    if (fs.existsSync(path.join(this.sourcePath, 'webpack.config.js'))) {
      this.buildTools.push('webpack');
    }
    if (
      fs.existsSync(path.join(this.sourcePath, 'vite.config.js')) ||
      fs.existsSync(path.join(this.sourcePath, 'vite.config.ts'))
    ) {
      this.buildTools.push('vite');
    }
    if (fs.existsSync(path.join(this.sourcePath, 'rollup.config.js'))) {
      this.buildTools.push('rollup');
    }

    // Check for package managers
    if (fs.existsSync(path.join(this.sourcePath, 'package.json'))) {
      this.hasPackageJson = true;
    }
  }

  createWXTStructure() {
    console.log('  Creating WXT project structure...');

    // Create target directory
    if (fs.existsSync(this.targetPath)) {
      throw new Error(`Target directory ${this.targetPath} already exists`);
    }

    fs.mkdirSync(this.targetPath, { recursive: true });

    // Create WXT directory structure
    const dirs = ['entrypoints', 'public', 'assets'];

    dirs.forEach(dir => {
      fs.mkdirSync(path.join(this.targetPath, dir), { recursive: true });
    });

    // Create asset directories
    this.assets.forEach(asset => {
      const sourceAssetPath = path.join(this.sourcePath, asset);
      const targetAssetPath = path.join(this.targetPath, 'public', asset);

      if (fs.statSync(sourceAssetPath).isDirectory()) {
        fs.mkdirSync(targetAssetPath, { recursive: true });
      }
    });
  }

  migrateFiles() {
    console.log('  Migrating files...');

    // Copy assets
    this.copyAssets();

    // Migrate entrypoints
    this.migrateEntrypoints();

    // Copy other files
    this.copyOtherFiles();
  }

  copyAssets() {
    this.assets.forEach(asset => {
      const sourcePath = path.join(this.sourcePath, asset);
      const targetPath = path.join(this.targetPath, 'public', asset);

      try {
        this.copyRecursiveSync(sourcePath, targetPath);
        this.migrationReport.filesMoved.push(`Assets: ${asset}`);
      } catch (error) {
        this.migrationReport.issuesFound.push(`Failed to copy assets ${asset}: ${error.message}`);
      }
    });
  }

  migrateEntrypoints() {
    // Migrate background script
    if (this.entrypoints.background) {
      this.migrateBackgroundScript();
    }

    // Migrate content scripts
    this.entrypoints.contentScripts.forEach((cs, index) => {
      this.migrateContentScript(cs, index);
    });

    // Migrate popup
    if (this.entrypoints.popup) {
      this.migratePopup();
    }

    // Migrate options
    if (this.entrypoints.options) {
      this.migrateOptions();
    }

    // Migrate devtools
    if (this.entrypoints.devtools) {
      this.migrateDevtools();
    }

    // Migrate override pages
    this.entrypoints.overridePages.forEach(override => {
      this.migrateOverridePage(override);
    });
  }

  migrateBackgroundScript() {
    const sourcePath = path.join(this.sourcePath, this.entrypoints.background);
    const targetDir = path.join(this.targetPath, 'entrypoints', 'background');
    const targetPath = path.join(targetDir, 'index.ts');

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      if (fs.existsSync(sourcePath)) {
        let content = fs.readFileSync(sourcePath, 'utf8');

        // Convert to WXT format
        content = this.convertToWXTBackground(content);

        fs.writeFileSync(targetPath, content);
        this.migrationReport.filesModified.push(
          `Background: ${this.entrypoints.background} → entrypoints/background/index.ts`,
        );
      } else {
        // Create basic background script
        const basicBackground = `export default defineBackground(() => {
  console.log('Extension loaded');
  
  // Add your background script logic here
});
`;
        fs.writeFileSync(targetPath, basicBackground);
        this.migrationReport.filesModified.push('Background: Created new WXT background script');
      }
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to migrate background script: ${error.message}`);
    }
  }

  migrateContentScript(cs, index) {
    const name = cs.js && cs.js.length > 0 ? path.basename(cs.js[0], path.extname(cs.js[0])) : `content-${index}`;
    const targetDir = path.join(this.targetPath, 'entrypoints', `${name}.content`);
    const targetPath = path.join(targetDir, 'index.ts');

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      // Create WXT content script
      const contentScript = `export default defineContentScript({
  matches: ${JSON.stringify(cs.matches)},
  ${cs.run_at ? `runAt: '${cs.run_at.replace('document_', '')}',` : ''}
  ${cs.all_frames ? `allFrames: ${cs.all_frames},` : ''}
  
  main(ctx) {
    console.log('Content script loaded');
    
    // Add your content script logic here
    
    ctx.onInvalidated(() => {
      console.log('Content script cleaned up');
    });
  }
});
`;

      fs.writeFileSync(targetPath, contentScript);
      this.migrationReport.filesModified.push(`Content Script: ${name} (configured from manifest)`);
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to create content script ${name}: ${error.message}`);
    }
  }

  migratePopup() {
    const targetDir = path.join(this.targetPath, 'entrypoints', 'popup');
    fs.mkdirSync(targetDir, { recursive: true });

    // Create basic popup structure
    const popupHtml = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.manifest.name || 'Extension Popup'}</title>
</head>
<body>
  <div id="app">
    <h1>${this.manifest.name || 'Extension'}</h1>
    <p>Popup content goes here</p>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`;

    const popupMain = `document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded');
  // Add your popup logic here
});
`;

    try {
      fs.writeFileSync(path.join(targetDir, 'index.html'), popupHtml);
      fs.writeFileSync(path.join(targetDir, 'main.ts'), popupMain);
      this.migrationReport.filesModified.push('Popup: Created basic WXT popup structure');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to create popup: ${error.message}`);
    }
  }

  migrateOptions() {
    const targetDir = path.join(this.targetPath, 'entrypoints', 'options');
    fs.mkdirSync(targetDir, { recursive: true });

    // Create basic options structure
    const optionsHtml = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extension Options</title>
</head>
<body>
  <div id="app">
    <h1>Extension Settings</h1>
    <form id="settings-form">
      <!-- Add your options here -->
      <button type="submit">Save Settings</button>
    </form>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`;

    const optionsMain = `import { storage } from 'wxt/storage';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form') as HTMLFormElement;
  
  // Load current settings
  const settings = await storage.getItem('local:settings') || {};
  
  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Save settings logic
    console.log('Settings saved');
  });
});
`;

    try {
      fs.writeFileSync(path.join(targetDir, 'index.html'), optionsHtml);
      fs.writeFileSync(path.join(targetDir, 'main.ts'), optionsMain);
      this.migrationReport.filesModified.push('Options: Created basic WXT options structure');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to create options: ${error.message}`);
    }
  }

  migrateDevtools() {
    const targetDir = path.join(this.targetPath, 'entrypoints', 'devtools');
    fs.mkdirSync(targetDir, { recursive: true });

    const devtoolsHtml = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`;

    const devtoolsMain = `browser.devtools.panels.create(
  '${this.manifest.name || 'Extension'}',
  'icon/16.png',
  'devtools/panel.html'
).then((panel) => {
  console.log('Devtools panel created');
});
`;

    try {
      fs.writeFileSync(path.join(targetDir, 'index.html'), devtoolsHtml);
      fs.writeFileSync(path.join(targetDir, 'main.ts'), devtoolsMain);
      this.migrationReport.filesModified.push('Devtools: Created basic WXT devtools structure');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to create devtools: ${error.message}`);
    }
  }

  migrateOverridePage(override) {
    const targetDir = path.join(this.targetPath, 'entrypoints', override.type);
    fs.mkdirSync(targetDir, { recursive: true });

    const htmlContent = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${override.type.charAt(0).toUpperCase() + override.type.slice(1)} Override</title>
</head>
<body>
  <div id="app">
    <h1>${override.type} Page</h1>
    <p>This replaces the browser's ${override.type} page</p>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</body>
</html>
`;

    const mainContent = `document.addEventListener('DOMContentLoaded', () => {
  console.log('${override.type} override loaded');
  // Add your override page logic here
});
`;

    try {
      fs.writeFileSync(path.join(targetDir, 'index.html'), htmlContent);
      fs.writeFileSync(path.join(targetDir, 'main.ts'), mainContent);
      this.migrationReport.filesModified.push(`Override: ${override.type} page created`);
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to create ${override.type} override: ${error.message}`);
    }
  }

  copyOtherFiles() {
    const filesToCopy = ['README.md', 'LICENSE', '.gitignore'];

    filesToCopy.forEach(file => {
      const sourcePath = path.join(this.sourcePath, file);
      const targetPath = path.join(this.targetPath, file);

      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
          this.migrationReport.filesMoved.push(`File: ${file}`);
        } catch (error) {
          this.migrationReport.issuesFound.push(`Failed to copy ${file}: ${error.message}`);
        }
      }
    });
  }

  generateWXTConfig() {
    console.log('  Generating WXT configuration...');

    const config = `import { defineConfig } from 'wxt';

// Migrated from existing manifest.json
export default defineConfig({
  manifest: {
    name: ${JSON.stringify(this.manifest.name)},
    version: ${JSON.stringify(this.manifest.version)},
    description: ${JSON.stringify(this.manifest.description || '')},
    ${this.manifestVersion === 3 ? 'manifest_version: 3,' : ''}
    
    // Permissions
    ${this.manifest.permissions ? `permissions: ${JSON.stringify(this.manifest.permissions)},` : ''}
    
    // Host permissions
    ${this.manifest.host_permissions ? `host_permissions: ${JSON.stringify(this.manifest.host_permissions)},` : ''}
    ${this.manifest.permissions && this.manifest.permissions.includes('activeTab') ? '' : '// Consider adding "activeTab" permission if needed'}
  },
  
  // Build configuration
  build: {
    manifestVersion: '${this.manifestVersion}'
  }
});
`;

    try {
      fs.writeFileSync(path.join(this.targetPath, 'wxt.config.ts'), config);
      this.migrationReport.filesModified.push('Configuration: Generated wxt.config.ts');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to generate config: ${error.message}`);
    }

    // Generate package.json
    this.generatePackageJson();
  }

  generatePackageJson() {
    const packageJson = {
      name: this.manifest.name?.toLowerCase().replace(/\s+/g, '-') || 'web-extension',
      version: this.manifest.version || '1.0.0',
      description: this.manifest.description || 'A web extension built with WXT',
      scripts: {
        dev: 'wxt',
        'dev:firefox': 'wxt -b firefox',
        build: 'wxt build',
        'build:firefox': 'wxt build -b firefox',
        zip: 'wxt zip',
        'zip:firefox': 'wxt zip -b firefox',
        postinstall: 'wxt prepare',
      },
      devDependencies: {
        wxt: '^0.17.0',
      },
    };

    try {
      fs.writeFileSync(path.join(this.targetPath, 'package.json'), JSON.stringify(packageJson, null, 2));
      this.migrationReport.filesModified.push('Configuration: Generated package.json');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to generate package.json: ${error.message}`);
    }
  }

  async installDependencies() {
    console.log('  Installing dependencies...');

    try {
      process.chdir(this.targetPath);
      execSync('npm install', { stdio: 'inherit' });
      this.migrationReport.filesModified.push('Dependencies: Installed WXT and dependencies');
    } catch (error) {
      this.migrationReport.issuesFound.push(`Failed to install dependencies: ${error.message}`);
    }
  }

  async validateMigration() {
    console.log('  Validating migration...');

    try {
      // Run WXT prepare to validate configuration
      execSync('npx wxt prepare', { stdio: 'pipe' });

      // Check if essential files were created
      const essentialFiles = ['.wxt/tsconfig.json', 'entrypoints/background/index.ts'];

      essentialFiles.forEach(file => {
        if (!fs.existsSync(path.join(this.targetPath, file))) {
          this.migrationReport.issuesFound.push(`Essential file missing after migration: ${file}`);
        }
      });
    } catch (error) {
      this.migrationReport.issuesFound.push(`Migration validation failed: ${error.message}`);
    }
  }

  generateReport() {
    console.log('\n📋 Migration Report:');
    console.log(`\n📁 Source: ${this.sourcePath}`);
    console.log(`📁 Target: ${this.targetPath}`);

    if (this.migrationReport.filesMoved.length > 0) {
      console.log('\n✅ Files Moved:');
      this.migrationReport.filesMoved.forEach(file => console.log(`  • ${file}`));
    }

    if (this.migrationReport.filesModified.length > 0) {
      console.log('\n🔄 Files Modified/Generated:');
      this.migrationReport.filesModified.forEach(file => console.log(`  • ${file}`));
    }

    if (this.migrationReport.issuesFound.length > 0) {
      console.log('\n⚠️  Issues Found:');
      this.migrationReport.issuesFound.forEach(issue => console.log(`  • ${issue}`));
    }

    console.log('\n💡 Recommendations:');
    console.log('  • Review the generated wxt.config.ts and adjust as needed');
    console.log('  • Test the extension in development mode: npm run dev');
    console.log('  • Update any hardcoded paths in your JavaScript files');
    console.log("  • Consider using WXT's storage API instead of chrome.storage");

    console.log('\n🚀 Next Steps:');
    console.log('  cd ' + path.relative(process.cwd(), this.targetPath));
    console.log('  npm run dev');
  }

  // Utility methods
  copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();

    if (isDirectory) {
      fs.mkdirSync(dest, { recursive: true });
      fs.readdirSync(src).forEach(childItemName => {
        this.copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  convertToWXTBackground(content) {
    // Remove IIFE wrappers and self-executing functions
    content = content.replace(/^\(function\s*\([^)]*\)\s*{/, '');
    content = content.replace(/}\)\([^)]*\);?$/, '');

    // Convert chrome.* to browser.* (WXT handles this automatically)
    // content = content.replace(/chrome\./g, 'browser.');

    // Wrap in WXT background definition
    if (!content.includes('defineBackground')) {
      content = `export default defineBackground(() => {
${content.trim()}
});
`;
    }

    return content;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node migrate-to-wxt.js <source-path> [target-path]');
    process.exit(1);
  }

  const sourcePath = args[0];
  const targetPath = args[1];

  const migrator = new WXTMigrationHelper(sourcePath, targetPath);
  migrator.migrate();
}

module.exports = WXTMigrationHelper;
