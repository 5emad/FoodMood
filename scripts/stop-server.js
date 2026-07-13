#!/usr/bin/env node
const { execSync } = require('child_process');

const port = Number(process.env.PORT || 3000);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killWindows(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killUnix(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function findListeningPids(targetPort) {
  if (process.platform === 'win32') {
    const output = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: 'utf8' });
    return [...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes('LISTENING'))
        .map((line) => Number(line.split(/\s+/).pop()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    )];
  }

  try {
    const output = execSync(`lsof -ti tcp:${targetPort} -sTCP:LISTEN`, { encoding: 'utf8' });
    return [...new Set(output.split(/\r?\n/).map((v) => Number(v)).filter((pid) => pid > 0))];
  } catch {
    return [];
  }
}

const pids = findListeningPids(port).filter((pid) => pid !== process.pid);
if (!pids.length) {
  console.log(`هیچ سرویسی روی پورت ${port} در حال اجرا نیست.`);
  process.exit(0);
}

for (const pid of pids) {
  const killed = process.platform === 'win32' ? killWindows(pid) : killUnix(pid);
  if (killed) console.log(`پروسه ${pid} متوقف شد.`);
}

sleep(800);
console.log(`پورت ${port} آزاد شد.`);
