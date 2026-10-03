import 'dotenv/config';
import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} failed with code ${code}`)));
    child.on('error', reject);
  });
}

const production=!process.argv.includes('--container')||process.env.NODE_ENV==='production';
if(production){process.env.NODE_ENV='production';await run('configuration', ['scripts/preflight.js','--config-only']);}
await run('db wait', ['scripts/wait-for-db.js']);
await run('db migrate', ['scripts/migrate.js']);
if(production)await run('preflight', ['scripts/preflight.js']);
const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: process.env });
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));
server.on('exit', code => process.exit(code ?? 0));
