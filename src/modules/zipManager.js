/**
 * Batch ZIP Downloader using JSZip
 */

import JSZip from 'jszip';

export async function downloadAsZip(files, zipFileName = 'comprz-batch-hasil.zip', onProgress = null) {
  if (!files || files.length === 0) {
    throw new Error('Tidak ada file untuk diunduh.');
  }

  const zip = new JSZip();

  // Add each file to ZIP, ensuring unique filenames
  const usedNames = new Set();
  files.forEach((file) => {
    let name = file.fileName;
    if (usedNames.has(name)) {
      const ext = name.split('.').pop();
      const base = name.substring(0, name.lastIndexOf('.'));
      let counter = 1;
      while (usedNames.has(`${base}_${counter}.${ext}`)) {
        counter++;
      }
      name = `${base}_${counter}.${ext}`;
    }
    usedNames.add(name);
    zip.file(name, file.blob);
  });

  if (onProgress) onProgress(10, 'Menyiapkan berkas ZIP...');

  const content = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    },
    (metadata) => {
      if (onProgress) {
        onProgress(Math.round(metadata.percent), `Mengompresi ZIP: ${Math.round(metadata.percent)}%`);
      }
    }
  );

  // Trigger download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(content);
  link.download = zipFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  return content;
}

export function downloadSingleFile(blob, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
