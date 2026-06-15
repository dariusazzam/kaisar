(function () {
  "use strict";

  const NATIVE_MAX_DIM = {
    tangan: 0.513,
    body: 1.893,
  };

  const MODEL_PRESETS = {
    tangan: {
      fitTarget: 0.75,
      rotation: { x: -90, y: 0, z: 180 },
      liftZ: 0.1,
      offset: { x: 0, y: 0.3, z: 0 },
      fallbackScale: 1.07,
    },
    body: {
      fitTarget: 1,
      rotation: { x: 90, y: 0, z: 0 },
      liftZ: 0.08,
      offset: { x: 0, y: 0, z: 0 },
      fallbackScale: 0.095,
    },
  };

  const MODEL_PRESET_DEFAULT = MODEL_PRESETS.tangan;

  const PINCH_MIN_RATIO = 0.45;
  const PINCH_MAX_RATIO = 2.2;

  const ROTATION_SENSITIVITY = 0.4;

  const modelBaseScales = new Map();
  const modelBasePositions = new Map();
  const modelBaseRotations = new Map();
  const modelSpinAngles = new Map();

  let activeModel = null;

  const foundTargets = new Set();

  let isPlaying = true;
  let isMuted = false;
  let currentSpeed = 1.0;
  let isImmersive = false;

  const sfxSuccess = new Audio('assets/success_sfx.mp3');
  const sfxButton = new Audio('assets/button_sfx.mp3');
  sfxSuccess.volume = 0.6;
  sfxButton.volume = 0.4;

  let lastTouchX = 0;
  let initialPinchDistance = 0;
  let pinchStartScale = MODEL_PRESETS.tangan.fallbackScale;
  let isGesturing = false;

  let activeAnchorIndex = -1;
  let lostDebounceTimer = null;

  const els = {
    scene: null,
    assets: null,
    loadingScreen: null,
    loadingStatus: null,
    scanningOverlay: null,
    instructionText: null,
    btnInfo: null,
    btnPausePlay: null,
    pausePlayIcon: null,
    btnReset: null,
    btnMute: null,
    muteIcon: null,
    btnSpeed: null,
    speedText: null,
    btnImmersive: null,
    immersiveIcon: null,
    anchors: [],
  };

  function init() {
    cacheElements();
    setupLoadingFlow();

    if (!els.scene) {
      console.error("[KAISAR] <a-scene> tidak ditemukan.");
      showLoadingError("Scene AR tidak ditemukan.");
      return;
    }

    if (els.scene.hasLoaded) {
      onSceneReady();
    } else {
      els.scene.addEventListener("loaded", onSceneReady);
    }
  }

  function cacheElements() {
    els.scene = document.querySelector("a-scene");
    els.assets = document.querySelector("a-assets");
    els.loadingScreen = document.getElementById("loading-screen");
    els.loadingStatus = document.getElementById("loading-status");
    els.scanningOverlay = document.getElementById("scanning-overlay");
    els.instructionText = document.getElementById("instruction-text");
    els.btnInfo = document.getElementById("btn-info");
    els.btnPausePlay = document.getElementById("btn-pause-play");
    els.pausePlayIcon = document.getElementById("pause-play-icon");
    els.btnReset = document.getElementById("btn-reset");
    els.btnMute = document.getElementById("btn-mute");
    els.muteIcon = document.getElementById("mute-icon");
    els.btnSpeed = document.getElementById("btn-speed");
    els.speedText = document.getElementById("speed-text");
    els.btnImmersive = document.getElementById("btn-immersive");
    els.immersiveIcon = document.getElementById("immersive-icon");
    els.anchors = Array.from(document.querySelectorAll("[mindar-image-target]"));
  }

  function setLoadingStatus(message) {
    if (els.loadingStatus) {
      els.loadingStatus.textContent = message;
    }
    console.info("[KAISAR]", message);
  }

  function hideLoadingScreen() {
    els.loadingScreen?.classList.add("is-hidden");
  }

  function ensureCameraFeedVisible() {
    const container = document.getElementById("ar-container") || els.scene?.parentElement;
    const video = container?.querySelector("video") || document.querySelector("video");

    if (video) {
      video.style.position = "absolute";
      video.style.top = "0";
      video.style.left = "0";
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      video.style.zIndex = "0";
      video.play?.().catch(() => {});
    }

    const renderer = els.scene?.renderer;
    if (renderer) {
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.background = "transparent";
    }

    els.scene?.setAttribute("background", "transparent: true");
  }

  function showLoadingError(message) {
    setLoadingStatus(message);
    els.loadingScreen?.classList.add("loading-screen--error");
    els.loadingScreen?.classList.remove("is-hidden");
  }

  function setupLoadingFlow() {
    setLoadingStatus("Memuat model 3D…");

    els.assets?.addEventListener("loaded", () => {
      setLoadingStatus("Model siap. Menyiapkan AR…");
      
      const welcomeScreen = document.getElementById("welcome-screen");
      const btnStart = document.getElementById("btn-start-app");
      
      if (welcomeScreen && btnStart) {
        btnStart.addEventListener("click", () => {
          if (!isMuted) {
            sfxButton.currentTime = 0;
            sfxButton.play().catch(() => {});
          }
          if (navigator.vibrate) navigator.vibrate(40);

          welcomeScreen.classList.add("is-hidden");
          hideLoadingScreen();
          
          const sceneEl = document.querySelector("a-scene");
          if (sceneEl && sceneEl.systems["mindar-image-system"]) {
            sceneEl.systems["mindar-image-system"].start();
          }
        });
      }
    });

    document.querySelectorAll("a-asset-item").forEach((item) => {
      item.addEventListener("error", () => {
        const src = item.getAttribute("src");
        showLoadingError(`Gagal memuat: ${src}`);
      });
    });

    els.scene?.addEventListener("arReady", () => {
      ensureCameraFeedVisible();
      setLoadingStatus("Kamera siap!");
      hideLoadingScreen();
      showScanningUI();
    });

    els.scene?.addEventListener("arError", (event) => {
      const detail = event.detail?.error?.message || "Izin kamera ditolak atau tidak tersedia.";
      showLoadingError(detail);
    });
  }

  function onSceneReady() {
    setLoadingStatus("Menyiapkan kamera…");

    setupAutoScale();
    setupTargetListeners();
    setupControlButtons();
    setupTouchGestures();

    setTimeout(() => {
      if (els.loadingScreen?.classList.contains("is-hidden")) return;

      const mindarSystem = els.scene?.systems["mindar-image-system"];
      if (mindarSystem?.video) {
        ensureCameraFeedVisible();
        hideLoadingScreen();
        showScanningUI();
      }
    }, 15000);
  }

  function setupAutoScale() {
    document.querySelectorAll(".interactable").forEach((modelEl) => {
      if (modelEl.hasAttribute("data-autofit-ready")) return;

      const onLoaded = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            autoFitModel(modelEl);
            initAnimationMixer(modelEl);

            const anchor = modelEl.parentElement;
            if (anchor && foundTargets.has(anchor)) {
              setModelVisible(anchor, true);
              applyTimeScale(modelEl, isPlaying ? currentSpeed : 0);
            }
          });
        });
      };
      modelEl.addEventListener("model-loaded", onLoaded);

      const mesh = modelEl.getObject3D("mesh");
      if (mesh && mesh.children.length > 0) {
        onLoaded();
      }
    });
  }

  function initAnimationMixer(modelEl) {
    const clip = modelEl.dataset.clip;
    if (!clip) return;

    modelEl.setAttribute(
      "animation-mixer",
      `clip: ${clip}; loop: repeat; timeScale: ${isPlaying ? currentSpeed : 0}`
    );
  }

  function getModelPreset(modelEl) {
    const type = modelEl?.dataset?.modelType;
    return (type && MODEL_PRESETS[type]) || MODEL_PRESET_DEFAULT;
  }

  function getModelRotation(modelEl) {
    return { ...getModelPreset(modelEl).rotation };
  }

  function computeModelBounds(root) {
    const THREE = window.THREE;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0 && Number.isFinite(maxDim)) {
        return { box, size, maxDim };
      }
    }

    const temp = new THREE.Box3();
    const merged = new THREE.Box3();
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const geo = node.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox) return;
      temp.copy(geo.boundingBox).applyMatrix4(node.matrixWorld);
      merged.union(temp);
    });

    const size = merged.getSize(new THREE.Vector3());
    return {
      box: merged,
      size,
      maxDim: Math.max(size.x, size.y, size.z),
    };
  }

  function isValidNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function sanitizePosition(pos, preset) {
    return {
      x: isValidNumber(pos.x) ? pos.x : preset.offset.x,
      y: isValidNumber(pos.y) ? pos.y : preset.offset.y,
      z: isValidNumber(pos.z) ? pos.z : preset.liftZ,
    };
  }

  function autoFitModel(modelEl) {
    const THREE = window.THREE;
    if (!THREE) {
      applyFallbackScale(modelEl);
      return;
    }

    const preset = getModelPreset(modelEl);
    const rotation = preset.rotation;

    modelEl.setAttribute("rotation", "0 0 0");
    modelEl.setAttribute("scale", "1 1 1");
    modelEl.setAttribute("position", "0 0 0");
    modelEl.object3D.updateMatrixWorld(true);

    const mesh = modelEl.getObject3D("mesh");
    if (!mesh) {
      console.warn("[KAISAR] Mesh belum siap, pakai skala fallback.");
      applyFallbackScale(modelEl);
      return;
    }

    const modelType = modelEl.dataset.modelType;
    const nativeMax = modelType && NATIVE_MAX_DIM[modelType];
    const initialBounds = computeModelBounds(mesh);
    const measured = initialBounds.maxDim;

    let maxDim = measured;
    if (!maxDim || !Number.isFinite(maxDim) || maxDim < 0.001) {
      if (nativeMax) {
        console.warn(`[KAISAR] Bbox kosong untuk "${modelType}", pakai native ${nativeMax}`);
        maxDim = nativeMax;
      } else {
        console.warn("[KAISAR] Bbox tidak valid, pakai skala fallback.");
        applyFallbackScale(modelEl);
        return;
      }
    } else if (nativeMax && (measured < nativeMax * 0.25 || measured > nativeMax * 4)) {
      console.warn(`[KAISAR] Bbox ${measured.toFixed(3)} tidak wajar untuk "${modelType}", pakai native ${nativeMax}`);
      maxDim = nativeMax;
    }

    if (modelType === "body" && nativeMax) {
      maxDim = nativeMax;
    }

    let centerX = 0, centerY = 0, centerZ = 0;
    if (!initialBounds.box.isEmpty()) {
      const c = initialBounds.box.getCenter(new THREE.Vector3());
      if (isValidNumber(c.x) && isValidNumber(c.y) && isValidNumber(c.z)) {
        centerX = c.x; centerY = c.y; centerZ = c.z;
      }
    }

    const fitScale = preset.fitTarget / maxDim;

    modelEl.setAttribute("scale", `${fitScale} ${fitScale} ${fitScale}`);
    modelEl.setAttribute("rotation", `${rotation.x} ${rotation.y} ${rotation.z}`);

    const pos = sanitizePosition({
      x: -centerX * fitScale + preset.offset.x,
      y: -centerY * fitScale + preset.offset.y,
      z: preset.liftZ - centerZ * fitScale + preset.offset.z,
    }, preset);

    modelEl.setAttribute("position", `${pos.x} ${pos.y} ${pos.z}`);
    modelEl.setAttribute("data-autofit-ready", "true");

    modelBaseRotations.set(modelEl, { ...rotation });
    modelBaseScales.set(modelEl, fitScale);
    modelBasePositions.set(modelEl, { ...pos });
    modelSpinAngles.set(modelEl, 0);

    const clip = modelEl.dataset.clip ?? "model";
    console.info(
      `[KAISAR] Auto-fit "${clip}" (${modelType}): ` +
        `ukuran=${maxDim.toFixed(4)} → skala=${fitScale.toFixed(2)}, ` +
        `pos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}), ` +
        `rot=(${rotation.x}, ${rotation.y}, ${rotation.z})`
    );
  }

  function applyFallbackScale(modelEl) {
    const preset = getModelPreset(modelEl);
    const rotation = preset.rotation;
    const pos = { x: preset.offset.x, y: preset.offset.y, z: preset.liftZ + preset.offset.z };

    modelEl.setAttribute("position", `${pos.x} ${pos.y} ${pos.z}`);
    modelEl.setAttribute("scale", `${preset.fallbackScale} ${preset.fallbackScale} ${preset.fallbackScale}`);
    modelEl.setAttribute("rotation", `${rotation.x} ${rotation.y} ${rotation.z}`);
    modelBaseRotations.set(modelEl, { ...rotation });
    modelBaseScales.set(modelEl, preset.fallbackScale);
    modelBasePositions.set(modelEl, { ...pos });
    modelSpinAngles.set(modelEl, 0);
  }

  function getBaseScale(model) { return modelBaseScales.get(model) ?? getModelPreset(model).fallbackScale; }
  function getBaseRotation(model) { return modelBaseRotations.get(model) ?? getModelRotation(model); }
  function getBasePosition(model) { return modelBasePositions.get(model) ?? { x: 0, y: 0, z: 0 }; }
  function getSpinAngle(model) { return modelSpinAngles.get(model) ?? 0; }
  function getScaleLimits(model) {
    const base = getBaseScale(model);
    return { min: base * PINCH_MIN_RATIO, max: base * PINCH_MAX_RATIO };
  }

  function showScanningUI() {
    els.scanningOverlay?.classList.remove("is-hidden");
    els.instructionText?.classList.add("is-hidden");
    els.scanningOverlay?.setAttribute("aria-hidden", "false");
  }

  function hideScanningUI() {
    els.scanningOverlay?.classList.add("is-hidden");
    els.instructionText?.classList.remove("is-hidden");
    els.scanningOverlay?.setAttribute("aria-hidden", "true");
  }

  function setupTargetListeners() {
    els.anchors.forEach((anchor, index) => {
      anchor.addEventListener("targetFound", () => onTargetFound(anchor, index));
      anchor.addEventListener("targetLost", () => onTargetLost(anchor, index));
    });
  }

  function hideAllModels() {
    document.querySelectorAll(".interactable").forEach((model) => {
      model.setAttribute("visible", false);
      model.object3D.visible = false;
      applyTimeScale(model, 0);
    });
  }

  function setModelVisible(anchor, visible) {
    const model = anchor?.querySelector(".interactable");
    if (!model) return;

    model.setAttribute("visible", visible);
    model.object3D.visible = visible;
    applyTimeScale(model, visible ? (isPlaying ? currentSpeed : 0) : 0);
  }

  function onTargetFound(anchor, index) {
    if (!isMuted) {
      sfxSuccess.currentTime = 0;
      sfxSuccess.play().catch(() => {});
    }

    if (navigator.vibrate) {
      navigator.vibrate(150);
    }

    if (lostDebounceTimer) {
      clearTimeout(lostDebounceTimer);
      lostDebounceTimer = null;
    }

    hideAllModels();
    foundTargets.clear();
    foundTargets.add(anchor);
    activeAnchorIndex = index;

    setModelVisible(anchor, true);
    activeModel = anchor.querySelector(".interactable");
    hideScanningUI();

    if (activeModel) {
      const scale = activeModel.getAttribute("scale");
      console.info(
        `[KAISAR] Markah index=${index} → clip: ${activeModel.dataset.clip}, ` +
          `tipe: ${activeModel.dataset.modelType}, skala: ${scale.x?.toFixed?.(2) ?? scale}`
      );
    }

    const badge = document.getElementById("status-badge");
    if (badge) {
      let label = index === 2 ? "Kosakata: Tidur" : `Huruf: ${index === 0 ? 'A' : 'B'}`;
      badge.textContent = `✅ Terdeteksi — ${label}`;
      badge.classList.add("status-badge--active");
    }
  }

  function onTargetLost(anchor, index) {
    foundTargets.delete(anchor);
    setModelVisible(anchor, false);

    if (activeAnchorIndex === index) {
      activeAnchorIndex = -1;
      activeModel = null;
    }

    console.info(`[KAISAR] Markah index=${index} hilang`);

    if (lostDebounceTimer) clearTimeout(lostDebounceTimer);
    lostDebounceTimer = setTimeout(() => {
      if (foundTargets.size === 0) {
        hideAllModels();
        activeModel = null;
        activeAnchorIndex = -1;
        showScanningUI();
      }
      lostDebounceTimer = null;
    }, 180);

    const badge = document.getElementById("status-badge");
    if (badge && foundTargets.size === 0) {
      badge.textContent = "🔍 Menunggu Kartu...";
      badge.classList.remove("status-badge--active");
    }
  }

  function setupControlButtons() {
    if (!els.btnImmersive) {
      els.btnImmersive = document.getElementById("btn-immersive");
      els.immersiveIcon = document.getElementById("immersive-icon");
    }

    els.btnInfo?.addEventListener("click", () => {
      if (!isMuted) { sfxButton.currentTime = 0; sfxButton.play().catch(() => {}); }
      if (navigator.vibrate) navigator.vibrate(40);

      const welcomeScreen = document.getElementById("welcome-screen");
      welcomeScreen?.classList.remove("is-hidden");
    });

    els.btnPausePlay?.addEventListener("click", () => {
      if (!isMuted) { sfxButton.currentTime = 0; sfxButton.play().catch(() => {}); }
      if (navigator.vibrate) navigator.vibrate(40);

      togglePausePlay();
    });

    els.btnReset?.addEventListener("click", () => {
      if (!isMuted) { sfxButton.currentTime = 0; sfxButton.play().catch(() => {}); }
      if (navigator.vibrate) navigator.vibrate(40);

      resetActiveModel();
    });

    els.btnMute?.addEventListener("click", () => {
      isMuted = !isMuted;
      if (navigator.vibrate) navigator.vibrate(40);

      if (isMuted) {
        if (els.muteIcon) els.muteIcon.textContent = "🔇";
        els.btnMute?.setAttribute("aria-label", "Aktifkan Suara");
      } else {
        if (els.muteIcon) els.muteIcon.textContent = "🔊";
        els.btnMute?.setAttribute("aria-label", "Matikan Suara");
        sfxButton.currentTime = 0;
        sfxButton.play().catch(() => {});
      }
    });

    els.btnSpeed?.addEventListener("click", () => {
      if (!isMuted) { sfxButton.currentTime = 0; sfxButton.play().catch(() => {}); }
      if (navigator.vibrate) navigator.vibrate(40);

      if (currentSpeed === 1.0) {
        currentSpeed = 0.5;
      } else if (currentSpeed === 0.5) {
        currentSpeed = 0.25;
      } else if (currentSpeed === 0.25) {
        currentSpeed = 1.5;
      } else if (currentSpeed === 1.5) {
        currentSpeed = 2.0;
      } else {
        currentSpeed = 1.0;
      }

      if (els.speedText) els.speedText.textContent = `${currentSpeed}x`;

      if (activeModel && isPlaying) {
        applyTimeScale(activeModel, currentSpeed);
      }
    });

    els.btnImmersive?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!isMuted) { sfxButton.currentTime = 0; sfxButton.play().catch(() => {}); }
      if (navigator.vibrate) navigator.vibrate(40);

      isImmersive = !isImmersive;
      toggleImmersiveMode(isImmersive);
    });

    document.addEventListener("fullscreenchange", syncImmersiveFromFullscreen);
    document.addEventListener("webkitfullscreenchange", syncImmersiveFromFullscreen);
  }

  function isFullscreenActive() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );
  }

  function syncImmersiveFromFullscreen() {
    if (!isFullscreenActive() && isImmersive) {
      isImmersive = false;
      toggleImmersiveMode(false, { skipFullscreen: true });
    }
  }

  function toggleImmersiveMode(activate, options = {}) {
    const { skipFullscreen = false } = options;
    const docEl = document.documentElement;
    const uiElements = [
      document.querySelector(".footer-controls"),
      document.getElementById("status-badge"),
      document.getElementById("instruction-text"),
      document.getElementById("scanning-overlay"),
      document.querySelector(".app-header__logo"),
      document.querySelector(".app-header__title"),
    ];

    if (activate) {
      if (!skipFullscreen) {
        const req =
          docEl.requestFullscreen?.bind(docEl) ||
          docEl.webkitRequestFullscreen?.bind(docEl) ||
          docEl.msRequestFullscreen?.bind(docEl);
        if (req) {
          req().catch((err) => {
            console.warn("[KAISAR] Fullscreen tidak tersedia:", err.message);
          });
        }
      }

      uiElements.forEach((el) => el?.classList.add("ui-fade-out"));

      if (els.immersiveIcon) els.immersiveIcon.textContent = "⛶";
      els.btnImmersive?.setAttribute("aria-label", "Keluar Mode Fokus");
      els.btnImmersive?.classList.add("immersive-btn--active");
    } else {
      if (!skipFullscreen && isFullscreenActive()) {
        const exit =
          document.exitFullscreen?.bind(document) ||
          document.webkitExitFullscreen?.bind(document) ||
          document.msExitFullscreen?.bind(document);
        exit?.();
      }

      uiElements.forEach((el) => el?.classList.remove("ui-fade-out"));

      if (els.immersiveIcon) els.immersiveIcon.textContent = "⛶";
      els.btnImmersive?.setAttribute("aria-label", "Mode Fokus");
      els.btnImmersive?.classList.remove("immersive-btn--active");
    }
  }

  function togglePausePlay() {
    isPlaying = !isPlaying;
    applyTimeScale(activeModel, isPlaying ? currentSpeed : 0);
    updatePausePlayIcon(isPlaying);
  }

  function updatePausePlayIcon(playing) {
    if (!els.pausePlayIcon) return;
    els.pausePlayIcon.textContent = playing ? "⏸" : "▶";
  }

  function applyTimeScale(model, timeScale) {
    if (!model) return;
    const mixer = model.components["animation-mixer"];
    if (!mixer) return;

    const currentData = { ...mixer.data, timeScale };
    model.setAttribute("animation-mixer", currentData);

    if (typeof mixer.timeScale !== "undefined") {
      mixer.timeScale = timeScale;
    }
  }

  function resetActiveModel() {
    if (!activeModel) return;

    // Reset akumulasi spin terlebih dahulu
    modelSpinAngles.set(activeModel, 0);

    const baseScale = getBaseScale(activeModel);
    const basePos = getBasePosition(activeModel);
    const baseRot = getBaseRotation(activeModel);

    activeModel.setAttribute("rotation", baseRot.x + " " + baseRot.y + " " + baseRot.z);
    activeModel.setAttribute("position", basePos.x + " " + basePos.y + " " + basePos.z);
    activeModel.setAttribute("scale", baseScale + " " + baseScale + " " + baseScale);

    restartAnimation(activeModel);
    applyTimeScale(activeModel, isPlaying ? currentSpeed : 0);
  }

  function restartAnimation(model) {
    const mixer = model.components["animation-mixer"];
    if (!mixer) return;

    const clip = mixer.data.clip;
    const loop = mixer.data.loop || "repeat";
    const timeScale = isPlaying ? currentSpeed : 0;

    model.removeAttribute("animation-mixer");
    requestAnimationFrame(() => {
      model.setAttribute("animation-mixer", `clip: ${clip}; loop: ${loop}; timeScale: ${timeScale}`);
    });
  }

  function setupTouchGestures() {
    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
  }

  function onTouchStart(event) {
    if (!activeModel) return;
    const touches = event.touches;

    if (touches.length === 1) {
      isGesturing = true;
      lastTouchX = touches[0].clientX;
    } else if (touches.length === 2) {
      isGesturing = true;
      initialPinchDistance = getTouchDistance(touches[0], touches[1]);
      pinchStartScale = getCurrentScale(activeModel);
    }
  }

  function onTouchMove(event) {
    if (!activeModel || !isGesturing) return;
    const touches = event.touches;

    if (touches.length === 1) {
      event.preventDefault();
      const deltaX = touches[0].clientX - lastTouchX;
      lastTouchX = touches[0].clientX;

      const prevSpin = getSpinAngle(activeModel);
      const newSpin  = prevSpin + deltaX * ROTATION_SENSITIVITY;
      modelSpinAngles.set(activeModel, newSpin);

      const baseRot = getBaseRotation(activeModel);
      activeModel.setAttribute("rotation", {
        x: baseRot.x,
        y: baseRot.y + newSpin,
        z: baseRot.z,
      });
      return;
    }

    if (touches.length === 2 && initialPinchDistance > 0) {
      event.preventDefault();
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const ratio = currentDistance / initialPinchDistance;
      const limits = getScaleLimits(activeModel);
      const newScale = clamp(pinchStartScale * ratio, limits.min, limits.max);

      activeModel.setAttribute("scale", newScale + " " + newScale + " " + newScale);
    }
  }

  function onTouchEnd(event) {
    if (event.touches.length === 0) {
      isGesturing = false;
      initialPinchDistance = 0;
      return;
    }

    if (event.touches.length === 1) {
      lastTouchX = event.touches[0].clientX;
      initialPinchDistance = 0;
    }
  }

  function getTouchDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.hypot(dx, dy);
  }

  function getCurrentScale(model) { return model.object3D.scale.x; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();