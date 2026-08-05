(() => {
  "use strict";

  const core = window.MapleExpCalculatorCore;
  const panelDetector = window.MapleExpPanelDetector;
  if (!core) return;

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    themeToggle: $("#themeToggle"), themeIcon: $("#themeIcon"), themeLabel: $("#themeLabel"),
    sessionStatus: $("#sessionStatus"), startTime: $("#startTime"), endTime: $("#endTime"), duration: $("#duration"),
    startExp: $("#startExp"), currentExp: $("#currentExp"), gainedExp: $("#gainedExp"), hourlyRate: $("#hourlyRate"), lastDetected: $("#lastDetected"),
    startSession: $("#startSession"), stopSession: $("#stopSession"), resetSession: $("#resetSession"),
    shareWindow: $("#shareWindow"), autoFindExp: $("#autoFindExp"), stopCapture: $("#stopCapture"), clearRegion: $("#clearRegion"),
    zoomOut: $("#zoomOut"), zoomIn: $("#zoomIn"), zoomReset: $("#zoomReset"), previewZoom: $("#previewZoom"), zoomValue: $("#zoomValue"),
    captureVideo: $("#captureVideo"), previewCanvas: $("#previewCanvas"), previewShell: $("#previewShell"), previewEmpty: $("#previewEmpty"), regionHelp: $("#regionHelp"),
    readingFormat: $("#readingFormat"), maxExp: $("#maxExp"), scanInterval: $("#scanInterval"),
    startDetection: $("#startDetection"), stopDetection: $("#stopDetection"), detectionStatus: $("#detectionStatus"), ocrProgress: $("#ocrProgress"),
    rawOcrText: $("#rawOcrText"), ocrConfidence: $("#ocrConfidence"),
    manualExp: $("#manualExp"), applyManual: $("#applyManual"), historyRows: $("#historyRows"), emptyHistory: $("#emptyHistory"), clearHistory: $("#clearHistory")
  };

  const ocrCanvases = {
    source: document.createElement("canvas"),
    locator: document.createElement("canvas"),
    color: document.createElement("canvas"),
    enhanced: document.createElement("canvas"),
    text: document.createElement("canvas")
  };
  const ocrVariantLabels = { color: "彩色原圖", enhanced: "彩色增強", text: "文字強化" };

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
    ocrSelection: null,
    detectionRunning: false,
    findingPanel: false,
    locatorRunId: 0,
    previewZoom: 1,
    scanTimer: null,
    ocrWorker: null,
    ocrWorkerPromise: null,
    preferredOcrVariant: "color",
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

  function applyPreviewZoom(percent) {
    const nextPercent = Math.max(100, Math.min(400, Math.round(Number(percent) / 25) * 25 || 100));
    state.previewZoom = nextPercent / 100;
    elements.previewZoom.value = String(nextPercent);
    elements.zoomValue.value = `${nextPercent}%`;
    elements.zoomValue.textContent = `${nextPercent}%`;
    elements.previewCanvas.style.width = `${nextPercent}%`;
    elements.zoomOut.disabled = !state.captureStream || nextPercent <= 100;
    elements.zoomIn.disabled = !state.captureStream || nextPercent >= 400;
  }

  function centerSelectionInPreview() {
    if (!state.selection) return;
    const canvas = elements.previewCanvas;
    const shell = elements.previewShell;
    shell.scrollTo({
      left: Math.max(0, state.selection.x * canvas.scrollWidth + state.selection.width * canvas.scrollWidth / 2 - shell.clientWidth / 2),
      top: Math.max(0, state.selection.y * canvas.scrollHeight + state.selection.height * canvas.scrollHeight / 2 - shell.clientHeight / 2),
      behavior: "smooth"
    });
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
    elements.autoFindExp.disabled = !hasCapture || state.findingPanel || !panelDetector;
    elements.stopCapture.disabled = !hasCapture;
    elements.clearRegion.disabled = !hasCapture;
    elements.previewZoom.disabled = !hasCapture;
    elements.zoomReset.disabled = !hasCapture;
    elements.zoomOut.disabled = !hasCapture || state.previewZoom <= 1;
    elements.zoomIn.disabled = !hasCapture || state.previewZoom >= 4;
    elements.startDetection.disabled = !hasCapture || !hasRegion || state.detectionRunning || state.findingPanel;
    elements.stopDetection.disabled = !state.detectionRunning;
    elements.previewShell.dataset.empty = String(!hasCapture);
    if (!hasCapture) elements.previewEmpty.hidden = false;
  }

  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  async function autoFindExpPanel() {
    const video = elements.captureVideo;
    if (!state.captureStream || !video.videoWidth || !video.videoHeight) return;
    if (!panelDetector) {
      setDetectionStatus("自動尋找元件載入失敗", "error", "請改用手動框選 EXP 區域。");
      return;
    }
    const capture = state.captureStream;
    const runId = ++state.locatorRunId;
    stopDetection();
    state.findingPanel = true;
    state.selection = null;
    state.ocrSelection = null;
    setDetectionStatus("正在自動尋找 EXP", "working", "掃描遊戲畫面下半部的 EXP 文字與長條外框。");
    updateCaptureControls();

    try {
      const canvas = ocrCanvases.locator;
      const scale = Math.min(1, 1920 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let match = null;
      const attempts = 6;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (state.captureStream !== capture || state.locatorRunId !== runId) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const candidate = panelDetector.findExpPanel(context.getImageData(0, 0, canvas.width, canvas.height));
        if (candidate && (!match || candidate.confidence > match.confidence)) match = candidate;
        if (candidate?.confidence >= 0.58) break;
        if (attempt < attempts) {
          setDetectionStatus(`正在自動尋找 EXP（${attempt}/${attempts}）`, "working", "正在比對 EXP 文字外框與綠色經驗條，請保持遊戲視窗可見。");
          await wait(300);
        }
      }
      if (!match) {
        setDetectionStatus("沒有自動找到 EXP", "error", "請在彩色預覽上手動拖曳，框住 EXP 文字與下方長條。");
        return;
      }
      state.selection = {
        x: match.x / canvas.width,
        y: match.y / canvas.height,
        width: match.width / canvas.width,
        height: match.height / canvas.height
      };
      const textBottom = Math.min(match.y + match.height, match.bar.y + 2);
      state.ocrSelection = {
        x: match.x / canvas.width,
        y: match.y / canvas.height,
        width: match.width / canvas.width,
        height: Math.max(1, textBottom - match.y) / canvas.height
      };
      state.preferredOcrVariant = "color";
      setDetectionStatus("已自動找到 EXP 區塊", "working", `綠色框顯示整個面板；定位信心 ${Math.round(match.confidence * 100)}%。`);
      window.setTimeout(centerSelectionInPreview, 0);
    } catch (error) {
      setDetectionStatus("自動尋找發生錯誤", "error", error?.message || "請改用手動框選 EXP 區域。");
    } finally {
      if (state.locatorRunId === runId) {
        state.findingPanel = false;
        updateCaptureControls();
      }
    }
  }

  async function shareWindow() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setDetectionStatus("這個瀏覽器不支援分享畫面", "error", "請改用最新版 Chrome、Edge 或 Firefox，並從 HTTPS 公開網址開啟。");
      return;
    }
    stopCapture();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 5, max: 10 },
          width: { ideal: 3840 },
          height: { ideal: 2160 }
        },
        audio: false
      });
      state.captureStream = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && "contentHint" in videoTrack) videoTrack.contentHint = "text";
      elements.captureVideo.srcObject = stream;
      await elements.captureVideo.play();
      state.selection = null;
      state.ocrSelection = null;
      videoTrack?.addEventListener("ended", stopCapture, { once: true });
      cancelAnimationFrame(state.previewFrame);
      drawPreview();
      setDetectionStatus("畫面已連接，準備尋找 EXP", "working", "正在等待遊戲畫面清晰後自動定位。");
      updateCaptureControls();
      window.setTimeout(() => { if (state.captureStream === stream) autoFindExpPanel(); }, 300);
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
    state.ocrSelection = null;
    state.dragStart = null;
    state.dragCurrent = null;
    state.findingPanel = false;
    state.locatorRunId += 1;
    elements.captureVideo.srcObject = null;
    cancelAnimationFrame(state.previewFrame);
    elements.previewShell.dataset.empty = "true";
    setDetectionStatus("等待分享畫面", "idle", "選擇遊戲視窗後，再框選 EXP 數字。");
    updateCaptureControls();
  }

  const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

  function otsuThreshold(histogram, totalPixels) {
    let weightedTotal = 0;
    for (let value = 0; value < 256; value += 1) weightedTotal += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let bestThreshold = 127;
    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = totalPixels - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        bestThreshold = value;
      }
    }
    return bestThreshold;
  }

  function paddedCanvas(name, width, height, padding) {
    const canvas = ocrCanvases[name];
    canvas.width = width + padding * 2;
    canvas.height = height + padding * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, context };
  }

  function buildOcrFrames() {
    const video = elements.captureVideo;
    const region = state.ocrSelection || state.selection;
    if (!video.videoWidth || !region) return null;
    const sourceX = Math.round(region.x * video.videoWidth);
    const sourceY = Math.round(region.y * video.videoHeight);
    const sourceWidth = Math.max(1, Math.round(region.width * video.videoWidth));
    const sourceHeight = Math.max(1, Math.round(region.height * video.videoHeight));
    let scale = Math.min(10, Math.max(3, 1500 / sourceWidth, 180 / sourceHeight));
    if (sourceWidth * scale > 4800) scale = 4800 / sourceWidth;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(140, Math.round(sourceHeight * scale));
    const padding = Math.max(18, Math.min(48, Math.round(targetHeight * 0.22)));

    const source = ocrCanvases.source;
    source.width = targetWidth;
    source.height = targetHeight;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

    const color = paddedCanvas("color", targetWidth, targetHeight, padding);
    color.context.drawImage(source, padding, padding);

    const sourceImage = sourceContext.getImageData(0, 0, targetWidth, targetHeight);
    const enhancedImage = sourceContext.createImageData(targetWidth, targetHeight);
    enhancedImage.data.set(sourceImage.data);
    const textImage = sourceContext.createImageData(targetWidth, targetHeight);
    const histogram = new Uint32Array(256);
    const luminances = new Uint8Array(targetWidth * targetHeight);

    for (let index = 0, pixel = 0; index < sourceImage.data.length; index += 4, pixel += 1) {
      const luminance = clampByte(sourceImage.data[index] * 0.2126 + sourceImage.data[index + 1] * 0.7152 + sourceImage.data[index + 2] * 0.0722);
      luminances[pixel] = luminance;
      histogram[luminance] += 1;
      const boostedLuminance = clampByte((luminance - 128) * 1.7 + 128);
      const ratio = luminance > 0 ? boostedLuminance / luminance : 1;
      enhancedImage.data[index] = clampByte(sourceImage.data[index] * ratio);
      enhancedImage.data[index + 1] = clampByte(sourceImage.data[index + 1] * ratio);
      enhancedImage.data[index + 2] = clampByte(sourceImage.data[index + 2] * ratio);
      enhancedImage.data[index + 3] = 255;
    }

    const threshold = otsuThreshold(histogram, luminances.length);
    let darkPixels = 0;
    for (const luminance of luminances) if (luminance <= threshold) darkPixels += 1;
    const brightIsText = luminances.length - darkPixels < darkPixels;
    for (let pixel = 0, index = 0; pixel < luminances.length; pixel += 1, index += 4) {
      const foreground = brightIsText ? luminances[pixel] > threshold : luminances[pixel] <= threshold;
      const value = foreground ? 0 : 255;
      textImage.data[index] = value;
      textImage.data[index + 1] = value;
      textImage.data[index + 2] = value;
      textImage.data[index + 3] = 255;
    }

    const enhanced = paddedCanvas("enhanced", targetWidth, targetHeight, padding);
    enhanced.context.putImageData(enhancedImage, padding, padding);
    const text = paddedCanvas("text", targetWidth, targetHeight, padding);
    text.context.putImageData(textImage, padding, padding);
    return { color: color.canvas, enhanced: enhanced.canvas, text: text.canvas };
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
        tessedit_char_whitelist: "0123456789.,/%()OQILSBZGD",
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300"
      });
      state.ocrWorker = worker;
      return worker;
    })().finally(() => { state.ocrWorkerPromise = null; });
    return state.ocrWorkerPromise;
  }

  async function recognizeFrames(worker, frames) {
    const order = [...new Set([state.preferredOcrVariant, "color", "enhanced", "text"])];
    let bestAttempt = null;
    for (const variant of order) {
      if (!state.detectionRunning) return null;
      elements.ocrProgress.textContent = `${ocrVariantLabels[variant]}辨識中…`;
      const result = await worker.recognize(frames[variant]);
      const text = result?.data?.text?.trim() || "";
      const confidence = Number(result?.data?.confidence);
      const reading = core.parseExperienceText(text, elements.readingFormat.value, Number(elements.maxExp.value));
      const attempt = { variant, text, confidence, reading };
      if (!bestAttempt || (Number.isFinite(confidence) ? confidence : -1) > (Number.isFinite(bestAttempt.confidence) ? bestAttempt.confidence : -1)) bestAttempt = attempt;
      if (reading.valid) {
        state.preferredOcrVariant = variant;
        return attempt;
      }
    }
    return bestAttempt;
  }

  async function scanOnce() {
    if (!state.detectionRunning) return;
    try {
      const frames = buildOcrFrames();
      if (!frames) throw new Error("尚未取得可辨識的畫面。");
      const worker = await ensureOcrWorker();
      if (!state.detectionRunning) return;
      setDetectionStatus("正在辨識 EXP", "working", "辨識期間仍會持續計時。");
      const attempt = await recognizeFrames(worker, frames);
      if (!attempt) return;
      const { text, confidence, reading, variant } = attempt;
      elements.rawOcrText.textContent = text || "（沒有文字）";
      elements.rawOcrText.title = text;
      elements.ocrConfidence.textContent = Number.isFinite(confidence) ? `信心度 ${Math.round(confidence)}%` : "信心度 —";
      if (!reading.valid) {
        setDetectionStatus("這次沒有可用讀值", "error", `${reading.error}；已自動嘗試彩色與文字強化辨識。`);
      } else {
        if (reading.kind === "ratio" && reading.max > 0) elements.maxExp.value = String(reading.max);
        const processed = processReading(reading, "ocr");
        if (processed.accepted) {
          const percentage = Number.isFinite(reading.percentage) ? `（${reading.percentage.toFixed(2)}%）` : "";
          setDetectionStatus(`已讀取 ${formatNumber(reading.current)} EXP`, "working", `${reading.kind === "percent" ? "百分比換算" : reading.kind === "ratio" ? "目前／升級所需" : "數字讀值"}${percentage}・${ocrVariantLabels[variant]}`);
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
    state.preferredOcrVariant = "color";
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
      state.ocrSelection = null;
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
  elements.autoFindExp.addEventListener("click", autoFindExpPanel);
  elements.stopCapture.addEventListener("click", stopCapture);
  elements.clearRegion.addEventListener("click", () => {
    stopDetection();
    state.selection = null;
    state.ocrSelection = null;
    setDetectionStatus("請在預覽上拖曳 EXP 範圍", "working", "框選完成後即可重新啟動自動辨識。");
    updateCaptureControls();
  });
  elements.previewZoom.addEventListener("input", () => applyPreviewZoom(elements.previewZoom.value));
  elements.zoomOut.addEventListener("click", () => applyPreviewZoom(state.previewZoom * 100 - 25));
  elements.zoomIn.addEventListener("click", () => applyPreviewZoom(state.previewZoom * 100 + 25));
  elements.zoomReset.addEventListener("click", () => {
    applyPreviewZoom(100);
    elements.previewShell.scrollTo({ left: 0, top: 0, behavior: "smooth" });
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
  applyPreviewZoom(100);
  updateCaptureControls();
  updateSessionUI();
})();
