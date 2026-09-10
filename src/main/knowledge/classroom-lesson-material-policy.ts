import path from 'node:path';

import { z } from 'zod';

const LegacyNativeMaterialRecordSchema = z.object({
  path: z.string(), sha256: z.string(), status: z.enum(['selected', 'dispatching', 'opened', 'failed']),
}).strict();
export const PreparedMaterialRecordSchema = z.object({
  version: z.literal(2), path: z.string(), sha256: z.string(), legacyOutcomeUnknown: z.boolean(),
}).strict();
/** Read-only legacy decoder. New writes contain resource identity, never action status. */
export const NativeMaterialRecordSchema = z.union([PreparedMaterialRecordSchema, LegacyNativeMaterialRecordSchema])
  .transform((value) => 'version' in value ? value : {
    version: 2 as const, path: value.path, sha256: value.sha256,
    legacyOutcomeUnknown: value.status === 'dispatching',
  });
export type NativeMaterialRecord = z.infer<typeof PreparedMaterialRecordSchema>;

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
