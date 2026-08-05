(() => {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function integralDensity(integral, width, height, x, y, regionWidth, regionHeight) {
    const stride = width + 1;
    const left = clamp(Math.floor(x), 0, width);
    const top = clamp(Math.floor(y), 0, height);
    const right = clamp(Math.ceil(x + regionWidth), left, width);
    const bottom = clamp(Math.ceil(y + regionHeight), top, height);
    const area = Math.max(1, (right - left) * (bottom - top));
    const sum = integral[bottom * stride + right]
      - integral[top * stride + right]
      - integral[bottom * stride + left]
      + integral[top * stride + left];
    return sum / area;
  }

  function rowRuns(luminance, width, y, minWidth, maxWidth) {
    const runs = [];
    let start = -1;
    let lastBright = -1;
    const rowOffset = y * width;

    const closeRun = () => {
      if (start < 0 || lastBright < start) return;
      const runWidth = lastBright - start + 1;
      if (runWidth >= minWidth && runWidth <= maxWidth) runs.push({ left: start, right: lastBright, width: runWidth });
      start = -1;
      lastBright = -1;
    };

    for (let x = 0; x < width; x += 1) {
      if (luminance[rowOffset + x] >= 170) {
        if (start < 0) start = x;
        lastBright = x;
      } else if (start >= 0 && x - lastBright > 2) {
        closeRun();
      }
    }
    closeRun();
    return runs;
  }

  function findExpPanel(imageData) {
    const { width, height, data } = imageData || {};
    if (!width || !height || !data?.length) return null;

    const stride = width + 1;
    const luminance = new Uint8Array(width * height);
    const brightIntegral = new Uint32Array(stride * (height + 1));
    const greenIntegral = new Uint32Array(stride * (height + 1));

    for (let y = 0; y < height; y += 1) {
      let brightRow = 0;
      let greenRow = 0;
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = (y * width + x) * 4;
        const red = data[pixelIndex];
        const green = data[pixelIndex + 1];
        const blue = data[pixelIndex + 2];
        const value = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
        luminance[y * width + x] = value;
        brightRow += value >= 170 ? 1 : 0;
        greenRow += green > 100 && green > red * 1.05 && green > blue * 1.25 ? 1 : 0;
        const integralIndex = (y + 1) * stride + x + 1;
        brightIntegral[integralIndex] = brightIntegral[integralIndex - stride] + brightRow;
        greenIntegral[integralIndex] = greenIntegral[integralIndex - stride] + greenRow;
      }
    }

    const searchStartY = Math.floor(height * 0.35);
    const minWidth = Math.max(80, Math.floor(width * 0.05));
    const maxWidth = Math.min(800, Math.floor(width * 0.98));
    const runsByRow = new Array(height);
    for (let y = searchStartY; y < height; y += 1) runsByRow[y] = rowRuns(luminance, width, y, minWidth, maxWidth);

    let best = null;
    for (let topY = searchStartY; topY < height - 18; topY += 1) {
      for (const topRun of runsByRow[topY] || []) {
        const lastBottomY = Math.min(height - 1, topY + 120, topY + Math.floor(topRun.width / 3.2));
        for (let bottomY = topY + 18; bottomY <= lastBottomY; bottomY += 1) {
          for (const bottomRun of runsByRow[bottomY] || []) {
            const overlap = Math.max(0, Math.min(topRun.right, bottomRun.right) - Math.max(topRun.left, bottomRun.left) + 1);
            const narrowWidth = Math.min(topRun.width, bottomRun.width);
            const barHeight = bottomY - topY;
            const ratio = narrowWidth / barHeight;
            if (overlap / narrowWidth < 0.82 || Math.abs(topRun.left - bottomRun.left) > barHeight * 0.6 + 3 || ratio < 3.2 || ratio > 12) continue;

            const left = Math.min(topRun.left, bottomRun.left);
            const right = Math.max(topRun.right, bottomRun.right);
            const candidateWidth = right - left + 1;
            const leftBorder = integralDensity(brightIntegral, width, height, left - 2, topY, 5, barHeight + 1);
            const rightBorder = integralDensity(brightIntegral, width, height, right - 2, topY, 5, barHeight + 1);
            const greenFill = integralDensity(greenIntegral, width, height, left + 2, topY + 2, candidateWidth - 4, barHeight - 3);
            const textTop = Math.max(0, topY - barHeight - 8);
            const textDensity = integralDensity(brightIntegral, width, height, left, textTop, candidateWidth, topY - textTop);
            const ratioScore = Math.max(0, 1 - Math.abs(ratio - 7) / 7);
            const score = leftBorder + rightBorder
              + Math.min(1.5, greenFill * 12)
              + Math.min(1.5, textDensity * 14)
              + ratioScore
              + bottomY / height * 0.3;

            if (!best || score > best.score) best = { score, left, right, topY, bottomY, barHeight };
          }
        }
      }
    }

    if (!best || best.score < 4.7) return null;
    const horizontalPadding = Math.max(3, Math.round(best.barHeight * 0.16));
    const x = Math.max(0, best.left - horizontalPadding);
    const y = Math.max(0, best.topY - Math.round(best.barHeight * 1.15) - 4);
    const right = Math.min(width, best.right + horizontalPadding + 1);
    const bottom = Math.min(height, best.bottomY + Math.round(best.barHeight * 0.2) + 1);
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      confidence: Math.min(1, Math.max(0, (best.score - 4.2) / 2)),
      bar: { x: best.left, y: best.topY, width: best.right - best.left + 1, height: best.bottomY - best.topY + 1 }
    };
  }

  window.MapleExpPanelDetector = { findExpPanel };
})();
