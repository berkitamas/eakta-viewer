import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { DossierDocument } from '../../domain/types';
import { DocumentPreview, type PreviewLabels } from '../DocumentPreview';

jest.mock('react-native-webview', () => {
  const ReactRuntime = require('react');
  const { View: MockView } = require('react-native');
  return {
    WebView: (props: object) =>
      ReactRuntime.createElement(MockView, {
        ...props,
        testID: 'mock-webview',
      }),
  };
});

jest.mock('../../native/specs/QuickLookPreviewNativeComponent', () => {
  const ReactRuntime = require('react');
  const { View: MockView } = require('react-native');
  return (props: object) => ReactRuntime.createElement(MockView, props);
});

const labels: PreviewLabels = {
  noSelection: 'No selection',
  locked: 'Locked',
  previewError: 'Preview error',
  truncated: 'Preview truncated; export contains the complete document.',
  fallback: 'Hex fallback',
};

function documentWith(preview: DossierDocument['preview']): DossierDocument {
  return {
    id: 'document',
    kind: 'primary',
    title: 'Document',
    mimeType: 'text/plain',
    extension: 'txt',
    locked: false,
    exportable: true,
    extractionStatus: 'valid',
    preview,
  };
}

test('shows complete-export notice for truncated text', async () => {
  const screen = await render(
    <DocumentPreview
      document={documentWith({
        type: 'text',
        text: '<unsafe is escaped by Text>',
        truncated: true,
      })}
      labels={labels}
    />,
  );
  expect(screen.getByText(labels.truncated)).toBeTruthy();
  expect(screen.getByText('<unsafe is escaped by Text>')).toBeTruthy();
});

test.each([
  ['locked', { type: 'locked' as const }, 'preview-locked'],
  ['error', { type: 'error' as const, errorCode: 'broken' }, 'preview-error'],
  [
    'quick look',
    { type: 'quick-look' as const, previewPath: '/temporary/file', text: '00' },
    'preview-quick-look',
  ],
])('renders the %s preview state', async (_name, preview, testID) => {
  const screen = await render(
    <DocumentPreview document={documentWith(preview)} labels={labels} />,
  );
  expect(screen.getByTestId(testID)).toBeTruthy();
});

test('keeps a ready Quick Look preview after the fallback deadline', async () => {
  jest.useFakeTimers();
  const screen = await render(
    <DocumentPreview
      document={documentWith({
        type: 'quick-look',
        previewPath: '/temporary/file.pdf',
        text: '00',
      })}
      labels={labels}
    />,
  );
  await fireEvent(screen.getByTestId('preview-quick-look'), 'previewState', {
    nativeEvent: { state: 'ready' },
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6_000);
  });
  expect(screen.getByTestId('preview-quick-look')).toBeTruthy();
  expect(screen.queryByTestId('preview-hex-fallback')).toBeNull();
  jest.useRealTimers();
});
