(() => {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function measure(imageData) {
    const { width, height, data } = imageData || {};
    if (!width || !height || !data?.length || width < 30 || height < 6) return null;
    const top = Math.max(1, Math.round(height * 0.14));
    const bottom = Math.min(height - 1, Math.round(height * 0.86));
    const sampleHeight = Math.max(1, bottom - top);
    const columnScores = new Float32Array(width);

    for (let x = 0; x < width; x += 1) {
      let fillPixels = 0;
      for (let y = top; y < bottom; y += 1) {
        const index = (y * width + x) * 4;
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const isFill = green >= 70
          && red >= 45
          && green - blue >= 20
          && red - blue >= 12
          && blue <= Math.min(red, green) * 0.82;
        if (isFill) fillPixels += 1;
      }
      columnScores[x] = fillPixels / sampleHeight;
    }

    const active = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let nearby = Math.max(0, x - 1); nearby <= Math.min(width - 1, x + 1); nearby += 1) {
        total += columnScores[nearby];
        count += 1;
      }
      active[x] = total / count >= 0.28 ? 1 : 0;
    }

    const allowedLeadingGap = Math.max(4, Math.round(width * 0.035));
    let firstActive = -1;
    for (let x = 0; x < Math.min(width, allowedLeadingGap + 1); x += 1) {
      if (active[x]) { firstActive = x; break; }
    }
    if (firstActive < 0) return null;

    const allowedGap = Math.max(2, Math.round(width * 0.012));
    let lastActive = firstActive;
    let gap = 0;
    for (let x = firstActive; x < width; x += 1) {
      if (active[x]) {
        lastActive = x;
        gap = 0;
      } else {
        gap += 1;
        if (gap > allowedGap) break;
      }
    }

    let activeInside = 0;
    for (let x = firstActive; x <= lastActive; x += 1) activeInside += active[x];
    let activeAfter = 0;
    for (let x = Math.min(width, lastActive + allowedGap + 1); x < width; x += 1) activeAfter += active[x];
    const fillSpan = Math.max(1, lastActive - firstActive + 1);
    const tailSpan = Math.max(1, width - lastActive - allowedGap - 1);
    const coverage = activeInside / fillSpan;
    const tailNoise = activeAfter / tailSpan;
    if (coverage < 0.72 || tailNoise > 0.12) return null;

    const ratio = clamp((lastActive + 1) / width, 0, 1);
    const confidence = Math.round(clamp((coverage * 0.72 + (1 - tailNoise) * 0.28) * 100, 0, 99));
    return { ratio, percentage: ratio * 100, confidence, width, coverage, tailNoise };
  }

  window.MapleExpBarReader = { measure };
})();
