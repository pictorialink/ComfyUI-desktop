import { HfInference } from '@huggingface/inference';
import axios from 'axios';
import fsExtra from 'fs-extra';
import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { promisify } from 'node:util';
import ProgressBar from 'progress';

const pipeline = promisify(stream.pipeline);

interface DownloadOptions {
  repoId: string; // 格式: "username/repo-name"
  files?: string[]; // 指定文件列表 (如 ["model.safetensors", "config.json"])
  folder?: string; // 指定文件夹 (如 "configs/")
  outputDir: string; // 本地存储路径
  hfToken?: string; // 可选: Hugging Face Token
  resume?: boolean; // 是否断点续传 (默认 true)
  concurrency?: number; // 并发下载数 (默认 3)
  url?: string; // 可选: 自定义下载URL (如果不使用Hugging Face API)
  callback?: (log: string) => void;
}

interface HuggingFaceFileItem {
  type: string;
  path: string;
}

export class HuggingFaceDownloader {
  private hf: HfInference;
  private options: DownloadOptions;
  private lastUpdateTime: number = 0; // 上次更新时间

  constructor(options: DownloadOptions) {
    this.options = {
      resume: true,
      concurrency: 3,
      ...options,
    };
    this.hf = new HfInference(this.options.hfToken);
  }

  /** 主下载方法 */
  public async download(): Promise<void> {
    try {
      await fsExtra.ensureDir(this.options.outputDir);
      const filesToDownload = await this.getFileList();
      console.log(`🔍 发现 ${filesToDownload} 个文件需要下载...`);
      console.log(`📂 输出目录: ${JSON.stringify(filesToDownload)}`);

      // 并发下载控制
      const batchSize = this.options.concurrency!;
      for (let i = 0; i < filesToDownload.length; i += batchSize) {
        const batch = filesToDownload.slice(i, i + batchSize);
        await Promise.all(batch.map((file) => this.downloadFile(file)));
      }

      console.log(`✅ 下载完成，路径: ${this.options.outputDir}`);
    } catch (error) {
      console.error('❌ 下载失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /** 获取文件列表 - 改用 Hugging Face API */
  private async getFileList(): Promise<string[]> {
    const { repoId, files, folder } = this.options;
    console.log(`📂 获取文件列表: ${repoId}${folder ? `/${folder}` : ''}`);
    console.log(`🔍 开始获取文件列表...${files}`);

    // 如果指定了具体文件，直接返回
    console.log(`🔍 指定的文件: ${files?.length}`);
    if (files?.length) {
      return files;
    }

    // 递归获取所有文件
    return await this.getFilesRecursively(repoId, folder || '');
  }

  /** 递归获取目录下的所有文件 */
  private async getFilesRecursively(repoId: string, currentPath: string): Promise<string[]> {
    const apiUrl = `https://huggingface.co/api/models/${repoId}/tree/main${currentPath ? `/${currentPath}` : ''}`;
    console.log(`📡 请求 URL: ${apiUrl}`);

    try {
      const response = await axios.get<HuggingFaceFileItem[]>(apiUrl, {
        headers: this.options.hfToken ? { Authorization: `Bearer ${this.options.hfToken}` } : {},
      });

      const allFiles: string[] = [];

      for (const item of response.data) {
        if (item.type === 'file') {
          // 如果是文件，直接使用API返回的完整路径
          allFiles.push(item.path);
        } else if (item.type === 'directory') {
          // 如果是目录，递归获取目录下的文件
          console.log(`📁 发现目录: ${item.path}，递归获取文件...`);
          const subFiles = await this.getFilesRecursively(repoId, item.path);
          allFiles.push(...subFiles);
        }
      }

      return allFiles;
    } catch (error) {
      console.error(`❌ 获取文件列表失败: ${apiUrl}`, error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /** 下载单个文件 (支持断点续传) */
  private async downloadFile(remotePath: string): Promise<void> {
    const { repoId, outputDir, resume } = this.options;
    const localPath = path.join(outputDir, remotePath);
    const tempPath = `${localPath}.tmp`;
    console.log(`⬇️ 开始下载: ${remotePath} 到 ${localPath}`);

    try {
      // 获取文件下载URL
      let fileUrl: string = this.options.url || '';
      if (!isSingleFile(fileUrl)) {
        fileUrl = `https://huggingface.co/${repoId}/resolve/main/${remotePath}`;
      }
      console.log(`📥 文件下载链接: ${fileUrl}`);

      // 检查本地是否已存在完整文件
      if (resume && (await this.checkFileComplete(localPath, fileUrl))) {
        console.log(`⏩ 已存在: ${remotePath}`);
        return;
      }

      // 创建目录
      await fsExtra.ensureDir(path.dirname(localPath));

      // 获取文件大小 (用于进度条)
      const fileSize = await this.getRemoteFileSize(fileUrl);
      const progressBar = new ProgressBar(`⬇️ ${remotePath} [:bar] :percent :etas`, { width: 40, total: fileSize });

      // 下载文件 (支持断点续传)
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream',
        headers: resume ? this.getResumeHeaders(tempPath) : {},
      });

      // 创建可写流 (追加模式)
      const writeStream = createWriteStream(tempPath, {
        flags: resume ? 'a' : 'w',
      });

      // 进度更新
      let downloadedBytes = 0;
      this.lastUpdateTime = 0; // 重置上次更新时间

      // 开始下载时的回调
      this.options.callback?.(`\n🚀 开始下载: ${remotePath}\n`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      response.data.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;

        progressBar.tick(chunk.length);

        // 每100ms更新一次进度显示，避免过于频繁的回调
        const now = Date.now();
        if (now - this.lastUpdateTime >= 100 && downloadedBytes > 0) {
          const progressString = this.formatProgressString(remotePath, downloadedBytes, fileSize);
          this.options.callback?.(`\r${progressString}`);
          this.lastUpdateTime = now;
        }
      });

      // 管道传输
      await pipeline(response.data, writeStream);
      // 重命名临时文件
      await fsExtra.move(tempPath, localPath, { overwrite: true });

      // 显示最终100%进度
      const finalProgressString = this.formatProgressString(remotePath, fileSize, fileSize);
      this.options.callback?.(`\r${finalProgressString}`);

      // 下载完成时的回调，换行显示完成信息
      this.options.callback?.(`\r✅ ${remotePath} 下载完成\n`);
    } catch (error) {
      await fsExtra.remove(tempPath).catch(() => {});
      console.error(
        `❌ 下载失败: ${remotePath}--${tempPath}--${localPath}`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  /** 检查远程文件大小 */
  private async getRemoteFileSize(url: string): Promise<number> {
    const response = await axios.head(url);
    const contentLength = response.headers['content-length'] as string;
    return Number.parseInt(typeof contentLength === 'string' ? contentLength : '0', 10);
  }

  /** 检查本地文件是否完整 */
  private async checkFileComplete(localPath: string, remoteUrl: string): Promise<boolean> {
    if (!fs.existsSync(localPath)) return false;
    try {
      const localSize = fs.statSync(localPath).size;
      const remoteSize = await this.getRemoteFileSize(remoteUrl);
      return localSize === remoteSize;
    } catch {
      return false;
    }
  }

  /** 断点续传请求头 */
  private getResumeHeaders(tempPath: string): Record<string, string> {
    if (!fs.existsSync(tempPath)) return {};
    const fileSize = fs.statSync(tempPath).size;
    return { Range: `bytes=${fileSize}-` };
  }

  /** 格式化进度条字符串，简洁版本 */
  private formatProgressString(remotePath: string, current: number, total: number): string {
    if (total === 0 || !total) return '';
    const percent = Math.round((current / total) * 100);
    const barWidth = 30;
    const completedWidth = Math.round((current / total) * barWidth);
    const remainingWidth = barWidth - completedWidth;

    // 生成进度条
    const bar = '█'.repeat(completedWidth) + '░'.repeat(remainingWidth);

    return `⬇️ ${remotePath} [${bar}] ${percent}%`;
  }
}

function isSingleFile(path: string): boolean {
  const fileExtensions: string[] = [
    '.patch',
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
