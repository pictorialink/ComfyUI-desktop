/// <reference types="vitest/config" />
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';

import { viteElectronAppPlugin } from './infrastructure/viteElectronAppPlugin';
import { version } from './package.json';
import { external, getBuildConfig } from './vite.base.config';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const config: UserConfig = {
    build: {
      outDir: '.vite/build',
      lib: {
        entry: './src/main.ts',
        fileName: (_format, name) => `${name}.cjs`,
        formats: ['cjs'],
      },
      rollupOptions: { external },
      sourcemap: true,
      minify: true,
    },
    server: {
      watch: {
        ignored: ['**/assets/ComfyUI/**', 'venv/**'],
      },
    },
    plugins: [
      // Custom hot reload solution for vite 6
      viteElectronAppPlugin(),
      process.env.NODE_ENV === 'production'
        ? sentryVitePlugin({
            org: 'comfy-org',
            project: 'desktop',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: {
              name: `ComfyUI@${version}`,
            },
          })
        : undefined,
    ],
    define: {
      VITE_NAME: JSON.stringify('COMFY'),
      'process.env.PUBLISH': `"${process.env.PUBLISH || ''}"`,
      'process.env.GH_API_TOKEN': `"${process.env.GH_API_TOKEN || ''}"`,
      'process.env.NODE_ENV': `"${process.env.NODE_ENV || 'development'}"`,
      __GH_API_TOKEN__: `"${process.env.GH_API_TOKEN || ''}"`,
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    test: {
      name: 'main',
      include: ['tests/unit/**/*.test.ts'],
      setupFiles: ['./tests/unit/setup.ts'],
      restoreMocks: true,
      unstubGlobals: true,
    },
  };

  return mergeConfig(getBuildConfig(env), config);
});
