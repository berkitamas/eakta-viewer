import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

function descendants(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...descendants(path), path);
    else if (stat.isFile()) result.push(path);
  }
  return result;
}

const app = resolve(process.argv[2] ?? 'dist/e-Akta Viewer.app');
const entitlements = resolve(
  'macos/EaktaViewer-macOS/EaktaViewer.entitlements',
);
const paths = descendants(app);
for (const path of paths) {
  if (statSync(path).isFile()) {
    const description = execFileSync('/usr/bin/file', ['-b', path], {
      encoding: 'utf8',
    });
    if (description.includes('Mach-O')) {
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path]);
    }
  }
}
for (const path of paths.filter(path =>
  ['.framework', '.xpc', '.appex'].includes(extname(path)),
)) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path]);
}
execFileSync('/usr/bin/codesign', [
  '--force',
  '--sign',
  '-',
  '--entitlements',
  entitlements,
  app,
]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
  stdio: 'inherit',
});
