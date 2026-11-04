# Grakoms · Panduan developer

Paket ini berisi aplikasi perbandingan monumen ITS yang dapat dijalankan dan diedit. Halaman memakai JavaScript ES modules dan WebGL 2 langsung: tidak ada engine 3D, proses build, atau dependensi npm untuk menjalankan aplikasi.

## Menjalankan di Windows

1. Ekstrak ZIP, lalu buka PowerShell atau Command Prompt di folder `Grakoms` (folder yang berisi `index.html`).
2. Jalankan server lokal:

   ```powershell
   py -m http.server 8000
   ```

   Jika perintah `py` tidak tersedia, coba `python -m http.server 8000`.
3. Buka `http://localhost:8000` di browser yang mendukung WebGL 2, seperti Chrome atau Edge. Hentikan server dengan `Ctrl+C`.

Jangan membuka `index.html` dengan klik dua kali (`file://`). Browser perlu HTTP untuk memuat ES modules, tekstur, foto, dan video lokal.

## Kontrol aplikasi

- Pilih **Front**, **Three-quarter**, **Profile**, atau **Rear** untuk mengganti sudut kamera dan foto pembanding.
- Pilih foto detail, foto tanaman, atau video dari menu pada panel kanan.
- Klik **Walk scene** atau kanvas untuk mengunci pointer: `W/A/S/D` bergerak, mouse mengubah arah pandang, `Shift` berlari, `Ctrl` jongkok, `Space` melompat, dan `Esc` melepas pointer.
- Tombol panah atau tombol arah di bawah kanvas mengubah arah angin. **Pause** menjeda animasi tanaman.

## Peta kode dan titik edit

- `src/config.js`: ukuran dan posisi relatif, preset kamera, kamera/gerak, material, cahaya, plaza, konteks, tanaman, dan angin.
- `src/scene.js`: susunan hierarki node monumen, plaza, tanaman, dan lingkungan.
- `src/geometry.js`: pembuat geometri yang dapat dipakai ulang. `src/yellow-petal-contours.js` menyimpan kontur kelopak emblem.
- `src/collision.js`: permukaan pijak, batas area, dan tabrakan.
- `src/renderer.js` dan `src/shaders.js`: pipeline WebGL 2, pemuatan tekstur, GLSL, dan pencahayaan.
- `src/camera.js`, `src/input.js`, `src/look-input.js`, `src/hud.js`, `src/wind.js`: kamera, kontrol, filter gerak mouse, HUD, dan angin.
- `styles.css` dan `index.html`: tata letak serta UI pembanding.
- `assets/reference/`: foto/video lokal yang ditampilkan pada panel kanan dan dipakai sebagai acuan.
- `assets/textures/`: peta material lokal termasuk tekstur foto pada plakat. Pertahankan nama/path aset yang dirujuk `src/config.js` dan `src/app.js`.

Geometri memakai satuan relatif; foto tidak menyediakan skala fisik atau kalibrasi kamera. Cocokkan perubahan dengan preset front, profile, dan rear.

## Opsional: membuat ulang tekstur dan cek perubahan

Aplikasi tidak memerlukan Python, Node, atau instalasi paket untuk dijalankan. Untuk membuat ulang tujuh peta permukaan, gunakan Python 3 dengan NumPy dan Pillow:

```powershell
py -m pip install -r requirements-textures.txt
py scripts/generate_textures.py
```

Cek geometri dan kontrol tersedia sebagai skrip Node tanpa paket tambahan. Dengan Node.js terpasang, jalankan misalnya `npm run check:layout`, `npm run check:physics`, `npm run check:landing`, atau `npm run check:look`. Perintah ini opsional dan terpisah dari server web.
