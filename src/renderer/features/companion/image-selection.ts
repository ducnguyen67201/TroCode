export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Tro could not read this image.'));
    reader.onload = () => {
      const result = reader.result;
      const prefix = `data:${file.type};base64,`;
      if (typeof result !== 'string' || !result.startsWith(prefix)) {
        reject(new Error('Tro could not read this image.'));
        return;
      }
      resolve(result.slice(prefix.length));
    };
    reader.readAsDataURL(file);
  });
}

export function firstFile(files: FileList | readonly File[]): File | null {
  return Array.from(files)[0] ?? null;
}

export function firstClipboardImage(items: DataTransferItemList): File | null {
  const imageItem = Array.from(items).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  return imageItem?.getAsFile() ?? null;
}
