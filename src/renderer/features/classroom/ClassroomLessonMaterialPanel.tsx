import { useEffect, useState } from 'react';

import type { LessonLocalState, LessonMaterial } from '../../../shared/classroom-lesson-contracts';

export function ClassroomLessonMaterialPanel({ state, vi }: { state: LessonLocalState; vi: boolean }) {
  const [page, setPage] = useState<LessonMaterial | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setPage(null);
    setError('');
  }, [state.envelope.lessonId, state.material?.resource.id]);
  const material = page?.resource.id === state.material?.resource.id ? page : state.material;
  useEffect(() => {
    if (!material || material.resource.kind === 'web' || state.phase !== 'Opening material' || !window.tro.lessons)
      return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const ack = () => {
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
    ack();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state.envelope.lessonId, state.revision, state.phase, material?.resource.id]);
  if (!material || material.resource.kind === 'web') return null;
  return (
    <section className="lesson-material" aria-label={vi ? 'Tài liệu bài học' : 'Lesson material'}>
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
      {(page || material.nextOrdinal !== null) && (
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
              .then(setPage)
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
