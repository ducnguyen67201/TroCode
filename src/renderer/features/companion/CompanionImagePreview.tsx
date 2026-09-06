import { useEffect, useRef } from 'react';

export function LocalImagePreview({
  file,
  label,
}: {
  file: File;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    let bitmap: ImageBitmap | null = null;
    void createImageBitmap(file)
      .then((decoded) => {
        if (!active) {
          decoded.close();
          return;
        }
        bitmap = decoded;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const scale = Math.max(
          canvas.width / decoded.width,
          canvas.height / decoded.height,
        );
        const width = decoded.width * scale;
        const height = decoded.height * scale;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          decoded,
          (canvas.width - width) / 2,
          (canvas.height - height) / 2,
          width,
          height,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [file]);

  return (
    <canvas
      aria-label={label}
      height={132}
      ref={canvasRef}
      role="img"
      width={132}
    />
  );
}

export function ImageIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect
        height="15"
        rx="2.5"
        stroke="currentColor"
        width="18"
        x="3"
        y="4.5"
      />
      <circle cx="8.25" cy="9.25" fill="currentColor" r="1.25" />
      <path
        d="m5.5 17 4.25-4.25 2.7 2.7 2.25-2.25 3.8 3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect
        height="10"
        rx="2.5"
        stroke="currentColor"
        width="14"
        x="5"
        y="10"
      />
      <path
        d="M8 10V8a4 4 0 0 1 8 0v2"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" fill="currentColor" r="1.25" />
    </svg>
  );
}
