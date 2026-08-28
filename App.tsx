import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, PanelRight, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { DossierResult, LoadingPhase } from './src/domain/types';
import { DocumentPreview } from './src/components/DocumentPreview';
import { DossierSidebar } from './src/components/DossierSidebar';
import { EmptyState } from './src/components/EmptyState';
import { InformationSheet } from './src/components/InformationSheet';
import { ValidationInspector } from './src/components/ValidationInspector';
import { VerifierHost } from './src/components/VerifierHost';
import {
  LocalizationProvider,
  useLocalization,
} from './src/i18n/LocalizationProvider';
import type { TranslationKey } from './src/i18n/en';
import NativeES3MacBridge from './src/native/specs/NativeES3MacBridge';
import type {
  InputCapability,
  MenuCommand,
} from './src/native/specs/NativeES3MacBridge';
import {
  exportAllDocuments,
  exportSelectedDocument,
} from './src/services/exportService';

const LOADING_KEY: Record<LoadingPhase, TranslationKey> = {
  reading: 'loadingReading',
  parsing: 'loadingParsing',
  extracting: 'loadingExtracting',
  'refreshing-trust': 'loadingRefreshingTrust',
  validating: 'loadingValidating',
};
function AppContent(): React.JSX.Element {
  const { preference, setPreference, t } = useLocalization();
  const colorScheme = useColorScheme();
  const [input, setInput] = useState<InputCapability>();
  const [dossier, setDossier] = useState<DossierResult>();
  const [phase, setPhase] = useState<LoadingPhase>();
  const [error, setError] = useState<string>();
  const [dropActive, setDropActive] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [selectedSignatureId, setSelectedSignatureId] = useState<string>();
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [information, setInformation] = useState<'about' | 'privacy'>();
  const [notice, setNotice] = useState<string>();

  const selectedDocument = dossier?.documents.find(
    document => document.id === selectedDocumentId,
  );
  const selectedSignature = dossier?.signatures.find(
    signature => signature.id === selectedSignatureId,
  );

  const beginInput = useCallback((next: InputCapability) => {
    setInput(next);
    setDossier(undefined);
    setError(undefined);
    setPhase('reading');
    setSelectedDocumentId(undefined);
    setSelectedSignatureId(undefined);
  }, []);

  const openDossier = useCallback(async () => {
    const result = await NativeES3MacBridge.openDossier();
    if (result.status === 'selected' && result.input) beginInput(result.input);
  }, [beginInput]);

  const closeDossier = useCallback(() => {
    setInput(undefined);
    setDossier(undefined);
    setPhase(undefined);
    setError(undefined);
    setSelectedDocumentId(undefined);
    setSelectedSignatureId(undefined);
  }, []);

  const exportSelected = useCallback(async () => {
    if (!selectedDocument) return;
    const result = await exportSelectedDocument(selectedDocument);
    setNotice(
      result.status === 'exported'
        ? t('exportComplete')
        : result.status === 'cancelled'
        ? t('exportCancelled')
        : t('exportPartial'),
    );
  }, [selectedDocument, t]);

  const exportAll = useCallback(async () => {
    if (!dossier) return;
    const result = await exportAllDocuments(dossier.documents);
    setNotice(
      result.status === 'exported'
        ? t('exportComplete')
        : result.status === 'cancelled'
        ? t('exportCancelled')
        : t('exportPartial'),
    );
  }, [dossier, t]);

  const handleMenuCommand = useCallback(
    (event: MenuCommand) => {
      switch (event.command) {
        case 'about':
          setInformation('about');
          break;
        case 'verification-privacy':
          setInformation('privacy');
          break;
        case 'open-dossier':
          void openDossier();
          break;
        case 'close-dossier':
          void closeDossier();
          break;
        case 'export-selected':
          void exportSelected();
          break;
        case 'export-all':
          void exportAll();
          break;
        case 'documents':
          if (dossier?.documents[0]) {
            setSelectedDocumentId(dossier.documents[0].id);
            setSelectedSignatureId(undefined);
          }
          break;
        case 'signatures':
          if (dossier?.signatures[0]) {
            setSelectedSignatureId(dossier.signatures[0].id);
            setSelectedDocumentId(undefined);
          }
          break;
        case 'toggle-inspector':
          setInspectorVisible(value => !value);
          break;
        case 'language-system':
          setPreference('system');
          break;
        case 'language-en':
          setPreference('en');
          break;
        case 'language-hu':
          setPreference('hu');
          break;
      }
    },
    [
      closeDossier,
      dossier,
      exportAll,
      exportSelected,
      openDossier,
      setPreference,
    ],
  );

  useEffect(() => {
    const openSubscription = NativeES3MacBridge.onOpenFile(beginInput);
    const menuSubscription =
      NativeES3MacBridge.onMenuCommand(handleMenuCommand);
    return () => {
      openSubscription.remove();
      menuSubscription.remove();
    };
  }, [beginInput, handleMenuCommand]);

  useEffect(() => {
    void NativeES3MacBridge.setMenuState({
      hasDossier: Boolean(dossier),
      hasSelectedExportable: Boolean(selectedDocument?.exportable),
      canExportAll: Boolean(
        dossier?.documents.some(document => document.exportable),
      ),
      inspectorVisible,
      language: preference,
      labels: {
        about: t('menuAbout'),
        openDossier: t('menuOpen'),
        closeDossier: t('menuClose'),
        exportSelected: t('menuExportSelected'),
        exportAll: t('menuExportAll'),
        documents: t('menuDocuments'),
        signatures: t('menuSignatures'),
        showInspector: t('menuShowInspector'),
        hideInspector: t('menuHideInspector'),
        language: t('language'),
        system: t('languageSystem'),
        english: t('languageEnglish'),
        hungarian: t('languageHungarian'),
        verificationPrivacy: t('menuVerificationPrivacy'),
      },
    });
  }, [dossier, inspectorVisible, preference, selectedDocument?.exportable, t]);

  const previewLabels = useMemo(
    () => ({
      noSelection: t('noSelection'),
      locked: t('locked'),
      previewError: t('previewError'),
      truncated: t('previewTruncated'),
      fallback: t('previewFallback'),
    }),
    [t],
  );

  const selectDocument = useCallback((id: string) => {
    setSelectedDocumentId(id);
    setSelectedSignatureId(undefined);
  }, []);
  const selectSignature = useCallback((id: string) => {
    setSelectedSignatureId(id);
    setSelectedDocumentId(undefined);
  }, []);
  const handleVerifierError = useCallback((code: string) => {
    setError(code);
    setPhase(undefined);
  }, []);
  const handleVerifierResult = useCallback((result: DossierResult) => {
    setDossier(result);
    setPhase(undefined);
    const first =
      result.documents.find(
        document =>
          document.kind === 'primary' &&
          document.mimeType !== 'application/xml' &&
          document.mimeType !== 'text/xml' &&
          !document.mimeType.endsWith('+xml'),
      ) ?? result.documents[0];
    if (first) setSelectedDocumentId(first.id);
  }, []);

  return (
    <View
      draggedTypes="fileUrl"
      onDragEnter={() => setDropActive(true)}
      onDragLeave={() => setDropActive(false)}
      onDrop={event => {
        setDropActive(false);
        const uri = event.nativeEvent.dataTransfer?.files?.[0]?.uri;
        if (uri) {
          void NativeES3MacBridge.adoptDroppedFile(uri)
            .then(beginInput)
            .catch(() => setError('drop-failed'));
        }
      }}
      style={[styles.app, colorScheme === 'dark' && styles.appDark]}
      testID="app-root"
    >
      <VerifierHost
        input={input}
        onError={handleVerifierError}
        onPhase={setPhase}
        onResult={handleVerifierResult}
      />
      {!input && !dossier && !error ? (
        <EmptyState
          dropActive={dropActive}
          onOpen={() => void openDossier()}
          onPrivacy={() => setInformation('privacy')}
        />
      ) : null}
      {phase ? (
        <View style={styles.loading} testID={`loading-${phase}`}>
          <ActivityIndicator color="#2563EB" size="large" />
          <Text style={styles.loadingText}>{t(LOADING_KEY[phase])}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.loading} testID="dossier-error">
          <Text style={styles.errorTitle}>{t('errorTitle')}</Text>
          <Text style={styles.errorCode}>{error}</Text>
          <Pressable
            onPress={() => void closeDossier()}
            style={styles.secondaryButton}
          >
            <Text>{t('closeSheet')}</Text>
          </Pressable>
        </View>
      ) : null}
      {dossier && !phase ? (
        <View style={styles.workspace} testID="dossier-workspace">
          <DossierSidebar
            dossier={dossier}
            onSelectDocument={selectDocument}
            onSelectSignature={selectSignature}
            selectedDocumentId={selectedDocumentId}
            selectedSignatureId={selectedSignatureId}
          />
          <View style={styles.center}>
            <View style={styles.toolbar}>
              <Text numberOfLines={1} style={styles.toolbarTitle}>
                {selectedDocument?.title ??
                  selectedSignature?.signerName ??
                  dossier.metadata.title}
              </Text>
              <Pressable
                disabled={!selectedDocument?.exportable}
                onPress={() => void exportSelected()}
                style={styles.iconButton}
                testID="export-selected-button"
              >
                <Download
                  color={selectedDocument?.exportable ? '#2563EB' : '#9CA3AF'}
                  size={17}
                />
              </Pressable>
              <Pressable
                onPress={() => setInspectorVisible(value => !value)}
                style={styles.iconButton}
                testID="toggle-inspector-button"
              >
                <PanelRight color="#4B5563" size={17} />
              </Pressable>
              <Pressable
                onPress={() => void closeDossier()}
                style={styles.iconButton}
                testID="close-dossier-button"
              >
                <X color="#4B5563" size={17} />
              </Pressable>
            </View>
            <DocumentPreview
              document={selectedDocument}
              labels={previewLabels}
            />
            {notice ? (
              <Pressable
                onPress={() => setNotice(undefined)}
                style={styles.notice}
              >
                <Text>{notice}</Text>
              </Pressable>
            ) : null}
          </View>
          {inspectorVisible ? (
            <ValidationInspector
              dossier={dossier}
              document={selectedDocument}
              signature={selectedSignature}
            />
          ) : null}
        </View>
      ) : null}
      <InformationSheet
        mode={information}
        onClose={() => setInformation(undefined)}
      />
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <LocalizationProvider>
      <AppContent />
    </LocalizationProvider>
  );
}

const styles = StyleSheet.create({
  app: { backgroundColor: '#FFFFFF', flex: 1 },
  appDark: { backgroundColor: '#111827' },
  center: { flex: 1 },
  errorCode: {
    color: '#6B7280',
    fontFamily: 'Menlo',
    fontSize: 11,
    marginTop: 8,
  },
  errorTitle: { color: '#B91C1C', fontSize: 18, fontWeight: '700' },
  iconButton: {
    alignItems: 'center',
    borderColor: '#E5E7EB',
    borderRadius: 7,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    marginLeft: 8,
    width: 30,
  },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  loadingText: { color: '#4B5563', fontSize: 13, marginTop: 14 },
  notice: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    bottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    position: 'absolute',
    right: 16,
  },
  secondaryButton: {
    borderColor: '#D1D5DB',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toolbar: {
    alignItems: 'center',
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 96,
    paddingHorizontal: 16,
  },
  toolbarTitle: { color: '#111827', flex: 1, fontSize: 13, fontWeight: '600' },
  workspace: { flex: 1, flexDirection: 'row' },
});
