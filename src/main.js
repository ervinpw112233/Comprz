import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import heic2any from 'heic2any';

// Setup PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
const state = {
  files: [],
  activeTab: 'batch',
  isProcessing: false,
  quality: 0.75,
  targetFormat: 'original',
  quickScale: 100,
  photoQuality: 0.80,
  customWidth: null,
  customHeight: null,
  lockAspect: true,
  aspectRatio: null,
  pdfPreset: 'balanced',
};

// PDF presets — rasterize scale + JPEG quality
// Scale LEBIH KECIL = file lebih kecil (tapi kualitas teks menurun)
// Text PDF = skala besar selalu lebih besar! Harus JAUH lebih kecil dari original
const PDF_PRESETS = {
  extreme:  { scale: 0.6,  quality: 0.35, rasterize: true,  label: 'Ekstrem'  },
  balanced: { scale: 0.85, quality: 0.55, rasterize: true,  label: 'Seimbang' },
  light:    { scale: 1.2,  quality: 0.75, rasterize: false, label: 'Ringan'   },
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function uid() { return 'f' + Math.random().toString(36).slice(2, 10); }

function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / k ** i).toFixed(1) + ' ' + s[i];
}

function isHeic(file) {
  const e = (file.name || '').split('.').pop().toLowerCase();
  return e === 'heic' || e === 'heif' || (file.type || '').includes('heic') || (file.type || '').includes('heif');
}

function isPdf(file) {
  const e = (file.name || '').split('.').pop().toLowerCase();
  return e === 'pdf' || (file.type || '') === 'application/pdf';
}

function isPng(file) {
  const e = (file.name || '').split('.').pop().toLowerCase();
  return e === 'png' || (file.type || '') === 'image/png';
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toastWrap');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  const icons = { info: '💡', success: '✅', error: '❌', warning: '⚠️' };
  el.innerHTML = `<span class="toast-icon">${icons[type] || '💡'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 5000);
}

function setProgress(id, pct, label) {
  const bar = document.getElementById('prog_' + id);
  const lbl = document.getElementById('progLbl_' + id);
  if (bar) bar.style.width = Math.min(100, pct) + '%';
  if (lbl && label) lbl.textContent = label;
}

// ─────────────────────────────────────────────
// IMAGE COMPRESSION CORE (FIXED)
// ─────────────────────────────────────────────
async function compressImage(file, opts = {}) {
  const {
    quality = 0.75,
    targetFormat = 'original',
    resize = { mode: 'none' },
    onProgress = null,
  } = opts;

  if (onProgress) onProgress(10, 'Membaca file…');

  let blob = file;
  const isH = isHeic(file);
  const isP  = isPng(file);

  // HEIC → JPEG via WebAssembly
  if (isH) {
    if (onProgress) onProgress(25, 'Mengonversi HEIC Apple…');
    try {
      const conv = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      blob = Array.isArray(conv) ? conv[0] : conv;
    } catch (e) {
      throw new Error('Gagal membaca HEIC: ' + e.message);
    }
  }

  if (onProgress) onProgress(45, 'Merender ke canvas…');

  // Load image
  const objUrl = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Gagal memuat gambar. File rusak atau format tidak valid.'));
    i.src = objUrl;
  });
  URL.revokeObjectURL(objUrl);

  const ow = img.naturalWidth || img.width;
  const oh = img.naturalHeight || img.height;

  // Calculate output dimensions
  let tw = ow, th = oh;
  if (resize.mode === 'scale' && resize.scale < 100) {
    const f = resize.scale / 100;
    tw = Math.max(1, Math.round(ow * f));
    th = Math.max(1, Math.round(oh * f));
  } else if (resize.mode === 'custom' && (resize.width || resize.height)) {
    let rw = Number(resize.width) || 0;
    let rh = Number(resize.height) || 0;
    if (resize.maintainAspect) {
      const ar = ow / oh;
      if (rw && !rh) rh = Math.round(rw / ar);
      else if (!rw && rh) rw = Math.round(rh * ar);
      else if (rw && rh) {
        const s = Math.min(rw / ow, rh / oh);
        rw = Math.round(ow * s);
        rh = Math.round(oh * s);
      }
    }
    tw = Math.max(1, rw || ow);
    th = Math.max(1, rh || oh);
  }

  if (onProgress) onProgress(65, 'Mengompresi & membersihkan EXIF…');

  // ── SMART FORMAT RESOLUTION ──
  // PNG cannot be lossy-compressed via canvas. 
  // Strategy: if targetFormat='original' and it's PNG, auto-pick WebP for real compression.
  // If browser doesn't support WebP output, fall back to JPEG.
  let outMime, outExt;

  if (targetFormat === 'image/webp')       { outMime = 'image/webp'; outExt = 'webp'; }
  else if (targetFormat === 'image/jpeg')  { outMime = 'image/jpeg'; outExt = 'jpg';  }
  else if (targetFormat === 'image/png')   { outMime = 'image/png';  outExt = 'png';  }
  else {
    // 'original' mode
    if (isH)  { outMime = 'image/jpeg'; outExt = 'jpg'; }
    else if (file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp')) {
      outMime = 'image/webp'; outExt = 'webp';
    }
    else if (isP) {
      // PNG: use WebP for actual compression (much more effective than PNG→PNG)
      // Fall back to JPEG if WebP not supported
      outMime = 'image/webp'; outExt = 'webp';
    }
    else { outMime = 'image/jpeg'; outExt = 'jpg'; }
  }

  // Draw to canvas (strips EXIF)
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // For JPEG output, fill white background (avoids black on transparent PNG)
  if (outMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.drawImage(img, 0, 0, tw, th);

  if (onProgress) onProgress(82, 'Membangun file output…');

  // ── QUALITY CLAMPING ──
  // PNG: quality is ignored, we already switched to WebP above
  // JPEG/WebP: clamp between 0.05 - 0.95
  const q = (outMime === 'image/png')
    ? undefined
    : Math.max(0.05, Math.min(0.95, quality));

  const tryBlob = (mime, qval) => new Promise((res, rej) => {
    canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob gagal')), mime, qval);
  });

  let resultBlob = await tryBlob(outMime, q);

  // ── WEBP FALLBACK ──
  // Some older browsers don't support WebP output — blob will be null or very large
  if (outMime === 'image/webp' && resultBlob.size < 100) {
    console.warn('[Comprz] WebP not supported by browser, falling back to JPEG');
    outMime = 'image/jpeg'; outExt = 'jpg';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);
    resultBlob = await tryBlob('image/jpeg', q);
  }

  console.log(`[Comprz] "${file.name}" | orig=${(file.size/1024).toFixed(1)}KB → q=${(q*100).toFixed(0)}% ${outMime} = ${(resultBlob.size/1024).toFixed(1)}KB (${((1-resultBlob.size/file.size)*100).toFixed(1)}% saved)`);

  // ── SMART FALLBACK: if result is larger than original, try harder ──
  let attempts = 0;
  let currentQ = q;
  while (resultBlob.size > file.size && outMime !== 'image/png' && attempts < 4) {
    attempts++;
    currentQ = Math.max(0.05, currentQ - 0.12);
    resultBlob = await tryBlob(outMime, currentQ);
    console.log(`[Comprz] Retry ${attempts}: q=${(currentQ*100).toFixed(0)}% → ${(resultBlob.size/1024).toFixed(1)}KB`);
  }

  // If file is still bigger: try the other lossy format
  if (resultBlob.size >= file.size && outMime === 'image/webp') {
    const jpegBlob = await tryBlob('image/jpeg', Math.max(0.05, currentQ));
    if (jpegBlob.size < resultBlob.size) {
      resultBlob = jpegBlob; outMime = 'image/jpeg'; outExt = 'jpg';
      console.log('[Comprz] Switched to JPEG for better compression:', (resultBlob.size/1024).toFixed(1) + 'KB');
    }
  }

  const isResizeOp = resize.mode !== 'none';
  if (resultBlob.size >= file.size && !isResizeOp) {
    console.warn(`[Comprz] ⚠️ "${file.name}": File sudah sangat teroptimasi. Hasil (${(resultBlob.size/1024).toFixed(1)}KB) >= asli (${(file.size/1024).toFixed(1)}KB). Mungkin foto dari WhatsApp/media sosial yang sudah dikompres.`);
  }

  if (onProgress) onProgress(100, 'Selesai!');

  const baseName = (file.name.lastIndexOf('.') > 0)
    ? file.name.slice(0, file.name.lastIndexOf('.'))
    : file.name;

  const finalSavedPct = (file.size - resultBlob.size) / file.size;
  console.log(`[Comprz] ✅ Final: ${(file.size/1024).toFixed(1)}KB → ${(resultBlob.size/1024).toFixed(1)}KB (${(finalSavedPct*100).toFixed(1)}% ${finalSavedPct > 0 ? 'saved' : 'larger'})`);

  return {
    blob: resultBlob,
    fileName: baseName + '-comprz.' + outExt,
    mime: outMime,
    origSize: file.size,
    newSize: resultBlob.size,
    origW: ow, origH: oh,
    newW: tw, newH: th,
    savedPct: finalSavedPct,
    finalQuality: currentQ || q,
    previewUrl: URL.createObjectURL(resultBlob),
  };
}

// ─────────────────────────────────────────────
// PDF COMPRESSION CORE — SMART DUAL STRATEGY
//
// Masalah lama: rasterize PDF teks → JPEG selalu lebih besar
// karena teks vector (kecil) → raster image (besar)
//
// Solusi baru:
//   1. Coba native pdf-lib compression (stream, metadata strip)
//   2. Jika preset balanced/extreme: juga coba rasterize di scale kecil
//   3. Selalu pakai yang hasilnya paling kecil
//   4. Tidak pernah mengembalikan file lebih besar dari aslinya
// ─────────────────────────────────────────────
async function compressPdf(file, opts = {}) {
  const { preset = 'balanced', onProgress = null } = opts;
  const cfg = PDF_PRESETS[preset] || PDF_PRESETS.balanced;

  if (onProgress) onProgress(5, 'Membuka dokumen PDF…');

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const origSize = originalBytes.byteLength;

  // ── STEP 1: Native pdf-lib compression (works for all PDF types) ──
  // Menghapus objek tidak terpakai, stream compression, metadata trim
  if (onProgress) onProgress(12, 'Mengompresi stream native PDF…');
  let nativeBytes;
  let pdfLibDoc;
  try {
    pdfLibDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true, updateMetadata: false });
    // Strip metadata to save space
    pdfLibDoc.setTitle('');
    pdfLibDoc.setAuthor('');
    pdfLibDoc.setSubject('');
    pdfLibDoc.setKeywords([]);
    pdfLibDoc.setProducer('Comprz');
    pdfLibDoc.setCreator('Comprz');
    nativeBytes = await pdfLibDoc.save({ useObjectStreams: true, addDefaultPage: false });
    console.log(`[Comprz PDF] Native: ${(origSize/1024).toFixed(0)}KB → ${(nativeBytes.byteLength/1024).toFixed(0)}KB`);
  } catch (e) {
    console.warn('[Comprz PDF] Native compression gagal:', e.message);
    nativeBytes = originalBytes; // fallback ke asli
  }

  const numPages = pdfLibDoc?.getPageCount() || 0;
  let finalBytes = nativeBytes; // candidate terbaik sejauh ini

  // ── STEP 2: Rasterize (hanya untuk balanced & extreme) ──
  if (cfg.rasterize) {
    let pdfJsDoc;
    try {
      const loadTask = pdfjsLib.getDocument({
        data: originalBytes,
        cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
      });
      pdfJsDoc = await loadTask.promise;
    } catch (e) {
      console.warn('[Comprz PDF] pdf.js gagal membuka:', e.message);
      pdfJsDoc = null;
    }

    if (pdfJsDoc) {
      const n = pdfJsDoc.numPages;
      if (onProgress) onProgress(20, `Rasterize ${n} halaman (scale ${cfg.scale})…`);

      const rasterDoc = await PDFDocument.create();
      let totalJpegBytes = 0;

      for (let i = 1; i <= n; i++) {
        const pct = Math.round(20 + ((i - 1) / n) * 68);
        if (onProgress) onProgress(pct, `Rasterize halaman ${i}/${n}…`);

        const page = await pdfJsDoc.getPage(i);
        const vp1 = page.getViewport({ scale: 1.0 });
        const vpR = page.getViewport({ scale: cfg.scale });

        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(vpR.width));
        canvas.height = Math.max(1, Math.round(vpR.height));

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vpR, intent: 'print' }).promise;

        const jpegBlob = await new Promise((res, rej) => {
          canvas.toBlob(
            b => b ? res(b) : rej(new Error(`toBlob gagal hal ${i}`)),
            'image/jpeg',
            cfg.quality
          );
        });
        const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
        totalJpegBytes += jpegBytes.byteLength;

        const imgEmbed = await rasterDoc.embedJpg(jpegBytes);
        const newPage  = rasterDoc.addPage([vp1.width, vp1.height]);
        newPage.drawImage(imgEmbed, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      }

      if (onProgress) onProgress(92, 'Membangun PDF rasterized…');
      const rasterBytes = await rasterDoc.save({ useObjectStreams: true, addDefaultPage: false });
      console.log(`[Comprz PDF] Raster: ${n} hal, total JPEG=${(totalJpegBytes/1024).toFixed(0)}KB, PDF=${(rasterBytes.byteLength/1024).toFixed(0)}KB`);

      // Hanya pakai raster jika BENAR-BENAR lebih kecil dari native
      if (rasterBytes.byteLength < finalBytes.byteLength) {
        finalBytes = rasterBytes;
        console.log('[Comprz PDF] ✅ Raster dipilih (lebih kecil dari native)');
      } else {
        console.log('[Comprz PDF] ℹ️ Native dipilih (raster lebih besar — PDF ini text-heavy)');
      }
    }
  }

  // ── STEP 3: Jika masih lebih besar dari aslinya, KEMBALIKAN ASLI ──
  // Ini terjadi pada PDF yang sudah sangat teroptimasi
  if (finalBytes.byteLength >= origSize) {
    console.warn('[Comprz PDF] ⚠️ Semua metode gagal mengecilkan. PDF mungkin sudah optimal.');
    finalBytes = originalBytes; // kembalikan file asli — tidak ada kerugian
  }

  if (onProgress) onProgress(97, 'Menyiapkan file…');

  const blob = new Blob([finalBytes], { type: 'application/pdf' });
  const savedPct = (origSize - blob.size) / origSize;
  console.log(`[Comprz PDF] ✅ Final: ${(origSize/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB | ${(savedPct*100).toFixed(1)}% ${savedPct > 0 ? 'lebih kecil ✅' : '(tidak ada perubahan)'}`);

  if (onProgress) onProgress(100, savedPct > 0.01 ? `Hemat ${(savedPct*100).toFixed(0)}%! 🎉` : 'PDF sudah optimal');

  const baseName = file.name.lastIndexOf('.') > 0
    ? file.name.slice(0, file.name.lastIndexOf('.'))
    : file.name;

  return {
    blob,
    fileName: baseName + '-comprz.pdf',
    mime: 'application/pdf',
    origSize,
    newSize: blob.size,
    numPages: numPages || 0,
    savedPct,
    previewUrl: URL.createObjectURL(blob),
  };
}

// ─────────────────────────────────────────────
// ZIP DOWNLOAD
// ─────────────────────────────────────────────
async function downloadZip(items) {
  const zip = new JSZip();
  const seen = new Set();
  items.forEach(({ fileName, blob }) => {
    let name = fileName;
    let n = 1;
    while (seen.has(name)) {
      const ext = fileName.split('.').pop();
      const base = fileName.slice(0, -(ext.length + 1));
      name = `${base}_${n}.${ext}`;
      n++;
    }
    seen.add(name);
    zip.file(name, blob);
  });
  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  triggerDownload(content, 'comprz-hasil.zip');
}

function triggerDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ─────────────────────────────────────────────
// QUEUE PROCESSING
// ─────────────────────────────────────────────
async function processQueue() {
  if (state.isProcessing) return;
  state.isProcessing = true;

  while (true) {
    const item = state.files.find(f => f.status === 'waiting');
    if (!item) break;
    item.status = 'processing';

    try {
      let result;

      if (item.isPdf) {
        result = await compressPdf(item.file, {
          preset: state.pdfPreset,
          onProgress: (pct, lbl) => setProgress(item.id, pct, lbl),
        });
      } else {
        // Build resize options
        let resize = { mode: 'none' };
        if (state.activeTab === 'photo' && (state.customWidth || state.customHeight)) {
          resize = {
            mode: 'custom',
            width: state.customWidth,
            height: state.customHeight,
            maintainAspect: state.lockAspect,
          };
        } else if (state.quickScale < 100) {
          resize = { mode: 'scale', scale: state.quickScale };
        }

        const quality = state.activeTab === 'photo' ? state.photoQuality : state.quality;

        result = await compressImage(item.file, {
          quality,
          targetFormat: state.targetFormat,
          resize,
          onProgress: (pct, lbl) => setProgress(item.id, pct, lbl),
        });
      }

      item.status = 'done';
      item.result = result;
      updateCard(item);

    } catch (err) {
      console.error('[Comprz Error]', item.name, err);
      item.status = 'error';
      item.errorMsg = err.message;
      updateCard(item);
      toast(`❌ Gagal proses "${item.name}": ${err.message}`, 'error');
    }

    updateSummary();
  }

  state.isProcessing = false;
}

// ─────────────────────────────────────────────
// CARD UI
// ─────────────────────────────────────────────
function addFilesToQueue(fileList) {
  const valid = fileList.filter(f => {
    const ext = (f.name || '').split('.').pop().toLowerCase();
    return ['jpg','jpeg','png','webp','heic','heif','pdf'].includes(ext)
      || (f.type || '').startsWith('image/')
      || (f.type || '') === 'application/pdf';
  });

  if (valid.length === 0) {
    toast('Format tidak didukung! Gunakan JPG, PNG, WEBP, HEIC, atau PDF.', 'error');
    return;
  }

  valid.forEach(file => {
    const id = uid();
    const item = {
      id, file,
      name: file.name || 'unknown',
      size: file.size,
      isPdf: isPdf(file),
      isHeic: isHeic(file),
      isPng: isPng(file),
      status: 'waiting',
      result: null,
      errorMsg: null,
      thumbUrl: null,
    };

    if (!item.isPdf && !item.isHeic) {
      item.thumbUrl = URL.createObjectURL(file);
    }

    state.files.push(item);
    renderCard(item);
  });

  document.getElementById('queueSection').style.display = 'block';
  document.getElementById('batchBar').style.display = 'flex';
  updateSummary();
  processQueue();
  toast(`${valid.length} file ditambahkan ke antrean.`, 'info');
}

function getExt(name) { return (name.split('.').pop() || '').toUpperCase(); }
function badgeColor(ext, pdf) {
  if (pdf) return '#ef4444';
  if (ext === 'PNG') return '#3b82f6';
  if (ext === 'WEBP') return '#10b981';
  if (ext === 'HEIC' || ext === 'HEIF') return '#ec4899';
  return '#f59e0b';
}

function renderCard(item) {
  const grid = document.getElementById('queueGrid');
  const ext = getExt(item.name);
  const color = badgeColor(ext, item.isPdf);

  const card = document.createElement('div');
  card.className = 'file-card';
  card.id = 'card_' + item.id;

  const thumbHtml = item.isPdf
    ? `<div class="thumb-box pdf-thumb">PDF</div>`
    : item.isHeic
      ? `<div class="thumb-box heic-thumb">HEIC</div>`
      : `<div class="thumb-box"><img src="${item.thumbUrl}" alt="" /></div>`;

  const sizeKB = (item.size / 1024).toFixed(0);

  card.innerHTML = `
    <div class="card-top">
      ${thumbHtml}
      <div class="card-info">
        <div class="card-name" title="${item.name}">${item.name}</div>
        <div class="card-meta">
          <span class="ext-badge" style="background:${color}20;color:${color};border-color:${color}50">${ext}</span>
          <span class="card-size" id="cardSize_${item.id}">${fmtBytes(item.size)}</span>
        </div>
        <div class="card-status" id="cardStatus_${item.id}">
          <span class="status-dot waiting"></span> Menunggu…
        </div>
      </div>
      <button class="btn-del" id="del_${item.id}" title="Hapus dari antrean">✕</button>
    </div>
    <div class="card-progress">
      <div class="prog-track">
        <div class="prog-bar" id="prog_${item.id}" style="width:0%"></div>
      </div>
      <span class="prog-label" id="progLbl_${item.id}"></span>
    </div>
    <div class="card-bottom" id="cardBottom_${item.id}" style="display:none">
      <div class="size-row">
        <span class="size-before">${fmtBytes(item.size)}</span>
        <span class="size-arrow">→</span>
        <span class="size-after" id="sizeAfter_${item.id}">—</span>
        <span class="save-badge" id="saveBadge_${item.id}"></span>
      </div>
      <div class="exif-row">
        <span class="exif-tag">🛡 EXIF & GPS Dihapus Otomatis</span>
      </div>
      <div class="card-btns">
        <button class="btn-compare" id="btnCmp_${item.id}" style="display:none">👁 Bandingkan</button>
        <button class="btn-dl"      id="btnDl_${item.id}"  style="display:none">⬇ Unduh</button>
      </div>
    </div>
  `;

  grid.appendChild(card);
  document.getElementById('del_' + item.id).onclick = () => removeFile(item.id);
}

function updateCard(item) {
  const statusEl  = document.getElementById('cardStatus_' + item.id);
  const bottomEl  = document.getElementById('cardBottom_' + item.id);
  const sizeAfter = document.getElementById('sizeAfter_'  + item.id);
  const saveBadge = document.getElementById('saveBadge_'  + item.id);
  const btnDl     = document.getElementById('btnDl_'      + item.id);
  const btnCmp    = document.getElementById('btnCmp_'     + item.id);
  const progBar   = document.getElementById('prog_'       + item.id);
  const progLbl   = document.getElementById('progLbl_'    + item.id);
  const cardSizeEl= document.getElementById('cardSize_'   + item.id);

  if (item.status === 'done' && item.result) {
    const r = item.result;
    const pctNum = Math.round(r.savedPct * 100);
    const saved = pctNum > 0;

    // Progress bar
    if (progBar) {
      progBar.style.width = '100%';
      progBar.style.background = saved
        ? 'linear-gradient(90deg,#10b981,#34d399)'
        : 'linear-gradient(90deg,#f59e0b,#fbbf24)';
    }
    if (progLbl) progLbl.textContent = saved ? '✅ Selesai!' : '⚠️ Ukuran tidak berkurang';

    if (statusEl) {
      statusEl.innerHTML = saved
        ? '<span class="status-dot done"></span> Selesai'
        : '<span class="status-dot warn"></span> Sudah optimal';
    }

    if (bottomEl) bottomEl.style.display = 'block';
    if (sizeAfter) sizeAfter.textContent = fmtBytes(r.newSize);

    if (cardSizeEl && item.isPdf) {
      cardSizeEl.textContent = `${r.numPages} halaman • ${fmtBytes(item.size)}`;
    }

    if (saveBadge) {
      if (saved) {
        saveBadge.textContent   = `-${pctNum}%`;
        saveBadge.style.cssText = 'background:rgba(16,185,129,.18);color:#10b981;border:1px solid rgba(16,185,129,.4);border-radius:9999px;padding:2px 8px;font-size:.75rem;font-weight:700';
      } else {
        const over = Math.abs(pctNum);
        saveBadge.textContent   = over > 0 ? `+${over}%` : '=';
        saveBadge.style.cssText = 'background:rgba(245,158,11,.18);color:#f59e0b;border:1px solid rgba(245,158,11,.4);border-radius:9999px;padding:2px 8px;font-size:.75rem;font-weight:700';
      }
    }

    // Update thumbnail for images
    if (!item.isPdf && r.previewUrl) {
      const thumbImg = document.querySelector(`#card_${item.id} .thumb-box img`);
      if (thumbImg) thumbImg.src = r.previewUrl;
    }

    if (btnDl) {
      btnDl.style.display = 'inline-flex';
      btnDl.onclick = () => {
        triggerDownload(r.blob, r.fileName);
        toast(`Mengunduh ${r.fileName}`, 'success');
      };
    }

    if (btnCmp && !item.isPdf) {
      btnCmp.style.display = 'inline-flex';
      btnCmp.onclick = () => openModal(item);
    }

  } else if (item.status === 'error') {
    if (progBar) { progBar.style.width = '100%'; progBar.style.background = '#ef4444'; }
    if (progLbl) progLbl.textContent = '❌ Gagal diproses';
    if (statusEl) statusEl.innerHTML = `<span class="status-dot error"></span> Error: ${item.errorMsg || 'Unknown'}`;
  }
}

function removeFile(id) {
  const idx = state.files.findIndex(f => f.id === id);
  if (idx >= 0) {
    const item = state.files[idx];
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    if (item.result?.previewUrl) URL.revokeObjectURL(item.result.previewUrl);
    state.files.splice(idx, 1);
  }
  document.getElementById('card_' + id)?.remove();
  updateSummary();
  if (state.files.length === 0) {
    document.getElementById('queueSection').style.display = 'none';
    document.getElementById('batchBar').style.display = 'none';
  }
}

// ─────────────────────────────────────────────
// SUMMARY BAR
// ─────────────────────────────────────────────
function updateSummary() {
  const done = state.files.filter(f => f.status === 'done' && f.result);
  let origTotal = 0, newTotal = 0;
  done.forEach(f => { origTotal += f.size; newTotal += f.result.newSize; });
  const savedBytes = Math.max(0, origTotal - newTotal);
  const savedPct   = origTotal > 0 ? Math.round(savedBytes / origTotal * 100) : 0;

  document.getElementById('statFiles').textContent = `${done.length}/${state.files.length}`;
  document.getElementById('statOrig').textContent  = fmtBytes(origTotal);
  document.getElementById('statNew').textContent   = fmtBytes(newTotal);
  document.getElementById('statSaved').textContent = `${fmtBytes(savedBytes)} (-${savedPct}%)`;
}

// ─────────────────────────────────────────────
// COMPARISON MODAL
// ─────────────────────────────────────────────
let _modalCleanup = null;

function openModal(item) {
  if (!item.result) return;

  const modal     = document.getElementById('modal');
  const imgBefore = document.getElementById('imgBefore');
  const imgAfter  = document.getElementById('imgAfter');
  const beforeClip= document.getElementById('beforeClip');
  const handle    = document.getElementById('splitHandle');
  const metaBefore= document.getElementById('metaBefore');
  const metaAfter = document.getElementById('metaAfter');
  const wrap      = document.getElementById('splitWrap');

  const origSrc = item.thumbUrl || URL.createObjectURL(item.file);
  imgBefore.src = origSrc;
  imgAfter.src  = item.result.previewUrl;

  document.getElementById('modalTitle').textContent = item.name;
  metaBefore.textContent = `Asli: ${fmtBytes(item.size)} | ${item.result.origW}×${item.result.origH}px`;
  metaAfter.textContent  = `Hasil: ${fmtBytes(item.result.newSize)} | ${item.result.newW}×${item.result.newH}px | ${Math.round(item.result.savedPct * 100)}% lebih kecil`;

  setSplit(50);
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('open'), 10);

  // Split slider drag
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const rect = wrap.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setSplit((x / rect.width) * 100);
  };
  const onUp = () => { dragging = false; };
  const onStart = (e) => { e.preventDefault(); dragging = true; };

  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onUp);

  if (_modalCleanup) _modalCleanup();
  _modalCleanup = () => {
    handle.removeEventListener('mousedown', onStart);
    handle.removeEventListener('touchstart', onStart);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  };
}

function setSplit(pct) {
  const p = Math.max(0, Math.min(100, pct));
  document.getElementById('beforeClip').style.width  = p + '%';
  document.getElementById('splitHandle').style.left  = p + '%';
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 300);
  if (_modalCleanup) { _modalCleanup(); _modalCleanup = null; }
}

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  ['batch', 'photo', 'pdf'].forEach(t => {
    document.getElementById('tab_' + t).classList.toggle('active', t === tab);
    document.getElementById('ctrl_' + t).style.display = t === tab ? 'block' : 'none';
  });

  const dzTitle  = document.getElementById('dzTitle');
  const dzSub    = document.getElementById('dzSub');
  const fileInput= document.getElementById('fileInput');

  if (tab === 'batch') {
    dzTitle.textContent  = 'Tarik & Lepas File di Sini';
    dzSub.textContent    = 'PDF, JPG, PNG, WEBP, HEIC — bisa puluhan sekaligus';
    fileInput.accept     = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf';
  } else if (tab === 'photo') {
    dzTitle.textContent  = 'Tarik & Lepas Foto untuk Kompres + Resize';
    dzSub.textContent    = 'JPG, PNG, WEBP, HEIC — kontrol resolusi & EXIF wipe';
    fileInput.accept     = '.jpg,.jpeg,.png,.webp,.heic,.heif,image/*';
  } else {
    dzTitle.textContent  = 'Tarik & Lepas Dokumen PDF';
    dzSub.textContent    = 'Kompres multi-halaman PDF hingga 80% lebih kecil';
    fileInput.accept     = '.pdf,application/pdf';
  }
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Tab buttons
  document.getElementById('tab_batch').onclick = () => switchTab('batch');
  document.getElementById('tab_photo').onclick = () => switchTab('photo');
  document.getElementById('tab_pdf').onclick   = () => switchTab('pdf');

  // Dropzone
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');

  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', ()=> dz.classList.remove('dz-over'));
  dz.addEventListener('dragend',   ()=> dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dz-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFilesToQueue(files);
  });

  document.getElementById('btnBrowse').onclick = () => fi.click();
  fi.onchange = e => {
    const files = Array.from(e.target.files);
    if (files.length) addFilesToQueue(files);
    fi.value = '';
  };

  // Paste support (Ctrl+V)
  window.addEventListener('paste', e => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter(i => i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (files.length) { toast(`${files.length} gambar ditempel!`, 'info'); addFilesToQueue(files); }
  });

  // ── Batch controls ──
  const qs = document.getElementById('qualitySlider');
  const qv = document.getElementById('qualityVal');
  qs.oninput = () => { state.quality = qs.value / 100; qv.textContent = qs.value + '%'; };

  const fmt = document.getElementById('formatSelect');
  fmt.onchange = () => { state.targetFormat = fmt.value; };

  const qrs = document.getElementById('quickResizeSelect');
  qrs.onchange = () => { state.quickScale = Number(qrs.value); };

  // ── Photo controls ──
  const pqs = document.getElementById('photoQualitySlider');
  const pqv = document.getElementById('photoQualityVal');
  pqs.oninput = () => { state.photoQuality = pqs.value / 100; pqv.textContent = pqs.value + '%'; };

  const widthInp  = document.getElementById('widthInp');
  const heightInp = document.getElementById('heightInp');
  const lockBtn   = document.getElementById('lockBtn');
  const lockLabel = document.getElementById('lockLabel');

  lockBtn.onclick = () => {
    state.lockAspect = !state.lockAspect;
    lockBtn.textContent  = state.lockAspect ? '🔒' : '🔓';
    lockLabel.textContent= state.lockAspect ? 'Terkunci' : 'Bebas';
  };

  widthInp.oninput = () => {
    state.customWidth = Number(widthInp.value) || null;
    if (state.lockAspect && state.aspectRatio && state.customWidth) {
      state.customHeight = Math.round(state.customWidth / state.aspectRatio);
      heightInp.value    = state.customHeight;
    }
  };

  heightInp.oninput = () => {
    state.customHeight = Number(heightInp.value) || null;
    if (state.lockAspect && state.aspectRatio && state.customHeight) {
      state.customWidth = Math.round(state.customHeight * state.aspectRatio);
      widthInp.value    = state.customWidth;
    }
  };

  // Preset size buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
      const w = Number(btn.dataset.w), h = Number(btn.dataset.h);
      state.customWidth = w; state.customHeight = h; state.aspectRatio = w / h;
      widthInp.value = w; heightInp.value = h;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toast(`Preset: ${btn.textContent} (${w}×${h}px)`, 'info');
    };
  });

  // ── PDF preset radio cards ──
  document.querySelectorAll('input[name="pdfPreset"]').forEach(r => {
    r.onchange = () => {
      state.pdfPreset = r.value;
      document.querySelectorAll('.pdf-preset-card').forEach(c => c.classList.remove('selected'));
      r.closest('.pdf-preset-card').classList.add('selected');
    };
  });

  // ── Download All ZIP ──
  document.getElementById('btnDownloadAll').onclick = async () => {
    const done = state.files.filter(f => f.status === 'done' && f.result);
    if (!done.length) { toast('Belum ada file yang selesai dikompres.', 'error'); return; }
    const btn = document.getElementById('btnDownloadAll');
    btn.disabled = true; btn.textContent = '⏳ Membuat ZIP…';
    try {
      await downloadZip(done.map(f => ({ fileName: f.result.fileName, blob: f.result.blob })));
      toast(`${done.length} file dikemas dalam ZIP! ✅`, 'success');
    } catch (e) {
      toast('Gagal membuat ZIP: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⬇ Unduh Semua (.ZIP)';
    }
  };

  // ── Clear All ──
  document.getElementById('btnClearAll').onclick = () => {
    state.files.forEach(f => {
      if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      if (f.result?.previewUrl) URL.revokeObjectURL(f.result.previewUrl);
    });
    state.files = [];
    document.getElementById('queueGrid').innerHTML = '';
    document.getElementById('queueSection').style.display = 'none';
    document.getElementById('batchBar').style.display = 'none';
    updateSummary();
    toast('Semua antrean dibersihkan.', 'info');
  };

  // ── Modal ──
  document.getElementById('btnCloseModal').onclick = closeModal;
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Init tab
  switchTab('batch');
  console.log('✅ Comprz v1.1 ready — compression engine loaded!');
});
