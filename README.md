# Comprz — Modern All-in-One File Compressor & Resizer

Aplikasi kompresi dan pengoptimalan berkas berbasis web yang **100% Client-Side** (berjalan sepenuhnya di browser Anda). Cepat, tanpa batas ukuran upload, dan menjamin privasi total karena tidak ada file yang dikirim ke server.

---

## 🚀 Fitur Utama

1. **Kompres PDF**:
   - Multi-halaman rendering dengan 3 preset cerdas:
     - **Kompresi Ekstrem**: Cocok untuk batas upload instansi/CPNS, email (< 500KB - 1MB).
     - **Rekomendasi (Seimbang)**: Pilihan terbaik untuk dokumen harian, hemat 60-80% ukuran dengan teks & grafik tetap tajam terbaca.
     - **Kompresi Ringan**: Resolusi tinggi untuk detail grafis dan bagan.
   - Indikator progres per-halaman secara *real-time*.

2. **Kompres JPG / JPEG**:
   - Pengaturan kualitas geser (10% - 95%).
   - Resampling bicubic resolusi tinggi dengan perbandingan ukuran sebelum & sesudah.

3. **Kompres PNG**:
   - Pertahankan transparansi (alpha channel) atau konversi ke WebP untuk penghematan ekstra hingga 85-90%.
   - Latar belakang putih otomatis jika dikonversi ke JPEG.

4. **Kompres WEBP**:
   - Dukungan format modern generasi terbaru untuk web super cepat.

5. **Kompres HEIC (Apple / iPhone)**:
   - Langsung drag & drop foto `.heic` atau `.heif` dari kamera iPhone.
   - Dikonversi otomatis menjadi JPG/WEBP ringan menggunakan WebAssembly (`heic2any`).

6. **Kompres Foto + Resize Dimensi**:
   - Skala persentase (100%, 75%, 50%, 25%).
   - Dimensi piksel kustom (Width x Height) dengan fitur **Kunci Rasio Aspek (Aspect Ratio Lock)**.
   - Preset populer 1-klik:
     - 📸 Instagram Post (1080 × 1080)
     - 📱 Instagram Story / TikTok (1080 × 1920)
     - 🖥️ Full HD (1920 × 1080)
     - 🌐 HD Web (1280 × 720)
     - 👤 Pas Foto 3×4 (354 × 472 px)
     - 👤 Pas Foto 4×6 (472 × 708 px)
     - 🖼️ Avatar / Profil (500 × 500 px)

7. **Batch Kompres Gambar**:
   - Unggah puluhan file sekaligus dengan sekali drag & drop atau paste (`Ctrl + V`).
   - Tabel antrean lengkap dengan thumbnail, ukuran awal, ukuran akhir, persentase hemat, dan status.
   - Tombol **"Unduh Semua (.ZIP)"** untuk mengunduh seluruh hasil kompresi dalam satu arsip ZIP praktis.

8. **Hapus EXIF Otomatis (Privacy First)**:
   - Secara otomatis menghapus seluruh metadata sensitif seperti titik koordinat lokasi GPS, seri kamera ponsel, dan tanggal/waktu pengambilan foto.
   - Dilengkapi lencana verifikasi privasi pada setiap berkas.

9. **Perbandingan Visual (Before / After Split Slider)**:
   - Modal interaktif dengan pemisah yang dapat digeser untuk mengecek ketajaman foto asli vs hasil kompresi secara langsung.

---

## 🛠️ Menjalankan di Lokal

1. Buka terminal di folder project:
   ```bash
   cd "C:\Users\ERVINPW\.gemini\antigravity-ide\scratch\comprz"
   ```

2. Jalankan development server:
   ```bash
   npm run dev
   ```
   Akses di browser: `http://localhost:5173/`

3. Uji build produksi:
   ```bash
   npm run build
   ```

---

## 🌐 Cara Deploy ke Vercel

### Cara 1: Menggunakan Vercel CLI (Paling Cepat)
1. Buka PowerShell di folder project:
   ```powershell
   cd "C:\Users\ERVINPW\.gemini\antigravity-ide\scratch\comprz"
   ```
2. Jalankan perintah:
   ```powershell
   npx vercel
   ```
3. Ikuti petunjuk di terminal (pilih `Y`, framework akan otomatis terdeteksi sebagai `Vite`).
4. Untuk deploy ke production domain:
   ```powershell
   npx vercel --prod
   ```

### Cara 2: Melalui GitHub & Dashboard Vercel
1. Buat repository baru di [GitHub](https://github.com/new) bernama `comprz`.
2. Push repository lokal:
   ```bash
   git remote add origin https://github.com/USERNAME/comprz.git
   git branch -M main
   git push -u origin main
   ```
3. Buka dashboard [Vercel](https://vercel.com), klik **"Add New Project"**, pilih repository `comprz`, dan klik **Deploy**.
4. Website langsung aktif dengan SSL gratis!
