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
          repoId: model.repoid,
          outputDir,
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
      models: [
        {
          url: 'https://huggingface.co/lmstudio-community/Qwen3-8B-MLX-4bit',
          path: 'models/LLM/Qwen3-8B-MLX-4bit',
          repoid:"lmstudio-community/Qwen3-8B-MLX-4bit"
        },
      ]
    },
    {
      name: 'ComfyUI_MiniCPM-V-2_6-int4',
      repository: 'https://github.com/pictorialink/ComfyUI-MiniCPM-V-2_6-int4.git',
      version: 'ed210d86d48a58712356e8ad0fac255eead94206',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-MiniCPM-V-2_6-int4',
      models: [
        {
          url: 'https://huggingface.co/openbmb/MiniCPM-V-2_6-int4',
          path: 'models/prompt_generator/MiniCPM-V-2_6-int4',
          repoid:"openbmb/MiniCPM-V-2_6-int4"
        },
      ]
    },
    {
      name: 'comfyui-mixlab-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-mixlab-nodes.git',
      version: 'c386fefa6c061fa52b2bc54dda03bdbfe9b2e095',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-mixlab-nodes',
      models: []
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
          repoid:"lllyasviel/Annotators"
        },
        {
          url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Large/depth_anything_v2_vitl.pth',
          repoid:"depth-anything/Depth-Anything-V2-Large"
        },
        {
          url: 'https://huggingface.co/yzd-v/DWPose/resolve/main/yolox_l.onnx',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/yzd-v/DWPose/yolox_l.onnx',
          repoid:"yzd-v/DWPose"
        },
        {
          url: 'https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt',
          path: 'custom_nodes/ComfyUI-controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/dw-ll_ucoco_384_bs5.torchscript.pt',
          repoid:"hr16/DWPose-TorchScript-BatchSize5"
        },
      ]
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
          repoid:"microsoft/Florence-2-large"
        },
      ]
    },
    {
      name: 'ComfyUI-Advanced-ControlNet',
      repository: 'https://github.com/pictorialink/ComfyUI-Advanced-ControlNet.git',
      version: 'da254b700db562a22e03358b933c85a9a3392540',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Advanced-ControlNet',
      models: []
    },
    {
      name: 'ComfyUI-BiRefNet-Hugo',
      repository: 'https://github.com/pictorialink/ComfyUI-BiRefNet-Hugo.git',
      version: '10660f6461d26106c045402dc97c789f4630753c',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-BiRefNet-Hugo',
      models: []
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
          repoid:"dhkim2810/MobileSAM"
        },
      ]
    },
    {
      name: 'ComfyUI-was-node-suite',
      repository: 'https://github.com/pictorialink/ComfyUI-was-node-suite.git',
      version: 'fe7e0884aaf0188248d9abf1e500f5116097fec1',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-was-node-suite',
      models: []
    },
    {
      name: 'ComfyUI-efficiency-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-efficiency-nodes.git',
      version: 'b471390b88c9ac8a87c34ad9d882a520296b6fd8',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-efficiency-nodes',
      models: []
    },
    {
      name: 'comfyui-inpaint-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-inpaint-nodes.git',
      version: '20092c37b9dfc481ca44e8577a9d4a9d426c0e56',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-inpaint-nodes',
      models: []
    },
    {
      name: 'ComfyUI-tooling-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-tooling-nodes.git',
      version: '50d3479fba55116334ed9fb1ad15f13a9294badf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-tooling-nodes',
      models: []
    },
    {
      name: 'ComfyUI-masquerade-nodes',
      repository: 'https://github.com/pictorialink/ComfyUI-masquerade-nodes.git',
      version: '432cb4d146a391b387a0cd25ace824328b5b61cf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-masquerade-nodes',
      models: []
    },
    {
      name: 'ComfyUI-AdvancedLivePortrait',
      repository: 'https://github.com/pictorialink/ComfyUI-AdvancedLivePortrait.git',
      version: '3bba732915e22f18af0d221b9c5c282990181f1b',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-AdvancedLivePortrait',
      models: []
    },
    {
      name: 'Comfyui_cgem156',
      repository: 'https://github.com/pictorialink/ComfyUI-cgem156.git',
      version: '7b85305c67af9117cddd335ff8b17e4e286080ef',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-cgem156',
      models: []
    },
    {
      name: 'ComfyUI-YOLO',
      repository: 'https://github.com/pictorialink/ComfyUI-YOLO.git',
      version: '27bbe2d5777fc29c29f57cdd64ee805c8f3f345e',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-YOLO',
      models: []
    },
    {
      name: 'ComfyUI-Universal-Styler',
      repository: 'https://github.com/pictorialink/ComfyUI-Universal-Styler.git',
      version: 'ed4a80231af20a81edc74f93b3c4e3de5e6f180c',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Universal-Styler',
      models: []
    },
    {
      name: 'ComfyUI-Easy-Use',
      repository: 'https://github.com/pictorialink/ComfyUI-Easy-Use.git',
      version: '2c02a471d0bc2421359dcb2906c8f376287c8570',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Easy-Use',
      models: []
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
          repoid:"signature-ai/big-lama"
        },
      ]
    },
    {
      name: 'comfyui-gpt-agent',
      repository: 'https://github.com/pictorialink/ComfyUI-gpt-agent.git',
      version: 'd2b0e380df981a0c75c18db51a9f09f215ea5c29',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-gpt-agent',
      models: []
    },
    {
      name: 'comfyui-mediapipe',
      repository: 'https://github.com/pictorialink/ComfyUI-mediapipe.git',
      version: '128af6d11ba9d7927e3ac895cf2366c13c9f7ddf',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-mediapipe',
      models: []
    },
    {
      name: 'ComfyUI_Custom_Nodes_AlekPet',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom_Nodes_AlekPet.git',
      version: '8562214047e53f7281b8bb6f6fc9785ae542d23d',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom_Nodes_AlekPet',
      models: []
    },
    {
      name: 'ComfyUI_LayerStyle',
      repository: 'https://github.com/pictorialink/ComfyUI-LayerStyle.git',
      version: 'c0fb64d0ebcb81c6c445a8af79ecee24bc3845b0',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-LayerStyle',
      models: []
    },
    {
      name: 'comfyui-static-resource',
      repository: 'https://github.com/pictorialink/ComfyUI-static-resource.git',
      version: '9a817d82979690b01227a6b5563a028729931ad7',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-static-resource',
      models: []
    },
    {
      name: 'ComfyUI-Custom-Node-Config',
      repository: 'https://github.com/pictorialink/ComfyUI-Custom-Node-Config.git',
      version: 'a48c2b5326413aaff67c88d7de2cfec57c9040ff',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-Custom-Node-Config',
      models: []
    },
    {
      name: 'comfyui-static-resource',
      repository: 'https://github.com/pictorialink/ComfyUI-static-resource.git',
      version: '9a817d82979690b01227a6b5563a028729931ad7',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-static-resource',
      models: []
    },
    {
      name: 'comfyui-static-resource',
      repository: 'https://github.com/pictorialink/ComfyUI-static-resource.git',
      version: '9a817d82979690b01227a6b5563a028729931ad7',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-static-resource',
      models: []
    },
    {
      name: 'comfyui-static-resource',
      repository: 'https://github.com/pictorialink/ComfyUI-static-resource.git',
      version: '9a817d82979690b01227a6b5563a028729931ad7',
      type: 'Community',
      install_path: 'custom_nodes/ComfyUI-static-resource',
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
        url: "https://huggingface.co/koliskol/cosxl_edit/resolve/main/cosxl_edit.safetensors",
        path: "models/checkpoints/cosxl_edit.safetensors",
        repoid:"koliskol/cosxl_edit"
      },
      {
        url: "https://huggingface.co/proyectorating/tsdxl/resolve/34e0762050ce52c18a9f506f4478438d127f7556/turbovisionxlSuperFastXLBasedOnNew_tvxlV32Bakedvae.safetensors",
        path: "models/checkpoints/turbovisionxlSuperFastXLBasedOnNew_tvxlV32Bakedvae.safetensors",
        repoid:"proyectorating/tsdxl"
      },
      {
        url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors",
        path: "models/clip/t5xxl_fp16.safetensors",
        repoid:"comfyanonymous/flux_text_encoders"
      },
      {
        url: "https://huggingface.co/Qasadev/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors",
        path: "models/controlnet/controlnet-union-sdxl-1.0.safetensors",
        repoid:"Qasadev/controlnet-union-sdxl-1.0"
      },
      {
        url: "https://huggingface.co/TencentARC/t2i-adapter-sketch-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors",
        path: "models/controlnet/t2i-adapter-sketch-sdxl-1.0.fp16.safetensors",
        repoid:"TencentARC/t2i-adapter-sketch-sdxl-1.0"
      },
      {
        url: "https://huggingface.co/TencentARC/t2i-adapter-sketch-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors",
        path: "models/controlnet/t2i-adapter-sketch-sdxl-1.0.fp16.safetensors",
        repoid:"TencentARC/t2i-adapter-sketch-sdxl-1.0"
      },
      {
        url: "https://huggingface.co/0-hero/FLUX.1-Fill-dev/resolve/main/flux1-fill-dev.safetensors",
        path: "models/unet/flux1-fill-dev.safetensors",
        repoid:"0-hero/FLUX.1-Fill-dev"
      },
      {
        url: "https://huggingface.co/Niansuh/FLUX.1-schnell/resolve/main/ae.sft",
        path: "models/vae/ae.safetensors",
        repoid:"Niansuh/FLUX.1-schnell"
      },
      {
        url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
        path: "models/clip/clip_l.safetensors",
        repoid:"comfyanonymous/flux_text_encoders"
      },
      {
        url: "https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors",
        path: "models/controlnet/controlnet-openpose-sdxl-1.0.safetensors",
        repoid:"xinsir/controlnet-openpose-sdxl-1.0"
      },
      {
        url: "https://huggingface.co/mbrhan/sdxl-vae-fp16-fix/resolve/main/diffusion_pytorch_model.safetensors",
        path: "models/vae/sdxl_vae_fp16_fix.safetensors",
        repoid:"mbrhan/sdxl-vae-fp16-fix"
      },
      {
        url: "https://huggingface.co/Linaqruf/lcm-lora-sdxl-rank1/resolve/main/pytorch_lora_weights.safetensors",
        path: "models/loras/sdxl_LCM_lora_rank1.safetensors",
        repoid:"Linaqruf/lcm-lora-sdxl-rank1"
      },
      {
        url: "https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth",
        path: "models/upscale_models/4x-UltraSharp.pth",
        repoid:"lokCX/4x-Ultrasharp"
      },
      {
        url: "https://huggingface.co/lllyasviel/fooocus_inpaint/resolve/main/inpaint_v26.fooocus.patch",
        path: "models/inpaint/fooocus/inpaint_v26.fooocus.pth",
        repoid:"lllyasviel/fooocus_inpaint"
      },
      {
        url: "https://huggingface.co/lllyasviel/fooocus_inpaint/resolve/main/fooocus_inpaint_head.pth",
        path: "models/inpaint/fooocus/fooocus_inpaint_head.pth",
        repoid:"lllyasviel/fooocus_inpaint"
      },
      {
        url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/CIS_V5.safetensors',
        path: 'models/lora/CIS_V5.safetensors',
        repoid:"Pictorial/pic_lora"
      },
      {
        url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/modern_style.safetensors',
        path: 'models/lora/modern_style.safetensors',
        repoid:"Pictorial/pic_lora"
      },
      {
        url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/pencil_sketch.safetensors',
        path: 'models/lora/pencil_sketch.safetensors',
        repoid:"Pictorial/pic_lora"
      },
      {
        url: 'https://huggingface.co/Pictorial/pic_lora/resolve/main/simple_style.safetensors',
        path: 'models/lora/simple_style.safetensors',
        repoid:"Pictorial/pic_lora"
      },
      {
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct", //线上使用版本
        path: "models/LLM/Qwen2.5-7B-Instruct",
        repoid:"Qwen/Qwen2.5-7B-Instruct"
      }
    ],
    }
  ];
}

