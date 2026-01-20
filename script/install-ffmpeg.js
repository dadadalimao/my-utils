import { exec } from 'child_process';
import os from 'os';

const platform = os.platform();

console.log('检测到操作系统:', platform);

function checkFFmpeg(callback) {
  const checkCmd =
    platform === 'win32'
      ? 'powershell -Command "if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"'
      : 'command -v ffmpeg';

  exec(checkCmd, (error) => {
    if (!error) {
      console.log('检测到FFmpeg已安装，跳过安装步骤');
      callback(true);
    } else {
      console.log('未检测到FFmpeg，准备安装');
      callback(false);
    }
  });
}

checkFFmpeg((isInstalled) => {
  if (isInstalled) return;

  let command = '';

  switch (platform) {
    case 'win32':
      command =
        'powershell -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://chocolatey.org/install.ps1\')); choco install ffmpeg -y"';
      break;
    case 'darwin':
      command =
        'command -v brew > /dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)" && brew install ffmpeg';
      break;
    case 'linux':
      // 检测发行版
      const checkDistro = 'cat /etc/os-release | grep -E "^ID=" | cut -d= -f2';
      exec(checkDistro, (error, stdout) => {
        const distro = stdout.trim().replace(/"/g, '');
        console.log('检测到Linux发行版:', distro);

        if (distro === 'ubuntu' || distro === 'debian') {
          command = 'sudo apt-get update && sudo apt-get install -y ffmpeg';
        } else if (
          distro === 'centos' ||
          distro === 'rhel' ||
          distro === 'fedora'
        ) {
          command =
            'sudo yum install -y epel-release && sudo yum install -y ffmpeg';
        } else {
          console.warn('未知的Linux发行版，请手动安装FFmpeg');
          return;
        }

        runCommand(command);
      });
      return;
    default:
      console.warn('不支持的操作系统，请手动安装FFmpeg');
      return;
  }

  if (command) {
    runCommand(command);
  }
});

function runCommand(cmd) {
  console.log('执行命令:', cmd);
  exec(cmd, (error, stdout) => {
    if (error) {
      console.error('安装FFmpeg出错:', error);
      console.log('请手动安装FFmpeg，然后继续。');
      return;
    }
    console.log('FFmpeg安装成功');
    console.log(stdout);
  });
}
