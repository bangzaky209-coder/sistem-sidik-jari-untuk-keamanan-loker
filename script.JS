/* =====================================================
   SMART LOCKER DASHBOARD
   - Mode SIMULASI : meniru program Arduino sepenuhnya di browser
   - Mode ARDUINO  : terhubung ke board asli lewat Web Serial (9600 baud)
   Perintah ke Arduino: REG:<id>, 1, LOCK, UNLOCK_ADMIN
   ===================================================== */

const POS_TERKUNCI = 90;
const POS_TERBUKA = 0;

const JARI = [
  { key: 'A', label: 'Jari A (Telunjuk Kanan)' },
  { key: 'B', label: 'Jari B (Jempol Kanan)' },
  { key: 'C', label: 'Jari C (Telunjuk Kiri)' },
  { key: 'D', label: 'Jari D (Jempol Kiri)' },
  { key: 'E', label: 'Jari E (Jari Tengah)' },
];

// ---------- STATE ----------
let mode = 'sim';               // 'sim' | 'arduino'
let statusTerbuka = false;
let busy = false;               // (simulasi) pendaftaran / verifikasi berjalan
let jariDipilih = 'A';
let jariDiSensor = null;
let templates = {};             // (simulasi) id -> key jari
let arduinoIds = [];            // id yang didaftarkan lewat dashboard ke Arduino asli
let waiters = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

// ---------- AUDIO BUZZER ----------
let audioCtx = null;
function beep(ms) {
  if ($('muteBox').checked) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 2300;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* audio tidak tersedia */ }
}

// ---------- LCD 16x2 ----------
const lcd = {
  lines: ['', ''], row: 0, col: 0,
  clear() { this.lines = ['', '']; this.row = 0; this.col = 0; this.render(); },
  setCursor(c, r) { this.col = c; this.row = r; },
  print(text) {
    const l = this.lines[this.row].padEnd(16, ' ').split('');
    for (const ch of String(text)) { if (this.col < 16) l[this.col++] = ch; }
    this.lines[this.row] = l.join('').trimEnd();
    this.render();
  },
  show(a, b = '') { this.clear(); this.setCursor(0, 0); this.print(a); this.setCursor(0, 1); this.print(b); },
  render() {
    $('lcdLine0').textContent = this.lines[0].padEnd(16, ' ');
    $('lcdLine1').textContent = this.lines[1].padEnd(16, ' ');
  },
};

// ---------- SERIAL MONITOR (tampilan) ----------
const Serial = {
  // dipakai oleh logika simulasi (meniru Serial.println Arduino)
  println(t = '') {
    this.write(t, 'rx');
    if (mode === 'sim') updateRegStep(t);
  },
  write(t, cls) {
    const box = $('serial');
    const d = document.createElement('div');
    d.textContent = t === '' ? '\u00A0' : t;
    if (cls === 'tx') d.className = 'tx';
    box.appendChild(d);
    while (box.children.length > 300) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  },
};

// ---------- OUTPUT FISIK (visual) ----------
function setLed(id, on) { $(id).classList.toggle('on', on); }
const ledHijau = on => setLed('ledGreen', on);
const ledMerah = on => setLed('ledRed', on);

function setServo(angle) {
  $('servoAngle').textContent = angle;
  $('servoArm').style.transform = `rotate(${angle - 90}deg)`;
}

function updateStatusUI() {
  $('locker').classList.toggle('open', statusTerbuka);
  $('lockIcon').textContent = statusTerbuka ? '🔓' : '🔒';
  const s = $('statusText');
  s.textContent = statusTerbuka ? 'TERBUKA' : 'TERKUNCI';
  s.className = statusTerbuka ? 'opened' : 'locked';
}

async function bunyiBuzzer(durasi) {
  $('buzzer').classList.add('on');
  beep(durasi);
  await sleep(durasi);
  $('buzzer').classList.remove('on');
}
const bunyiBerhasil = () => bunyiBuzzer(200);
async function bunyiGagal() {
  await bunyiBuzzer(200);
  await sleep(150);
  await bunyiBuzzer(200);
}
function semuaMati() {
  ledHijau(false); ledMerah(false);
  $('buzzer').classList.remove('on');
}

// ---------- RIWAYAT ----------
let riwayat = [];
try { riwayat = JSON.parse(localStorage.getItem('locker_riwayat') || '[]'); } catch (e) { riwayat = []; }
function simpanRiwayat() { try { localStorage.setItem('locker_riwayat', JSON.stringify(riwayat)); } catch (e) {} }

function catat(kejadian, detail, status) {
  const sumber = mode === 'arduino' ? 'Arduino' : 'Simulasi';
  riwayat.unshift({ waktu: new Date().toISOString(), kejadian, detail: `[${sumber}] ${detail}`, status });
  if (riwayat.length > 200) riwayat.pop();
  simpanRiwayat();
  renderRiwayat();
}

function fmtWaktu(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function renderRiwayat() {
  const body = $('histBody');
  body.innerHTML = '';
  $('emptyHist').style.display = riwayat.length ? 'none' : 'block';
  riwayat.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cls = r.status === 'BERHASIL' ? 'ok' : r.status === 'GAGAL' ? 'fail' : 'info';
    [riwayat.length - i, fmtWaktu(r.waktu), r.kejadian, r.detail].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    const td = document.createElement('td');
    const b = document.createElement('span');
    b.className = 'badge ' + cls;
    b.textContent = r.status;
    td.appendChild(b);
    tr.appendChild(td);
    body.appendChild(tr);
  });
}

function eksporCSV() {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['No', 'Waktu', 'Kejadian', 'Detail', 'Status']];
  riwayat.slice().reverse().forEach((r, i) =>
    rows.push([i + 1, fmtWaktu(r.waktu), r.kejadian, r.detail, r.status]));
  const csv = rows.map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'riwayat_smart_locker.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- LANGKAH PENDAFTARAN (UI) ----------
let regStep = 0;      // 0 = idle, 1..3 = langkah aktif, 4 = selesai
let regErr = false;

function setRegMsg(text, cls = '') {
  const m = $('regMsg');
  m.textContent = text;
  m.className = 'reg-msg ' + cls;
}

function renderReg() {
  document.querySelectorAll('#regSteps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.className = '';
    if (regStep === 0) return;
    if (n < regStep || regStep === 4) li.classList.add('done');
    else if (n === regStep) li.classList.add(regErr ? 'error' : 'active');
  });
}

function updateRegStep(line) {
  const jari = mode === 'arduino' ? 'jari Anda di sensor fingerprint' : `jari virtual (${labelJari(jariDipilih)})`;
  if (line === 'STATUS:START_REG' || line === 'Tempelkan jari pertama') {
    regStep = 1; regErr = false;
    setRegMsg('Tempelkan ' + jari + '.');
  } else if (line === 'Angkat jari') {
    regStep = 2; regErr = false;
    setRegMsg('Angkat jari dari sensor.');
  } else if (line === 'Tempelkan jari yang sama') {
    regStep = 3; regErr = false;
    setRegMsg('Tempelkan jari yang SAMA sekali lagi.');
  } else if (line === 'PENDAFTARAN BERHASIL') {
    regStep = 4; regErr = false;
    setRegMsg('Pendaftaran berhasil!', 'ok');
  } else if (line === 'Sidik jari tidak cocok') {
    regErr = true; setRegMsg('Dua pemindaian tidak cocok. Coba daftar ulang.', 'fail');
  } else if (line === 'Gagal membaca jari pertama' || line === 'Gagal membaca jari kedua') {
    regErr = true; setRegMsg('Gagal membaca jari. Coba daftar ulang.', 'fail');
  } else if (line === 'Gagal menyimpan sidik jari') {
    regErr = true; setRegMsg('Gagal menyimpan ke sensor.', 'fail');
  } else if (line === 'ERROR:INVALID_ID') {
    regStep = 0; regErr = true; setRegMsg('ID tidak valid (harus 1–127).', 'fail');
  } else return;
  renderReg();
}

// ---------- DAFTAR JARI TERDAFTAR ----------
function labelJari(key) {
  const j = JARI.find(x => x.key === key);
  return j ? j.label : key;
}

function renderTerdaftar() {
  const ul = $('enrolled');
  ul.innerHTML = '';
  const ids = mode === 'arduino'
    ? arduinoIds.slice().sort((a, b) => a - b)
    : Object.keys(templates).map(Number).sort((a, b) => a - b);
  if (!ids.length) {
    ul.innerHTML = '<li class="empty">Belum ada jari terdaftar</li>';
    return;
  }
  ids.forEach(id => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = 'ID ' + id;
    li.appendChild(b);
    li.appendChild(document.createTextNode(' – ' + (mode === 'arduino'
      ? 'tersimpan di sensor Arduino' : labelJari(templates[id]))));
    ul.appendChild(li);
  });
}

// =====================================================
//  BAGIAN A — MODE SIMULASI
// =====================================================
function tampilkanStandby() { lcd.show('SMART LOCKER', 'Tempelkan Jari'); }

function tampilkanMenu() {
  Serial.println();
  Serial.println('==============================');
  Serial.println('        SMART LOCKER');
  Serial.println('==============================');
  Serial.println('Tempelkan jari untuk membuka');
  Serial.println('Ketik 1 atau REG:<id> via PC');
  Serial.println('==============================');
  tampilkanStandby();
}

function kunciLocker() {
  setServo(POS_TERKUNCI);
  statusTerbuka = false;
  semuaMati();
  updateStatusUI();
  lcd.show('SMART LOCKER', 'Pintu Terkunci');
  Serial.println();
  Serial.println('LOKER TERKUNCI');
}

async function bukaLocker() {
  setServo(POS_TERBUKA);
  statusTerbuka = true;
  ledHijau(true); ledMerah(false);
  updateStatusUI();
  lcd.show('AKSES DITERIMA', 'Loker Terbuka');
  await bunyiBerhasil();
  Serial.println();
  Serial.println('SIDIK JARI COCOK');
  Serial.println('LOKER TERBUKA');
  Serial.println('Tekan tombol untuk mengunci');
}

function notifyWaiters() { const w = waiters; waiters = []; w.forEach(fn => fn()); }
function tungguJariTempel() {
  return new Promise(res => { const cek = () => jariDiSensor ? res(jariDiSensor) : waiters.push(cek); cek(); });
}
function tungguJariLepas() {
  return new Promise(res => { const cek = () => !jariDiSensor ? res() : waiters.push(cek); cek(); });
}

function tempelJari() {
  if (mode !== 'sim' || jariDiSensor) return;
  jariDiSensor = jariDipilih;
  $('sensorBtn').classList.add('down');
  $('sensorLabel').textContent = 'Jari menempel…';
  notifyWaiters();
  if (!busy && !statusTerbuka) verifikasiFingerprint();
}
function angkatJari() {
  if (!jariDiSensor) return;
  jariDiSensor = null;
  $('sensorBtn').classList.remove('down');
  $('sensorLabel').textContent = 'Tempelkan Jari';
  notifyWaiters();
}

async function daftarFingerprint(id) {
  Serial.println();
  Serial.println('=== PENDAFTARAN FINGERPRINT ===');
  Serial.println('ID: ' + id);
  lcd.show('Daftar Finger', 'ID: ' + id);
  await sleep(1000);

  Serial.println('Tempelkan jari pertama');
  lcd.show('Tempelkan Jari', 'Pemindaian 1');
  const scan1 = await tungguJariTempel();

  Serial.println('Angkat jari');
  lcd.show('Angkat Jari');
  await tungguJariLepas();
  await sleep(500);

  Serial.println('Tempelkan jari yang sama');
  lcd.show('Tempelkan Lagi', 'Pemindaian 2');
  const scan2 = await tungguJariTempel();

  if (scan1 !== scan2) {
    Serial.println('Sidik jari tidak cocok');
    lcd.show('Jari Tidak Cocok');
    await bunyiGagal();
    await sleep(1500);
    catat('Pendaftaran', `ID ${id} – dua jari berbeda`, 'GAGAL');
    return false;
  }

  templates[id] = scan1;
  try { localStorage.setItem('locker_templates', JSON.stringify(templates)); } catch (e) {}
  Serial.println('PENDAFTARAN BERHASIL');
  lcd.show('Daftar Berhasil', 'ID: ' + id);
  await bunyiBerhasil();
  await sleep(2000);
  renderTerdaftar();
  catat('Pendaftaran', `ID ${id} – ${labelJari(scan1)}`, 'BERHASIL');
  return true;
}

async function verifikasiFingerprint() {
  busy = true;
  const key = jariDiSensor;
  Serial.println();
  Serial.println('Membaca sidik jari...');
  lcd.show('Membaca Jari...');
  await sleep(500);

  const id = Object.keys(templates).find(i => templates[i] === key);
  if (id) {
    const confidence = 80 + Math.floor(Math.random() * 170);
    Serial.println('SIDIK JARI COCOK');
    Serial.println('ID Pemilik: ' + id);
    Serial.println('Confidence: ' + confidence);
    await bukaLocker();
    catat('Akses Diterima', `ID ${id} – ${labelJari(key)} (confidence ${confidence})`, 'BERHASIL');
    await tungguJariLepas();
  } else {
    Serial.println('SIDIK JARI TIDAK TERDAFTAR');
    ledHijau(false); ledMerah(true);
    lcd.show('AKSES DITOLAK', 'Jari Tidak Cocok');
    catat('Akses Ditolak', `Jari tidak terdaftar (${labelJari(key)})`, 'GAGAL');
    await bunyiGagal();
    await sleep(1200);
    ledMerah(false);
    await tungguJariLepas();
    tampilkanStandby();
  }
  busy = false;
}

async function simTombolKunci() {
  if (!statusTerbuka) return;
  Serial.println('CMD:LOCKED');
  kunciLocker();
  catat('Pintu Dikunci', 'Tombol fisik (pin 7)', 'INFO');
  await bunyiBerhasil();
  tampilkanMenu();
}

async function simPerintah(teks) {
  if (busy) { Serial.println('(sistem sibuk)'); return; }

  if (statusTerbuka) {
    if (teks === 'LOCK') {
      Serial.println('CMD:LOCKED_FROM_PC');
      kunciLocker();
      catat('Pintu Dikunci', 'Perintah dari PC (LOCK)', 'INFO');
      await bunyiBerhasil();
      tampilkanMenu();
    }
    return;
  }

  if (teks.startsWith('REG:')) {
    const raw = teks.substring(4);
    const id = parseInt(raw, 10) || 0;
    busy = true;
    if (id >= 1 && id <= 127) {
      Serial.println('STATUS:START_REG');
      await daftarFingerprint(id);
    } else {
      Serial.println('ERROR:INVALID_ID');
      lcd.show('ID Tidak Valid');
      await bunyiGagal();
      await sleep(1500);
      catat('Pendaftaran', 'ID tidak valid: ' + raw, 'GAGAL');
    }
    kunciLocker();
    tampilkanMenu();
    busy = false;
  } else if (teks === '1') {
    Serial.println('PROMPT:MASUKKAN_ID');
  } else if (teks === 'UNLOCK_ADMIN') {
    Serial.println('CMD:UNLOCKED_BY_ADMIN');
    busy = true;
    await bukaLocker();
    catat('Akses Diterima', 'Dibuka admin (UNLOCK_ADMIN)', 'BERHASIL');
    busy = false;
  }
}

// =====================================================
//  BAGIAN B — MODE ARDUINO (Web Serial)
// =====================================================
let port = null, reader = null, writer = null, readPromise = null, keepReading = false;
let pending = null;         // data akses yang sedang dibaca
let adminFlag = false;
let regIdAktif = null;

function tampilStandbyArduino() { lcd.show('SMART LOCKER', statusTerbuka ? 'Loker Terbuka' : 'Tempelkan Jari'); }

function tolakArduino(detail) {
  ledHijau(false); ledMerah(true);
  lcd.show('AKSES DITOLAK', detail === 'Pembacaan jari gagal' ? 'Baca Jari Gagal' : 'Jari Tidak Cocok');
  catat('Akses Ditolak', detail, 'GAGAL');
  bunyiGagal();
  setTimeout(() => { ledMerah(false); if (!statusTerbuka) tampilStandbyArduino(); }, 1200);
}

// Menerjemahkan setiap baris Serial dari Arduino menjadi tampilan dashboard
function handleArduinoLine(line) {
  if (line.startsWith('ID Pemilik: ')) {
    pending = pending || {}; pending.id = line.substring(12); return;
  }
  if (line.startsWith('Confidence: ')) {
    pending = pending || {}; pending.conf = line.substring(12); return;
  }
  if (line.startsWith('ID: ')) { regIdAktif = parseInt(line.substring(4), 10); return; }

  switch (line) {
    case 'Fingerprint terhubung!':
      $('sensorText').textContent = 'Siap';
      lcd.show('Sensor Siap');
      break;
    case 'Fingerprint tidak terdeteksi!':
      $('sensorText').textContent = 'Error (cek kabel)';
      lcd.show('Sensor Error', 'Cek Kabel');
      break;
    case 'LOKER TERKUNCI':
      statusTerbuka = false;
      setServo(POS_TERKUNCI);
      semuaMati();
      updateStatusUI();
      lcd.show('SMART LOCKER', 'Pintu Terkunci');
      break;
    case 'Membaca sidik jari...':
      lcd.show('Membaca Jari...');
      break;
    case 'SIDIK JARI COCOK':
      pending = pending || {};
      break;
    case 'CMD:UNLOCKED_BY_ADMIN':
      adminFlag = true;
      break;
    case 'LOKER TERBUKA':
      statusTerbuka = true;
      setServo(POS_TERBUKA);
      ledHijau(true); ledMerah(false);
      updateStatusUI();
      lcd.show('AKSES DITERIMA', 'Loker Terbuka');
      bunyiBerhasil();
      if (adminFlag) catat('Akses Diterima', 'Dibuka admin (UNLOCK_ADMIN)', 'BERHASIL');
      else catat('Akses Diterima',
        `ID ${pending && pending.id || '?'} (confidence ${pending && pending.conf || '?'})`, 'BERHASIL');
      pending = null; adminFlag = false;
      break;
    case 'SIDIK JARI TIDAK TERDAFTAR':
      tolakArduino('Jari tidak terdaftar');
      break;
    case 'Pembacaan gagal':
      tolakArduino('Pembacaan jari gagal');
      break;
    case 'CMD:LOCKED':
      catat('Pintu Dikunci', 'Tombol fisik (pin 7)', 'INFO');
      bunyiBerhasil();
      break;
    case 'CMD:LOCKED_FROM_PC':
      catat('Pintu Dikunci', 'Perintah dari dashboard (LOCK)', 'INFO');
      bunyiBerhasil();
      break;
    case 'STATUS:START_REG':
      lcd.show('Daftar Finger');
      break;
    case 'Tempelkan jari pertama':
      lcd.show('Tempelkan Jari', 'Pemindaian 1'); break;
    case 'Angkat jari':
      lcd.show('Angkat Jari'); break;
    case 'Tempelkan jari yang sama':
      lcd.show('Tempelkan Lagi', 'Pemindaian 2'); break;
    case 'PENDAFTARAN BERHASIL':
      lcd.show('Daftar Berhasil', 'ID: ' + regIdAktif);
      if (regIdAktif && !arduinoIds.includes(regIdAktif)) {
        arduinoIds.push(regIdAktif);
        try { localStorage.setItem('locker_arduino_ids', JSON.stringify(arduinoIds)); } catch (e) {}
        renderTerdaftar();
      }
      catat('Pendaftaran', `ID ${regIdAktif}`, 'BERHASIL');
      bunyiBerhasil();
      break;
    case 'Gagal membaca jari pertama':
    case 'Gagal membaca jari kedua':
      lcd.show('Baca Jari Gagal');
      catat('Pendaftaran', `ID ${regIdAktif} – gagal membaca jari`, 'GAGAL');
      bunyiGagal(); break;
    case 'Sidik jari tidak cocok':
      lcd.show('Jari Tidak Cocok');
      catat('Pendaftaran', `ID ${regIdAktif} – dua pemindaian tidak cocok`, 'GAGAL');
      bunyiGagal(); break;
    case 'Gagal menyimpan sidik jari':
      lcd.show('Simpan Gagal');
      catat('Pendaftaran', `ID ${regIdAktif} – gagal menyimpan`, 'GAGAL');
      bunyiGagal(); break;
    case 'ERROR:INVALID_ID':
      lcd.show('ID Tidak Valid');
      catat('Pendaftaran', 'ID tidak valid', 'GAGAL');
      bunyiGagal(); break;
  }
}

function terimaBaris(line) {
  if (line === '') return;
  Serial.write(line, 'rx');
  updateRegStep(line);
  handleArduinoLine(line);
}

async function kirimKeArduino(teks) {
  if (!writer) return;
  Serial.write('> ' + teks, 'tx');
  await writer.write(new TextEncoder().encode(teks + '\n'));
}

async function bacaLoop() {
  const dec = new TextDecoder();
  let buf = '';
  try {
    reader = port.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        terimaBaris(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    }
  } catch (e) {
    /* port dicabut / error baca */
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
  if (keepReading) {            // terputus tanpa diminta
    keepReading = false;
    await tutupPort();
    keluarModeArduino('Koneksi Arduino terputus.');
  }
}

async function tutupPort() {
  try { writer && writer.releaseLock(); } catch (e) {}
  try { port && await port.close(); } catch (e) {}
  writer = null; port = null;
}

function masukModeArduino() {
  mode = 'arduino';
  document.body.dataset.mode = 'arduino';
  $('modeBadge').textContent = 'TERHUBUNG KE ARDUINO';
  $('connectBtn').textContent = '⏏ Putuskan Arduino';
  busy = false; angkatJari();
  statusTerbuka = false; pending = null; adminFlag = false;
  semuaMati(); setServo(POS_TERKUNCI); updateStatusUI();
  lcd.show('Menunggu Arduino', '...');
  $('sensorText').textContent = 'Menunggu…';
  regStep = 0; regErr = false; renderReg();
  setRegMsg('Isi ID lalu tekan “Daftarkan Sidik Jari”.');
  renderTerdaftar();
  $('serial').innerHTML = '';
  Serial.write('[Terhubung ke Arduino, 9600 baud]', 'tx');
}

function keluarModeArduino(pesan) {
  mode = 'sim';
  document.body.dataset.mode = 'sim';
  $('modeBadge').textContent = 'MODE SIMULASI';
  $('connectBtn').textContent = '🔌 Hubungkan Arduino';
  regStep = 0; regErr = false; renderReg();
  setRegMsg('Isi ID lalu tekan “Daftarkan Sidik Jari”.');
  semuaMati();
  $('sensorText').textContent = 'Siap';
  $('serial').innerHTML = '';
  if (pesan) Serial.write('[' + pesan + ']', 'tx');
  renderTerdaftar();
  kunciLocker();
  tampilkanMenu();
}

async function hubungkan() {
  if (!('serial' in navigator)) {
    alert('Browser ini tidak mendukung Web Serial.\nGunakan Chrome atau Edge versi desktop.');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
  } catch (e) {
    port = null;
    if (e.name !== 'NotFoundError') {
      alert('Gagal membuka port: ' + e.message +
        '\n\nPastikan Serial Monitor Arduino IDE sudah ditutup.');
    }
    return;
  }
  writer = port.writable.getWriter();
  keepReading = true;
  masukModeArduino();
  readPromise = bacaLoop();
}

async function putus() {
  keepReading = false;
  try { reader && await reader.cancel(); } catch (e) {}
  try { await readPromise; } catch (e) {}
  await tutupPort();
  keluarModeArduino('Koneksi Arduino diputus.');
}

// =====================================================
//  PERINTAH UMUM (dipakai tombol/form)
// =====================================================
function kirimPerintah(teks) {
  teks = teks.trim();
  if (!teks) return;
  if (mode === 'arduino') {
    if (!writer) return;
    kirimKeArduino(teks);
  } else {
    Serial.write('> ' + teks, 'tx');
    simPerintah(teks);
  }
}

// ---------- EVENT ----------
const sensorBtn = $('sensorBtn');
sensorBtn.addEventListener('pointerdown', e => { e.preventDefault(); tempelJari(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => sensorBtn.addEventListener(ev, angkatJari));

$('lockBtn').addEventListener('click', () => {
  if (mode === 'arduino') {
    if (statusTerbuka) kirimPerintah('LOCK');
  } else {
    simTombolKunci();
  }
});

$('serialForm').addEventListener('submit', e => {
  e.preventDefault();
  const inp = $('serialInput');
  kirimPerintah(inp.value);
  inp.value = '';
});
document.querySelectorAll('.chip').forEach(c =>
  c.addEventListener('click', () => kirimPerintah(c.dataset.cmd)));

$('regForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = parseInt($('regId').value, 10);
  if (!(id >= 1 && id <= 127)) {
    regStep = 0; regErr = true; renderReg();
    setRegMsg('ID harus antara 1 dan 127.', 'fail');
    return;
  }
  if (statusTerbuka) {
    setRegMsg('Kunci loker dulu sebelum mendaftarkan sidik jari.', 'fail');
    return;
  }
  if (mode === 'sim' && busy) { setRegMsg('Sistem sedang sibuk.', 'fail'); return; }
  regIdAktif = id;
  setRegMsg('Memulai pendaftaran ID ' + id + '…');
  kirimPerintah('REG:' + id);
});

$('connectBtn').addEventListener('click', () => (mode === 'arduino' ? putus() : hubungkan()));
$('clearBtn').addEventListener('click', () => {
  if (confirm('Hapus seluruh riwayat?')) { riwayat = []; simpanRiwayat(); renderRiwayat(); }
});
$('exportBtn').addEventListener('click', eksporCSV);

if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', () => { if (mode === 'arduino') putus(); });
}

function renderJari() {
  const wrap = $('fingers');
  wrap.innerHTML = '';
  JARI.forEach(j => {
    const b = document.createElement('button');
    b.className = 'finger-opt' + (j.key === jariDipilih ? ' active' : '');
    b.textContent = j.label;
    b.onclick = () => { if (jariDiSensor) return; jariDipilih = j.key; renderJari(); };
    wrap.appendChild(b);
  });
}

// ---------- SETUP AWAL (mode simulasi) ----------
async function setup() {
  try { templates = JSON.parse(localStorage.getItem('locker_templates') || '{}'); } catch (e) { templates = {}; }
  try { arduinoIds = JSON.parse(localStorage.getItem('locker_arduino_ids') || '[]'); } catch (e) { arduinoIds = []; }

  semuaMati();
  setServo(POS_TERKUNCI);
  updateStatusUI();
  renderJari();
  renderTerdaftar();
  renderRiwayat();
  renderReg();

  Serial.println('Serial 9600 baud – simulasi dimulai');
  lcd.show('SMART LOCKER', 'Memulai Sistem');
  busy = true;
  await sleep(1500);
  if (mode !== 'sim') return;
  Serial.println('Fingerprint terhubung!');
  lcd.show('Sensor Siap');
  await sleep(1500);
  if (mode !== 'sim') return;
  kunciLocker();
  tampilkanMenu();
  busy = false;
}
setup();