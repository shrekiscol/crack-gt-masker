// App entry point: ties the canvas, backend I/O and UI together.

import { MaskCanvas } from './canvas.js';
import * as fs from './file_system.js';
import * as ui from './ui.js';

const dataset = document.body.dataset.dataset;

const canvas = new MaskCanvas({
  viewport: ui.$('viewport'),
  stage: ui.$('stage'),
  imageCanvas: ui.$('imageCanvas'),
  maskCanvas: ui.$('maskCanvas'),
  cursor: ui.$('brushCursor'),
});

const state = {
  files: [],      // [{name, labeled}]
  index: -1,
  dirty: false,
  opacityPct: 60,
};

function setDirty(d) { state.dirty = d; ui.setDirtyFlag(d); }
const confirmDiscard = () => !state.dirty || confirm('Current mask is not saved. Discard changes?');

canvas.onChange = () => setDirty(true);
canvas.onHistory = () => ui.setHistory(canvas.canUndo, canvas.canRedo);
canvas.onView = z => ui.setZoom(z);
canvas.onRequestShowMask = () => toggleMask(true);

// ---------- files ----------
async function refreshList() {
  const current = state.files[state.index]?.name;
  state.files = await fs.listImages(dataset);
  // New uploads can sort before the open image, so re-find it by name.
  state.index = current ? state.files.findIndex(f => f.name === current) : -1;
  ui.renderFileList(state.files, state.index, i => openIndex(i));
  ui.showDropHint(state.files.length === 0);
}

async function openIndex(i) {
  if (i < 0 || i >= state.files.length || i === state.index) return;
  if (!confirmDiscard()) return;
  const file = state.files[i];
  const img = await fs.loadImage(fs.imageUrl(dataset, file.name));
  if (!img) { ui.toast(`Could not load ${file.name}`, true); return; }

  canvas.setImage(img);
  if (file.labeled) {
    const label = await fs.loadImage(fs.labelUrl(dataset, file.name));
    if (label) canvas.setMaskFromLabel(label);
  }
  state.index = i;
  setDirty(false);
  ui.setCurrentFile(file.name, img.naturalWidth, img.naturalHeight);
  ui.renderFileList(state.files, state.index, openIndex);
}

async function upload(files) {
  if (!files.length) return;
  ui.toast(`Uploading ${files.length} file(s)…`);
  try {
    const res = await fs.uploadImages(dataset, files);
    if (res.errors.length) ui.toast(res.errors.join(' · '), true);
    else ui.toast(`Uploaded ${res.saved.length} image(s)`);
    await refreshList();
    if (state.index < 0 && res.saved.length) {
      await openIndex(state.files.findIndex(f => f.name === res.saved[0]));
    }
  } catch (e) {
    ui.toast(e.message, true);
  }
}

async function save() {
  if (state.index < 0) { ui.toast('No image open', true); return; }
  const file = state.files[state.index];
  try {
    const res = await fs.saveLabel(dataset, file.name, canvas.toDataURL());
    file.labeled = true;
    setDirty(false);
    ui.renderFileList(state.files, state.index, openIndex);
    ui.toast(res.message);
  } catch (e) {
    ui.toast('Save failed: ' + e.message, true);
  }
}

// ---------- tools ----------
function toggleMask(force) {
  const v = typeof force === 'boolean' ? force : !canvas.maskVisible;
  canvas.setMaskVisible(v);
  ui.setMaskVisible(v);
}

function setSize(s) { ui.setSize(canvas.setSize(s)); }

ui.bindControls({
  tool: t => { canvas.setTool(t); ui.setTool(t); },
  size: setSize,
  sizeStep: dir => setSize(canvas.size + dir * (canvas.size >= 10 ? 2 : 1)),
  opacity: pct => { state.opacityPct = pct; canvas.setOpacity(pct / 100); ui.setOpacity(pct); },
  color: hex => { canvas.setColor(hex); ui.setColor(hex); },
  toggleMask,
  undo: () => canvas.undo(),
  redo: () => canvas.redo(),
  clear: () => { if (canvas.loaded) { canvas.clear(); ui.toast('Mask cleared (Ctrl+Z to undo)'); } },
  save,
  upload,
  zoom: f => canvas.zoomAt(f),
  fit: () => canvas.fit(),
  step: d => openIndex(state.index + d),
  space: down => canvas.setSpace(down),
});

window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- start ----------
setSize(3);
canvas.setOpacity(state.opacityPct / 100);
ui.setOpacity(state.opacityPct);
window.addEventListener('blur', () => canvas.cancelPointer());

refreshList()
  .then(() => {
    // Open the first unlabeled image (or the first image) so labelling can start right away.
    const first = state.files.findIndex(f => !f.labeled);
    if (state.files.length) return openIndex(first >= 0 ? first : 0);
  })
  .catch(e => ui.toast(e.message, true));
