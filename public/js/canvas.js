// Drawing logic: image + mask canvases, brush / eraser strokes, undo history, zoom & pan.
//
// The mask canvas is the same resolution as the image. Strokes are painted in the overlay
// colour; only the alpha channel matters (the backend thresholds alpha at 128 on save).

const MAX_HISTORY = 100;
const MIN_ZOOM = 0.05, MAX_ZOOM = 40;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class MaskCanvas {
  constructor({ viewport, stage, imageCanvas, maskCanvas, cursor }) {
    Object.assign(this, { viewport, stage, imageCanvas, maskCanvas, cursor });
    this.imageCtx = imageCanvas.getContext('2d');
    this.maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    // Copy of the mask taken at stroke start, used to build compact undo patches.
    this.backup = document.createElement('canvas');
    this.backupCtx = this.backup.getContext('2d', { willReadFrequently: true });

    this.tool = 'brush';
    this.size = 3;
    this.color = '#e53935';
    this.opacity = 0.6;
    this.maskVisible = true;
    this.zoom = 1; this.tx = 0; this.ty = 0;
    this.drawing = false; this.last = null; this.bbox = null;
    this.panning = false; this.spaceDown = false; this.panStart = null;
    this.undoStack = []; this.redoStack = [];
    this.loaded = false;

    // Callbacks set by main.js
    this.onChange = () => {};        // mask edited (stroke, undo, redo, clear)
    this.onHistory = () => {};       // undo / redo availability changed
    this.onView = () => {};          // zoom changed

    this._bindPointer();
  }

  get width() { return this.maskCanvas.width; }
  get height() { return this.maskCanvas.height; }

  // ---------- loading ----------
  setImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    for (const c of [this.imageCanvas, this.maskCanvas, this.backup]) { c.width = w; c.height = h; }
    for (const c of [this.imageCanvas, this.maskCanvas]) { c.style.width = w + 'px'; c.style.height = h + 'px'; }
    this.stage.style.width = w + 'px'; this.stage.style.height = h + 'px';
    this.imageCtx.drawImage(img, 0, 0);
    this.maskCtx.clearRect(0, 0, w, h);
    this.undoStack = []; this.redoStack = [];
    this.loaded = true;
    this.stage.hidden = false;
    this.viewport.classList.remove('empty');
    this.onHistory();
    this.fit();
  }

  // Load a saved GT label (white = crack) as the starting mask. Not added to history.
  setMaskFromLabel(img) {
    const w = this.width, h = this.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, 0, 0, w, h);
    const src = tctx.getImageData(0, 0, w, h).data;
    const out = this.maskCtx.createImageData(w, h);
    const [r, g, b] = hexToRgb(this.color);
    for (let p = 0; p < src.length; p += 4) {
      if ((src[p] + src[p + 1] + src[p + 2]) / 3 > 127) {
        out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
      }
    }
    this.maskCtx.putImageData(out, 0, 0);
  }

  toDataURL() { return this.maskCanvas.toDataURL('image/png'); }

  // ---------- tools ----------
  setTool(t) { this.tool = t; this.cursor.classList.toggle('eraser', t === 'eraser'); }

  setSize(s) { this.size = clamp(Math.round(s), 1, 100); this._updateCursorSize(); return this.size; }

  setColor(hex) {
    this.color = hex;
    if (!this.loaded) return;
    // Recolour existing strokes in place (alpha is kept, so the mask itself is unchanged).
    const ctx = this.maskCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
    // History patches hold old-colour pixels; recolour them too so undo stays consistent.
    const [r, g, b] = hexToRgb(hex);
    for (const e of [...this.undoStack, ...this.redoStack]) {
      for (const img of [e.before, e.after]) {
        const d = img.data;
        for (let p = 0; p < d.length; p += 4) if (d[p + 3]) { d[p] = r; d[p + 1] = g; d[p + 2] = b; }
      }
    }
  }

  setOpacity(o) { this.opacity = o; this._applyMaskOpacity(); }

  setMaskVisible(v) { this.maskVisible = v; this._applyMaskOpacity(); }

  _applyMaskOpacity() { this.maskCanvas.style.opacity = this.maskVisible ? this.opacity : 0; }

  clear() {
    if (!this.loaded) return;
    const before = this.maskCtx.getImageData(0, 0, this.width, this.height);
    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this._push({ x: 0, y: 0, before, after: this.maskCtx.getImageData(0, 0, this.width, this.height) });
  }

  // ---------- history ----------
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  _push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(); this.onHistory();
  }

  undo() {
    const e = this.undoStack.pop(); if (!e) return;
    this.maskCtx.putImageData(e.before, e.x, e.y);
    this.redoStack.push(e);
    this.onChange(); this.onHistory();
  }

  redo() {
    const e = this.redoStack.pop(); if (!e) return;
    this.maskCtx.putImageData(e.after, e.x, e.y);
    this.undoStack.push(e);
    this.onChange(); this.onHistory();
  }

  // ---------- strokes ----------
  _beginStroke(p) {
    this.drawing = true;
    this.backupCtx.clearRect(0, 0, this.width, this.height);
    this.backupCtx.drawImage(this.maskCanvas, 0, 0);
    this.bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    this.last = p;
    this._segment(p, p);
  }

  _segment(a, b) {
    const ctx = this.maskCtx;
    ctx.save();
    ctx.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = this.color;
    ctx.lineWidth = this.size;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (a.x === b.x && a.y === b.y) {
      ctx.arc(a.x, a.y, this.size / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
    const r = this.size / 2 + 2, bb = this.bbox;
    bb.x0 = Math.min(bb.x0, a.x - r, b.x - r); bb.y0 = Math.min(bb.y0, a.y - r, b.y - r);
    bb.x1 = Math.max(bb.x1, a.x + r, b.x + r); bb.y1 = Math.max(bb.y1, a.y + r, b.y + r);
  }

  _endStroke() {
    if (!this.drawing) return;
    this.drawing = false;
    const W = this.width, H = this.height, bb = this.bbox;
    const x = clamp(Math.floor(bb.x0), 0, W), y = clamp(Math.floor(bb.y0), 0, H);
    const w = clamp(Math.ceil(bb.x1), 0, W) - x, h = clamp(Math.ceil(bb.y1), 0, H) - y;
    if (w <= 0 || h <= 0) return;   // stroke fully outside the image
    this._push({
      x, y,
      before: this.backupCtx.getImageData(x, y, w, h),
      after: this.maskCtx.getImageData(x, y, w, h),
    });
  }

  // ---------- view ----------
  _applyTransform() {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
    this.stage.classList.toggle('pixelated', this.zoom >= 2);
    this._updateCursorSize();
    this.onView(this.zoom);
  }

  fit() {
    if (!this.loaded) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    this.zoom = clamp(Math.min(Math.max(vw - 140, 100) / this.width, Math.max(vh - 140, 100) / this.height), MIN_ZOOM, MAX_ZOOM);
    this.tx = (vw - this.width * this.zoom) / 2;
    this.ty = (vh - this.height * this.zoom) / 2;
    this._applyTransform();
  }

  zoomAt(factor, cx = innerWidth / 2, cy = innerHeight / 2) {
    if (!this.loaded) return;
    const nz = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ix = (cx - this.tx) / this.zoom, iy = (cy - this.ty) / this.zoom;
    this.zoom = nz;
    this.tx = cx - ix * nz;
    this.ty = cy - iy * nz;
    this._applyTransform();
  }

  _toImage(e) { return { x: (e.clientX - this.tx) / this.zoom, y: (e.clientY - this.ty) / this.zoom }; }

  _updateCursorSize() {
    const d = Math.max(4, this.size * this.zoom);
    this.cursor.style.width = this.cursor.style.height = d + 'px';
  }

  setSpace(down) { this.spaceDown = down; this._updatePanClass(); }

  _updatePanClass() {
    const v = this.viewport;
    v.classList.toggle('panning', this.spaceDown || this.panning);
    v.classList.toggle('grabbing', this.panning);
    if (this.spaceDown || this.panning) this.cursor.style.display = 'none';
  }

  cancelPointer() {
    if (this.panning) { this.panning = false; this._updatePanClass(); }
    this._endStroke();
  }

  // ---------- pointer events ----------
  _bindPointer() {
    const v = this.viewport;
    v.addEventListener('contextmenu', e => e.preventDefault());

    v.addEventListener('pointerdown', e => {
      if (!this.loaded) return;
      try { v.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      if (e.button === 1 || e.button === 2 || this.spaceDown) {
        this.panning = true;
        this.panStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
        this._updatePanClass();
        return;
      }
      if (e.button !== 0) return;
      if (!this.maskVisible) this.onRequestShowMask?.();   // never paint blind
      this._beginStroke(this._toImage(e));
    });

    v.addEventListener('pointermove', e => {
      if (this.panning) {
        this.tx = this.panStart.tx + e.clientX - this.panStart.x;
        this.ty = this.panStart.ty + e.clientY - this.panStart.y;
        this._applyTransform();
        return;
      }
      if (this.loaded && !this.spaceDown) {
        this.cursor.style.display = 'block';
        this.cursor.style.left = e.clientX + 'px';
        this.cursor.style.top = e.clientY + 'px';
      }
      if (this.drawing) {
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ev of (events.length ? events : [e])) {
          const p = this._toImage(ev);
          this._segment(this.last, p);
          this.last = p;
        }
      }
    });

    v.addEventListener('pointerup', () => this.cancelPointer());
    v.addEventListener('pointercancel', () => this.cancelPointer());
    v.addEventListener('pointerleave', () => { if (!this.drawing) this.cursor.style.display = 'none'; });

    v.addEventListener('wheel', e => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheel has large deltas.
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });

    window.addEventListener('resize', () => { if (this.loaded) this._applyTransform(); });
  }
}
