var inv = JSON.parse(localStorage.getItem('ip_inv') || '{}');
var stream = null;
var scanning = false;
var cooldown = false;
var pendingCode = null;
var detailCode = null;

// ── TABS ──────────────────────────────────────────────────
function goTab(name, el) {
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('on'); });
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('on'); });
  el.classList.add('on');
  document.getElementById('page-' + name).classList.add('on');
  if (name === 'inventaire') renderList();
  if (name === 'export') renderPreview();
}

// ── CAMERA ────────────────────────────────────────────────
function startCam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Camera non disponible — utilisez la saisie manuelle', 'err');
    return;
  }
  setStatus('Demande accès caméra…', '');
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
  }).then(function(s) {
    stream = s;
    var vid = document.getElementById('vid');
    vid.srcObject = s;
    vid.play();
    document.getElementById('camOff').style.display = 'none';
    document.getElementById('scanOverlay').style.display = 'flex';
    document.getElementById('btnStart').style.display = 'none';
    document.getElementById('btnStop').style.display = 'block';
    scanning = true;
    setStatus('Scanner actif — approchez le code-barres', 'ok');
    startDetect(vid);
  }).catch(function(e) {
    setStatus('Erreur caméra : ' + e.message, 'err');
  });
}

function stopCam() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
  var vid = document.getElementById('vid');
  vid.srcObject = null;
  document.getElementById('camOff').style.display = 'flex';
  document.getElementById('scanOverlay').style.display = 'none';
  document.getElementById('btnStart').style.display = 'block';
  document.getElementById('btnStop').style.display = 'none';
  setStatus('Scanner arrêté', '');
}

function startDetect(vid) {
  if (!('BarcodeDetector' in window)) {
    setStatus('Détection auto non dispo — utilisez la saisie manuelle ↓', 'err');
    return;
  }
  var bd;
  try {
    bd = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','data_matrix','pdf417'] });
  } catch(e) {
    try { bd = new BarcodeDetector(); } catch(e2) {
      setStatus('BarcodeDetector indisponible — saisie manuelle ↓', 'err');
      return;
    }
  }
  function detect() {
    if (!scanning) return;
    bd.detect(vid).then(function(codes) {
      if (codes.length > 0 && !cooldown) handleScan(codes[0].rawValue);
      requestAnimationFrame(detect);
    }).catch(function(){ requestAnimationFrame(detect); });
  }
  detect();
}

function setStatus(msg, cls) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

// ── SCAN HANDLER ──────────────────────────────────────────
function handleScan(code) {
  if (cooldown) return;
  cooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);
  if (inv[code]) {
    inv[code].qty += 1;
    inv[code].updatedAt = Date.now();
    save();
    showLS(code, inv[code], false);
    toast('✅ +1 → ' + inv[code].name + ' (×' + inv[code].qty + ')');
    setTimeout(function(){ cooldown = false; }, 1500);
  } else {
    stopCam();
    openNew(code);
    setTimeout(function(){ cooldown = false; }, 2000);
  }
  updateCount();
}

function manualScan() {
  var v = document.getElementById('manInput').value.trim();
  if (!v) { toast('⚠️ Entrez un code-barres'); return; }
  document.getElementById('manInput').value = '';
  handleScan(v);
}

// ── LAST SCAN ─────────────────────────────────────────────
function showLS(code, item, isNew) {
  document.getElementById('lscode').textContent = code;
  document.getElementById('lsname').textContent = item.name;
  document.getElementById('lsqty').textContent = '×' + item.qty;
  var b = document.getElementById('lsbadge');
  b.textContent = isNew ? 'NOUVEAU' : '+1';
  b.className = 'ls-badge ' + (isNew ? 'nb' : 'fb');
  document.getElementById('lscan').classList.add('show');
}

// ── NEW MODAL ─────────────────────────────────────────────
function openNew(code) {
  pendingCode = code;
  document.getElementById('mNewCode').textContent = 'CODE : ' + code;
  document.getElementById('fName').value = '';
  document.getElementById('fGroup').value = '';
  document.getElementById('fPrice').value = '';
  document.getElementById('mNew').classList.add('show');
  setTimeout(function(){ document.getElementById('fName').focus(); }, 350);
}

function saveNew() {
  var name = document.getElementById('fName').value.trim();
  if (!name) { toast('⚠️ Le nom est obligatoire'); return; }
  var grp = document.getElementById('fGroup').value.trim() || 'Sans groupe';
  var prc = parseFloat(document.getElementById('fPrice').value) || 0;
  inv[pendingCode] = { code: pendingCode, name: name, group: grp, price: prc, qty: 1, createdAt: Date.now(), updatedAt: Date.now() };
  save();
  showLS(pendingCode, inv[pendingCode], true);
  closeM('mNew');
  updateCount();
  toast('✅ ' + name + ' ajouté !');
  setTimeout(startCam, 400);
}

// ── DETAIL MODAL ──────────────────────────────────────────
function openDet(code) {
  var it = inv[code]; if (!it) return;
  detailCode = code;
  document.getElementById('dName').textContent = it.name;
  document.getElementById('dCode').textContent = 'CODE : ' + code;
  document.getElementById('dGrp').textContent = it.group || '—';
  document.getElementById('dPrc').textContent = it.price ? it.price.toFixed(2) + ' €' : '—';
  document.getElementById('dQty').textContent = it.qty;
  document.getElementById('mDetail').classList.add('show');
}

function chQty(d) {
  var el = document.getElementById('dQty');
  el.textContent = Math.max(0, parseInt(el.textContent) + d);
}

function saveDet() {
  if (!detailCode) return;
  inv[detailCode].qty = parseInt(document.getElementById('dQty').textContent);
  inv[detailCode].updatedAt = Date.now();
  save();
  closeM('mDetail');
  renderList();
  toast('💾 Mis à jour');
}

function delItem() {
  if (!detailCode) return;
  var n = inv[detailCode].name;
  if (!confirm('Supprimer "' + n + '" ?')) return;
  delete inv[detailCode];
  save();
  closeM('mDetail');
  renderList();
  updateCount();
  toast('🗑 ' + n + ' supprimé');
}

function closeM(id) { document.getElementById(id).classList.remove('show'); }

document.querySelectorAll('.mover').forEach(function(o) {
  o.addEventListener('click', function(e) { if (e.target === o) o.classList.remove('show'); });
});

// ── LIST ──────────────────────────────────────────────────
var ICONS = { alimentaire:'🥫', boisson:'🥤', hygiène:'🧴', entretien:'🧹', électronique:'💡', textile:'👕', papeterie:'📎', médicament:'💊', sport:'⚽', cosmétique:'💄' };
function ico(g) {
  if (!g) return '📦';
  var gl = g.toLowerCase();
  for (var k in ICONS) { if (gl.indexOf(k) >= 0) return ICONS[k]; }
  return '📦';
}

function renderList() {
  var q = (document.getElementById('search').value || '').toLowerCase();
  var items = Object.values(inv).filter(function(i) {
    return !q || i.name.toLowerCase().indexOf(q) >= 0 || i.code.indexOf(q) >= 0 || (i.group||'').toLowerCase().indexOf(q) >= 0;
  }).sort(function(a,b){ return b.updatedAt - a.updatedAt; });

  var el = document.getElementById('ilist');
  if (!items.length) {
    el.innerHTML = '<div class="empty"><div class="eico">' + (q?'🔍':'📦') + '</div><div class="etit">' + (q?'Aucun résultat':'Inventaire vide') + '</div><div class="esub">' + (q?'Autre terme ?':'Scannez des articles') + '</div></div>';
  } else {
    el.innerHTML = items.map(function(it) {
      return '<div class="icard" onclick="openDet(\'' + esc(it.code) + '\')">' +
        '<div class="iico">' + ico(it.group) + '</div>' +
        '<div class="iinf"><div class="iname">' + esc(it.name) + '</div><div class="icode">' + esc(it.code) + '</div><div class="igrp">' + esc(it.group||'Sans groupe') + '</div></div>' +
        '<div class="irt"><div class="iqty">' + it.qty + '</div><div class="iprc">' + (it.price ? it.price.toFixed(2)+' €' : '—') + '</div></div>' +
      '</div>';
    }).join('');
  }
  updateStats();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function updateStats() {
  var items = Object.values(inv);
  var qty = items.reduce(function(s,i){ return s+i.qty; }, 0);
  var val = items.reduce(function(s,i){ return s+(i.price*i.qty); }, 0);
  document.getElementById('sref').textContent = items.length;
  document.getElementById('sqty').textContent = qty;
  document.getElementById('sval').textContent = val >= 1000 ? (val/1000).toFixed(1)+'k€' : Math.round(val)+'€';
}

function updateCount() {
  var n = Object.keys(inv).length;
  document.getElementById('hcount').textContent = n + ' article' + (n>1?'s':'');
}

// ── EXPORT ────────────────────────────────────────────────
function renderPreview() {
  var items = Object.values(inv);
  var b = document.getElementById('ptbody');
  if (!items.length) {
    b.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:18px">Inventaire vide</td></tr>';
    return;
  }
  b.innerHTML = items.map(function(it) {
    return '<tr><td style="font-family:var(--mono);font-size:10px">' + esc(it.code) +
      '</td><td>' + esc(it.name) +
      '</td><td>' + esc(it.group||'—') +
      '</td><td style="font-family:var(--mono);color:var(--green)">' + it.qty +
      '</td><td style="font-family:var(--mono)">' + (it.price ? it.price.toFixed(2) : '—') +
      '</td><td style="font-family:var(--mono);color:var(--cyan)">' + (it.price ? (it.price*it.qty).toFixed(2) : '—') +
      '</td></tr>';
  }).join('');
}

function buildCSV() {
  var items = Object.values(inv);
  var BOM = '\uFEFF';
  var hdr = ['Code-barres','Nom','Groupe','Quantité','Prix unitaire (€)','Total (€)'].join(';') + '\r\n';
  var rows = items.map(function(it) {
    return [it.code, it.name, it.group||'', it.qty, (it.price||0).toFixed(2), ((it.price||0)*it.qty).toFixed(2)]
      .map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(';');
  }).join('\r\n');
  var total = items.reduce(function(s,i){ return s+(i.price||0)*i.qty; }, 0);
  var foot = '\r\n' + ['','','','TOTAL','',total.toFixed(2)].map(function(v){ return '"'+v+'"'; }).join(';');
  return BOM + hdr + rows + foot;
}

function downloadCSV() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var csv = buildCSV();
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var d = new Date().toISOString().slice(0,10);
  a.href = url; a.download = 'inventaire_' + d + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('⬇️ Fichier téléchargé !');
}

function exportMail() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var email = document.getElementById('emailInp').value.trim();
  if (!email) { toast('⚠️ Entrez une adresse email'); return; }
  downloadCSV();
  var items = Object.values(inv);
  var qty = items.reduce(function(s,i){ return s+i.qty; }, 0);
  var val = items.reduce(function(s,i){ return s+(i.price||0)*i.qty; }, 0).toFixed(2);
  var d = new Date().toLocaleDateString('fr-FR');
  var fname = 'inventaire_' + new Date().toISOString().slice(0,10) + '.csv';
  var body = encodeURIComponent(
    'Bonjour,\n\nVeuillez trouver ci-joint l\'inventaire exporté le ' + d + '.\n\n' +
    'Résumé :\n- Références : ' + items.length + '\n- Quantité totale : ' + qty + '\n- Valeur totale : ' + val + ' €\n\n' +
    'Le fichier ' + fname + ' a été téléchargé sur votre appareil.\nJoignez-le à cet email.\n\nCordialement'
  );
  window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Inventaire — ' + d) + '&body=' + body;
  toast('📧 Client mail ouvert');
}

function clearAll() {
  if (!confirm('Effacer tout l\'inventaire ? Action irréversible.')) return;
  inv = {};
  save();
  renderList();
  renderPreview();
  updateCount();
  toast('🗑 Inventaire effacé');
}

// ── STORAGE ───────────────────────────────────────────────
function save() { localStorage.setItem('ip_inv', JSON.stringify(inv)); updateCount(); }

// ── TOAST ─────────────────────────────────────────────────
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(function(){ t.classList.remove('show'); }, 2500);
}

// ── INIT ──────────────────────────────────────────────────
updateCount();
renderList();
document.getElementById('manInput').addEventListener('keydown', function(e){ if(e.key==='Enter') manualScan(); });
document.getElementById('fName').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('fGroup').focus(); });
document.getElementById('fGroup').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('fPrice').focus(); });
document.getElementById('fPrice').addEventListener('keydown', function(e){ if(e.key==='Enter') saveNew(); });
