import { useEffect, useRef, useState } from 'react';

import type { LessonLocalState, LessonMaterial } from '../../../shared/classroom-lesson-contracts';

export function ClassroomLessonMaterialPanel({ state, vi }: { state: LessonLocalState; vi: boolean }) {
  const [page, setPage] = useState<{ material: LessonMaterial; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const selectedPage = page?.revision === state.revision ? page.material : null;
  const material = selectedPage?.resource.id === state.material?.resource.id ? selectedPage : state.material;
  useEffect(() => {
    if (state.envelope.plan.schemaVersion === 3 || !material || material.resource.kind === 'web' || state.phase !== 'Opening material' || !window.tro.lessons)
      return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    panel.current?.scrollIntoView({ block: 'start' });
    const ack = () => {
      if (!live) return;
      const rect = panel.current?.getBoundingClientRect();
      const hasText = [material.text, ...material.chunks.map((chunk) => chunk.body)].some((text) => text?.trim());
      if (!hasText || document.visibilityState !== 'visible' || !rect || rect.width <= 0 || rect.height <= 0 ||
        rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
        timer = setTimeout(ack, 400);
        return;
      }
      const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
      if (!panel.current?.contains(document.elementFromPoint(x, y))) {
        timer = setTimeout(ack, 400);
        return;
      }
      void window.tro
        .lessons!.materialAck({
          lessonId: state.envelope.lessonId,
          revision: state.revision,
          resourceId: material.resource.id,
        })
        .catch(() => {
          if (live) timer = setTimeout(ack, 400);
        });
    };
    timer = setTimeout(ack, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state.envelope.lessonId, state.envelope.plan.schemaVersion, state.revision, state.phase, material]);
  if (!material || material.resource.kind === 'web') return null;
  return (
    <section ref={panel} className="lesson-material" aria-label={vi ? 'Tài liệu bài học' : 'Lesson material'}>
      <h4>{material.resource.title}</h4>
      {material.resource.kind === 'source_text' && (
        <small>{vi ? 'Văn bản trích xuất từ tài liệu' : 'Extracted source text'}</small>
      )}
      {material.text && <pre>{material.text}</pre>}
      {material.chunks.map((chunk) => (
        <div key={chunk.ordinal}>
          <small>
            {vi ? 'Đoạn' : 'Chunk'} {chunk.ordinal + 1}
          </small>
          <pre>{chunk.body}</pre>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {(selectedPage || material.nextOrdinal !== null) && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void window.tro.lessons
              ?.materialPage({
                lessonId: state.envelope.lessonId,
                resourceId: material.resource.id,
                ordinal: material.nextOrdinal ?? 0,
              })
              .then((material) => setPage({ material, revision: state.revision }))
              .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Material unavailable.'))
              .finally(() => setLoading(false));
          }}
        >
          {material.nextOrdinal === null
            ? vi
              ? 'Về đầu tài liệu'
              : 'Back to beginning'
            : vi
              ? 'Đọc phần tiếp theo'
              : 'Read next section'}
        </button>
      )}
    </section>
  );
}
