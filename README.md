# SiKaret — Sistem Pembukuan Deposit & Timbangan Pengepul Karet

Sistem pencatatan digital berbasis web untuk tata kelola modal panjar (deposit), penimbangan bertahap getah karet, dan rekapitulasi saldo berjalan mitra pengepul di sentra perkebunan karet rakyat (Sumatera Selatan: Talang Ubi, Prabumulih, Muara Enim, Gelumbang).

---

## 1. Latar Belakang & Alur Bisnis

Dalam ekosistem perdagangan karet rakyat di Indonesia, lumbung/toke karet menjalin kemitraan dengan para **pengepul** (*middlemen*) yang mengumpulkan getah karet (lum/slab) langsung dari para petani di kebun.

Alur operasional perdagangan karet memiliki karakteristik unik:

1. **Penyaluran Modal Panjar (Deposit)**: Pihak pengelola menyalurkan uang muka kerja (*panjar modal jalan*) kepada pengepul agar pengepul memiliki likuiditas tunai untuk membeli karet dari petani.
2. **Penimbangan Bertahap per Angkatan**: Saat getah karet diantar ke gudang timbang, penimbangan dilakukan berulang kali per angkatan timbang duduk atau gantung (karena kapasitas timbangan terbatas) dengan satuan ukur lokal **Kuintal (Kw)**.
3. **Konversi Tonase & Valuasi**: Total berat dari seluruh angkatan dijumlahkan, dikonversi ke satuan **Ton**, dan dikalikan dengan harga per ton (dihitung dari harga dasar per kg).
4. **Pemotongan Otomatis Saldo Deposit**: Nilai pembelian langsung memotong sisa saldo deposit pengepul yang bersangkutan.
5. **Status Saldo Defisit (Bon / Kurang Bayar)**: Jika volume getah yang disetor bernilai lebih besar daripada sisa deposit pengepul, saldo menjadi **minus**, yang berarti pengepul memiliki hak tagih tambahan atau utang setoran (bon berjalan).

**SiKaret** dirancang untuk mendigitalkan seluruh rantai pencatatan ini secara presisi, akuntabel, dan siap cetak formal tanpa kerumitan administrasi manual.

---

## 2. Fitur-Fitur Utama

### A. Ringkasan Pembukuan (Ledger Overview)
- **Ringkasan Kas & Tonase Terpadu**: Menampilkan total deposit yang telah disalurkan, total nilai getah yang terserap, sisa saldo deposit aktif, dan akumulasi tonase bersih.
- **Peringatan Saldo Kritis Real-Time**: Deteksi otomatis pengepul dengan saldo menipis (di bawah ambang batas) atau berstatus defisit (minus).
- **5 Transaksi Pembelian Terbaru**: Pantauan cepat setoran karet mutakhir langsung di halaman muka.

### B. Manajemen Induk Mitra Pengepul
- Registrasi pengepul baru (Nama lengkap & daerah asal operasional).
- Daftar induk pengepul dengan pemantauan saldo deposit berjalan dan akumulasi tonase getah yang pernah disetor.
- Pembaruan (*edit*) data pengepul dan proteksi penghapusan (tidak dapat dihapus jika masih memiliki riwayat transaksi aktif).

### C. Buku Kas Mutasi Deposit
- Pencatatan penyaluran modal awal maupun penambahan modal jalan (*top-up*).
- Riwayat kronologis transaksi deposit dilengkapi keterangan dan catatan operasional.
- Fitur koreksi (*edit*) dan pembatalan (*reversal*) mutasi kas dengan penyesuaian saldo otomatis.

### D. Kalkulator Timbangan Bertahap & Pembelian
- **Input Angkatan Bertahap Dinamis**: Tambah/kurang baris angkatan timbang sesuai jumlah timbangan fisik di gudang.
- **Kalkulasi Otomatis Seketika**: Menghitung total kuintal, konversi ke tonase (1 Ton = 10 Kw), dan konversi harga beli dari Rp/Kg ke Rp/Ton.
- **Simulasi Pemotongan Saldo (*Live Preview*)**: Menampilkan posisi saldo pengepul sebelum transaksi, nilai transaksi, dan proyeksi sisa saldo (aman, menipis, atau defisit/kurang bayar) sebelum transaksi disimpan.
- **Rasio Likuiditas Pengepul**: Visualisasi status sisa deposit terhadap modal yang pernah diberikan.

### E. Rekapitulasi Saldo & Kredit
- Tabel rekapitulasi terintegrasi: Total Deposit, Akumulasi Tonase (Kw & Ton), Total Nilai Transaksi, dan Sisa Saldo Akhir.
- Indikator status kredit lugas: **Aman**, **Menipis**, dan **Kurang Bayar**.
- Filter pencarian cepat berdasarkan nama pengepul dan daerah.

### F. Buku Arsip Riwayat & Filter Multi-Parameter
- Log lengkap setiap transaksi pembelian beserta rincian angkatan timbang (`8.50 + 9.20 + 7.80 Kw`).
- Filter pencarian multi-kriteria: Nama Pengepul, Daerah Asal, Tanggal Awal, dan Tanggal Akhir.
- Ringkasan statistik otomatis untuk data yang tersaring (jumlah transaksi, total berat, dan total nilai rupiah).

### G. Modul Cetak Formal & Ekspor PDF
- Layout khusus cetak A4 yang rapi dan profesional via dialog peramban (`Ctrl + P` / `window.print()`).
- Tiga mode cetak:
  1. Cetak Riwayat Pembelian sesuai filter yang aktif.
  2. Cetak Seluruh Arsip Transaksi.
  3. Cetak Rekapitulasi Saldo & Tonase seluruh pengepul.
- CSS `@media print` otomatis menyembunyikan navigasi, tombol, dan formulir input, menghasilkan lembar laporan bersih untuk tanda terima fisik atau arsip PDF.

### H. Analisis Grafik & Tren Bulanan
- Didukung oleh **Chart.js** dengan palet warna natural:
  - Grafik distribusi tonase per pengepul (Ton).
  - Grafik status sisa deposit per pengepul (membedakan status aman, menipis, dan minus).
  - Grafik garis tren serapan getah karet bulanan (Kuintal).

---

## 3. Logika Matematis & Standar Konversi

Aplikasi menerapkan standar konversi perdagangan komoditas perkebunan:

### 1. Satuan Berat & Tonase
$$1\text{ Ton} = 10\text{ Kuintal} = 1.000\text{ Kilogram}$$

$$\text{Total Kuintal} = \sum_{i=1}^{n} \text{Berat Angkatan}_i\text{ (Kw)}$$

$$\text{Total Tonase (Ton)} = \frac{\text{Total Kuintal}}{10}$$

### 2. Konversi Harga & Total Nilai Pembelian
$$\text{Harga per Ton} = \text{Harga per Kg} \times 1.000$$

$$\text{Total Nilai Transaksi (Rp)} = \text{Total Tonase (Ton)} \times \text{Harga per Ton}$$

*(Contoh: Berat 37.6 Kw = 3.76 Ton. Harga Rp 1.000/Kg = Rp 1.000.000/Ton. Total = 3.76 × 1.000.000 = Rp 3.760.000)*

### 3. Pemotongan Saldo & Status Defisit
$$\text{Sisa Deposit Baru} = \text{Sisa Deposit Lama} - \text{Total Nilai Transaksi}$$

- **Sisa Deposit > Rp 5.000.000**: Status **Aman**.
- **Rp 0 $\le$ Sisa Deposit $\le$ Rp 5.000.000**: Status **Menipis**.
- **Sisa Deposit < Rp 0**: Status **Kurang Bayar (Defisit/Minus)** — dicatat sebagai utang setoran (bon pengepul).

### 4. Integritas Reversal Saldo
Setiap pengeditan atau penghapusan transaksi menerapkan mekanisme *reversal* akuntansi:
- **Hapus Pembelian**: Nilai transaksi dikembalikan ke sisa deposit pengepul, akumulasi tonase dan total nilai transaksi dikurangi.
- **Hapus Deposit**: Nilai deposit dikurangkan kembali dari total deposit dan sisa deposit pengepul.

---

## 4. Filosofi Desain (Anti-AI Slop Manifesto)

Antarmuka **SiKaret** dirancang dengan prinsip **Physical Ledger Aesthetic** (estetika buku timbangan dan kas fisik gudang), menolak pola desain generik (*AI slop*):

| Unsur Desain | Pendekatan SiKaret (Authentic Ledger) | Pola AI Slop yang Dihindari |
| :--- | :--- | :--- |
| **Ikonografi & Emotikon** | Murni tipografi semantik dan fungsional. Bebas emoji. | Taburan emoji di setiap tombol, judul, dan kartu (📊, 💰, 🌿, ⚖️). |
| **Palet Warna** | Palet bertema material getah karet: *Natural Rubber Forest* (`#1b4332`), kanvas batu/parchment (`#f4f3ef`), dan tinta karbon (`#18181b`). | Gradien neon ungu-biru, hijau emerald menyala, atau tema template bawaan. |
| **Pemisahan Bidang** | Menggunakan perbedaan kontras tone permukaan (`#ffffff` di atas `#f4f3ef` dan panel `#edebe4`). | Garis tepi rambut tipis (*hairline glow*) dan panel buram (*glassmorphism*). |
| **Elevasi & Bayangan** | Permukaan datar (*flat surfaces*) tanpa bayangan statis. | Efek mengambang berlebih (*drop shadow* melayang, *hover transform* mengapung). |
| **Komponen Status** | Tag berbobot tegas dengan sudut sedikit membulat (*flat rectangular tag*). | *Pill badge* bulat kapsul 9999px dengan garis bersinar. |
| **Tipografi** | Angka tabular (*tabular numbers*), hierarki jelas, perataan kiri standar, judul maksimal dua baris. | Huruf kapital mikro dengan spasi renggang berlebihan (*letter-spacing 0.05em*). |

---

## 5. Arsitektur Teknis

- **Struktur**: Single Page Application (SPA) berbasis Vanilla HTML5, CSS3, dan JavaScript (ES6+).
- **Tanpa Framework Berat**: Berjalan langsung di peramban tanpa membutuhkan Node.js, Webpack, Vite, atau Tailwind compiler runtime.
- **Penyimpanan Data (Persistence)**:
  - Menggunakan **Web Storage API (`localStorage`)** agar data tersimpan aman di komputer pengguna.
  - Saat pertama kali dibuka tanpa data lokal, sistem memuat dataset inisial dari `data.json`.
- **Pustaka Eksternal**:
  - `Chart.js 4.4.x` (via CDN) untuk perenderan visualisasi grafik.
  - `Google Fonts (Inter)` untuk tipografi.

---

## 6. Struktur Direktori

```text
Project Karet/
├── data.json     # Data awal (pengepul, transaksi deposit, dan pembelian)
├── index.html    # Struktur semantik aplikasi & antarmuka workstation
├── script.js     # Logika kalkulasi timbangan, CRUD, mutasi saldo, & chart
├── style.css     # Sistem desain bespoke anti-AI slop (token, layout, print)
└── README.md     # Dokumentasi teknis & operasional aplikasi
```

---

## 7. Panduan Menjalankan Aplikasi

### Cara 1: Buka Langsung di Peramban
Cukup klik ganda berkas `index.html` pada peramban modern (Chrome, Edge, Firefox, Safari).

### Cara 2: Menjalankan Server Lokal (Disarankan)
Untuk memastikan berkas `data.json` dapat dimuat tanpa batasan keamanan lokal peramban (*CORS*):

**Menggunakan Python:**
```bash
# Jalankan di dalam direktori proyek
python -m http.server 8085
```
Buka peramban di: `http://localhost:8085`

**Menggunakan VS Code:**
Pasang ekstensi *Live Server*, klik kanan pada `index.html`, dan pilih *Open with Live Server*.

---

## 8. Panduan Operasional Pengguna

1. **Memulai Sesi Baru**:
   - Masuk ke tab **Daftar Pengepul** untuk memastikan mitra telah terdaftar.
   - Masuk ke tab **Buku Deposit** untuk mencatat modal panjar yang diberikan kepada pengepul.
2. **Mencatat Hasil Timbangan Karet**:
   - Buka tab **Catat Timbangan**.
   - Pilih tanggal dan nama mitra pengepul.
   - Masukkan harga beli getah dalam satuan Rp/Kg.
   - Masukkan angka timbangan per angkatan dalam satuan Kuintal (gunakan tombol *+ Tambah Angkatan* jika ada banyak keranjang/timbangan).
   - Periksa ringkasan estimasi dan status sisa deposit pada panel pratinjau.
   - Klik **Simpan Transaksi Pembelian**.
3. **Mencetak Laporan**:
   - Buka tab **Riwayat Transaksi** atau **Rekapitulasi Saldo**.
   - Gunakan filter pencarian bila hanya ingin mencetak transaksi tertentu.
   - Klik tombol **Cetak Laporan (Filter)** atau **Cetak Rekap Pengepul**.
   - Dialog cetak peramban akan terbuka otomatis; pilih *Save as PDF* atau kirim langsung ke printer fisik.

---

## 9. Lisensi & Hak Cipta

Proyek ini dikembangkan untuk kebutuhan operasional pencatatan timbangan dan pembukuan pengepul karet. Seluruh hak cipta dilindungi.
