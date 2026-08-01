import { z } from 'zod';

const browserEnvironmentSchema = z.object({
  VITE_MERMAID_RENDERING_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type BrowserConfig = {
  mermaidRenderingEnabled: boolean;
};

export function parseBrowserConfig(
  environment: Record<string, string | boolean | undefined>,
): BrowserConfig {
  const parsed = browserEnvironmentSchema.parse(environment);
  return {
    mermaidRenderingEnabled: parsed.VITE_MERMAID_RENDERING_ENABLED === 'true',
  };
}
