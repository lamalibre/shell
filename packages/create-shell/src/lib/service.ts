import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LaunchdPlistOpts {
  label: string;
  execPath: string;
  args: string[];
  logDir: string;
  logPrefix: string;
}

export interface SystemdUnitOpts {
  description: string;
  execStart: string;
  workingDir?: string;
}

export interface InstallServiceOpts {
  platform: 'darwin' | 'linux';
  name: string;
  execPath: string;
  args: string[];
  logDir: string;
}

export function generateLaunchdPlist(opts: LaunchdPlistOpts): string {
  const argsXml = [opts.execPath, ...opts.args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(opts.logDir, `${opts.logPrefix}-stdout.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(opts.logDir, `${opts.logPrefix}-stderr.log`))}</string>
</dict>
</plist>
`;
}

export function generateSystemdUnit(opts: SystemdUnitOpts): string {
  const workingDir = opts.workingDir ? `WorkingDirectory=${opts.workingDir}\n` : '';

  return `[Unit]
Description=${opts.description}
After=network.target

[Service]
Type=simple
ExecStart=${opts.execStart}
${workingDir}Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export async function installService(opts: InstallServiceOpts): Promise<void> {
  mkdirSync(opts.logDir, { recursive: true });

  if (opts.platform === 'darwin') {
    await installLaunchdService(opts);
  } else {
    await installSystemdService(opts);
  }
}

async function installLaunchdService(opts: InstallServiceOpts): Promise<void> {
  const home = homedir();
  const label = `com.lamalibre.${opts.name}`;
  const agentsDir = join(home, 'Library', 'LaunchAgents');
  const plistPath = join(agentsDir, `${label}.plist`);

  mkdirSync(agentsDir, { recursive: true });

  const plistContent = generateLaunchdPlist({
    label,
    execPath: opts.execPath,
    args: opts.args,
    logDir: opts.logDir,
    logPrefix: opts.name,
  });

  writeFileSync(plistPath, plistContent);

  try {
    // Unload first in case it's already loaded (ignore errors)
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'pipe' });
  } catch {
    // Ignore — service may not be loaded yet
  }

  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'pipe' });
}

async function installSystemdService(opts: InstallServiceOpts): Promise<void> {
  const home = homedir();
  const serviceDir = join(home, '.config', 'systemd', 'user');
  const servicePath = join(serviceDir, `${opts.name}.service`);

  mkdirSync(serviceDir, { recursive: true });

  const execStart = [opts.execPath, ...opts.args].join(' ');
  const unitContent = generateSystemdUnit({
    description: `Shell ${opts.name}`,
    execStart,
    workingDir: join(home, '.shell'),
  });

  writeFileSync(servicePath, unitContent);

  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  execFileSync('systemctl', ['--user', 'enable', '--now', opts.name], {
    stdio: 'pipe',
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
