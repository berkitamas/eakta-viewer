import React from 'react';
import { FileText, Paperclip, PenLine } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DossierResult } from '../domain/types';
import { useLocalization } from '../i18n/LocalizationProvider';
import { StatusBadge } from './StatusBadge';

interface DossierSidebarProps {
  dossier: DossierResult;
  selectedDocumentId?: string;
  selectedSignatureId?: string;
  onSelectDocument(id: string): void;
  onSelectSignature(id: string): void;
}

export function DossierSidebar({
  dossier,
  selectedDocumentId,
  selectedSignatureId,
  onSelectDocument,
  onSelectSignature,
}: DossierSidebarProps): React.JSX.Element {
  const { formatDate, t } = useLocalization();
  const primary = dossier.documents
    .filter(document => document.kind === 'primary')
    .sort((left, right) => {
      const leftXml =
        left.mimeType === 'application/xml' ||
        left.mimeType === 'text/xml' ||
        left.mimeType.endsWith('+xml');
      const rightXml =
        right.mimeType === 'application/xml' ||
        right.mimeType === 'text/xml' ||
        right.mimeType.endsWith('+xml');
      return Number(leftXml) - Number(rightXml);
    });
  const attachments = dossier.documents.filter(
    document => document.kind === 'signature-attachment',
  );
  return (
    <View style={styles.root} testID="dossier-sidebar">
      <View style={styles.header}>
        <Text numberOfLines={2} style={styles.dossierTitle}>
          {dossier.metadata.title}
        </Text>
        <StatusBadge status={dossier.status} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>{t('primaryDocuments')}</Text>
        {primary.map(document => (
          <Pressable
            accessibilityRole="button"
            key={document.id}
            onPress={() => onSelectDocument(document.id)}
            style={[
              styles.row,
              selectedDocumentId === document.id && styles.selectedRow,
            ]}
            testID={`document-${document.id}`}
          >
            <FileText color="#6B7280" size={16} />
            <View style={styles.rowContent}>
              <Text numberOfLines={2} style={styles.rowTitle}>
                {document.title}
              </Text>
              <Text style={styles.rowMeta}>{document.mimeType}</Text>
            </View>
          </Pressable>
        ))}
        {attachments.length > 0 ? (
          <Text style={styles.sectionTitle}>{t('signatureAttachments')}</Text>
        ) : null}
        {attachments.map(document => (
          <Pressable
            accessibilityRole="button"
            key={document.id}
            onPress={() => onSelectDocument(document.id)}
            style={[
              styles.row,
              selectedDocumentId === document.id && styles.selectedRow,
            ]}
            testID={`attachment-${document.id}`}
          >
            <Paperclip color="#6B7280" size={16} />
            <View style={styles.rowContent}>
              <Text numberOfLines={2} style={styles.rowTitle}>
                {document.title}
              </Text>
              <Text style={styles.rowMeta}>{document.mimeType}</Text>
            </View>
          </Pressable>
        ))}
        <Text style={styles.sectionTitle}>{t('signatures')}</Text>
        {dossier.signatures.map(signature => (
          <Pressable
            accessibilityRole="button"
            key={signature.id}
            onPress={() => onSelectSignature(signature.id)}
            style={[
              styles.signatureRow,
              selectedSignatureId === signature.id && styles.selectedRow,
            ]}
            testID={`signature-${signature.id}`}
          >
            <PenLine color="#6B7280" size={16} />
            <View style={styles.rowContent}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {signature.signerName || t('signerUnknown')}
              </Text>
              <Text style={styles.rowMeta}>
                {signature.trustedTime
                  ? formatDate(signature.trustedTime)
                  : t('noVerifiedTimestamp')}
              </Text>
              <StatusBadge status={signature.status} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12 },
  dossierTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  header: { borderBottomColor: '#E5E7EB', borderBottomWidth: 1, padding: 16 },
  root: {
    backgroundColor: '#F9FAFB',
    borderRightColor: '#E5E7EB',
    borderRightWidth: 1,
    width: 280,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  rowContent: { flex: 1, gap: 3 },
  rowMeta: { color: '#6B7280', fontSize: 11 },
  rowTitle: { color: '#1F2937', fontSize: 12, fontWeight: '500' },
  sectionTitle: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 16,
    textTransform: 'uppercase',
  },
  selectedRow: { backgroundColor: '#DBEAFE' },
  signatureRow: {
    alignItems: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
    padding: 10,
  },
});
