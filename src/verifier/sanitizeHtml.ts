import DOMPurify from 'dompurify';

export function sanitizeHtmlPreview(value: string): string {
  return String(
    DOMPurify.sanitize(value, {
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_ATTR: [
        'href',
        'src',
        'srcset',
        'style',
        'action',
        'formaction',
        'xlink:href',
      ],
      FORBID_TAGS: [
        'audio',
        'base',
        'embed',
        'form',
        'iframe',
        'img',
        'link',
        'math',
        'meta',
        'object',
        'script',
        'style',
        'svg',
        'video',
      ],
      RETURN_TRUSTED_TYPE: false,
    }),
  );
}
