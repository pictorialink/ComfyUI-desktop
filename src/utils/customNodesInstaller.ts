import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import log from 'electron-log/main';
import { getDefaultInstallLocation } from '../../tests/shared/utils';



const execAsync = promisify(exec);

interface ModelConfig {
  url: string;
  path: string;
}
interface CustomNode {
  name: string;
  repository: string;
  version: string; 
  type: 'Community' | 'Core';
  install_path: string;
  models: ModelConfig[];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function installCustomNodes(logger:any): Promise<void> {
  try {
    const comfyDir = getDefaultInstallLocation();
    log.info('0000000000000000000000:', comfyDir);
    if (!fs.existsSync(comfyDir)) {
      log.warn('ComfyUI directory not found, skipping node installation');
      return;
    }
    const defaultNodes = getDefaultNodes();

    let userNodes: CustomNode[] = [];
    const nodesToInstall = [...defaultNodes, ...userNodes];
    for (const node of nodesToInstall) {
      await installSingleNode(node, comfyDir, comfyDir, logger);
    }
  } catch (error) {
    log.error('Custom nodes installation failed:', error);
  }
}

async function installSingleNode(node: CustomNode, customNodesDir: string, comfyDir: string, logger:any): Promise<void> {
  try {
    if (node.repository && node.install_path) {
      const nodeDir = path.join(customNodesDir, node.install_path);
      log.info(`Installing ${node.name} at ${nodeDir}`);
      if (!fs.existsSync(nodeDir)) {
        log.info(`Creating directory for ${node.name} at ${nodeDir}`);
        logger(`[Downloading nodes]Installing ${node.name}...\n`);
        let cloneCmd = `git clone ${node.repository} "${nodeDir}"`;
        execSync(cloneCmd, { stdio: 'inherit' });
        if (node.version) {
          execSync(`git -C "${nodeDir}" checkout ${node.version}`, { stdio: 'inherit' });
        }
        await installNodeRequirements(node, nodeDir, comfyDir);
      } 
    }
    log.info(`Installing ${node.name} models...`);
    for (const model of node.models) {
      if (model.url && model.path) {
        const modelPath = path.join(customNodesDir, model.path);
        logger(`[Downloading model] for ${node.name} from ${model.url} to ${modelPath}...\n`);
        fs.mkdirSync(path.dirname(modelPath), { recursive: true });
        await execAsync(`wget -q "${model.url}" -O "${modelPath}"`, { stdio: 'inherit' } as any); ;
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
        path: 'models/vae/ae.safetensors'
      },
      {
        url: 'https://huggingface.co/Linaqruf/lcm-lora-sdxl-rank1/resolve/main/pytorch_lora_weights.safetensors',
        path: 'models/loras/sdxl_LCM_lora_rank1.safetensors'
      }
    ],
    }
  ];
}