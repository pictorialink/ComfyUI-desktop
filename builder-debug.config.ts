import { Configuration } from 'electron-builder';

const debugConfig: Configuration = {
  files: ['node_modules', 'package.json', '.vite/**'],
  extraResources: [
    { from: './assets/ComfyUI', to: 'ComfyUI' },
    { from: './assets/uv', to: 'uv' },
    { from: './assets/UI', to: 'UI' },
  ],
  beforeBuild: './scripts/preMake.js',
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
};

export default debugConfig;
