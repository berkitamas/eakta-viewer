import { existsSync, readFileSync } from 'node:fs';

const podfile = readFileSync('macos/Podfile', 'utf8');
const project = readFileSync(
  'macos/EaktaViewer.xcodeproj/project.pbxproj',
  'utf8',
);
const failures: string[] = [];
if (!podfile.includes("ENV['RCT_NEW_ARCH_ENABLED'] = '1'"))
  failures.push('Podfile does not force New Architecture.');
if (!podfile.includes(':fabric_enabled => true'))
  failures.push('Fabric is not enabled.');
if (!podfile.includes(':hermes_enabled => true'))
  failures.push('Hermes is not enabled.');
if (!project.includes('EaktaViewer-macOS'))
  failures.push('macOS target is missing.');
if (/EaktaViewer-iOS|iphoneos|IPHONEOS_DEPLOYMENT_TARGET/.test(project))
  failures.push('Unsupported iOS target or build settings remain.');
if (
  !project.includes('path = "e-Akta Viewer.app"') ||
  project.includes('path = EaktaViewer.app')
)
  failures.push('macOS product reference is not e-Akta Viewer.app.');
const debugConfig =
  'macos/Pods/Target Support Files/Pods-EaktaViewer-macOS/Pods-EaktaViewer-macOS.debug.xcconfig';
if (existsSync(debugConfig)) {
  const config = readFileSync(debugConfig, 'utf8');
  if (!config.includes('RCT_NEW_ARCH_ENABLED=1'))
    failures.push('Installed Pods mix architecture modes.');
}
if (failures.length) throw new Error(failures.join('\n'));
