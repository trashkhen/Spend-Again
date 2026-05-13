---
name: pnpm Setup on this Machine
description: pnpm v11.1.1 is available via corepack at /usr/local/lib/node_modules/corepack/shims/pnpm; a wrapper was created at /usr/local/bin/pnpm
type: project
---

## pnpm Binary Location

pnpm is not installed as a first-class binary on this machine. It is managed by corepack:
- Corepack shim: `/usr/local/lib/node_modules/corepack/shims/pnpm`
- Wrapper script created at `/usr/local/bin/pnpm` (executes corepack shim)
- Version: 11.1.1

## pnpm-workspace.yaml

Uses `onlyBuiltDependencies: [esbuild]` to allow esbuild's native binary build script without triggering pnpm v11's security prompt for unknown build scripts.

## Running pnpm

Use `pnpm <command>` directly — the wrapper at `/usr/local/bin/pnpm` makes it available in PATH.

**Why:** pnpm v11 changed security model requiring explicit opt-in for packages that run build scripts. esbuild is a safe exception needed for Vite, tsx, and turbo.
**How to apply:** If new packages trigger `ERR_PNPM_IGNORED_BUILDS`, add them to `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
