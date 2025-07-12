// src/utils/customNodesInstaller.ts
import axios from 'axios';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { getDefaultInstallLocation } from '../../tests/shared/utils';
import { HuggingFaceDownloader } from './download_model';

interface ModelConfig {
  url: string;
  path: string;
  repoid: string;
}

interface CustomNode {
  name: string;
  repository: string;
  version: string; // 保留commit hash
  type: 'Community' | 'Core'; // 明确两种类型
  install_path: string;
  models: ModelConfig[];
}

interface NodeInfo {
  repo_id: string;
  version: string;
}

interface NodeJson {
  nodes: NodeInfo[];
}

interface ModelItem {
  repo_id: string;
  local_path: string;
  files?: string[];
}

interface RepoModels {
  common?: ModelItem[];
  mps?: ModelItem[];
  cuda?: ModelItem[];
}

interface GitHubTag {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  zipball_url: string;
  tarball_url: string;
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

type Logger = (message: string) => void;

const GH_API_TOKEN = process.env.GH_API_TOKEN || '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';

/**
 * 从GitHub仓库动态获取所有节点信息
 * @param logger 日志回调函数
 * @returns 合并后的节点信息数组
 */
export async function getAllNodes(logger: Logger): Promise<NodeInfo[]> {
  try {
    // 检查 GitHub Token
    if (!GH_API_TOKEN) {
      logger(`⚠️ 警告: 未设置 GitHub Token\n`);
    }

    const repoUrl = 'https://github.com/pictorialink/Picto-workflow.git';
    const repoPath = 'pictorialink/Picto-workflow';
    const targetDirs = ['common', 'mps'];

    logger(`开始从仓库获取节点信息: ${repoUrl}\n`);

    let allNodes: NodeInfo[] = [
      {
        repo_id: 'pictorialink/ComfyUI-Core-Node',
        version: 'main',
      },
    ];

    // 遍历目标目录
    for (const dir of targetDirs) {
      logger(`正在扫描目录: ${dir}\n`);
      const dirNodes = await getNodesFromDirectory(repoPath, dir, logger);
      allNodes = [...allNodes, ...dirNodes];
    }

    // 去重处理
    const uniqueNodes = deduplicateNodes(allNodes);
    logger(`获取完成，共找到 ${uniqueNodes.length} 个唯一节点\n`);
    return uniqueNodes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger(`获取节点信息失败: ${errorMessage}\n`);
    throw error;
  }
}

/**
 * 从指定目录递归获取所有node.json文件中的节点信息
 */
async function getNodesFromDirectory(repoPath: string, directory: string, logger: Logger): Promise<NodeInfo[]> {
  try {
    const nodeJsonFiles = await findNodeJsonFiles(repoPath, directory);
    logger(`在目录 ${directory} 中找到 ${nodeJsonFiles.length} 个 node.json 文件\n`);

    let allNodes: NodeInfo[] = [];

    for (const filePath of nodeJsonFiles) {
      try {
        const nodes = await getNodesFromFile(repoPath, filePath, logger);
        allNodes = [...allNodes, ...nodes];
        logger(`从文件 ${filePath} 获取到 ${nodes.length} 个节点\n`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger(`读取文件 ${filePath} 失败: ${errorMessage}\n`);
        // 继续处理其他文件，不中断整个流程
      }
    }

    return allNodes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger(`扫描目录 ${directory} 失败: ${errorMessage}\n`);
    return [];
  }
}

/**
 * 递归查找指定目录下的所有node.json文件
 */
async function findNodeJsonFiles(repoPath: string, directory: string): Promise<string[]> {
  const nodeJsonFiles: string[] = [];

  // 使用GitHub API获取目录树
  const apiUrl = `https://api.github.com/repos/${repoPath}/git/trees/main?recursive=1`;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };

    // 如果有 GitHub Token，添加认证头
    if (GH_API_TOKEN) {
      headers.Authorization = `Bearer ${GH_API_TOKEN}`;
    }

    const response = await axios.get<GitHubTreeResponse>(apiUrl, {
      headers,
    });
    const tree = response.data.tree;

    // 过滤出指定目录下的node.json文件
    for (const item of tree) {
      if (item.type === 'blob' && item.path.startsWith(directory + '/') && item.path.endsWith('/node.json')) {
        nodeJsonFiles.push(item.path);
      }
    }

    return nodeJsonFiles;
  } catch (error) {
    console.error(`获取目录树失败: ${error}`);
    throw error;
  }
}

/**
 * 从GitHub仓库读取单个node.json文件并解析
 */
async function getNodesFromFile(repoPath: string, filePath: string, logger: Logger): Promise<NodeInfo[]> {
  try {
    // 使用raw.githubusercontent.com获取文件内容
    const rawUrl = `https://raw.githubusercontent.com/${repoPath}/main/${filePath}`;

    const headers: Record<string, string> = {};

    // 如果有 GitHub Token，添加认证头
    if (GH_API_TOKEN) {
      headers.Authorization = `Bearer ${GH_API_TOKEN}`;
    }

    const response = await axios.get<NodeJson>(rawUrl, {
      headers,
    });
    const nodeJson = response.data;

    if (!nodeJson.nodes || !Array.isArray(nodeJson.nodes)) {
      logger(`文件 ${filePath} 格式不正确，缺少nodes数组\n`);
      return [];
    }

    return nodeJson.nodes;
  } catch (error) {
    console.error(`读取文件 ${filePath} 失败:`, error);
    throw error;
  }
}

/**
 * 对节点数组进行去重处理
 */
function deduplicateNodes(nodes: NodeInfo[]): NodeInfo[] {
  const seenRepoIds = new Set<string>();
  const uniqueNodes: NodeInfo[] = [];

  for (const node of nodes) {
    if (!seenRepoIds.has(node.repo_id)) {
      seenRepoIds.add(node.repo_id);
      uniqueNodes.push(node);
    }
  }

  return uniqueNodes;
}

/**
 * 获取详细的节点信息，包括模型配置
 * @param logger 日志回调函数
 * @param platform 平台类型，用于选择对应的模型配置
 * @returns 完整的CustomNode数组
 */
export async function getDetailedNodes(
  logger: Logger,
  platform: 'common' | 'mps' | 'cuda' = 'common'
): Promise<CustomNode[]> {
  try {
    // 首先获取所有节点信息
    const nodeInfos = await getAllNodes(logger);
    logger(`开始获取 ${nodeInfos.length} 个节点的详细信息\n`);

    const detailedNodes: CustomNode[] = [];

    // 遍历每个节点，获取详细信息
    for (const nodeInfo of nodeInfos) {
      try {
        logger(`正在处理节点: ${nodeInfo.repo_id}\n`);
        const detailedNode = await getNodeDetails(nodeInfo, platform, logger);
        if (detailedNode) {
          detailedNodes.push(detailedNode);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger(`获取节点 ${nodeInfo.repo_id} 详细信息失败: ${errorMessage}\n`);
        // 继续处理其他节点
      }
    }

    logger(`获取详细信息完成，共处理 ${detailedNodes.length} 个节点\n`);
    return detailedNodes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger(`获取详细节点信息失败: ${errorMessage}\n`);
    throw error;
  }
}

/**
 * 获取单个节点的详细信息
 */
async function getNodeDetails(
  nodeInfo: NodeInfo,
  platform: 'common' | 'mps' | 'cuda',
  logger: Logger
): Promise<CustomNode | null> {
  try {
    const repoUrl = `https://github.com/${nodeInfo.repo_id}`;
    const gitUrl = `${repoUrl}.git`;

    // 获取适合的版本/commit
    const targetVersion = await getTargetVersion(nodeInfo.repo_id, nodeInfo.version, logger);

    // 获取模型配置
    const models = await getNodeModels(nodeInfo.repo_id, targetVersion, platform, logger);

    // 生成节点名称和安装路径
    const nodeName = extractNodeName(nodeInfo.repo_id);
    const installPath = `custom_nodes/${nodeName}`;

    const customNode: CustomNode = {
      name: nodeName,
      repository: gitUrl,
      version: targetVersion,
      type: 'Community',
      install_path: installPath,
      models: models,
    };

    logger(`节点 ${nodeInfo.repo_id} 处理完成，包含 ${models.length} 个模型\n`);
    return customNode;
  } catch (error) {
    logger(`处理节点 ${nodeInfo.repo_id} 时发生错误: ${error}\n`);
    return null;
  }
}

/**
 * 根据版本规则获取目标版本
 */
async function getTargetVersion(repoId: string, versionRule: string, logger: Logger): Promise<string> {
  try {
    // 如果是具体的commit hash，直接返回
    if (versionRule.length === 40 && /^[\da-f]+$/i.test(versionRule)) {
      return versionRule;
    }

    // 直接获取仓库的所有tags
    const tags = await getRepoTags(repoId);
    console.log(
      'tags:',
      tags.map((t) => t.name)
    );

    if (tags.length === 0) {
      logger(`仓库 ${repoId} 没有标签，将使用main分支\n`);
      return 'main';
    }

    // 根据版本规则筛选合适的版本
    const targetTag = findMatchingTag(tags, versionRule);

    if (targetTag) {
      logger(`为 ${repoId} 选择版本: ${targetTag.name}\n`);
      return targetTag.name;
    } else {
      logger(`未找到匹配版本规则 ${versionRule} 的版本，使用最新标签\n`);
      return tags[0].name;
    }
  } catch (error) {
    logger(`获取版本信息失败，使用main分支: ${error}\n`);
    return 'main';
  }
}

/**
 * 获取仓库的所有tags
 */
async function getRepoTags(repoId: string): Promise<GitHubTag[]> {
  try {
    const apiUrl = `https://api.github.com/repos/${repoId}/tags`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };

    // 如果有 GitHub Token，添加认证头
    if (GH_API_TOKEN) {
      headers.Authorization = `Bearer ${GH_API_TOKEN}`;
    }

    const response = await axios.get<GitHubTag[]>(apiUrl, {
      headers,
    });
    return response.data;
  } catch (error) {
    console.error(`获取仓库 ${repoId} 的tags失败:`, error);
    return [];
  }
}

/**
 * 根据版本规则匹配合适的tag
 */
function findMatchingTag(tags: GitHubTag[], versionRule: string): GitHubTag | null {
  // 移除版本规则中的前缀符号
  const cleanVersion = versionRule.replace(/^[~^=<>]=?/, '');

  for (const tag of tags) {
    const tagVersion = tag.name.replace(/^v/, ''); // 移除v前缀

    if (versionRule.startsWith('^')) {
      // ^1.2.3: 允许 1.x.x 的更新，但不接受 2.x.x
      if (isCompatibleVersion(tagVersion, cleanVersion, 'caret')) {
        return tag;
      }
    } else if (versionRule.startsWith('~')) {
      // ~1.2.3: 允许 1.2.x 的更新，但不接受 1.3.x
      if (isCompatibleVersion(tagVersion, cleanVersion, 'tilde')) {
        return tag;
      }
    } else if (versionRule.startsWith('=')) {
      // =1.2.3: 严格锁定版本
      if (tagVersion === cleanVersion) {
        return tag;
      }
    } else {
      // 处理其他范围符号或直接匹配
      if (tagVersion === cleanVersion) {
        return tag;
      }
    }
  }

  return null;
}

/**
 * 检查版本兼容性
 */
function isCompatibleVersion(tagVersion: string, baseVersion: string, type: 'caret' | 'tilde'): boolean {
  const tagParts = tagVersion.split('.').map(Number);
  const baseParts = baseVersion.split('.').map(Number);

  if (tagParts.length !== 3 || baseParts.length !== 3) {
    return false;
  }

  if (type === 'caret') {
    // ^1.2.3: 允许 1.x.x，但不接受 2.x.x
    return (
      tagParts[0] === baseParts[0] &&
      (tagParts[1] > baseParts[1] || (tagParts[1] === baseParts[1] && tagParts[2] >= baseParts[2]))
    );
  } else if (type === 'tilde') {
    // ~1.2.3: 允许 1.2.x，但不接受 1.3.x
    return tagParts[0] === baseParts[0] && tagParts[1] === baseParts[1] && tagParts[2] >= baseParts[2];
  }

  return false;
}

/**
 * 获取节点的模型配置
 */
async function getNodeModels(
  repoId: string,
  version: string,
  platform: 'common' | 'mps' | 'cuda',
  logger: Logger
): Promise<ModelConfig[]> {
  try {
    // 尝试从仓库获取models.json文件
    const modelsUrl = `https://raw.githubusercontent.com/${repoId}/${version}/models.json`;

    const headers: Record<string, string> = {};

    // 如果有 GitHub Token，添加认证头
    if (GH_API_TOKEN) {
      headers.Authorization = `Bearer ${GH_API_TOKEN}`;
    }

    const response = await axios.get<RepoModels>(modelsUrl, {
      headers,
    });
    const repoModels = response.data;

    // 根据平台选择对应的模型配置
    const platformModels = repoModels[platform] || [];

    // 转换为ModelConfig格式
    const modelConfigs: ModelConfig[] = [];

    for (const modelItem of platformModels) {
      if (modelItem.files && modelItem.files.length > 0) {
        // 如果指定了具体文件
        for (const file of modelItem.files) {
          const modelConfig: ModelConfig = {
            url: `https://huggingface.co/${modelItem.repo_id}/resolve/main/${file}`,
            path: `${modelItem.local_path}/${file}`,
            repoid: modelItem.repo_id,
          };
          modelConfigs.push(modelConfig);
        }
      } else {
        // 如果没有指定文件，下载整个仓库
        const modelConfig: ModelConfig = {
          url: `https://huggingface.co/${modelItem.repo_id}`,
          path: modelItem.local_path,
          repoid: modelItem.repo_id,
        };
        modelConfigs.push(modelConfig);
      }
    }

    logger(`节点 ${repoId} 在 ${platform} 平台下有 ${modelConfigs.length} 个模型配置\n`);
    return modelConfigs;
  } catch {
    // 如果没有models.json文件，返回空数组
    logger(`节点 ${repoId} 没有模型配置文件\n`);
    return [];
  }
}

/**
 * 从repo_id提取节点名称
 */
function extractNodeName(repoId: string): string {
  const parts = repoId.split('/');
  return parts.at(-1) || ''; // 取最后一部分作为节点名称
}

export async function installCustomNodes(logger: Logger): Promise<void> {
  try {
    // const comfyDir = path.join(app.getPath('home'), 'ComfyUI');
    const comfyDir = getDefaultInstallLocation();
    if (!fs.existsSync(comfyDir)) {
      log.warn('ComfyUI directory not found, skipping node installation');
      return;
    }

    const defaultNodes = await getDefaultNodes(logger);
    // 检查是否有用户自定义的节点配置
    // const userConfigPath = path.join(app.getPath('userData'), 'custom-nodes.json');

    const userNodes: CustomNode[] = [];
    const nodesToInstall = [...defaultNodes, ...userNodes];
    const pythonPath = path.join(comfyDir, '.venv', 'bin', 'python');
    await commandRun(
      `${pythonPath} -m pip install --pre torch==2.9.0.dev20250630 torchsde==0.2.6 torchvision==0.23.0.dev20250630 torchaudio==2.8.0.dev20250630 --extra-index-url https://download.pytorch.org/whl/nightly/cpu`,
      logger
    );

    for (const node of nodesToInstall) {
      await installStart(node, comfyDir, comfyDir, logger);
    }
  } catch (error) {
    log.error('Custom nodes installation failed:', error);
  }
}

async function commandRun(command: string, logger: Logger): Promise<void> {
  const { execa } = await import('execa');
  const [cmd, ...args] = command.split(/\s+/);
  const subprocess = execa(cmd, args, {
    cwd: process.cwd(),
  });

  subprocess.stderr?.on('data', (data: Buffer) => {
    const dataStr = data.toString();
    process.stderr.write(dataStr);
    logger(`[Downloading Progress]: ${dataStr.trim()}\n`);
  });

  subprocess.stdout?.on('data', (data: Buffer) => {
    const dataStr = data.toString();
    process.stdout.write(dataStr);
    logger(`[Downloading Output]: ${dataStr.trim()}\n`);
  });

  try {
    await subprocess;
    console.log('[Downloading resources] ✅ successfully');
    logger('[Downloading resources] ✅ successfully\n');
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) {
      console.error('[Downloading resources]❌ error:', (error as { message: string }).message);
      logger(`[Downloading resources] ❌ error: ${(error as { message: string }).message}\n`);
    } else {
      console.error('[Downloading resources]❌ error:', error);
      logger(`[Downloading resources] ❌ error: ${error}\n`);
    }
  }
}

async function installStart(node: CustomNode, customNodesDir: string, comfyDir: string, logger: Logger): Promise<void> {
  try {
    if (node.repository && node.install_path) {
      const nodeDir = path.join(customNodesDir, node.install_path);
      log.info(`Installing ${node.name} at ${nodeDir}`);

      if (!fs.existsSync(nodeDir)) {
        // 目录不存在，进行首次安装
        log.info(`Creating directory for ${node.name} at ${nodeDir}`);
        logger(`[Installing] ${node.name}...\n`);
        await installNewNode(node, nodeDir, comfyDir, logger);
      } else {
        // 目录已存在，检查是否需要更新
        log.info(`Directory for ${node.name} already exists, checking for updates...`);
        logger(`[Checking Updates] ${node.name}...\n`);
        await checkAndUpdateNode(node, nodeDir, comfyDir, logger);
      }
    }

    // 检查和下载模型
    log.info(`Checking ${node.name} models...`);
    await checkAndUpdateModels(node, customNodesDir, logger);

    log.info(`[Successfully] processed ${node.name}`);
    logger(`[Successfully] processed ${node.name}\n`);
  } catch (error) {
    log.info(`[Failed] to process ${node.name}:`, error);
    logger(`[Failed] to process ${node.name}: ${error}\n`);
  }
}

/**
 * 安装新节点
 */
async function installNewNode(node: CustomNode, nodeDir: string, comfyDir: string, logger: Logger): Promise<void> {
  let cloneCmd = `git clone --progress ${node.repository} ${nodeDir}`;
  console.log(`Clone command: ${cloneCmd}`);

  try {
    console.log(`Cloning ${node.name} from ${node.repository} to ${nodeDir}...`);
    await commandRun(cloneCmd, logger);

    if (node.version && node.version !== 'main') {
      cloneCmd = `git -C ${nodeDir} checkout ${node.version}`;
      await commandRun(cloneCmd, logger);
    }

    await installNodeRequirements(node, nodeDir, comfyDir, logger);
    logger(`[Installed] ${node.name} version ${node.version}\n`);
  } catch (error) {
    log.error(`Failed to install ${node.name}:`, error);
    logger(`Failed to install ${node.name}: ${error}\n`);
    throw error;
  }
}

/**
 * 检查并更新已存在的节点
 */
async function checkAndUpdateNode(node: CustomNode, nodeDir: string, comfyDir: string, logger: Logger): Promise<void> {
  try {
    // 获取当前版本
    const currentVersion = await getCurrentNodeVersion(nodeDir);
    logger(`[Current Version] ${node.name}: ${currentVersion}\n`);
    logger(`[Target Version] ${node.name}: ${node.version}\n`);

    // 比较版本，决定是否需要更新
    if (needsUpdate(currentVersion, node.version)) {
      logger(`[Updating] ${node.name} from ${currentVersion} to ${node.version}...\n`);

      // 更新到指定版本
      await updateNodeToVersion(node, nodeDir, comfyDir, logger);
      logger(`[Updated] ${node.name} to version ${node.version}\n`);
    } else {
      logger(`[Up to date] ${node.name} is already at the latest version\n`);
    }
  } catch (error) {
    logger(`[Update Check Failed] ${node.name}: ${error}\n`);
    // 更新失败不抛出错误，继续处理其他节点
  }
}

/**
 * 获取当前节点的版本
 */
async function getCurrentNodeVersion(nodeDir: string): Promise<string> {
  try {
    const { execa } = await import('execa');

    // 先尝试获取当前分支/tag
    try {
      const result = await execa('git', ['-C', nodeDir, 'describe', '--tags', '--exact-match'], {
        stdio: 'pipe',
      });
      return result.stdout.trim();
    } catch {
      // 如果不在tag上，获取当前commit hash
      const result = await execa('git', ['-C', nodeDir, 'rev-parse', 'HEAD'], {
        stdio: 'pipe',
      });
      return result.stdout.trim();
    }
  } catch (error) {
    console.log(`Failed to get current version for ${nodeDir}:`, error);
    return 'unknown';
  }
}

/**
 * 判断是否需要更新
 */
function needsUpdate(currentVersion: string, targetVersion: string): boolean {
  // 如果当前版本未知，需要更新
  if (currentVersion === 'unknown') {
    return true;
  }

  // 如果目标版本是main/master，总是更新以获取最新代码
  if (targetVersion === 'main' || targetVersion === 'master') {
    return true;
  }

  // 如果版本不同，需要更新
  return currentVersion !== targetVersion;
}

/**
 * 更新节点到指定版本
 */
async function updateNodeToVersion(node: CustomNode, nodeDir: string, comfyDir: string, logger: Logger): Promise<void> {
  try {
    // 获取最新代码
    await commandRun(`git -C ${nodeDir} fetch --all`, logger);

    // 切换到目标版本
    if (node.version === 'main' || node.version === 'master') {
      await commandRun(`git -C ${nodeDir} checkout ${node.version}`, logger);
      await commandRun(`git -C ${nodeDir} pull origin ${node.version}`, logger);
    } else {
      await commandRun(`git -C ${nodeDir} checkout ${node.version}`, logger);
    }

    // 重新安装依赖
    await installNodeRequirements(node, nodeDir, comfyDir, logger);
  } catch (error) {
    logger(`Failed to update ${node.name}: ${error}\n`);
    throw error;
  }
}

/**
 * 检查和更新模型
 */
async function checkAndUpdateModels(node: CustomNode, customNodesDir: string, logger: Logger): Promise<void> {
  for (const model of node.models) {
    if (model.url && model.path) {
      let file = '';
      let outputDir: string = path.join(customNodesDir, model.path);

      // 检查模型是否需要更新
      const needsModelUpdate = shouldUpdateModel(outputDir);

      if (needsModelUpdate) {
        logger(`[Downloading/Updating Model] ${model.repoid}...\n`);

        if (isSingleFile(model.path)) {
          file = model.path.split('/').pop() || '';
          outputDir = path.dirname(outputDir);
        }

        const downloader = new HuggingFaceDownloader({
          repoId: model.repoid,
          outputDir,
          folder: '',
          files: file ? [file] : [],
          concurrency: 1,
          url: model.url,
          callback: logger,
        });
        await downloader.download();
      } else {
        logger(`[Model Up to date] ${model.repoid}\n`);
      }
    }
  }
}

/**
 * 判断模型是否需要更新
 */
function shouldUpdateModel(outputPath: string): boolean {
  // 如果文件/目录不存在，需要下载
  if (!fs.existsSync(outputPath)) {
    return true;
  }

  // TODO: 可以添加更复杂的版本检查逻辑
  // 比如检查文件大小、修改时间、checksums等

  // 目前简单返回false，表示已存在则不更新
  // 用户可以通过删除文件/目录来强制重新下载
  return false;
}

async function installNodeRequirements(
  node: CustomNode,
  nodeDir: string,
  comfyDir: string,
  logger: Logger
): Promise<void> {
  const requirementsPath = path.join(nodeDir, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    log.info(`Installing Python dependencies for ${node.name}...`);
    try {
      const pythonPath = path.join(comfyDir, '.venv', 'bin', 'python');
      log.info('pythonPath:', pythonPath);
      logger(`[Installing requirements] for ${node.name} from ${requirementsPath}...\n`);

      if (!fs.existsSync(pythonPath)) {
        throw new Error('ComfyUI Python environment not found');
      }
      // await execAsync(`${pythonPath} -m pip install -r "${requirementsPath}"`, {
      //   stdio: 'inherit'
      // } as any);
      await commandRun(`${pythonPath} -m pip install -r ${requirementsPath}`, logger);
    } catch {
      log.info('Trying with system Python...');
      await commandRun(`python -m pip install -r ${requirementsPath}`, logger);
    }
  }
}

function isSingleFile(path: string): boolean {
  const fileExtensions: string[] = [
    '.pth',
    '.onnx',
    '.pt',
    '.bin',
    '.safetensors',
    '.ckpt',
    '.vae',
    '.json',
    '.yaml',
    '.yml',
    '.txt',
    '.sft',
    '.safetensors.index.json',
  ];
  return fileExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}

async function getDefaultNodes(logger: Logger): Promise<CustomNode[]> {
  const nodes = await getDetailedNodes(logger);

  return nodes;
  return [
    {
      name: 'ComfyUI-Text-Translation',
      repository: 'https://github.com/pictorialink/ComfyUI-Text-Translation.git',
      version: '72b02a6184afe60838030fc28c369029856f6028',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Text-Translation',
      models: [],
    },
    {
      name: 'ComfyUI-Custom-Scripts',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom-Scripts.git',
      version: '',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom-Scripts',
      models: [],
    },
    {
      name: 'ComfyUI-QwenVL',
      repository: 'https://github.com/pictorialink/ComfyUI-QwenVL.git',
      version: '',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-QwenVL',
      models: [
        {
          url: 'https://huggingface.co/lmstudio-community/Qwen3-8B-MLX-4bit',
          path: 'models/LLM/Qwen3-8B-MLX-4bit',
          repoid: 'lmstudio-community/Qwen3-8B-MLX-4bit',
        },
      ],
    },
    // {
    //   name: 'ComfyUI_MiniCPM-V-2_6-int4',
    //   repository: 'https://github.com/pictorialink/ComfyUI-MiniCPM-V-2_6-int4.git',
    //   version: 'ed210d86d48a58712356e8ad0fac255eead94206',
    //   type: 'Community',
    //   install_path: 'custom_nodes/ComfyUI-MiniCPM-V-2_6-int4',
    //   models: [
    //     {
    //       url: 'https://huggingface.co/openbmb/MiniCPM-V-2_6-int4',
    //       path: 'models/prompt_generator/MiniCPM-V-2_6-int4',
    //       repoid:"openbmb/MiniCPM-V-2_6-int4"
    //     },
    //   ]
    // },
    {
      name: 'comfyui-mixlab-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-mixlab-nodes.git',
      version: 'c386fefa6c061fa52b2bc54dda03bdbfe9b2e095',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-mixlab-nodes',
      models: [],
    },
    {
      name: 'comfyui_controlnet_aux',
      repository: 'https://github.com/pictorialink/ComfyUI-controlnet_aux.git',
      version: '5a049bde9cc117dafc327cded156459289097ea1',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-controlnet_aux',
      models: [
        {
          url: 'https://huggingface.co/lllyasviel/Annotators',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/lllyasviel/Annotators',
          repoid: 'lllyasviel/Annotators',
        },
        {
          url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Large/depth_anything_v2_vitl.pth',
          repoid: 'depth-anything/Depth-Anything-V2-Large',
        },
        {
          url: 'https://huggingface.co/yzd-v/DWPose/resolve/main/yolox_l.onnx',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/yzd-v/DWPose/yolox_l.onnx',
          repoid: 'yzd-v/DWPose',
        },
        {
          url: 'https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/dw-ll_ucoco_384_bs5.torchscript.pt',
          repoid: 'hr16/DWPose-TorchScript-BatchSize5',
        },
      ],
    },
    {
      name: 'ComfyUI-Florence2',
      repository: 'https://github.com/pictorialink/ComfyUI-Florence2.git',
      version: '27714bad54f2c81180392bbcfa56e39c1ad1b991',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Florence2',
      models: [
        {
          url: 'https://huggingface.co/microsoft/Florence-2-large',
          path: 'models/LLM/Florence-2-large',
          repoid: 'microsoft/Florence-2-large',
        },
      ],
    },
    {
      name: 'ComfyUI-Advanced-ControlNet',
      repository: 'https://github.com/pictorialink/ComfyUI-Advanced-ControlNet.git',
      version: 'da254b700db562a22e03358b933c85a9a3392540',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Advanced-ControlNet',
      models: [],
    },
    {
      name: 'ComfyUI-BiRefNet-Hugo',
      repository: 'https://github.com/pictorialink/ComfyUI-BiRefNet-Hugo.git',
      version: '10660f6461d26106c045402dc97c789f4630753c',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-BiRefNet-Hugo',
      models: [],
    },
    {
      name: 'Comfyui_mobilesam',
      repository: 'https://github.com/pictorialink/ComfyUI-mobilesam.git',
      version: '153f8ba1d0f96f10657aa63237091449ced6285c',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-mobilesam',
      models: [
        {
          url: 'https://huggingface.co/dhkim2810/MobileSAM/resolve/main/mobile_sam.pt',
          path: 'models/sams/mobile_sam.pt',
          repoid: 'dhkim2810/MobileSAM',
        },
      ],
    },
    {
      name: 'ComfyUI-was-node-suite',
      repository: 'https://github.com/pictorialink/ComfyUI-was-node-suite.git',
      version: 'fe7e0884aaf0188248d9abf1e500f5116097fec1',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-was-node-suite',
      models: [],
    },
    {
      name: 'ComfyUI-efficiency-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-efficiency-nodes.git',
      version: 'b471390b88c9ac8a87c34ad9d882a520296b6fd8',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-efficiency-nodes',
      models: [],
    },
    {
      name: 'comfyui-inpaint-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-inpaint-nodes.git',
      version: '20092c37b9dfc481ca44e8577a9d4a9d426c0e56',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-inpaint-nodes',
      models: [],
    },
    {
      name: 'ComfyUI-tooling-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-tooling-nodes.git',
      version: '50d3479fba55116334ed9fb1ad15f13a9294badf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-tooling-nodes',
      models: [],
    },
    {
      name: 'ComfyUI-masquerade-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-masquerade-nodes.git',
      version: '432cb4d146a391b387a0cd25ace824328b5b61cf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-masquerade-nodes',
      models: [],
    },
    // {
    //   name: 'ComfyUI-AdvancedLivePortrait',
    //   repository: 'https://github.com/pictorialink/ComfyUI-AdvancedLivePortrait.git',
    //   version: '3bba732915e22f18af0d221b9c5c282990181f1b',
    //   type: 'Community',
    //   install_path: 'custom_nodes/ComfyUI-AdvancedLivePortrait',
    //   models: []
    // },
    {
      name: 'Comfyui_cgem156',
      repository: 'https://github.com/pictorialink/ComfyUI-cgem156.git',
      version: '7b85305c67af9117cddd335ff8b17e4e286080ef',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-cgem156',
      models: [],
    },
    {
      name: 'ComfyUI-YOLO',
      repository: 'https://github.com/pictorialink/ComfyUI-YOLO.git',
      version: '27bbe2d5777fc29c29f57cdd64ee805c8f3f345e',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-YOLO',
      models: [],
    },
    {
      name: 'ComfyUI-Universal-Styler',
      repository: 'https://github.com/pictorialink/ComfyUI-Universal-Styler.git',
      version: 'ed4a80231af20a81edc74f93b3c4e3de5e6f180c',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Universal-Styler',
      models: [],
    },
    {
      name: 'ComfyUI-Easy-Use',
      repository: 'https://github.com/pictorialink/ComfyUI-Easy-Use.git',
      version: '2c02a471d0bc2421359dcb2906c8f376287c8570',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Easy-Use',
      models: [],
    },
    {
      name: 'comfyui-lama-remover',
      repository: 'https://github.com/pictorialink/ComfyUI-lama-remover.git',
      version: '070c0226dfda85e29f2484a9ba321cc02ef8a6b0',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-lama-remover',
      models: [
        {
          url: 'https://huggingface.co/signature-ai/big-lama/resolve/main/big-lama.pt',
          path: 'models/lama/big-lama.pt',
          repoid: 'signature-ai/big-lama',
        },
      ],
    },
    {
      name: 'comfyui-gpt-agent',
      repository: 'https://github.com/pictorialink/ComfyUI-gpt-agent.git',
      version: 'd2b0e380df981a0c75c18db51a9f09f215ea5c29',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-gpt-agent',
      models: [],
    },
    {
      name: 'comfyui-mediapipe',
      repository: 'https://github.com/pictorialink/ComfyUI-mediapipe.git',
      version: '128af6d11ba9d7927e3ac895cf2366c13c9f7ddf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-mediapipe',
      models: [],
    },
    {
      name: 'ComfyUI_Custom_Nodes_AlekPet',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom_Nodes_AlekPet.git',
      version: '8562214047e53f7281b8bb6f6fc9785ae542d23d',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom_Nodes_AlekPet',
      models: [],
    },
    {
      name: 'ComfyUI_LayerStyle',
      repository: 'https://github.com/pictorialink/ComfyUI-LayerStyle.git',
      version: 'c0fb64d0ebcb81c6c445a8af79ecee24bc3845b0',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-LayerStyle',
      models: [],
    },
    {
      name: 'comfyui-static-resource',
      repository: 'https://github.com/pictorialink/ComfyUI-static-resource.git',
      version: '9a817d82979690b01227a6b5563a028729931ad7',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-static-resource',
      models: [],
    },
    {
      name: 'ComfyUI-Custom-Node-Config',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom-Node-Config.git',
      version: 'a48c2b5326413aaff67c88d7de2cfec57c9040ff',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom-Node-Config',
      models: [],
    },
    {
      name: 'comfyui-Core-cosxl',
      repository: '',
      version: '',
      type: 'Core',
      install_path: '',
      models: [
        {
          url: 'https://huggingface.co/koliskol/cosxl_edit/resolve/main/cosxl_edit.safetensors',
          path: 'models/checkpoints/cosxl_edit.safetensors',
          repoid: 'koliskol/cosxl_edit',
        },
        {
          url: 'https://huggingface.co/proyectorating/tsdxl/resolve/34e0762050ce52c18a9f506f4478438d127f7556/turbovisionxlSuperFastXLBasedOnNew_tvxlV32Bakedvae.safetensors',
          path: 'models/checkpoints/turbovisionxlSuperFastXLBasedOnNew_tvxlV32Bakedvae.safetensors',
          repoid: 'proyectorating/tsdxl',
        },
        {
          url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors',
          path: 'models/clip/t5xxl_fp16.safetensors',
          repoid: 'comfyanonymous/flux_text_encoders',
        },
        {
          url: 'https://huggingface.co/Qasadev/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors',
          path: 'models/controlnet/controlnet-union-sdxl-1.0.safetensors',
          repoid: 'Qasadev/controlnet-union-sdxl-1.0',
        },
        {
          url: 'https://huggingface.co/TencentARC/t2i-adapter-sketch-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors',
          path: 'models/controlnet/t2i-adapter-sketch-sdxl-1.0.fp16.safetensors',
          repoid: 'TencentARC/t2i-adapter-sketch-sdxl-1.0',
        },
        {
          url: 'https://huggingface.co/TencentARC/t2i-adapter-sketch-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors',
          path: 'models/controlnet/t2i-adapter-sketch-sdxl-1.0.fp16.safetensors',
          repoid: 'TencentARC/t2i-adapter-sketch-sdxl-1.0',
        },
        {
          url: 'https://huggingface.co/0-hero/FLUX.1-Fill-dev/resolve/main/flux1-fill-dev.safetensors',
          path: 'models/unet/flux1-fill-dev.safetensors',
          repoid: '0-hero/FLUX.1-Fill-dev',
        },
        {
          url: 'https://huggingface.co/Niansuh/FLUX.1-schnell/resolve/main/ae.sft',
          path: 'models/vae/ae.safetensors',
          repoid: 'Niansuh/FLUX.1-schnell',
        },
        {
          url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors',
          path: 'models/clip/clip_l.safetensors',
          repoid: 'comfyanonymous/flux_text_encoders',
        },
        {
          url: 'https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors',
          path: 'models/controlnet/controlnet-openpose-sdxl-1.0.safetensors',
          repoid: 'xinsir/controlnet-openpose-sdxl-1.0',
        },
        {
          url: 'https://huggingface.co/mbrhan/sdxl-vae-fp16-fix/resolve/main/diffusion_pytorch_model.safetensors',
          path: 'models/vae/sdxl_vae_fp16_fix.safetensors',
          repoid: 'mbrhan/sdxl-vae-fp16-fix',
        },
        {
          url: 'https://huggingface.co/Linaqruf/lcm-lora-sdxl-rank1/resolve/main/pytorch_lora_weights.safetensors',
          path: 'models/loras/sdxl_LCM_lora_rank1.safetensors',
          repoid: 'Linaqruf/lcm-lora-sdxl-rank1',
        },
        {
          url: 'https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth',
          path: 'models/upscale_models/4x-UltraSharp.pth',
          repoid: 'lokCX/4x-Ultrasharp',
        },
        {
          url: 'https://huggingface.co/lllyasviel/fooocus_inpaint/resolve/main/inpaint_v26.fooocus.patch',
          path: 'models/inpaint/fooocus/inpaint_v26.fooocus.pth',
          repoid: 'lllyasviel/fooocus_inpaint',
        },
        {
          url: 'https://huggingface.co/lllyasviel/fooocus_inpaint/resolve/main/fooocus_inpaint_head.pth',
          path: 'models/inpaint/fooocus/fooocus_inpaint_head.pth',
          repoid: 'lllyasviel/fooocus_inpaint',
        },
        {
          url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/CIS_V5.safetensors',
          path: 'models/lora/CIS_V5.safetensors',
          repoid: 'Pictorial/pic_lora',
        },
        {
          url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/modern_style.safetensors',
          path: 'models/lora/modern_style.safetensors',
          repoid: 'Pictorial/pic_lora',
        },
        {
          url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/pencil_sketch.safetensors',
          path: 'models/lora/pencil_sketch.safetensors',
          repoid: 'Pictorial/pic_lora',
        },
        {
          url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/simple_style.safetensors',
          path: 'models/lora/simple_style.safetensors',
          repoid: 'Pictorial/pic_lora',
        },
        {
          url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct', //线上使用版本
          path: 'models/LLM/Qwen2.5-7B-Instruct',
          repoid: 'Qwen/Qwen2.5-7B-Instruct',
        },
      ],
    },
  ];
}
