import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalization } from '../i18n/LocalizationProvider';

interface InformationSheetProps {
  mode?: 'about' | 'privacy';
  onClose(): void;
}

export function InformationSheet({
  mode,
  onClose,
}: InformationSheetProps): React.JSX.Element | null {
  const { t } = useLocalization();
  if (!mode) return null;
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.overlay}>
        <View
          accessibilityViewIsModal
          style={styles.sheet}
          testID={`${mode}-sheet`}
        >
          <Text style={styles.title}>
            {mode === 'about' ? t('about') : t('privacyTitle')}
          </Text>
          {mode === 'about' ? (
            <Text style={styles.version}>{t('aboutVersion')} 0.1.0</Text>
          ) : null}
          <Text style={styles.paragraph}>{t('privacyLocal')}</Text>
          <Text style={styles.paragraph}>{t('privacyNetwork')}</Text>
          <Text style={styles.disclaimer}>{t('disclaimer')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t('closeSheet')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  disclaimer: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 12,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    flex: 1,
    justifyContent: 'center',
  },
  paragraph: { color: '#4B5563', fontSize: 13, lineHeight: 20, marginTop: 10 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    maxWidth: 620,
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    width: '70%',
  },
  title: { color: '#111827', fontSize: 20, fontWeight: '700' },
  version: { color: '#6B7280', fontSize: 12, marginTop: 5 },
});
