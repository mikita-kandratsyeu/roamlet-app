import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const yarn = fileURLToPath(new URL('../.yarn/releases/yarn-4.18.1.cjs', import.meta.url));
const children = [
  spawn(process.execPath, [yarn, 'workspace', '@roamlet/proxy', 'dev'], {
    cwd: root,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [yarn, 'workspace', '@roamlet/client', 'dev', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(`Development process failed: ${error.code || 'unknown error'}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
