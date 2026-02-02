#!/usr/bin/env node

/**
 * WXT Manifest Validator
 * Validates WXT configuration and manifest generation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class WXTManifestValidator {
  constructor(projectPath = '.') {
    this.projectPath = path.resolve(projectPath);
    this.errors = [];
    this.warnings = [];
  }

  async validate() {
    console.log('🔍 Validating WXT project configuration...');

    try {
      // Check project structure
      this.validateProjectStructure();

      // Check configuration files
      this.validateConfigFiles();

      // Check entrypoints
      this.validateEntrypoints();

      // Check package.json
      this.validatePackageJson();

      // Try to build manifest
      await this.validateManifestGeneration();

      // Report results
      this.reportResults();
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  }

  validateProjectStructure() {
    console.log('  Checking project structure...');

    const requiredFiles = ['package.json', 'wxt.config.ts'];
    const requiredDirs = ['entrypoints'];

    requiredFiles.forEach(file => {
      if (!fs.existsSync(path.join(this.projectPath, file))) {
        this.errors.push(`Missing required file: ${file}`);
      }
    });

    requiredDirs.forEach(dir => {
      if (!fs.existsSync(path.join(this.projectPath, dir))) {
        this.errors.push(`Missing required directory: ${dir}`);
      }
    });

    // Check for common files
    const commonFiles = ['tsconfig.json', '.gitignore', 'web-ext.config.ts'];
    commonFiles.forEach(file => {
      if (!fs.existsSync(path.join(this.projectPath, file))) {
        this.warnings.push(`Recommended file missing: ${file}`);
      }
    });
  }

  validateConfigFiles() {
    console.log('  Checking configuration files...');

    // Validate wxt.config.ts
    const wxtConfigPath = path.join(this.projectPath, 'wxt.config.ts');
    if (fs.existsSync(wxtConfigPath)) {
      const configContent = fs.readFileSync(wxtConfigPath, 'utf8');

      // Check for required exports
      if (!configContent.includes('export default defineConfig')) {
        this.errors.push('wxt.config.ts must export default using defineConfig');
      }

      // Check for common configuration issues
      if (configContent.includes('manifest_version: 2') && !configContent.includes('manifest_version: 3')) {
        this.warnings.push('Consider upgrading to Manifest V3');
      }
    }

    // Validate tsconfig.json
    const tsConfigPath = path.join(this.projectPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      try {
        const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));

        // Check required compiler options
        const requiredOptions = ['target', 'module', 'moduleResolution'];
        requiredOptions.forEach(option => {
          if (!tsConfig.compilerOptions?.[option]) {
            this.warnings.push(`tsconfig.json missing compiler option: ${option}`);
          }
        });
      } catch (error) {
        this.errors.push('tsconfig.json is not valid JSON');
      }
    }
  }

  validateEntrypoints() {
    console.log('  Checking entrypoints...');

    const entrypointsDir = path.join(this.projectPath, 'entrypoints');
    if (!fs.existsSync(entrypointsDir)) return;

    const entrypoints = fs.readdirSync(entrypointsDir);
    let hasBackground = false;
    let hasContentScript = false;

    entrypoints.forEach(entrypoint => {
      const fullPath = path.join(entrypointsDir, entrypoint);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Check directory entrypoints
        const indexPath = path.join(fullPath, 'index.ts');
        const indexJsPath = path.join(fullPath, 'index.js');

        if (fs.existsSync(indexPath) || fs.existsSync(indexJsPath)) {
          if (entrypoint === 'background') hasBackground = true;
          if (entrypoint.includes('content')) hasContentScript = true;
        } else {
          this.warnings.push(`Entrypoint directory missing index file: ${entrypoint}`);
        }
      } else if (stat.isFile()) {
        // Check file entrypoints
        if (entrypoint === 'background.ts' || entrypoint === 'background.js') {
          hasBackground = true;
        }
        if (entrypoint.includes('content')) {
          hasContentScript = true;
        }

        // Check file extensions
        const validExtensions = ['.ts', '.js', '.tsx', '.jsx', '.html'];
        const ext = path.extname(entrypoint);
        if (!validExtensions.includes(ext)) {
          this.warnings.push(`Entrypoint has unusual extension: ${entrypoint}`);
        }
      }
    });

    if (!hasBackground) {
      this.warnings.push('No background script found - extension may have limited functionality');
    }

    // Check for HTML entrypoints structure
    entrypoints
      .filter(e => e.endsWith('.html') || fs.statSync(path.join(entrypointsDir, e)).isDirectory())
      .forEach(entrypoint => {
        const dirPath = path.join(entrypointsDir, entrypoint.replace('.html', ''));
        if (fs.statSync(dirPath).isDirectory()) {
          const hasJs = fs.readdirSync(dirPath).some(f => f.endsWith('.js') || f.endsWith('.ts'));
          if (!hasJs) {
            this.warnings.push(`HTML entrypoint ${entrypoint} missing JavaScript file`);
          }
        }
      });
  }

  validatePackageJson() {
    console.log('  Checking package.json...');

    const packagePath = path.join(this.projectPath, 'package.json');
    if (!fs.existsSync(packagePath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

      // Check required scripts
      const requiredScripts = ['dev', 'build', 'zip'];
      requiredScripts.forEach(script => {
        if (!pkg.scripts?.[script]) {
          this.warnings.push(`Missing required script: ${script}`);
        }
      });

      // Check for WXT dependency
      if (!pkg.devDependencies?.wxt && !pkg.dependencies?.wxt) {
        this.errors.push('Missing WXT dependency in package.json');
      }

      // Check for postinstall script
      if (!pkg.scripts?.postinstall?.includes('wxt prepare')) {
        this.warnings.push('Missing "wxt prepare" in postinstall script');
      }
    } catch (error) {
      this.errors.push('package.json is not valid JSON');
    }
  }

  async validateManifestGeneration() {
    console.log('  Checking manifest generation...');

    try {
      // Try to run wxt prepare to generate .wxt directory
      process.chdir(this.projectPath);

      // Check if wxt is installed
      try {
        execSync('npx wxt --version', { stdio: 'pipe' });
      } catch {
        this.warnings.push('WXT not installed or not in PATH');
        return;
      }

      // Run prepare command
      execSync('npx wxt prepare', { stdio: 'pipe' });

      // Check if .wxt directory was created
      if (!fs.existsSync(path.join(this.projectPath, '.wxt'))) {
        this.errors.push('Failed to generate .wxt directory');
      }

      // Check if tsconfig.json was generated
      if (!fs.existsSync(path.join(this.projectPath, '.wxt', 'tsconfig.json'))) {
        this.errors.push('Failed to generate WXT TypeScript configuration');
      }
    } catch (error) {
      this.errors.push(`Manifest generation failed: ${error.message}`);
    }
  }

  reportResults() {
    console.log('\n📋 Validation Results:');

    if (this.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.errors.forEach(error => console.log(`  • ${error}`));
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warning => console.log(`  • ${warning}`));
    }

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('\n✅ All validations passed!');
    } else if (this.errors.length === 0) {
      console.log('\n✅ No errors found (warnings only)');
    }

    console.log('\n📊 Summary:');
    console.log(`  Errors: ${this.errors.length}`);
    console.log(`  Warnings: ${this.warnings.length}`);

    if (this.errors.length > 0) {
      process.exit(1);
    }
  }
}

// CLI interface
if (require.main === module) {
  const projectPath = process.argv[2] || '.';
  const validator = new WXTManifestValidator(projectPath);
  validator.validate();
}

module.exports = WXTManifestValidator;
