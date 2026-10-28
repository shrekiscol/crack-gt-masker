// UI controls: toolbar buttons, sliders, file list, toast and keyboard shortcuts.

export const $ = id => document.getElementById(id);

let toastTimer;
export function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4000 : 1800);
}

export function renderFileList(files, activeIndex, onPick) {
  const ul = $('fileList');
  ul.innerHTML = '';
  files.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = (i === activeIndex ? 'active ' : '') + (f.labeled ? 'labeled' : '');
    li.title = f.name + (f.labeled ? ' (labeled)' : '');
    li.innerHTML = '<span class="dot"></span><span class="fname"></span>';
    li.querySelector('.fname').textContent = f.name;
    li.onclick = () => onPick(i);
    ul.appendChild(li);
  });
  ul.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
  const done = files.filter(f => f.labeled).length;
  $('progress').textContent = `${done} / ${files.length} labeled`;
}

export function setCurrentFile(name, w, h) {
  $('current').hidden = !name;
  $('fileName').textContent = name || '';
  $('fileName').title = name || '';
  $('fileDims').textContent = name ? `${w} × ${h}` : '';
}

export function setDirtyFlag(dirty) { $('dirtyFlag').textContent = dirty ? '• unsaved' : ''; }

export function setTool(tool) {
  $('brushBtn').classList.toggle('active', tool === 'brush');
  $('eraserBtn').classList.toggle('active', tool === 'eraser');
}

export function setSize(size) { $('sizeInput').value = size; $('sizeOut').textContent = size + ' px'; }
export function setOpacity(pct) { $('opacityInput').value = pct; $('opacityOut').textContent = pct + '%'; }
export function setMaskVisible(v) { $('toggleMaskBtn').classList.toggle('active', v); }
export function setColor(hex) { $('colorSwatch').style.background = hex; }
export function setZoom(z) { $('zoomLabel').textContent = Math.round(z * 100) + '%'; }
export function setHistory(canUndo, canRedo) { $('undoBtn').disabled = !canUndo; $('redoBtn').disabled = !canRedo; }
export function showDropHint(show) { $('dropHint').hidden = !show; }

/**
 * Wire every control to a handler.
 * @param {Record<string, Function>} h  handlers from main.js
 */
export function bindControls(h) {
  $('brushBtn').onclick = () => h.tool('brush');
  $('eraserBtn').onclick = () => h.tool('eraser');
  $('colorBtn').onclick = () => $('colorInput').click();
  $('colorInput').oninput = e => h.color(e.target.value);
  $('toggleMaskBtn').onclick = h.toggleMask;
  $('openBtn').onclick = $('openBtnHint').onclick = () => $('fileInput').click();
  $('saveBtn').onclick = h.save;
  $('clearBtn').onclick = h.clear;
  $('undoBtn').onclick = h.undo;
  $('redoBtn').onclick = h.redo;
  $('zoomInBtn').onclick = () => h.zoom(1.25);
  $('zoomOutBtn').onclick = () => h.zoom(0.8);
  $('zoomLabel').onclick = h.fit;
  $('collapseBtn').onclick = () => $('files').classList.toggle('collapsed');
  $('helpHead').onclick = () => $('help').classList.toggle('collapsed');

  $('fileInput').onchange = e => { h.upload([...e.target.files]); e.target.value = ''; };
  $('sizeInput').oninput = e => h.size(+e.target.value);
  $('opacityInput').oninput = e => h.opacity(+e.target.value);
  // Return focus to the page so shortcuts (and Ctrl+Z) keep working after using a slider.
  for (const id of ['sizeInput', 'opacityInput']) $(id).addEventListener('change', e => e.target.blur());

  // drag & drop upload
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragover'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragover');
    if (e.dataTransfer.files.length) h.upload([...e.dataTransfer.files]);
  });

  bindShortcuts(h);
}

function bindShortcuts(h) {
  window.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? h.redo() : h.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); h.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); h.save(); return; }
    if (mod || e.altKey) return;
    const onSlider = e.target.type === 'range';
    if (e.target.tagName === 'INPUT' && !onSlider) return;

    switch (k) {
      case ' ': e.preventDefault(); if (!e.repeat) h.space(true); break;
      case 'b': h.tool('brush'); break;
      case 'e': h.tool('eraser'); break;
      case 'h': h.toggleMask(); break;
      case 'f': h.fit(); break;
      case 'o': $('fileInput').click(); break;
      case '[': h.sizeStep(-1); break;
      case ']': h.sizeStep(1); break;
      case '+': case '=': h.zoom(1.25); break;
      case '-': case '_': h.zoom(0.8); break;
      case 'a': case 'arrowleft': if (!onSlider) h.step(-1); break;
      case 'd': case 'arrowright': if (!onSlider) h.step(1); break;
    }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') h.space(false); });
  window.addEventListener('blur', () => h.space(false));
}
