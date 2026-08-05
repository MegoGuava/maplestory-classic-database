(() => {
  "use strict";

  const MAX_REASONABLE_EXPERIENCE = 2147483647;

  const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");
  const integerValue = (value) => {
    const digits = digitsOnly(value);
    return digits ? Number(digits) : null;
  };

  function normalizeOcrText(value) {
    return String(value ?? "")
      .toUpperCase()
      .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10))
      .replace(/[ＯODQ]/g, "0")
      .replace(/[ＩIL｜|!]/g, "1")
      .replace(/Z/g, "2")
      .replace(/S/g, "5")
      .replace(/G/g, "6")
      .replace(/B/g, "8")
      .replace(/[：:;]/g, ".")
      .replace(/[^0-9.,/%\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function invalid(normalized, error) {
    return { valid: false, normalized, error };
  }

  function joinedRatioValue(normalized, configuredMax = null) {
    const compact = normalized.replace(/\s/g, "");
    const maxFromSettings = Number(configuredMax) > 0 ? Math.floor(Number(configuredMax)) : null;
    const validToken = (token) => /^[0-9][0-9,.]*$/.test(token)
      && (!token.includes(",") || /^[0-9]{1,3}(?:,[0-9]{3})+$/.test(token));
    const candidates = [];

    for (let index = 1; index < compact.length - 1; index += 1) {
      if (compact[index] !== "1") continue;
      const left = compact.slice(0, index);
      for (const right of [compact.slice(index), compact.slice(index + 1)]) {
        if (!validToken(left) || !validToken(right)) continue;
        const current = integerValue(left);
        const max = integerValue(right);
        if (current === null || !max || current > max) continue;
        let score = 4;
        if (left.includes(",")) score += 3;
        if (right.includes(",")) score += 3;
        if (String(max).length >= String(current).length) score += 2;
        if (maxFromSettings === max) score += 10;
        candidates.push({ current, max, score });
      }
    }

    return candidates.sort((a, b) => b.score - a.score || a.max - b.max)[0] || null;
  }

  function parseExperienceText(text, requestedFormat = "auto", configuredMax = null) {
    const normalized = normalizeOcrText(text);
    const maxFromSettings = Number(configuredMax) > 0 ? Math.floor(Number(configuredMax)) : null;
    if (!normalized) return invalid(normalized, "沒有辨識到數字");

    const ratioMatch = normalized.match(/([0-9][0-9,.\s]*)\s*\/\s*([0-9][0-9,.\s]*)/);
    if ((requestedFormat === "auto" || requestedFormat === "ratio") && ratioMatch) {
      const current = integerValue(ratioMatch[1]);
      const max = integerValue(ratioMatch[2]);
      if (current !== null && max > 0) {
        return { valid: true, kind: "ratio", current, max, percentage: current / max * 100, normalized };
      }
    }
    if (requestedFormat === "ratio") {
      const values = (normalized.match(/[0-9][0-9,.]*/g) || []).map(integerValue).filter((value) => value !== null);
      if (values.length >= 2 && values[1] > 0 && values[0] <= values[1]) {
        return { valid: true, kind: "ratio", current: values[0], max: values[1], percentage: values[0] / values[1] * 100, normalized };
      }
      const joined = joinedRatioValue(normalized, maxFromSettings);
      if (joined) {
        return { valid: true, kind: "ratio", current: joined.current, max: joined.max, percentage: joined.current / joined.max * 100, normalized };
      }
      return invalid(normalized, "找不到「目前 / 升級所需」格式");
    }

    const percentMatch = normalized.match(/([0-9]{1,3}(?:[.,][0-9]{1,4})?)\s*%/)
      || (requestedFormat === "percent" ? normalized.match(/(?:^|\s)([0-9]{1,3}[.,][0-9]{1,4})(?:\s|$)/) : null);
    if ((requestedFormat === "auto" || requestedFormat === "percent") && percentMatch) {
      const percentage = Number(percentMatch[1].replace(",", "."));
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return invalid(normalized, "百分比超出 0～100% 範圍");
      const textWithoutPercent = normalized.replace(percentMatch[0], " ");
      const displayedValues = (textWithoutPercent.match(/[0-9][0-9,\s]*/g) || []).map(integerValue).filter((value) => value !== null);
      const displayedCurrent = displayedValues.sort((a, b) => String(b).length - String(a).length || b - a)[0] ?? null;
      if (displayedCurrent !== null) {
        const inferredMax = maxFromSettings || (percentage > 0 ? Math.round(displayedCurrent / percentage * 100) : null);
        return {
          valid: true,
          kind: "absolute-percent",
          current: displayedCurrent,
          max: inferredMax,
          percentage,
          normalized
        };
      }
      if (!maxFromSettings) return invalid(normalized, "只有百分比時，需要填寫本級升級所需 EXP");
      return {
        valid: true,
        kind: "percent",
        current: Math.round(maxFromSettings * percentage / 100),
        max: maxFromSettings,
        percentage,
        normalized
      };
    }
    if (requestedFormat === "percent") return invalid(normalized, "找不到百分比格式");

    const candidates = normalized.match(/[0-9][0-9,\s]*/g) || [];
    const values = candidates.map(integerValue).filter((value) => value !== null);
    if (!values.length) return invalid(normalized, "找不到可用的 EXP 數字");
    const current = values.sort((a, b) => String(b).length - String(a).length || b - a)[0];
    return { valid: true, kind: "absolute", current, max: maxFromSettings, percentage: maxFromSettings ? current / maxFromSettings * 100 : null, normalized };
  }

  function calculateDelta(previous, current, previousMax = null) {
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return { valid: false, delta: 0, leveled: false };
    if (current >= previous) return { valid: true, delta: current - previous, leveled: false };
    const max = Number(previousMax);
    if (max > 0 && previous >= max * 0.55 && current <= max * 0.45) {
      return { valid: true, delta: Math.max(0, max - previous + current), leveled: true };
    }
    return { valid: false, delta: 0, leveled: false };
  }

  function hasStructuredOcrMarker(text) {
    const raw = String(text ?? "");
    return /[%/]/.test(raw) || /\([^)]{1,16}\)/.test(raw);
  }

  function selectOcrAttempt(attempts, lastCurrent = null) {
    const available = (Array.isArray(attempts) ? attempts : []).filter(Boolean);
    if (!available.length) return null;
    const fallback = [...available].sort((left, right) => (Number(right.confidence) || 0) - (Number(left.confidence) || 0))[0];
    const candidates = available.filter((attempt) => attempt.reading?.valid && Number.isFinite(attempt.reading.current));
    if (!candidates.length) return fallback;

    const previous = Number(lastCurrent);
    const hasPrevious = Number.isFinite(previous) && previous >= 0;
    const scored = candidates.map((attempt) => {
      const confidence = Number.isFinite(Number(attempt.confidence)) ? Number(attempt.confidence) : 0;
      const current = Number(attempt.reading.current);
      const structured = hasStructuredOcrMarker(attempt.text);
      const agreement = candidates.filter((candidate) => Number(candidate.reading.current) === current).length;
      const closeToPrevious = hasPrevious && Math.abs(current - previous) <= Math.max(10, previous * 0.08);
      const overLimit = current > MAX_REASONABLE_EXPERIENCE;
      let score = confidence;
      if (structured) score += 32;
      if (Number.isFinite(attempt.reading.percentage)) score += 12;
      if (agreement >= 2) score += 42 + Math.min(12, (agreement - 2) * 6);
      if (closeToPrevious) score += 28;
      if (attempt.reading.max > 0 && current <= attempt.reading.max) score += 10;
      if (overLimit) score = -Infinity;
      const acceptable = !overLimit && (
        confidence >= 45
        || (structured && confidence >= 18)
        || agreement >= 2
        || (closeToPrevious && confidence >= 8)
      );
      return { attempt, score, acceptable, overLimit };
    }).sort((left, right) => left.score === right.score ? 0 : left.score > right.score ? -1 : 1);

    const accepted = scored.find((candidate) => candidate.acceptable);
    if (accepted) return { ...accepted.attempt, score: accepted.score };

    const strongest = scored[0];
    const normalized = strongest?.attempt?.reading?.normalized || fallback?.reading?.normalized || "";
    const error = scored.every((candidate) => candidate.overLimit)
      ? "辨識數字異常過大，已忽略這次讀值"
      : "OCR 信心度過低，已忽略這次讀值";
    return {
      ...(strongest?.attempt || fallback),
      reading: invalid(normalized, error),
      rejected: true,
      score: strongest?.score ?? -Infinity
    };
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
  }

  window.MapleExpCalculatorCore = { normalizeOcrText, parseExperienceText, calculateDelta, selectOcrAttempt, formatDuration };
})();
