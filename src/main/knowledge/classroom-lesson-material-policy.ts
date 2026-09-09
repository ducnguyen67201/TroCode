import path from 'node:path';

import { z } from 'zod';

export const NativeMaterialRecordSchema = z.object({
  path: z.string(), sha256: z.string(), status: z.enum(['selected', 'dispatching', 'opened', 'failed']),
}).strict();
export type NativeMaterialRecord = z.infer<typeof NativeMaterialRecordSchema>;

const formats: Record<string, readonly string[]> = {
  '.pdf': ['application/pdf'], '.txt': ['text/plain'], '.md': ['text/markdown', 'text/plain', 'text/x-markdown'],
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};
export function safeMaterialName(name: string, mediaType: string): string {
  const basename = name.replaceAll('\\', '/').split('/').pop() ?? '';
  const extension = path.extname(basename).toLowerCase();
  if (!formats[extension]?.includes(mediaType.split(';')[0]!.toLowerCase()))
    throw new Error('Open this format yourself, then choose its window in Tro.');
  const stem = path.basename(basename, path.extname(basename)).replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 120);
  if (!stem || stem === '.' || stem === '..') throw new Error('Invalid material filename.');
  return `${stem}${extension}`;
}
