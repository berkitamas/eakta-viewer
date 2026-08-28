import { createDeferred } from '../../utils/deferred';

test('session cancellation uses a Hermes-compatible deferred promise', async () => {
  const deferred = createDeferred();
  deferred.resolve();
  await expect(deferred.promise).resolves.toBeUndefined();
});
