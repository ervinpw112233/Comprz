import { createIcons, icons } from 'lucide';
import { compressImage, isHeicFile } from './modules/imageCompressor.js';
import { compressPdf, PDF_PRESETS } from './modules/pdfCompressor.js';
import { inspectExif } from './modules/exifDetector.js';
import { downloadAsZip, downloadSingleFile } from './modules/zipManager.js';

// State management
const state = {
  activeTab: 'batch', // 'batch' | 'photo' | 'pdf'
  files: [], // Array of queue items
  quality: 0.75,
  photoQuality: 0.8,
  targetFormat: 'original',
  quickScale: 100,
  pdfPreset: 'rekomendasi',
  resizeMode: 'none',
  customWidth: null,
  customHeight: null,
  lockAspectRatio: true,
  currentAspectRatio: 1.0,
  isProcessing: false
};

// DOM References
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const queueSection = document.getElementById('queueSection');
const queueGrid = document.getElementById('queueGrid');
const batchBar = document.getElementById('batchBar');
const statCount = document.getElementById('statCount');
const statOrigSize = document.getElementById('statOrigSize');
const statNewSize = document.getElementById('statNewSize');
const statSavings = document.getElementById('statSavings');
const btnDownloadAll = document.getElementById('btnDownloadAll');
const btnClearAll = document.getElementById('btnClearAll');
const toastContainer = document.getElementById('toastContainer');

// Tabs
const tabBatch = document.getElementById('tabBatch');
const tabPhoto = document.getElementById('tabPhoto');
const tabPdf = document.getElementById('tabPdf');
const batchControls = document.getElementById('batchControls');
const photoControls = document.getElementById('photoControls');
const pdfControls = document.getElementById('pdfControls');
const dropzoneTitle = document.getElementById('dropzoneTitle');
const dropzoneSubtitle = document.getElementById('dropzoneSubtitle');
const panelTitle = document.getElementById('panelTitle');

// Controls
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const targetFormatSelect = document.getElementById('targetFormatSelect');
const quickResizeSelect = document.getElementById('quickResizeSelect');
const photoQualitySlider = document.getElementById('photoQualitySlider');
const photoQualityValue = document.getElementById('photoQualityValue');
const customWidthInput = document.getElementById('customWidthInput');
const customHeightInput = document.getElementById('customHeightInput');
const btnLockRatio = document.getElementById('btnLockRatio');
const ratioStatusText = document.getElementById('ratioStatusText');

// Modal Elements
const compareModal = document.getElementById('compareModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const modalFileName = document.getElementById('modalFileName');
const imgOriginal = document.getElementById('imgOriginal');
const imgCompressed = document.getElementById('imgCompressed');
const origClipped = document.getElementById('origClipped');
const sliderHandle = document.getElementById('sliderHandle');
const splitWrap = document.getElementById('splitWrap');
const modalOrigMeta = document.getElementById('modalOrigMeta');
const modalNewMeta = document.getElementById('modalNewMeta');

/**
 * Initialize Lucide icons
 */
function refreshIcons() {
  createIcons({ icons });
}

/**
 * Format bytes to human readable format (KB, MB)
 */
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Toast notifications
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-circle';

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 18px; height: 18px; flex-shrink: 0;"></i>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  refreshIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Setup Tabs
 */
function setupTabs() {
  const tabs = [
    { btn: tabBatch, id: 'batch', controls: batchControls, title: 'Tarik & Lepas File ke Sini', subtitle: 'Mendukung PDF, JPG, PNG, WEBP, dan HEIC. Bisa pilih puluhan file sekaligus.', panel: 'Pengaturan Kompresi Global (Semua Format)' },
    { btn: tabPhoto, id: 'photo', controls: photoControls, title: 'Tarik & Lepas Foto untuk Kompres & Resize', subtitle: 'Ubah resolusi piksel, skala %, potong rasio, dan hilangkan metadata EXIF otomatis.', panel: 'Pengaturan Foto & Dimensi Resolusi' },
    { btn: tabPdf, id: 'pdf', controls: pdfControls, title: 'Tarik & Lepas Dokumen PDF ke Sini', subtitle: 'Kompresi multi-halaman PDF dengan preset Ekstrem (CPNS/Email), Seimbang, atau Ringan.', panel: 'Pengaturan Tingkat Kompresi Dokumen PDF' }
  ];

  tabs.forEach(tab => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.btn.setAttribute('aria-selected', 'false');
        t.controls.style.display = 'none';
      });
      tab.btn.classList.add('active');
      tab.btn.setAttribute('aria-selected', 'true');
      tab.controls.style.display = 'grid';

      dropzoneTitle.textContent = tab.title;
      dropzoneSubtitle.textContent = tab.subtitle;
      panelTitle.textContent = tab.panel;

      state.activeTab = tab.id;
    });
  });
}

/**
 * Setup Controls Events
 */
function setupControls() {
  // Quality Slider
  qualitySlider.addEventListener('input', (e) => {
    state.quality = Number(e.target.value) / 100;
    qualityValue.textContent = `${e.target.value}%`;
  });

  photoQualitySlider.addEventListener('input', (e) => {
    state.photoQuality = Number(e.target.value) / 100;
    photoQualityValue.textContent = `${e.target.value}%`;
  });

  // Target Format
  targetFormatSelect.addEventListener('change', (e) => {
    state.targetFormat = e.target.value;
  });

  // Quick Resize
  quickResizeSelect.addEventListener('change', (e) => {
    state.quickScale = Number(e.target.value);
  });

  // Lock Ratio Button
  btnLockRatio.addEventListener('click', () => {
    state.lockAspectRatio = !state.lockAspectRatio;
    if (state.lockAspectRatio) {
      btnLockRatio.classList.add('locked');
      btnLockRatio.innerHTML = '<i data-lucide="lock" style="width: 16px; height: 16px;"></i>';
      ratioStatusText.textContent = 'Rasio Terkunci';
    } else {
      btnLockRatio.classList.remove('locked');
      btnLockRatio.innerHTML = '<i data-lucide="unlock" style="width: 16px; height: 16px;"></i>';
      ratioStatusText.textContent = 'Rasio Bebas';
    }
    refreshIcons();
  });

  // Custom Width / Height Inputs
  customWidthInput.addEventListener('input', (e) => {
    const w = Number(e.target.value);
    state.customWidth = w;
    if (state.lockAspectRatio && w > 0 && state.currentAspectRatio) {
      const calculatedH = Math.round(w / state.currentAspectRatio);
      customHeightInput.value = calculatedH;
      state.customHeight = calculatedH;
    }
  });

  customHeightInput.addEventListener('input', (e) => {
    const h = Number(e.target.value);
    state.customHeight = h;
    if (state.lockAspectRatio && h > 0 && state.currentAspectRatio) {
      const calculatedW = Math.round(h * state.currentAspectRatio);
      customWidthInput.value = calculatedW;
      state.customWidth = calculatedW;
    }
  });

  // Preset Buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const w = Number(btn.dataset.w);
      const h = Number(btn.dataset.h);
      customWidthInput.value = w;
      customHeightInput.value = h;
      state.customWidth = w;
      state.customHeight = h;
      state.currentAspectRatio = w / h;
      showToast(`Preset diterapkan: ${btn.textContent} (${w} x ${h} px)`, 'info');
    });
  });

  // PDF Radio Presets
  document.querySelectorAll('input[name="pdfPreset"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.pdfPreset = e.target.value;
      const desc = PDF_PRESETS[state.pdfPreset]?.label || 'Preset diubah';
      showToast(`Level PDF diatur ke: ${desc}`, 'info');
    });
  });

  // Logo Reset
  document.getElementById('logoBtn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/**
 * Drag and Drop & File Input Setup
 */
function setupDropzone() {
  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
    }
  });

  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      handleFiles(selectedFiles);
    }
    fileInput.value = ''; // Reset for re-selection
  });

  // Paste support (Ctrl+V)
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) pastedFiles.push(blob);
      }
    }
    if (pastedFiles.length > 0) {
      showToast(`${pastedFiles.length} gambar ditempel dari clipboard!`, 'info');
      handleFiles(pastedFiles);
    }
  });
}

/**
 * Handle incoming files
 */
async function handleFiles(fileList) {
  const supportedList = fileList.filter(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    return isImage || isPdf;
  });

  if (supportedList.length === 0) {
    showToast('Format file tidak didukung. Mohon unggah PDF, JPG, PNG, WEBP, atau HEIC.', 'error');
    return;
  }

  showToast(`Menambahkan ${supportedList.length} file ke antrean...`, 'info');

  for (const file of supportedList) {
    const fileId = 'file_' + Math.random().toString(36).substr(2, 9);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isHeic = isHeicFile(file);

    // Initial item structure
    const item = {
      id: fileId,
      originalFile: file,
      name: file.name,
      originalSize: file.size,
      status: 'waiting', // 'waiting' | 'processing' | 'done' | 'error'
      isPdf,
      isHeic,
      progress: 0,
      statusText: 'Menunggu...',
      result: null,
      exifInfo: null,
      thumbUrl: null
    };

    // If image, create temporary thumb URL
    if (!isPdf && !isHeic) {
      item.thumbUrl = URL.createObjectURL(file);
    }

    state.files.push(item);
    renderQueueCard(item);
  }

  updateBatchSummary();
  processQueue();
}

/**
 * Render single card in queue
 */
function renderQueueCard(item) {
  queueSection.style.display = 'block';
  batchBar.style.display = 'flex';

  const ext = item.name.split('.').pop().toUpperCase();
  let badgeClass = 'badge-jpg';
  if (item.isPdf) badgeClass = 'badge-pdf';
  else if (ext === 'PNG') badgeClass = 'badge-png';
  else if (ext === 'WEBP') badgeClass = 'badge-webp';
  else if (ext.includes('HEIC') || ext.includes('HEIF')) badgeClass = 'badge-heic';

  const card = document.createElement('div');
  card.className = 'file-card';
  card.id = `card_${item.id}`;

  let thumbHtml = '';
  if (item.isPdf) {
    thumbHtml = `
      <div class="file-thumb-wrap">
        <i data-lucide="file-text" class="file-thumb-pdf" style="width: 28px; height: 28px;"></i>
      </div>
    `;
  } else if (item.thumbUrl) {
    thumbHtml = `
      <div class="file-thumb-wrap">
        <img src="${item.thumbUrl}" class="file-thumb" alt="${item.name}" />
      </div>
    `;
  } else {
    thumbHtml = `
      <div class="file-thumb-wrap">
        <i data-lucide="image" style="width: 24px; height: 24px; color: #a855f7;"></i>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="file-card-header">
      ${thumbHtml}
      <div class="file-info">
        <div class="file-name" title="${item.name}">${item.name}</div>
        <div class="file-meta-row">
          <span class="file-badge ${badgeClass}">${ext}</span>
          <span class="file-dimensions" id="dim_${item.id}">${formatBytes(item.originalSize)}</span>
        </div>
      </div>
    </div>

    <div class="file-card-stats" id="stats_${item.id}">
      <div class="size-compare">
        <span class="size-orig">${formatBytes(item.originalSize)}</span>
        <span class="size-arrow">→</span>
        <span class="size-new" id="newSize_${item.id}">Memproses...</span>
      </div>
      <div class="save-pill" id="pill_${item.id}" style="background: rgba(255,255,255,0.05); color: #94a3b8; border-color: transparent;">0%</div>
    </div>

    <div class="file-card-footer">
      <div class="exif-status-badge" id="exif_${item.id}">
        <i data-lucide="shield" style="width: 13px; height: 13px;"></i>
        <span>Memeriksa EXIF...</span>
      </div>

      <div class="card-btn-group">
        <button type="button" class="btn-card compare" id="btnCompare_${item.id}" title="Bandingkan Kualitas" style="display: none;">
          <i data-lucide="columns-2" style="width: 15px; height: 15px;"></i>
        </button>
        <button type="button" class="btn-card download" id="btnDl_${item.id}" title="Unduh File Ini" style="display: none;">
          <i data-lucide="download" style="width: 15px; height: 15px;"></i>
        </button>
        <button type="button" class="btn-card delete" id="btnDel_${item.id}" title="Hapus dari antrean">
          <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
        </button>
      </div>
    </div>

    <div class="file-progress-bar" id="prog_${item.id}" style="width: 0%;"></div>
  `;

  queueGrid.appendChild(card);
  refreshIcons();

  // Attach delete event
  document.getElementById(`btnDel_${item.id}`).addEventListener('click', () => {
    removeFile(item.id);
  });
}

/**
 * Process queue sequentially or with concurrency
 */
async function processQueue() {
  if (state.isProcessing) return;
  state.isProcessing = true;

  while (true) {
    const item = state.files.find(f => f.status === 'waiting');
    if (!item) break;

    item.status = 'processing';
    const card = document.getElementById(`card_${item.id}`);
    const progBar = document.getElementById(`prog_${item.id}`);
    const newSizeEl = document.getElementById(`newSize_${item.id}`);
    const pillEl = document.getElementById(`pill_${item.id}`);
    const exifEl = document.getElementById(`exif_${item.id}`);
    const dimEl = document.getElementById(`dim_${item.id}`);
    const btnCompare = document.getElementById(`btnCompare_${item.id}`);
    const btnDl = document.getElementById(`btnDl_${item.id}`);

    try {
      // Step 1: Inspect EXIF for images
      if (!item.isPdf) {
        const exifResult = await inspectExif(item.originalFile);
        item.exifInfo = exifResult;
        if (exifResult.hasExif) {
          exifEl.innerHTML = `<i data-lucide="shield-check" style="width: 13px; height: 13px; color: #10b981;"></i> <span>EXIF Dihapus (${exifResult.gpsFound ? 'GPS, ' : ''}Kamera)</span>`;
        } else {
          exifEl.innerHTML = `<i data-lucide="shield-check" style="width: 13px; height: 13px; color: #10b981;"></i> <span>Bebas EXIF</span>`;
        }
      } else {
        exifEl.innerHTML = `<i data-lucide="file-check" style="width: 13px; height: 13px; color: #38bdf8;"></i> <span>PDF Dimampatkan</span>`;
      }
      refreshIcons();

      // Step 2: Perform Compression
      if (item.isPdf) {
        const res = await compressPdf(item.originalFile, {
          preset: state.pdfPreset,
          onProgress: (percent, text) => {
            if (progBar) progBar.style.width = `${percent}%`;
            if (newSizeEl) newSizeEl.textContent = text;
          }
        });
        item.result = res;
        dimEl.textContent = `${res.numPages} Halaman • ${formatBytes(res.compressedSize)}`;
      } else {
        // Image compression options
        let resizeConfig = { mode: 'none' };

        if (state.activeTab === 'photo' && (state.customWidth || state.customHeight)) {
          resizeConfig = {
            mode: 'custom',
            width: state.customWidth,
            height: state.customHeight,
            maintainAspectRatio: state.lockAspectRatio
          };
        } else if (state.quickScale && state.quickScale < 100) {
          resizeConfig = {
            mode: 'scale',
            scale: state.quickScale
          };
        }

        const currentQuality = state.activeTab === 'photo' ? state.photoQuality : state.quality;

        const res = await compressImage(item.originalFile, {
          quality: currentQuality,
          targetFormat: state.targetFormat,
          resize: resizeConfig,
          onProgress: (percent, text) => {
            if (progBar) progBar.style.width = `${percent}%`;
            if (newSizeEl) newSizeEl.textContent = text;
          }
        });

        item.result = res;
        dimEl.textContent = `${res.width} × ${res.height} px • ${formatBytes(res.compressedSize)}`;

        // Update thumbnail with clean result preview
        const thumbImg = card.querySelector('.file-thumb');
        if (thumbImg) {
          thumbImg.src = res.previewUrl;
        }
      }

      item.status = 'done';
      if (progBar) progBar.style.width = '100%';
      if (newSizeEl) newSizeEl.textContent = formatBytes(item.result.compressedSize);

      const percent = Math.round(item.result.savedPercent);
      if (pillEl) {
        pillEl.textContent = `-${percent}%`;
        pillEl.style.background = 'rgba(16, 185, 129, 0.2)';
        pillEl.style.color = '#10b981';
        pillEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      }

      // Show download button
      if (btnDl) {
        btnDl.style.display = 'flex';
        btnDl.onclick = () => {
          downloadSingleFile(item.result.blob, item.result.fileName);
          showToast(`Mengunduh: ${item.result.fileName}`, 'success');
        };
      }

      // Show comparison button if it's an image
      if (!item.isPdf && btnCompare) {
        btnCompare.style.display = 'flex';
        btnCompare.onclick = () => openComparisonModal(item);
      }

    } catch (err) {
      console.error('Processing error for item:', item.name, err);
      item.status = 'error';
      if (newSizeEl) newSizeEl.textContent = 'Gagal';
      if (pillEl) {
        pillEl.textContent = 'Error';
        pillEl.style.background = 'rgba(239, 68, 68, 0.2)';
        pillEl.style.color = '#ef4444';
      }
      showToast(`Gagal memproses ${item.name}: ${err.message}`, 'error');
    }

    updateBatchSummary();
  }

  state.isProcessing = false;
  refreshIcons();
}

/**
 * Remove single file from queue
 */
function removeFile(fileId) {
  const index = state.files.findIndex(f => f.id === fileId);
  if (index !== -1) {
    const item = state.files[index];
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    if (item.result?.previewUrl) URL.revokeObjectURL(item.result.previewUrl);
    state.files.splice(index, 1);
  }

  const card = document.getElementById(`card_${fileId}`);
  if (card) card.remove();

  updateBatchSummary();

  if (state.files.length === 0) {
    queueSection.style.display = 'none';
    batchBar.style.display = 'none';
  }
}

/**
 * Clear all files
 */
function clearAllFiles() {
  state.files.forEach(item => {
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    if (item.result?.previewUrl) URL.revokeObjectURL(item.result.previewUrl);
  });
  state.files = [];
  queueGrid.innerHTML = '';
  queueSection.style.display = 'none';
  batchBar.style.display = 'none';
  updateBatchSummary();
  showToast('Semua antrean telah dibersihkan.', 'info');
}

/**
 * Update summary stats bar
 */
function updateBatchSummary() {
  const completed = state.files.filter(f => f.status === 'done' && f.result);
  const totalCount = completed.length;

  let origTotal = 0;
  let newTotal = 0;

  completed.forEach(f => {
    origTotal += f.originalSize;
    newTotal += f.result.compressedSize;
  });

  const savedBytes = Math.max(0, origTotal - newTotal);
  const savedPercent = origTotal > 0 ? Math.round((savedBytes / origTotal) * 100) : 0;

  statCount.textContent = `${totalCount} / ${state.files.length}`;
  statOrigSize.textContent = formatBytes(origTotal);
  statNewSize.textContent = formatBytes(newTotal);
  statSavings.textContent = `${formatBytes(savedBytes)} (-${savedPercent}%)`;
}

/**
 * Batch Download as ZIP
 */
async function handleDownloadAll() {
  const completed = state.files.filter(f => f.status === 'done' && f.result);
  if (completed.length === 0) {
    showToast('Belum ada file yang selesai dikompres.', 'error');
    return;
  }

  const filesForZip = completed.map(f => ({
    fileName: f.result.fileName,
    blob: f.result.blob
  }));

  const originalBtnText = btnDownloadAll.innerHTML;
  btnDownloadAll.disabled = true;
  btnDownloadAll.innerHTML = '<i data-lucide="loader" class="spin" style="width: 18px; height: 18px;"></i> <span>Membuat ZIP...</span>';
  refreshIcons();

  try {
    await downloadAsZip(filesForZip, 'comprz-koleksi-hasil.zip', (percent, text) => {
      btnDownloadAll.querySelector('span').textContent = text;
    });
    showToast(`Berhasil mengunduh ${filesForZip.length} file dalam format ZIP!`, 'success');
  } catch (err) {
    console.error('ZIP error:', err);
    showToast('Gagal membuat file ZIP: ' + err.message, 'error');
  } finally {
    btnDownloadAll.disabled = false;
    btnDownloadAll.innerHTML = originalBtnText;
    refreshIcons();
  }
}

/**
 * Open Image Comparison Modal with interactive split slider
 */
function openComparisonModal(item) {
  if (!item.result) return;

  modalFileName.textContent = `Perbandingan: ${item.name}`;
  imgCompressed.src = item.result.previewUrl;

  // Use original object URL or create one
  const origSrc = item.thumbUrl || URL.createObjectURL(item.originalFile);
  imgOriginal.src = origSrc;

  modalOrigMeta.textContent = `${formatBytes(item.originalSize)} (${item.result.originalWidth} × ${item.result.originalHeight} px)`;
  modalNewMeta.textContent = `${formatBytes(item.result.compressedSize)} (${item.result.width} × ${item.result.height} px, -${Math.round(item.result.savedPercent)}%)`;

  // Reset slider position to 50%
  setSliderPos(50);
  compareModal.classList.add('open');
  refreshIcons();
}

/**
 * Split slider position update
 */
function setSliderPos(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  origClipped.style.width = `${clamped}%`;
  sliderHandle.style.left = `${clamped}%`;
}

/**
 * Comparison modal slider interaction
 */
function setupCompareSlider() {
  let isDragging = false;

  const onMove = (e) => {
    if (!isDragging) return;
    const rect = splitWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const offsetX = clientX - rect.left;
    const percent = (offsetX / rect.width) * 100;
    setSliderPos(percent);
  };

  const onStop = () => {
    isDragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onStop);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onStop);
  };

  const onStart = (e) => {
    isDragging = true;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onStop);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onStop);
  };

  sliderHandle.addEventListener('mousedown', onStart);
  sliderHandle.addEventListener('touchstart', onStart);

  btnCloseModal.addEventListener('click', () => {
    compareModal.classList.remove('open');
  });

  compareModal.addEventListener('click', (e) => {
    if (e.target === compareModal) {
      compareModal.classList.remove('open');
    }
  });

  // ESC key to close modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && compareModal.classList.contains('open')) {
      compareModal.classList.remove('open');
    }
  });
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupControls();
  setupDropzone();
  setupCompareSlider();

  btnDownloadAll.addEventListener('click', handleDownloadAll);
  btnClearAll.addEventListener('click', clearAllFiles);

  refreshIcons();
  console.log('Comprz v1.0 running smoothly!');
});
