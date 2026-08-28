import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import App from '../App';
import NativeES3MacBridge from '../src/native/specs/NativeES3MacBridge';

let mockMenuHandler: ((event: { command: string }) => void) | undefined;
let mockOpenHandler:
  | ((input: {
      sessionId: string;
      inputToken: string;
      displayName: string;
      size: number;
    }) => void)
  | undefined;

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
    adoptDroppedFile: jest.fn(async () => ({
      sessionId: 'drop-session',
      inputToken: 'drop-input',
      displayName: 'dropped.es3',
      size: 1,
    })),
    cancelSession: jest.fn(async () => undefined),
    cleanupSession: jest.fn(async () => undefined),
    exportFile: jest.fn(),
    exportFiles: jest.fn(),
    getLanguagePreference: jest.fn(async () => 'en'),
    loadTrustCache: jest.fn(async () => ({ status: 'missing' })),
    onMenuCommand: jest.fn((handler: (event: { command: string }) => void) => {
      mockMenuHandler = handler;
      return { remove: jest.fn() };
    }),
    onOpenFile: jest.fn(
      (
        handler: (input: {
          sessionId: string;
          inputToken: string;
          displayName: string;
          size: number;
        }) => void,
      ) => {
        mockOpenHandler = handler;
        return { remove: jest.fn() };
      },
    ),
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

test('close then open delegates cleanup ownership to VerifierHost', async () => {
  const screen = await render(<App />);
  await act(async () => {
    mockOpenHandler?.({
      sessionId: 'first-session',
      inputToken: 'first-input',
      displayName: 'first.es3',
      size: 1,
    });
  });
  await act(async () => mockMenuHandler?.({ command: 'close-dossier' }));
  expect(screen.getByText('Open an e-Akta dossier')).toBeTruthy();
  expect(NativeES3MacBridge.cancelSession).not.toHaveBeenCalled();
  expect(NativeES3MacBridge.cleanupSession).not.toHaveBeenCalled();
  await act(async () => {
    mockOpenHandler?.({
      sessionId: 'second-session',
      inputToken: 'second-input',
      displayName: 'second.es3',
      size: 1,
    });
  });
  expect(screen.getByTestId('loading-reading')).toBeTruthy();
  expect(screen.queryByText('session-start-failed')).toBeNull();
});

test('adopts a plain macOS drop path and surfaces no rejection', async () => {
  const screen = await render(<App />);
  await fireEvent(screen.getByTestId('app-root'), 'drop', {
    nativeEvent: {
      dataTransfer: { files: [{ uri: '/tmp/synthetic.es3' }] },
    },
  });
  expect(NativeES3MacBridge.adoptDroppedFile).toHaveBeenCalledWith(
    '/tmp/synthetic.es3',
  );
  expect(screen.queryByText('drop-failed')).toBeNull();
});

test('opens and closes privacy information from the native menu command', async () => {
  const screen = await render(<App />);
  await act(async () => mockMenuHandler?.({ command: 'verification-privacy' }));
  expect(screen.getByTestId('privacy-sheet')).toBeTruthy();
  await fireEvent.press(screen.getByText('Close'));
  expect(screen.queryByTestId('privacy-sheet')).toBeNull();
});
