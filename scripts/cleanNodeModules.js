import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

/**
 * 清理node_modules中的不必要文件
 */
async function cleanNodeModules() {
  const nodeModulesPath = path.join(projectRoot, 'node_modules');

  if (
    !(await fs
      .access(nodeModulesPath)
      .then(() => true)
      .catch(() => false))
  ) {
    console.log('node_modules 目录不存在，跳过清理');
    return;
  }

  console.log('开始清理 node_modules...');

  // 要删除的文件模式
  const unnecessaryPatterns = [
    '**/*.md',
    '**/README*',
    '**/LICENSE*',
    '**/CHANGELOG*',
    '**/test/**',
    '**/tests/**',
    '**/docs/**',
    '**/examples/**',
    '**/bench/**',
    '**/benchmark/**',
    '**/*.d.ts',
    '**/*.map',
    '**/.git/**',
    '**/.github/**',
    '**/.DS_Store',
    '**/coverage/**',
    '**/*.log',
  ];

  // 要保护的关键模块（不进行清理）
  const protectedModules = ['node-pty', '@electron/rebuild', 'electron'];

  let deletedCount = 0;

  try {
    await walkDirectory(nodeModulesPath, async (filePath) => {
      const relativePath = path.relative(nodeModulesPath, filePath);

      // 检查是否是受保护的模块
      const isProtected = protectedModules.some(
        (module) => relativePath.startsWith(module + '/') || relativePath === module
      );

      if (isProtected) {
        return; // 跳过受保护的模块
      }

      for (const pattern of unnecessaryPatterns) {
        if (matchPattern(relativePath, pattern)) {
          try {
            await fs.rm(filePath, { recursive: true, force: true });
            deletedCount++;
            console.log(`已删除: ${relativePath}`);
          } catch (error) {
            console.warn(`删除失败: ${relativePath}`, error.message);
          }
          break;
        }
      }
    });

    console.log(`node_modules 清理完成，删除了 ${deletedCount} 个文件/目录`);
  } catch (error) {
    console.error('清理过程中出现错误:', error);
  }
}

/**
 * 递归遍历目录
 * @param {string} dir
 * @param {(filePath: string) => Promise<void>} callback
 */
async function walkDirectory(dir, callback) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await callback(fullPath);
      await walkDirectory(fullPath, callback);
    } else {
      await callback(fullPath);
    }
  }
}

/**
 * 简单的模式匹配
 * @param {string} str
 * @param {string} pattern
 * @returns {boolean}
 */
function matchPattern(str, pattern) {
  const regex = new RegExp(pattern.replaceAll('**', '.*').replaceAll('*', '[^/]*').replaceAll('?', '.'));
  return regex.test(str);
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  await cleanNodeModules();
}
