import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import App from '../App';

let mockMenuHandler: ((event: { command: 'language-hu' }) => void) | undefined;

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  const Icon = (props: object) => ReactRuntime.createElement(View, props);
  return {
    CheckCircle2: Icon,
    CircleAlert: Icon,
    CircleHelp: Icon,
    Download: Icon,
    FileCheck2: Icon,
    FileText: Icon,
    FolderOpen: Icon,
    PanelRight: Icon,
    Paperclip: Icon,
    PenLine: Icon,
    X: Icon,
  };
});

jest.mock('../src/native/specs/NativeES3MacBridge', () => ({
  __esModule: true,
  default: {
    acknowledgeNativeReady: jest.fn(async () => undefined),
    adoptDroppedFile: jest.fn(),
    cancelSession: jest.fn(async () => undefined),
    cleanupSession: jest.fn(async () => undefined),
    exportFile: jest.fn(),
    exportFiles: jest.fn(),
    getLanguagePreference: jest.fn(async () => 'en'),
    loadTrustCache: jest.fn(async () => ({ status: 'missing' })),
    onMenuCommand: jest.fn(
      (handler: (event: { command: 'language-hu' }) => void) => {
        mockMenuHandler = handler;
        return { remove: jest.fn() };
      },
    ),
    onOpenFile: jest.fn(() => ({ remove: jest.fn() })),
    openDossier: jest.fn(async () => ({ status: 'cancelled' })),
    setLanguagePreference: jest.fn(async () => undefined),
    setMenuState: jest.fn(async () => undefined),
  },
}));

jest.mock('react-native-webview', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  const MockWebView = (props: object) =>
    ReactRuntime.createElement(View, props);
  return { WebView: MockWebView };
});

jest.mock('../src/native/specs/QuickLookPreviewNativeComponent', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return (props: object) => ReactRuntime.createElement(View, props);
});

test('shows the private on-device empty state and disclaimer', async () => {
  const screen = await render(<App />);
  expect(screen.getByText('Open an e-Akta dossier')).toBeTruthy();
  await act(async () =>
    fireEvent.press(screen.getByText('Verification & Privacy')),
  );
  expect(
    screen.getByText(
      'e-Akta Viewer is an independent application. It is not affiliated with, endorsed by, or supported by Microsec Ltd. or the e‑Szignó service. Validation results are informational and do not replace an official qualified validation report.',
    ),
  ).toBeTruthy();
});

test('routes native language commands through the localization provider', async () => {
  const screen = await render(<App />);
  await act(async () => mockMenuHandler?.({ command: 'language-hu' }));
  expect(screen.getByText('e-Akta megnyitása')).toBeTruthy();
});
