import 'dotenv/config';
import { spawn, execFile } from 'node:child_process';
import process from 'node:process';

const PORT = Number(process.env.PORT || 3000);
const BASE = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const AUTO_OPEN = String(process.env.AUTO_OPEN_BROWSER || 'true').toLowerCase() !== 'false';

function run(label, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${label} failed with code ${code}`)));
    child.on('error', reject);
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHttp(url, attempts = 60) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status >= 200 && r.status < 500) return true;
    } catch {}
    await wait(500);
  }
  return false;
}

function openBrowser(url) {
  if (!AUTO_OPEN) return;
  const platform = process.platform;
  if (platform === 'win32') {
    execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, err => {
      if (err) console.warn(`Could not open browser automatically: ${err.message}`);
    });
  } else if (platform === 'darwin') {
    execFile('open', [url], err => {
      if (err) console.warn(`Could not open browser automatically: ${err.message}`);
    });
  } else {
    execFile('xdg-open', [url], err => {
      if (err) console.warn(`Could not open browser automatically: ${err.message}`);
    });
  }
}

await run('db wait', ['scripts/wait-for-db.js']);
await run('db migrate', ['scripts/migrate.js']);

const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: process.env });
let opened = false;
const stop = () => server.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

const ready = await waitForHttp(BASE);
if (ready && !opened) {
  opened = true;
  console.log(`NovaCart is ready at ${BASE}`);
  openBrowser(`${BASE}/`);
}

if (!ready) {
  console.error(`Server did not become ready at ${BASE} within the startup window.`);
}

server.on('exit', code => process.exit(code ?? 0));
