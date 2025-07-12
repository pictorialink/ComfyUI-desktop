import todesktop from '@todesktop/runtime';
import { app, ipcMain } from 'electron';
import log from 'electron-log/main';

import { useComfySettings } from '@/config/comfySettings';

import { DEFAULT_SERVER_ARGS, IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { DownloadManager } from '../models/DownloadManager';
import { HasTelemetry, ITelemetry } from '../services/telemetry';
import { Terminal } from '../shell/terminal';
import { findAvailablePort, getModelsDirectory } from '../utils';
import { installCustomNodes } from '../utils/customNodesInstaller';
import { VirtualEnvironment } from '../virtualEnvironment';
import { AppWindow } from './appWindow';
import type { ComfyInstallation } from './comfyInstallation';
import { ComfyServer } from './comfyServer';
import type { DevOverrides } from './devOverrides';

export class ComfyDesktopApp implements HasTelemetry {
  public comfyServer: ComfyServer | null = null;
  private terminal: Terminal | null = null; // Only created after server starts.
  constructor(
    readonly installation: ComfyInstallation,
    readonly appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {
    this.registerIPCHandlers();
    this.initializeTodesktop();
  }

  get basePath() {
    return this.installation.basePath;
  }

  get serverRunning() {
    return this.comfyServer?.isRunning ?? false;
  }

  /**
   * Build the server args to launch ComfyUI server.
   * @param useExternalServer Whether to use an external server instead of starting one locally.
   * @param COMFY_HOST Override the listen address (host) for the ComfyUI server.
   * @param COMFY_PORT Override the port for the ComfyUI server.
   * @returns The server args for the ComfyUI server.
   */
  async buildServerArgs({ useExternalServer, COMFY_HOST, COMFY_PORT }: DevOverrides): Promise<ServerArgs> {
    // Shallow-clone the setting launch args to avoid mutation.
    const serverArgs: ServerArgs = {
      listen: DEFAULT_SERVER_ARGS.listen,
      port: DEFAULT_SERVER_ARGS.port,
      ...useComfySettings().get('Comfy.Server.LaunchArgs'),
    };

    if (COMFY_HOST) serverArgs.listen = COMFY_HOST;
    if (COMFY_PORT) serverArgs.port = COMFY_PORT;

    // Find first available port (unless using external server).
    if (!useExternalServer) {
      const targetPort = Number(serverArgs.port);
      const port = await findAvailablePort(serverArgs.listen, targetPort, targetPort + 1000);
      serverArgs.port = String(port);
    }

    return serverArgs;
  }

  initializeTodesktop(): void {
    log.debug('Initializing todesktop');
    todesktop.init({
      autoCheckInterval: 60 * 60 * 1000, // every hour
      customLogger: log,
      updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
      autoUpdater: useComfySettings().get('Comfy-Desktop.AutoUpdate'),
    });
  }

  registerIPCHandlers(): void {
    // Restart core
    ipcMain.handle(IPC_CHANNELS.RESTART_CORE, async (): Promise<boolean> => await this.restartComfyServer());

    app.on('before-quit', () => {
      if (!this.comfyServer) return;

      log.info('Before-quit: Killing Python server');
      this.comfyServer.kill().catch((error) => {
        log.error('Python server did not exit properly', error);
      });
    });
  }

  /** Performs a process restart of the ComfyUI server. Does not discard instance / terminal. */
  async restartComfyServer(): Promise<boolean> {
    if (!this.comfyServer) return false;

    await this.comfyServer.kill();
    await this.comfyServer.start();
    return true;
  }

  async startComfyServer(serverArgs: ServerArgs) {
    log.info('Server start');
    if (!this.appWindow.isOnPage('server-start')) {
      await this.appWindow.loadPage('server-start');
    }

    DownloadManager.getInstance(this.appWindow, getModelsDirectory(this.basePath));
    await installCustomNodes(
      (str: any) => this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, str),
      process.env.GH_API_TOKEN || ''
    ).catch((error: Error) => {
      log.error('Error during custom nodes installation:', error);
    });

    const { virtualEnvironment } = this.installation;

    if (this.comfyServer?.isRunning) {
      log.error('ComfyUI server is already running');
      throw new Error('ComfyUI server is already running');
    }

    this.appWindow.sendServerStartProgress(ProgressStatus.STARTING_SERVER);
    this.comfyServer ??= new ComfyServer(this.basePath, serverArgs, virtualEnvironment, this.appWindow, this.telemetry);
    await this.comfyServer.start();
    this.initializeTerminal(virtualEnvironment);
  }

  async stopComfyServer() {
    const { comfyServer } = this;
    if (!comfyServer) return;

    if (comfyServer.isRunning) await comfyServer.kill();
    this.comfyServer = null;
  }

  private initializeTerminal(virtualEnvironment: VirtualEnvironment) {
    if (this.terminal) {
      try {
        this.terminal.pty.kill();
      } catch {
        // Do nothing.
      }
    }

    this.terminal = new Terminal(this.appWindow, this.basePath, virtualEnvironment.uvPath);
    this.terminal.write(virtualEnvironment.activateEnvironmentCommand());

    ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_WRITE);
    ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, command: string) => {
      this.terminal?.write(command);
    });

    ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_RESIZE);
    ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
      this.terminal?.resize(cols, rows);
    });

    ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_RESTORE);
    ipcMain.handle(IPC_CHANNELS.TERMINAL_RESTORE, () => {
      return this.terminal?.restore();
    });
  }
}
