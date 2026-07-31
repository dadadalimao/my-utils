/**
 * 预览视口：适应窗口缩放、Ctrl+滚轮缩放、空格/中键平移。
 */

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_WHEEL_FACTOR = 1.1;
/** 屏幕像素磁吸阈值 */
const SNAP_SCREEN_PX = 6;

/**
 * @param {{
 *   viewportEl: HTMLElement,
 *   canvasEl: HTMLElement,
 *   imageEl: HTMLImageElement,
 *   onViewChange?: () => void
 * }} options
 */
export function createViewport(options) {
  const { viewportEl, canvasEl, imageEl, onViewChange } = options;

  let naturalW = 0;
  let naturalH = 0;
  /** 适应视口的基础比例（zoom=1 时） */
  let fitScale = 1;
  /** 相对 fitScale 的用户倍率 */
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  let spacePressed = false;
  let panPointer = null;
  /** @type {{ startX: number, startY: number, startPanX: number, startPanY: number } | null} */
  let panDrag = null;

  const resizeObserver = new ResizeObserver(() => {
    if (naturalW > 0 && naturalH > 0) {
      updateFitScale(false);
      applyTransform();
      onViewChange?.();
    }
  });
  resizeObserver.observe(viewportEl);

  imageEl.addEventListener('load', () => {
    if (naturalW > 0) {
      updateFitScale(false);
      centerImage();
      applyTransform();
      onViewChange?.();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat && !isEditableTarget(event.target)) {
      spacePressed = true;
      viewportEl.classList.add('pan-ready');
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      spacePressed = false;
      viewportEl.classList.remove('pan-ready', 'panning');
    }
  });

  viewportEl.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || naturalW <= 0) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
    zoomAt(event.clientX, event.clientY, factor);
  }, { passive: false });

  viewportEl.addEventListener('pointerdown', (event) => {
    if (naturalW <= 0) return;
    const isMiddle = event.button === 1;
    const isSpacePan = spacePressed && event.button === 0;
    if (!isMiddle && !isSpacePan) return;

    panPointer = event.pointerId;
    panDrag = {
      startX: event.clientX,
      startY: event.clientY,
      startPanX: panX,
      startPanY: panY
    };
    viewportEl.classList.add('panning');
    viewportEl.setPointerCapture(panPointer);
    event.preventDefault();
  });

  viewportEl.addEventListener('pointermove', (event) => {
    if (panPointer == null || panDrag == null || event.pointerId !== panPointer) return;
    panX = panDrag.startPanX + (event.clientX - panDrag.startX);
    panY = panDrag.startPanY + (event.clientY - panDrag.startY);
    applyTransform();
    onViewChange?.();
    event.preventDefault();
  });

  const endPan = (event) => {
    if (panPointer == null || event.pointerId !== panPointer) return;
    viewportEl.releasePointerCapture(panPointer);
    panPointer = null;
    panDrag = null;
    viewportEl.classList.remove('panning');
  };
  viewportEl.addEventListener('pointerup', endPan);
  viewportEl.addEventListener('pointercancel', endPan);

  /**
   * 根据视口尺寸重算 fitScale，并按比例修正 pan 使视图中心尽量稳定。
   * @param {boolean} resetZoom
   */
  function updateFitScale(resetZoom) {
    if (naturalW <= 0 || naturalH <= 0) return;

    const vr = viewportEl.getBoundingClientRect();
    const padding = 8;
    const availW = Math.max(1, vr.width - padding * 2);
    const availH = Math.max(1, vr.height - padding * 2);
    const nextFit = Math.min(availW / naturalW, availH / naturalH);

    if (!resetZoom && fitScale > 0) {
      const centerX = panX + (naturalW * fitScale * zoom) / 2;
      const centerY = panY + (naturalH * fitScale * zoom) / 2;
      fitScale = nextFit;
      panX = centerX - (naturalW * fitScale * zoom) / 2;
      panY = centerY - (naturalH * fitScale * zoom) / 2;
    } else {
      fitScale = nextFit;
      if (resetZoom) zoom = 1;
    }

    const baseW = naturalW * fitScale;
    const baseH = naturalH * fitScale;
    imageEl.style.width = `${baseW}px`;
    imageEl.style.height = `${baseH}px`;
    imageEl.style.maxWidth = 'none';
    imageEl.style.maxHeight = 'none';
    canvasEl.style.width = `${baseW}px`;
    canvasEl.style.height = `${baseH}px`;
  }

  function centerImage() {
    const vr = viewportEl.getBoundingClientRect();
    const displayW = naturalW * fitScale * zoom;
    const displayH = naturalH * fitScale * zoom;
    panX = (vr.width - displayW) / 2;
    panY = (vr.height - displayH) / 2;
  }

  function applyTransform() {
    canvasEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    canvasEl.style.setProperty('--viewport-zoom', String(zoom));
  }

  /**
   * 以屏幕坐标为锚点缩放。
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} factor
   */
  function zoomAt(clientX, clientY, factor) {
    const oldZoom = zoom;
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === oldZoom) return;

    const vr = viewportEl.getBoundingClientRect();
    const mx = clientX - vr.left;
    const my = clientY - vr.top;
    const ux = (mx - panX) / oldZoom;
    const uy = (my - panY) / oldZoom;

    zoom = nextZoom;
    panX = mx - ux * zoom;
    panY = my - uy * zoom;
    applyTransform();
    onViewChange?.();
  }

  /**
   * 屏幕坐标 → 原图像素坐标（浮点）。
   * @param {number} clientX
   * @param {number} clientY
   */
  function screenToImage(clientX, clientY) {
    const ir = imageEl.getBoundingClientRect();
    if (!ir.width || !ir.height || naturalW <= 0 || naturalH <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((clientX - ir.left) / ir.width) * naturalW,
      y: ((clientY - ir.top) / ir.height) * naturalH
    };
  }

  /**
   * 将原图坐标吸附到整数像素，并在接近边界时磁吸。
   * @param {number} value
   * @param {number} maxValue 边界最大值（如 naturalW）
   * @param {'start'|'end'|undefined} edge
   */
  function snapImageCoord(value, maxValue, edge) {
    const ir = imageEl.getBoundingClientRect();
    const axisSize = edge === 'end' || edge === 'start'
      ? (edge === 'end' ? ir.width : ir.height)
      : ir.width;
    const imageMax = maxValue;
    const pxPerImage = axisSize / Math.max(1, imageMax);
    const threshold = SNAP_SCREEN_PX / Math.max(pxPerImage, 0.001);

    let snapped = Math.round(value);
    if (snapped <= threshold) snapped = 0;
    if (snapped >= maxValue - threshold) snapped = maxValue;
    return clampInt(snapped, 0, maxValue);
  }

  /**
   * Y 轴专用 snap（使用图片高度换算阈值）。
   * @param {number} value
   * @param {number} maxValue
   * @param {'start'|'end'|undefined} edge
   */
  function snapImageCoordY(value, maxValue, edge) {
    const ir = imageEl.getBoundingClientRect();
    if (!ir.height) return clampInt(Math.round(value), 0, maxValue);

    const pxPerImage = ir.height / Math.max(1, naturalH);
    const threshold = SNAP_SCREEN_PX / Math.max(pxPerImage, 0.001);

    let snapped = Math.round(value);
    if (snapped <= threshold) snapped = 0;
    if (snapped >= maxValue - threshold) snapped = maxValue;
    return clampInt(snapped, 0, maxValue);
  }

  /**
   * 移动裁剪框时吸附（四边均可磁吸到原图边界）。
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  function snapMoveRect(x, y, width, height) {
    const ir = imageEl.getBoundingClientRect();
    const thresholdX = SNAP_SCREEN_PX / Math.max(ir.width / Math.max(1, naturalW), 0.001);
    const thresholdY = SNAP_SCREEN_PX / Math.max(ir.height / Math.max(1, naturalH), 0.001);

    let sx = Math.round(x);
    let sy = Math.round(y);
    if (sx <= thresholdX) sx = 0;
    if (sy <= thresholdY) sy = 0;
    if (sx + width >= naturalW - thresholdX) sx = naturalW - width;
    if (sy + height >= naturalH - thresholdY) sy = naturalH - height;
    return { x: sx, y: sy };
  }

  return {
    /**
     * @param {number} width
     * @param {number} height
     */
    setImageSize(width, height) {
      naturalW = Math.max(1, Math.round(width));
      naturalH = Math.max(1, Math.round(height));
      zoom = 1;
      updateFitScale(true);
      centerImage();
      applyTransform();
      onViewChange?.();
    },
    fitToView() {
      zoom = 1;
      updateFitScale(false);
      centerImage();
      applyTransform();
      onViewChange?.();
    },
    zoomIn() {
      const vr = viewportEl.getBoundingClientRect();
      zoomAt(vr.left + vr.width / 2, vr.top + vr.height / 2, ZOOM_WHEEL_FACTOR);
    },
    zoomOut() {
      const vr = viewportEl.getBoundingClientRect();
      zoomAt(vr.left + vr.width / 2, vr.top + vr.height / 2, 1 / ZOOM_WHEEL_FACTOR);
    },
    getZoomPercent() {
      return Math.round(zoom * 100);
    },
    getZoom() {
      return zoom;
    },
    getFitScale() {
      return fitScale;
    },
    isPanMode() {
      return spacePressed || panPointer != null;
    },
    screenToImage,
    snapImageCoord,
    snapImageCoordY,
    snapMoveRect,
    getNaturalSize() {
      return { width: naturalW, height: naturalH };
    },
    destroy() {
      resizeObserver.disconnect();
    }
  };
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
