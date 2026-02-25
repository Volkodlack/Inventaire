// ── FIREBASE INIT ─────────────────────────────────────────
firebase.initializeApp({
  apiKey:            "AIzaSyBjTaCpMgOk1nvRrv5AiZfRcGs363KD740",
  authDomain:        "inventpro-cc803.firebaseapp.com",
  projectId:         "inventpro-cc803",
  storageBucket:     "inventpro-cc803.firebasestorage.app",
  messagingSenderId: "154306443310",
  appId:             "1:154306443310:web:4991f1cefa89a484d907bf"
});

var db  = firebase.firestore();
var col = db.collection('inventaire');

// ── STATE ─────────────────────────────────────────────────
var inv         = {};
var stream      = null;
var scanning    = false;
var cooldown    = false;
var pendingCode = null;
var detailCode  = null;

// ── SYNC TEMPS RÉEL ───────────────────────────────────────
col.onSnapshot(function(snap) {
  snap.docChanges().forEach(function(ch) {
    if (ch.type === 'removed') {
      delete inv[ch.doc.id];
    } else {
      inv[ch.doc.id] = ch.doc.data();
    }
  });
  dot('ok');
  updateCount();
  renderList();
  renderPreview();
}, function(err) {
  dot('err');
  toast('⚠️ Erreur Firebase : ' + err.message);
});

function dot(state) {
  var d = document.getElementById('sdot');
  d.className = 'sdot ' + state;
}

// ── TABS ──────────────────────────────────────────────────
function goTab(name, el) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('on'); });
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('on'); });
  el.classList.add('on');
  document.getElementById('page-' + name).classList.add('on');
  if (name === 'inventaire') renderList();
  if (name === 'export')     renderPreview();
}

// ── CAMERA ────────────────────────────────────────────────
var currentDeviceId = null;

function startCam(deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Caméra non disponible — utilisez la saisie manuelle', 'err');
    return;
  }
  setStatus('Demande accès caméra…', '');

  var videoConstraints = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

  navigator.mediaDevices.getUserMedia({ video: videoConstraints })
    .then(function(s) {
      stream = s;
      var vid = document.getElementById('vid');
      vid.srcObject = s;
      vid.play();
      document.getElementById('camOff').style.display      = 'none';
      document.getElementById('scanOverlay').style.display = 'flex';
      document.getElementById('btnStart').style.display    = 'none';
      document.getElementById('btnStop').style.display     = 'block';
      document.getElementById('camControls').style.display = 'block';
      scanning = true;
      setStatus('Scanner actif — approchez le code-barres', 'ok');

      // Récupérer le track vidéo pour autofocus et zoom
      var track = s.getVideoTracks()[0];
      if (track) {
        currentDeviceId = track.getSettings().deviceId;
        applyAutoFocus(track);
        initZoomControl(track);
      }

      // Peupler le sélecteur de caméras
      populateCameraList(currentDeviceId);

      startDetect(vid);
    }).catch(function(e) {
      setStatus('Erreur caméra : ' + e.message, 'err');
    });
}

function applyAutoFocus(track) {
  var caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
      .catch(function() {}); // silencieux si non supporté
  }
}

function initZoomControl(track) {
  var caps = track.getCapabilities ? track.getCapabilities() : {};
  var zoomWrap = document.getElementById('zoomWrap');
  if (caps.zoom) {
    var slider = document.getElementById('zoomSlider');
    slider.min   = caps.zoom.min || 1;
    slider.max   = caps.zoom.max || 5;
    slider.step  = caps.zoom.step || 0.1;
    slider.value = caps.zoom.min || 1;
    document.getElementById('zoomVal').textContent = (caps.zoom.min || 1) + '×';
    zoomWrap.style.display = 'block';
  } else {
    zoomWrap.style.display = 'none';
  }
}

function applyZoom(val) {
  document.getElementById('zoomVal').textContent = parseFloat(val).toFixed(1) + '×';
  if (!stream) return;
  var track = stream.getVideoTracks()[0];
  if (!track) return;
  track.applyConstraints({ advanced: [{ zoom: parseFloat(val) }] })
    .catch(function() {});
}

function populateCameraList(activeDeviceId) {
  navigator.mediaDevices.enumerateDevices().then(function(devices) {
    var cams = devices.filter(function(d) { return d.kind === 'videoinput'; });
    var sel  = document.getElementById('cameraSelect');
    var wrap = document.getElementById('cameraSelectWrap');
    if (cams.length <= 1) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    sel.innerHTML = cams.map(function(c, i) {
      var label = c.label || ('Caméra ' + (i + 1));
      var selected = c.deviceId === activeDeviceId ? ' selected' : '';
      return '<option value="' + c.deviceId + '"' + selected + '>' + label + '</option>';
    }).join('');
  }).catch(function() {});
}

function switchCamera(deviceId) {
  stopCam();
  setTimeout(function() { startCam(deviceId); }, 300);
}

function stopCam() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach(function(t) { t.stop(); });
    stream = null;
  }
  var vid = document.getElementById('vid');
  vid.srcObject = null;
  document.getElementById('camOff').style.display      = 'flex';
  document.getElementById('scanOverlay').style.display = 'none';
  document.getElementById('btnStart').style.display    = 'block';
  document.getElementById('btnStop').style.display     = 'none';
  document.getElementById('camControls').style.display = 'none';
  document.getElementById('zoomWrap').style.display    = 'none';
  document.getElementById('cameraSelectWrap').style.display = 'none';
  setStatus('Scanner arrêté', '');
}

function startDetect(vid) {
  if (!('BarcodeDetector' in window)) {
    setStatus('Détection auto non disponible — saisie manuelle ↓', 'err');
    return;
  }
  var bd;
  try {
    bd = new BarcodeDetector({
      formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','data_matrix']
    });
  } catch(e) {
    try { bd = new BarcodeDetector(); }
    catch(e2) { setStatus('Scanner non supporté — saisie manuelle ↓', 'err'); return; }
  }

  function loop() {
    if (!scanning) return;
    bd.detect(vid)
      .then(function(codes) {
        if (codes.length > 0 && !cooldown) handleScan(codes[0].rawValue);
        requestAnimationFrame(loop);
      })
      .catch(function() { requestAnimationFrame(loop); });
  }
  loop();
}

function setStatus(msg, cls) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className   = 'status' + (cls ? ' ' + cls : '');
}

// ── SCAN HANDLER ──────────────────────────────────────────
function handleScan(code) {
  if (cooldown) return;
  cooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);

  if (inv[code]) {
    // Produit connu → incrément atomique Firebase
    col.doc(code).update({
      qty:       firebase.firestore.FieldValue.increment(1),
      updatedAt: Date.now()
    }).then(function() {
      showLS(code, inv[code], false);
      toast('✅ +1 — ' + inv[code].name + ' (×' + (inv[code].qty + 1) + ')');
    }).catch(function(e) {
      toast('⚠️ ' + e.message);
    });
    setTimeout(function() { cooldown = false; }, 1500);
  } else {
    // Produit inconnu → formulaire
    stopCam();
    openNew(code);
    setTimeout(function() { cooldown = false; }, 2000);
  }
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
  document.getElementById('lsqty').textContent  = '×' + (isNew ? 1 : item.qty + 1);
  var b = document.getElementById('lsbadge');
  b.textContent = isNew ? 'NOUVEAU' : '+1';
  b.className   = 'ls-badge ' + (isNew ? 'nb' : 'fb');
  document.getElementById('lscan').classList.add('show');
}

// ── MODAL NOUVEAU PRODUIT ─────────────────────────────────
function openNew(code) {
  pendingCode = code;
  document.getElementById('mNewCode').textContent = 'CODE : ' + code;
  document.getElementById('fName').value  = '';
  document.getElementById('fGroup').value = '';
  document.getElementById('fPrice').value = '';
  document.getElementById('mNew').classList.add('show');
  setTimeout(function() { document.getElementById('fName').focus(); }, 350);
}

function saveNew() {
  var name = document.getElementById('fName').value.trim();
  if (!name) { toast('⚠️ Le nom est obligatoire'); return; }

  var item = {
    code:      pendingCode,
    name:      name,
    group:     document.getElementById('fGroup').value.trim() || 'Sans groupe',
    price:     parseFloat(document.getElementById('fPrice').value) || 0,
    qty:       1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  var btn = document.getElementById('btnSaveNew');
  btn.disabled    = true;
  btn.textContent = 'Enregistrement…';

  col.doc(pendingCode).set(item)
    .then(function() {
      showLS(pendingCode, item, true);
      closeM('mNew');
      toast('✅ ' + name + ' ajouté !');
      setTimeout(function() { startCam(currentDeviceId); }, 400);
    })
    .catch(function(e) { toast('⚠️ ' + e.message); })
    .finally(function() { btn.disabled = false; btn.textContent = '✅ Enregistrer'; });
}

// ── MODAL DETAIL ──────────────────────────────────────────
function openDet(code) {
  var it = inv[code];
  if (!it) return;
  detailCode = code;
  document.getElementById('dName').textContent = it.name;
  document.getElementById('dCode').textContent = 'CODE : ' + code;
  document.getElementById('dGrp').textContent  = it.group || '—';
  document.getElementById('dPrc').textContent  = it.price ? it.price.toFixed(2) + ' €' : '—';
  document.getElementById('dQty').textContent  = it.qty;
  document.getElementById('mDetail').classList.add('show');
}

function chQty(delta) {
  var el = document.getElementById('dQty');
  el.textContent = Math.max(0, parseInt(el.textContent) + delta);
}

function saveDet() {
  if (!detailCode) return;
  var newQty = parseInt(document.getElementById('dQty').textContent);
  var btn = document.getElementById('btnSaveDet');
  btn.disabled    = true;
  btn.textContent = 'Enregistrement…';

  col.doc(detailCode).update({ qty: newQty, updatedAt: Date.now() })
    .then(function() {
      closeM('mDetail');
      toast('💾 Mis à jour sur tous les appareils');
    })
    .catch(function(e) { toast('⚠️ ' + e.message); })
    .finally(function() { btn.disabled = false; btn.textContent = '💾 Enregistrer'; });
}

function delItem() {
  if (!detailCode) return;
  var name = inv[detailCode].name;
  if (!confirm('Supprimer "' + name + '" de tous les appareils ?')) return;
  col.doc(detailCode).delete()
    .then(function() { closeM('mDetail'); toast('🗑 ' + name + ' supprimé'); })
    .catch(function(e) { toast('⚠️ ' + e.message); });
}

function closeM(id) { document.getElementById(id).classList.remove('show'); }

document.querySelectorAll('.mover').forEach(function(o) {
  o.addEventListener('click', function(e) {
    if (e.target === o) o.classList.remove('show');
  });
});

// ── LISTE & STATS ─────────────────────────────────────────
var ICONS = {
  'alimentaire':'🥫', 'boisson':'🥤', 'hygiène':'🧴',
  'entretien':'🧹', 'électronique':'💡', 'textile':'👕',
  'papeterie':'📎', 'médicament':'💊', 'sport':'⚽', 'cosmétique':'💄'
};

function ico(g) {
  if (!g) return '📦';
  var gl = g.toLowerCase();
  for (var k in ICONS) { if (gl.indexOf(k) >= 0) return ICONS[k]; }
  return '📦';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderList() {
  var q = (document.getElementById('search').value || '').toLowerCase();
  var items = Object.values(inv).filter(function(i) {
    return !q
      || i.name.toLowerCase().indexOf(q) >= 0
      || i.code.indexOf(q) >= 0
      || (i.group || '').toLowerCase().indexOf(q) >= 0;
  }).sort(function(a, b) { return b.updatedAt - a.updatedAt; });

  var el = document.getElementById('ilist');
  if (!items.length) {
    el.innerHTML =
      '<div class="empty">' +
        '<div class="eico">' + (q ? '🔍' : '📦') + '</div>' +
        '<div class="etit">' + (q ? 'Aucun résultat' : 'Inventaire vide') + '</div>' +
        '<div class="esub">' + (q ? 'Essayez un autre terme' : 'Scannez des articles pour commencer') + '</div>' +
      '</div>';
    updateStats();
    return;
  }

  el.innerHTML = items.map(function(it) {
    return '<div class="icard" onclick="openDet(\'' + esc(it.code) + '\')">' +
      '<div class="iico">' + ico(it.group) + '</div>' +
      '<div class="iinf">' +
        '<div class="iname">' + esc(it.name) + '</div>' +
        '<div class="icode">' + esc(it.code) + '</div>' +
        '<div class="igrp">' + esc(it.group || 'Sans groupe') + '</div>' +
      '</div>' +
      '<div class="irt">' +
        '<div class="iqty">' + it.qty + '</div>' +
        '<div class="iprc">' + (it.price ? it.price.toFixed(2) + ' €' : '—') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  updateStats();
}

function updateStats() {
  var items = Object.values(inv);
  var qty   = items.reduce(function(s, i) { return s + i.qty; }, 0);
  var val   = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  document.getElementById('sref').textContent = items.length;
  document.getElementById('sqty').textContent = qty;
  document.getElementById('sval').textContent = val >= 1000
    ? (val / 1000).toFixed(1) + 'k€'
    : Math.round(val) + '€';
}

function updateCount() {
  var n = Object.keys(inv).length;
  document.getElementById('hcount').textContent = n + ' article' + (n > 1 ? 's' : '');
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
    return '<tr>' +
      '<td class="td-mono">'  + esc(it.code) + '</td>' +
      '<td>'                  + esc(it.name) + '</td>' +
      '<td>'                  + esc(it.group || '—') + '</td>' +
      '<td class="td-green">' + it.qty + '</td>' +
      '<td class="td-mono">'  + (it.price ? it.price.toFixed(2) : '—') + '</td>' +
      '<td class="td-cyan">'  + (it.price ? (it.price * it.qty).toFixed(2) : '—') + '</td>' +
    '</tr>';
  }).join('');
}

function buildCSV() {
  var items = Object.values(inv);
  var lines = ['\uFEFF' + 'Code-barres;Nom;Groupe;Quantite;Prix (EUR);Total (EUR)'];
  items.forEach(function(it) {
    lines.push([
      it.code, it.name, it.group || '',
      it.qty,
      (it.price || 0).toFixed(2),
      ((it.price || 0) * it.qty).toFixed(2)
    ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';'));
  });
  var total = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  lines.push(';;;"TOTAL";;' + total.toFixed(2));
  return lines.join('\r\n');
}

function downloadCSV() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'inventaire_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('⬇️ Fichier téléchargé !');
}

function exportMail() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var email = document.getElementById('emailInp').value.trim();
  if (!email) { toast('⚠️ Entrez une adresse email'); return; }
  downloadCSV();
  var items = Object.values(inv);
  var qty   = items.reduce(function(s, i) { return s + i.qty; }, 0);
  var val   = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0).toFixed(2);
  var d     = new Date().toLocaleDateString('fr-FR');
  var corps =
    'Bonjour,\n\nInventaire exporte le ' + d + '.\n\n' +
    'Resume :\n- References : ' + items.length + '\n- Quantite totale : ' + qty +
    '\n- Valeur totale : ' + val + ' EUR\n\n' +
    'Le fichier CSV a ete telecharge sur votre appareil — joignez-le a cet email.\n\nCordialement';
  window.location.href =
    'mailto:' + email +
    '?subject=' + encodeURIComponent('Inventaire - ' + d) +
    '&body='    + encodeURIComponent(corps);
  toast('📧 Client mail ouvert');
}

function clearAll() {
  if (!confirm('Effacer TOUT l\'inventaire sur TOUS les appareils ?\nAction irréversible.')) return;
  var batch = db.batch();
  Object.keys(inv).forEach(function(code) { batch.delete(col.doc(code)); });
  batch.commit()
    .then(function() { toast('🗑 Inventaire effacé sur tous les appareils'); })
    .catch(function(e) { toast('⚠️ ' + e.message); });
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────
document.getElementById('manInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') manualScan();
});
document.getElementById('fName').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('fGroup').focus();
});
document.getElementById('fGroup').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('fPrice').focus();
});
document.getElementById('fPrice').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') saveNew();
});

// ── TOAST ─────────────────────────────────────────────────
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 2800);
}
