import { describe, expect, it, vi } from 'vitest';

import { createServerShutdown } from './server-shutdown.js';

describe('createServerShutdown', () => {
  it('closes listeners and the database once across repeated calls', async () => {
    const closeApi = vi.fn().mockResolvedValue(undefined);
    const closeCollaboration = vi.fn().mockResolvedValue(undefined);
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined);
    const close = createServerShutdown({
      closeApi,
      closeCollaboration,
      disconnectDatabase,
    });

    await Promise.all([close(), close()]);

    expect(closeApi).toHaveBeenCalledTimes(1);
    expect(closeCollaboration).toHaveBeenCalledTimes(1);
    expect(disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  it('still releases the database when a listener fails to close', async () => {
    const failure = new Error('listener failed');
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined);
    const close = createServerShutdown({
      closeApi: vi.fn().mockRejectedValue(failure),
      closeCollaboration: vi.fn().mockResolvedValue(undefined),
      disconnectDatabase,
    });

    await expect(close()).rejects.toThrow(
      'Server shutdown did not complete cleanly.',
    );
    expect(disconnectDatabase).toHaveBeenCalledOnce();
  });
});
