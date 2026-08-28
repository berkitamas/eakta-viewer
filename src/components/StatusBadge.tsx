import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VerificationStatus } from '../domain/types';
import { useLocalization } from '../i18n/LocalizationProvider';

interface StatusBadgeProps {
  status: VerificationStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  const { t } = useLocalization();
  const label =
    status === 'valid'
      ? t('statusValid')
      : status === 'invalid'
      ? t('statusInvalid')
      : t('statusIndeterminate');
  return (
    <View accessibilityLabel={label} style={[styles.badge, styles[status]]}>
      <Text style={[styles.text, styles[`${status}Text`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  indeterminate: { backgroundColor: '#FEF3C7' },
  indeterminateText: { color: '#92400E' },
  invalid: { backgroundColor: '#FEE2E2' },
  invalidText: { color: '#B91C1C' },
  text: { fontSize: 11, fontWeight: '600' },
  valid: { backgroundColor: '#DCFCE7' },
  validText: { color: '#15803D' },
});
