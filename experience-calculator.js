(() => {
  "use strict";

  const core = window.MapleExpCalculatorCore;
  if (!core) return;

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    themeToggle: $("#themeToggle"), themeIcon: $("#themeIcon"), themeLabel: $("#themeLabel"),
    sessionStatus: $("#sessionStatus"), startTime: $("#startTime"), endTime: $("#endTime"), duration: $("#duration"),
    startExp: $("#startExp"), currentExp: $("#currentExp"), gainedExp: $("#gainedExp"), hourlyRate: $("#hourlyRate"), lastDetected: $("#lastDetected"),
    startSession: $("#startSession"), stopSession: $("#stopSession"), resetSession: $("#resetSession"),
    shareWindow: $("#shareWindow"), stopCapture: $("#stopCapture"), clearRegion: $("#clearRegion"),
    captureVideo: $("#captureVideo"), previewCanvas: $("#previewCanvas"), previewShell: $("#previewShell"), previewEmpty: $("#previewEmpty"), regionHelp: $("#regionHelp"),
    readingFormat: $("#readingFormat"), maxExp: $("#maxExp"), scanInterval: $("#scanInterval"),
    startDetection: $("#startDetection"), stopDetection: $("#stopDetection"), detectionStatus: $("#detectionStatus"), ocrProgress: $("#ocrProgress"),
    rawOcrText: $("#rawOcrText"), ocrConfidence: $("#ocrConfidence"), ocrCanvas: $("#ocrCanvas"),
    manualExp: $("#manualExp"), applyManual: $("#applyManual"), historyRows: $("#historyRows"), emptyHistory: $("#emptyHistory"), clearHistory: $("#clearHistory")
  };

  const formatNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? new Intl.NumberFormat("zh-TW").format(Math.round(Number(value))) : "—";
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) : "—";
  const storage = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Private browsing can block storage. */ }
    }
  };

  const state = {
    captureStream: null,
    previewFrame: null,
    selection: null,
    dragStart: null,
    dragCurrent: null,
    detectionRunning: false,
    scanTimer: null,
    ocrWorker: null,
    ocrWorkerPromise: null,
    pendingJump: null,
    lastReading: null,
    history: storage.read("maple-exp-sessions", []),
    session: {
      running: false,
      startAt: null,
      endAt: null,
      startExp: null,
      currentExp: null,
      lastExp: null,
      lastMax: null,
      totalGain: 0,
      lastDetectedAt: null
    }
  };

  function applyTheme(nextTheme, persist = true) {
    const theme = nextTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    elements.themeIcon.textContent = theme === "dark" ? "☀" : "☾";
    elements.themeLabel.textContent = theme === "dark" ? "切換明亮" : "切換暗色";
    if (persist) {
      try { localStorage.setItem("maple-theme", theme); } catch (_) { /* Ignore unavailable storage. */ }
    }
  }

  const initialTheme = document.documentElement.dataset.theme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(initialTheme, false);
  elements.themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  function loadSettings() {
    const settings = storage.read("maple-exp-settings", {});
    if (["auto", "absolute", "ratio", "percent"].includes(settings.format)) elements.readingFormat.value = settings.format;
    if (Number(settings.maxExp) > 0) elements.maxExp.value = String(Math.floor(Number(settings.maxExp)));
    if (["2000", "3000", "5000", "10000"].includes(String(settings.interval))) elements.scanInterval.value = String(settings.interval);
  }

  function saveSettings() {
    storage.write("maple-exp-settings", {
      format: elements.readingFormat.value,
      maxExp: Number(elements.maxExp.value) || null,
      interval: Number(elements.scanInterval.value)
    });
  }

  function setDetectionStatus(message, stateName = "idle", detail = null) {
    elements.detectionStatus.textContent = message;
    elements.detectionStatus.dataset.state = stateName;
    if (detail !== null) elements.ocrProgress.textContent = detail;
  }

  function sessionElapsed(now = Date.now()) {
    if (!state.session.startAt) return 0;
    return Math.max(0, (state.session.running ? now : state.session.endAt || now) - state.session.startAt);
  }

  function updateSessionUI() {
    const session = state.session;
    const displayCurrent = session.startAt ? session.currentExp : state.lastReading?.current;
    elements.startTime.textContent = formatDateTime(session.startAt);
    elements.endTime.textContent = session.startAt ? formatDateTime(session.running ? Date.now() : session.endAt) : "—";
    elements.duration.textContent = core.formatDuration(sessionElapsed());
    elements.startExp.textContent = formatNumber(session.startExp);
    elements.currentExp.textContent = formatNumber(displayCurrent);
    elements.gainedExp.textContent = formatNumber(session.totalGain) === "—" ? "0" : formatNumber(session.totalGain);
    const elapsedHours = sessionElapsed() / 3_600_000;
    elements.hourlyRate.textContent = elapsedHours > 0 ? formatNumber(session.totalGain / elapsedHours) : "0";
    elements.lastDetected.textContent = formatDateTime(session.lastDetectedAt || state.lastReading?.timestamp);
    elements.startSession.disabled = session.running;
    elements.stopSession.disabled = !session.running;
    elements.sessionStatus.dataset.state = session.running ? "running" : session.endAt ? "done" : "idle";
    elements.sessionStatus.textContent = session.running ? (session.startExp === null ? "等待第一筆 EXP" : "計算中") : session.endAt ? "已完成" : "尚未開始";
  }

  function resetSession() {
    state.pendingJump = null;
    state.session = { running: false, startAt: null, endAt: null, startExp: null, currentExp: null, lastExp: null, lastMax: null, totalGain: 0, lastDetectedAt: null };
    updateSessionUI();
  }

  function startSession() {
    state.pendingJump = null;
    const reading = state.lastReading;
    state.session = {
      running: true,
      startAt: Date.now(),
      endAt: null,
      startExp: reading?.current ?? null,
      currentExp: reading?.current ?? null,
      lastExp: reading?.current ?? null,
      lastMax: (reading?.max ?? Number(elements.maxExp.value)) || null,
      totalGain: 0,
      lastDetectedAt: reading?.timestamp ?? null
    };
    updateSessionUI();
  }

  function processReading(reading, source = "ocr", timestamp = Date.now()) {
    state.lastReading = { ...reading, timestamp, source };
    const session = state.session;
    if (!session.running) {
      session.lastDetectedAt = timestamp;
      updateSessionUI();
      return { accepted: true, delta: 0 };
    }

    session.lastDetectedAt = timestamp;
    if (session.startExp === null || session.lastExp === null) {
      session.startExp = reading.current;
      session.currentExp = reading.current;
      session.lastExp = reading.current;
      session.lastMax = reading.max || Number(elements.maxExp.value) || null;
      state.pendingJump = null;
      updateSessionUI();
      return { accepted: true, delta: 0 };
    }

    const result = core.calculateDelta(session.lastExp, reading.current, session.lastMax);
    if (!result.valid) {
      setDetectionStatus("忽略不合理的下降讀值", "error", "只有接近滿等後回到低數值，才會判定為升級歸零。");
      updateSessionUI();
      return { accepted: false, delta: 0 };
    }

    const referenceMax = Number(session.lastMax || reading.max);
    const largeJump = source === "ocr" && !result.leveled && referenceMax > 0 && result.delta > referenceMax * 0.5;
    if (largeJump) {
      const pending = state.pendingJump;
      if (!pending || timestamp - pending.timestamp > 20_000 || reading.current < pending.current) {
        state.pendingJump = { current: reading.current, timestamp };
        setDetectionStatus("偵測到大幅增加，等待下一次確認", "working", "這項保護可避免 OCR 單次誤判破壞整段紀錄。");
        updateSessionUI();
        return { accepted: false, delta: 0 };
      }
    }

    state.pendingJump = null;
    session.totalGain += Math.max(0, result.delta);
    session.currentExp = reading.current;
    session.lastExp = reading.current;
    session.lastMax = reading.max || session.lastMax;
    updateSessionUI();
    return { accepted: true, delta: result.delta, leveled: result.leveled };
  }

  function saveCompletedSession() {
    const session = state.session;
    if (session.startExp === null || session.currentExp === null) return false;
    const elapsed = sessionElapsed();
    const record = {
      id: `${session.startAt}-${Date.now()}`,
      startAt: session.startAt,
      endAt: session.endAt,
      duration: elapsed,
      startExp: session.startExp,
      endExp: session.currentExp,
      gained: session.totalGain,
      hourly: elapsed > 0 ? Math.round(session.totalGain / (elapsed / 3_600_000)) : 0
    };
    state.history.unshift(record);
    state.history = state.history.slice(0, 30);
    storage.write("maple-exp-sessions", state.history);
    renderHistory();
    return true;
  }

  function stopSession() {
    if (!state.session.running) return;
    state.session.running = false;
    state.session.endAt = Date.now();
    const saved = saveCompletedSession();
    updateSessionUI();
    elements.sessionStatus.textContent = saved ? "已完成並保存" : "已結束・沒有有效讀值";
  }

  function renderHistory() {
    elements.historyRows.innerHTML = state.history.map((entry) => `<tr><td>${formatDateTime(entry.startAt)}</td><td>${formatDateTime(entry.endAt)}</td><td>${core.formatDuration(entry.duration)}</td><td>${formatNumber(entry.startExp)}</td><td>${formatNumber(entry.endExp)}</td><td>${formatNumber(entry.gained)}</td><td>${formatNumber(entry.hourly)}</td></tr>`).join("");
    elements.emptyHistory.hidden = state.history.length > 0;
    elements.clearHistory.disabled = state.history.length === 0;
  }

  function normalizedPointer(event) {
    const rect = elements.previewCanvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  function normalizedRegion(start, end) {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }

  function activeSelection() {
    return state.dragStart && state.dragCurrent ? normalizedRegion(state.dragStart, state.dragCurrent) : state.selection;
  }

  function drawPreview() {
    const video = elements.captureVideo;
    const canvas = elements.previewCanvas;
    if (!state.captureStream || video.readyState < 2 || !video.videoWidth) {
      state.previewFrame = requestAnimationFrame(drawPreview);
      return;
    }
    const width = Math.min(1280, video.videoWidth);
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    const selection = activeSelection();
    if (selection?.width > 0 && selection?.height > 0) {
      const x = selection.x * width, y = selection.y * height, regionWidth = selection.width * width, regionHeight = selection.height * height;
      context.fillStyle = "rgba(1, 14, 11, 0.55)";
      context.fillRect(0, 0, width, height);
      context.drawImage(video, selection.x * video.videoWidth, selection.y * video.videoHeight, selection.width * video.videoWidth, selection.height * video.videoHeight, x, y, regionWidth, regionHeight);
      context.strokeStyle = "#c9ec76";
      context.lineWidth = Math.max(2, width / 500);
      context.strokeRect(x, y, regionWidth, regionHeight);
      context.fillStyle = "#c9ec76";
      context.fillRect(x, Math.max(0, y - 23), Math.min(135, regionWidth), 23);
      context.fillStyle = "#173008";
      context.font = `800 ${Math.max(12, width / 80)}px Segoe UI`;
      context.fillText("EXP 辨識範圍", x + 7, Math.max(16, y - 7));
    }
    state.previewFrame = requestAnimationFrame(drawPreview);
  }

  function updateCaptureControls() {
    const hasCapture = Boolean(state.captureStream);
    const hasRegion = Boolean(state.selection && state.selection.width >= 0.02 && state.selection.height >= 0.015);
    elements.stopCapture.disabled = !hasCapture;
    elements.clearRegion.disabled = !hasCapture;
    elements.startDetection.disabled = !hasCapture || !hasRegion || state.detectionRunning;
    elements.stopDetection.disabled = !state.detectionRunning;
    elements.previewShell.dataset.empty = String(!hasCapture);
    if (!hasCapture) elements.previewEmpty.hidden = false;
  }

  async function shareWindow() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setDetectionStatus("這個瀏覽器不支援分享畫面", "error", "請改用最新版 Chrome、Edge 或 Firefox，並從 HTTPS 公開網址開啟。");
      return;
    }
    stopCapture();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false });
      state.captureStream = stream;
      elements.captureVideo.srcObject = stream;
      await elements.captureVideo.play();
      state.selection = { x: 0.16, y: 0.8, width: 0.68, height: 0.14 };
      stream.getVideoTracks()[0]?.addEventListener("ended", stopCapture, { once: true });
      cancelAnimationFrame(state.previewFrame);
      drawPreview();
      setDetectionStatus("畫面已連接，請確認框選範圍", "working", "拖曳預覽可重新框選；預設先選取畫面底部中央。");
      updateCaptureControls();
    } catch (error) {
      if (error?.name === "NotAllowedError") setDetectionStatus("已取消或拒絕分享畫面", "error", "只有你再次按下按鈕並同意後，網站才可讀取畫面。");
      else setDetectionStatus("無法讀取分享畫面", "error", error?.message || "請重試並選擇遊戲視窗。");
    }
  }

  function stopCapture() {
    stopDetection();
    state.captureStream?.getTracks().forEach((track) => track.stop());
    state.captureStream = null;
    state.selection = null;
    state.dragStart = null;
    state.dragCurrent = null;
    elements.captureVideo.srcObject = null;
    cancelAnimationFrame(state.previewFrame);
    elements.previewShell.dataset.empty = "true";
    setDetectionStatus("等待分享畫面", "idle", "選擇遊戲視窗後，再框選 EXP 數字。");
    updateCaptureControls();
  }

  function buildOcrFrame() {
    const video = elements.captureVideo;
    const region = state.selection;
    if (!video.videoWidth || !region) return null;
    const sourceX = Math.round(region.x * video.videoWidth);
    const sourceY = Math.round(region.y * video.videoHeight);
    const sourceWidth = Math.max(1, Math.round(region.width * video.videoWidth));
    const sourceHeight = Math.max(1, Math.round(region.height * video.videoHeight));
    const scale = Math.min(4, Math.max(1.5, 900 / sourceWidth));
    const targetWidth = Math.min(2000, Math.max(600, Math.round(sourceWidth * scale)));
    const targetHeight = Math.max(70, Math.round(targetWidth * sourceHeight / sourceWidth));
    const canvas = elements.ocrCanvas;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
    const image = context.getImageData(0, 0, targetWidth, targetHeight);
    let luminanceTotal = 0;
    for (let index = 0; index < image.data.length; index += 4) luminanceTotal += image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722;
    const average = luminanceTotal / (image.data.length / 4);
    const invert = average < 125;
    for (let index = 0; index < image.data.length; index += 4) {
      const luminance = image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722;
      const value = invert ? (luminance > Math.max(120, average + 28) ? 0 : 255) : (luminance > Math.min(190, average + 15) ? 255 : 0);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  async function ensureOcrWorker() {
    if (state.ocrWorker) return state.ocrWorker;
    if (state.ocrWorkerPromise) return state.ocrWorkerPromise;
    if (!window.Tesseract?.createWorker) throw new Error("OCR 套件載入失敗，請確認網路連線後重新整理。");
    state.ocrWorkerPromise = (async () => {
      setDetectionStatus("正在準備 OCR", "working", "第一次使用需要下載辨識核心與英數字模型。");
      const worker = await window.Tesseract.createWorker("eng", 1, {
        logger(message) {
          if (!state.detectionRunning) return;
          const progress = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
          elements.ocrProgress.textContent = `${message.status || "準備辨識"}${progress}`;
        }
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.,/%",
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300"
      });
      state.ocrWorker = worker;
      return worker;
    })().finally(() => { state.ocrWorkerPromise = null; });
    return state.ocrWorkerPromise;
  }

  async function scanOnce() {
    if (!state.detectionRunning) return;
    try {
      const frame = buildOcrFrame();
      if (!frame) throw new Error("尚未取得可辨識的畫面。");
      const worker = await ensureOcrWorker();
      if (!state.detectionRunning) return;
      setDetectionStatus("正在辨識 EXP", "working", "辨識期間仍會持續計時。");
      const result = await worker.recognize(frame);
      const text = result?.data?.text?.trim() || "";
      const confidence = Number(result?.data?.confidence);
      elements.rawOcrText.textContent = text || "（沒有文字）";
      elements.rawOcrText.title = text;
      elements.ocrConfidence.textContent = Number.isFinite(confidence) ? `信心度 ${Math.round(confidence)}%` : "信心度 —";
      const reading = core.parseExperienceText(text, elements.readingFormat.value, Number(elements.maxExp.value));
      if (!reading.valid) {
        setDetectionStatus("這次沒有可用讀值", "error", reading.error);
      } else {
        if (reading.kind === "ratio" && reading.max > 0) elements.maxExp.value = String(reading.max);
        const processed = processReading(reading, "ocr");
        if (processed.accepted) {
          const percentage = Number.isFinite(reading.percentage) ? `（${reading.percentage.toFixed(2)}%）` : "";
          setDetectionStatus(`已讀取 ${formatNumber(reading.current)} EXP`, "working", `${reading.kind === "percent" ? "百分比換算" : reading.kind === "ratio" ? "目前／升級所需" : "數字讀值"}${percentage}`);
        }
        saveSettings();
      }
    } catch (error) {
      setDetectionStatus("辨識發生錯誤", "error", error?.message || "請重新框選 EXP 區域後再試。");
    } finally {
      if (state.detectionRunning) state.scanTimer = window.setTimeout(scanOnce, Number(elements.scanInterval.value) || 3000);
    }
  }

  async function startDetection() {
    if (!state.captureStream || !state.selection) return;
    state.detectionRunning = true;
    state.pendingJump = null;
    updateCaptureControls();
    setDetectionStatus("正在啟動辨識", "working", "OCR 準備完成後會自動讀取第一筆 EXP。");
    await scanOnce();
  }

  function stopDetection() {
    state.detectionRunning = false;
    window.clearTimeout(state.scanTimer);
    state.scanTimer = null;
    if (state.captureStream) setDetectionStatus("自動辨識已停止", "idle", "畫面仍在分享中，可調整範圍後再次啟動。");
    updateCaptureControls();
  }

  elements.previewCanvas.addEventListener("pointerdown", (event) => {
    if (!state.captureStream) return;
    elements.previewCanvas.setPointerCapture?.(event.pointerId);
    state.dragStart = normalizedPointer(event);
    state.dragCurrent = state.dragStart;
  });
  elements.previewCanvas.addEventListener("pointermove", (event) => {
    if (!state.dragStart) return;
    state.dragCurrent = normalizedPointer(event);
  });
  elements.previewCanvas.addEventListener("pointerup", (event) => {
    if (!state.dragStart) return;
    state.dragCurrent = normalizedPointer(event);
    const region = normalizedRegion(state.dragStart, state.dragCurrent);
    state.dragStart = null;
    state.dragCurrent = null;
    if (region.width >= 0.02 && region.height >= 0.015) {
      state.selection = region;
      stopDetection();
      setDetectionStatus("已更新辨識範圍", "working", "確認框內只包含 EXP 數字後，按下開始自動辨識。");
    }
    updateCaptureControls();
  });
  elements.previewCanvas.addEventListener("pointercancel", () => { state.dragStart = null; state.dragCurrent = null; });

  elements.startSession.addEventListener("click", startSession);
  elements.stopSession.addEventListener("click", stopSession);
  elements.resetSession.addEventListener("click", resetSession);
  elements.shareWindow.addEventListener("click", shareWindow);
  elements.stopCapture.addEventListener("click", stopCapture);
  elements.clearRegion.addEventListener("click", () => {
    stopDetection();
    state.selection = null;
    setDetectionStatus("請在預覽上拖曳 EXP 範圍", "working", "框選完成後即可重新啟動自動辨識。");
    updateCaptureControls();
  });
  elements.startDetection.addEventListener("click", startDetection);
  elements.stopDetection.addEventListener("click", stopDetection);
  elements.applyManual.addEventListener("click", () => {
    const current = Number(elements.manualExp.value);
    if (!Number.isFinite(current) || current < 0) {
      setDetectionStatus("手動 EXP 格式不正確", "error", "請輸入 0 以上的整數。");
      return;
    }
    const reading = { valid: true, kind: "manual", current: Math.floor(current), max: Number(elements.maxExp.value) || null, percentage: null, normalized: String(current) };
    processReading(reading, "manual");
    setDetectionStatus(`已手動校正為 ${formatNumber(reading.current)} EXP`, "working", "計時與累積經驗不中斷。");
    elements.manualExp.value = "";
    saveSettings();
  });
  elements.manualExp.addEventListener("keydown", (event) => { if (event.key === "Enter") elements.applyManual.click(); });
  [elements.readingFormat, elements.maxExp, elements.scanInterval].forEach((element) => element.addEventListener("change", saveSettings));
  elements.clearHistory.addEventListener("click", () => {
    if (!state.history.length || !window.confirm("確定要清除全部練功紀錄嗎？此動作無法復原。")) return;
    state.history = [];
    storage.write("maple-exp-sessions", state.history);
    renderHistory();
  });

  window.setInterval(() => { if (state.session.running) updateSessionUI(); }, 1000);
  window.addEventListener("beforeunload", () => {
    state.captureStream?.getTracks().forEach((track) => track.stop());
    state.ocrWorker?.terminate();
  });
  window.addEventListener("load", () => {
    elements.ocrProgress.textContent = window.Tesseract?.createWorker
      ? "OCR 元件已就緒；第一次辨識仍需下載英數字模型。"
      : "OCR 元件載入失敗；請確認網路連線後重新整理。";
  }, { once: true });

  loadSettings();
  renderHistory();
  updateCaptureControls();
  updateSessionUI();
})();
