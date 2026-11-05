/* =====================================================
   SiKaret – script.js
   Sistem Pencatatan Deposit & Pembelian Karet Pengepul
   Vanilla JavaScript · LocalStorage · Chart.js
   ===================================================== */

'use strict';

// ============================================================
//  KONSTANTA & KONFIGURASI
// ============================================================
const LS_KEY_PENGEPUL = 'sikaret_pengepul';
const LS_KEY_DEPOSIT = 'sikaret_deposit';
const LS_KEY_PEMBELIAN = 'sikaret_pembelian';
const LS_KEY_PENJUALAN = 'sikaret_penjualan_pabrik';

// 1 Ton = 10 Kuintal (konversi resmi)
const KW_PER_TON = 10;

// Ambang batas sisa deposit untuk peringatan (dalam Rupiah)
const WARN_THRESHOLD = 5_000_000;   // kuning: sisa < 5 jt
const DANGER_THRESHOLD = 0;          // merah : sisa <= 0 (minus/lunas-lebih)

// ============================================================
//  STATE APLIKASI
// ============================================================
let appData = {
  pengepul: [],
  depositTransactions: [],
  pembelianTransactions: [],
  penjualanPabrik: [],
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
  initPenjualanPabrik();      // Setup modul penjualan pabrik CV Mandiri Putra
  bindFormEvents();           // Pasang event listener form
  bindFilterEvents();         // Pasang event listener filter
  bindDownloadEvents();       // Pasang event listener tombol download
  renderAll();                // Render semua tampilan
});

// ============================================================
//  FIREBASE CONFIG & CLOUD FIRESTORE
// ============================================================
// Konfigurasi dimuat dari berkas terpisah firebase-config.js (diabaikan oleh Git via .gitignore)
const activeFirebaseConfig = typeof firebaseConfig !== 'undefined' ? firebaseConfig : null;

let db = null;
let isFirestoreInitialized = false;

/** Inisialisasi Firebase & Cloud Firestore */
function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && activeFirebaseConfig && activeFirebaseConfig.apiKey && activeFirebaseConfig.apiKey !== 'YOUR_API_KEY') {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(activeFirebaseConfig);
      }
      db = firebase.firestore();

      // Aktifkan offline persistence (agar data tetap tersimpan saat sinyal hilang di kebun)
      db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
        if (err.code === 'failed-precondition') {
          console.warn('Firestore offline persistence: multi-tab aktif');
        } else if (err.code === 'unimplemented') {
          console.warn('Firestore offline persistence tidak didukung browser ini');
        }
      });
      isFirestoreInitialized = true;
    } else {
      updateSyncStatus('offline', 'Mode Offline (Penyimpanan Lokal)');
    }
  } catch (err) {
    console.error('Firebase init error:', err);
    updateSyncStatus('offline', 'Mode Offline (Penyimpanan Lokal)');
  }
}

/** Update indikator status sinkronisasi cloud */
function updateSyncStatus(status, text) {
  const headerStatus = document.getElementById('systemStatus');
  const badge = document.getElementById('syncBadge');

  if (headerStatus) {
    headerStatus.textContent = text;
  }
  if (badge) {
    badge.textContent = text;
    badge.className = 'badge ' + (
      status === 'connected' ? 'badge-ok' :
        status === 'syncing' ? 'badge-info' :
          status === 'warning' ? 'badge-warn' : 'badge-danger'
    );
  }
}

// ============================================================
//  1. LOAD & SAVE DATA (HYBRID: LOCALSTORAGE & CLOUD FIRESTORE)
// ============================================================

/**
 * Memuat data:
 * 1. Muat instan dari LocalStorage (atau fallback data.json) agar tampilan langsung muncul.
 * 2. Setup listener Cloud Firestore secara realtime jika terhubung.
 */
async function loadData() {
  const storedPengepul = localStorage.getItem(LS_KEY_PENGEPUL);
  const storedDeposit = localStorage.getItem(LS_KEY_DEPOSIT);
  const storedPembelian = localStorage.getItem(LS_KEY_PEMBELIAN);
  const storedPenjualan = localStorage.getItem(LS_KEY_PENJUALAN);

  if (storedPengepul && storedDeposit && storedPembelian) {
    // Data lokal sudah ada (data pembelian, deposit, & pengepul tetap terjaga utuh)
    appData.pengepul = JSON.parse(storedPengepul);
    appData.depositTransactions = JSON.parse(storedDeposit);
    appData.pembelianTransactions = JSON.parse(storedPembelian);
    appData.penjualanPabrik = storedPenjualan ? JSON.parse(storedPenjualan) : [];
  } else {
    // Pertama kali: muat dari data.json
    try {
      const res = await fetch('data.json');
      const json = await res.json();
      appData.pengepul = json.pengepul || [];
      appData.depositTransactions = json.depositTransactions || [];
      appData.pembelianTransactions = json.pembelianTransactions || [];
      appData.penjualanPabrik = json.penjualanPabrik || [];
      saveLocalBackup();
    } catch (e) {
      console.warn('data.json tidak ditemukan, mulai dengan data kosong.', e);
      appData = { pengepul: [], depositTransactions: [], pembelianTransactions: [], penjualanPabrik: [] };
    }
  }

  // Hubungkan ke Cloud Firestore
  initFirebase();
  setupFirestoreSync();
}

/** Simpan ke cache lokal perangkat (LocalStorage) */
function saveLocalBackup() {
  try {
    localStorage.setItem(LS_KEY_PENGEPUL, JSON.stringify(appData.pengepul));
    localStorage.setItem(LS_KEY_DEPOSIT, JSON.stringify(appData.depositTransactions));
    localStorage.setItem(LS_KEY_PEMBELIAN, JSON.stringify(appData.pembelianTransactions));
    localStorage.setItem(LS_KEY_PENJUALAN, JSON.stringify(appData.penjualanPabrik || []));
  } catch (e) {
    console.warn('Gagal menyimpan cache LocalStorage:', e);
  }
}

/** Setup sinkronisasi Firestore realtime */
function setupFirestoreSync() {
  if (!db) {
    updateSyncStatus('offline', 'Mode Offline (Penyimpanan Lokal)');
    return;
  }

  updateSyncStatus('syncing', 'Menghubungkan Cloud...');

  db.collection('sikaret_data').onSnapshot((snapshot) => {
    let cloudPengepul = null;
    let cloudDeposit = null;
    let cloudPembelian = null;
    let cloudPenjualan = null;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (doc.id === 'pengepul' && Array.isArray(data.list)) {
        cloudPengepul = data.list;
      } else if (doc.id === 'depositTransactions' && Array.isArray(data.list)) {
        cloudDeposit = data.list;
      } else if (doc.id === 'pembelianTransactions' && Array.isArray(data.list)) {
        cloudPembelian = data.list;
      } else if (doc.id === 'penjualanPabrik' && Array.isArray(data.list)) {
        cloudPenjualan = data.list;
      }
    });

    if (cloudPengepul !== null || cloudDeposit !== null || cloudPembelian !== null || cloudPenjualan !== null) {
      // Ada data di Firestore
      if (cloudPengepul !== null) appData.pengepul = cloudPengepul;
      if (cloudDeposit !== null) appData.depositTransactions = cloudDeposit;
      if (cloudPembelian !== null) appData.pembelianTransactions = cloudPembelian;
      if (cloudPenjualan !== null) appData.penjualanPabrik = cloudPenjualan;

      saveLocalBackup();
      populateSelects();
      renderAll();
      updateSyncStatus('connected', 'Cloud Firebase Aktif');
    } else {
      // Jika Firestore masih kosong, upload data awal
      console.log('Mengunggah data awal ke Cloud Firestore...');
      saveData();
    }
  }, (err) => {
    console.warn('Firestore realtime sync notice:', err);
    updateSyncStatus('warning', 'Mode Offline (Tersimpan di HP)');
  });
}

/** Simpan data ke LocalStorage & Cloud Firestore */
function saveData() {
  // Selalu simpan ke perangkat lokal terlebih dahulu (responsif & instan)
  saveLocalBackup();

  if (!db) return;

  updateSyncStatus('syncing', 'Menyimpan ke Cloud...');

  const batch = db.batch();
  const col = db.collection('sikaret_data');

  batch.set(col.doc('pengepul'), {
    list: appData.pengepul,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(col.doc('depositTransactions'), {
    list: appData.depositTransactions,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(col.doc('pembelianTransactions'), {
    list: appData.pembelianTransactions,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(col.doc('penjualanPabrik'), {
    list: appData.penjualanPabrik || [],
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit()
    .then(() => {
      updateSyncStatus('connected', 'Cloud Firebase Aktif');
    })
    .catch((err) => {
      console.warn('Gagal menyimpan ke Firestore (tersimpan lokal):', err);
      updateSyncStatus('warning', 'Tersimpan di HP (Offline)');
    });
}

/** Ekspor seluruh data pembukuan ke file JSON untuk cadangan manual */
function exportBackupData() {
  const backupObject = {
    appName: 'SiKaret',
    versi: '1.0',
    exportDate: new Date().toISOString(),
    pengepul: appData.pengepul,
    depositTransactions: appData.depositTransactions,
    pembelianTransactions: appData.pembelianTransactions,
    penjualanPabrik: appData.penjualanPabrik || []
  };

  const jsonStr = JSON.stringify(backupObject, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tgl = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `sikaret-cadangan-${tgl}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Cadangan berkas JSON berhasil diunduh!', 'success');
}

/** Pulihkan data dari berkas cadangan JSON */
function restoreBackupData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.pengepul) || !Array.isArray(data.depositTransactions) || !Array.isArray(data.pembelianTransactions)) {
        showToast('Format berkas cadangan tidak sesuai!', 'error');
        return;
      }

      const tglCadangan = data.exportDate ? formatTanggal(data.exportDate.slice(0, 10)) : 'tidak diketahui';
      const konfirmasi = confirm(
        `Pulihkan data cadangan dari tanggal ${tglCadangan}?\n\n` +
        `Total: ${data.pengepul.length} pengepul, ${data.depositTransactions.length} deposit, ${data.pembelianTransactions.length} transaksi timbangan.\n\n` +
        `Data saat ini akan digantikan oleh data cadangan ini.`
      );

      if (!konfirmasi) return;

      appData.pengepul = data.pengepul;
      appData.depositTransactions = data.depositTransactions;
      appData.pembelianTransactions = data.pembelianTransactions;
      if (Array.isArray(data.penjualanPabrik)) {
        appData.penjualanPabrik = data.penjualanPabrik;
      }

      saveData();
      populateSelects();
      renderAll();
      showToast('Data berhasil dipulihkan dari berkas cadangan!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Gagal memproses berkas cadangan JSON!', 'error');
    }
  };
  reader.readAsText(file);
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

/**
 * Format angka desimal dengan rapi menggunakan koma (standar Indonesia: 2,7 atau 2,08)
 * dibulatkan dengan rapi sehingga tidak terbaca sebagai ribuan ("2.078").
 * 1 kuintal = 100 kg, 1 ton = 10 kuintal
 */
function formatDecimal(n, maxDigits = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const num = parseFloat(n);
  if (isNaN(num)) return '0';
  const factor = Math.pow(10, maxDigits);
  const rounded = Math.round(num * factor) / factor;
  return rounded.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits
  });
}

/** Format angka dengan pemisah ribuan titik (500000 -> 500.000) */
function formatNumberWithDots(val) {
  if (val === null || val === undefined || val === '') return '';
  const clean = String(val).replace(/\D/g, '');
  if (!clean) return '';
  return parseInt(clean, 10).toLocaleString('id-ID');
}

/** Parsing input teks berformat rupiah titik kembali ke integer murni untuk database */
function parseRupiahInput(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  const clean = String(val).replace(/\D/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

/** Pasang auto-format ribuan dengan titik pada elemen input rupiah */
function attachRupiahAutoFormat(inputEl, onInputCallback) {
  if (!inputEl) return;
  inputEl.type = 'text';
  inputEl.inputMode = 'numeric';

  inputEl.addEventListener('input', (e) => {
    const rawVal = e.target.value.replace(/\D/g, '');
    if (!rawVal) {
      e.target.value = '';
    } else {
      e.target.value = parseInt(rawVal, 10).toLocaleString('id-ID');
    }
    if (typeof onInputCallback === 'function') {
      onInputCallback(parseRupiahInput(e.target.value));
    }
  });
}

/**
 * Konversi nilai berat ke Kg
 * 1 kuintal = 100 kg, 1 ton = 10 kuintal = 1000 kg
 */
function convertToKg(nilai, satuan) {
  const num = parseFloat(nilai) || 0;
  if (satuan === 'kuintal') return num * 100;
  if (satuan === 'ton') return num * 1000;
  return num; // 'kg'
}

/**
 * Konversi nilai berat dari Kg ke satuan target
 */
function convertFromKg(nilaiKg, satuanTarget) {
  const num = parseFloat(nilaiKg) || 0;
  if (satuanTarget === 'kuintal') return num / 100;
  if (satuanTarget === 'ton') return num / 1000;
  return num; // 'kg'
}

/** Update teks pembantu konversi satuan berat (Kg / Kw / Ton) */
function updateWeightHint(inputEl, selectEl, hintEl) {
  if (!inputEl || !selectEl || !hintEl) return;
  const val = parseFloat(inputEl.value) || 0;
  const unit = selectEl.value;
  if (val <= 0) {
    hintEl.textContent = '';
    return;
  }
  const kg = convertToKg(val, unit);
  const kw = kg / 100;
  const ton = kg / 1000;
  hintEl.textContent = `Setara: ${formatDecimal(kg, 0)} Kg (${formatDecimal(kw, 2)} Kw / ${formatDecimal(ton, 2)} Ton)`;
}

/** Pantau perubahan satuan dan nilai input berat */
function setupUnitWatcher(inputEl, selectEl, hintEl, onChangeCallback) {
  if (!inputEl || !selectEl) return;
  let prevUnit = selectEl.value;

  selectEl.addEventListener('change', () => {
    const newUnit = selectEl.value;
    const rawVal = parseFloat(inputEl.value);
    if (!isNaN(rawVal) && rawVal > 0) {
      const kg = convertToKg(rawVal, prevUnit);
      const converted = convertFromKg(kg, newUnit);
      inputEl.value = Math.round(converted * 1000) / 1000;
    }
    prevUnit = newUnit;
    updateWeightHint(inputEl, selectEl, hintEl);
    if (typeof onChangeCallback === 'function') {
      onChangeCallback();
    }
  });

  inputEl.addEventListener('input', () => {
    updateWeightHint(inputEl, selectEl, hintEl);
    if (typeof onChangeCallback === 'function') {
      onChangeCallback();
    }
  });
}

/** Format tanggal ISO ke lokal Indonesia: 25 Sep 2024 */
function formatTanggal(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/** Ambil bulan-tahun dari ISO: "Sep 2024" */
function getBulanTahun(iso) {
  const [y, m] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
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
  ['depositTanggal', 'beliTanggal', 'sjTanggal', 'modalTimbangTanggal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
}

// ============================================================
//  4. NAVIGASI SISTEM (ROUTING SPA & RESPONSIVE DRAWER)
// ============================================================
let currentPage = 'pembelian';
let currentPembelianTab = 'dashboard';
let currentPenjualanTab = 'penjualan-kpi';

/**
 * SPA Router untuk memindahkan halaman & subtab secara mulus tanpa reload
 * @param {'pembelian'|'penjualan'} page - Halaman utama
 * @param {string} tab - ID subtab
 * @param {boolean} updateHash - Apakah memperbarui hash URL
 */
function navigateTo(page, tab, updateHash = true) {
  // 1. Normalisasi Halaman Utama
  if (page !== 'pembelian' && page !== 'penjualan') {
    page = 'pembelian';
  }
  currentPage = page;

  // 2. Normalisasi & Pemetaan Subtab
  if (page === 'pembelian') {
    const validTabs = ['dashboard', 'pengepul', 'deposit', 'pembelian', 'rekap', 'riwayat', 'grafik'];
    if (!validTabs.includes(tab)) {
      tab = currentPembelianTab || 'dashboard';
    }
    currentPembelianTab = tab;
  } else {
    // Dukungan alias ramah pengguna untuk penjualan
    if (tab === 'ringkasan' || tab === 'kpi') tab = 'penjualan-kpi';
    else if (tab === 'muat-truk' || tab === 'form' || tab === 'surat-jalan') tab = 'penjualan-form';
    else if (tab === 'riwayat' || tab === 'tabel' || tab === 'pengiriman') tab = 'penjualan-tabel';

    const validTabs = ['penjualan-kpi', 'penjualan-form', 'penjualan-tabel'];
    if (!validTabs.includes(tab)) {
      tab = currentPenjualanTab || 'penjualan-kpi';
    }
    currentPenjualanTab = tab;
  }

  // 3. Tampilkan Halaman Spesifik (Strict Page Isolation)
  const pageBeli = document.getElementById('page-pembelian');
  const pageJual = document.getElementById('page-penjualan');
  if (page === 'pembelian') {
    if (pageBeli) pageBeli.classList.remove('hidden');
    if (pageJual) pageJual.classList.add('hidden');
  } else {
    if (pageBeli) pageBeli.classList.add('hidden');
    if (pageJual) pageJual.classList.remove('hidden');
  }

  // 4. Update Navigasi Desktop (Mode Bar & Subnav)
  const btnModeBeli = document.getElementById('btnModePembelian');
  const btnModeJual = document.getElementById('btnModePenjualan');
  const subnavBeli  = document.getElementById('subnavPembelian');
  const subnavJual  = document.getElementById('subnavPenjualan');

  if (page === 'pembelian') {
    if (btnModeBeli) btnModeBeli.classList.add('active');
    if (btnModeJual) btnModeJual.classList.remove('active');
    if (subnavBeli) subnavBeli.classList.remove('hidden');
    if (subnavJual) subnavJual.classList.add('hidden');
  } else {
    if (btnModeJual) btnModeJual.classList.add('active');
    if (btnModeBeli) btnModeBeli.classList.remove('active');
    if (subnavBeli) subnavBeli.classList.add('hidden');
    if (subnavJual) subnavJual.classList.remove('hidden');
  }

  // 5. Update Drawer Mobile (Mode Switcher & Menu Group)
  const drawerModeBeli = document.getElementById('drawerModePembelian');
  const drawerModeJual = document.getElementById('drawerModePenjualan');
  const drawerMenuBeli = document.getElementById('drawerMenuPembelian');
  const drawerMenuJual = document.getElementById('drawerMenuPenjualan');

  if (page === 'pembelian') {
    if (drawerModeBeli) drawerModeBeli.classList.add('active');
    if (drawerModeJual) drawerModeJual.classList.remove('active');
    if (drawerMenuBeli) drawerMenuBeli.classList.remove('hidden');
    if (drawerMenuJual) drawerMenuJual.classList.add('hidden');
  } else {
    if (drawerModeJual) drawerModeJual.classList.add('active');
    if (drawerModeBeli) drawerModeBeli.classList.remove('active');
    if (drawerMenuBeli) drawerMenuBeli.classList.add('hidden');
    if (drawerMenuJual) drawerMenuJual.classList.remove('hidden');
  }

  // 6. Tampilkan Subtab yang Aktif
  if (page === 'pembelian') {
    const beliSections = pageBeli ? pageBeli.querySelectorAll('.tab-content') : [];
    beliSections.forEach(s => s.classList.add('hidden'));
    const targetSec = document.getElementById('tab-' + tab);
    if (targetSec) targetSec.classList.remove('hidden');

    // Update active tab buttons (Desktop & Drawer)
    document.querySelectorAll('#subnavPembelian .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('#drawerMenuPembelian .drawer-link').forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tab);
    });

    if (tab === 'grafik') {
      renderGrafik();
    }
  } else {
    const jualSections = pageJual ? pageJual.querySelectorAll('.tab-content') : [];
    jualSections.forEach(s => s.classList.add('hidden'));
    const targetSec = document.getElementById('tab-' + tab);
    if (targetSec) targetSec.classList.remove('hidden');

    // Update active tab buttons (Desktop & Drawer)
    document.querySelectorAll('#subnavPenjualan .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('#drawerMenuPenjualan .drawer-link').forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tab);
    });

    renderPenjualanPabrik();
    populatePembelianTimbanganSelector();
  }

  // 7. Sinkronisasi Hash URL untuk Browser History
  if (updateHash) {
    const newHash = `${page}/${tab}`;
    if (window.location.hash.replace(/^#\/?/, '') !== newHash) {
      window.location.hash = newHash;
    }
  }

  // 8. Tutup Drawer Jika Terbuka
  closeDrawer();
}
window.navigateTo = navigateTo;

/** Buka Sidebar / Drawer Navigasi */
function openDrawer() {
  const drawer = document.getElementById('navDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const hamburger = document.getElementById('btnHamburger');

  if (drawer) {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
  }
  if (backdrop) {
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => backdrop.classList.add('active'));
    backdrop.setAttribute('aria-hidden', 'false');
  }
  if (hamburger) {
    hamburger.setAttribute('aria-expanded', 'true');
  }
  document.body.style.overflow = 'hidden';
}
window.openDrawer = openDrawer;

/** Tutup Sidebar / Drawer Navigasi */
function closeDrawer() {
  const drawer = document.getElementById('navDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const hamburger = document.getElementById('btnHamburger');

  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) {
    backdrop.classList.remove('active');
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  if (hamburger) {
    hamburger.setAttribute('aria-expanded', 'false');
  }
  document.body.style.overflow = '';
}
window.closeDrawer = closeDrawer;

/** Parsing rute hash URL */
function handleHashRoute() {
  const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
  if (!rawHash) {
    navigateTo('pembelian', 'dashboard', false);
    return;
  }
  const parts = rawHash.split('/');
  const page = parts[0] ? parts[0].toLowerCase() : 'pembelian';
  const tab = parts[1] ? parts[1].toLowerCase() : '';
  navigateTo(page, tab, false);
}

/** Inisialisasi Seluruh Sistem Navigasi & Routing */
function initTabs() {
  // 1. Hamburger & Drawer Event Listeners
  const btnHamburger = document.getElementById('btnHamburger');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const backdrop = document.getElementById('drawerBackdrop');

  if (btnHamburger) btnHamburger.addEventListener('click', openDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // 2. Desktop Mode Switcher (Pembelian vs Penjualan)
  const btnModeBeli = document.getElementById('btnModePembelian');
  const btnModeJual = document.getElementById('btnModePenjualan');
  if (btnModeBeli) {
    btnModeBeli.addEventListener('click', () => navigateTo('pembelian', currentPembelianTab));
  }
  if (btnModeJual) {
    btnModeJual.addEventListener('click', () => navigateTo('penjualan', currentPenjualanTab));
  }

  // 3. Drawer Mode Switcher (Mobile)
  const drawerModeBeli = document.getElementById('drawerModePembelian');
  const drawerModeJual = document.getElementById('drawerModePenjualan');
  if (drawerModeBeli) {
    drawerModeBeli.addEventListener('click', () => {
      currentPage = 'pembelian';
      navigateTo('pembelian', currentPembelianTab);
    });
  }
  if (drawerModeJual) {
    drawerModeJual.addEventListener('click', () => {
      currentPage = 'penjualan';
      navigateTo('penjualan', currentPenjualanTab);
    });
  }

  // 4. Desktop Sub-Navigation Buttons (Pembelian & Penjualan)
  document.querySelectorAll('#subnavPembelian .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('pembelian', btn.dataset.tab));
  });
  document.querySelectorAll('#subnavPenjualan .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('penjualan', btn.dataset.tab));
  });

  // 5. Drawer Navigation Links
  document.querySelectorAll('.drawer-link').forEach(link => {
    link.addEventListener('click', () => {
      const p = link.dataset.page;
      const t = link.dataset.tab;
      navigateTo(p, t);
    });
  });

  // 6. Listen ke Perubahan Hash URL (SPA History Back / Forward)
  window.addEventListener('hashchange', handleHashRoute);

  // 7. Jalankan Rute Awal Sesuai URL Saat Ini
  handleHashRoute();
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

  // Input harga dalam Rp/Kg (auto-format titik) → konversi ke Rp/Ton untuk kalkulasi
  // Rumus: hargaPerTon = hargaPerKg × 1000 (karena 1 Ton = 1000 Kg)
  const hargaPerKg = parseRupiahInput(document.getElementById('beliHarga').value);
  const hargaPerTon = hargaPerKg * 1000;

  // Estimasi total harga = tonase × harga per ton
  const estimasiHarga = tonase * hargaPerTon;

  // Update preview
  document.getElementById('previewKuintal').textContent = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('previewTonase').textContent = formatDecimal(tonase, 2) + ' Ton';
  document.getElementById('previewHargaKonversi').textContent =
    `${formatRupiah(hargaPerKg)}/Kg → ${formatRupiah(hargaPerTon)}/Ton`;
  document.getElementById('previewHarga').textContent = formatRupiah(estimasiHarga);

  // Update deposit preview (sisa deposit pengepul terpilih setelah dikurangi estimasi)
  updateDepositPreview(estimasiHarga);
}

/** Tampilkan sisa deposit setelah dikurangi estimasi harga pembelian */
function updateDepositPreview(estimasiHarga) {
  const pengepulId = document.getElementById('beliPengepul').value;
  const previewEl = document.getElementById('depositPreview');
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

  // Pasang auto-format Rupiah dengan pemisah titik
  attachRupiahAutoFormat(document.getElementById('beliHarga'), () => hitungTimbangan());
  attachRupiahAutoFormat(document.getElementById('depositJumlah'));
  attachRupiahAutoFormat(document.getElementById('editDepositJumlah'));
  attachRupiahAutoFormat(document.getElementById('editPembelianHarga'), () => hitungEditTimbangan());

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
  const nama = document.getElementById('inputNamaPengepul').value.trim();
  const daerah = document.getElementById('inputDaerah').value.trim();
  if (!nama || !daerah) return;

  const pengepulBaru = {
    id: generateId('P'),
    nama,
    daerah,
    totalDeposit: 0,
    sisaDeposit: 0,
    totalTonase: 0,
    totalNilaiTransaksi: 0,
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
  const tanggal = document.getElementById('depositTanggal').value;
  const jumlah = parseRupiahInput(document.getElementById('depositJumlah').value);
  const catatan = document.getElementById('depositCatatan').value.trim() || 'Top-up deposit';

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
    p.sisaDeposit += jumlah;
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
  const tanggal = document.getElementById('beliTanggal').value;
  const pengepulId = document.getElementById('beliPengepul').value;
  const hargaPerKg = parseRupiahInput(document.getElementById('beliHarga').value);  // input dalam Rp/Kg
  const catatan = document.getElementById('beliCatatan').value.trim() || '';

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
    p.sisaDeposit -= totalHarga;   // pemotongan otomatis
    p.totalTonase += totalKuintal; // dalam kuintal
    p.totalNilaiTransaksi += totalHarga;
  }

  saveData();
  populateSelects();

  // Reset form timbangan
  initTimbanganRow();
  document.getElementById('previewKuintal').textContent = '0 Kw';
  document.getElementById('previewTonase').textContent = '0.000 Ton';
  document.getElementById('previewHarga').textContent = 'Rp 0';
  document.getElementById('depositPreview').classList.add('hidden');

  renderAll();
  e.target.reset();
  setDefaultDates();

  showToast(
    `Pembelian ${formatDecimal(totalKuintal, 2)} Kw (${formatDecimal(totalTonase, 2)} Ton) senilai ${formatRupiah(totalHarga)} berhasil dicatat!`,
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
  renderPenjualanPabrik();
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
  let totalDeposit = 0;
  let totalBeli = 0;
  let sisaDeposit = 0;
  let totalKuintal = 0;

  appData.pengepul.forEach(p => {
    totalDeposit += p.totalDeposit;
    totalBeli += p.totalNilaiTransaksi;
    sisaDeposit += p.sisaDeposit;
    totalKuintal += p.totalTonase;  // totalTonase disimpan dalam Kuintal
  });

  const totalTon = totalKuintal / KW_PER_TON;

  document.getElementById('kpiTotalDeposit').textContent = formatRupiah(totalDeposit);
  document.getElementById('kpiTotalBeli').textContent = formatRupiah(totalBeli);
  document.getElementById('kpiSisaDeposit').textContent = formatRupiah(sisaDeposit);
  document.getElementById('kpiTotalTonase').textContent = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('kpiTotalTon').textContent = formatDecimal(totalTon, 2) + ' Ton';

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
        <td class="text-right font-medium text-green-700">${formatDecimal(tx.totalTonase, 2)} Ton</td>
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
            <span class="text-xs text-slate-400">${formatDecimal(tonaseTon, 2)} Ton</span>
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

  if (filter.nama) data = data.filter(p => p.nama.toLowerCase().includes(filter.nama.toLowerCase()));
  if (filter.daerah) data = data.filter(p => p.daerah.toLowerCase().includes(filter.daerah.toLowerCase()));

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-6">Tidak ada data</td></tr>';
    return;
  }

  tbody.innerHTML = data
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map(p => {
      const tonaseTon = p.totalTonase / KW_PER_TON;
      const badge = badgeSisaDeposit(p.sisaDeposit);
      const sisaClass = p.sisaDeposit < 0 ? 'text-red-600' : p.sisaDeposit < WARN_THRESHOLD ? 'text-amber-600' : 'text-green-700';
      return `
        <tr>
          <td class="font-semibold">${p.nama}</td>
          <td>${p.daerah}</td>
          <td class="text-right">${formatRupiah(p.totalDeposit)}</td>
          <td class="text-right">
            ${formatDecimal(p.totalTonase, 2)} Kw<br>
            <span class="text-xs text-slate-400">${formatDecimal(tonaseTon, 2)} Ton</span>
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
  if (sisa < 0) return '<span class="badge badge-danger">Kurang Bayar</span>';
  if (sisa < WARN_THRESHOLD) return '<span class="badge badge-warn">Menipis</span>';
  return '<span class="badge badge-ok">Aman</span>';
}

// ============================================================
//  16. RENDER RIWAYAT TRANSAKSI (dengan filter)
// ============================================================
function renderRiwayat(filter = {}) {
  const tbody = document.getElementById('tbodyRiwayat');
  const sumEl = document.getElementById('riwayatSummary');
  let data = [...appData.pembelianTransactions];

  if (filter.nama) data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.nama.toLowerCase().includes(filter.nama.toLowerCase());
  });
  if (filter.daerah) data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.daerah.toLowerCase().includes(filter.daerah.toLowerCase());
  });
  if (filter.dariTgl) data = data.filter(tx => tx.tanggal >= filter.dariTgl);
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
    const hargaKg = tx.hargaBeli;
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
        <td class="text-right font-semibold text-green-700">${formatDecimal(tx.totalTonase, 2)} Ton</td>
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
  const sumTonase = sumKuintal / KW_PER_TON;
  const sumHarga = data.reduce((s, tx) => s + tx.totalHarga, 0);
  sumEl.classList.remove('hidden');
  sumEl.innerHTML = `
    <strong>${data.length} transaksi ditemukan</strong> &mdash;
    Total: <strong>${formatDecimal(sumKuintal, 2)} Kw</strong>
    (${formatDecimal(sumTonase, 2)} Ton) senilai <strong>${formatRupiah(sumHarga)}</strong>
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

  // Ekspor & Pulihkan Cadangan Mandiri
  const btnExport = document.getElementById('btnExportBackup');
  if (btnExport) {
    btnExport.addEventListener('click', exportBackupData);
  }

  const inputRestore = document.getElementById('inputRestoreBackup');
  if (inputRestore) {
    inputRestore.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        restoreBackupData(e.target.files[0]);
        e.target.value = '';
      }
    });
  }
}

/** Ambil nilai filter aktif dari form riwayat */
function getActiveFilter() {
  return {
    nama: document.getElementById('filterNama').value,
    daerah: document.getElementById('filterDaerah').value,
    dariTgl: document.getElementById('filterDariTgl').value,
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

  if (filter.nama) data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.nama.toLowerCase().includes(filter.nama.toLowerCase());
  });
  if (filter.daerah) data = data.filter(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    return p && p.daerah.toLowerCase().includes(filter.daerah.toLowerCase());
  });
  if (filter.dariTgl) data = data.filter(tx => tx.tanggal >= filter.dariTgl);
  if (filter.sampaiTgl) data = data.filter(tx => tx.tanggal <= filter.sampaiTgl);
  data.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  if (data.length === 0) {
    showToast('Tidak ada data untuk dicetak!', 'warning');
    return;
  }

  // Hitung ringkasan
  const sumKuintal = data.reduce((s, tx) => s + tx.totalKuintal, 0);
  const sumTonase = sumKuintal / KW_PER_TON;
  const sumHarga = data.reduce((s, tx) => s + tx.totalHarga, 0);

  // Filter label untuk judul
  const filterLabel = [
    filter.nama ? `Pengepul: ${filter.nama}` : '',
    filter.daerah ? `Daerah: ${filter.daerah}` : '',
    filter.dariTgl ? `Dari: ${formatTanggal(filter.dariTgl)}` : '',
    filter.sampaiTgl ? `s/d: ${formatTanggal(filter.sampaiTgl)}` : '',
  ].filter(Boolean).join(' | ');

  // Baris tabel
  const baris = data.map((tx, i) => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    const hargaKg = tx.hargaBeli;
    const hargaTon = tx.hargaPerTon ?? (hargaKg < 100000 ? hargaKg * 1000 : hargaKg);
    const detail = tx.timbangan.map(v => formatDecimal(v, 2)).join(' + ');
    return `
      <tr class="${i % 2 === 0 ? 'even' : ''}">
        <td>${i + 1}</td>
        <td>${formatTanggal(tx.tanggal)}</td>
        <td>${p ? p.nama : '—'}</td>
        <td>${p ? p.daerah : '—'}</td>
        <td class="num">${formatRupiah(hargaKg)}/Kg<br><small>${formatRupiah(hargaTon)}/Ton</small></td>
        <td class="num detail">${detail}</td>
        <td class="num">${formatDecimal(tx.totalKuintal, 2)} Kw</td>
        <td class="num">${formatDecimal(tx.totalTonase, 2)} Ton</td>
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
          <td class="num bold">${formatDecimal(sumTonase, 2)} Ton</td>
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
    totDeposit += p.totalDeposit;
    totBeli += p.totalNilaiTransaksi;
    totSisa += p.sisaDeposit;
    totKuintal += p.totalTonase;
  });

  const baris = appData.pengepul
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map((p, i) => {
      const ton = p.totalTonase / KW_PER_TON;
      const status = p.sisaDeposit < 0 ? 'MINUS' : p.sisaDeposit < WARN_THRESHOLD ? 'MENIPIS' : 'AMAN';
      const statusClass = p.sisaDeposit < 0 ? 'minus' : p.sisaDeposit < WARN_THRESHOLD ? 'warn' : 'ok';
      return `
        <tr class="${i % 2 === 0 ? 'even' : ''}">
          <td>${i + 1}</td>
          <td>${p.nama}</td>
          <td>${p.daerah}</td>
          <td class="num">${formatRupiah(p.totalDeposit)}</td>
          <td class="num">${formatDecimal(p.totalTonase, 2)} Kw<br><small>${formatDecimal(ton, 2)} Ton</small></td>
          <td class="num">${formatRupiah(p.totalNilaiTransaksi)}</td>
          <td class="num bold ${statusClass}">${formatRupiah(p.sisaDeposit)}</td>
          <td class="center ${statusClass}">${status}</td>
        </tr>`;
    }).join('');

  const html = buildPrintPage(
    'Rekapitulasi Saldo & Tonase per Pengepul',
    `Dicetak: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
    `<!-- KPI ringkasan -->
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-lbl">Total Deposit</div><div class="kpi-val">${formatRupiah(totDeposit)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Nilai Beli</div><div class="kpi-val">${formatRupiah(totBeli)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Sisa Deposit</div><div class="kpi-val ${totSisa < 0 ? 'minus' : ''}">${formatRupiah(totSisa)}</div></div>
      <div class="kpi-box"><div class="kpi-lbl">Total Tonase</div><div class="kpi-val">${formatDecimal(totKuintal / KW_PER_TON, 2)} Ton</div></div>
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
          <td class="num bold">${formatDecimal(totKuintal / KW_PER_TON, 2)} Ton</td>
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
        nama: document.getElementById('filterRekapNama').value,
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
    nama: document.getElementById('filterNama').value,
    daerah: document.getElementById('filterDaerah').value,
    dariTgl: document.getElementById('filterDariTgl').value,
    sampaiTgl: document.getElementById('filterSampaiTgl').value,
  });
}

// ============================================================
//  19. CHART.JS — DASHBOARD MINI CHARTS
// ============================================================
function renderDashboardCharts() {
  const labels = appData.pengepul.map(p => p.nama);
  const tonaseData = appData.pengepul.map(p => parseFloat(formatDecimal(p.totalTonase / KW_PER_TON, 2)));
  const depositData = appData.pengepul.map(p => p.sisaDeposit);
  const colors = generateColors(appData.pengepul.length);

  renderBarChart('chartTonaseDashboard', labels, tonaseData, 'Tonase (Ton)', colors);
  renderSisaDepositChart('chartDepositDashboard', labels, depositData, colors);
}

// ============================================================
//  20. CHART.JS — TAB GRAFIK
// ============================================================
function renderGrafik() {
  const labels = appData.pengepul.map(p => p.nama);
  const tonaseData = appData.pengepul.map(p => parseFloat(formatDecimal(p.totalTonase / KW_PER_TON, 2)));
  const depositData = appData.pengepul.map(p => p.sisaDeposit);
  const colors = generateColors(appData.pengepul.length);

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
        borderColor: colors,
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
        borderColor: barColors,
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
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const [mon, yr] = k.split(' ');
      return parseInt(yr) * 100 + months.indexOf(mon);
    };
    return parseKey(a[0]) - parseKey(b[0]);
  });

  const labels = sorted.map(([k]) => k);
  const data = sorted.map(([, v]) => parseFloat(formatDecimal(v, 2)));

  charts['chartTren'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Kuintal per Bulan',
        data,
        backgroundColor: 'rgba(27, 67, 50, 0.08)',
        borderColor: '#1b4332',
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
  ['modalEditPengepul', 'modalEditDeposit', 'modalEditPembelian', 'modalKonfirmHapus'].forEach(id => {
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
  document.getElementById('editPengepulId').value = p.id;
  document.getElementById('editPengepulNama').value = p.nama;
  document.getElementById('editPengepulDaerah').value = p.daerah;
  openModal('modalEditPengepul');
}

/** Simpan perubahan edit pengepul (hanya nama & daerah) */
document.getElementById('formEditPengepul').addEventListener('submit', function (e) {
  e.preventDefault();
  const id = document.getElementById('editPengepulId').value;
  const nama = document.getElementById('editPengepulNama').value.trim();
  const daerah = document.getElementById('editPengepulDaerah').value.trim();
  if (!nama || !daerah) return;

  const p = appData.pengepul.find(x => x.id === id);
  if (!p) return;
  p.nama = nama;
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

  const adaDeposit = appData.depositTransactions.some(d => d.pengepulId === id);
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

  document.getElementById('editDepositId').value = d.id;
  document.getElementById('editDepositPengepulNama').value = p ? `${p.nama} (${p.daerah})` : '—';
  document.getElementById('editDepositTanggal').value = d.tanggal;
  document.getElementById('editDepositJumlah').value = formatNumberWithDots(d.jumlah);
  document.getElementById('editDepositCatatan').value = d.catatan || '';
  openModal('modalEditDeposit');
}

/**
 * Simpan edit deposit.
 * Reversal: kurangi totalDeposit & sisaDeposit dengan jumlah lama,
 * lalu tambahkan jumlah baru.
 */
document.getElementById('formEditDeposit').addEventListener('submit', function (e) {
  e.preventDefault();
  const id = document.getElementById('editDepositId').value;
  const tanggal = document.getElementById('editDepositTanggal').value;
  const jumlahBaru = parseRupiahInput(document.getElementById('editDepositJumlah').value);
  const catatan = document.getElementById('editDepositCatatan').value.trim();

  if (!tanggal || isNaN(jumlahBaru) || jumlahBaru <= 0) return;

  const d = appData.depositTransactions.find(x => x.id === id);
  if (!d) return;
  const p = appData.pengepul.find(x => x.id === d.pengepulId);

  const jumlahLama = d.jumlah;
  const selisih = jumlahBaru - jumlahLama;  // bisa positif atau negatif

  // Update record deposit
  d.tanggal = tanggal;
  d.jumlah = jumlahBaru;
  d.catatan = catatan;

  // Update akumulasi pengepul: sesuaikan totalDeposit dan sisaDeposit
  if (p) {
    p.totalDeposit += selisih;
    p.sisaDeposit += selisih;
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
        p.sisaDeposit -= d.jumlah;
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

  document.getElementById('editPembelianId').value = tx.id;
  document.getElementById('editPembelianTanggal').value = tx.tanggal;
  document.getElementById('editPembelianPengepulNama').value = p ? `${p.nama} (${p.daerah})` : '—';
  document.getElementById('editPembelianHarga').value = formatNumberWithDots(tx.hargaBeli);
  document.getElementById('editPembelianCatatan').value = tx.catatan || '';

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
  const tonase = totalKuintal / KW_PER_TON;
  const hargaPerKg = parseRupiahInput(document.getElementById('editPembelianHarga').value);
  const hargaPerTon = hargaPerKg * 1000;
  const total = tonase * hargaPerTon;

  document.getElementById('editPreviewKuintal').textContent = formatDecimal(totalKuintal, 2) + ' Kw';
  document.getElementById('editPreviewTonase').textContent = formatDecimal(tonase, 2) + ' Ton';
  document.getElementById('editPreviewHarga').textContent = formatRupiah(total);
}

/**
 * Simpan edit pembelian.
 * Reversal lengkap:
 * 1. Kembalikan tonase & nilai transaksi lama ke pengepul
 * 2. Kembalikan pemotongan deposit lama
 * 3. Terapkan nilai baru
 */
document.getElementById('formEditPembelian').addEventListener('submit', function (e) {
  e.preventDefault();
  const id = document.getElementById('editPembelianId').value;
  const tanggal = document.getElementById('editPembelianTanggal').value;
  const hargaPerKg = parseRupiahInput(document.getElementById('editPembelianHarga').value);
  const catatan = document.getElementById('editPembelianCatatan').value.trim();

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
    p.sisaDeposit += tx.totalHarga;        // kembalikan pemotongan deposit
    p.totalTonase -= tx.totalKuintal;       // kurangi tonase lama (dalam Kuintal)
    p.totalNilaiTransaksi -= tx.totalHarga;
  }

  // ── Hitung nilai baru ──
  const totalTonaseBaru = totalKuintalBaru / KW_PER_TON;
  const hargaPerTonBaru = hargaPerKg * 1000;
  const totalHargaBaru = totalTonaseBaru * hargaPerTonBaru;

  // ── Update record transaksi ──
  tx.tanggal = tanggal;
  tx.hargaBeli = hargaPerKg;
  tx.hargaPerTon = hargaPerTonBaru;
  tx.timbangan = timbanganBaru;
  tx.totalKuintal = totalKuintalBaru;
  tx.totalTonase = totalTonaseBaru;
  tx.totalHarga = totalHargaBaru;
  tx.catatan = catatan;

  // ── Terapkan nilai baru ke pengepul ──
  if (p) {
    p.sisaDeposit -= totalHargaBaru;
    p.totalTonase += totalKuintalBaru;
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
     (${formatDecimal(tx.totalTonase, 2)} Ton) senilai <strong>${formatRupiah(tx.totalHarga)}</strong>
     tanggal ${formatTanggal(tx.tanggal)} untuk <strong>${p ? p.nama : '—'}</strong>?<br>
     Deposit dan tonase pengepul akan dikembalikan.`,
    () => {
      // Reversal semua efek
      if (p) {
        p.sisaDeposit += tx.totalHarga;
        p.totalTonase -= tx.totalKuintal;
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

// ============================================================
//  23. MODUL PENJUALAN PABRIK (CV MANDIRI PUTRA)
// ============================================================

/** Inisialisasi Modul Penjualan Pabrik */
function initPenjualanPabrik() {
  const tglInput = document.getElementById('sjTanggal');
  if (tglInput && !tglInput.value) {
    tglInput.value = new Date().toISOString().slice(0, 10);
  }
  const modalTglInput = document.getElementById('modalTimbangTanggal');
  if (modalTglInput && !modalTglInput.value) {
    modalTglInput.value = new Date().toISOString().slice(0, 10);
  }

  generateDefaultSJNumber();

  // Tampilkan daftar timbangan pengepul yang bisa dimuat langsung ke truk
  populatePembelianTimbanganSelector();

  // Tambah baris biaya operasional awal
  addBiayaRow('Sewa Truk', '', '');

  // Tombol tambah baris biaya
  const btnAddBiaya = document.getElementById('btnAddBiayaRow');
  if (btnAddBiaya) {
    btnAddBiaya.addEventListener('click', () => addBiayaRow('', '', ''));
  }

  // Toggle input timbang pabrik
  const toggleTimbang = document.getElementById('toggleTimbangPabrik');
  const timbangFields = document.getElementById('timbangPabrikFields');
  if (toggleTimbang && timbangFields) {
    toggleTimbang.addEventListener('change', () => {
      if (toggleTimbang.checked) {
        timbangFields.classList.remove('hidden');
        updatePenjualanLivePreview();
      } else {
        timbangFields.classList.add('hidden');
      }
    });
  }

  // Setup Unit Watcher untuk Satuan Muat Truk (Kg, Kuintal, Ton)
  setupUnitWatcher(
    document.getElementById('sjBeratGudang'),
    document.getElementById('sjSatuanMuatan'),
    document.getElementById('hintBeratGudang'),
    updatePenjualanLivePreview
  );
  setupUnitWatcher(
    document.getElementById('sjBeratPabrik'),
    document.getElementById('sjSatuanPabrik'),
    document.getElementById('hintBeratPabrik'),
    updatePenjualanLivePreview
  );
  setupUnitWatcher(
    document.getElementById('modalTimbangBerat'),
    document.getElementById('modalTimbangSatuan'),
    document.getElementById('modalHintBeratPabrik'),
    updateModalTimbangLivePreview
  );

  // Pasang auto-format titik rupiah pada input harga jual & modal penjualan
  attachRupiahAutoFormat(document.getElementById('sjHargaJual'), updatePenjualanLivePreview);
  attachRupiahAutoFormat(document.getElementById('sjModalGetah'), updatePenjualanLivePreview);
  attachRupiahAutoFormat(document.getElementById('modalTimbangHarga'), updateModalTimbangLivePreview);
  attachRupiahAutoFormat(document.getElementById('modalTimbangModal'), updateModalTimbangLivePreview);

  // Tombol HPP Otomatis
  const btnHpp = document.getElementById('btnPakaiHppOtomatis');
  if (btnHpp) {
    btnHpp.addEventListener('click', () => {
      const hpp = calculateHppGudang();
      const rawGudang = parseFloat(document.getElementById('sjBeratGudang').value) || 0;
      const unitGudang = document.getElementById('sjSatuanMuatan') ? document.getElementById('sjSatuanMuatan').value : 'kg';
      const beratGudangKg = convertToKg(rawGudang, unitGudang);
      const modal = Math.round(beratGudangKg * hpp);
      document.getElementById('sjModalGetah').value = formatNumberWithDots(modal);
      showToast(`Rata-rata modal beli: ${formatRupiah(hpp)}/Kg (${formatRupiah(modal)})`, 'info');
      updatePenjualanLivePreview();
    });
  }

  const btnModalHpp = document.getElementById('btnModalPakaiHpp');
  if (btnModalHpp) {
    btnModalHpp.addEventListener('click', () => {
      const hpp = calculateHppGudang();
      const beratGudang = parseFloat(document.getElementById('modalTimbangMuatGudang').dataset.val) || 0;
      const modal = Math.round(beratGudang * hpp);
      document.getElementById('modalTimbangModal').value = modal;
      showToast(`Rata-rata modal beli: ${formatRupiah(hpp)}/Kg (${formatRupiah(modal)})`, 'info');
      updateModalTimbangLivePreview();
    });
  }

  // Form submit pengiriman baru
  const formPenjualan = document.getElementById('formPenjualanPabrik');
  if (formPenjualan) {
    formPenjualan.addEventListener('submit', (e) => {
      e.preventDefault();
      savePenjualanPabrik(false);
    });
  }

  // Simpan & Cetak SJ
  const btnSimpanCetak = document.getElementById('btnSubmitDanCetakSJ');
  if (btnSimpanCetak) {
    btnSimpanCetak.addEventListener('click', () => {
      savePenjualanPabrik(true);
    });
  }

  // Reset form
  const btnReset = document.getElementById('btnResetPenjualan');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      setTimeout(() => {
        generateDefaultSJNumber();
        const container = document.getElementById('biayaRowsContainer');
        if (container) container.innerHTML = '';
        addBiayaRow('Sewa Truk', '', '');
        updateTotalBiayaJalan();
        const toggle = document.getElementById('toggleTimbangPabrik');
        if (toggle) toggle.checked = false;
        const fields = document.getElementById('timbangPabrikFields');
        if (fields) fields.classList.add('hidden');
        populatePembelianTimbanganSelector();
      }, 50);
    });
  }

  // Filter events
  const filterNama = document.getElementById('filterPabrikNama');
  if (filterNama) filterNama.addEventListener('input', renderPenjualanPabrikTable);

  const filterStatus = document.getElementById('filterPabrikStatus');
  if (filterStatus) filterStatus.addEventListener('change', renderPenjualanPabrikTable);

  // Modal timbang form submit
  const formModalTimbang = document.getElementById('formModalTimbangPabrik');
  if (formModalTimbang) {
    formModalTimbang.addEventListener('submit', handleSaveModalTimbang);
  }

  // Modal live preview events
  ['modalTimbangBerat', 'modalTimbangHarga', 'modalTimbangModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateModalTimbangLivePreview);
  });
}

/**
 * Tampilkan daftar setoran timbangan pengepul yang bisa dimuat langsung ke truk
 * tanpa perlu transit gudang.
 */
function populatePembelianTimbanganSelector() {
  const container = document.getElementById('pembelianTimbanganSelector');
  if (!container) return;

  const list = Array.isArray(appData.pembelianTransactions) ? [...appData.pembelianTransactions] : [];
  list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));

  if (list.length === 0) {
    container.innerHTML = `
      <div style="padding: 0.75rem; color: var(--muted); font-size: 0.8rem; text-align: center;">
        Belum ada catatan timbangan pembelian getah dari pengepul.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(tx => {
    const p = appData.pengepul.find(x => x.id === tx.pengepulId);
    const namaPengepul = p ? `${p.nama} (${p.daerah})` : 'Pengepul';
    const beratKg = (tx.totalKuintal || 0) * 100; // 1 Kuintal = 100 Kg
    const tonase = (tx.totalTonase || (beratKg / 1000));
    const hargaBeli = tx.totalHarga || 0;

    return `
      <label class="timbangan-pick-item">
        <input type="checkbox" class="chk-timbangan-pick" data-id="${tx.id}" data-kg="${beratKg}" data-modal="${hargaBeli}" data-pengepul="${p ? p.nama : 'Pengepul'}" />
        <div class="timbangan-pick-info">
          <div style="font-weight: 600; color: var(--ink);">${namaPengepul}</div>
          <div style="font-size: 0.75rem; color: var(--muted);">Timbang: ${formatTanggal(tx.tanggal)} &bull; ${tx.timbangan ? tx.timbangan.length : 1} angkatan timbang</div>
        </div>
        <div class="timbangan-pick-qty">
          <div>${formatDecimal(beratKg, 1)} Kg <small style="font-weight: normal; color: var(--muted);">(${formatDecimal(tonase, 2)} Ton)</small></div>
          <div style="font-size: 0.75rem; color: var(--accent);">Modal: ${formatRupiah(hargaBeli)}</div>
        </div>
      </label>
    `;
  }).join('');

  // Pasang event listener saat checkbox dicentang/dilepas
  const checkboxes = container.querySelectorAll('.chk-timbangan-pick');
  checkboxes.forEach(chk => {
    chk.addEventListener('change', updateTimbanganPickerSummary);
  });

  updateTimbanganPickerSummary();
}

/**
 * Hitung total akumulasi getah dari beberapa pengepul yang dimuat langsung ke 1 truk
 */
function updateTimbanganPickerSummary() {
  const container = document.getElementById('pembelianTimbanganSelector');
  if (!container) return;

  const checked = container.querySelectorAll('.chk-timbangan-pick:checked');
  const summaryBox = document.getElementById('pembelianSelectedSummary');

  if (checked.length === 0) {
    if (summaryBox) {
      summaryBox.style.display = 'none';
      summaryBox.innerHTML = '';
    }
    return;
  }

  let totalKg = 0;
  let totalModal = 0;
  const namaPengepulSet = new Set();

  checked.forEach(chk => {
    totalKg += parseFloat(chk.dataset.kg) || 0;
    totalModal += parseFloat(chk.dataset.modal) || 0;
    if (chk.dataset.pengepul) namaPengepulSet.add(chk.dataset.pengepul);
  });

  const totalTon = totalKg / 1000;
  const avgPerKg = totalKg > 0 ? Math.round(totalModal / totalKg) : 0;

  // Otomatis isi kolom berat muat sesuai satuan & modal getah (HPP) format titik
  const inputBerat = document.getElementById('sjBeratGudang');
  const selectSatuan = document.getElementById('sjSatuanMuatan');
  const hintBerat = document.getElementById('hintBeratGudang');
  const unit = selectSatuan ? selectSatuan.value : 'kg';

  if (inputBerat) {
    const converted = convertFromKg(totalKg, unit);
    inputBerat.value = Math.round(converted * 1000) / 1000;
    updateWeightHint(inputBerat, selectSatuan, hintBerat);
  }

  const inputModal = document.getElementById('sjModalGetah');
  if (inputModal) inputModal.value = formatNumberWithDots(totalModal);

  const inputCatatan = document.getElementById('sjCatatanMuatan');
  if (inputCatatan && (!inputCatatan.value || inputCatatan.value.startsWith('Gabungan:'))) {
    inputCatatan.value = `Gabungan: ${Array.from(namaPengepulSet).join(', ')}`;
  }

  if (summaryBox) {
    summaryBox.style.display = 'block';
    const kw = totalKg / 100;
    summaryBox.innerHTML = `
      <div><strong>Terpilih ${checked.length} setoran timbangan (${namaPengepulSet.size} pengepul):</strong></div>
      <div style="margin-top: 2px;">
        Total Muat: <strong>${formatDecimal(totalKg, 0)} Kg (${formatDecimal(kw, 2)} Kw / ${formatDecimal(totalTon, 2)} Ton)</strong> &bull;
        Total Modal Beli (HPP): <strong>${formatRupiah(totalModal)}</strong>
        <span style="color: #0369a1;">(Rata-rata: ${formatRupiah(avgPerKg)}/Kg)</span>
      </div>
    `;
  }

  updatePenjualanLivePreview();
}

/** Generate nomor surat jalan default */
function generateDefaultSJNumber() {
  const sjInput = document.getElementById('sjNomor');
  if (!sjInput) return;
  const now = new Date();
  const yyyymm = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0');
  const count = (appData.penjualanPabrik ? appData.penjualanPabrik.length : 0) + 1;
  sjInput.value = `SJ/${yyyymm}/${count.toString().padStart(3, '0')}`;
}

/** Hitung HPP rata-rata beli gudang saat ini dari transaksi pembelian */
function calculateHppGudang() {
  if (!appData.pembelianTransactions || appData.pembelianTransactions.length === 0) {
    return 10000;
  }
  let totalUang = 0;
  let totalKuintal = 0;
  appData.pembelianTransactions.forEach(tx => {
    totalUang += tx.totalHarga || 0;
    totalKuintal += tx.totalKuintal || 0;
  });
  const totalKg = totalKuintal * 100;
  if (totalKg <= 0) return 10000;
  return Math.round(totalUang / totalKg);
}

/** Tambah baris biaya operasional dinamis */
function addBiayaRow(jenis = '', nominal = '', catatan = '') {
  const container = document.getElementById('biayaRowsContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'biaya-item-row';
  const formattedNominal = nominal ? formatNumberWithDots(nominal) : '';
  row.innerHTML = `
    <input type="text" class="form-input biaya-jenis" placeholder="Jenis Biaya (Sewa Truk, Uang Jalan, Buruh)" value="${jenis}" />
    <input type="text" inputmode="numeric" class="form-input biaya-nominal rupiah-input" placeholder="Nominal (Rp)" value="${formattedNominal}" />
    <input type="text" class="form-input biaya-catatan" placeholder="Catatan (opsional)" value="${catatan}" />
    <button type="button" class="btn-remove-biaya" title="Hapus Biaya">&times;</button>
  `;

  const btnRemove = row.querySelector('.btn-remove-biaya');
  btnRemove.addEventListener('click', () => {
    row.remove();
    updateTotalBiayaJalan();
    updatePenjualanLivePreview();
  });

  const nominalInput = row.querySelector('.biaya-nominal');
  attachRupiahAutoFormat(nominalInput, () => {
    updateTotalBiayaJalan();
    updatePenjualanLivePreview();
  });

  container.appendChild(row);
  updateTotalBiayaJalan();
}

/** Hitung dan update total biaya jalan */
function updateTotalBiayaJalan() {
  let total = 0;
  const rows = document.querySelectorAll('#biayaRowsContainer .biaya-nominal');
  rows.forEach(inp => {
    const val = parseRupiahInput(inp.value);
    total += val;
  });
  const label = document.getElementById('labelTotalBiayaJalan');
  if (label) label.textContent = formatRupiah(total);
  return total;
}

/** Kumpulkan array biaya operasional dari input */
function collectBiayaOperasional() {
  const list = [];
  const rows = document.querySelectorAll('#biayaRowsContainer .biaya-item-row');
  rows.forEach(r => {
    const jenis = r.querySelector('.biaya-jenis').value.trim();
    const nominal = parseFloat(r.querySelector('.biaya-nominal').value) || 0;
    const catatan = r.querySelector('.biaya-catatan').value.trim();
    if (jenis || nominal > 0) {
      list.push({ jenis: jenis || 'Biaya Jalan', nominal, catatan });
    }
  });
  return list;
}

/** Update Live Preview Penjualan di Form */
function updatePenjualanLivePreview() {
  const toggle = document.getElementById('toggleTimbangPabrik');
  if (!toggle || !toggle.checked) return;

  const unitGudang = document.getElementById('sjSatuanMuatan') ? document.getElementById('sjSatuanMuatan').value : 'kg';
  const unitPabrik = document.getElementById('sjSatuanPabrik') ? document.getElementById('sjSatuanPabrik').value : 'kg';
  const rawBeratGudang = parseFloat(document.getElementById('sjBeratGudang').value) || 0;
  const rawBeratPabrik = parseFloat(document.getElementById('sjBeratPabrik').value) || 0;
  const beratGudang = convertToKg(rawBeratGudang, unitGudang);
  const beratPabrik = convertToKg(rawBeratPabrik, unitPabrik);
  const hargaJual = parseRupiahInput(document.getElementById('sjHargaJual').value);
  const modalKaret = parseRupiahInput(document.getElementById('sjModalGetah').value);
  const totalBiaya = updateTotalBiayaJalan();

  const susutKg = beratGudang - beratPabrik;
  const susutPersen = beratGudang > 0 ? (susutKg / beratGudang) * 100 : 0;
  const omzet = beratPabrik * hargaJual;
  const labaBersih = omzet - totalBiaya - modalKaret;

  const elSusut = document.getElementById('previewSusut');
  if (elSusut) {
    elSusut.textContent = `${formatDecimal(susutKg, 1)} Kg (${formatDecimal(susutPersen, 2)}%)`;
    elSusut.className = 'timbangan-summary-val ' + (susutKg > 0 ? (susutPersen > 3 ? 'text-danger' : 'text-warning') : 'text-accent');
  }

  const elOmzet = document.getElementById('previewOmzetPabrik');
  if (elOmzet) elOmzet.textContent = formatRupiah(omzet);

  const elBiaya = document.getElementById('previewBiayaJalan');
  if (elBiaya) elBiaya.textContent = formatRupiah(totalBiaya);

  const elLaba = document.getElementById('previewLabaBersih');
  if (elLaba) {
    elLaba.textContent = formatRupiah(labaBersih);
    elLaba.className = 'timbangan-summary-val ' + (labaBersih < 0 ? 'text-danger' : 'text-accent');
  }
}

/** Simpan transaksi pengiriman baru */
function savePenjualanPabrik(cetakSetelahSimpan = false) {
  const noSuratJalan = document.getElementById('sjNomor').value.trim();
  const tanggal = document.getElementById('sjTanggal').value;
  const namaPabrik = document.getElementById('sjPabrik').value.trim();
  const noPolisi = document.getElementById('sjNoPolisi').value.trim();
  const namaSopir = document.getElementById('sjNamaSopir').value.trim();
  const unitGudang = document.getElementById('sjSatuanMuatan') ? document.getElementById('sjSatuanMuatan').value : 'kg';
  const rawGudang = parseFloat(document.getElementById('sjBeratGudang').value) || 0;
  const beratGudang = convertToKg(rawGudang, unitGudang);
  const catatanMuatan = document.getElementById('sjCatatanMuatan').value.trim();

  if (!noSuratJalan || !tanggal || !namaPabrik || !noPolisi || !namaSopir || beratGudang <= 0) {
    showToast('Lengkapi data surat jalan dan berat muat gudang!', 'error');
    return;
  }

  const biayaOperasional = collectBiayaOperasional();
  const totalBiaya = biayaOperasional.reduce((s, b) => s + b.nominal, 0);

  const isTimbangSelesai = document.getElementById('toggleTimbangPabrik').checked;
  let beratPabrik = 0, hargaJual = 0, modalKaret = 0, susutKg = 0, susutPersen = 0, totalPendapatan = 0, labaBersih = 0, status = 'Dalam Perjalanan';

  if (isTimbangSelesai) {
    const unitPabrik = document.getElementById('sjSatuanPabrik') ? document.getElementById('sjSatuanPabrik').value : 'kg';
    const rawPabrik = parseFloat(document.getElementById('sjBeratPabrik').value) || 0;
    beratPabrik = convertToKg(rawPabrik, unitPabrik);
    hargaJual = parseRupiahInput(document.getElementById('sjHargaJual').value);
    modalKaret = parseRupiahInput(document.getElementById('sjModalGetah').value);
    susutKg = beratGudang - beratPabrik;
    susutPersen = beratGudang > 0 ? (susutKg / beratGudang) * 100 : 0;
    totalPendapatan = beratPabrik * hargaJual;
    labaBersih = totalPendapatan - totalBiaya - modalKaret;
    status = 'Selesai';
  }

  const newTx = {
    id: generateId('SJ'),
    noSuratJalan,
    tanggal,
    namaPabrik,
    noPolisi,
    namaSopir,
    beratGudang,
    catatanMuatan,
    biayaOperasional,
    totalBiaya,
    beratPabrik,
    hargaJual,
    modalKaret,
    susutKg,
    susutPersen,
    totalPendapatan,
    labaBersih,
    status,
    createdAt: new Date().toISOString()
  };

  if (!Array.isArray(appData.penjualanPabrik)) {
    appData.penjualanPabrik = [];
  }
  appData.penjualanPabrik.push(newTx);

  saveData();
  renderPenjualanPabrik();

  showToast(`Surat Jalan ${noSuratJalan} berhasil disimpan!`, 'success');

  if (cetakSetelahSimpan) {
    printSuratJalan(newTx.id);
  } else {
    navigateTo('penjualan', 'penjualan-tabel');
  }

  // Reset form
  document.getElementById('formPenjualanPabrik').reset();
  document.getElementById('sjTanggal').value = new Date().toISOString().slice(0, 10);
  generateDefaultSJNumber();
  const container = document.getElementById('biayaRowsContainer');
  if (container) container.innerHTML = '';
  addBiayaRow('Sewa Truk', '', '');
  updateTotalBiayaJalan();
  document.getElementById('toggleTimbangPabrik').checked = false;
  document.getElementById('timbangPabrikFields').classList.add('hidden');
  populatePembelianTimbanganSelector();
}

/** Render seluruh modul penjualan pabrik (KPI & Tabel) */
function renderPenjualanPabrik() {
  const data = Array.isArray(appData.penjualanPabrik) ? appData.penjualanPabrik : [];

  let totalPengiriman = data.length;
  let totalKgPabrik = 0;
  let totalOmzet = 0;
  let totalBiayaJalan = 0;
  let totalLabaBersih = 0;

  data.forEach(sj => {
    if (sj.status === 'Selesai') {
      totalKgPabrik += (sj.beratPabrik || 0);
      totalOmzet += (sj.totalPendapatan || 0);
      totalLabaBersih += (sj.labaBersih || 0);
    }
    totalBiayaJalan += (sj.totalBiaya || 0);
  });

  const totalTonPabrik = totalKgPabrik / 1000;

  const elPengiriman = document.getElementById('kpiTotalPengiriman');
  if (elPengiriman) elPengiriman.textContent = `${totalPengiriman} Truk`;

  const elTonase = document.getElementById('kpiTotalTonasePabrik');
  if (elTonase) elTonase.textContent = `${formatDecimal(totalTonPabrik, 2)} Ton`;

  const elKg = document.getElementById('kpiTotalKgPabrik');
  if (elKg) elKg.textContent = `${formatDecimal(totalKgPabrik, 1)} Kg netto pabrik`;

  const elOmzet = document.getElementById('kpiTotalOmzetPabrik');
  if (elOmzet) elOmzet.textContent = formatRupiah(totalOmzet);

  const elBiaya = document.getElementById('kpiTotalBiayaJalan');
  if (elBiaya) elBiaya.textContent = formatRupiah(totalBiayaJalan);

  const elLaba = document.getElementById('kpiTotalLabaBersih');
  if (elLaba) {
    elLaba.textContent = formatRupiah(totalLabaBersih);
    elLaba.className = 'ledger-value ' + (totalLabaBersih < 0 ? 'text-danger' : 'text-accent');
  }

  renderPenjualanPabrikTable();
  populatePembelianTimbanganSelector();
}

/** Render tabel riwayat penjualan pabrik dengan filter */
function renderPenjualanPabrikTable() {
  const tbody = document.getElementById('tbodyPenjualanPabrik');
  if (!tbody) return;

  let data = Array.isArray(appData.penjualanPabrik) ? [...appData.penjualanPabrik] : [];

  const filterNama = document.getElementById('filterPabrikNama')?.value.toLowerCase().trim() || '';
  const filterStatus = document.getElementById('filterPabrikStatus')?.value || '';

  if (filterNama) {
    data = data.filter(sj =>
      sj.noSuratJalan.toLowerCase().includes(filterNama) ||
      sj.namaPabrik.toLowerCase().includes(filterNama) ||
      sj.namaSopir.toLowerCase().includes(filterNama) ||
      sj.noPolisi.toLowerCase().includes(filterNama)
    );
  }

  if (filterStatus) {
    data = data.filter(sj => sj.status === filterStatus);
  }

  // Urutkan dari tanggal terbaru
  data.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" class="empty-state">Belum ada catatan pengiriman surat jalan ke pabrik.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(sj => {
    const isSelesai = sj.status === 'Selesai';
    const statusBadge = isSelesai
      ? `<span class="badge badge-ok">Selesai</span>`
      : `<span class="badge badge-warn">Dalam Perjalanan</span>`;

    const beratPabrikText = isSelesai ? `${formatDecimal(sj.beratPabrik, 1)} Kg` : '<span class="text-muted">Menunggu</span>';
    const susutText = isSelesai ? `${formatDecimal(sj.susutKg, 1)} Kg (${formatDecimal(sj.susutPersen, 2)}%)` : '<span class="text-muted">—</span>';
    const omzetText = isSelesai ? formatRupiah(sj.totalPendapatan) : '<span class="text-muted">—</span>';
    const labaText = isSelesai ? `<span class="${sj.labaBersih < 0 ? 'text-danger font-semibold' : 'text-accent font-semibold'}">${formatRupiah(sj.labaBersih)}</span>` : '<span class="text-muted">—</span>';

    return `
      <tr>
        <td class="font-semibold">${sj.noSuratJalan}</td>
        <td>${formatTanggal(sj.tanggal)}</td>
        <td><strong>${sj.namaPabrik}</strong></td>
        <td>${sj.noPolisi} &bull; ${sj.namaSopir}</td>
        <td class="text-right">${formatDecimal(sj.beratGudang, 1)} Kg</td>
        <td class="text-right">${beratPabrikText}</td>
        <td class="text-right">${susutText}</td>
        <td class="text-right font-medium">${omzetText}</td>
        <td class="text-right text-warning">${formatRupiah(sj.totalBiaya || 0)}</td>
        <td class="text-right">${labaText}</td>
        <td>${statusBadge}</td>
        <td class="text-center" style="white-space: nowrap;">
          ${!isSelesai ? `<button type="button" class="btn-action" onclick="openModalTimbangPabrik('${sj.id}')" title="Input Hasil Timbang Pabrik" style="margin-right: 4px; background: var(--warn-bg); color: var(--warn-text);">Timbang</button>` : ''}
          <button type="button" class="btn-action" onclick="printSuratJalan('${sj.id}')" title="Cetak Surat Jalan Resmi CV Mandiri Putra" style="margin-right: 4px;">Cetak</button>
          <button type="button" class="btn-action" onclick="openRincianPenjualan('${sj.id}')" title="Lihat Rincian Pengiriman" style="margin-right: 4px;">Rincian</button>
          <button type="button" class="btn-action text-danger" onclick="konfirmHapusPenjualan('${sj.id}')" title="Hapus Pengiriman">&times;</button>
        </td>
      </tr>
    `;
  }).join('');
}

/** Cetak Surat Jalan Resmi CV Mandiri Putra (Bebas Biaya Internal) */
function printSuratJalan(id) {
  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === id) : null;
  if (!sj) {
    showToast('Data surat jalan tidak ditemukan!', 'error');
    return;
  }

  const tonase = sj.beratGudang / 1000;

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Surat Jalan ${sj.noSuratJalan} – CV Mandiri Putra</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111827; padding: 20px; }
  .sj-print-container { width: 100%; max-width: 800px; margin: 0 auto; }
  .sj-kop { display: flex; align-items: center; gap: 18px; padding-bottom: 12px; border-bottom: 3px double #111827; margin-bottom: 16px; }
  .sj-logo { width: 85px; height: 85px; object-fit: contain; }
  .sj-kop-text { flex: 1; }
  .sj-company-name { font-size: 22px; font-weight: 800; letter-spacing: 0.05em; color: #111827; margin-bottom: 3px; }
  .sj-company-desc { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 3px; }
  .sj-company-addr { font-size: 11px; color: #6b7280; }
  .sj-title-box { text-align: center; margin-bottom: 18px; }
  .sj-doc-title { font-size: 15px; font-weight: 800; text-decoration: underline; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .sj-doc-no { font-size: 12px; font-weight: 700; color: #374151; }
  .sj-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; font-size: 12px; line-height: 1.6; }
  .sj-meta-box { background: #f9fafb; border: 1px solid #d1d5db; border-radius: 4px; padding: 10px 14px; }
  table.sj-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12px; }
  table.sj-table th, table.sj-table td { border: 1px solid #374151; padding: 8px 10px; }
  table.sj-table thead tr { background: #f3f4f6; color: #111827; font-weight: 700; }
  .center { text-align: center; }
  .num { text-align: right; }
  .bold { font-weight: 700; }
  .sj-notes { font-size: 11px; color: #4b5563; line-height: 1.5; margin: 16px 0; border: 1px solid #e5e7eb; padding: 8px 12px; border-radius: 4px; background: #fafafa; }
  .sj-signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 30px; text-align: center; font-size: 12px; }
  .sj-sig-box { display: flex; flex-direction: column; justify-content: space-between; min-height: 110px; }
  .sj-sig-line { border-bottom: 1px solid #111827; margin: 0 auto; width: 80%; }
  @media print {
    body { padding: 0; }
    @page { margin: 12mm 10mm; size: A4; }
  }
</style>
</head>
<body>
  <div class="sj-print-container">
    <div class="sj-kop">
      <img src="logo.png" class="sj-logo" alt="Logo CV Mandiri Putra" />
      <div class="sj-kop-text">
        <h1 class="sj-company-name">CV MANDIRI PUTRA</h1>
        <p class="sj-company-desc">Perdagangan Komoditas Karet Alam </p>
        <p class="sj-company-addr">Kecamatan Talang Ubi, Kab. Penukal Abab Lematang Ilir (PALI), Sumatera Selatan</p>
      </div>
    </div>

    <div class="sj-title-box">
      <h2 class="sj-doc-title">SURAT JALAN PENGIRIMAN GETAH KARET</h2>
      <p class="sj-doc-no">Nomor: ${sj.noSuratJalan}</p>
    </div>

    <div class="sj-meta-grid">
      <div class="sj-meta-box">
        <div><strong>Tanggal Kirim:</strong> ${formatTanggal(sj.tanggal)}</div>
        <div><strong>Pabrik Tujuan:</strong> ${sj.namaPabrik}</div>
      </div>
      <div class="sj-meta-box">
        <div><strong>No. Polisi Truk:</strong> ${sj.noPolisi}</div>
        <div><strong>Nama Pengemudi:</strong> ${sj.namaSopir}</div>
      </div>
    </div>

    <table class="sj-table">
      <thead>
        <tr>
          <th style="width: 40px;" class="center">No</th>
          <th>Nama Komoditas / Barang</th>
          <th>Bentuk / Kondisi Fisik</th>
          <th style="width: 220px;" class="num">Berat Muat Gudang</th>
          <th>Keterangan</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">1</td>
          <td><strong>Getah Karet Alam</strong></td>
          <td>Slab / Lum Mangkok Kebun</td>
          <td class="num bold">
            ${formatDecimal(sj.beratGudang, 2)} Kg<br>
            <span style="font-size: 11px; font-weight: normal; color: #555;">(${formatDecimal(tonase, 2)} Ton)</span>
          </td>
          <td>${sj.catatanMuatan || 'Muatan ditimbang basah di gudang pengirim'}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="bold">TOTAL TIMBANG MUAT GUDANG</td>
          <td class="num bold">${formatDecimal(sj.beratGudang, 2)} Kg</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div class="sj-notes">
      <strong>Ketentuan &amp; Instruksi Pengiriman:</strong><br>
      1. Komoditas getah karet di atas telah diperiksa dan ditimbang.<br>
      2. Pengemudi wajib mengantarkan muatan langsung ke pabrik tujuan serta menjaga keamanan muatan selama perjalanan.<br>
      3. Surat jalan ini berfungsi sah sebagai dokumen resmi pengantar komoditas dari pengirim ke pabrik penerima.
    </div>

    <div class="sj-signatures">
      <div class="sj-sig-box">
        <span>Yang Menyerahkan,<br><strong>CV Mandiri Putra</strong></span>
        <div class="sj-sig-line"></div>
        <span>( .......... )</span>
      </div>
      <div class="sj-sig-box">
        <span>Pengemudi / Sopir,<br><strong>Armada Pengangkut</strong></span>
        <div class="sj-sig-line"></div>
        <span>( ${sj.namaSopir} )</span>
      </div>
      <div class="sj-sig-box">
        <span>Diterima Oleh,<br><strong>Pabrik Pengolahan</strong></span>
        <div class="sj-sig-line"></div>
        <span>( ........... )</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  doPrint(html);
}

/** Buka modal input timbang pabrik */
function openModalTimbangPabrik(id) {
  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === id) : null;
  if (!sj) return;

  document.getElementById('modalTimbangId').value = sj.id;
  document.getElementById('modalTimbangNoSJ').textContent = sj.noSuratJalan;
  document.getElementById('modalTimbangPabrik').textContent = sj.namaPabrik;
  const elMuat = document.getElementById('modalTimbangMuatGudang');
  elMuat.textContent = `${formatDecimal(sj.beratGudang, 1)} Kg (${formatDecimal(sj.beratGudang / 1000, 2)} Ton)`;
  elMuat.dataset.val = sj.beratGudang;

  document.getElementById('modalTimbangTanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('modalTimbangBerat').value = sj.beratPabrik > 0 ? sj.beratPabrik : '';
  const modalSat = document.getElementById('modalTimbangSatuan');
  if (modalSat) modalSat.value = 'kg';
  updateWeightHint(document.getElementById('modalTimbangBerat'), modalSat, document.getElementById('modalHintBeratPabrik'));
  document.getElementById('modalTimbangHarga').value = sj.hargaJual > 0 ? formatNumberWithDots(sj.hargaJual) : '';
  document.getElementById('modalTimbangModal').value = sj.modalKaret > 0 ? formatNumberWithDots(sj.modalKaret) : '';

  updateModalTimbangLivePreview();
  openModal('modalInputTimbangPabrik');
}

/** Update Live Preview di modal timbang pabrik */
function updateModalTimbangLivePreview() {
  const sjId = document.getElementById('modalTimbangId').value;
  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === sjId) : null;
  if (!sj) return;

  const beratGudang = sj.beratGudang || 0;
  const unitPabrik = document.getElementById('modalTimbangSatuan') ? document.getElementById('modalTimbangSatuan').value : 'kg';
  const rawPabrik = parseFloat(document.getElementById('modalTimbangBerat').value) || 0;
  const beratPabrik = convertToKg(rawPabrik, unitPabrik);
  const hargaJual = parseRupiahInput(document.getElementById('modalTimbangHarga').value);
  const modalKaret = parseRupiahInput(document.getElementById('modalTimbangModal').value);
  const totalBiaya = sj.totalBiaya || 0;

  const susutKg = beratGudang - beratPabrik;
  const susutPersen = beratGudang > 0 ? (susutKg / beratGudang) * 100 : 0;
  const omzet = beratPabrik * hargaJual;
  const labaBersih = omzet - totalBiaya - modalKaret;

  const elSusut = document.getElementById('modalPreviewSusut');
  if (elSusut) {
    elSusut.textContent = `${formatDecimal(susutKg, 1)} Kg (${formatDecimal(susutPersen, 2)}%)`;
    elSusut.className = 'timbangan-summary-val ' + (susutKg > 0 ? (susutPersen > 3 ? 'text-danger' : 'text-warning') : 'text-accent');
  }

  const elOmzet = document.getElementById('modalPreviewOmzet');
  if (elOmzet) elOmzet.textContent = formatRupiah(omzet);

  const elBiaya = document.getElementById('modalPreviewBiayaJalan');
  if (elBiaya) elBiaya.textContent = formatRupiah(totalBiaya);

  const elLaba = document.getElementById('modalPreviewLabaBersih');
  if (elLaba) {
    elLaba.textContent = formatRupiah(labaBersih);
    elLaba.className = 'timbangan-summary-val ' + (labaBersih < 0 ? 'text-danger' : 'text-accent');
  }
}

/** Simpan hasil timbang pabrik dari modal */
function handleSaveModalTimbang(e) {
  e.preventDefault();
  const sjId = document.getElementById('modalTimbangId').value;
  const tglTimbang = document.getElementById('modalTimbangTanggal').value;
  const unitPabrik = document.getElementById('modalTimbangSatuan') ? document.getElementById('modalTimbangSatuan').value : 'kg';
  const rawPabrik = parseFloat(document.getElementById('modalTimbangBerat').value) || 0;
  const beratPabrik = convertToKg(rawPabrik, unitPabrik);
  const hargaJual = parseRupiahInput(document.getElementById('modalTimbangHarga').value);
  const modalKaret = parseRupiahInput(document.getElementById('modalTimbangModal').value);

  if (!sjId || beratPabrik <= 0 || hargaJual <= 0) {
    showToast('Harap isi berat bersih pabrik dan harga jual!', 'error');
    return;
  }

  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === sjId) : null;
  if (!sj) return;

  sj.tglTimbangPabrik = tglTimbang;
  sj.beratPabrik = beratPabrik;
  sj.hargaJual = hargaJual;
  sj.modalKaret = modalKaret;
  sj.susutKg = sj.beratGudang - beratPabrik;
  sj.susutPersen = sj.beratGudang > 0 ? (sj.susutKg / sj.beratGudang) * 100 : 0;
  sj.totalPendapatan = beratPabrik * hargaJual;
  sj.labaBersih = sj.totalPendapatan - (sj.totalBiaya || 0) - modalKaret;
  sj.status = 'Selesai';

  saveData();
  renderPenjualanPabrik();
  closeModal('modalInputTimbangPabrik');
  showToast(`Hasil timbang pabrik ${sj.noSuratJalan} berhasil diperbarui!`, 'success');
}

/** Buka modal rincian pengiriman lengkap */
function openRincianPenjualan(id) {
  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === id) : null;
  if (!sj) return;

  const body = document.getElementById('rincianPenjualanBody');
  if (!body) return;

  const isSelesai = sj.status === 'Selesai';

  let biayaHtml = '';
  if (Array.isArray(sj.biayaOperasional) && sj.biayaOperasional.length > 0) {
    biayaHtml = `
      <table class="data-table" style="margin-top: 0.5rem; font-size: 0.85rem;">
        <thead>
          <tr>
            <th>Jenis Biaya</th>
            <th class="text-right">Nominal</th>
            <th>Catatan</th>
          </tr>
        </thead>
        <tbody>
          ${sj.biayaOperasional.map(b => `
            <tr>
              <td><strong>${b.jenis}</strong></td>
              <td class="text-right">${formatRupiah(b.nominal)}</td>
              <td>${b.catatan || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td class="bold">TOTAL BIAYA JALAN</td>
            <td class="text-right bold text-warning">${formatRupiah(sj.totalBiaya || 0)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    `;
  } else {
    biayaHtml = '<p class="text-muted" style="margin-top: 0.5rem;">Tidak ada catatan biaya jalan khusus.</p>';
  }

  body.innerHTML = `
    <div style="background: var(--surface-secondary); padding: 0.75rem 1rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--ink);">${sj.noSuratJalan}</h3>
        <span class="badge ${isSelesai ? 'badge-ok' : 'badge-warn'}">${sj.status}</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.85rem;">
        <div>Tanggal Kirim: <strong>${formatTanggal(sj.tanggal)}</strong></div>
        <div>Pabrik Tujuan: <strong>${sj.namaPabrik}</strong></div>
        <div>Armada Truk: <strong>${sj.noPolisi}</strong></div>
        <div>Nama Sopir: <strong>${sj.namaSopir}</strong></div>
        <div>Muat Gudang: <strong>${formatDecimal(sj.beratGudang, 1)} Kg (${formatDecimal(sj.beratGudang / 1000, 2)} Ton)</strong></div>
        <div>Catatan Muatan: <strong>${sj.catatanMuatan || 'Karet Alam'}</strong></div>
      </div>
    </div>

    <div style="margin-bottom: 1rem;">
      <h4 style="margin: 0 0 0.25rem 0; font-size: 0.95rem; font-weight: 700;">Realisasi Penjualan Pabrik</h4>
      ${isSelesai ? `
        <div class="timbangan-summary" style="margin-top: 0.5rem;">
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Berat Bersih Pabrik:</span>
            <span class="timbangan-summary-val">${formatDecimal(sj.beratPabrik, 1)} Kg (${formatDecimal(sj.beratPabrik / 1000, 2)} Ton)</span>
          </div>
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Susut Muat Jalan:</span>
            <span class="timbangan-summary-val">${formatDecimal(sj.susutKg, 1)} Kg (${formatDecimal(sj.susutPersen, 2)}%)</span>
          </div>
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Harga Jual Pabrik:</span>
            <span class="timbangan-summary-val">${formatRupiah(sj.hargaJual)} / Kg</span>
          </div>
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Total Omzet Bruto:</span>
            <span class="timbangan-summary-val font-semibold">${formatRupiah(sj.totalPendapatan)}</span>
          </div>
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Estimasi Modal Getah (HPP):</span>
            <span class="timbangan-summary-val">${formatRupiah(sj.modalKaret || 0)}</span>
          </div>
          <div class="timbangan-summary-row">
            <span class="timbangan-summary-label">Total Biaya Jalan:</span>
            <span class="timbangan-summary-val text-warning">${formatRupiah(sj.totalBiaya || 0)}</span>
          </div>
          <div class="timbangan-summary-row total-row">
            <span class="timbangan-summary-label">Laba Bersih Transaksi:</span>
            <span class="timbangan-summary-val ${sj.labaBersih < 0 ? 'text-danger' : 'text-accent'} font-bold">${formatRupiah(sj.labaBersih)}</span>
          </div>
        </div>
      ` : `
        <div style="background: #fffbeb; border: 1px solid #fef3c7; color: #92400e; padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.85rem;">
          Truk saat ini masih dalam perjalanan ke pabrik. Silakan tekan tombol <strong>Input Hasil Timbang</strong> setelah sopir kembali membawa nota pabrik.
        </div>
      `}
    </div>

    <div>
      <h4 style="margin: 0 0 0.25rem 0; font-size: 0.95rem; font-weight: 700;">Rincian Biaya Operasional Jalan (Internal)</h4>
      ${biayaHtml}
    </div>
  `;

  const btnCetak = document.getElementById('btnModalCetakSJ');
  if (btnCetak) {
    btnCetak.onclick = () => {
      printSuratJalan(sj.id);
    };
  }

  openModal('modalRincianPenjualan');
}

/** Konfirmasi hapus transaksi pengiriman */
function konfirmHapusPenjualan(id) {
  const sj = appData.penjualanPabrik ? appData.penjualanPabrik.find(x => x.id === id) : null;
  if (!sj) return;

  tampilKonfirmHapus(
    `Apakah Anda yakin ingin menghapus data pengiriman Surat Jalan <strong>${sj.noSuratJalan}</strong> ke ${sj.namaPabrik}?`,
    () => {
      appData.penjualanPabrik = appData.penjualanPabrik.filter(x => x.id !== id);
      saveData();
      renderPenjualanPabrik();
      showToast('Data pengiriman pabrik berhasil dihapus.', 'success');
    }
  );
}
