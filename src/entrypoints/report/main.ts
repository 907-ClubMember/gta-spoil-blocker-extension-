// Beta build only. The local page behind "This looks wrong": the picture, a short summary of the structure, an optional note in the
// reporter's own words, three buttons (the last with an optional choice of what went wrong with a label or click).
// A button writes two files to Downloads/gsb-reports (the JSON, then the screenshot as .png with the same stem) and nothing else.
// No network: the files are made from this page's own data. The screenshot can hold spoilers and private content and stays on this
// computer; whoever reads a report opens the JSON only (structure, no page text).
import { REPORT_KINDS, KIND_LABEL, GET_REPORT_MSG, PNG_WARNING, SAVED_TEXT, NOTE_LABEL, NOTE_HINT, NOTE_MAX, CLICK_PROBLEMS, CLICK_PROBLEM_LABEL, CLICK_PROBLEM_LEGEND } from '../../beta/strings';
import { buildReport, isClickProblem, reportPaths } from '../../beta/report-format';
import type { Pending } from '../../beta/background';

const app = document.getElementById('app')!;
const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = app) => {
  const e = document.createElement(tag);
  e.textContent = text;
  parent.append(e);
  return e;
};

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function save(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }); } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

async function main() {
  add('h1', 'This looks wrong');
  add('p', PNG_WARNING);
  const id = new URLSearchParams(location.search).get('id');
  const r = (await chrome.runtime.sendMessage({ type: GET_REPORT_MSG, id })) as { item?: Pending | null } | undefined;
  const item = r?.item;
  if (!item) return void add('p', 'This report was already opened or is gone (each report opens once). Start This looks wrong again (right-click menu, popup button or shortcut).');
  if (item.screenshot) { const img = add('img'); img.src = item.screenshot; img.alt = 'screenshot of the tab'; img.id = 'shot'; } else add('p', 'No screenshot could be taken.');
  const s = item.snapshot;
  add('h2', 'What will be saved from the page (structure only)');
  add('pre', s ? JSON.stringify({ site: s.site, window: s.window, click: s.click, counts: s.counts, skeletonElements: s.skeleton?.nodes ?? null }, null, 1) : 'No page structure (the page has no content script).').id = 'summary';
  // The reporter's own words: read back only as the textarea's value, and saved in the JSON only (cleaned by buildReport).
  const label = add('label', NOTE_LABEL);
  label.htmlFor = 'note';
  const note = add('textarea');
  note.id = 'note';
  note.rows = 4;
  note.maxLength = NOTE_MAX;
  note.setAttribute('aria-describedby', 'note-hint');
  add('p', NOTE_HINT).id = 'note-hint';
  // The label or click button comes with its own optional choice of what happened.
  const box = document.createElement('fieldset');
  add('legend', CLICK_PROBLEM_LEGEND, box);
  for (const p of CLICK_PROBLEMS) {
    const row = add('label', '', box);
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'clickProblem';
    radio.value = p;
    row.append(radio, ` ${CLICK_PROBLEM_LABEL[p]}`);
  }
  const status = document.createElement('p');
  status.id = 'status';
  for (const kind of REPORT_KINDS) {
    const b = add('button', KIND_LABEL[kind], kind === 'label-click' ? box : app);
    b.dataset.kind = kind;
    b.addEventListener('click', async () => {
      for (const x of app.querySelectorAll('button')) x.disabled = true;
      try {
        const when = new Date();
        const paths = reportPaths(when, kind);
        const picked = box.querySelector<HTMLInputElement>('input[name="clickProblem"]:checked')?.value;
        const report = buildReport({ kind, when, version: item.version, zoom: item.zoom, hasScreenshot: !!item.screenshot, snapshot: s, note: note.value, clickProblem: isClickProblem(picked) ? picked : undefined });
        await save(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), paths.json);
        if (item.screenshot) await save(new Blob([dataUrlBytes(item.screenshot) as BlobPart], { type: 'image/png' }), paths.png);
        status.textContent = SAVED_TEXT;
      } catch (e) {
        status.textContent = `Not saved: ${e instanceof Error ? e.message : 'error'}`;
        for (const x of app.querySelectorAll('button')) x.disabled = false;
      }
    });
  }
  app.append(box, status);
}
void main();
