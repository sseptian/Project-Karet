/* =====================================================
   SiKaret – script.js
   Sistem Pencatatan Deposit & Pembelian Karet Pengepul
   Vanilla JavaScript · LocalStorage · Chart.js
   ===================================================== */

'use strict';

// ============================================================
//  KONSTANTA & KONFIGURASI
// ============================================================
const LS_KEY_PENGEPUL   = 'sikaret_pengepul';
const LS_KEY_DEPOSIT    = 'sikaret_deposit';
const LS_KEY_PEMBELIAN  = 'sikaret_pembelian';

// 1 Ton = 10 Kuintal (konversi resmi)
const KW_PER_TON = 10;

// Ambang batas sisa deposit untuk peringatan (dalam Rupiah)
const WARN_THRESHOLD  = 5_000_000;   // kuning: sisa < 5 jt
const DANGER_THRESHOLD = 0;          // merah : sisa <= 0 (minus/lunas-lebih)

// ============================================================
//  STATE APLIKASI
// ============================================================
let appData = {
  pengepul: [],
  depositTransactions: [],
  pembelianTransactions: [],
};

// Referensi chart (agar bisa di-destroy sebelum re-render)
let charts = {};

// ============================================================
//  INISIALISASI APLIKASI
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();           // Muat dari LocalStorage atau JSON awal
  initTabs();                 // Setup navigasi tab
  setHeaderDate();            // Tampilkan tanggal hari ini
  setDefaultDates();          // Isi default nilai tanggal
  populateSelects();          // Isi dropdown pengepul
  initTimbanganRow();         // Tambah 1 baris timbangan awal
  bindFormEvents();           // Pasang event listener form
  bindFilterEvents();         // Pasang event listener filter
  bindDownloadEvents();       // Pasang event listener tombol download
  renderAll();                // Render semua tampilan
});

// ============================================================
//  1. LOAD DATA
// ============================================================

/**
 * Memuat data dari LocalStorage.
 * Jika LocalStorage kosong, fallback ke data.json bawaan.
 */
async function loadData() {
  const storedPengepul  = localStorage.getItem(LS_KEY_PENGEPUL);
  const storedDeposit   = localStorage.getItem(LS_KEY_DEPOSIT);
  const storedPembelian = localStorage.getItem(LS_KEY_PEMBELIAN);

  if (storedPengepul && storedDeposit && storedPembelian) {
    // Data sudah ada di LocalStorage
    appData.pengepul              = JSON.parse(storedPengepul);
    appData.depositTransactions   = JSON.parse(storedDeposit);
    appData.pembelianTransactions = JSON.parse(storedPembelian);
  } else {
    // Pertama kali: muat dari data.json
    try {
      const res  = await fetch('data.json');
      const json = await res.json();
      appData.pengepul              = json.pengepul;
      appData.depositTransactions   = json.depositTransactions;
      appData.pembelianTransactions = json.pembelianTransactions;
      saveData(); // Simpan ke LocalStorage
    } catch (e) {
      console.warn('data.json tidak ditemukan, mulai dengan data kosong.', e);
      appData = { pengepul: [], depositTransactions: [], pembelianTransactions: [] };
    }
  }
}

/** Simpan seluruh state ke LocalStorage */
function saveData() {
  localStorage.setItem(LS_KEY_PENGEPUL,   JSON.stringify(appData.pengepul));
  localStorage.setItem(LS_KEY_DEPOSIT,    JSON.stringify(appData.depositTransactions));
  localStorage.setItem(LS_KEY_PEMBELIAN,  JSON.stringify(appData.pembelianTransactions));
}

// ============================================================
//  2. UTILITAS FORMAT
// ============================================================

/** Format angka ke Rupiah: Rp 1.234.567 */
function formatRupiah(angka) {
  const abs = Math.abs(angka);
  const formatted = abs.toLocaleString('id-ID');
  return (angka < 0 ? '-Rp ' : 'Rp ') + formatted;
}

/** Format angka desimal dengan presisi tertentu */
function formatDecimal(n, digits = 3) {
  return parseFloat(n).toFixed(digits);
}

/** Format tanggal ISO ke lokal Indonesia: 25 Sep 2024 */
function formatTanggal(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/** Ambil bulan-tahun dari ISO: "Sep 2024" */
function getBulanTahun(iso) {
  const [y, m] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

/** Buat ID unik sederhana */
function generateId(prefix) {
  return prefix + Date.now().toString(36).toUpperCase();
}

// ============================================================
//  3. TANGGAL & HEADER
// ============================================================
function setHeaderDate() {
  const el = document.getElementById('headerDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function setDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  ['depositTanggal', 'beliTanggal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
}

// ============================================================
//  4. NAVIGASI TAB
// ============================================================
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      // Aktifkan button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Tampilkan section
      document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
      document.getElementById('tab-' + target).classList.remove('hidden');
      // Render chart saat tab grafik dibuka
      if (target === 'grafik') renderGrafik();
    });
  });
}

// ============================================================
//  5. POPULATE DROPDOWN
// ============================================================
function populateSelects() {
  const selects = ['depositPengepul', 'beliPengepul'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    const prev = el.value;
    el.innerHTML = '<option value="">-- Pilih Pengepul --</option>';
    appData.pengepul
      .sort((a, b) => a.nama.localeCompare(b.nama))
      .forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.nama} (${p.daerah})`;
        el.appendChild(opt);
      });
    if (prev) el.value = prev;
  });
}

// ============================================================
//  6. TIMBANGAN BERTAHAP
// ============================================================
let timbanganCount = 0;

function initTimbanganRow() {
  timbanganCount = 0;
  document.getElementById('timbanganContainer').innerHTML = '';
  addTimbanganRow(); // Tambah baris pertama otomatis
}

function addTimbanganRow() {
  timbanganCount++;
  const container = document.getElementById('timbanganContainer');
  const div = document.createElement('div');
  div.className = 'timbangan-row';
  div.dataset.index = timbanganCount;
  div.innerHTML = `
    <span class="row-label">Angkatan ${timbanganCount}:</span>
    <input
      type="number"
      class="timbangan-input form-input"
      placeholder="0.00"
      min="0" step="0.01"
      oninput="hitungTimbangan()"
    />
    <span class="timbangan-unit">Kw</span>
    ${timbanganCount > 1
      ? `<button type="button" class="btn-danger" onclick="hapusTimbangan(this)">Hapus</button>`
      : `<span style="width: 48px;"></span>`
    }
  `;
  container.appendChild(div);
}

function hapusTimbangan(btn) {
  btn.closest('.timbangan-row').remove();
  // Re-label semua baris yang tersisa
  document.querySelectorAll('.timbangan-row').forEach((row, i) => {
    row.querySelector('.row-label').textContent = `Angkatan ${i + 1}:`;
  });
  hitungTimbangan();
}

/**
 * PERHITUNGAN TIMBANGAN BERTAHAP
 * --------------------------------
 * Menjumlahkan semua nilai kuintal dari setiap baris angkatan,
 * lalu mengonversi total kuintal ke tonase:
 *   tonase = totalKuintal / KW_PER_TON  (KW_PER_TON = 10)
 * Estimasi harga = tonase × harga per ton
 */
function hitungTimbangan() {
  const inputs = document.querySelectorAll('.timbangan-input');
  let totalKuintal = 0;

  inputs.forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val > 0) totalKuintal += val;
  });

  // Konversi Kuintal → Ton (1 Ton = 10 Kuintal)
  const tonase = totalKuintal / KW_PER_TON;

  // Input harga dalam Rp/Kg → konversi ke Rp/Ton untuk kalkulasi
  // Rumus: hargaPerTon = hargaPerKg × 1000 (karena 1 Ton = 1000 Kg)
  const hargaPerKg  = parseFloat(document.getElementById('beliHarga').value) || 0;
  const hargaPerTon = hargaPerKg * 1000;

  // Estimasi total harga = tonase × harga per ton
  const estimasiHarga = tonase * hargaPerTon;

  // Update preview
  document.getElementById('previewKuintal').textContent = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('previewTonase').textContent  = formatDecimal(tonase, 3) + ' Ton';
  document.getElementById('previewHargaKonversi').textContent =
    `${formatRupiah(hargaPerKg)}/Kg → ${formatRupiah(hargaPerTon)}/Ton`;
  document.getElementById('previewHarga').textContent   = formatRupiah(estimasiHarga);

  // Update deposit preview (sisa deposit pengepul terpilih setelah dikurangi estimasi)
  updateDepositPreview(estimasiHarga);
}

/** Tampilkan sisa deposit setelah dikurangi estimasi harga pembelian */
function updateDepositPreview(estimasiHarga) {
  const pengepulId = document.getElementById('beliPengepul').value;
  const previewEl  = document.getElementById('depositPreview');
  if (!pengepulId) { previewEl.classList.add('hidden'); return; }

  const p = appData.pengepul.find(x => x.id === pengepulId);
  if (!p) { previewEl.classList.add('hidden'); return; }

  const sisaSetelah = p.sisaDeposit - estimasiHarga;
  previewEl.classList.remove('hidden');

  if (sisaSetelah < 0) {
    previewEl.className = 'calc-preview-box calc-preview-danger';
    previewEl.innerHTML = `
      <strong>Status Defisit / Kurang Bayar</strong> &mdash; Saldo deposit saat ini:
      <strong>${formatRupiah(p.sisaDeposit)}</strong>. Setelah transaksi dipotong, sisa saldo menjadi
      <strong>${formatRupiah(sisaSetelah)}</strong> (posisi saldo negatif / bon pengepul).
    `;
  } else if (sisaSetelah < WARN_THRESHOLD) {
    previewEl.className = 'calc-preview-box calc-preview-warning';
    previewEl.innerHTML = `
      <strong>Peringatan Saldo Menipis</strong> &mdash; Saldo deposit saat ini:
      <strong>${formatRupiah(p.sisaDeposit)}</strong>. Setelah transaksi dipotong, sisa saldo menjadi
      <strong>${formatRupiah(sisaSetelah)}</strong> (mendekati batas minimum).
    `;
  } else {
    previewEl.className = 'calc-preview-box calc-preview-ok';
    previewEl.innerHTML = `
      <strong>Saldo Mencukupi</strong> &mdash; Saldo deposit saat ini:
      <strong>${formatRupiah(p.sisaDeposit)}</strong>. Setelah transaksi dipotong, sisa saldo menjadi
      <strong>${formatRupiah(sisaSetelah)}</strong>.
    `;
  }
}

// ============================================================
//  7. BIND FORM EVENTS
// ============================================================
function bindFormEvents() {
  // Tombol tambah angkatan
  document.getElementById('btnAddTimbangan').addEventListener('click', addTimbanganRow);

  // Harga berubah → recalc
  document.getElementById('beliHarga').addEventListener('input', hitungTimbangan);

  // Pengepul berubah → update deposit preview
  document.getElementById('beliPengepul').addEventListener('change', () => {
    // Re-trigger full recalc when pengepul changes
    hitungTimbangan();
  });

  // FORM: Tambah Pengepul
  document.getElementById('formPengepul').addEventListener('submit', handleTambahPengepul);

  // FORM: Input Deposit
  document.getElementById('formDeposit').addEventListener('submit', handleInputDeposit);

  // FORM: Catat Pembelian
  document.getElementById('formPembelian').addEventListener('submit', handleCatatPembelian);
}

// ============================================================
//  8. HANDLER FORM
// ============================================================

/** Tambah pengepul baru */
function handleTambahPengepul(e) {
  e.preventDefault();
  const nama   = document.getElementById('inputNamaPengepul').value.trim();
  const daerah = document.getElementById('inputDaerah').value.trim();
  if (!nama || !daerah) return;

  const pengepulBaru = {
    id:                 generateId('P'),
    nama,
    daerah,
    totalDeposit:       0,
    sisaDeposit:        0,
    totalTonase:        0,
    totalNilaiTransaksi:0,
  };

  appData.pengepul.push(pengepulBaru);
  saveData();
  populateSelects();
  renderAll();
  e.target.reset();
  showToast(`Pengepul "${nama}" berhasil ditambahkan!`, 'success');
}

/** Input / Top-Up Deposit */
function handleInputDeposit(e) {
  e.preventDefault();
  const pengepulId = document.getElementById('depositPengepul').value;
  const tanggal    = document.getElementById('depositTanggal').value;
  const jumlah     = parseFloat(document.getElementById('depositJumlah').value);
  const catatan    = document.getElementById('depositCatatan').value.trim() || 'Top-up deposit';

  if (!pengepulId || !tanggal || isNaN(jumlah) || jumlah <= 0) {
    showToast('Harap lengkapi semua field deposit!', 'error');
    return;
  }

  // Tambah record transaksi deposit
  const newDeposit = {
    id: generateId('D'),
    pengepulId,
    tanggal,
    jumlah,
    catatan,
  };
  appData.depositTransactions.push(newDeposit);

  // Update saldo pengepul
  const p = appData.pengepul.find(x => x.id === pengepulId);
  if (p) {
    p.totalDeposit += jumlah;
    p.sisaDeposit  += jumlah;
  }

  saveData();
  populateSelects();
  renderAll();
  e.target.reset();
  setDefaultDates();
  showToast(`Deposit ${formatRupiah(jumlah)} berhasil ditambahkan!`, 'success');
}

/**
 * CATAT PEMBELIAN KARET
 * -------------------------
 * 1. Kumpulkan semua nilai timbangan (Kuintal)
 * 2. Hitung total kuintal & tonase
 * 3. Harga input dalam Rp/Kg → konversi ke Rp/Ton (×1000)
 * 4. Total harga = tonase × harga per ton
 * 5. Potong sisa deposit pengepul
 * 6. Tambah akumulasi tonase & nilai transaksi pengepul
 */
function handleCatatPembelian(e) {
  e.preventDefault();
  const tanggal    = document.getElementById('beliTanggal').value;
  const pengepulId = document.getElementById('beliPengepul').value;
  const hargaPerKg = parseFloat(document.getElementById('beliHarga').value);  // input dalam Rp/Kg
  const catatan    = document.getElementById('beliCatatan').value.trim() || '';

  if (!tanggal || !pengepulId || isNaN(hargaPerKg) || hargaPerKg <= 0) {
    showToast('Harap lengkapi Tanggal, Pengepul, dan Harga Beli!', 'error');
    return;
  }

  // Kumpulkan semua nilai timbangan
  const inputs = document.querySelectorAll('.timbangan-input');
  const timbanganValues = [];
  let totalKuintal = 0;

  inputs.forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val > 0) {
      timbanganValues.push(val);
      totalKuintal += val;
    }
  });

  if (timbanganValues.length === 0 || totalKuintal <= 0) {
    showToast('Masukkan minimal 1 angkatan timbangan yang valid!', 'error');
    return;
  }

  // Konversi kuintal → ton (1 Ton = 10 Kuintal)
  const totalTonase = totalKuintal / KW_PER_TON;

  // Konversi harga: Rp/Kg → Rp/Ton (1 Ton = 1000 Kg)
  const hargaPerTon = hargaPerKg * 1000;

  // Total harga = tonase × harga per ton
  const totalHarga = totalTonase * hargaPerTon;

  // Buat record transaksi pembelian
  // hargaBeli disimpan dalam Rp/Kg agar konsisten dengan input
  const newTx = {
    id: generateId('T'),
    pengepulId,
    tanggal,
    hargaBeli: hargaPerKg,          // simpan Rp/Kg
    hargaPerTon,                    // simpan juga Rp/Ton
    timbangan: timbanganValues,
    totalKuintal,
    totalTonase,
    totalHarga,
    catatan,
  };
  appData.pembelianTransactions.push(newTx);

  // Update data pengepul:
  // - Kurangi sisa deposit (bisa minus jika kurang bayar)
  // - Tambah akumulasi tonase & nilai transaksi
  const p = appData.pengepul.find(x => x.id === pengepulId);
  if (p) {
    p.sisaDeposit          -= totalHarga;   // pemotongan otomatis
    p.totalTonase          += totalKuintal; // dalam kuintal
    p.totalNilaiTransaksi  += totalHarga;
  }

  saveData();
  populateSelects();

  // Reset form timbangan
  initTimbanganRow();
  document.getElementById('previewKuintal').textContent = '0 Kw';
  document.getElementById('previewTonase').textContent  = '0.000 Ton';
  document.getElementById('previewHarga').textContent   = 'Rp 0';
  document.getElementById('depositPreview').classList.add('hidden');

  renderAll();
  e.target.reset();
  setDefaultDates();

  showToast(
    `Pembelian ${formatDecimal(totalKuintal, 2)} Kw (${formatDecimal(totalTonase, 3)} Ton) senilai ${formatRupiah(totalHarga)} berhasil dicatat!`,
    'success'
  );
}

// ============================================================
//  9. RENDER SEMUA BAGIAN
// ============================================================
function renderAll() {
  renderKPI();
  renderAlerts();
  renderRecentTransactions();
  renderPengepulList();
  renderDepositList();
  renderRekapTable();
  renderRiwayat();
  renderDepositStatusList();
  renderDashboardCharts();
}

// ============================================================
//  10. RENDER KPI
// ============================================================

/**
 * KPI:
 * - Total Deposit Disalurkan = jumlah semua totalDeposit pengepul
 * - Total Nilai Beli Karet   = jumlah semua totalNilaiTransaksi pengepul
 * - Total Sisa Deposit Aktif = jumlah semua sisaDeposit pengepul (bisa minus)
 * - Total Akumulasi Tonase   = jumlah semua totalTonase (kuintal), konversi ke ton
 */
function renderKPI() {
  let totalDeposit  = 0;
  let totalBeli     = 0;
  let sisaDeposit   = 0;
  let totalKuintal  = 0;

  appData.pengepul.forEach(p => {
    totalDeposit += p.totalDeposit;
    totalBeli    += p.totalNilaiTransaksi;
    sisaDeposit  += p.sisaDeposit;
    totalKuintal += p.totalTonase;  // totalTonase disimpan dalam Kuintal
  });

  const totalTon = totalKuintal / KW_PER_TON;

  document.getElementById('kpiTotalDeposit').textContent = formatRupiah(totalDeposit);
  document.getElementById('kpiTotalBeli').textContent    = formatRupiah(totalBeli);
  document.getElementById('kpiSisaDeposit').textContent  = formatRupiah(sisaDeposit);
  document.getElementById('kpiTotalTonase').textContent  = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('kpiTotalTon').textContent     = formatDecimal(totalTon, 3) + ' Ton';

  // Warna sisa deposit
  const sisaEl = document.getElementById('kpiSisaDeposit');
  sisaEl.className = 'ledger-value ' +
    (sisaDeposit < 0 ? 'text-danger' : sisaDeposit < WARN_THRESHOLD ? 'text-warning' : '');
}

// ============================================================
//  11. RENDER ALERTS (pengepul dengan sisa deposit rendah/minus)
// ============================================================
function renderAlerts() {
  const section = document.getElementById('alertSection');
  section.innerHTML = '';
  appData.pengepul
    .filter(p => p.sisaDeposit < WARN_THRESHOLD)
    .sort((a, b) => a.sisaDeposit - b.sisaDeposit)
    .forEach(p => {
      const div = document.createElement('div');
      const isMinus = p.sisaDeposit < 0;
      div.className = `alert-banner ${isMinus ? 'alert-danger' : 'alert-warning'}`;
      div.innerHTML = `
        <span class="alert-tag">${isMinus ? 'DEFISIT / MINUS' : 'SALDO MENIPIS'}</span>
        <span class="alert-text">
          <strong>${p.nama}</strong> (${p.daerah}) &mdash; Sisa deposit: <strong>${formatRupiah(p.sisaDeposit)}</strong>
          ${isMinus ? '&mdash; Nilai serapan getah melebihi deposit (tercatat bon/kurang bayar).' : '&mdash; Saldo berada di bawah batas minimum operasional.'}
        </span>
      `;
      section.appendChild(div);
    });
}

// ============================================================
//  12. RENDER TABEL TRANSAKSI TERBARU (5)
// ============================================================
function renderRecentTransactions() {
  const tbody = document.getElementById('tbodyRecentTx');
  const sorted = [...appData.pembelianTransactions]
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal))
    .slice(0, 5);

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-6">Belum ada transaksi</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return `
      <tr>
        <td>${formatTanggal(tx.tanggal)}</td>
        <td class="font-medium">${p ? p.nama : '—'}</td>
        <td>${p ? p.daerah : '—'}</td>
        <td class="text-right">${formatDecimal(tx.totalKuintal, 2)} Kw</td>
        <td class="text-right font-medium text-green-700">${formatDecimal(tx.totalTonase, 3)} Ton</td>
        <td class="text-right font-semibold">${formatRupiah(tx.totalHarga)}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================
//  13. RENDER TABEL PENGEPUL
// ============================================================
function renderPengepulList() {
  const tbody = document.getElementById('tbodyPengepulList');
  if (appData.pengepul.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-6">Belum ada pengepul</td></tr>';
    return;
  }
  tbody.innerHTML = appData.pengepul
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map(p => {
      const tonaseTon = p.totalTonase / KW_PER_TON;
      return `
        <tr>
          <td class="text-slate-400 font-mono text-xs">${p.id}</td>
          <td class="font-semibold">${p.nama}</td>
          <td>${p.daerah}</td>
          <td class="${p.sisaDeposit < 0 ? 'text-red-600' : p.sisaDeposit < WARN_THRESHOLD ? 'text-amber-600' : 'text-green-700'} font-semibold text-right">
            ${formatRupiah(p.sisaDeposit)}
          </td>
          <td class="text-right">
            ${formatDecimal(p.totalTonase, 2)} Kw<br>
            <span class="text-xs text-slate-400">${formatDecimal(tonaseTon, 3)} Ton</span>
          </td>
          <td class="text-center">
            <div class="flex gap-1 justify-center">
              <button class="btn-table-edit" onclick="openEditPengepul('${p.id}')">Edit</button>
              <button class="btn-table-delete" onclick="konfirmHapusPengepul('${p.id}')">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
}

// ============================================================
//  14. RENDER RIWAYAT DEPOSIT
// ============================================================
function renderDepositList() {
  const tbody = document.getElementById('tbodyDepositList');
  const sorted = [...appData.depositTransactions]
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-6">Belum ada riwayat deposit</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(d => {
    const p = appData.pengepul.find(x => x.id === d.pengepulId);
    return `
      <tr>
        <td>${formatTanggal(d.tanggal)}</td>
        <td class="font-medium">${p ? p.nama : '—'}<br><span class="text-xs text-slate-400">${p ? p.daerah : ''}</span></td>
        <td class="text-right font-semibold text-blue-700">${formatRupiah(d.jumlah)}</td>
        <td class="text-slate-400 text-xs">${d.catatan}</td>
        <td class="text-center">
          <div class="flex gap-1 justify-center">
            <button class="btn-table-edit" onclick="openEditDeposit('${d.id}')">Edit</button>
            <button class="btn-table-delete" onclick="konfirmHapusDeposit('${d.id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
//  15. RENDER REKAP PER PENGEPUL
// ============================================================
function renderRekapTable(filter = {}) {
  const tbody = document.getElementById('tbodyRekap');
  let data = [...appData.pengepul];

  if (filter.nama)   data = data.filter(p => p.nama.toLowerCase().includes(filter.nama.toLowerCase()));
  if (filter.daerah) data = data.filter(p => p.daerah.toLowerCase().includes(filter.daerah.toLowerCase()));

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-6">Tidak ada data</td></tr>';
    return;
  }

  tbody.innerHTML = data
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map(p => {
      const tonaseTon  = p.totalTonase / KW_PER_TON;
      const badge      = badgeSisaDeposit(p.sisaDeposit);
      const sisaClass  = p.sisaDeposit < 0 ? 'text-red-600' : p.sisaDeposit < WARN_THRESHOLD ? 'text-amber-600' : 'text-green-700';
      return `
        <tr>
          <td class="font-semibold">${p.nama}</td>
          <td>${p.daerah}</td>
          <td class="text-right">${formatRupiah(p.totalDeposit)}</td>
          <td class="text-right">
            ${formatDecimal(p.totalTonase, 2)} Kw<br>
            <span class="text-xs text-slate-400">${formatDecimal(tonaseTon, 3)} Ton</span>
          </td>
          <td class="text-right">${formatRupiah(p.totalNilaiTransaksi)}</td>
          <td class="text-right font-semibold ${sisaClass}">${formatRupiah(p.sisaDeposit)}</td>
          <td class="text-center">${badge}</td>
        </tr>
      `;
    }).join('');
}

/** Membuat HTML badge status sisa deposit */
function badgeSisaDeposit(sisa) {
  if (sisa < 0)                  return '<span class="badge badge-danger">Kurang Bayar</span>';
  if (sisa < WARN_THRESHOLD)     return '<span class="badge badge-warn">Menipis</span>';
  return '<span class="badge badge-ok">Aman</span>';
}

// ============================================================
//  16. RENDER RIWAYAT TRANSAKSI (dengan filter)
// ============================================================
function renderRiwayat(filter = {}) {
  const tbody  = document.getElementById('tbodyRiwayat');
  const sumEl  = document.getElementById('riwayatSummary');
  let data = [...appData.pembelianTransactions];

  if (filter.nama)      data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.nama.toLowerCase().includes(filter.nama.toLowerCase());
  });
  if (filter.daerah)    data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.daerah.toLowerCase().includes(filter.daerah.toLowerCase());
  });
  if (filter.dariTgl)   data = data.filter(tx => tx.tanggal >= filter.dariTgl);
  if (filter.sampaiTgl) data = data.filter(tx => tx.tanggal <= filter.sampaiTgl);

  data.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-slate-400 py-6">Tidak ada data yang sesuai filter</td></tr>';
    sumEl.classList.add('hidden');
    return;
  }

  tbody.innerHTML = data.map(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    const timbanganDetail = tx.timbangan.map(v => formatDecimal(v, 2)).join(' + ');
    const hargaKg  = tx.hargaBeli;
    const hargaTon = tx.hargaPerTon ?? (hargaKg < 100000 ? hargaKg * 1000 : hargaKg);
    return `
      <tr>
        <td class="whitespace-nowrap">${formatTanggal(tx.tanggal)}</td>
        <td class="font-medium whitespace-nowrap">${p ? p.nama : '—'}</td>
        <td>${p ? p.daerah : '—'}</td>
        <td class="text-right">${formatRupiah(hargaKg)}/Kg</td>
        <td class="text-right text-slate-400 text-xs">${formatRupiah(hargaTon)}/Ton</td>
        <td class="text-xs text-slate-500">${timbanganDetail}</td>
        <td class="text-right font-medium">${formatDecimal(tx.totalKuintal, 2)} Kw</td>
        <td class="text-right font-semibold text-green-700">${formatDecimal(tx.totalTonase, 3)} Ton</td>
        <td class="text-right font-semibold">${formatRupiah(tx.totalHarga)}</td>
        <td class="text-xs text-slate-400">${tx.catatan || '—'}</td>
        <td class="text-center">
          <div class="flex gap-1 justify-center">
            <button class="btn-table-edit" onclick="openEditPembelian('${tx.id}')">Edit</button>
            <button class="btn-table-delete" onclick="konfirmHapusPembelian('${tx.id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Ringkasan total hasil filter
  const sumKuintal = data.reduce((s, tx) => s + tx.totalKuintal, 0);
  const sumTonase  = sumKuintal / KW_PER_TON;
  const sumHarga   = data.reduce((s, tx) => s + tx.totalHarga, 0);
  sumEl.classList.remove('hidden');
  sumEl.innerHTML = `
    <strong>${data.length} transaksi ditemukan</strong> &mdash;
    Total: <strong>${formatDecimal(sumKuintal, 2)} Kw</strong>
    (${formatDecimal(sumTonase, 3)} Ton) senilai <strong>${formatRupiah(sumHarga)}</strong>
  `;
}

// ============================================================
//  17b. BIND PRINT / PDF BUTTONS
// ============================================================
function bindDownloadEvents() {
  // Cetak riwayat sesuai filter aktif
  document.getElementById('btnPrintRiwayat').addEventListener('click', () => {
    printRiwayat(getActiveFilter());
  });

  // Cetak semua riwayat tanpa filter
  document.getElementById('btnPrintRiwayatAll').addEventListener('click', () => {
    printRiwayat({});
  });

  // Cetak rekap per pengepul
  document.getElementById('btnPrintRekap').addEventListener('click', printRekap);
}

/** Ambil nilai filter aktif dari form riwayat */
function getActiveFilter() {
  return {
    nama:      document.getElementById('filterNama').value,
    daerah:    document.getElementById('filterDaerah').value,
    dariTgl:   document.getElementById('filterDariTgl').value,
    sampaiTgl: document.getElementById('filterSampaiTgl').value,
  };
}

// ============================================================
//  PDF via window.print()
//  Strategi: tulis HTML ke #printArea → panggil window.print()
//  → CSS @media print menyembunyikan semua kecuali #printArea
// ============================================================

/**
 * CETAK RIWAYAT PEMBELIAN SEBAGAI PDF
 * -------------------------------------
 * Membangun halaman print dengan tabel riwayat,
 * lalu membuka dialog Print / Save as PDF browser.
 */
function printRiwayat(filter = {}) {
  let data = [...appData.pembelianTransactions];

  if (filter.nama)      data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.nama.toLowerCase().includes(filter.nama.toLowerCase());
  });
  if (filter.daerah)    data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.daerah.toLowerCase().includes(filter.daerah.toLowerCase());
  });
  if (filter.dariTgl)   data = data.filter(tx => tx.tanggal >= filter.dariTgl);
  if (filter.sampaiTgl) data = data.filter(tx => tx.tanggal <= filter.sampaiTgl);
  data.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  if (data.length === 0) {
    showToast('Tidak ada data untuk dicetak!', 'warning');
    return;
  }

  // Hitung ringkasan
  const sumKuintal = data.reduce((s, tx) => s + tx.totalKuintal, 0);
  const sumTonase  = sumKuintal / KW_PER_TON;
  const sumHarga   = data.reduce((s, tx) => s + tx.totalHarga, 0);

  // Filter label untuk judul
  const filterLabel = [
    filter.nama      ? `Pengepul: ${filter.nama}`  : '',
    filter.daerah    ? `Daerah: ${filter.daerah}`   : '',
    filter.dariTgl   ? `Dari: ${formatTanggal(filter.dariTgl)}`    : '',
    filter.sampaiTgl ? `s/d: ${formatTanggal(filter.sampaiTgl)}`  : '',
  ].filter(Boolean).join(' | ');

  // Baris tabel
  const baris = data.map((tx, i) => {
    const p        = appData.pengepul.find(x => x.id === tx.pengepulId);
    const hargaKg  = tx.hargaBeli;
    const hargaTon = tx.hargaPerTon ?? (hargaKg < 100000 ? hargaKg * 1000 : hargaKg);
    const detail   = tx.timbangan.map(v => formatDecimal(v, 2)).join(' + ');
    return `
      <tr class="${i % 2 === 0 ? 'even' : ''}">
        <td>${i + 1}</td>
        <td>${formatTanggal(tx.tanggal)}</td>
        <td>${p ? p.nama : '—'}</td>
        <td>${p ? p.daerah : '—'}</td>
        <td class="num">${formatRupiah(hargaKg)}/Kg<br><small>${formatRupiah(hargaTon)}/Ton</small></td>
        <td class="num detail">${detail}</td>
        <td class="num">${formatDecimal(tx.totalKuintal, 2)} Kw</td>
        <td class="num">${formatDecimal(tx.totalTonase, 3)} Ton</td>
        <td class="num bold">${formatRupiah(tx.totalHarga)}</td>
        <td>${tx.catatan || '—'}</td>
      </tr>`;
  }).join('');

  const html = buildPrintPage(
    'Riwayat Transaksi Pembelian Karet',
    filterLabel || 'Semua Data',
    `<table>
      <thead>
        <tr>
          <th>#</th><th>Tanggal</th><th>Pengepul</th><th>Daerah</th>
          <th>Harga</th><th>Timbangan (Kw)</th>
          <th>Total Kw</th><th>Tonase</th><th>Total Harga</th><th>Catatan</th>
        </tr>
      </thead>
      <tbody>${baris}</tbody>
      <tfoot>
        <tr>
          <td colspan="6" class="bold">TOTAL (${data.length} transaksi)</td>
          <td class="num bold">${formatDecimal(sumKuintal, 2)} Kw</td>
          <td class="num bold">${formatDecimal(sumTonase, 3)} Ton</td>
          <td class="num bold">${formatRupiah(sumHarga)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`
  );

  doPrint(html);
}

/**
 * CETAK REKAP PER PENGEPUL
 * --------------------------
 */
function printRekap() {
  if (appData.pengepul.length === 0) {
    showToast('Belum ada data pengepul!', 'warning');
    return;
  }

  // KPI total
  let totDeposit = 0, totBeli = 0, totSisa = 0, totKuintal = 0;
  appData.pengepul.forEach(p => {
    totDeposit  += p.totalDeposit;
    totBeli     += p.totalNilaiTransaksi;
    totSisa     += p.sisaDeposit;
    totKuintal  += p.totalTonase;
  });

  const baris = appData.pengepul
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map((p, i) => {
      const ton  = p.totalTonase / KW_PER_TON;
      const status = p.sisaDeposit < 0 ? 'MINUS' : p.sisaDeposit < WARN_THRESHOLD ? 'MENIPIS' : 'AMAN';
      const statusClass = p.sisaDeposit < 0 ? 'minus' : p.sisaDeposit < WARN_THRESHOLD ? 'warn' : 'ok';
      return `
        <tr class="${i % 2 === 0 ? 'even' : ''}">
          <td>${i + 1}</td>
          <td>${p.nama}</td>
          <td>${p.daerah}</td>
          <td class="num">${formatRupiah(p.totalDeposit)}</td>
          <td class="num">${formatDecimal(p.totalTonase, 2)} Kw<br><small>${formatDecimal(ton, 3)} Ton</small></td>
          <td class="num">${formatRupiah(p.totalNilaiTransaksi)}</td>
          <td class="num bold ${statusClass}">${formatRupiah(p.sisaDeposit)}</td>
          <td class="center ${statusClass}">${status}</td>
        </tr>`;
    }).join('');

  const html = buildPrintPage(
    'Rekapitulasi Saldo & Tonase per Pengepul',
    `Dicetak: ${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}`,
    `<!-- KPI ringkasan -->
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-lbl">Total Deposit</div><div class="kpi-val">${formatRupiah(totDeposit)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Nilai Beli</div><div class="kpi-val">${formatRupiah(totBeli)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Sisa Deposit</div><div class="kpi-val ${totSisa < 0 ? 'minus' : ''}">${formatRupiah(totSisa)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Tonase</div><div class="kpi-val">${formatDecimal(totKuintal / KW_PER_TON, 3)} Ton</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Nama Pengepul</th><th>Daerah</th>
          <th>Total Deposit</th><th>Total Tonase</th>
          <th>Total Nilai Tx</th><th>Sisa Deposit</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${baris}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="bold">TOTAL (${appData.pengepul.length} pengepul)</td>
          <td class="num bold">${formatRupiah(totDeposit)}</td>
          <td class="num bold">${formatDecimal(totKuintal / KW_PER_TON, 3)} Ton</td>
          <td class="num bold">${formatRupiah(totBeli)}</td>
          <td class="num bold ${totSisa < 0 ? 'minus' : ''}">${formatRupiah(totSisa)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`
  );

  doPrint(html);
}

/**
 * BANGUN HTML HALAMAN PRINT
 * --------------------------
 * Menghasilkan dokumen HTML self-contained dengan style cetak
 * yang responsif dan rapi di kertas A4 maupun HP.
 */
function buildPrintPage(judul, subtitle, bodyContent) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${judul} – SiKaret</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 12px; }

  /* ---- HEADER ---- */
  .print-header { border-bottom: 2px solid #16a34a; padding-bottom: 8px; margin-bottom: 12px; }
  .print-header h1 { font-size: 16px; color: #16a34a; margin-bottom: 2px; }
  .print-header .sub { font-size: 10px; color: #555; }
  .print-header .meta { font-size: 10px; color: #888; margin-top: 4px; }

  /* ---- KPI BOXES ---- */
  .kpi-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .kpi-box { flex: 1; min-width: 120px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
  .kpi-lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .kpi-val { font-size: 13px; font-weight: 700; color: #1e293b; margin-top: 2px; }
  .kpi-val.minus { color: #dc2626; }

  /* ---- TABLE ---- */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead tr { background: #16a34a; color: #fff; }
  th { padding: 6px 5px; text-align: left; font-size: 10px; white-space: nowrap; }
  td { padding: 5px 5px; border-bottom: 1px solid #e2e8f0; font-size: 10px; vertical-align: top; }
  tr.even td { background: #f8fafc; }
  tfoot tr td { background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1; padding: 6px 5px; font-size: 10px; }

  /* ---- CELL HELPERS ---- */
  .num    { text-align: right; white-space: nowrap; }
  .center { text-align: center; }
  .bold   { font-weight: 700; }
  .detail { font-size: 9px; color: #555; max-width: 120px; word-break: break-word; }
  small   { font-size: 9px; color: #888; display: block; }

  /* ---- STATUS COLORS ---- */
  .ok   { color: #15803d; }
  .warn { color: #b45309; }
  .minus{ color: #dc2626; font-weight: 700; }

  /* ---- FOOTER ---- */
  .print-footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0;
                  font-size: 9px; color: #94a3b8; text-align: center; }

  /* ---- PRINT MEDIA ---- */
  @media print {
    body { padding: 0; }
    @page { margin: 10mm 8mm; size: A4; }
    thead { display: table-header-group; } /* ulang header di setiap halaman */
    tfoot { display: table-footer-group; }
    tr    { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="print-header">
    <h1>SIKARET — ${judul}</h1>
    <div class="sub">${subtitle}</div>
    <div class="meta">Dicetak pada: ${new Date().toLocaleString('id-ID')}</div>
  </div>
  ${bodyContent}
  <div class="print-footer">SiKaret – Sistem Pencatatan Deposit &amp; Pembelian Karet Pengepul</div>
</body>
</html>`;
}

/**
 * EKSEKUSI PRINT
 * ---------------
 * Menulis HTML ke #printArea, panggil window.print(),
 * lalu bersihkan kembali setelah selesai.
 * CSS @media print di style.css menyembunyikan semua
 * elemen kecuali #printArea sehingga hanya tabel yang tercetak.
 */
function doPrint(html) {
  const area = document.getElementById('printArea');
  area.innerHTML = html;
  area.style.display = 'block';
  // Sedikit delay agar DOM sempat render gambar/font sebelum dialog muncul
  setTimeout(() => {
    window.print();
    // Bersihkan setelah dialog tutup
    setTimeout(() => {
      area.style.display = 'none';
      area.innerHTML = '';
    }, 1000);
  }, 150);
}

/** Tanggal hari ini dalam format YYYYMMDD */
function todayIso() {
  return new Date().toISOString().split('T')[0].replace(/-/g, '');
}

// ============================================================
//  17. RENDER DEPOSIT STATUS LIST (di tab Pembelian)
// ============================================================
function renderDepositStatusList() {
  const container = document.getElementById('depositStatusList');
  container.innerHTML = '';

  if (appData.pengepul.length === 0) {
    container.innerHTML = '<p class="text-sm text-slate-400">Belum ada pengepul.</p>';
    return;
  }

  appData.pengepul
    .sort((a, b) => a.sisaDeposit - b.sisaDeposit)
    .forEach(p => {
      // Persen sisa deposit (0–100), capped
      const persen = p.totalDeposit > 0
        ? Math.max(0, Math.min(100, (p.sisaDeposit / p.totalDeposit) * 100))
        : 0;
      const color = p.sisaDeposit < 0 ? '#dc2626' : p.sisaDeposit < WARN_THRESHOLD ? '#d97706' : '#16a34a';

      const div = document.createElement('div');
      div.className = 'deposit-bar-container';
      div.innerHTML = `
        <div class="deposit-bar-header">
          <span class="font-medium">${p.nama} <span class="text-muted">(${p.daerah})</span></span>
          <span class="${p.sisaDeposit < 0 ? 'text-danger' : p.sisaDeposit < WARN_THRESHOLD ? 'text-warning' : 'text-accent'} font-semibold">
            ${formatRupiah(p.sisaDeposit)}
          </span>
        </div>
        <div class="deposit-bar">
          <div class="deposit-bar-fill" style="width:${persen}%; background:${color};"></div>
        </div>
      `;
      container.appendChild(div);
    });
}

// ============================================================
//  18. FILTER EVENTS
// ============================================================
function bindFilterEvents() {
  // Filter rekap
  ['filterRekapNama', 'filterRekapDaerah'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      renderRekapTable({
        nama:   document.getElementById('filterRekapNama').value,
        daerah: document.getElementById('filterRekapDaerah').value,
      });
    });
  });

  // Filter riwayat
  ['filterNama', 'filterDaerah', 'filterDariTgl', 'filterSampaiTgl'].forEach(id => {
    document.getElementById(id).addEventListener('input', applyRiwayatFilter);
  });

  // Tombol reset filter
  document.getElementById('btnResetFilter').addEventListener('click', () => {
    ['filterNama', 'filterDaerah', 'filterDariTgl', 'filterSampaiTgl'].forEach(id => {
      document.getElementById(id).value = '';
    });
    renderRiwayat();
  });
}

function applyRiwayatFilter() {
  renderRiwayat({
    nama:      document.getElementById('filterNama').value,
    daerah:    document.getElementById('filterDaerah').value,
    dariTgl:   document.getElementById('filterDariTgl').value,
    sampaiTgl: document.getElementById('filterSampaiTgl').value,
  });
}

// ============================================================
//  19. CHART.JS — DASHBOARD MINI CHARTS
// ============================================================
function renderDashboardCharts() {
  const labels = appData.pengepul.map(p => p.nama);
  const tonaseData  = appData.pengepul.map(p => parseFloat(formatDecimal(p.totalTonase / KW_PER_TON, 3)));
  const depositData = appData.pengepul.map(p => p.sisaDeposit);
  const colors      = generateColors(appData.pengepul.length);

  renderBarChart('chartTonaseDashboard', labels, tonaseData, 'Tonase (Ton)', colors);
  renderSisaDepositChart('chartDepositDashboard', labels, depositData, colors);
}

// ============================================================
//  20. CHART.JS — TAB GRAFIK
// ============================================================
function renderGrafik() {
  const labels      = appData.pengepul.map(p => p.nama);
  const tonaseData  = appData.pengepul.map(p => parseFloat(formatDecimal(p.totalTonase / KW_PER_TON, 3)));
  const depositData = appData.pengepul.map(p => p.sisaDeposit);
  const colors      = generateColors(appData.pengepul.length);

  renderBarChart('chartTonase', labels, tonaseData, 'Tonase (Ton)', colors);
  renderSisaDepositChart('chartDeposit', labels, depositData, colors);
  renderTrenChart();
}

/** Bar chart tonase per pengepul */
function renderBarChart(canvasId, labels, data, label, colors) {
  if (charts[canvasId]) { charts[canvasId].destroy(); }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: colors.map(c => c + 'CC'),
        borderColor:      colors,
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/** Bar chart sisa deposit dengan warna merah untuk minus */
function renderSisaDepositChart(canvasId, labels, data, colors) {
  if (charts[canvasId]) { charts[canvasId].destroy(); }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Warna: merah jika minus, kuning jika menipis, hijau getah jika aman
  const barColors = data.map(v =>
    v < 0 ? '#b91c1c' : v < WARN_THRESHOLD ? '#b45309' : '#1b4332'
  );

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Sisa Deposit (Rp)',
        data,
        backgroundColor: barColors.map(c => c + 'CC'),
        borderColor:      barColors,
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: '#f1f5f9' },
          ticks: {
            callback: v => 'Rp ' + (v / 1_000_000).toFixed(1) + ' jt'
          }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

/**
 * TREN SETORAN KARET BULANAN
 * ---------------------------
 * Agregasi total kuintal per bulan dari semua transaksi pembelian.
 */
function renderTrenChart() {
  if (charts['chartTren']) { charts['chartTren'].destroy(); }
  const ctx = document.getElementById('chartTren');
  if (!ctx) return;

  // Agregasi kuintal per bulan
  const monthlyMap = {};
  appData.pembelianTransactions.forEach(tx => {
    const key = getBulanTahun(tx.tanggal);
    monthlyMap[key] = (monthlyMap[key] || 0) + tx.totalKuintal;
  });

  // Urutkan berdasarkan tanggal
  const sorted = Object.entries(monthlyMap).sort((a, b) => {
    const parseKey = k => {
      const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
      const [mon, yr] = k.split(' ');
      return parseInt(yr) * 100 + months.indexOf(mon);
    };
    return parseKey(a[0]) - parseKey(b[0]);
  });

  const labels = sorted.map(([k]) => k);
  const data   = sorted.map(([, v]) => parseFloat(formatDecimal(v, 2)));

  charts['chartTren'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Kuintal per Bulan',
        data,
        backgroundColor: 'rgba(27, 67, 50, 0.08)',
        borderColor:      '#1b4332',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#1b4332',
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { callback: v => v + ' Kw' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

// ============================================================
//  21. UTIL: GENERATE CHART COLORS
// ============================================================
function generateColors(n) {
  const palette = [
    '#1b4332', '#3f3f46', '#2563eb', '#92400e', '#475569',
    '#15803d', '#52525b', '#b45309', '#1e293b', '#0d9488'
  ];
  const out = [];
  for (let i = 0; i < n; i++) out.push(palette[i % palette.length]);
  return out;
}

// ============================================================
//  CRUD — MODAL HELPERS
// ============================================================

/** Buka modal by ID */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // cegah scroll background
}

/** Tutup modal by ID */
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

/** Klik luar modal → tutup */
document.addEventListener('click', e => {
  ['modalEditPengepul','modalEditDeposit','modalEditPembelian','modalKonfirmHapus'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden') && e.target === el) closeModal(id);
  });
});

// ============================================================
//  CRUD — PENGEPUL: EDIT
// ============================================================

/** Buka modal edit pengepul dan isi nilai awal */
function openEditPengepul(id) {
  const p = appData.pengepul.find(x => x.id === id);
  if (!p) return;
  document.getElementById('editPengepulId').value    = p.id;
  document.getElementById('editPengepulNama').value  = p.nama;
  document.getElementById('editPengepulDaerah').value = p.daerah;
  openModal('modalEditPengepul');
}

/** Simpan perubahan edit pengepul (hanya nama & daerah) */
document.getElementById('formEditPengepul').addEventListener('submit', function(e) {
  e.preventDefault();
  const id     = document.getElementById('editPengepulId').value;
  const nama   = document.getElementById('editPengepulNama').value.trim();
  const daerah = document.getElementById('editPengepulDaerah').value.trim();
  if (!nama || !daerah) return;

  const p = appData.pengepul.find(x => x.id === id);
  if (!p) return;
  p.nama   = nama;
  p.daerah = daerah;

  saveData();
  populateSelects();
  renderAll();
  closeModal('modalEditPengepul');
  showToast(`Data pengepul "${nama}" berhasil diperbarui!`, 'success');
});

// ============================================================
//  CRUD — PENGEPUL: HAPUS
// ============================================================

/**
 * Hapus pengepul.
 * Guard: tidak bisa hapus jika masih punya deposit atau transaksi pembelian.
 */
function konfirmHapusPengepul(id) {
  const p = appData.pengepul.find(x => x.id === id);
  if (!p) return;

  const adaDeposit  = appData.depositTransactions.some(d => d.pengepulId === id);
  const adaPembelian = appData.pembelianTransactions.some(t => t.pengepulId === id);

  if (adaDeposit || adaPembelian) {
    showToast(`Tidak bisa hapus "${p.nama}" — masih punya riwayat transaksi. Hapus transaksinya dulu.`, 'error');
    return;
  }

  tampilKonfirmHapus(
    `Hapus pengepul <strong>${p.nama}</strong> (${p.daerah})? Tindakan ini tidak bisa dibatalkan.`,
    () => {
      appData.pengepul = appData.pengepul.filter(x => x.id !== id);
      saveData();
      populateSelects();
      renderAll();
      showToast(`Pengepul "${p.nama}" berhasil dihapus.`, 'success');
    }
  );
}

// ============================================================
//  CRUD — DEPOSIT: EDIT
// ============================================================

/** Buka modal edit deposit */
function openEditDeposit(id) {
  const d = appData.depositTransactions.find(x => x.id === id);
  if (!d) return;
  const p = appData.pengepul.find(x => x.id === d.pengepulId);

  document.getElementById('editDepositId').value             = d.id;
  document.getElementById('editDepositPengepulNama').value   = p ? `${p.nama} (${p.daerah})` : '—';
  document.getElementById('editDepositTanggal').value        = d.tanggal;
  document.getElementById('editDepositJumlah').value         = d.jumlah;
  document.getElementById('editDepositCatatan').value        = d.catatan || '';
  openModal('modalEditDeposit');
}

/**
 * Simpan edit deposit.
 * Reversal: kurangi totalDeposit & sisaDeposit dengan jumlah lama,
 * lalu tambahkan jumlah baru.
 */
document.getElementById('formEditDeposit').addEventListener('submit', function(e) {
  e.preventDefault();
  const id          = document.getElementById('editDepositId').value;
  const tanggal     = document.getElementById('editDepositTanggal').value;
  const jumlahBaru  = parseFloat(document.getElementById('editDepositJumlah').value);
  const catatan     = document.getElementById('editDepositCatatan').value.trim();

  if (!tanggal || isNaN(jumlahBaru) || jumlahBaru <= 0) return;

  const d = appData.depositTransactions.find(x => x.id === id);
  if (!d) return;
  const p = appData.pengepul.find(x => x.id === d.pengepulId);

  const jumlahLama = d.jumlah;
  const selisih    = jumlahBaru - jumlahLama;  // bisa positif atau negatif

  // Update record deposit
  d.tanggal = tanggal;
  d.jumlah  = jumlahBaru;
  d.catatan = catatan;

  // Update akumulasi pengepul: sesuaikan totalDeposit dan sisaDeposit
  if (p) {
    p.totalDeposit += selisih;
    p.sisaDeposit  += selisih;
  }

  saveData();
  renderAll();
  closeModal('modalEditDeposit');
  showToast(`Deposit berhasil diperbarui (selisih: ${formatRupiah(selisih)}).`, 'success');
});

// ============================================================
//  CRUD — DEPOSIT: HAPUS
// ============================================================

/**
 * Hapus deposit.
 * Reversal: kurangi totalDeposit & sisaDeposit sebesar jumlah deposit yang dihapus.
 */
function konfirmHapusDeposit(id) {
  const d = appData.depositTransactions.find(x => x.id === id);
  if (!d) return;
  const p = appData.pengepul.find(x => x.id === d.pengepulId);

  tampilKonfirmHapus(
    `Hapus deposit <strong>${formatRupiah(d.jumlah)}</strong> tanggal ${formatTanggal(d.tanggal)}
     untuk <strong>${p ? p.nama : '—'}</strong>?<br>
     Saldo deposit pengepul akan berkurang sebesar jumlah tersebut.`,
    () => {
      // Reversal saldo
      if (p) {
        p.totalDeposit -= d.jumlah;
        p.sisaDeposit  -= d.jumlah;
      }
      appData.depositTransactions = appData.depositTransactions.filter(x => x.id !== id);
      saveData();
      renderAll();
      showToast('Deposit berhasil dihapus dan saldo telah disesuaikan.', 'success');
    }
  );
}

// ============================================================
//  CRUD — PEMBELIAN: EDIT (dengan timbangan bertahap)
// ============================================================

let editTimbanganCount = 0;

/** Buka modal edit pembelian dan populate semua field + timbangan */
function openEditPembelian(id) {
  const tx = appData.pembelianTransactions.find(x => x.id === id);
  if (!tx) return;
  const p = appData.pengepul.find(x => x.id === tx.pengepulId);

  document.getElementById('editPembelianId').value             = tx.id;
  document.getElementById('editPembelianTanggal').value        = tx.tanggal;
  document.getElementById('editPembelianPengepulNama').value   = p ? `${p.nama} (${p.daerah})` : '—';
  document.getElementById('editPembelianHarga').value          = tx.hargaBeli;
  document.getElementById('editPembelianCatatan').value        = tx.catatan || '';

  // Populate baris timbangan
  const container = document.getElementById('editTimbanganContainer');
  container.innerHTML = '';
  editTimbanganCount = 0;
  tx.timbangan.forEach(val => addEditTimbanganRow(val));

  hitungEditTimbangan();
  openModal('modalEditPembelian');
}

/** Tambah baris timbangan di modal edit */
function addEditTimbanganRow(nilai = '') {
  editTimbanganCount++;
  const container = document.getElementById('editTimbanganContainer');
  const div = document.createElement('div');
  div.className = 'timbangan-row';
  div.innerHTML = `
    <span class="row-label">Angkatan ${editTimbanganCount}:</span>
    <input type="number" class="edit-timbangan-input form-input"
           value="${nilai}" placeholder="0.00" min="0" step="0.01"
           oninput="hitungEditTimbangan()" />
    <span class="timbangan-unit">Kw</span>
    ${editTimbanganCount > 1
      ? `<button type="button" class="btn-danger" onclick="hapusEditTimbangan(this)">Hapus</button>`
      : `<span style="width: 48px;"></span>`}
  `;
  container.appendChild(div);
}

/** Hapus baris timbangan di modal edit */
function hapusEditTimbangan(btn) {
  btn.closest('.timbangan-row').remove();
  document.querySelectorAll('#editTimbanganContainer .timbangan-row').forEach((row, i) => {
    row.querySelector('.row-label').textContent = `Angkatan ${i + 1}:`;
  });
  hitungEditTimbangan();
}

/**
 * Hitung live preview di modal edit.
 * Sama persis dengan hitungTimbangan() tapi baca dari #editTimbanganContainer.
 */
function hitungEditTimbangan() {
  const inputs = document.querySelectorAll('.edit-timbangan-input');
  let totalKuintal = 0;
  inputs.forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) totalKuintal += v;
  });
  const tonase      = totalKuintal / KW_PER_TON;
  const hargaPerKg  = parseFloat(document.getElementById('editPembelianHarga').value) || 0;
  const hargaPerTon = hargaPerKg * 1000;
  const total       = tonase * hargaPerTon;

  document.getElementById('editPreviewKuintal').textContent = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('editPreviewTonase').textContent  = formatDecimal(tonase, 3) + ' Ton';
  document.getElementById('editPreviewHarga').textContent   = formatRupiah(total);
}

/**
 * Simpan edit pembelian.
 * Reversal lengkap:
 * 1. Kembalikan tonase & nilai transaksi lama ke pengepul
 * 2. Kembalikan pemotongan deposit lama
 * 3. Terapkan nilai baru
 */
document.getElementById('formEditPembelian').addEventListener('submit', function(e) {
  e.preventDefault();
  const id         = document.getElementById('editPembelianId').value;
  const tanggal    = document.getElementById('editPembelianTanggal').value;
  const hargaPerKg = parseFloat(document.getElementById('editPembelianHarga').value);
  const catatan    = document.getElementById('editPembelianCatatan').value.trim();

  if (!tanggal || isNaN(hargaPerKg) || hargaPerKg <= 0) return;

  // Kumpulkan timbangan baru
  const inputs = document.querySelectorAll('.edit-timbangan-input');
  const timbanganBaru = [];
  let totalKuintalBaru = 0;
  inputs.forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) { timbanganBaru.push(v); totalKuintalBaru += v; }
  });

  if (timbanganBaru.length === 0 || totalKuintalBaru <= 0) {
    showToast('Masukkan minimal 1 angkatan timbangan!', 'error');
    return;
  }

  const tx = appData.pembelianTransactions.find(x => x.id === id);
  if (!tx) return;
  const p = appData.pengepul.find(x => x.id === tx.pengepulId);

  // ── REVERSAL nilai lama ──
  if (p) {
    p.sisaDeposit         += tx.totalHarga;        // kembalikan pemotongan deposit
    p.totalTonase         -= tx.totalKuintal;       // kurangi tonase lama (dalam Kuintal)
    p.totalNilaiTransaksi -= tx.totalHarga;
  }

  // ── Hitung nilai baru ──
  const totalTonaseBaru = totalKuintalBaru / KW_PER_TON;
  const hargaPerTonBaru = hargaPerKg * 1000;
  const totalHargaBaru  = totalTonaseBaru * hargaPerTonBaru;

  // ── Update record transaksi ──
  tx.tanggal     = tanggal;
  tx.hargaBeli   = hargaPerKg;
  tx.hargaPerTon = hargaPerTonBaru;
  tx.timbangan   = timbanganBaru;
  tx.totalKuintal = totalKuintalBaru;
  tx.totalTonase  = totalTonaseBaru;
  tx.totalHarga   = totalHargaBaru;
  tx.catatan      = catatan;

  // ── Terapkan nilai baru ke pengepul ──
  if (p) {
    p.sisaDeposit         -= totalHargaBaru;
    p.totalTonase         += totalKuintalBaru;
    p.totalNilaiTransaksi += totalHargaBaru;
  }

  saveData();
  renderAll();
  closeModal('modalEditPembelian');
  showToast(
    `Transaksi berhasil diperbarui: ${formatDecimal(totalKuintalBaru, 2)} Kw → ${formatRupiah(totalHargaBaru)}`,
    'success'
  );
});

// ============================================================
//  CRUD — PEMBELIAN: HAPUS
// ============================================================

/**
 * Hapus transaksi pembelian.
 * Reversal: kembalikan pemotongan deposit, kurangi akumulasi tonase & nilai.
 */
function konfirmHapusPembelian(id) {
  const tx = appData.pembelianTransactions.find(x => x.id === id);
  if (!tx) return;
  const p = appData.pengepul.find(x => x.id === tx.pengepulId);

  tampilKonfirmHapus(
    `Hapus transaksi pembelian <strong>${formatDecimal(tx.totalKuintal, 2)} Kw</strong>
     (${formatDecimal(tx.totalTonase, 3)} Ton) senilai <strong>${formatRupiah(tx.totalHarga)}</strong>
     tanggal ${formatTanggal(tx.tanggal)} untuk <strong>${p ? p.nama : '—'}</strong>?<br>
     Deposit dan tonase pengepul akan dikembalikan.`,
    () => {
      // Reversal semua efek
      if (p) {
        p.sisaDeposit         += tx.totalHarga;
        p.totalTonase         -= tx.totalKuintal;
        p.totalNilaiTransaksi -= tx.totalHarga;
      }
      appData.pembelianTransactions = appData.pembelianTransactions.filter(x => x.id !== id);
      saveData();
      renderAll();
      showToast('Transaksi pembelian berhasil dihapus dan data telah dikembalikan.', 'success');
    }
  );
}

// ============================================================
//  CRUD — MODAL KONFIRMASI HAPUS (shared)
// ============================================================

/** Tampilkan modal konfirmasi hapus dengan pesan dan callback */
function tampilKonfirmHapus(pesan, onOk) {
  document.getElementById('konfirmHapusMsg').innerHTML = pesan;
  openModal('modalKonfirmHapus');

  // Ganti handler tombol OK (hindari event listener menumpuk)
  const btn = document.getElementById('btnKonfirmHapusOk');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => {
    closeModal('modalKonfirmHapus');
    onOk();
  });
}


// ============================================================
//  22. TOAST NOTIFICATION
// ============================================================
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');

  // Reset classes
  toast.className = `toast ${type}`;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
