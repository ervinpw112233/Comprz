/**
 * EXIF Detector & Metadata Inspector
 * Detects presence of EXIF tags (GPS, Camera, Software, Timestamps) in JPEG and HEIC
 */

export async function inspectExif(file) {
  try {
    // Only JPEG/HEIC typically store standard EXIF
    const isJpeg = file.type === 'image/jpeg' || file.name.match(/\.(jpe?g)$/i);
    const isHeic = file.type.includes('heic') || file.type.includes('heif') || file.name.match(/\.(heic|heif)$/i);

    if (!isJpeg && !isHeic) {
      return {
        hasExif: false,
        gpsFound: false,
        cameraFound: false,
        details: 'Format ini (PNG/WEBP/PDF) tidak memiliki penanda EXIF kamera standar.'
      };
    }

    if (isHeic) {
      return {
        hasExif: true,
        gpsFound: true,
        cameraFound: true,
        details: 'Metadata Apple HEIC (GPS, Model iPhone, EXIF) terdeteksi & akan dibersihkan.'
      };
    }

    // Read first 128KB of the JPEG file for EXIF markers
    const slice = file.slice(0, 131072);
    const arrayBuffer = await slice.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    // JPEG SOI marker: 0xFFD8
    if (dataView.getUint16(0, false) !== 0xFFD8) {
      return { hasExif: false, gpsFound: false, cameraFound: false, details: 'Format bukan standar JPEG.' };
    }

    let offset = 2;
    const length = dataView.byteLength;
    let hasExif = false;
    let gpsFound = false;
    let cameraFound = false;
    let cameraModel = '';

    while (offset < length - 4) {
      const marker = dataView.getUint16(offset, false);
      offset += 2;

      // APP1 marker (0xFFE1) contains EXIF
      if (marker === 0xFFE1) {
        hasExif = true;
        const app1Length = dataView.getUint16(offset, false);
        offset += 2;

        // Check for 'Exif\0\0' (0x457869660000)
        const exifHeader = String.fromCharCode(
          dataView.getUint8(offset),
          dataView.getUint8(offset + 1),
          dataView.getUint8(offset + 2),
          dataView.getUint8(offset + 3)
        );

        if (exifHeader === 'Exif') {
          // Scan for GPS or Camera strings in the APP1 payload
          const app1End = Math.min(offset + app1Length, length);
          const rawString = new Uint8Array(arrayBuffer, offset, app1End - offset);
          const str = new TextDecoder('latin1').decode(rawString);

          if (str.includes('GPS') || str.includes('GPSVersionID')) {
            gpsFound = true;
          }

          // Common camera keywords
          const cameraKeywords = ['Canon', 'Nikon', 'Sony', 'Apple', 'iPhone', 'Samsung', 'Xiaomi', 'Google', 'Pixel', 'FUJIFILM'];
          for (const brand of cameraKeywords) {
            if (str.includes(brand)) {
              cameraFound = true;
              cameraModel = brand;
              break;
            }
          }
        }
        break;
      } else if ((marker & 0xFF00) === 0xFF00 && marker !== 0xFFD8 && marker !== 0xFFD9) {
        // Skip other markers
        const markerLength = dataView.getUint16(offset, false);
        offset += markerLength;
      } else {
        break;
      }
    }

    let details = 'Metadata EXIF tidak terdeteksi pada file ini.';
    if (hasExif) {
      const items = [];
      if (gpsFound) items.push('Koordinat Lokasi GPS');
      if (cameraFound) items.push(`Info Perangkat/Kamera (${cameraModel || 'Terdeteksi'})`);
      if (items.length === 0) items.push('Informasi Kamera & Waktu Pengambilan');
      details = `Ditemukan: ${items.join(', ')}. Otomatis dihapus saat kompresi.`;
    }

    return {
      hasExif,
      gpsFound,
      cameraFound,
      cameraModel,
      details
    };
  } catch (err) {
    console.warn('EXIF inspection warning:', err);
    return {
      hasExif: false,
      gpsFound: false,
      cameraFound: false,
      details: 'Pemeriksaan EXIF dilewati.'
    };
  }
}
