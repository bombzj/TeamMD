export interface ServerResources {
  closeApi: () => Promise<void>;
  closeCollaboration: () => Promise<void>;
  disconnectDatabase: () => Promise<void>;
}

/**
 * Close independent listeners together, then release the database even if one
 * listener reports an error. The returned closure is idempotent so repeated
 * signals cannot race cleanup hooks.
 */
export function createServerShutdown(resources: ServerResources) {
  let shutdown: Promise<void> | undefined;

  return (): Promise<void> => {
    shutdown ??= runServerShutdown(resources);
    return shutdown;
  };
}

async function runServerShutdown(resources: ServerResources): Promise<void> {
  const listenerResults = await Promise.allSettled([
    resources.closeApi(),
    resources.closeCollaboration(),
  ]);
  const databaseResult = await Promise.allSettled([
    resources.disconnectDatabase(),
  ]);
  const errors = [...listenerResults, ...databaseResult]
    .filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    .map((result): unknown => result.reason as unknown);

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      'Server shutdown did not complete cleanly.',
    );
  }
}
