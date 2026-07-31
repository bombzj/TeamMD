import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 32;
const saltLength = 16;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maximumMemory = 64 * 1024 * 1024;
const formatPrefix = 'scrypt-v1';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const derivedKey = await deriveKey(password, salt);

  return [
    formatPrefix,
    cost,
    blockSize,
    parallelization,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function passwordMatches(
  encodedHash: string,
  password: string,
): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== formatPrefix) return false;

  const [encodedCost, encodedBlockSize, encodedParallelization] = parts.slice(
    1,
    4,
  );
  if (
    encodedCost !== String(cost) ||
    encodedBlockSize !== String(blockSize) ||
    encodedParallelization !== String(parallelization)
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expectedKey = Buffer.from(parts[5]!, 'base64url');
    if (salt.length !== saltLength || expectedKey.length !== keyLength) {
      return false;
    }

    const actualKey = await deriveKey(password, salt);
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: maximumMemory,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}
