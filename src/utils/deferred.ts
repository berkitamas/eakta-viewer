export interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

// Hermes in React Native 0.81 does not implement Promise.withResolvers.
export function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}
