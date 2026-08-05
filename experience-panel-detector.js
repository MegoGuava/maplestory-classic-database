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
      if (luminance[rowOffset + x] >= 145) {
        if (start < 0) start = x;
        lastBright = x;
      } else if (start >= 0 && x - lastBright > 2) {
        closeRun();
      }
    }
    closeRun();
    return runs;
  }

  function greenRowRuns(greenMask, width, y) {
    const runs = [];
    const rowOffset = y * width;
    let start = -1;
    let lastGreen = -1;
    for (let x = 0; x < width; x += 1) {
      if (greenMask[rowOffset + x]) {
        if (start < 0) start = x;
        lastGreen = x;
      } else if (start >= 0 && x - lastGreen > 1) {
        if (lastGreen - start >= 2) runs.push({ left: start, right: lastGreen });
        start = -1;
        lastGreen = -1;
      }
    }
    if (start >= 0 && lastGreen - start >= 2) runs.push({ left: start, right: lastGreen });
    return runs;
  }

  function greenComponents(greenMask, width, height, searchStartY) {
    let active = [];
    const completed = [];
    for (let y = searchStartY; y < height; y += 1) {
      const runs = greenRowRuns(greenMask, width, y);
      const next = [];
      const used = new Set();
      for (const run of runs) {
        let bestIndex = -1;
        let bestOverlap = -Infinity;
        for (let index = 0; index < active.length; index += 1) {
          if (used.has(index)) continue;
          const component = active[index];
          const overlap = Math.min(run.right, component.right) - Math.max(run.left, component.left) + 1;
          if (overlap >= -2 && overlap > bestOverlap) {
            bestIndex = index;
            bestOverlap = overlap;
          }
        }
        if (bestIndex >= 0) {
          const component = active[bestIndex];
          used.add(bestIndex);
          component.left = Math.min(component.left, run.left);
          component.right = Math.max(component.right, run.right);
          component.bottom = y;
          component.area += run.right - run.left + 1;
          next.push(component);
        } else {
          next.push({ left: run.left, right: run.right, top: y, bottom: y, area: run.right - run.left + 1 });
        }
      }
      for (let index = 0; index < active.length; index += 1) if (!used.has(index)) completed.push(active[index]);
      active = next;
    }
    return completed.concat(active);
  }

  function expandBrightRow(luminance, width, y, start, direction, limit) {
    const rowOffset = y * width;
    let edge = start;
    let gap = 0;
    for (let step = 1; step <= limit; step += 1) {
      const x = start + direction * step;
      if (x < 0 || x >= width) break;
      if (luminance[rowOffset + x] >= 88) {
        edge = x;
        gap = 0;
      } else {
        gap += 1;
        if (gap > 5) break;
      }
    }
    return edge;
  }

  function panelFromCandidate(candidate, width, height, source) {
    const horizontalPadding = Math.max(3, Math.round(candidate.barHeight * 0.16));
    const x = Math.max(0, candidate.left - horizontalPadding);
    const y = Math.max(0, candidate.topY - Math.round(candidate.barHeight * 1.15) - 4);
    const right = Math.min(width, candidate.right + horizontalPadding + 1);
    const bottom = Math.min(height, candidate.bottomY + Math.round(candidate.barHeight * 0.2) + 1);
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      confidence: candidate.confidence,
      source,
      bar: { x: candidate.left, y: candidate.topY, width: candidate.right - candidate.left + 1, height: candidate.bottomY - candidate.topY + 1 }
    };
  }

  function findGreenFallback(greenMask, luminance, brightIntegral, width, height, searchStartY, maxWidth) {
    let best = null;
    for (const component of greenComponents(greenMask, width, height, searchStartY)) {
      const componentWidth = component.right - component.left + 1;
      const componentHeight = component.bottom - component.top + 1;
      const componentDensity = component.area / Math.max(1, componentWidth * componentHeight);
      if (componentWidth < 12 || componentHeight < 4 || componentHeight > 90 || componentWidth / componentHeight < 1.15 || componentDensity < 0.22) continue;

      const centerY = Math.round((component.top + component.bottom) / 2);
      const expansionLimit = Math.min(maxWidth, Math.max(180, componentWidth * 12));
      const left = expandBrightRow(luminance, width, centerY, component.left, -1, expansionLimit);
      const right = expandBrightRow(luminance, width, centerY, component.right, 1, expansionLimit);
      const candidateWidth = right - left + 1;
      const barHeight = Math.max(8, componentHeight + 6);
      if (candidateWidth < 70 || candidateWidth > maxWidth || candidateWidth / barHeight < 2.8 || candidateWidth / barHeight > 30) continue;

      const topY = Math.max(searchStartY, component.top - 3);
      const bottomY = Math.min(height - 1, component.bottom + 3);
      const textTop = Math.max(0, topY - barHeight - 10);
      const textDensity = integralDensity(brightIntegral, width, height, left, textTop, candidateWidth, topY - textTop);
      if (textDensity < 0.006) continue;
      const leftBorder = integralDensity(brightIntegral, width, height, left - 2, topY, 5, bottomY - topY + 1);
      const rightBorder = integralDensity(brightIntegral, width, height, right - 2, topY, 5, bottomY - topY + 1);
      const fillRatio = componentWidth / candidateWidth;
      const score = componentDensity
        + Math.min(1.4, componentWidth / 65)
        + Math.min(1.4, textDensity * 18)
        + Math.min(0.9, leftBorder + rightBorder)
        + Math.min(0.45, fillRatio)
        + centerY / height * 0.35;
      if (!best || score > best.score) best = { score, left, right, topY, bottomY, barHeight };
    }
    if (!best || best.score < 2.25) return null;
    best.confidence = clamp((best.score - 1.8) / 2.5, 0.38, 0.88);
    return panelFromCandidate(best, width, height, "green-fill");
  }

  function findExpPanel(imageData) {
    const { width, height, data } = imageData || {};
    if (!width || !height || !data?.length) return null;

    const stride = width + 1;
    const luminance = new Uint8Array(width * height);
    const greenMask = new Uint8Array(width * height);
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
        const isBright = value >= 145;
        const isGreen = green > 75 && green > red * 1.03 && green > blue * 1.14 && green - red > 5;
        brightRow += isBright ? 1 : 0;
        greenRow += isGreen ? 1 : 0;
        greenMask[y * width + x] = isGreen ? 1 : 0;
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

    const structuralMatch = best && best.score >= 4.05
      ? panelFromCandidate({ ...best, confidence: clamp((best.score - 3.65) / 2.25, 0.35, 0.98) }, width, height, "outline")
      : null;
    const greenMatch = findGreenFallback(greenMask, luminance, brightIntegral, width, height, searchStartY, maxWidth);
    if (!structuralMatch) return greenMatch;
    if (!greenMatch) return structuralMatch;
    return greenMatch.confidence > structuralMatch.confidence ? greenMatch : structuralMatch;
  }

  window.MapleExpPanelDetector = { findExpPanel };
})();
