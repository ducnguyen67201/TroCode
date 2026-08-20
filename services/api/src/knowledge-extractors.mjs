import { createHash } from 'node:crypto';

const MAX_CHUNKS = 5_000;
const MAX_PAGES = 500;
const MAX_TEXT_CHARS = 2_000_000;

export async function readBoundedBody(body, expectedBytes, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw Object.assign(new Error('Object is too large.'), { code: 'object_too_large' });
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  if (expectedBytes && buffer.byteLength !== expectedBytes) throw Object.assign(new Error('Object size changed.'), { code: 'object_size_mismatch' });
  return buffer;
}

export function verifySha256(buffer, expectedHex) {
  return createHash('sha256').update(buffer).digest('hex') === expectedHex;
}

export function extractText(buffer) {
  const text = buffer.toString('utf8').replace(/\u0000/gu, '').normalize('NFC');
  if (!text.trim()) throw Object.assign(new Error('Text is empty.'), { code: 'empty_text' });
  if (text.length > MAX_TEXT_CHARS) throw Object.assign(new Error('Extracted text is too large.'), { code: 'extracted_text_too_large' });
  return { pages: [{ page: 1, text }], pageCount: 1 };
}

export async function extractPdf(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error('PDF signature is invalid.'), { code: 'invalid_pdf' });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
    if (document.numPages > MAX_PAGES) throw Object.assign(new Error('PDF has too many pages.'), { code: 'pdf_page_limit' });
    const pages = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const text = content.items.map((item) => typeof item.str === 'string' ? item.str : '').join(' ').replace(/\s+/gu, ' ').trim();
      characters += text.length;
      if (characters > MAX_TEXT_CHARS) throw Object.assign(new Error('Extracted PDF text is too large.'), { code: 'extracted_text_too_large' });
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    if (!pages.some((page) => page.text)) throw Object.assign(new Error('PDF contains no extractable text.'), { code: 'scanned_pdf_unsupported' });
    return { pages, pageCount: document.numPages };
  } catch (error) {
    if (/password|encrypted/iu.test(String(error?.message))) error.code = 'encrypted_pdf_unsupported';
    throw error;
  } finally {
    await document?.destroy();
  }
}

export function chunkExtractedPages(pages, { maxChars = 1_200, overlapChars = 150 } = {}) {
  const chunks = [];
  for (const page of pages) {
    const text = page.text.trim();
    for (let start = 0; start < text.length; start += Math.max(1, maxChars - overlapChars)) {
      const body = text.slice(start, start + maxChars).trim();
      if (!body) continue;
      if (chunks.length >= MAX_CHUNKS) {
        throw Object.assign(new Error('Source produced too many chunks.'), { code: 'chunk_limit' });
      }
      chunks.push({ ordinal: chunks.length, locator: { page: page.page, startCharacter: start }, body });
      if (start + maxChars >= text.length) break;
    }
  }
  return chunks;
}
