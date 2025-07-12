#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

try {
  // 尝试加载 .env 文件
  const envPath = path.resolve(projectRoot, '.env');
  let envContent = '';
  try {
    envContent = readFileSync(envPath, 'utf8');
  } catch {
    console.warn('⚠️  .env 文件未找到，将使用系统环境变量');
  }

  // 解析 .env 文件
  const envVars = {};
  if (envContent) {
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          envVars[key] = valueParts.join('=');
        }
      }
    }
  }

  // 合并环境变量
  const buildEnv = {
    ...process.env,
    ...envVars,
    NODE_ENV: 'production',
  };

  console.log('🔧 构建环境变量:');
  console.log('- NODE_ENV:', buildEnv.NODE_ENV);
  console.log('- GH_API_TOKEN:', buildEnv.GH_API_TOKEN ? '***已设置***' : '未设置');

  // 运行构建命令
  const commands = ['yarn run typescript', 'vite build', 'vite build --config vite.preload.config.ts'];

  for (const command of commands) {
    console.log(`\n🚀 运行: ${command}`);
    execSync(command, {
      stdio: 'inherit',
      env: buildEnv,
      cwd: projectRoot,
    });
  }

  console.log('\n✅ 构建完成！');
} catch (error) {
  console.error('❌ 构建失败:', error.message);
  process.exit(1);
}
