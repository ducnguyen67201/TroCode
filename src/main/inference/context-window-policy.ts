const MAX_REQUEST_ITEMS = 128;

function withoutImages(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type !== 'function_call_output' || !Array.isArray(item.output)) {
    return item;
  }
  const output = item.output.filter(
    (content) =>
      !content ||
      typeof content !== 'object' ||
      Array.isArray(content) ||
      (content as Record<string, unknown>).type !== 'input_image',
  );
  return { ...item, output };
}

export function countCurrentImages(items: readonly Record<string, unknown>[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type !== 'function_call_output' || !Array.isArray(item.output)) {
      continue;
    }
    count += item.output.filter(
      (content) =>
        content &&
        typeof content === 'object' &&
        !Array.isArray(content) &&
        (content as Record<string, unknown>).type === 'input_image',
    ).length;
  }
  return count;
}

export function prepareContextWindow(
  items: readonly Record<string, unknown>[],
  includeCurrentImage: boolean,
): Array<Record<string, unknown>> {
  const bounded: Array<Record<string, unknown>> =
    items.length <= MAX_REQUEST_ITEMS
      ? [...items]
      : items[0]
        ? [items[0], ...items.slice(-(MAX_REQUEST_ITEMS - 1))]
        : [];
  let newestImageItem = -1;
  if (includeCurrentImage) {
    for (let index = bounded.length - 1; index >= 0; index -= 1) {
      const item = bounded[index];
      if (item && countCurrentImages([item]) > 0) {
        newestImageItem = index;
        break;
      }
    }
  }
  return bounded.map((item, index) =>
    index === newestImageItem ? item : withoutImages(item),
  );
}

export function demoteVisualEvidence(
  items: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  return items.map(withoutImages);
}
