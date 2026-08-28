import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = resolve('src/verifier/verifierBundle.generated.ts');
const generate = (): string => {
  execFileSync('npm', ['run', 'verifier'], { stdio: 'ignore' });
  return createHash('sha256').update(readFileSync(output)).digest('hex');
};
const first = generate();
const second = generate();
if (first !== second)
  throw new Error('Verifier generation is not reproducible.');
process.stdout.write(`Verifier bundle reproducible: ${first}\n`);
