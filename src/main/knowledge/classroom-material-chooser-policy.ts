import path from 'node:path';

import type { DesktopObservation, SurfaceElement } from '../agent/execution-contracts';

const chooserTitle = /open\s*with|choose\s+(?:an?\s+)?app(?:lication)?|select\s+an?\s+app|how do you want to open|chọn.*ứng dụng|mở bằng/iu;
const chooserHost = /^(?:open\s*with(?:\.exe)?|application picker|microsoft windows|windows shell experience host|shellexperiencehost(?:\.exe)?|finder|coreservicesuiagent)$/iu;
const controlRoles = /^(?:AX)?(?:button|list\s*item|radio\s*button|option|row|cell)$/iu;
const viewers: Record<string, RegExp> = {
  '.md': /^(?:notepad|textedit|visual studio code|vs code)(?:\.app)?$/iu,
  '.txt': /^(?:notepad|textedit|visual studio code|vs code)(?:\.app)?$/iu,
  '.pdf': /^(?:preview|adobe acrobat(?: reader)?|microsoft edge|google chrome)(?:\.app)?$/iu,
  '.png': /^(?:photos|microsoft photos|preview|paint)(?:\.app)?$/iu,
  '.jpg': /^(?:photos|microsoft photos|preview|paint)(?:\.app)?$/iu,
  '.jpeg': /^(?:photos|microsoft photos|preview|paint)(?:\.app)?$/iu,
  '.docx': /^(?:word|microsoft word|pages|libreoffice writer)(?:\.app)?$/iu,
  '.pptx': /^(?:powerpoint|microsoft powerpoint|keynote|libreoffice impress)(?:\.app)?$/iu,
  '.xlsx': /^(?:excel|microsoft excel|numbers|libreoffice calc)(?:\.app)?$/iu,
};

export function isMaterialAppChooser(observation: DesktopObservation): boolean {
  return observation.surface?.kind === 'native_app' &&
    chooserHost.test(observation.surface.application.trim()) &&
    chooserTitle.test([observation.surface.title, observation.text, ...(observation.elements ?? []).map((e) => e.name)].join('\n'));
}

export interface ChooserAction { element: SurfaceElement; kind: 'select_app' | 'open_once' | 'more_apps' | 'unset_default'; app?: string }

/** Only observed, one-time opening controls are authorized. Never set associations or install apps. */
export function materialChooserAction(observation: DesktopObservation, filename: string, selectedApp?: string): ChooserAction | undefined {
  if (!isMaterialAppChooser(observation)) return undefined;
  const extension = path.extname(filename).toLowerCase();
  const viewer = viewers[extension];
  if (!viewer) return undefined;
  const text = [observation.surface?.title, observation.text, ...(observation.elements ?? []).map((e) => e.name)].join('\n').toLowerCase();
  // Correlate the system picker with the file we just asked the OS to open.
  if (!text.includes(filename.toLowerCase()) && !text.includes(extension)) return undefined;
  const elements = (observation.elements ?? []).filter((e) => !e.disabled);
  const defaults = elements.filter((e) => /^(?:AX)?check\s*box$/iu.test(e.role) && /always use|always open|luôn/iu.test(e.name));
  if (defaults.length > 1 || defaults.some((e) => e.selected === undefined && !['0', '1', 'true', 'false'].includes(e.value ?? ''))) return undefined;
  const checked = defaults.find((e) => e.selected === true || e.value === '1' || e.value === 'true');
  if (checked) return { element: checked, kind: 'unset_default' };
  const controls = elements.filter((e) => controlRoles.test(e.role));
  const apps = controls.filter((e) => viewer.test(e.name.trim()));
  const chosen = apps.find((e) => e.selected || e.name === selectedApp);
  if (chosen) {
    const once = controls.filter((e) => /^(?:just once|only once|open|ok|chỉ một lần|mở)$/iu.test(e.name.trim()));
    if (once.length === 1) return { element: once[0]!, kind: 'open_once' };
    return undefined;
  }
  if (apps.length) return { element: apps[0]!, kind: 'select_app', app: apps[0]!.name };
  const more = controls.filter((e) => /^(?:more apps|show more apps|more applications|ứng dụng khác|thêm ứng dụng)$/iu.test(e.name.trim()));
  return more.length === 1 ? { element: more[0]!, kind: 'more_apps' } : undefined;
}
