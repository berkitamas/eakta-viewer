import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const directory = mkdtempSync(resolve(tmpdir(), 'eakta-native-policy-'));
const binary = resolve(directory, 'policy-test');
try {
  execFileSync('xcrun', [
    'clang++',
    '-std=c++20',
    '-fobjc-arc',
    '-framework',
    'Foundation',
    'macos/EaktaViewer-macOS/ES3EvidenceBroker.mm',
    'test/native/ES3EvidenceBrokerTests.mm',
    '-o',
    binary,
  ]);
  execFileSync(binary);
} finally {
  rmSync(directory, { force: true, recursive: true });
}
