#!/usr/bin/env node

/**
 * WXT Project Generator Script
 * Creates a new WXT project with specified configuration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class WXTProjectGenerator {
  constructor(projectName, options = {}) {
    this.projectName = projectName;
    this.options = {
      framework: 'vanilla', // vanilla, vue, react, svelte, solid
      typescript: true,
      directory: '.',
      packageManager: 'npm', // npm, yarn, pnpm, bun
      ...options,
    };

    this.projectPath = path.join(this.options.directory, projectName);
  }

  async generate() {
    console.log(`🚀 Creating new WXT project: ${this.projectName}`);

    try {
      // Create project directory
      this.createDirectory();

      // Initialize package.json
      this.initializePackage();

      // Install WXT
      await this.installWXT();

      // Create basic structure
      this.createBasicStructure();

      // Create configuration files
      this.createConfigFiles();

      // Create entrypoints
      this.createEntrypoints();

      // Create framework-specific files
      await this.createFrameworkFiles();

      // Run post-install
      this.runPostInstall();

      console.log('✅ Project created successfully!');
      this.printNextSteps();
    } catch (error) {
      console.error('❌ Project creation failed:', error.message);
      process.exit(1);
    }
  }

  createDirectory() {
    if (fs.existsSync(this.projectPath)) {
      throw new Error(`Directory ${this.projectName} already exists`);
    }

    fs.mkdirSync(this.projectPath, { recursive: true });
    process.chdir(this.projectPath);
  }

  initializePackage() {
    const packageJson = {
      name: this.projectName,
      version: '0.0.1',
      description: `A ${this.options.framework} web extension built with WXT`,
      scripts: {
        dev: 'wxt',
        'dev:firefox': 'wxt -b firefox',
        build: 'wxt build',
        'build:firefox': 'wxt build -b firefox',
        zip: 'wxt zip',
        'zip:firefox': 'wxt zip -b firefox',
        postinstall: 'wxt prepare',
      },
      keywords: ['web-extension', 'wxt', this.options.framework],
      author: '',
      license: 'MIT',
    };

    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
  }

  async installWXT() {
    console.log('📦 Installing WXT...');

    const packageManager = this.options.packageManager;
    const devFlag = packageManager === 'yarn' ? '--dev' : '-D';

    const installCommand = `${packageManager} install ${devFlag} wxt`;
    execSync(installCommand, { stdio: 'inherit' });

    // Install framework dependencies if needed
    if (this.options.framework !== 'vanilla') {
      await this.installFrameworkDependencies();
    }
  }

  async installFrameworkDependencies() {
    const frameworkPackages = {
      vue: ['vue', '@vitejs/plugin-vue'],
      react: ['react', 'react-dom', '@vitejs/plugin-react'],
      svelte: ['svelte', '@sveltejs/vite-plugin-svelte'],
      solid: ['solid-js', 'vite-plugin-solid'],
    };

    const packages = frameworkPackages[this.options.framework];
    if (packages) {
      console.log(`📦 Installing ${this.options.framework} dependencies...`);

      const packageManager = this.options.packageManager;
      const installCommand = `${packageManager} install ${packages.join(' ')}`;
      execSync(installCommand, { stdio: 'inherit' });
    }
  }

  createBasicStructure() {
    const dirs = ['entrypoints', 'public', 'assets'];

    if (this.options.framework !== 'vanilla') {
      dirs.push('components', 'utils');
    }

    dirs.forEach(dir => {
      fs.mkdirSync(dir, { recursive: true });
    });
  }

  createConfigFiles() {
    // Create wxt.config.ts
    const wxtConfig = this.generateWxtConfig();
    fs.writeFileSync('wxt.config.ts', wxtConfig);

    // Create tsconfig.json
    const tsConfig = this.generateTsConfig();
    fs.writeFileSync('tsconfig.json', tsConfig);

    // Create .gitignore
    const gitignore = this.generateGitignore();
    fs.writeFileSync('.gitignore', gitignore);

    // Create web-ext.config.ts for browser startup
    const webExtConfig = this.generateWebExtConfig();
    fs.writeFileSync('web-ext.config.ts', webExtConfig);
  }

  createEntrypoints() {
    // Create background script
    const backgroundContent = this.generateBackgroundScript();
    fs.writeFileSync('entrypoints/background.ts', backgroundContent);

    // Create popup
    fs.mkdirSync('entrypoints/popup', { recursive: true });

    const popupHtml = this.generatePopupHtml();
    fs.writeFileSync('entrypoints/popup/index.html', popupHtml);

    const popupMain = this.generatePopupMain();
    fs.writeFileSync('entrypoints/popup/main.ts', popupMain);
  }

  async createFrameworkFiles() {
    if (this.options.framework === 'vue') {
      await this.createVueFiles();
    } else if (this.options.framework === 'react') {
      await this.createReactFiles();
    }
    // Add other frameworks as needed
  }

  async createVueFiles() {
    // Update wxt.config.ts with Vue plugin
    const currentConfig = fs.readFileSync('wxt.config.ts', 'utf8');
    const updatedConfig = currentConfig
      .replace(
        'export default defineConfig({',
        `import vue from '@vitejs/plugin-vue';

export default defineConfig({`,
      )
      .replace(
        '});',
        `  vite: () => ({
    plugins: [vue()]
  })
});`,
      );
    fs.writeFileSync('wxt.config.ts', updatedConfig);

    // Create App.vue
    const appVue = `<template>
  <div class="app">
    <h1>{{ title }}</h1>
    <p>Vue-powered WXT extension</p>
    <button @click="handleClick">Click me!</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const title = ref('Hello WXT + Vue!');

const handleClick = () => {
  console.log('Button clicked!');
  title.value = 'Button was clicked!';
};
</script>

<style scoped>
.app {
  padding: 20px;
  font-family: Arial, sans-serif;
}

button {
  background: #007acc;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}

button:hover {
  background: #005a9e;
}
</style>`;

    fs.writeFileSync('entrypoints/popup/App.vue', appVue);

    // Update popup main.ts to use Vue
    const vueMain = `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');`;

    fs.writeFileSync('entrypoints/popup/main.ts', vueMain);
  }

  async createReactFiles() {
    // Update wxt.config.ts with React plugin
    const currentConfig = fs.readFileSync('wxt.config.ts', 'utf8');
    const updatedConfig = currentConfig
      .replace(
        'export default defineConfig({',
        `import react from '@vitejs/plugin-react';

export default defineConfig({`,
      )
      .replace(
        '});',
        `  vite: () => ({
    plugins: [react()]
  })
});`,
      );
    fs.writeFileSync('wxt.config.ts', updatedConfig);

    // Create App.tsx
    const appTsx = `import React, { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Hello WXT + React!</h1>
      <p>React-powered web extension</p>
      <button onClick={() => setCount(c => c + 1)}>
        Count is {count}
      </button>
    </div>
  );
}`;

    fs.writeFileSync('entrypoints/popup/App.tsx', appTsx);

    // Update popup main.ts to use React
    const reactMain = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

    fs.writeFileSync('entrypoints/popup/main.ts', reactMain);
  }

  runPostInstall() {
    console.log('🔧 Running post-install setup...');
    try {
      execSync(`${this.options.packageManager} run postinstall`, { stdio: 'inherit' });
    } catch (error) {
      console.warn('⚠️  Post-install failed, but continuing...');
    }
  }

  printNextSteps() {
    console.log('\n📋 Next steps:');
    console.log(`  cd ${this.projectName}`);
    console.log(`  ${this.options.packageManager} run dev`);
    console.log('\n📖 Documentation: https://wxt.dev');
  }

  // Template generation methods
  generateWxtConfig() {
    return `import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: '${this.projectName}',
    version: '0.0.1',
    description: 'A ${this.options.framework} web extension built with WXT',
  },
});
`;
  }

  generateTsConfig() {
    return `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": [
    "entrypoints/**/*",
    "wxt.config.ts"
  ]
}
`;
  }

  generateGitignore() {
    return `# Build outputs
.output/
.wxt/

# Dependencies
node_modules/

# Environment files
.env
.env.local
.env.publish
.env.publish.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
`;
  }

  generateWebExtConfig() {
    return `import { defineRunnerConfig } from 'wxt';

export default defineRunnerConfig({
  startUrls: ['https://www.google.com'],
});
`;
  }

  generateBackgroundScript() {
    return `export default defineBackground(() => {
  console.log('Background script loaded!');
  
  browser.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed:', details.reason);
  });
});
`;
  }

  generatePopupHtml() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${this.projectName}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`;
  }

  generatePopupMain() {
    if (this.options.framework === 'vanilla') {
      return `document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = \`
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        <h1>Hello WXT!</h1>
        <p>Vanilla JavaScript web extension</p>
        <button id="action-btn">Click me!</button>
      </div>
    \`;
    
    const button = document.getElementById('action-btn');
    button?.addEventListener('click', () => {
      console.log('Button clicked!');
      alert('Hello from your WXT extension!');
    });
  }
});
`;
    }
    return `// Framework-specific main file will be generated`;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node generate-wxt-project.js <project-name> [options]');
    console.error('Options:');
    console.error('  --framework <vue|react|svelte|solid|vanilla>  (default: vanilla)');
    console.error('  --pm <npm|yarn|pnpm|bun>                      (default: npm)');
    process.exit(1);
  }

  const projectName = args[0];
  const options = {};

  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--framework':
        options.framework = value;
        break;
      case '--pm':
        options.packageManager = value;
        break;
    }
  }

  const generator = new WXTProjectGenerator(projectName, options);
  generator.generate();
}

module.exports = WXTProjectGenerator;
