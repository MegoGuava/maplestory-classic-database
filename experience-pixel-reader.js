(() => {
  "use strict";

  // EXP uses 5 x 7 bitmap sprites. Matching those pixels is more reliable than
  // asking a general-purpose OCR model to guess the tiny characters.
  const DIGIT_ROWS = [
    [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
    ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    ["#####", "#....", "#....", ".###.", "....#", "#...#", ".###."],
    [".###.", "#...#", "#....", "####.", "#...#", "#...#", ".###."],
    ["#####", "....#", "....#", "....#", "...#.", "..#..", "..#.."],
    [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."]
  ];
  const DIGITS = DIGIT_ROWS.map((rows, digit) => {
    const ink = [];
    let lowMask = 0;
    let highMask = 0;
    rows.forEach((row, y) => [...row].forEach((value, x) => {
      if (value !== "#") return;
      const position = y * 5 + x;
      ink.push(position);
      if (position < 31) lowMask |= 1 << position;
      else highMask |= 1 << (position - 31);
    }));
    return { digit: String(digit), inkCount: ink.length, lowMask, highMask };
  });
  const THRESHOLDS = [110, 125, 140, 155, 170, 185];
  const MIN_GLYPH_SCORE = 0.68;
  const MIN_RUN_SCORE = 0.74;
  const MIN_DIGITS = 3;

  const luminanceAt = (data, index) => data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  const popcount = (value) => {
    let bits = value >>> 0;
    bits -= (bits >>> 1) & 0x55555555;
    bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
    return (((bits + (bits >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  };

  function downsample(imageData, scale, offsetX, offsetY) {
    const { width, height, data } = imageData;
    const sampledWidth = Math.floor((width - offsetX) / scale);
    const sampledHeight = Math.floor((height - offsetY) / scale);
    if (sampledWidth < 5 || sampledHeight < 7) return null;
    const values = new Uint8Array(sampledWidth * sampledHeight);
    const divisor = scale * scale;
    for (let y = 0; y < sampledHeight; y += 1) {
      for (let x = 0; x < sampledWidth; x += 1) {
        let total = 0;
        const sourceLeft = offsetX + x * scale;
        const sourceTop = offsetY + y * scale;
        for (let innerY = 0; innerY < scale; innerY += 1) {
          let index = ((sourceTop + innerY) * width + sourceLeft) * 4;
          for (let innerX = 0; innerX < scale; innerX += 1, index += 4) total += luminanceAt(data, index);
        }
        values[y * sampledWidth + x] = Math.round(total / divisor);
      }
    }
    return { width: sampledWidth, height: sampledHeight, values };
  }

  function bestDigit(binary, width, left, top) {
    let observedInk = 0;
    let lowMask = 0;
    let highMask = 0;
    let position = 0;
    for (let y = 0; y < 7; y += 1) {
      const row = (top + y) * width + left;
      for (let x = 0; x < 5; x += 1, position += 1) {
        if (!binary[row + x]) continue;
        observedInk += 1;
        if (position < 31) lowMask |= 1 << position;
        else highMask |= 1 << (position - 31);
      }
    }
    if (observedInk < 4) return null;

    let best = null;
    for (const template of DIGITS) {
      const overlap = popcount(lowMask & template.lowMask) + popcount(highMask & template.highMask);
      const score = 2 * overlap / (template.inkCount + observedInk);
      if (!best || score > best.score) best = { digit: template.digit, score };
    }
    return best;
  }

  function bestRunForRow(binary, width, top) {
    const candidateCount = width - 4;
    const candidates = new Array(candidateCount);
    for (let left = 0; left < candidateCount; left += 1) candidates[left] = bestDigit(binary, width, left, top);

    const bestAt = new Array(candidateCount);
    for (let left = candidateCount - 1; left >= 0; left -= 1) {
      const candidate = candidates[left];
      if (!candidate || candidate.score < MIN_GLYPH_SCORE) continue;
      let best = { text: candidate.digit, scores: [candidate.score], positions: [left] };
      for (const advance of [5, 6]) {
        const tail = bestAt[left + advance];
        if (!tail) continue;
        const combined = {
          text: candidate.digit + tail.text,
          scores: [candidate.score, ...tail.scores],
          positions: [left, ...tail.positions]
        };
        const combinedTotal = combined.scores.reduce((sum, score) => sum + score, 0);
        const bestTotal = best.scores.reduce((sum, score) => sum + score, 0);
        if (combined.text.length > best.text.length || (combined.text.length === best.text.length && combinedTotal > bestTotal)) best = combined;
      }
      bestAt[left] = best;
    }

    let winner = null;
    for (const run of bestAt) {
      if (!run || run.text.length < MIN_DIGITS || run.text.length > 12) continue;
      const average = run.scores.reduce((sum, score) => sum + score, 0) / run.scores.length;
      if (average < MIN_RUN_SCORE) continue;
      const candidate = { ...run, average, left: run.positions[0] };
      if (!winner
        || candidate.text.length > winner.text.length
        || (candidate.text.length === winner.text.length && candidate.average > winner.average)
        || (candidate.text.length === winner.text.length && candidate.average === winner.average && candidate.left < winner.left)) winner = candidate;
    }
    return winner;
  }

  function rowCandidates(binary, width, top) {
    const candidates = new Array(width - 4);
    for (let left = 0; left < candidates.length; left += 1) candidates[left] = bestDigit(binary, width, left, top);
    return candidates;
  }

  function bestShortRun(candidates, startMin, startMax, maxDigits) {
    let winner = null;
    const visit = (position, text, scores, positions) => {
      const candidate = candidates[position];
      if (!candidate || candidate.score < 0.64) return;
      const nextText = text + candidate.digit;
      const nextScores = [...scores, candidate.score];
      const nextPositions = [...positions, position];
      const average = nextScores.reduce((sum, score) => sum + score, 0) / nextScores.length;
      const run = { text: nextText, scores: nextScores, positions: nextPositions, average };
      if (!winner || run.text.length > winner.text.length || (run.text.length === winner.text.length && run.average > winner.average)) winner = run;
      if (nextText.length >= maxDigits) return;
      for (const advance of [5, 6]) if (position + advance < candidates.length) visit(position + advance, nextText, nextScores, nextPositions);
    };
    for (let start = Math.max(0, startMin); start <= Math.min(candidates.length - 1, startMax); start += 1) visit(start, "", [], []);
    return winner?.average >= 0.7 ? winner : null;
  }

  function percentageFromObservation(imageData, observation) {
    const sampled = downsample(imageData, observation.scale, observation.offsetX, observation.offsetY);
    if (!sampled || observation.top > sampled.height - 7) return null;
    const binary = new Uint8Array(sampled.values.length);
    for (let index = 0; index < sampled.values.length; index += 1) binary[index] = sampled.values[index] >= observation.threshold ? 1 : 0;
    const candidates = rowCandidates(binary, sampled.width, observation.top);
    const currentEnd = observation.positions[observation.positions.length - 1] + 5;
    const integerRun = bestShortRun(candidates, currentEnd + 1, currentEnd + 8, 3);
    if (!integerRun) return null;
    const integerEnd = integerRun.positions[integerRun.positions.length - 1];
    const fractionRun = bestShortRun(candidates, integerEnd + 7, integerEnd + 11, 2);
    if (!fractionRun || fractionRun.text.length !== 2) return null;
    const value = Number(`${integerRun.text}.${fractionRun.text}`);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return { text: `${integerRun.text}.${fractionRun.text}`, value, score: (integerRun.average + fractionRun.average) / 2 };
  }

  function recognize(imageData) {
    if (!imageData?.data || !Number(imageData.width) || !Number(imageData.height)) return null;
    const maxScale = Math.max(1, Math.min(4, Math.floor(imageData.height / 7)));
    const observations = [];

    for (let scale = 1; scale <= maxScale; scale += 1) {
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          const sampled = downsample(imageData, scale, offsetX, offsetY);
          if (!sampled) continue;
          for (const threshold of THRESHOLDS) {
            const binary = new Uint8Array(sampled.values.length);
            for (let index = 0; index < sampled.values.length; index += 1) binary[index] = sampled.values[index] >= threshold ? 1 : 0;
            let best = null;
            for (let top = 0; top <= sampled.height - 7; top += 1) {
              const run = bestRunForRow(binary, sampled.width, top);
              if (!run) continue;
              if (!best
                || run.text.length > best.text.length
                || (run.text.length === best.text.length && run.average > best.average)) best = { ...run, top };
            }
            if (best) observations.push({ ...best, scale, offsetX, offsetY, threshold });
          }
        }
      }
    }

    if (!observations.length) return null;
    const groups = new Map();
    for (const observation of observations) {
      const group = groups.get(observation.text) || { text: observation.text, support: 0, scoreTotal: 0, bestScore: 0, left: Infinity, observations: [] };
      group.support += 1;
      group.scoreTotal += observation.average;
      group.bestScore = Math.max(group.bestScore, observation.average);
      group.left = Math.min(group.left, observation.left * observation.scale + observation.offsetX);
      group.observations.push(observation);
      groups.set(observation.text, group);
    }

    const ranked = [...groups.values()].map((group) => {
      const average = group.scoreTotal / group.support;
      const rank = group.text.length * 12 + group.support * 8 + average * 100 - group.left * 0.002;
      return { ...group, average, rank };
    }).sort((left, right) => right.rank - left.rank || right.bestScore - left.bestScore || left.left - right.left);
    const winner = ranked[0];
    if (!winner || winner.average < MIN_RUN_SCORE || winner.support < 3) return null;
    const percentageGroups = new Map();
    for (const observation of winner.observations) {
      const percentage = percentageFromObservation(imageData, observation);
      if (!percentage) continue;
      const group = percentageGroups.get(percentage.text) || { ...percentage, support: 0, scoreTotal: 0 };
      group.support += 1;
      group.scoreTotal += percentage.score;
      percentageGroups.set(percentage.text, group);
    }
    const percentage = [...percentageGroups.values()]
      .map((group) => ({ ...group, average: group.scoreTotal / group.support }))
      .sort((left, right) => right.support - left.support || right.average - left.average)[0];
    const reliablePercentage = percentage?.support >= 3 ? percentage : null;
    const confidence = Math.round(Math.min(98, 35 + winner.average * 50 + Math.min(12, winner.support * 1.5)));
    return {
      text: reliablePercentage ? `${winner.text}(${reliablePercentage.text}%)` : winner.text,
      confidence,
      support: winner.support,
      average: winner.average,
      scale: winner.observations[0]?.scale || 1,
      percentage: reliablePercentage?.value ?? null,
      percentageSupport: reliablePercentage?.support || 0
    };
  }

  window.MapleExpPixelReader = { recognize };
})();
