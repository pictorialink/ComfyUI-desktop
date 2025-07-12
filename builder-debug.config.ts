import { Configuration } from 'electron-builder';

const debugConfig: Configuration = {
  files: [
    'node_modules',
    'package.json',
    '.vite/**',
    // 排除不必要的文件
    '!node_modules/**/*.{md,txt,LICENSE,CHANGELOG,README}',
    '!node_modules/**/test/**',
    '!node_modules/**/tests/**',
    '!node_modules/**/*.d.ts',
    '!node_modules/**/*.map',
    '!node_modules/**/docs/**',
    '!node_modules/**/examples/**',
    '!node_modules/**/bench/**',
    '!node_modules/**/benchmark/**',
    '!**/.git/**',
    '!**/.github/**',
    '!**/coverage/**',
    '!**/*.log',
  ],
  extraResources: [
    { from: './assets/ComfyUI', to: 'ComfyUI' },
    { from: './assets/uv', to: 'uv' },
    { from: './assets/UI', to: 'UI' },
  ],
  beforeBuild: './scripts/preMake.js',
  afterPack: './scripts/electronBuilderAfterPack.js',
  win: {
    icon: './assets/UI/Comfy_Logo.ico',
    target: 'zip',
    signtoolOptions: null,
  },
  mac: {
    icon: './assets/UI/Comfy_Logo.icns',
    target: 'dmg',
    identity: null,
  },
  linux: {
    icon: './assets/UI/Comfy_Logo_x256.png',
    target: 'appimage',
  },
  asarUnpack: ['**/node_modules/node-pty/**/*'],
  // 启用压缩
  compression: 'maximum',
  // 排除开发依赖
  buildDependenciesFromSource: false,
  // 禁用原生模块重建（已通过electron-rebuild处理）
  nodeGypRebuild: false,
  npmRebuild: false,
};

export default debugConfig;
