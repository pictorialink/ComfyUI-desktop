// import { path } from 'node:path';
// src/utils/customNodesInstaller.ts
import { execSync, exec, spawn } from 'child_process';
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
    log.info('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    // const comfyDir = path.join(app.getPath('home'), 'ComfyUI');
    const comfyDir = getDefaultInstallLocation();
    log.info('0000000000000000000000:', comfyDir);
    if (!fs.existsSync(comfyDir)) {
      log.warn('ComfyUI directory not found, skipping node installation');
      return;
    }

    // const customNodesDir = path.join(comfyDir, 'custom_nodes');
    // log.info('22222222222222222222customNodesDir:', customNodesDir);

    // if (!fs.existsSync(customNodesDir)) {
    //   fs.mkdirSync(customNodesDir, { recursive: true });
    // }

    // 默认安装的节点列表
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

async function installStart(node: CustomNode, customNodesDir: string, comfyDir: string, logger:any): Promise<void> {
  try {
    if (node.repository && node.install_path) {
      const nodeDir = path.join(customNodesDir, node.install_path);
      log.info(`Installing ${node.name} at ${nodeDir}`);
      // if (!fs.existsSync(nodeDir)) {
      //   log.info(`Creating directory for ${node.name} at ${nodeDir}`);
      //   logger(`[Downloading nodes]Installing ${node.name}...\n`);
      //   let cloneCmd = `git clone ${node.repository} "${nodeDir}"`;
      //   execSync(cloneCmd, { stdio: 'inherit' });
      //   if (node.version) {
      //     execSync(`git -C "${nodeDir}" checkout ${node.version}`, { stdio: 'inherit' });
      //   }
      //   await installNodeRequirements(node, nodeDir, comfyDir);
      // } 
    }
    log.info(`Installing ${node.name} models...`);
    for (const model of node.models) {
      if (model.url && model.path) {
        let file:any = "";
        let outputDir: string = path.join(customNodesDir, model.path);
        if (isSingleFile(model.path)) {
          file = model.path.split('/').pop();
          outputDir = path.dirname(outputDir);
        }
        // 使用示例
       await (async () => {
          const downloader = new HuggingFaceDownloader({
            repoId: "Qwen/Qwen2.5-7B-Instruct",
            outputDir, // 本地存储路径
            folder: "",       // 下载整个文件夹
            files: file ? [file] : [],    // 下载指定文件列表
            // hfToken: "hf_your_token",    // 私有仓库需要Token
            concurrency: 3,          // 并发下载数
            url : model.url,
            callback: logger
          });
          await downloader.download();
        })();
         
      }
    }
    log.info(`Successfully installed/updated ${node.name}`);
    logger(`[Successfully] installed/updated ${node.name}\n`);
  } catch (error) {
    log.info(`Failed to install/update ${node.name}:`, error);
    logger(`Failed to install/update ${node.name}: ${error}\n`);
  }
}

async function installNodeRequirements(node: CustomNode, nodeDir: string, comfyDir: string): Promise<void> {
  const requirementsPath = path.join(nodeDir, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    log.info(`Installing Python dependencies for ${node.name}...`);
    try {
      const pythonPath = path.join(comfyDir, '.venv', 'bin', 'python');
      log.info('pythonPath:', pythonPath);
      if (!fs.existsSync(pythonPath)) {
        throw new Error('ComfyUI Python environment not found');
      }

      await execAsync(`${pythonPath} -m pip install -r "${requirementsPath}"`, {
        stdio: 'inherit'
      } as any);
    } catch (error) {
      log.error(`Failed to install requirements for ${node.name}:`, error);
      log.info('Trying with system Python...');
      try {
        await execAsync(`python -m pip install -r "${requirementsPath}"`, {
          stdio: 'inherit'
        } as any);
      } catch (sysError) {
        log.error(`System Python also failed for ${node.name}:`, sysError);
      }
    }
  }
}

function isSingleFile(path: string): boolean {
    const fileExtensions: string[] = ['.pth', '.onnx', '.pt', '.bin', '.safetensors', '.ckpt', '.vae', '.json', '.yaml', '.yml'];
    return fileExtensions.some(ext => path.toLowerCase().endsWith(ext));
}

async function downLoadeTwo(model: ModelConfig, node: CustomNode, customNodesDir: string, logger:any){
  if (isSingleFile(model.path)) {
      const modelPath = path.join(customNodesDir, model.path);
      logger(`[Downloading model] for ${node.name} from ${model.url} to ${modelPath}...\n`);
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      await execAsync(`wget -q "${model.url}" -O "${modelPath}"`, { stdio: 'inherit' } as any);

    } else {
      
    }

}

// async function downloadModel() {
//   try {
//     const repoId = 'repo_id'; // 替换为模型仓库ID
//     const localDir = 'local_dir'; // 替换为本地存储目录
//     const token = 'your_token'; // 替换为你的Hugging Face访问令牌，如果不需要可省略
//     `huggingface-cli download Linaqruf/lcm-lora-sdxl-rank1 pytorch_lora_weights.safetensors --local-dir ./models`

//     const command = `huggingface-cli download --resume-download ${repoId} --local-dir ${localDir} --local-dir-use-symlinks False ${token ? `--token ${token}` : ''}`;
//     await new Promise((resolve, reject) => {
//       exec(command, (error, stdout, stderr) => {
//         if (error) {
//           reject(error);
//         } else {
//           resolve(stdout);
//         }
//       });
//     });
//     console.log('模型下载完成');
//   } catch (error) {
//     console.error('模型下载失败:', error);
//   }
// }




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
      models: [
        {
          "url": "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
          "path": "models/LLM/Qwen2.5-7B-Instruct"
        }
      ]
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
        path: 'models/vae/ae.safetensors'
      },
      {
        url: 'https://huggingface.co/Linaqruf/lcm-lora-sdxl-rank1/resolve/main/pytorch_lora_weights.safetensors',
        path: 'models/loras/sdxl_LCM_lora_rank1.safetensors'
      },
      {
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
        path: "models/LLM/Qwen2.5-7B-Instruct"
      }
    ],
    }
  ];
}

function spawnAsync(command: string, args: string[], options: any) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output); // 实时输出标准输出
    });

    child.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      stderr += errorOutput;
      process.stderr.write(errorOutput); // 实时输出标准错误
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}