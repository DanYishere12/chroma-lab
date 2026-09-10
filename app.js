import { paletteCss, paletteSvg, paletteJson } from "./exports.mjs";

const $ = (id) => document.getElementById(id);
const original = $("original"),
  result = $("result"),
  sourceCtx = original.getContext("2d", { willReadFrequently: true }),
  resultCtx = result.getContext("2d");
let worker = null,
  version = 0,
  ready = false,
  palette = [],
  view = "compare",
  currentName = "Chromatic still life",
  busy = false,
  analysisMetadata = null,
  toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function setBusy(value, message = "Discovering colors…") {
  busy = value;
  $("studio").setAttribute("aria-busy", String(value));
  $("colors").disabled = value;
  $("loading").hidden = !value;
  $("loadingText").textContent = message;
  $("analyze").disabled = value || !ready;
  ["copyCss", "exportCss", "exportJson", "exportPalette", "exportImage"].forEach(
    (id) => ($(id).disabled = value || !palette.length),
  );
}
function setView(next) {
  view = next;
  const split = Number($("compare").value);
  result.style.clipPath =
    view === "original"
      ? "inset(0 100% 0 0)"
      : view === "result"
        ? "none"
        : `inset(0 0 0 ${split}%)`;
  $("compareLine").hidden = view !== "compare";
  $("compareLine").style.left = split + "%";
  $("originalLabel").hidden = view === "result";
  $("resultLabel").hidden = view === "original";
  $("compare").disabled = view !== "compare";
  $("compareValue").textContent = split + "%";
  $("compare").setAttribute("aria-valuetext", `${split}% original, ${100 - split}% palette`);
  $("stage").classList.toggle("can-compare", view === "compare");
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
}
async function loadImage(source, name) {
  const token = ++version;
  worker?.terminate();
  worker = null;
  // Decode first: an unreadable upload must not destroy a usable result.
  const previousReady = ready;
  setBusy(true, "Opening your image…");
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    if (token !== version) return;
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error("This image has no readable pixels.");
    const scale = Math.min(
      1,
      1200 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.max(1, Math.round(img.naturalWidth * scale)),
      h = Math.max(1, Math.round(img.naturalHeight * scale));
    original.width = result.width = w;
    original.height = result.height = h;
    sourceCtx.fillStyle = "#ffffff";
    sourceCtx.fillRect(0, 0, w, h);
    sourceCtx.drawImage(img, 0, 0, w, h);
    resultCtx.drawImage(original, 0, 0);
    // Keep the full image fitted to a stable frame, including tall uploads.
    $("stage").style.aspectRatio = `${w}/${h}`;
    $("stage").style.width = `min(100%, ${Math.round((650 * w) / h)}px)`;
    currentName = name;
    $("filename").textContent = name;
    $("dimensions").textContent =
      `${w.toLocaleString()} × ${h.toLocaleString()} px${scale < 1 ? " · resized" : ""}`;
    ready = true;
    setView(view);
    analyze();
  } catch (error) {
    if (token !== version) return;
    ready = previousReady;
    setBusy(false);
    $("status").textContent =
      "Could not open that image. Try a JPEG, PNG, WebP, or AVIF file.";
    toast("Could not read the image. Please choose another.");
  }
}
function analyze() {
  if (!ready) return;
  worker?.terminate();
  const token = ++version;
  clearAnalysis();
  resultCtx.drawImage(original, 0, 0);
  const requestedColors = Number($("colors").value);
  setBusy(true, "Finding color groups…");
  $("status").textContent = "Analyzing pixels locally…";
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    const pixels = sourceCtx.getImageData(
      0,
      0,
      original.width,
      original.height,
    ).data;
    worker.onmessage = ({ data }) => {
      if (token !== version) return;
      if (data.type === "progress") {
        $("loadingText").textContent =
          `Finding color groups · round ${data.round}`;
        return;
      }
      if (data.type === "error") {
        fail(data.message);
        return;
      }
      if (data.type === "done") {
        resultCtx.putImageData(
          new ImageData(data.output, original.width, original.height),
          0,
          0,
        );
        palette = data.palette;
        analysisMetadata = {
          width: original.width,
          height: original.height,
          requested_colors: requestedColors,
          iterations: data.iterations,
          sample_size: data.sampleCount,
        };
        $("paletteCount").textContent =
          "/ " + String(palette.length).padStart(2, "0");
        $("iterations").textContent = data.iterations;
        $("sampleSize").textContent = data.sampleCount.toLocaleString();
        $("elapsed").textContent = (data.elapsed / 1000).toFixed(2) + "s";
        $("status").textContent =
          `${palette.length} colors discovered. Drag the divider or use the slider to compare.`;
        renderPalette();
        setBusy(false);
        worker.terminate();
        worker = null;
      }
    };
    worker.onerror = () => {
      if (token === version)
        fail(
          "Processing stopped. Try a smaller image or run the analysis again.",
        );
    };
    worker.postMessage(
      { pixels: pixels.buffer, k: requestedColors },
      [pixels.buffer],
    );
  } catch (error) {
    fail(
      "This browser could not start the image processor. Try a current browser.",
    );
  }
}
function clearAnalysis() {
  palette = [];
  analysisMetadata = null;
  $("paletteCount").textContent = "/ —";
  $("paletteList").replaceChildren();
  $("swatchBar").replaceChildren();
  ["iterations", "sampleSize", "elapsed"].forEach((id) => {
    $(id).textContent = "—";
  });
}
function fail(message) {
  worker?.terminate();
  worker = null;
  clearAnalysis();
  setView("original");
  setBusy(false);
  $("status").textContent = message;
  toast(message);
}
function renderPalette() {
  $("paletteList").replaceChildren();
  $("swatchBar").replaceChildren();
  palette.forEach((color) => {
    const stripe = document.createElement("span");
    stripe.style.background = color.hex;
    stripe.style.flex = color.share;
    $("swatchBar").append(stripe);
    const button = document.createElement("button");
    button.className = "swatch-row";
    button.setAttribute(
      "aria-label",
      `Copy ${color.hex}, ${(color.share * 100).toFixed(1)} percent of image`,
    );
    const swatch = document.createElement("span");
    swatch.className = "swatch-square";
    swatch.style.background = color.hex;
    const hex = document.createElement("span");
    hex.className = "hex";
    hex.textContent = color.hex;
    const percent = document.createElement("span");
    percent.className = "percent";
    percent.textContent = (color.share * 100).toFixed(1) + "%";
    const copy = document.createElement("span");
    copy.className = "copy-icon";
    copy.textContent = "⧉";
    copy.setAttribute("aria-hidden", "true");
    button.append(swatch, hex, percent, copy);
    button.onclick = () => copyText(color.hex, color.hex + " copied");
    $("paletteList").append(button);
  });
}
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const field = document.createElement("textarea");
    const focused = document.activeElement;
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
    toast(
      ok ? message : "Clipboard unavailable. Use a palette download instead.",
    );
  }
}
function download(blob, filename) {
  const link = document.createElement("a"),
    url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const exportName = () =>
  currentName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "chroma";
$("exportImage").onclick = () => {
  if (busy || !palette.length) return;
  const filename = exportName() + "-posterized.png";
  result.toBlob((blob) => {
    if (blob) download(blob, filename);
    else toast("Could not export this image.");
  }, "image/png");
};
$("exportPalette").onclick = () => {
  if (busy || !palette.length) return;
  download(
    new Blob([paletteSvg(palette)], { type: "image/svg+xml" }),
    exportName() + "-palette.svg",
  );
};
$("copyCss").onclick = () => {
  if (!busy && palette.length)
    copyText(paletteCss(palette), "CSS variables copied");
};
$("exportCss").onclick = () => {
  if (busy || !palette.length) return;
  download(new Blob([paletteCss(palette)], { type: "text/css" }), exportName() + "-palette.css");
};
$("exportJson").onclick = () => {
  if (busy || !palette.length) return;
  download(new Blob([paletteJson(palette, analysisMetadata)], { type: "application/json" }), exportName() + "-palette.json");
};
$("upload").onclick = () => $("file").click();
function openFile(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) {
    toast("Choose a JPEG, PNG, WebP, or AVIF image.");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("Please choose an image under 25 MB.");
    return;
  }
  const url = URL.createObjectURL(file);
  loadImage(url, file.name).finally(() => URL.revokeObjectURL(url));
}
$("file").onchange = (event) => {
  openFile(event.target.files[0]);
  event.target.value = "";
};
const zone = $("dropzone");
let dragDepth = 0;
zone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  zone.classList.add("dragging");
});
zone.addEventListener("dragover", (event) => event.preventDefault());
zone.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    zone.classList.remove("dragging");
  }
});
zone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  zone.classList.remove("dragging");
  openFile(event.dataTransfer.files[0]);
});
// Avoid navigating away if a file is dropped outside the image stage.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());
$("colors").oninput = () => {
  $("colorValue").textContent = $("colors").value;
  if (!busy && ready)
    $("status").textContent =
      "Color count changed. Click Discover colors to apply.";
};
$("analyze").onclick = analyze;
$("compare").oninput = () => setView(view);
// Pointer capture keeps the divider attached even when dragging outside the image.
const stage = $("stage");
let draggingPointer = null;
function updateSplit(event) {
  const bounds = stage.getBoundingClientRect();
  if (!bounds.width) return;
  $("compare").value = Math.round(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
  setView(view);
}
stage.addEventListener("pointerdown", (event) => {
  if (view !== "compare" || busy || !ready || !event.isPrimary || event.button !== 0) return;
  draggingPointer = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  updateSplit(event);
});
stage.addEventListener("pointermove", (event) => {
  if (event.pointerId === draggingPointer) updateSplit(event);
});
function stopDragging() { draggingPointer = null; }
stage.addEventListener("pointerup", stopDragging);
stage.addEventListener("pointercancel", stopDragging);
stage.addEventListener("lostpointercapture", stopDragging);
document
  .querySelectorAll("[data-view]")
  .forEach((button) => (button.onclick = () => setView(button.dataset.view)));
$("sample").onclick = () =>
  loadImage("./assets/sample.jpg", "Chromatic still life");
$("about").onclick = $("method").onclick = () => $("guide").showModal();
$("closeGuide").onclick = $("gotIt").onclick = () => $("guide").close();
loadImage("./assets/sample.jpg", "Chromatic still life");
