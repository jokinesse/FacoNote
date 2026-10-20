// Helper to optimize, contrast-enhance, and prepare roofer photos/sketches/PDFs for Gemini Vision

export interface OptimizedImageResult {
  base64: string;
  mimeType: string;
  previewUrl: string;
  width?: number;
  height?: number;
}

/**
 * Optimizes an image or document for multimodal OCR.
 * Applies contrast enhancement so faint pencil lines, hand-drawn wings, and ballpoint cotes pop out clearly.
 */
export async function optimizeImageForOcr(
  file: File,
  rotationDeg = 0
): Promise<OptimizedImageResult> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return {
      base64,
      mimeType: 'application/pdf',
      previewUrl: '',
    };
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawUrl = e.target?.result as string;
      const img = new Image();

      img.onload = () => {
        try {
          const MAX_DIM = 2048;
          let { width, height } = img;

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          const isRotated90or270 = rotationDeg % 180 !== 0;

          canvas.width = isRotated90or270 ? height : width;
          canvas.height = isRotated90or270 ? width : height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({
              base64: rawUrl,
              mimeType: file.type || 'image/jpeg',
              previewUrl: rawUrl,
              width,
              height,
            });
            return;
          }

          // Handle rotation
          ctx.save();
          if (rotationDeg !== 0) {
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotationDeg * Math.PI) / 180);
            ctx.drawImage(img, -width / 2, -height / 2, width, height);
          } else {
            ctx.drawImage(img, 0, 0, width, height);
          }
          ctx.restore();

          // Contrast & clarity enhancement for pencil sketches
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const contrast = 1.15; // +15% contrast boost
            const intercept = 128 * (1 - contrast);

            for (let i = 0; i < data.length; i += 4) {
              data[i] = Math.min(255, Math.max(0, data[i] * contrast + intercept));
              data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * contrast + intercept));
              data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * contrast + intercept));
            }
            ctx.putImageData(imageData, 0, 0);
          } catch {
            // In case getImageData has cross-origin or buffer limits, continue safely
          }

          const optimized = canvas.toDataURL('image/jpeg', 0.94);
          resolve({
            base64: optimized,
            mimeType: 'image/jpeg',
            previewUrl: optimized,
            width: canvas.width,
            height: canvas.height,
          });
        } catch {
          resolve({
            base64: rawUrl,
            mimeType: file.type || 'image/jpeg',
            previewUrl: rawUrl,
          });
        }
      };

      img.onerror = () => {
        resolve({
          base64: rawUrl,
          mimeType: file.type || 'image/jpeg',
          previewUrl: rawUrl,
        });
      };

      img.src = rawUrl;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
