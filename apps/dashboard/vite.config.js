// @ts-check
// Vite config: kept import-free to avoid resolution issues with special characters in project path.
// The React plugin is loaded via the build script (build.mjs) instead.
export default {
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
};
