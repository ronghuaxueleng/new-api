#!/usr/bin/env node

/**
 * New API 构建脚本（国内镜像版）
 */

import { execSync, spawn } from 'child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Windows 下设置控制台代码页为 UTF-8，解决中文乱码
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 忽略错误
  }
}

// 配置
const config = {
  rootDir: __dirname,
  webDir: join(__dirname, 'web'),
  outputDir: join(__dirname, '_build'),
  binaryName: process.platform === 'win32' ? 'new-api.exe' : 'new-api',
  versionFile: join(__dirname, 'VERSION'),
};

// 国内镜像配置
const mirrors = {
  npm: 'https://registry.npmmirror.com',
  goproxy: 'https://goproxy.cn,https://goproxy.io,direct',
  gosumdb: 'sum.golang.google.cn',
  nodeMirror: 'https://npmmirror.com/mirrors/node/',
  electronMirror: 'https://npmmirror.com/mirrors/electron/',
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.cyan}${colors.bright}=== ${msg} ===${colors.reset}\n`),
};

// 进度条类
class ProgressBar {
  constructor(options = {}) {
    this.total = options.total || 100;
    this.current = 0;
    this.barLength = options.barLength || 40;
    this.status = options.status || '';
    this.startTime = Date.now();
  }

  update(current, status = '') {
    this.current = current;
    if (status) this.status = status;
    this.render();
  }

  increment(status = '') {
    this.current++;
    if (status) this.status = status;
    this.render();
  }

  render() {
    const percent = Math.min(100, Math.floor((this.current / this.total) * 100));
    const filledLength = Math.floor((percent / 100) * this.barLength);
    const emptyLength = this.barLength - filledLength;

    const filled = colors.green + '█'.repeat(filledLength) + colors.reset;
    const empty = colors.reset + '░'.repeat(emptyLength);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

    const statusText = this.status.length > 30 ? this.status.slice(0, 27) + '...' : this.status.padEnd(30);

    process.stdout.write(`\r  ${filled}${empty} ${percent.toString().padStart(3)}% | ${elapsed}s | ${statusText}`);
  }

  complete(message = '完成') {
    this.current = this.total;
    this.status = message;
    this.render();
    console.log(); // 换行
  }

  clear() {
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
  }
}

// 检查命令是否存在
function checkCommand(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 设置国内镜像环境变量
function setupMirrorEnv() {
  process.env.GOPROXY = mirrors.goproxy;
  process.env.GOSUMDB = mirrors.gosumdb;
  process.env.npm_config_registry = mirrors.npm;
  process.env.NODEJS_ORG_MIRROR = mirrors.nodeMirror;
  process.env.ELECTRON_MIRROR = mirrors.electronMirror;
  process.env.npm_config_audit = 'false';
  process.env.npm_config_fund = 'false';

  log.info('已配置国内镜像:');
  log.info(`  npm: ${mirrors.npm}`);
  log.info(`  Go:  ${mirrors.goproxy}`);
}

// 配置 npm 使用国内镜像
function setupNpmMirror() {
  log.info('配置 npm 国内镜像...');

  const npmrcPath = join(config.webDir, '.npmrc');
  const npmrcContent = `registry=${mirrors.npm}
disturl=${mirrors.nodeMirror}
sass_binary_site=https://npmmirror.com/mirrors/node-sass/
phantomjs_cdnurl=https://npmmirror.com/mirrors/phantomjs/
electron_mirror=${mirrors.electronMirror}
chromedriver_cdnurl=https://npmmirror.com/mirrors/chromedriver/
operadriver_cdnurl=https://npmmirror.com/mirrors/operadriver/
selenium_cdnurl=https://npmmirror.com/mirrors/selenium/
node_inspector_cdnurl=https://npmmirror.com/mirrors/node-inspector/
fsevents_binary_host_mirror=https://npmmirror.com/mirrors/fsevents/
`;

  writeFileSync(npmrcPath, npmrcContent);
  log.success('已创建 web/.npmrc');
}

// 读取版本号
function getVersion() {
  try {
    if (existsSync(config.versionFile)) {
      const version = readFileSync(config.versionFile, 'utf-8').trim();
      return version || 'v0.0.0';
    }
  } catch {
    // 尝试从 git 获取
    try {
      const gitVersion = execSync('git describe --tags', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      return gitVersion;
    } catch {
      // 忽略
    }
  }
  return 'v0.0.0';
}

// 带进度的命令执行
function execWithProgress(cmd, options = {}) {
  return new Promise((resolve) => {
    const defaultOptions = {
      cwd: config.rootDir,
      shell: true,
      env: { ...process.env },
    };

    const child = spawn(cmd, [], {
      ...defaultOptions,
      ...options,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    const progress = new ProgressBar({ total: 100, status: '准备中...' });
    let progressValue = 0;
    let lastStatus = '';

    const parseOutput = (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        if (line.includes('reify:')) {
          const match = line.match(/reify:([^:]+)/);
          if (match) {
            lastStatus = match[1].trim().slice(0, 25);
          }
          progressValue = Math.min(95, progressValue + 0.5);
        } else if (line.includes('timing')) {
          progressValue = Math.min(95, progressValue + 0.3);
        } else if (line.includes('added') || line.includes('packages')) {
          progressValue = 98;
          lastStatus = '完成安装';
        } else if (line.includes('idealTree') || line.includes('buildIdeal')) {
          lastStatus = '解析依赖树...';
          progressValue = Math.min(30, progressValue + 2);
        } else if (line.includes('diffTrees')) {
          lastStatus = '计算差异...';
          progressValue = Math.min(40, progressValue + 1);
        } else if (line.includes('fetch')) {
          lastStatus = '下载包...';
          progressValue = Math.min(80, progressValue + 0.2);
        }
      }

      progress.update(progressValue, lastStatus);
    };

    child.stdout?.on('data', parseOutput);
    child.stderr?.on('data', parseOutput);

    const interval = setInterval(() => {
      if (progressValue < 95) {
        progressValue += 0.1;
        progress.update(progressValue, lastStatus || '安装中...');
      }
    }, 200);

    child.on('close', (code) => {
      clearInterval(interval);
      if (code === 0) {
        progress.complete('安装完成');
        resolve(true);
      } else {
        progress.clear();
        log.error('安装失败');
        resolve(false);
      }
    });

    child.on('error', (err) => {
      clearInterval(interval);
      progress.clear();
      log.error(`执行失败: ${err.message}`);
      resolve(false);
    });
  });
}

// 带进度的 Go 构建
function execGoWithProgress(cmd, options = {}) {
  return new Promise((resolve) => {
    const defaultOptions = {
      cwd: config.rootDir,
      shell: true,
      env: { ...process.env },
    };

    const child = spawn(cmd, [], {
      ...defaultOptions,
      ...options,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    const progress = new ProgressBar({ total: 100, status: '准备中...' });
    let progressValue = 0;
    let lastStatus = '';
    let outputBuffer = '';

    const parseOutput = (data) => {
      const text = data.toString();
      outputBuffer += text;

      if (text.includes('go: downloading')) {
        const match = text.match(/go: downloading ([^\s]+)/);
        if (match) {
          lastStatus = match[1].split('/').pop()?.slice(0, 25) || '下载模块...';
        }
        progressValue = Math.min(90, progressValue + 2);
      } else if (text.includes('go: finding')) {
        lastStatus = '解析模块...';
        progressValue = Math.min(30, progressValue + 5);
      }

      progress.update(progressValue, lastStatus || '处理中...');
    };

    child.stdout?.on('data', parseOutput);
    child.stderr?.on('data', parseOutput);

    const interval = setInterval(() => {
      if (progressValue < 95) {
        progressValue += 0.2;
        progress.update(progressValue, lastStatus || '编译中...');
      }
    }, 300);

    child.on('close', (code) => {
      clearInterval(interval);
      if (code === 0) {
        progress.complete('完成');
        resolve(true);
      } else {
        progress.clear();
        if (outputBuffer) {
          console.log(outputBuffer);
        }
        resolve(false);
      }
    });

    child.on('error', (err) => {
      clearInterval(interval);
      progress.clear();
      log.error(`执行失败: ${err.message}`);
      resolve(false);
    });
  });
}

// 执行命令
function exec(cmd, options = {}) {
  const defaultOptions = {
    cwd: config.rootDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  };
  try {
    execSync(cmd, { ...defaultOptions, ...options });
    return true;
  } catch (error) {
    log.error(`命令执行失败: ${cmd}`);
    return false;
  }
}

// 构建前端
async function buildWeb() {
  log.title('构建前端');

  if (!existsSync(config.webDir)) {
    log.error('web 目录不存在');
    return false;
  }

  const version = getVersion();

  // 配置 npm 镜像
  setupNpmMirror();

  // 检查 node_modules
  const nodeModulesPath = join(config.webDir, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    log.info('安装前端依赖 (使用国内镜像)...');

    const installCmd = `npm install --legacy-peer-deps --registry=${mirrors.npm} --timing`;

    const success = await execWithProgress(installCmd, { cwd: config.webDir });

    if (!success) {
      log.warn('尝试使用 --force 重新安装...');
      const forceSuccess = await execWithProgress(
        `npm install --force --registry=${mirrors.npm} --timing`,
        { cwd: config.webDir }
      );
      if (!forceSuccess) {
        return false;
      }
    }
  } else {
    log.info('node_modules 已存在，跳过安装');
  }

  log.info('构建前端资源...');
  const buildEnv = {
    ...process.env,
    DISABLE_ESLINT_PLUGIN: 'true',
    VITE_REACT_APP_VERSION: version,
    NODE_OPTIONS: '--max-old-space-size=1536',
  };

  const buildResult = exec('npm run build', { cwd: config.webDir, env: buildEnv });

  if (buildResult) {
    const buildDir = join(config.webDir, 'dist');
    console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
    log.success('前端构建完成！');
    console.log(`\n  构建产物: ${colors.green}${buildDir}${colors.reset}`);
    console.log(`  版本: ${colors.cyan}${version}${colors.reset}`);
    console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');
  }

  return buildResult;
}

// 构建后端
async function buildBackend(targetOS = process.platform, targetArch = process.arch) {
  log.title('构建后端');

  // 检查 Go 是否安装
  if (!checkCommand('go')) {
    log.error('未检测到 Go 环境');
    console.log('');
    log.info('推荐版本: Go 1.21 或更高版本');

    // 根据平台推荐安装包
    const platform = process.platform;
    const arch = process.arch;
    let recommendFile = '';

    if (platform === 'win32') {
      recommendFile = arch === 'x64' ? 'go1.25.4.windows-amd64.msi' : 'go1.25.4.windows-arm64.msi';
      log.info(`推荐下载: ${colors.green}${recommendFile}${colors.reset}`);
      log.info('安装后需要重启终端');
    } else if (platform === 'darwin') {
      recommendFile = arch === 'arm64' ? 'go1.25.4.darwin-arm64.pkg' : 'go1.25.4.darwin-amd64.pkg';
      log.info(`推荐下载: ${colors.green}${recommendFile}${colors.reset}`);
    } else if (platform === 'linux') {
      recommendFile = arch === 'arm64' ? 'go1.25.4.linux-arm64.tar.gz' : 'go1.25.4.linux-amd64.tar.gz';
      log.info(`推荐下载: ${colors.green}${recommendFile}${colors.reset}`);
      log.info('解压后设置环境变量: export PATH=$PATH:/usr/local/go/bin');
    }

    console.log('');
    log.info(`${colors.cyan}官方地址:${colors.reset} https://golang.google.cn/dl/`);
    log.info(`${colors.cyan}镜像地址:${colors.reset} https://mirrors.nju.edu.cn/golang/`);
    console.log('');

    return false;
  }

  const version = getVersion();

  // 映射平台名称
  const osMap = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386' };

  const goos = osMap[targetOS] || targetOS;
  const goarch = archMap[targetArch] || targetArch;

  // 确保输出目录存在
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  // 构建二进制文件名
  let binaryName = `new-api-${goos}-${goarch}`;
  if (goos === 'windows') {
    binaryName += '.exe';
  }
  const binaryPath = join(config.outputDir, binaryName);

  log.info(`目标平台: ${goos}/${goarch}`);
  log.info(`版本: ${version}`);
  log.info(`Go 代理: ${mirrors.goproxy}`);

  // 检查前端资源
  const distDir = join(config.webDir, 'dist');
  if (!existsSync(distDir)) {
    log.warn('前端资源不存在，请先构建前端');
    return false;
  }

  // 更新 Go 依赖
  log.info('更新 Go 依赖 (使用国内镜像)...');
  const goEnv = {
    ...process.env,
    GOPROXY: mirrors.goproxy,
    GOSUMDB: mirrors.gosumdb,
  };

  if (!(await execGoWithProgress('go mod tidy', { env: goEnv }))) {
    log.error('Go 依赖更新失败');
    return false;
  }

  // 构建命令
  const ldflags = `-w -s -X 'one-api/common.Version=${version}'`;

  const buildEnv = {
    ...goEnv,
    GOOS: goos,
    GOARCH: goarch,
    CGO_ENABLED: '0',
  };

  const buildCmd = `go build -o "${binaryPath}" -ldflags "${ldflags}"`;

  log.info('编译后端...');
  if (!(await execGoWithProgress(buildCmd, { env: buildEnv }))) {
    log.error('Go 编译失败');
    return false;
  }

  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
  log.success('后端构建完成！');
  console.log(`\n  构建产物: ${colors.green}${binaryPath}${colors.reset}`);
  console.log(`  平台: ${colors.cyan}${goos}/${goarch}${colors.reset}`);
  console.log(`  版本: ${colors.cyan}${version}${colors.reset}`);
  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');

  return true;
}

// 完整构建
async function buildAll() {
  log.title('完整构建');

  const webResult = await buildWeb();
  if (!webResult) {
    log.error('前端构建失败');
    return false;
  }

  const backendResult = await buildBackend();
  if (!backendResult) {
    log.error('后端构建失败');
    return false;
  }

  console.log('\n' + colors.cyan + colors.bright + '╔' + '═'.repeat(58) + '╗' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + ' '.repeat(58) + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + colors.green + colors.bright + '  ✓ 完整构建完成！前端 + 后端已成功构建  '.padEnd(58, ' ') + colors.cyan + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + ' '.repeat(58) + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '╚' + '═'.repeat(58) + '╝' + colors.reset);

  console.log('\n' + colors.yellow + '📦 构建产物:' + colors.reset);
  console.log(`  前端: ${colors.green}${join(config.webDir, 'dist')}${colors.reset}`);
  console.log(`  后端: ${colors.green}${config.outputDir}${colors.reset}`);

  console.log('\n' + colors.yellow + '🚀 快速启动:' + colors.reset);
  const currentPlatform = process.platform;
  const currentArch = process.arch;
  const osMap = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const goos = osMap[currentPlatform] || currentPlatform;
  const goarch = archMap[currentArch] || currentArch;
  let binaryName = `new-api-${goos}-${goarch}`;
  if (goos === 'windows') {
    binaryName += '.exe';
  }
  const binaryPath = join(config.outputDir, binaryName);

  if (process.platform === 'win32') {
    console.log(`  ${colors.green}${binaryPath}${colors.reset}`);
  } else {
    console.log(`  ${colors.green}${binaryPath}${colors.reset}`);
  }

  console.log('\n' + colors.yellow + '💡 提示:' + colors.reset);
  console.log('  - 应用会自动加载前端构建产物');
  console.log(`  - 默认监听端口: ${colors.cyan}3000${colors.reset}`);
  console.log(`  - 访问地址: ${colors.cyan}http://localhost:3000${colors.reset}`);
  console.log('');

  return true;
}

// 交叉编译所有平台
async function crossCompile() {
  log.title('交叉编译所有平台');

  // 先构建前端
  const webResult = await buildWeb();
  if (!webResult) {
    log.error('前端构建失败');
    return false;
  }

  const targets = [
    { os: 'linux', arch: 'x64', desc: 'Linux x64' },
    { os: 'linux', arch: 'arm64', desc: 'Linux ARM64' },
    { os: 'win32', arch: 'x64', desc: 'Windows x64' },
    { os: 'win32', arch: 'arm64', desc: 'Windows ARM64' },
    { os: 'darwin', arch: 'x64', desc: 'macOS x64 (Intel)' },
    { os: 'darwin', arch: 'arm64', desc: 'macOS ARM64 (Apple Silicon)' },
  ];

  log.info(`准备编译 ${targets.length} 个平台版本...\n`);

  let successCount = 0;
  for (const target of targets) {
    log.info(`[${successCount + 1}/${targets.length}] 正在编译: ${target.desc}`);
    const result = await buildBackend(target.os, target.arch);
    if (result) {
      successCount++;
    }
    console.log('');
  }

  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
  log.success(`交叉编译完成！成功: ${successCount}/${targets.length}`);
  console.log('\n' + colors.yellow + '📦 构建产物:' + colors.reset);
  console.log(`  ${colors.green}${config.outputDir}${colors.reset}`);
  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');

  return successCount === targets.length;
}

// 清理构建产物
function clean() {
  log.title('清理构建产物');

  const pathsToClean = [
    config.outputDir,
    join(config.webDir, 'dist'),
    join(config.webDir, 'build'),
  ];

  let cleaned = 0;
  for (const p of pathsToClean) {
    if (existsSync(p)) {
      log.info(`删除: ${p}`);
      rmSync(p, { recursive: true, force: true });
      cleaned++;
    }
  }

  if (cleaned === 0) {
    log.info('没有需要清理的文件');
  } else {
    log.success(`清理完成，已删除 ${cleaned} 个目录`);
  }
}

// 深度清理（包括 node_modules）
function cleanAll() {
  log.title('深度清理（包括依赖）');

  const pathsToClean = [
    config.outputDir,
    join(config.webDir, 'dist'),
    join(config.webDir, 'build'),
    join(config.webDir, 'node_modules'),
  ];

  let cleaned = 0;
  for (const p of pathsToClean) {
    if (existsSync(p)) {
      log.info(`删除: ${p}`);
      rmSync(p, { recursive: true, force: true });
      cleaned++;
    }
  }

  if (cleaned === 0) {
    log.info('没有需要清理的文件');
  } else {
    log.success(`深度清理完成，已删除 ${cleaned} 个目录`);
  }
}

// 运行项目
function run() {
  log.title('运行项目');

  const currentPlatform = process.platform;
  const currentArch = process.arch;
  const osMap = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const goos = osMap[currentPlatform] || currentPlatform;
  const goarch = archMap[currentArch] || currentArch;
  let binaryName = `new-api-${goos}-${goarch}`;
  if (goos === 'windows') {
    binaryName += '.exe';
  }
  const binaryPath = join(config.outputDir, binaryName);

  if (!existsSync(binaryPath)) {
    log.error('二进制文件不存在，请先构建');
    log.info(`期望路径: ${binaryPath}`);
    return;
  }

  log.info(`启动: ${binaryPath}`);
  const child = spawn(binaryPath, [], {
    cwd: config.rootDir,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    log.error(`启动失败: ${err.message}`);
  });
}

// 显示镜像配置
function showMirrors() {
  log.title('当前镜像配置');
  console.log(`
  ${colors.green}npm 镜像:${colors.reset}      ${mirrors.npm}
  ${colors.green}Go 代理:${colors.reset}       ${mirrors.goproxy}
  ${colors.green}Go SumDB:${colors.reset}      ${mirrors.gosumdb}
  ${colors.green}Node 镜像:${colors.reset}     ${mirrors.nodeMirror}
  ${colors.green}Electron:${colors.reset}      ${mirrors.electronMirror}
`);
}

// 显示版本信息
function showVersion() {
  log.title('版本信息');

  const version = getVersion();
  console.log(`${colors.cyan}当前版本:${colors.reset} ${colors.bright}${version}${colors.reset}`);

  // 显示 Go 版本
  if (checkCommand('go')) {
    try {
      const goVersion = execSync('go version', { encoding: 'utf-8' }).trim();
      console.log(`${colors.cyan}Go 版本:${colors.reset} ${goVersion}`);
    } catch {
      // 忽略
    }
  }

  // 显示 Node 版本
  console.log(`${colors.cyan}Node 版本:${colors.reset} ${process.version}`);

  console.log();
}

// 交互式菜单
async function showMenu() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log(`
${colors.cyan}${colors.bright}╔══════════════════════════════════════╗
║      New API 构建工具 (国内版)        ║
╚══════════════════════════════════════╝${colors.reset}

${colors.yellow}请选择操作:${colors.reset}

  ${colors.green}1.${colors.reset}  完整构建 (前端 + 后端)
  ${colors.green}2.${colors.reset}  交叉编译所有平台
  ${colors.green}3.${colors.reset}  清理构建产物
  ${colors.green}4.${colors.reset}  深度清理 (包括 node_modules)
  ${colors.green}5.${colors.reset}  运行项目
  ${colors.green}6.${colors.reset}  查看镜像配置
  ${colors.green}7.${colors.reset}  查看版本信息
  ${colors.green}0.${colors.reset}  退出
`);

  const choice = await question(`${colors.cyan}请输入选项 [0-7]: ${colors.reset}`);
  rl.close();

  switch (choice.trim()) {
    case '1':
      await buildAll();
      break;
    case '2':
      await crossCompile();
      break;
    case '3':
      clean();
      break;
    case '4':
      cleanAll();
      break;
    case '5':
      run();
      return; // 运行后不再显示菜单
    case '6':
      showMirrors();
      break;
    case '7':
      showVersion();
      break;
    case '0':
      log.info('再见!');
      process.exit(0);
    default:
      log.warn('无效选项');
  }

  // 继续显示菜单
  console.log('\n');
  await showMenu();
}

// 命令行参数处理
async function main() {
  // 初始化镜像环境
  setupMirrorEnv();

  const args = process.argv.slice(2);

  if (args.length === 0) {
    await showMenu();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'all':
    case 'build':
      await buildAll();
      break;
    case 'cross':
    case 'cross-compile':
      await crossCompile();
      break;
    case 'clean':
      clean();
      break;
    case 'clean-all':
      cleanAll();
      break;
    case 'run':
      run();
      break;
    case 'mirrors':
      showMirrors();
      break;
    case 'version':
    case 'v':
      showVersion();
      break;
    case 'help':
    case '-h':
    case '--help':
      console.log(`
${colors.cyan}New API 构建工具 (国内镜像版)${colors.reset}

用法: node build.mjs [命令]

命令:
  (无)        显示交互式菜单
  all         完整构建 (前端 + 后端)
  cross       交叉编译所有平台
  clean       清理构建产物
  clean-all   深度清理 (包括 node_modules)
  run         运行项目
  mirrors     显示镜像配置
  version     查看版本信息
  help        显示帮助

示例:
  node build.mjs              # 交互式菜单
  node build.mjs all          # 完整构建
  node build.mjs cross        # 交叉编译所有平台
  node build.mjs clean        # 清理构建产物

镜像配置:
  npm:  ${mirrors.npm}
  Go:   ${mirrors.goproxy}
`);
      break;
    default:
      log.error(`未知命令: ${command}`);
      log.info('使用 "node build.mjs help" 查看帮助');
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
