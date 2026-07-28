import { parseServerConfig } from '@mymd/config';
import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { createPrismaClient } from './infrastructure/prisma.js';

dotenv.config({ path: '../../.env.local' });

const config = parseServerConfig(process.env);
const prisma = createPrismaClient();
const app = await buildApp({ config, prisma });

const close = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());

await app.listen({ host: config.host, port: config.port });
