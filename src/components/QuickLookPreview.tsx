import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QuickLookPreviewNativeComponent from '../native/specs/QuickLookPreviewNativeComponent';
import type { PreviewStateEvent } from '../native/specs/QuickLookPreviewNativeComponent';

interface QuickLookPreviewProps {
  previewPath: string;
  fallbackText: string;
  fallbackLabel: string;
}

export function QuickLookPreview({
  previewPath,
  fallbackText,
  fallbackLabel,
}: QuickLookPreviewProps): React.JSX.Element {
  const [fallback, setFallback] = useState(false);
  const cancelFallbackTimer = useRef<() => void>(() => {});

  useEffect(() => {
    setFallback(false);
    cancelFallbackTimer.current();
    const timeout = setTimeout(() => setFallback(true), 5_500);
    cancelFallbackTimer.current = () => clearTimeout(timeout);
    return () => cancelFallbackTimer.current();
  }, [previewPath]);

  if (fallback) {
    return (
      <View
        accessibilityLabel={fallbackLabel}
        style={styles.fallback}
        testID="preview-hex-fallback"
      >
        <Text style={styles.fallbackLabel}>{fallbackLabel}</Text>
        <Text selectable style={styles.hexText}>
          {fallbackText}
        </Text>
      </View>
    );
  }

  return (
    <QuickLookPreviewNativeComponent
      accessibilityLabel={fallbackLabel}
      onPreviewState={event => {
        const state: PreviewStateEvent['state'] = event.nativeEvent.state;
        if (state === 'ready') {
          cancelFallbackTimer.current();
        } else if (state === 'unsupported' || state === 'error') {
          cancelFallbackTimer.current();
          setFallback(true);
        }
      }}
      previewPath={previewPath}
      style={styles.preview}
      testID="preview-quick-look"
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    padding: 16,
  },
  fallbackLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  hexText: {
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 16,
  },
  preview: {
    flex: 1,
  },
});
