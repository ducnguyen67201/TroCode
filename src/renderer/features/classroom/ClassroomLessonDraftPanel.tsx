import { useEffect, useState } from 'react';

import type { LessonDraft } from '../../../shared/classroom-lesson-contracts';
import type { AppLanguage } from '../../../shared/contracts';

import { ClassroomLessonPreview } from './ClassroomLessonPreview';

export function ClassroomLessonDraftPanel({ appLanguage }: { appLanguage: AppLanguage }) {
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  useEffect(() => {
    let active = true;
    let prepared = false;
    void window.tro.lessons
      ?.recoverDraft()
      .then((next) => {
        if (active && !prepared) setDraft(next);
      })
      .catch(() => undefined);
    const stop = window.tro.lessons?.onPrepared((draftId) => {
      prepared = true;
      void window.tro
        .lessons!.draft({ draftId })
        .then((next) => {
          if (active) setDraft(next);
        })
        .catch(() => undefined);
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  return draft ? <ClassroomLessonPreview key={draft.draftId} draft={draft} onChange={setDraft} vi={appLanguage === 'vi'} /> : null;
}
