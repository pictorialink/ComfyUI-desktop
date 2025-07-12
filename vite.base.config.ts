import { builtinModules } from 'node:module';
import type { ConfigEnv, UserConfig } from 'vite';

import pkg from './package.json';

export const builtins = ['electron', ...builtinModules.flatMap((m) => [m, `node:${m}`])];

export const external = [
  ...builtins,
  ...Object.keys('dependencies' in pkg ? (pkg.dependencies as Record<string, unknown>) : {}),
  // 添加可能被清理但仍被引用的模块
  '@opentelemetry/api-logs',
  '@opentelemetry/instrumentation',
];

export function getBuildConfig(env: ConfigEnv): UserConfig {
  const { mode, command } = env;

  return {
    mode,
    build: {
      // Prevent multiple builds from interfering with each other.
      emptyOutDir: false,
      // 🚧 Multiple builds may conflict.
      outDir: '.vite/build',
      watch: command === 'serve' ? {} : null,
      minify: command === 'build',
    },
    clearScreen: false,

    define: {
      __COMFYUI_VERSION__: JSON.stringify(pkg.config.comfyUI.version),
      __COMFYUI_DESKTOP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },

    resolve: {
      alias: {
        '@': '/src',
      },
    },
  };
}
