import { OrganizationHomeBannerImageDataUrlSchema } from '../../../shared/contracts';

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Tro could not read this image.'));
    reader.onload = () => {
      const result = OrganizationHomeBannerImageDataUrlSchema.safeParse(
        reader.result,
      );
      if (!result.success) {
        reject(new Error('Tro could not read this image.'));
        return;
      }
      resolve(result.data);
    };
    reader.readAsDataURL(file);
  });
}
