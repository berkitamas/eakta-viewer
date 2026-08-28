import React from 'react';
import { FileCheck2, FolderOpen } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalization } from '../i18n/LocalizationProvider';

interface EmptyStateProps {
  dropActive: boolean;
  onOpen(): void;
  onPrivacy(): void;
}

export function EmptyState({
  dropActive,
  onOpen,
  onPrivacy,
}: EmptyStateProps): React.JSX.Element {
  const { t } = useLocalization();
  return (
    <View
      accessibilityLabel={dropActive ? t('dropActive') : t('emptyTitle')}
      style={[styles.root, dropActive && styles.dropActive]}
      testID="empty-drop-target"
    >
      <View style={styles.logo}>
        <FileCheck2 color="#FFFFFF" size={54} strokeWidth={2.2} />
      </View>
      <Text style={styles.title}>
        {dropActive ? t('dropActive') : t('emptyTitle')}
      </Text>
      <Text style={styles.description}>{t('emptyDescription')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={styles.button}
        testID="open-dossier-button"
      >
        <FolderOpen color="#FFFFFF" size={17} />
        <Text style={styles.buttonText}>{t('open')}</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={onPrivacy}>
        <Text style={styles.link}>{t('emptyPrivacyLink')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  description: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
    maxWidth: 480,
    textAlign: 'center',
  },
  dropActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  link: { color: '#2563EB', fontSize: 12 },
  logo: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 24,
    height: 112,
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#1D4ED8',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    width: 112,
  },
  root: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: '#D1D5DB',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    marginVertical: 'auto',
    maxWidth: 720,
    minHeight: 460,
    padding: 48,
    width: '80%',
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
});
