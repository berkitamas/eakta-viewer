export const ES3_NAMESPACE = 'https://www.microsec.hu/ds/e-szigno30#';
export const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
export const XADES_NAMESPACES: Record<string, true> = {
  'http://uri.etsi.org/01903/v1.2.2#': true,
  'http://uri.etsi.org/01903/v1.3.2#': true,
};

export const MAX_ES3_BYTES = 64 * 1024 * 1024;
export const MAX_TRANSFORMED_BYTES = 64 * 1024 * 1024;
export const MAX_COMPONENT_BYTES = 256 * 1024 * 1024;
export const MAX_TOTAL_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_HEX_PREVIEW_BYTES = 64 * 1024;
export const MAX_RAW_CHUNK_BYTES = 768 * 1024;
export const MAX_BASE64_MESSAGE_BYTES = 1024 * 1024;

export interface ExtractionBudget {
  totalExtracted: number;
}
