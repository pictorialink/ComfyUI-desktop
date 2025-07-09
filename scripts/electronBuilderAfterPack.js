import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * @param {{ appOutDir: string, packager: { appInfo: { productFilename: string } } }} params
 */
export default async function afterPack({ appOutDir, packager }) {
  console.log('开始执行 electron-builder afterPack 优化...');

  try {
    if (os.platform() === 'darwin') {
      const appName = packager.appInfo.productFilename;
      const appPath = path.join(appOutDir, `${appName}.app`);
      const resourcePath = path.join(appPath, 'Contents', 'Resources');

      // 删除 Git 文件夹
      await removeGitFolders(resourcePath);

      // 删除其他平台的 UV 二进制文件
      await fs.rm(path.join(resourcePath, 'uv', 'win'), { recursive: true, force: true });
      await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });

      // 设置 macOS UV 二进制文件权限
      await fs.chmod(path.join(resourcePath, 'uv', 'macos', 'uv'), '755');
      await fs.chmod(path.join(resourcePath, 'uv', 'macos', 'uvx'), '755');

      console.log('macOS 平台优化完成');
    }

    if (os.platform() === 'win32') {
      const appName = packager.appInfo.productFilename;
      const appPath = path.join(appOutDir, `${appName}.exe`);
      const resourcePath = path.join(path.dirname(appPath), 'resources');

      // 删除 Git 文件夹
      await removeGitFolders(resourcePath);

      // 删除其他平台的 UV 二进制文件
      await fs.rm(path.join(resourcePath, 'uv', 'macos'), { recursive: true, force: true });
      await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });

      console.log('Windows 平台优化完成');
    }

    console.log('electron-builder afterPack 优化完成');
  } catch (error) {
    console.error('afterPack 优化过程中出现错误:', error);
  }
}

/**
 * @param {string} resourcePath
 */
async function removeGitFolders(resourcePath) {
  const gitPaths = [
    path.join(resourcePath, 'ComfyUI', '.git'),
    path.join(resourcePath, 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager', '.git'),
    path.join(resourcePath, 'ComfyUI', 'custom_nodes', 'DesktopSettingsExtension', '.git'),
  ];

  for (const gitPath of gitPaths) {
    await fs.rm(gitPath, { recursive: true, force: true });
  }
}
