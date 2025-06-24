// import { path } from 'node:path';
// src/utils/customNodesInstaller.ts
import { execSync, exec, spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { app } from 'electron';
import log from 'electron-log/main';
import { getDefaultInstallLocation } from '../../tests/shared/utils';
import { HuggingFaceDownloader } from './download_model';


const execAsync = promisify(exec);

interface ModelConfig {
  url: string;
  path: string;
  repoid: string; 
}
interface CustomNode {
  name: string;
  repository: string;
  version: string;  // 保留commit hash
  type: 'Community' | 'Core';  // 明确两种类型
  install_path: string;
  models: ModelConfig[];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function installCustomNodes(logger:any): Promise<void> {
  try {
    // const comfyDir = path.join(app.getPath('home'), 'ComfyUI');
    const comfyDir = getDefaultInstallLocation();
    if (!fs.existsSync(comfyDir)) {
      log.warn('ComfyUI directory not found, skipping node installation');
      return;
    }

    const defaultNodes = getDefaultNodes();
    // 检查是否有用户自定义的节点配置
    // const userConfigPath = path.join(app.getPath('userData'), 'custom-nodes.json');
    // log.info('3333333333333333333userConfigPath:', userConfigPath);
    // if (fs.existsSync(userConfigPath)) {
    //   try {
    //     userNodes = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
    //   } catch (error) {
    //     log.error('Failed to parse user custom nodes config:', error);
    //   }
    // }
    let userNodes: CustomNode[] = [];
    const nodesToInstall = [...defaultNodes, ...userNodes];
    for (const node of nodesToInstall) {
      await installStart(node, comfyDir, comfyDir, logger);
    }
  } catch (error) {
    log.error('Custom nodes installation failed:', error);
  }
}


async function commandRun(command: string,logger:any): Promise<void> {
  const { execa } = await import('execa');
    const [cmd, ...args] = command.split(/\s+/);
    const subprocess = execa(cmd, args, {
      cwd: process.cwd(),
    });

    subprocess.stderr.on('data', (data) => {
      process.stderr.write(data); 
      logger(`[Downloading Progress]: ${data.toString().trim()}\n`); 
    });

    subprocess.stdout.on('data', (data) => {
      process.stdout.write(data);
      logger(`[Downloading Output]: ${data.toString().trim()}\n`);
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

async function installStart(node: CustomNode, customNodesDir: string, comfyDir: string, logger:any): Promise<void> {
  try {
    if (node.repository && node.install_path) {
      const nodeDir = path.join(customNodesDir, node.install_path);
      log.info(`Installing ${node.name} at ${nodeDir}`);
      if (!fs.existsSync(nodeDir)) {
        log.info(`Creating directory for ${node.name} at ${nodeDir}`);
        logger(`[Downloading] nodes]Installing ${node.name}...\n`);
        let cloneCmd = `git clone --progress ${node.repository} ${nodeDir}`;
        console.log(`Clone command: ${cloneCmd}`);

        try {
          console.log(`Cloning ${node.name} from ${node.repository} to ${nodeDir}...`);
          await commandRun(cloneCmd,logger);
          if (node.version) {
            cloneCmd = `git -C ${nodeDir} checkout ${node.version}`;
            await commandRun(cloneCmd,logger);
          }
        
        await installNodeRequirements(node, nodeDir, comfyDir,logger);
        } catch (error) {
          log.error(`Failed to clone ${node.name}:`, error);
          logger(`Failed to clone ${node.name}: ${error}\n`);
        }
        
      } else{
        log.info(`[Skipping] Directory for ${node.name} already exists, skipping clone.`);
        logger(`[Skipping] Directory for ${node.name} already exists, skipping clone.\n`);
      }
    }
    log.info(`Installing ${node.name} models...`);
    for (const model of node.models) {
      if (model.url && model.path) {
        let file:any = "";
        let outputDir: string = path.join(customNodesDir, model.path);
        if (fs.existsSync(outputDir)) {
          log.info(`Output directory or file already exists for ${node.name} ${outputDir}, skipping download.`);
          logger(`[Skipping] Output directory or file already exists for ${node.name}, skipping download.\n`);
          continue;
        }
        log.info(`Downloading model for ${node.name} from ${model.url} to ${outputDir}`);

        if (isSingleFile(model.path)) {
          file = model.path.split('/').pop();
          outputDir = path.dirname(outputDir);
        }
       
        const downloader = new HuggingFaceDownloader({
          repoId: model.repoid, // Hugging Face repo ID
          outputDir, // 本地存储路径
          folder: "",       // 下载整个文件夹
          files: file ? [file] : [],    // 下载指定文件列表
          // hfToken: "hf_your_token",    // 私有仓库需要Token
          concurrency: 1,          // 并发下载数
          url : model.url,
          callback: logger
        });
        await downloader.download();
      }
    }
    log.info(`[Successfully] installed/updated ${node.name}`);
    logger(`[Successfully] installed/updated ${node.name}\n`);
  } catch (error) {
    log.info(`[Failed] to install/update ${node.name}:`, error);
    logger(`[Failed] to install/update ${node.name}: ${error}\n`);
  }
}

async function installNodeRequirements(node: CustomNode, nodeDir: string, comfyDir: string,logger:any): Promise<void> {
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
      await commandRun(`${pythonPath} -m pip install -r ${requirementsPath}`,logger);

    } catch (error) {
      log.info('Trying with system Python...');
      await commandRun(`python -m pip install -r ${requirementsPath}`,logger);
    }
  }
}

function isSingleFile(path: string): boolean {
    const fileExtensions: string[] = ['.pth', '.onnx', '.pt', '.bin', '.safetensors', '.ckpt', '.vae', '.json', '.yaml', '.yml','.txt', '.sft', '.safetensors.index.json'];
    return fileExtensions.some(ext => path.toLowerCase().endsWith(ext));
}

async function downLoadeTwo(model: ModelConfig, node: CustomNode, customNodesDir: string, logger:any){
  if (isSingleFile(model.path)) {
      const modelPath = path.join(customNodesDir, model.path);
      logger(`[Downloading model] for ${node.name} from ${model.url} to ${modelPath}...\n`);
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      await execAsync(`wget -q "${model.url}" -O "${modelPath}"`, { stdio: 'inherit' } as any);

    } 

}




function getDefaultNodes(): CustomNode[] {
  return [
    {
      name: 'ComfyUI-Text-Translation',
      repository: 'https://github.com/pictorialink/ComfyUI-Text-Translation.git',
      version: '72b02a6184afe60838030fc28c369029856f6028',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Text-Translation',
      models: []
    },
    {
      name: 'ComfyUI-Custom-Scripts',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom-Scripts.git',
      version: '',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom-Scripts',
      models: []
    },
    {
      name: 'ComfyUI-QwenVL',
      repository: 'https://github.com/pictorialink/ComfyUI-QwenVL.git',
      version: '',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-QwenVL',
      models: []
    },

    {
      name: 'comfyui-Core-cosxl',
      repository: '',
      version: '',
      type: 'Core',
      install_path: '',
      models: [
      {
        url: 'https://huggingface.co/Niansuh/FLUX.1-schnell/resolve/main/ae.sft',
        path: 'models/vae/ae.safetensors',
        repoid:"Niansuh/FLUX.1-schnell"
      },
      {
        url: 'https://huggingface.co/Linaqruf/lcm-lora-sdxl-rank1/resolve/main/pytorch_lora_weights.safetensors',
        path: 'models/loras/sdxl_LCM_lora_rank1.safetensors',
        repoid:"Linaqruf/lcm-lora-sdxl-rank1"
      },
      {
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
        path: "models/LLM/Qwen2.5-7B-Instruct",
        repoid:"Qwen/Qwen2.5-7B-Instruct"
      },
      // {
      //   url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct",
      //   path: "models/LLM/Qwen2.5-Coder-0.5B-Instruct",
      //   repoid:"Qwen/Qwen2.5-Coder-0.5B-Instruct"
      // }
    ],
    }
  ];
}

