import { useEffect, useState } from 'react';

import type { LessonView } from '../../../shared/classroom-lesson-contracts';

export function useClassroomLesson() {
  const [view, setView] = useState<LessonView | null>(null);
  useEffect(() => {
    const api = window.tro.lessons;
    if (!api) return;
    let live = true;
    let changed = false;
    const stop = api.onChange((next) => {
      changed = true;
      if (live) setView(next);
    });
    void api
      .view()
      .then((next) => {
        if (live && !changed) setView(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return view;
}
