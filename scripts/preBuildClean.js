import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

/**
 * 构建前清理，保护原生模块
 */
async function preBuildClean() {
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

  console.log('开始构建前清理...');

  // 只清理最安全的文件类型
  const safeToDeletePatterns = [
    '**/*.md',
    '**/README*',
    '**/LICENSE*',
    '**/CHANGELOG*',
    '**/HISTORY*',
    '**/AUTHORS*',
    '**/CONTRIBUTORS*',
    '**/.DS_Store',
    '**/.git/**',
    '**/.github/**',
    '**/coverage/**',
    '**/*.log',
    '**/docs/**',
    '**/examples/**',
    '**/sample/**',
    '**/samples/**',
  ];

  // 绝对不能删除的关键模块和文件
  const criticalModules = [
    'node-pty',
    '@electron/rebuild',
    'electron',
    'node-gyp',
    '@opentelemetry',
    '@sentry',
    '@firebase',
    '@grpc',
  ];

  const criticalFilePatterns = [
    '**/*.node',
    '**/build/**',
    '**/lib/**',
    '**/dist/**',
    '**/bin/**',
    '**/*.js',
    '**/*.json',
    '**/*.ts',
  ];

  let deletedCount = 0;

  try {
    await walkDirectory(nodeModulesPath, async (filePath) => {
      const relativePath = path.relative(nodeModulesPath, filePath);

      // 检查是否是关键模块
      const isCriticalModule = criticalModules.some(
        (module) => relativePath.startsWith(module + '/') || relativePath === module
      );

      if (isCriticalModule) {
        return; // 跳过关键模块
      }

      // 检查是否是关键文件
      const isCriticalFile = criticalFilePatterns.some((pattern) => matchPattern(relativePath, pattern));

      if (isCriticalFile) {
        return; // 跳过关键文件
      }

      // 只删除安全的文件
      for (const pattern of safeToDeletePatterns) {
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

    console.log(`构建前清理完成，删除了 ${deletedCount} 个文件/目录`);
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
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await callback(fullPath);
        // 检查目录是否仍然存在再递归
        if (
          await fs
            .access(fullPath)
            .then(() => true)
            .catch(() => false)
        ) {
          await walkDirectory(fullPath, callback);
        }
      } else {
        await callback(fullPath);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // 如果目录不存在，静默忽略
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
  await preBuildClean();
}
