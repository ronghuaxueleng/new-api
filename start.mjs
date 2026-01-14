#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 .env 文件
function loadEnv(envPath) {
  if (!existsSync(envPath)) {
    console.error(`❌ 找不到配置文件: ${envPath}`);
    process.exit(1);
  }

  const envContent = readFileSync(envPath, 'utf-8');
  const config = {};

  envContent.split('\n').forEach(line => {
    // 跳过注释和空行
    line = line.trim();
    if (!line || line.startsWith('#')) return;

    // 解析 KEY=VALUE
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // 移除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      config[key] = value;
    }
  });

  return config;
}

// 加载配置
const envPath = join(__dirname, '.env');
const config = loadEnv(envPath);

console.log('🚀 正在启动 New API...\n');
console.log('📋 配置信息:');
console.log(`   - 端口: ${config.PORT || '3000 (默认)'}`);
console.log(`   - 数据库: ${config.SQL_DSN === 'local' ? 'SQLite' : config.SQL_DSN || 'SQLite (默认)'}`);
console.log(`   - Redis: ${config.REDIS_CONN_STRING ? '启用' : '禁用'}`);
console.log(`   - 时区: ${config.TZ || 'UTC (默认)'}`);
console.log('');

// 根据平台选择可执行文件
function getExecutablePath() {
  const platform = process.platform; // 'win32', 'linux', 'darwin'
  const arch = process.arch; // 'x64', 'arm64', etc.

  // 平台映射
  const platformMap = {
    'win32': 'windows',
    'linux': 'linux',
    'darwin': 'darwin', // macOS
  };

  // 架构映射
  const archMap = {
    'x64': 'amd64',
    'arm64': 'arm64',
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  if (!platformName || !archName) {
    console.error(`❌ 不支持的平台: ${platform} ${arch}`);
    process.exit(1);
  }

  // 构建可执行文件名
  const exeName = platform === 'win32'
    ? `new-api-${platformName}-${archName}.exe`
    : `new-api-${platformName}-${archName}`;

  const exePath = join(__dirname, exeName);

  // 检查文件是否存在
  if (!existsSync(exePath)) {
    console.error(`❌ 找不到可执行文件: ${exeName}`);
    console.error(`   请确保文件存在于: ${__dirname}`);
    process.exit(1);
  }

  return exePath;
}

const exePath = getExecutablePath();
console.log(`📦 使用可执行文件: ${join(__dirname, exePath.split(/[/\\]/).pop())}\n`);

const child = spawn(exePath, [], {
  env: {
    ...process.env,
    ...config,
  },
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error('❌ 启动失败:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code !== null) {
    console.log(`\n进程退出，退出码: ${code}`);
  } else if (signal !== null) {
    console.log(`\n进程被信号终止: ${signal}`);
  }
  process.exit(code || 0);
});

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n⏹️  正在停止服务器...');
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n\n⏹️  正在停止服务器...');
  child.kill('SIGTERM');
});
