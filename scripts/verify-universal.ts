import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function files(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...files(path));
    else if (stat.isFile()) result.push(path);
  }
  return result;
}

const app = resolve(process.argv[2] ?? 'dist/e-Akta Viewer.app');
const failures: string[] = [];
let machOCount = 0;
for (const path of files(app)) {
  const description = execFileSync('/usr/bin/file', ['-b', path], {
    encoding: 'utf8',
  });
  if (!description.includes('Mach-O')) continue;
  machOCount += 1;
  const architectures = execFileSync('/usr/bin/lipo', ['-archs', path], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/)
    .sort();
  if (architectures.join(' ') !== 'arm64 x86_64')
    failures.push(path.slice(app.length + 1));
}
if (machOCount === 0) throw new Error('The app contains no Mach-O files.');
if (failures.length > 0) {
  throw new Error(
    `Non-universal Mach-O files:\n${failures
      .map(path => `- ${path}`)
      .join('\n')}`,
  );
}
process.stdout.write(`Verified ${machOCount} universal Mach-O files.\n`);
