/**
 * Client-Side PDF Compressor
 * Uses pdfjs-dist for rendering & pdf-lib for document reconstruction
 * 100% private, runs entirely inside the browser
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';

// Set up worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export const PDF_PRESETS = {
  ekstrem: {
    label: 'Kompresi Ekstrem (File Sangat Kecil)',
    description: 'Cocok untuk portal CPNS, email, batas upload < 500KB atau < 1MB.',
    scale: 1.1,
    quality: 0.52
  },
  rekomendasi: {
    label: 'Rekomendasi (Kualitas Seimbang)',
    description: 'Pilihan terbaik untuk dokumen harian, tulisan tetap jelas & ukuran hemat 60-80%.',
    scale: 1.5,
    quality: 0.72
  },
  ringan: {
    label: 'Kompresi Ringan (Ketajaman Tinggi)',
    description: 'Mempertahankan detail grafis tinggi dengan pengurangan ukuran 30-50%.',
    scale: 2.0,
    quality: 0.85
  }
};

/**
 * Compress a PDF file completely in the browser
 */
export async function compressPdf(file, options = {}) {
  const {
    preset = 'rekomendasi', // 'ekstrem' | 'rekomendasi' | 'ringan'
    customQuality = null,
    onProgress = null
  } = options;

  const config = PDF_PRESETS[preset] || PDF_PRESETS.rekomendasi;
  const quality = customQuality !== null ? customQuality : config.quality;
  const scale = config.scale;

  if (onProgress) onProgress(5, 'Membaca dokumen PDF...');

  const arrayBuffer = await file.arrayBuffer();

  let loadingTask;
  try {
    loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + pdfjsLib.version + '/cmaps/',
      cMapPacked: true
    });
  } catch (err) {
    throw new Error('Gagal membuka PDF: ' + err.message);
  }

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  if (numPages === 0) {
    throw new Error('Dokumen PDF kosong atau tidak valid.');
  }

  if (onProgress) onProgress(15, `Memulai pemrosesan ${numPages} halaman...`);

  // Create fresh PDF document using pdf-lib
  const newPdfDoc = await PDFDocument.create();

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const percent = Math.round(15 + ((pageNum - 1) / numPages) * 75);
    if (onProgress) onProgress(percent, `Mengompresi halaman ${pageNum} dari ${numPages}...`);

    const page = await pdfDoc.getPage(pageNum);
    const originalViewport = page.getViewport({ scale: 1.0 });
    const renderViewport = page.getViewport({ scale });

    // Render page to canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: renderViewport,
      intent: 'print'
    }).promise;

    // Convert canvas to compressed JPEG
    const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);

    // Embed into pdf-lib
    const embeddedImg = await newPdfDoc.embedJpg(jpegDataUrl);

    // Add page matching original point dimensions (A4 is usually 595.28 x 841.89 pt)
    const newPage = newPdfDoc.addPage([originalViewport.width, originalViewport.height]);
    newPage.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: originalViewport.width,
      height: originalViewport.height
    });
  }

  if (onProgress) onProgress(92, 'Menyusun & mengoptimalkan struktur PDF baru...');

  // Save new PDF with object stream compression
  const compressedBytes = await newPdfDoc.save({ useObjectStreams: true });
  const resultBlob = new Blob([compressedBytes], { type: 'application/pdf' });

  // Generate filename
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  const cleanBaseName = baseName.replace(/[\s_]+comprz/i, '');
  const finalFileName = `${cleanBaseName}-comprz.pdf`;

  if (onProgress) onProgress(100, 'Kompresi PDF berhasil!');

  return {
    blob: resultBlob,
    fileName: finalFileName,
    mimeType: 'application/pdf',
    originalSize: file.size,
    compressedSize: resultBlob.size,
    numPages,
    savedBytes: Math.max(0, file.size - resultBlob.size),
    savedPercent: Math.max(0, ((file.size - resultBlob.size) / file.size) * 100),
    previewUrl: URL.createObjectURL(resultBlob)
  };
}
