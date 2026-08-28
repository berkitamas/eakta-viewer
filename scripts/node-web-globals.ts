import { DOMParser } from '@xmldom/xmldom';

Object.defineProperty(globalThis, 'self', {
  value: globalThis,
  configurable: true,
});
Object.defineProperty(globalThis, 'DOMParser', {
  value: DOMParser,
  configurable: true,
});
