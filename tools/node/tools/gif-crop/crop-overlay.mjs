/**
 * GIF 预览区裁剪框控制器（支持拖拽移动、8 向缩放、视口缩放与像素吸附）。
 */

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} CropRect
 */

/**
 * @param {{
 *   stageEl: HTMLElement,
 *   viewportEl: HTMLElement,
 *   imageEl: HTMLImageElement,
 *   viewport: ReturnType<typeof import('./viewport.mjs').createViewport>,
 *   inputs: { x: HTMLInputElement, y: HTMLInputElement, width: HTMLInputElement, height: HTMLInputElement },
 *   pixelGridToggle?: HTMLInputElement,
 *   onRectChange?: (rect: CropRect) => void
 * }} options
 */
export function createCropOverlay(options) {
  const { stageEl, viewportEl, imageEl, viewport, inputs, pixelGridToggle, onRectChange } = options;
  let naturalW = 0;
  let naturalH = 0;
  /** @type {CropRect} */
  let rect = { x: 0, y: 0, width: 1, height: 1 };
  let muteInputSync = false;
  let activePointer = null;
  /** @type {{
   *   mode: string,
   *   grabOffsetX: number,
   *   grabOffsetY: number,
   *   startRect: CropRect
   * } | null} */
  let dragState = null;

  const pixelGrid = document.createElement('div');
  pixelGrid.className = 'pixel-grid';
  pixelGrid.hidden = true;
  stageEl.insertBefore(pixelGrid, stageEl.firstChild);

  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.innerHTML = `
    <div class="crop-selection" data-role="selection">
      <span class="crop-handle nw" data-handle="nw"></span>
      <span class="crop-handle n" data-handle="n"></span>
      <span class="crop-handle ne" data-handle="ne"></span>
      <span class="crop-handle e" data-handle="e"></span>
      <span class="crop-handle se" data-handle="se"></span>
      <span class="crop-handle s" data-handle="s"></span>
      <span class="crop-handle sw" data-handle="sw"></span>
      <span class="crop-handle w" data-handle="w"></span>
    </div>
  `;
  stageEl.appendChild(overlay);

  const selectionEl = overlay.querySelector('[data-role="selection"]');

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(stageEl);
  resizeObserver.observe(imageEl);
  resizeObserver.observe(viewportEl);

  imageEl.addEventListener('load', () => render());
  window.addEventListener('resize', render);

  pixelGridToggle?.addEventListener('change', () => updatePixelGrid());

  for (const input of Object.values(inputs)) {
    input.addEventListener('input', () => {
      if (muteInputSync) return;
      const parsed = parseInputRect();
      if (!parsed) return;
      rect = clampRect(parsed);
      syncInputs();
      render();
      onRectChange?.(rect);
    });
  }

  selectionEl.addEventListener('pointerdown', (event) => {
    if (naturalW <= 0 || naturalH <= 0 || viewport.isPanMode()) return;

    const target = /** @type {HTMLElement} */ (event.target);
    const handle = target.dataset.handle || '';
    const mode = handle || 'move';
    const pointer = viewport.screenToImage(event.clientX, event.clientY);

    activePointer = event.pointerId;
    selectionEl.setPointerCapture(activePointer);
    dragState = {
      mode,
      grabOffsetX: pointer.x - rect.x,
      grabOffsetY: pointer.y - rect.y,
      startRect: { ...rect }
    };
    event.preventDefault();
  });

  selectionEl.addEventListener('pointermove', (event) => {
    if (activePointer == null || dragState == null || event.pointerId !== activePointer) {
      return;
    }

    const { mode, grabOffsetX, grabOffsetY, startRect } = dragState;
    const pointer = viewport.screenToImage(event.clientX, event.clientY);
    rect = calculatePointerRect(mode, pointer, grabOffsetX, grabOffsetY, startRect);
    syncInputs();
    render();
    onRectChange?.(rect);
    event.preventDefault();
  });

  const endDrag = (event) => {
    if (activePointer == null || event.pointerId !== activePointer) return;
    selectionEl.releasePointerCapture(activePointer);
    activePointer = null;
    dragState = null;
  };
  selectionEl.addEventListener('pointerup', endDrag);
  selectionEl.addEventListener('pointercancel', endDrag);

  function parseInputRect() {
    const x = parseInt(inputs.x.value, 10);
    const y = parseInt(inputs.y.value, 10);
    const width = parseInt(inputs.width.value, 10);
    const height = parseInt(inputs.height.value, 10);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  }

  /**
   * 读取图片在 stage 本地坐标系内的布局区域（不受 canvas scale 变换影响）。
   */
  function getImageBox() {
    if (!imageEl.naturalWidth || !imageEl.naturalHeight) return null;
    const width = imageEl.offsetWidth;
    const height = imageEl.offsetHeight;
    if (!width || !height) return null;
    return { left: 0, top: 0, width, height };
  }

  /**
   * @param {CropRect} input
   * @returns {CropRect}
   */
  function clampRect(input) {
    const width = clampInt(input.width, 1, naturalW || 1);
    const height = clampInt(input.height, 1, naturalH || 1);
    const x = clampInt(input.x, 0, Math.max(0, naturalW - width));
    const y = clampInt(input.y, 0, Math.max(0, naturalH - height));
    return { x, y, width, height };
  }

  /**
   * 绝对指针位置驱动裁剪框（含像素吸附）。
   */
  function calculatePointerRect(mode, pointer, grabOffsetX, grabOffsetY, startRect) {
    if (mode === 'move') {
      const moved = viewport.snapMoveRect(
        pointer.x - grabOffsetX,
        pointer.y - grabOffsetY,
        startRect.width,
        startRect.height
      );
      return clampRect({
        x: moved.x,
        y: moved.y,
        width: startRect.width,
        height: startRect.height
      });
    }

    let left = startRect.x;
    let top = startRect.y;
    let right = startRect.x + startRect.width;
    let bottom = startRect.y + startRect.height;

    if (mode.includes('w')) {
      left = viewport.snapImageCoord(pointer.x, naturalW, 'start');
    }
    if (mode.includes('e')) {
      right = viewport.snapImageCoord(pointer.x, naturalW, 'end');
    }
    if (mode.includes('n')) {
      top = viewport.snapImageCoordY(pointer.y, naturalH, 'start');
    }
    if (mode.includes('s')) {
      bottom = viewport.snapImageCoordY(pointer.y, naturalH, 'end');
    }

    left = clampInt(left, 0, naturalW - 1);
    right = clampInt(right, left + 1, naturalW);
    top = clampInt(top, 0, naturalH - 1);
    bottom = clampInt(bottom, top + 1, naturalH);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  function syncInputs() {
    muteInputSync = true;
    inputs.x.value = String(rect.x);
    inputs.y.value = String(rect.y);
    inputs.width.value = String(rect.width);
    inputs.height.value = String(rect.height);
    muteInputSync = false;
  }

  function updatePixelGrid() {
    const zoom = viewport.getZoom();
    const userEnabled = pixelGridToggle ? pixelGridToggle.checked : true;
    const autoShow = zoom >= 2;
    const show = userEnabled && autoShow && naturalW > 0;

    if (pixelGridToggle && autoShow && !pixelGridToggle.dataset.userTouched) {
      pixelGridToggle.checked = true;
    }

    pixelGrid.hidden = !show;
    if (show) {
      const fitScale = viewport.getFitScale();
      pixelGrid.style.backgroundSize = `${fitScale}px ${fitScale}px`;
    }
  }

  function render() {
    const imageBox = getImageBox();
    if (!imageBox || naturalW <= 0 || naturalH <= 0) {
      overlay.style.display = 'none';
      pixelGrid.hidden = true;
      return;
    }
    overlay.style.display = 'block';

    const panMode = viewport.isPanMode();
    overlay.style.pointerEvents = panMode ? 'none' : 'auto';
    selectionEl.style.pointerEvents = panMode ? 'none' : 'auto';

    const left = (rect.x / naturalW) * imageBox.width;
    const top = (rect.y / naturalH) * imageBox.height;
    const width = (rect.width / naturalW) * imageBox.width;
    const height = (rect.height / naturalH) * imageBox.height;

    selectionEl.style.left = `${left}px`;
    selectionEl.style.top = `${top}px`;
    selectionEl.style.width = `${Math.max(1, width)}px`;
    selectionEl.style.height = `${Math.max(1, height)}px`;

    updatePixelGrid();
  }

  return {
    /**
     * @param {number} width
     * @param {number} height
     */
    setImageSize(width, height) {
      naturalW = Math.max(1, Math.round(width));
      naturalH = Math.max(1, Math.round(height));

      inputs.x.min = '0';
      inputs.y.min = '0';
      inputs.width.min = '1';
      inputs.height.min = '1';
      inputs.x.max = String(Math.max(0, naturalW - 1));
      inputs.y.max = String(Math.max(0, naturalH - 1));
      inputs.width.max = String(naturalW);
      inputs.height.max = String(naturalH);

      rect = clampRect(rect);
      syncInputs();
      render();
      onRectChange?.(rect);
    },
    /**
     * @param {CropRect} nextRect
     */
    setRect(nextRect) {
      rect = clampRect(nextRect);
      syncInputs();
      render();
      onRectChange?.(rect);
    },
    getRect() {
      return { ...rect };
    },
    refresh() {
      render();
    },
    destroy() {
      resizeObserver.disconnect();
      window.removeEventListener('resize', render);
      pixelGrid.remove();
      overlay.remove();
    }
  };
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
