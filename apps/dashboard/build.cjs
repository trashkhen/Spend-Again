'use strict';
/**
 * Custom Vite build script for apps/dashboard (CommonJS).
 *
 * Vite's CLI uses pathToFileURL which encodes '?' as '%3F', breaking
 * package resolution when the project directory contains a '?' character.
 * This script uses Vite's programmatic CJS API to bypass that issue entirely.
 */
const path = require('path');
const fs = require('fs');

function resolve(pkgPath) {
  try {
    return require.resolve(pkgPath, { paths: [__dirname] });
  } catch {
    return undefined;
  }
}

function pkgDir(pkgName) {
  const main = resolve(path.join(pkgName, 'package.json'));
  return main ? path.dirname(main) : undefined;
}

/**
 * Rollup plugin that resolves relative imports using raw filesystem paths,
 * bypassing Rollup's internal file-URL conversion which URL-encodes '?' to '%3F'.
 */
function localResolverPlugin(srcDir) {
  const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
  return {
    name: 'local-fs-resolver',
    resolveId(importee, importer) {
      if (!importee.startsWith('.') || !importer) return null;
      // Decode URL-encoded importer path that Rollup may pass in
      const importerPath = decodeURIComponent(importer.replace(/^file:\/\//, ''));
      const base = path.dirname(importerPath);
      // Try each extension
      for (const ext of EXTENSIONS) {
        const candidate = path.resolve(base, importee + ext);
        if (fs.existsSync(candidate)) return candidate;
      }
      // Try index files
      for (const ext of EXTENSIONS) {
        const candidate = path.resolve(base, importee, 'index' + ext);
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

async function main() {
  const vite = require(path.join(__dirname, 'node_modules', 'vite', 'index.cjs'));
  const react = require(
    path.join(__dirname, 'node_modules', '@vitejs', 'plugin-react', 'dist', 'index.cjs'),
  );

  // Pre-resolve all react imports to absolute FS paths so that Rollup never
  // needs to walk up from the '?'-containing project root.
  const reactDir = pkgDir('react');
  const reactDomDir = pkgDir('react-dom');
  const schedulerDir = pkgDir('scheduler');
  const reactRouterDomDir = pkgDir('react-router-dom');
  const rechartsDir = pkgDir('recharts');

  if (!reactDir || !reactDomDir) {
    throw new Error('Could not resolve react or react-dom');
  }

  /** @type {Record<string, string>} */
  const alias = {
    'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
    'react': path.join(reactDir, 'index.js'),
    'react-dom/client': path.join(reactDomDir, 'client.js'),
    'react-dom': path.join(reactDomDir, 'index.js'),
  };
  if (schedulerDir) {
    alias['scheduler'] = path.join(schedulerDir, 'index.js');
  }
  if (reactRouterDomDir) {
    alias['react-router-dom'] = path.join(reactRouterDomDir, 'dist', 'index.mjs');
  }
  if (rechartsDir) {
    alias['recharts'] = path.join(rechartsDir, 'es6', 'index.js');
  }

  const srcDir = path.join(__dirname, 'src');

  await vite.build({
    root: __dirname,
    plugins: [localResolverPlugin(srcDir), react.default()],
    resolve: {
      alias,
    },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
