import React from 'react';
import { CheckCircle2, CircleAlert, CircleHelp } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  DossierDocument,
  DossierResult,
  SignatureResult,
  ValidationCheck,
} from '../domain/types';
import { useLocalization } from '../i18n/LocalizationProvider';
import type { TranslationKey } from '../i18n/en';
import { StatusBadge } from './StatusBadge';

interface ValidationInspectorProps {
  dossier: DossierResult;
  document?: DossierDocument;
  signature?: SignatureResult;
}

const CHECK_LABEL: Record<string, TranslationKey> = {
  canonicalization: 'checkCanonicalization',
  scope: 'checkScope',
  references: 'checkReferences',
  'signer-certificate': 'checkSignerCertificate',
  'signature-value': 'checkSignatureValue',
  timestamp: 'checkTimestamp',
  'timestamp-cms': 'checkTimestampCms',
  'timestamp-imprint': 'checkTimestampImprint',
  'timestamp-tsa-validity': 'checkTimestampTsaValidity',
  'tsa-chain': 'checkTsaChain',
  'signer-chain': 'checkSignerChain',
  'trust-missing': 'checkTrustMissing',
  'trust-stale': 'checkTrustStale',
  'trust-service-missing': 'checkTrustServiceMissing',
  'revocation-missing': 'checkRevocationMissing',
  'ocsp-signature': 'checkOcspSignature',
  'ocsp-revoked': 'checkOcspRevoked',
  'ocsp-good': 'checkOcspGood',
  'ocsp-freshness': 'checkOcspFreshness',
  'crl-signature': 'checkCrlSignature',
  'crl-revoked': 'checkCrlRevoked',
  'crl-good': 'checkCrlGood',
  'crl-freshness': 'checkCrlFreshness',
};

function CheckRow({ check }: { check: ValidationCheck }): React.JSX.Element {
  const { t } = useLocalization();
  const Icon =
    check.status === 'valid'
      ? CheckCircle2
      : check.status === 'invalid'
      ? CircleAlert
      : CircleHelp;
  const color =
    check.status === 'valid'
      ? '#15803D'
      : check.status === 'invalid'
      ? '#B91C1C'
      : '#B45309';
  return (
    <View style={styles.checkRow}>
      <Icon color={color} size={15} />
      <View style={styles.checkContent}>
        <Text style={styles.value}>{t(CHECK_LABEL[check.id] ?? 'checks')}</Text>
        {check.detail ? (
          <Text style={styles.secondary}>{check.detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function ValidationInspector({
  dossier,
  document,
  signature,
}: ValidationInspectorProps): React.JSX.Element {
  const { formatBytes, formatDate, t } = useLocalization();
  return (
    <View style={styles.root} testID="validation-inspector">
      <Text style={styles.title}>{t('inspectorTitle')}</Text>
      <ScrollView contentContainerStyle={styles.content}>
        {document ? (
          <>
            <Text style={styles.section}>{t('metadata')}</Text>
            <Field label={t('mimeType')} value={document.mimeType} />
            {document.sourceSize !== undefined ? (
              <Field
                label={t('sourceSize')}
                value={formatBytes(document.sourceSize)}
              />
            ) : null}
            {document.extractedSize !== undefined ? (
              <Field
                label={t('extractedSize')}
                value={formatBytes(document.extractedSize)}
              />
            ) : null}
            <StatusBadge status={document.extractionStatus} />
          </>
        ) : null}
        {signature ? (
          <>
            <Text style={styles.section}>{t('signer')}</Text>
            <Field label={t('signer')} value={signature.signerName} />
            {signature.signer ? (
              <>
                <Field label={t('issuer')} value={signature.signer.issuer} />
                <Field
                  label={t('serialNumber')}
                  value={signature.signer.serialNumber}
                />
                <Field
                  label={t('validFrom')}
                  value={formatDate(signature.signer.validFrom)}
                />
                <Field
                  label={t('validTo')}
                  value={formatDate(signature.signer.validTo)}
                />
                <Field
                  label={t('fingerprint')}
                  value={signature.signer.fingerprintSha256}
                  monospace
                />
              </>
            ) : null}
            <StatusBadge status={signature.status} />
            <Text style={styles.section}>{t('timestamps')}</Text>
            {signature.timestamps.map(timestamp => (
              <View key={timestamp.id} style={styles.card}>
                <StatusBadge status={timestamp.status} />
                {timestamp.generationTime ? (
                  <Field
                    label={t('timestampGenerated')}
                    value={formatDate(timestamp.generationTime)}
                  />
                ) : null}
                {timestamp.policyOid ? (
                  <Field
                    label={t('timestampPolicy')}
                    value={timestamp.policyOid}
                    monospace
                  />
                ) : null}
                {timestamp.imprintAlgorithm ? (
                  <Field
                    label={t('timestampImprint')}
                    value={timestamp.imprintAlgorithm}
                    monospace
                  />
                ) : null}
                {timestamp.checks.map(check => (
                  <CheckRow check={check} key={check.id} />
                ))}
              </View>
            ))}
            <Text style={styles.section}>{t('checks')}</Text>
            {signature.checks.map(check => (
              <CheckRow check={check} key={check.id} />
            ))}
          </>
        ) : null}
        {!document && !signature ? (
          <>
            <Text style={styles.section}>{t('metadata')}</Text>
            <Field label={t('fileName')} value={dossier.metadata.displayName} />
            <Field label={t('profile')} value={dossier.metadata.profile} />
            {dossier.metadata.dossierId ? (
              <Field
                label={t('dossierId')}
                value={dossier.metadata.dossierId}
              />
            ) : null}
            {dossier.metadata.createdAt ? (
              <Field
                label={t('createdAt')}
                value={formatDate(dossier.metadata.createdAt)}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={[styles.value, monospace && styles.monospace]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    marginBottom: 10,
    padding: 12,
  },
  checkContent: { flex: 1 },
  checkRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  content: { padding: 16 },
  field: { gap: 3, marginBottom: 12 },
  label: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  monospace: { fontFamily: 'Menlo', fontSize: 10 },
  root: {
    backgroundColor: '#FFFFFF',
    borderLeftColor: '#E5E7EB',
    borderLeftWidth: 1,
    width: 320,
  },
  secondary: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  section: {
    color: '#374151',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  title: {
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: 1,
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    padding: 16,
  },
  value: { color: '#1F2937', fontSize: 12, lineHeight: 17 },
});
