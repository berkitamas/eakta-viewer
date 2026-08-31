import { bestEffortRevocationStatus } from '../revocation';

test('accepts unavailable revocation only after a valid trusted chain', () => {
  expect(bestEffortRevocationStatus('valid', 'indeterminate')).toBe('valid');
  expect(bestEffortRevocationStatus('indeterminate', 'indeterminate')).toBe(
    'indeterminate',
  );
});

test('explicit revocation remains invalid under best-effort policy', () => {
  expect(bestEffortRevocationStatus('valid', 'invalid')).toBe('invalid');
});
