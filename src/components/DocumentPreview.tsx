import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { DossierDocument } from '../domain/types';
import { QuickLookPreview } from './QuickLookPreview';

export interface PreviewLabels {
  noSelection: string;
  locked: string;
  previewError: string;
  truncated: string;
  fallback: string;
}

interface DocumentPreviewProps {
  document?: DossierDocument;
  labels: PreviewLabels;
}

function sanitizedHtmlDocument(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light dark}body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55;margin:20px;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid color-mix(in srgb,currentColor 25%,transparent);padding:6px}</style></head><body>${content}</body></html>`;
}

export function DocumentPreview({
  document,
  labels,
}: DocumentPreviewProps): React.JSX.Element {
  if (!document) {
    return (
      <View
        accessibilityLabel={labels.noSelection}
        style={styles.centered}
        testID="preview-empty"
      >
        <Text style={styles.secondary}>{labels.noSelection}</Text>
      </View>
    );
  }

  const preview = document.preview;
  if (preview.type === 'locked') {
    return (
      <View
        accessibilityLabel={labels.locked}
        style={styles.centered}
        testID="preview-locked"
      >
        <Text style={styles.messageTitle}>{labels.locked}</Text>
      </View>
    );
  }
  if (preview.type === 'error') {
    return (
      <View
        accessibilityLabel={labels.previewError}
        style={styles.centered}
        testID="preview-error"
      >
        <Text style={styles.messageTitle}>{labels.previewError}</Text>
        <Text style={styles.secondary}>{preview.errorCode}</Text>
      </View>
    );
  }
  if (preview.type === 'html' && preview.text !== undefined) {
    return (
      <View style={styles.root} testID="preview-html">
        {preview.truncated ? (
          <Text style={styles.notice}>{labels.truncated}</Text>
        ) : null}
        <WebView
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={request =>
            request.url === 'about:blank'
          }
          originWhitelist={['about:blank']}
          setSupportMultipleWindows={false}
          source={{
            html: sanitizedHtmlDocument(preview.text),
            baseUrl: 'about:blank',
          }}
          style={styles.webView}
        />
      </View>
    );
  }
  if (preview.type === 'text' && preview.text !== undefined) {
    return (
      <View style={styles.root} testID="preview-text">
        {preview.truncated ? (
          <Text style={styles.notice}>{labels.truncated}</Text>
        ) : null}
        <ScrollView contentContainerStyle={styles.textContent}>
          <Text selectable style={styles.monospace}>
            {preview.text}
          </Text>
        </ScrollView>
      </View>
    );
  }
  if (preview.type === 'quick-look' && preview.previewPath) {
    return (
      <QuickLookPreview
        fallbackLabel={labels.fallback}
        fallbackText={preview.text ?? ''}
        previewPath={preview.previewPath}
      />
    );
  }
  return (
    <View
      accessibilityLabel={labels.previewError}
      style={styles.centered}
      testID="preview-unsupported"
    >
      <Text style={styles.messageTitle}>{labels.previewError}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  messageTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  monospace: {
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
  notice: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  root: {
    flex: 1,
  },
  secondary: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 8,
  },
  textContent: {
    padding: 16,
  },
  webView: {
    flex: 1,
  },
});
