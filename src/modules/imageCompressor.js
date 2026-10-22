/**
 * High Performance Image Compressor & Resizer
 * Supports JPG, PNG, WEBP, and HEIC
 * Automatically strips EXIF metadata for 100% privacy
 */

import heic2any from 'heic2any';

/**
 * Load an image source into an HTMLImageElement
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Gagal memuat gambar: ' + (e.message || 'Format tidak valid')));
    img.src = src;
  });
}

/**
 * Check if a file is HEIC/HEIF
 */
export function isHeicFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return ext === 'heic' || ext === 'heif' || file.type.includes('heic') || file.type.includes('heif');
}

/**
 * Determine output MIME type and file extension
 */
function resolveOutputFormat(file, targetFormat = 'original') {
  const isHeic = isHeicFile(file);
  const fileExt = file.name.split('.').pop().toLowerCase();

  if (targetFormat && targetFormat !== 'original') {
    if (targetFormat === 'image/webp') return { mime: 'image/webp', ext: 'webp' };
    if (targetFormat === 'image/jpeg') return { mime: 'image/jpeg', ext: 'jpg' };
    if (targetFormat === 'image/png') return { mime: 'image/png', ext: 'png' };
  }

  // Auto preserve original type (HEIC converts to JPG by default)
  if (isHeic) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (file.type === 'image/webp' || fileExt === 'webp') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (file.type === 'image/png' || fileExt === 'png') {
    return { mime: 'image/png', ext: 'png' };
  }
  return { mime: 'image/jpeg', ext: 'jpg' };
}

/**
 * Calculate target dimensions based on resize options
 */
export function calculateDimensions(origWidth, origHeight, resizeOptions = {}) {
  const {
    mode = 'none', // 'none' | 'scale' | 'custom' | 'preset'
    scale = 100,
    width,
    height,
    maintainAspectRatio = true
  } = resizeOptions;

  if (mode === 'none') {
    return { width: origWidth, height: origHeight };
  }

  if (mode === 'scale') {
    const factor = Math.max(1, Math.min(100, Number(scale) || 100)) / 100;
    return {
      width: Math.max(1, Math.round(origWidth * factor)),
      height: Math.max(1, Math.round(origHeight * factor))
    };
  }

  if (mode === 'custom' || mode === 'preset') {
    let targetW = Number(width);
    let targetH = Number(height);

    if (!targetW && !targetH) {
      return { width: origWidth, height: origHeight };
    }

    if (maintainAspectRatio) {
      const aspectRatio = origWidth / origHeight;
      if (targetW && !targetH) {
        targetH = Math.round(targetW / aspectRatio);
      } else if (!targetW && targetH) {
        targetW = Math.round(targetH * aspectRatio);
      } else if (targetW && targetH) {
        // Fit within bounding box while maintaining ratio
        const scaleW = targetW / origWidth;
        const scaleH = targetH / origHeight;
        const fitScale = Math.min(scaleW, scaleH);
        targetW = Math.round(origWidth * fitScale);
        targetH = Math.round(origHeight * fitScale);
      }
    }

    return {
      width: Math.max(1, targetW || origWidth),
      height: Math.max(1, targetH || origHeight)
    };
  }

  return { width: origWidth, height: origHeight };
}

/**
 * Main compression function for single image file
 */
export async function compressImage(file, options = {}) {
  const {
    quality = 0.8, // 0.1 to 1.0
    targetFormat = 'original', // 'original' | 'image/jpeg' | 'image/webp' | 'image/png'
    resize = { mode: 'none' },
    onProgress = null
  } = options;

  if (onProgress) onProgress(15, 'Membaca file gambar...');

  let processBlob = file;
  let isHeic = isHeicFile(file);

  // If HEIC, decode using heic2any WebAssembly
  if (isHeic) {
    if (onProgress) onProgress(30, 'Mengonversi format HEIC (Apple)...');
    try {
      const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.95
      });
      processBlob = Array.isArray(converted) ? converted[0] : converted;
    } catch (heicErr) {
      console.error('HEIC conversion error:', heicErr);
      throw new Error('Gagal memproses file HEIC: Format file HEIC rusak atau tidak didukung.');
    }
  }

  if (onProgress) onProgress(45, 'Merender piksel gambar...');

  // Create Object URL for loading into Canvas
  const objectUrl = URL.createObjectURL(processBlob);
  let img;
  try {
    img = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  // Calculate target dimensions
  const { width: targetWidth, height: targetHeight } = calculateDimensions(origWidth, origHeight, resize);

  if (onProgress) onProgress(65, 'Mengompresi & menghapus metadata EXIF...');

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: true });

  // Use high quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { mime: outputMime, ext: outputExt } = resolveOutputFormat(file, targetFormat);

  // If output is JPEG, fill background with white to avoid black background on transparent PNGs
  if (outputMime === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  // Draw image to canvas (this automatically strips all EXIF metadata!)
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  if (onProgress) onProgress(85, 'Menyusun berkas keluaran...');

  // Export to Blob
  // For PNG, canvas.toBlob does not take a quality parameter standardly;
  // If user selected PNG and wants compression, we can either use high-quality PNG or convert to WebP
  const compressionQuality = outputMime === 'image/png' ? undefined : Math.max(0.05, Math.min(1.0, quality));

  const resultBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Gagal membuat blob gambar'));
      },
      outputMime,
      compressionQuality
    );
  });

  // Generate output filename
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  const cleanBaseName = baseName.replace(/[\s_]+comprz/i, '');
  const finalFileName = `${cleanBaseName}-comprz.${outputExt}`;

  if (onProgress) onProgress(100, 'Kompresi selesai!');

  return {
    blob: resultBlob,
    fileName: finalFileName,
    mimeType: outputMime,
    originalSize: file.size,
    compressedSize: resultBlob.size,
    originalWidth: origWidth,
    originalHeight: origHeight,
    width: targetWidth,
    height: targetHeight,
    savedBytes: Math.max(0, file.size - resultBlob.size),
    savedPercent: Math.max(0, ((file.size - resultBlob.size) / file.size) * 100),
    exifStripped: true,
    previewUrl: URL.createObjectURL(resultBlob)
  };
}
