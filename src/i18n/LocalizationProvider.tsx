import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import NativeES3MacBridge from '../native/specs/NativeES3MacBridge';
import type { LanguagePreference } from '../native/specs/NativeES3MacBridge';
import { en, type Catalog, type TranslationKey } from './en';
import { hu } from './hu';

interface LocalizationValue {
  preference: LanguagePreference;
  language: 'en' | 'hu';
  setPreference(value: LanguagePreference): void;
  t(key: TranslationKey): string;
  formatDate(value: string | Date): string;
  formatBytes(value: number): string;
}

const LocalizationContext = createContext<LocalizationValue | undefined>(
  undefined,
);

function systemLanguage(): 'en' | 'hu' {
  return Intl.DateTimeFormat()
    .resolvedOptions()
    .locale.toLowerCase()
    .startsWith('hu')
    ? 'hu'
    : 'en';
}

export function LocalizationProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>('system');

  useEffect(() => {
    let active = true;
    void NativeES3MacBridge.getLanguagePreference().then(value => {
      if (active) setPreferenceState(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const language = preference === 'system' ? systemLanguage() : preference;
  const catalog: Catalog = language === 'hu' ? hu : en;
  const setPreference = useCallback((value: LanguagePreference) => {
    setPreferenceState(value);
    void NativeES3MacBridge.setLanguagePreference(value);
  }, []);
  const t = useCallback((key: TranslationKey) => catalog[key], [catalog]);
  const formatDate = useCallback(
    (value: string | Date) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(language, {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(date)
        : String(value);
    },
    [language],
  );
  const formatBytes = useCallback(
    (value: number) =>
      new Intl.NumberFormat(language, {
        style: 'unit',
        unit: 'byte',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }).format(value),
    [language],
  );
  const context = useMemo(
    () => ({ preference, language, setPreference, t, formatDate, formatBytes }),
    [preference, language, setPreference, t, formatDate, formatBytes],
  );
  return (
    <LocalizationContext.Provider value={context}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationValue {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error('LocalizationProvider is missing.');
  return value;
}
