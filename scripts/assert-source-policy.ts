import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenPaths = tracked.filter(path => {
  const parts = path.toLowerCase().split('/');
  const base = parts.at(-1) ?? '';
  return (
    parts.includes('android') ||
    extname(base) === '.java' ||
    base === 'gradlew' ||
    base === 'gradlew.bat' ||
    base.endsWith('.gradle') ||
    base.endsWith('.gradle.kts')
  );
});

const executableConfig = tracked.filter(
  path =>
    path === 'package.json' ||
    path === 'Makefile' ||
    path.startsWith('.github/workflows/') ||
    ['.sh', '.command'].includes(extname(path)),
);
const jvmInvocation = /(^|[\s;&|])(?:java|javac|gradle|gradlew)(?=\s|$)/m;
const forbiddenInvocations = executableConfig.filter(path =>
  jvmInvocation.test(readFileSync(path, 'utf8')),
);

const violations = [...forbiddenPaths, ...forbiddenInvocations];
if (violations.length > 0) {
  process.stderr.write(
    `Unsupported Java/Gradle/Android source policy violations:\n${violations
      .sort()
      .map(path => `- ${path}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
}
