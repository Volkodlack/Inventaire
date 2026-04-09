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

// ── STATE GLOBAL ──────────────────────────────────────────
var inv = {};

// ── SYNC TEMPS RÉEL ───────────────────────────────────────
col.onSnapshot(function(snap) {
  snap.docChanges().forEach(function(ch) {
    if (ch.type === 'removed') { delete inv[ch.doc.id]; }
    else { inv[ch.doc.id] = ch.doc.data(); }
  });
  dot('ok');
  updateCount();
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
  if (name === 'export') renderPreview();
  if (name === 'stock')  renderStock();
  // Arrêter les caméras si on quitte
  if (name !== 'sortie'     && sortieScanning) stopSortieCam();
  if (name !== 'inventaire' && invScanning)    stopInvCam();
  if (name !== 'bl'         && blScanning)     stopBLCam();
}

function updateCount() {
  var n = Object.keys(inv).length;
  document.getElementById('hcount').textContent = n + ' article' + (n > 1 ? 's' : '');
}

// ── HELPERS ───────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

function closeM(id) { document.getElementById(id).classList.remove('show'); }

document.querySelectorAll('.mover').forEach(function(o) {
  o.addEventListener('click', function(e) {
    if (e.target === o) o.classList.remove('show');
  });
});

// ── CAMERA HELPER ─────────────────────────────────────────
function makeBarcodeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    return new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','data_matrix'] });
  } catch(e) {
    try { return new BarcodeDetector(); } catch(e2) { return null; }
  }
}

function openCamera(videoEl, onStream, onError) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    onError('Caméra non disponible'); return;
  }
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  }).then(onStream).catch(function(e) { onError(e.message); });
}


// ══════════════════════════════════════════════════════════
// ── MODULE BL ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
var blItems      = []; // [{code, name, group, price, qty}]
var blPhase      = 1;
var blStream     = null;
var blScanning   = false;
var blCooldown   = false;
var blPendingCode = null;

function setBLPhase(p) {
  blPhase = p;
  document.getElementById('blPhase1').style.display = p === 1 ? 'block' : 'none';
  document.getElementById('blPhase2').style.display = p === 2 ? 'block' : 'none';
  [1,2].forEach(function(i) {
    var step = document.getElementById('blStep' + i);
    step.classList.remove('on','done');
    if (i < p) step.classList.add('done');
    else if (i === p) step.classList.add('on');
  });
  document.getElementById('blLine1').classList.toggle('done', p >= 2);
}

function renderBLScanList() {
  var list = document.getElementById('blScanList');
  var msg  = document.getElementById('blScanEmptyMsg');
  var btn  = document.getElementById('btnBLRecap');
  if (!blItems.length) {
    list.innerHTML = ''; msg.style.display = 'block'; btn.style.display = 'none'; return;
  }
  msg.style.display = 'none'; btn.style.display = 'block';
  list.innerHTML = blItems.map(function(it, idx) {
    return '<div class="icard">' +
      '<div class="iico">📦</div>' +
      '<div class="iinf">' +
        '<div class="iname">' + esc(it.name) + '</div>' +
        '<div class="icode">' + esc(it.code) + '</div>' +
        '<div class="igrp">' + esc(it.group) + (it.price ? ' · ' + it.price.toFixed(2) + ' €/u' : '') + '</div>' +
      '</div>' +
      '<div class="irt">' +
        '<div class="iqty">' + it.qty + '</div>' +
        '<button class="qbtn" style="width:28px;height:28px;font-size:12px;margin-top:4px" onclick="removeBLScanItem(' + idx + ')">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function removeBLScanItem(idx) { blItems.splice(idx, 1); renderBLScanList(); }

function startBLCam() {
  document.getElementById('blStatus').textContent = 'Demande accès caméra…';
  openCamera(document.getElementById('blVid'), function(s) {
    blStream = s;
    var vid = document.getElementById('blVid');
    vid.srcObject = s; vid.play();
    document.getElementById('blCamOff').style.display      = 'none';
    document.getElementById('blScanOverlay').style.display = 'flex';
    document.getElementById('blBtnStart').style.display    = 'none';
    document.getElementById('blBtnStop').style.display     = 'block';
    blScanning = true;
    document.getElementById('blStatus').textContent = 'Scanner actif';
    document.getElementById('blStatus').className   = 'status ok';
    var bd = makeBarcodeDetector();
    if (!bd) { document.getElementById('blStatus').textContent = 'Saisie manuelle uniquement'; return; }
    function loop() {
      if (!blScanning) return;
      bd.detect(vid).then(function(codes) {
        if (codes.length > 0 && !blCooldown) handleBLScan(codes[0].rawValue);
        requestAnimationFrame(loop);
      }).catch(function() { requestAnimationFrame(loop); });
    }
    loop();
  }, function(err) {
    document.getElementById('blStatus').textContent = 'Erreur : ' + err;
    document.getElementById('blStatus').className   = 'status err';
  });
}

function stopBLCam() {
  blScanning = false;
  if (blStream) { blStream.getTracks().forEach(function(t) { t.stop(); }); blStream = null; }
  document.getElementById('blVid').srcObject = null;
  document.getElementById('blCamOff').style.display      = 'flex';
  document.getElementById('blScanOverlay').style.display = 'none';
  document.getElementById('blBtnStart').style.display    = 'block';
  document.getElementById('blBtnStop').style.display     = 'none';
  document.getElementById('blStatus').textContent = 'Scanner arrêté';
  document.getElementById('blStatus').className   = 'status';
}

function handleBLScan(code) {
  if (blCooldown) return;
  blCooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);
  // Déjà dans le BL en cours → incrémenter
  var existing = blItems.findIndex(function(i) { return i.code === code; });
  if (existing >= 0) {
    blItems[existing].qty++;
    toast('✅ ' + blItems[existing].name + ' — qté : ' + blItems[existing].qty);
    document.getElementById('blStatus').textContent = '✅ ' + blItems[existing].name + ' (×' + blItems[existing].qty + ')';
    document.getElementById('blStatus').className = 'status ok';
    renderBLScanList();
    setTimeout(function() { blCooldown = false; }, 1200);
    return;
  }
  // Connu dans l'inventaire → ajouter directement
  if (inv[code]) {
    var it = inv[code];
    blItems.push({ code: code, name: it.name, group: it.group || 'Sans groupe', price: it.price || 0, qty: 1 });
    toast('✅ ' + it.name + ' ajouté');
    document.getElementById('blStatus').textContent = '✅ ' + it.name;
    document.getElementById('blStatus').className = 'status ok';
    renderBLScanList();
    setTimeout(function() { blCooldown = false; }, 1200);
    return;
  }
  // Article inconnu → modal saisie
  blPendingCode = code;
  document.getElementById('blNewCode').textContent = code;
  document.getElementById('blNewName').value  = '';
  document.getElementById('blNewPrice').value = '';
  _fillBLGroupSelect();
  document.getElementById('mBLNewItem').classList.add('show');
  document.getElementById('blStatus').textContent = '🆕 Nouvel article — saisissez les infos';
  document.getElementById('blStatus').className = 'status';
  setTimeout(function() { document.getElementById('blNewName').focus(); }, 350);
  setTimeout(function() { blCooldown = false; }, 1200);
}

function _fillBLGroupSelect() {
  var groups = ['Sans groupe'];
  Object.values(inv).forEach(function(it) {
    if (it.group && groups.indexOf(it.group) < 0) groups.push(it.group);
  });
  var sel = document.getElementById('blNewGroup');
  sel.innerHTML = groups.map(function(g) {
    return '<option value="' + esc(g) + '">' + esc(g) + '</option>';
  }).join('') + '<option value="__new__">+ Nouveau groupe…</option>';
  document.getElementById('blNewGroupCustom').style.display = 'none';
  sel.onchange = function() {
    document.getElementById('blNewGroupCustom').style.display = sel.value === '__new__' ? 'block' : 'none';
  };
}

function saveBLNewItem() {
  var name  = document.getElementById('blNewName').value.trim();
  var price = parseFloat(document.getElementById('blNewPrice').value) || 0;
  var sel   = document.getElementById('blNewGroup');
  var group = sel.value === '__new__'
    ? (document.getElementById('blNewGroupCustom').value.trim() || 'Sans groupe')
    : sel.value;
  if (!name) { toast('⚠️ Nom obligatoire'); return; }
  blItems.push({ code: blPendingCode, name: name, group: group, price: price, qty: 1 });
  closeM('mBLNewItem');
  renderBLScanList();
  toast('✅ ' + name + ' ajouté au BL');
}

function blManualScan() {
  var v = document.getElementById('blManInput').value.trim();
  if (!v) { toast('⚠️ Entrez un code-barres'); return; }
  document.getElementById('blManInput').value = '';
  handleBLScan(v);
}

function goToBLRecap() {
  if (!blItems.length) { toast('⚠️ Aucun article scanné'); return; }
  stopBLCam();
  setBLPhase(2);
  renderBLRecap();
}

function goBackToScan() {
  setBLPhase(1);
  renderBLScanList();
}

function renderBLRecap() {
  var list     = document.getElementById('blRecapList');
  var totalHT  = 0;
  var totalQty = 0;
  list.innerHTML = blItems.map(function(it) {
    var lineTotal = (it.price || 0) * it.qty;
    totalHT  += lineTotal;
    totalQty += it.qty;
    return '<div class="icard">' +
      '<div class="iico">📦</div>' +
      '<div class="iinf">' +
        '<div class="iname">' + esc(it.name) + '</div>' +
        '<div class="icode">' + esc(it.code) + '</div>' +
        '<div class="igrp">' + esc(it.group) + (it.price ? ' · ' + it.price.toFixed(2) + ' €/u' : '') + '</div>' +
      '</div>' +
      '<div class="irt"><div class="iqty">' + it.qty + '</div>' +
        (lineTotal ? '<div class="iprc">' + lineTotal.toFixed(2) + ' €</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('blRecapStats').innerHTML =
    '<div class="bl-stat"><span>Articles différents</span><strong>' + blItems.length + '</strong></div>' +
    '<div class="bl-stat"><span>Unités au total</span><strong>' + totalQty + '</strong></div>' +
    (totalHT ? '<div class="bl-stat"><span>Montant total HT</span><strong>' + totalHT.toFixed(2) + ' €</strong></div>' : '');
}

function addBLToInventory() {
  if (!blItems.length) { toast('⚠️ BL vide'); return; }
  var batch = db.batch();
  var now   = Date.now();
  blItems.forEach(function(it) {
    var ref = col.doc(it.code);
    if (inv[it.code]) {
      batch.update(ref, { qty: firebase.firestore.FieldValue.increment(it.qty), updatedAt: now });
    } else {
      batch.set(ref, { code: it.code, name: it.name, group: it.group || 'Sans groupe', price: it.price || 0, qty: it.qty, createdAt: now, updatedAt: now });
    }
  });
  batch.commit()
    .then(function() {
      toast('✅ ' + blItems.length + ' article(s) intégré(s) au stock !');
      cancelBL();
    })
    .catch(function(e) { toast('⚠️ Erreur : ' + e.message); });
}

function cancelBL() {
  stopBLCam();
  blItems = []; blPhase = 1; blPendingCode = null;
  setBLPhase(1);
  renderBLScanList();
  toast('🗑 BL annulé');
}

// Keyboard shortcuts BL
document.getElementById('blManInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') blManualScan(); });


// ══════════════════════════════════════════════════════════
// ── MODULE SORTIE DE STOCK ────────────────────────────────
// ══════════════════════════════════════════════════════════
var sortieStream   = null;
var sortieScanning = false;
var sortieCooldown = false;
var sortieHistory  = []; // [{code, name, qty, time}]

function startSortieCam() {
  document.getElementById('sortieStatus').textContent = 'Demande accès caméra…';
  openCamera(document.getElementById('sortieVid'), function(s) {
    sortieStream = s;
    var vid = document.getElementById('sortieVid');
    vid.srcObject = s; vid.play();
    document.getElementById('sortieCamOff').style.display      = 'none';
    document.getElementById('sortieScanOverlay').style.display = 'flex';
    document.getElementById('sortieBtnStart').style.display    = 'none';
    document.getElementById('sortieBtnStop').style.display     = 'block';
    sortieScanning = true;
    document.getElementById('sortieStatus').textContent = 'Scanner actif — approchez le code-barres';
    document.getElementById('sortieStatus').className   = 'status ok';
    var bd = makeBarcodeDetector();
    if (!bd) { document.getElementById('sortieStatus').textContent = 'Saisie manuelle uniquement'; return; }
    function loop() {
      if (!sortieScanning) return;
      bd.detect(vid).then(function(codes) {
        if (codes.length > 0 && !sortieCooldown) handleSortie(codes[0].rawValue);
        requestAnimationFrame(loop);
      }).catch(function() { requestAnimationFrame(loop); });
    }
    loop();
  }, function(err) {
    document.getElementById('sortieStatus').textContent = 'Erreur : ' + err;
    document.getElementById('sortieStatus').className   = 'status err';
  });
}

function stopSortieCam() {
  sortieScanning = false;
  if (sortieStream) { sortieStream.getTracks().forEach(function(t) { t.stop(); }); sortieStream = null; }
  document.getElementById('sortieVid').srcObject = null;
  document.getElementById('sortieCamOff').style.display      = 'flex';
  document.getElementById('sortieScanOverlay').style.display = 'none';
  document.getElementById('sortieBtnStart').style.display    = 'block';
  document.getElementById('sortieBtnStop').style.display     = 'none';
  document.getElementById('sortieStatus').textContent = 'Scanner arrêté';
  document.getElementById('sortieStatus').className   = 'status';
}

function handleSortie(code) {
  if (sortieCooldown) return;
  sortieCooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);

  var item = inv[code];
  if (!item) {
    document.getElementById('mSortieUnknownCode').textContent = 'CODE : ' + code;
    document.getElementById('mSortieUnknown').classList.add('show');
    document.getElementById('sortieStatus').textContent = '❌ Article introuvable';
    document.getElementById('sortieStatus').className   = 'status err';
    setTimeout(function() { sortieCooldown = false; }, 2000);
    return;
  }

  if (item.qty <= 0) {
    toast('⚠️ ' + item.name + ' : stock déjà à 0 !');
    document.getElementById('sortieStatus').textContent = '⚠️ Stock épuisé';
    document.getElementById('sortieStatus').className   = 'status err';
    setTimeout(function() { sortieCooldown = false; }, 1500);
    return;
  }

  var capturedQty  = item.qty;
  var capturedName = item.name;

  col.doc(code).update({
    qty:       firebase.firestore.FieldValue.increment(-1),
    updatedAt: Date.now()
  }).then(function() {
    var newQty = capturedQty - 1;
    // Afficher dernier retrait
    document.getElementById('sortieLscode').textContent  = code;
    document.getElementById('sortieLsname').textContent  = capturedName;
    document.getElementById('sortieLsqty').textContent   = 'Stock restant : ' + newQty;
    document.getElementById('sortieLsbadge').textContent = '−1';
    document.getElementById('sortieLsbadge').className   = 'ls-badge ' + (newQty === 0 ? '' : 'fb');
    document.getElementById('sortieLscan').classList.add('show');
    document.getElementById('sortieStatus').textContent  = '✅ ' + capturedName + ' retiré (reste ' + newQty + ')';
    document.getElementById('sortieStatus').className    = 'status ok';
    toast('📤 −1 ' + capturedName + ' (reste ' + newQty + ')');

    // Ajouter à l'historique de session
    sortieHistory.unshift({ code: code, name: capturedName, qtyBefore: capturedQty, qtyAfter: newQty, time: new Date().toLocaleTimeString('fr-FR') });
    renderSortieHistory();

    if (newQty === 0) {
      setTimeout(function() { toast('⚠️ ' + capturedName + ' : stock épuisé !'); }, 1000);
    }
  }).catch(function(e) { toast('⚠️ ' + e.message); });

  setTimeout(function() {
    sortieCooldown = false;
    document.getElementById('sortieStatus').className = 'status ok';
  }, 1500);
}

function sortieManualScan() {
  var v = document.getElementById('sortieManInput').value.trim();
  if (!v) { toast('⚠️ Entrez un code-barres'); return; }
  document.getElementById('sortieManInput').value = '';
  handleSortie(v);
}

function renderSortieHistory() {
  var el = document.getElementById('sortieHistory');
  if (!sortieHistory.length) {
    el.innerHTML = '<div class="empty" style="padding:24px 0"><div class="eico">📤</div><div class="etit">Aucune sortie</div><div class="esub">Les retraits apparaîtront ici</div></div>';
    return;
  }
  el.innerHTML = sortieHistory.map(function(h) {
    var badge = h.qtyAfter === 0 ? '⚠️ ÉPUISÉ' : '−1';
    var bCls  = h.qtyAfter === 0 ? 'ls-badge nb' : 'ls-badge fb';
    return '<div class="icard">' +
      '<div class="iico">📤</div>' +
      '<div class="iinf">' +
        '<div class="iname">' + esc(h.name) + '</div>' +
        '<div class="icode">' + esc(h.code) + ' · ' + h.time + '</div>' +
        '<div class="igrp">Reste en stock : ' + h.qtyAfter + '</div>' +
      '</div>' +
      '<div class="irt"><span class="' + bCls + '">' + badge + '</span></div>' +
    '</div>';
  }).join('');
}

function clearSortieHistory() { sortieHistory = []; renderSortieHistory(); toast('🗑 Historique effacé'); }

document.getElementById('sortieManInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') sortieManualScan(); });


// ══════════════════════════════════════════════════════════
// ── MODULE INVENTAIRE PHYSIQUE ────────────────────────────
// ══════════════════════════════════════════════════════════
var invStream     = null;
var invScanning   = false;
var invCooldown   = false;
var invSession    = {};  // {code: qtyScanned} — comptage de la session
var invPendingNew = null; // code en attente de création

function startInventaire() {
  invSession = {};
  document.getElementById('invIdle').style.display   = 'none';
  document.getElementById('invActive').style.display = 'block';
  document.getElementById('invReport').style.display = 'none';
  renderInvScannedList();
  updateInvProgress();
}

function cancelInventaire() {
  stopInvCam();
  invSession = {};
  document.getElementById('invIdle').style.display   = 'block';
  document.getElementById('invActive').style.display = 'none';
  document.getElementById('invReport').style.display = 'none';
  toast('🗑 Inventaire annulé');
}

function startInvCam() {
  document.getElementById('invStatus').textContent = 'Demande accès caméra…';
  openCamera(document.getElementById('invVid'), function(s) {
    invStream = s;
    var vid = document.getElementById('invVid');
    vid.srcObject = s; vid.play();
    document.getElementById('invCamOff').style.display      = 'none';
    document.getElementById('invScanOverlay').style.display = 'flex';
    document.getElementById('invBtnStart').style.display    = 'none';
    document.getElementById('invBtnStop').style.display     = 'block';
    invScanning = true;
    document.getElementById('invStatus').textContent = 'Scanner actif — scannez tous les articles';
    document.getElementById('invStatus').className   = 'status ok';
    var bd = makeBarcodeDetector();
    if (!bd) { document.getElementById('invStatus').textContent = 'Saisie manuelle uniquement'; return; }
    function loop() {
      if (!invScanning) return;
      bd.detect(vid).then(function(codes) {
        if (codes.length > 0 && !invCooldown) handleInvScan(codes[0].rawValue);
        requestAnimationFrame(loop);
      }).catch(function() { requestAnimationFrame(loop); });
    }
    loop();
  }, function(err) {
    document.getElementById('invStatus').textContent = 'Erreur : ' + err;
    document.getElementById('invStatus').className   = 'status err';
  });
}

function stopInvCam() {
  invScanning = false;
  if (invStream) { invStream.getTracks().forEach(function(t) { t.stop(); }); invStream = null; }
  document.getElementById('invVid').srcObject = null;
  document.getElementById('invCamOff').style.display      = 'flex';
  document.getElementById('invScanOverlay').style.display = 'none';
  document.getElementById('invBtnStart').style.display    = 'block';
  document.getElementById('invBtnStop').style.display     = 'none';
  document.getElementById('invStatus').textContent = 'Scanner arrêté';
  document.getElementById('invStatus').className   = 'status';
}

function handleInvScan(code) {
  if (invCooldown) return;
  invCooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);

  if (inv[code]) {
    // Article connu : incrémenter le comptage de session
    invSession[code] = (invSession[code] || 0) + 1;
    var newCount = invSession[code];
    var stockQty = inv[code].qty;
    var diff     = newCount - stockQty;
    var badge, badgeCls;
    if (diff === 0)      { badge = '✅ OK';    badgeCls = 'ls-badge fb'; }
    else if (diff > 0)   { badge = '+' + diff + ' excédent'; badgeCls = 'ls-badge'; }
    else                 { badge = diff + ' manquant';        badgeCls = 'ls-badge nb'; }

    document.getElementById('invLscode').textContent  = code;
    document.getElementById('invLsname').textContent  = inv[code].name;
    document.getElementById('invLsqty').textContent   = 'Scanné : ' + newCount + ' / Stock : ' + stockQty;
    document.getElementById('invLsbadge').textContent = badge;
    document.getElementById('invLsbadge').className   = badgeCls;
    document.getElementById('invLscan').classList.add('show');
    document.getElementById('invStatus').textContent  = '✅ ' + inv[code].name + ' — ' + newCount + '×';
    document.getElementById('invStatus').className    = 'status ok';
    toast('✅ ' + inv[code].name + ' ×' + newCount);
  } else {
    // Article INCONNU → alerte + proposition de création
    stopInvCam();
    invPendingNew = code;
    document.getElementById('mNewInvCode').textContent = 'CODE : ' + code;
    document.getElementById('fInvName').value  = '';
    document.getElementById('fInvGroup').value = '';
    document.getElementById('fInvPrice').value = '';
    document.getElementById('mNewInv').classList.add('show');
    setTimeout(function() { document.getElementById('fInvName').focus(); }, 350);
    document.getElementById('invStatus').textContent = '⚠️ Article inconnu — créez la référence';
    document.getElementById('invStatus').className   = 'status err';
    toast('⚠️ Code inconnu : ' + code);
  }

  renderInvScannedList();
  updateInvProgress();
  setTimeout(function() { invCooldown = false; }, 1200);
}

function saveNewInvProduct() {
  var name  = document.getElementById('fInvName').value.trim();
  if (!name) { toast('⚠️ Le nom est obligatoire'); return; }
  var group = document.getElementById('fInvGroup').value.trim() || 'Sans groupe';
  var price = parseFloat(document.getElementById('fInvPrice').value) || 0;
  var code  = invPendingNew;
  if (!code) { closeM('mNewInv'); return; }
  var now = Date.now();
  col.doc(code).set({ code: code, name: name, group: group, price: price, qty: 0, createdAt: now, updatedAt: now })
    .then(function() {
      // Compter l'article dans la session
      invSession[code] = (invSession[code] || 0) + 1;
      closeM('mNewInv');
      toast('✅ ' + name + ' créé et ajouté à l\'inventaire');
      renderInvScannedList();
      updateInvProgress();
      invPendingNew = null;
      startInvCam();
    })
    .catch(function(e) { toast('⚠️ ' + e.message); });
}

function invManualScan() {
  var v = document.getElementById('invManInput').value.trim();
  if (!v) { toast('⚠️ Entrez un code-barres'); return; }
  document.getElementById('invManInput').value = '';
  handleInvScan(v);
}

function renderInvScannedList() {
  var el    = document.getElementById('invScannedList');
  var codes = Object.keys(invSession);
  if (!codes.length) {
    el.innerHTML = '<div class="empty" style="padding:20px 0"><div class="eico">📷</div><div class="etit">Aucun scan</div><div class="esub">Commencez à scanner vos articles</div></div>';
    return;
  }
  el.innerHTML = codes.map(function(code) {
    var scanned  = invSession[code];
    var stockQty = inv[code] ? inv[code].qty : 0;
    var name     = inv[code] ? inv[code].name : code;
    var diff     = scanned - stockQty;
    var icon     = diff === 0 ? '✅' : diff > 0 ? '⚠️' : '❌';
    var diffTxt  = diff === 0 ? 'OK' : (diff > 0 ? '+' + diff : String(diff));
    var diffCls  = diff === 0 ? 'var(--green)' : diff > 0 ? 'var(--cyan)' : 'var(--red)';
    return '<div class="icard">' +
      '<div class="iico">' + icon + '</div>' +
      '<div class="iinf"><div class="iname">' + esc(name) + '</div><div class="icode">' + esc(code) + '</div>' +
      '<div class="igrp">Scanné : ' + scanned + ' · Stock : ' + stockQty + '</div></div>' +
      '<div class="irt"><div class="iqty" style="color:' + diffCls + '">' + diffTxt + '</div></div>' +
    '</div>';
  }).join('');
}

function updateInvProgress() {
  var total   = Object.keys(inv).length;
  var scanned = Object.keys(invSession).length;
  var pct     = total > 0 ? Math.round((scanned / total) * 100) : 0;
  document.getElementById('invProgressFill').style.width = pct + '%';
  document.getElementById('invProgressTxt').textContent  = scanned + ' référence(s) scannée(s) sur ' + total + ' en stock (' + pct + '%)';
}

function finishInventaire() {
  stopInvCam();
  // Construire le rapport : toutes les références du stock + celles scannées mais inconnues
  var reportItems = [];
  var allCodes    = new Set(Object.keys(inv).concat(Object.keys(invSession)));
  var totalDiff   = 0;

  allCodes.forEach(function(code) {
    var stockQty  = inv[code] ? (inv[code].qty || 0) : 0;
    var scanned   = invSession[code] || 0;
    var diff      = scanned - stockQty;
    var price     = inv[code] ? (inv[code].price || 0) : 0;
    var name      = inv[code] ? inv[code].name : ('Inconnu ' + code);
    totalDiff    += diff * price;
    reportItems.push({ code: code, name: name, stockQty: stockQty, scanned: scanned, diff: diff, price: price });
  });

  // Trier : écarts d'abord
  reportItems.sort(function(a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });

  // Stats
  var nOk      = reportItems.filter(function(r) { return r.diff === 0; }).length;
  var nMissing = reportItems.filter(function(r) { return r.diff < 0; }).length;
  var nExtra   = reportItems.filter(function(r) { return r.diff > 0; }).length;
  var nTotal   = reportItems.length;

  document.getElementById('invActive').style.display = 'none';
  document.getElementById('invReport').style.display = 'block';
  document.getElementById('invReportDate').textContent = new Date().toLocaleString('fr-FR');

  document.getElementById('invSummaryGrid').innerHTML =
    '<div class="inv-stat-card ok"><div class="inv-stat-val">' + nOk + '</div><div class="inv-stat-lbl">Conformes</div></div>' +
    '<div class="inv-stat-card err"><div class="inv-stat-val">' + nMissing + '</div><div class="inv-stat-lbl">Manquants</div></div>' +
    '<div class="inv-stat-card warn"><div class="inv-stat-val">' + nExtra + '</div><div class="inv-stat-lbl">Excédents</div></div>' +
    '<div class="inv-stat-card"><div class="inv-stat-val">' + nTotal + '</div><div class="inv-stat-lbl">Total réf.</div></div>';

  // Liste des écarts (masquer ceux à 0 si tout est OK, sinon montrer tout)
  var itemsWithDiff = reportItems.filter(function(r) { return r.diff !== 0; });
  if (!itemsWithDiff.length) {
    document.getElementById('invReportList').innerHTML =
      '<div class="empty" style="padding:20px 0"><div class="eico">✅</div><div class="etit">Inventaire parfait !</div><div class="esub">Toutes les quantités correspondent</div></div>';
  } else {
    document.getElementById('invReportList').innerHTML = itemsWithDiff.map(function(r) {
      var icon    = r.diff > 0 ? '⚠️' : '❌';
      var diffTxt = (r.diff > 0 ? '+' : '') + r.diff;
      var diffVal = (r.diff * r.price).toFixed(2);
      var sign    = r.diff > 0 ? '+' : '';
      var color   = r.diff > 0 ? 'var(--cyan)' : 'var(--red)';
      return '<div class="icard">' +
        '<div class="iico">' + icon + '</div>' +
        '<div class="iinf">' +
          '<div class="iname">' + esc(r.name) + '</div>' +
          '<div class="icode">' + esc(r.code) + '</div>' +
          '<div class="igrp">Stock : ' + r.stockQty + ' · Scanné : ' + r.scanned + (r.price ? ' · ' + r.price.toFixed(2) + ' €/u' : '') + '</div>' +
        '</div>' +
        '<div class="irt">' +
          '<div class="iqty" style="color:' + color + '">' + diffTxt + '</div>' +
          '<div class="iprc" style="color:' + color + '">' + sign + diffVal + ' €</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Total financier
  var sign = totalDiff >= 0 ? '+' : '';
  document.getElementById('invReportTotal').innerHTML =
    '<div class="bl-total"><span>Écart financier total</span><span class="bl-total-val" style="color:' + (totalDiff < 0 ? 'var(--red)' : totalDiff > 0 ? 'var(--cyan)' : 'var(--green)') + '">' + sign + totalDiff.toFixed(2) + ' €</span></div>';

  // Stocker le rapport pour correction
  window._invReportItems = reportItems;
}

function applyInventaire() {
  if (!window._invReportItems) { toast('⚠️ Pas de rapport disponible'); return; }
  var items = window._invReportItems.filter(function(r) { return r.diff !== 0; });
  if (!items.length) { toast('✅ Aucune correction nécessaire'); resetInventaire(); return; }

  if (!confirm('Mettre à jour ' + items.length + ' article(s) dans le stock selon le comptage physique ?')) return;

  var batch = db.batch();
  var now   = Date.now();
  items.forEach(function(r) {
    if (inv[r.code]) {
      batch.update(col.doc(r.code), { qty: r.scanned, updatedAt: now });
    }
  });
  batch.commit()
    .then(function() {
      toast('✅ Stock mis à jour — ' + items.length + ' correction(s) appliquée(s)');
      resetInventaire();
    })
    .catch(function(e) { toast('⚠️ ' + e.message); });
}

function resetInventaire() {
  invSession = [];
  window._invReportItems = null;
  document.getElementById('invIdle').style.display   = 'block';
  document.getElementById('invActive').style.display = 'none';
  document.getElementById('invReport').style.display = 'none';
}

document.getElementById('invManInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') invManualScan(); });


// ══════════════════════════════════════════════════════════
// ── MODULE STOCK (recherche / tri) ────────────────────────
// ══════════════════════════════════════════════════════════
var stockSortBy  = 'name';
var stockSortDir = 1; // 1 = asc, -1 = desc

function renderStock() {
  var query = (document.getElementById('stockSearch').value || '').toLowerCase().trim();
  var items = Object.values(inv);

  // Bouton clear
  document.getElementById('stockSearchClear').style.display = query ? 'block' : 'none';

  // Filtrage
  if (query) {
    items = items.filter(function(it) {
      return (it.name  || '').toLowerCase().indexOf(query) >= 0 ||
             (it.code  || '').toLowerCase().indexOf(query) >= 0 ||
             (it.group || '').toLowerCase().indexOf(query) >= 0;
    });
  }

  // Tri
  items.sort(function(a, b) {
    var va = a[stockSortBy], vb = b[stockSortBy];
    if (typeof va === 'string') return stockSortDir * va.localeCompare(vb || '');
    return stockSortDir * ((va || 0) - (vb || 0));
  });

  var list  = document.getElementById('stockList');
  var empty = document.getElementById('stockEmpty');
  var count = document.getElementById('stockCount');

  if (!items.length) {
    list.innerHTML = ''; empty.style.display = 'block';
    count.textContent = ''; return;
  }
  empty.style.display = 'none';
  count.textContent   = items.length + ' article' + (items.length > 1 ? 's' : '') +
    (query ? ' · résultat' + (items.length > 1 ? 's' : '') + ' pour "' + query + '"' : '');

  list.innerHTML = items.map(function(it) {
    var total = (it.price || 0) * (it.qty || 0);
    var qtyClass = it.qty === 0 ? 'iqty red' : (it.qty <= 2 ? 'iqty warn' : 'iqty');
    return '<div class="icard" onclick="openStockEdit(\'' + esc(it.code) + '\')" style="cursor:pointer">' +
      '<div class="iico">📦</div>' +
      '<div class="iinf">' +
        '<div class="iname">' + esc(it.name) + '</div>' +
        '<div class="icode">' + esc(it.code) + '</div>' +
        '<div class="igrp">' + esc(it.group || 'Sans groupe') + (it.price ? ' · ' + it.price.toFixed(2) + ' €/u' : '') + (total ? ' · Total : ' + total.toFixed(2) + ' €' : '') + '</div>' +
      '</div>' +
      '<div class="irt"><div class="' + qtyClass + '">' + (it.qty || 0) + '</div></div>' +
    '</div>';
  }).join('');
}

function setStockSort(field) {
  if (stockSortBy === field) { stockSortDir *= -1; }
  else { stockSortBy = field; stockSortDir = 1; }
  document.querySelectorAll('.sort-btn').forEach(function(b) { b.classList.remove('on'); b.querySelector('.sort-arrow') && (b.querySelector('.sort-arrow').textContent = ''); });
  var btn = document.getElementById('sortBtn-' + field);
  if (btn) {
    btn.classList.add('on');
    var arrow = btn.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = stockSortDir === 1 ? '▲' : '▼';
  }
  renderStock();
}

function clearStockSearch() {
  document.getElementById('stockSearch').value = '';
  document.getElementById('stockSearchClear').style.display = 'none';
  renderStock();
}

function openStockEdit(code) {
  var it = inv[code];
  if (!it) return;
  document.getElementById('stockEditCode').value          = code;
  document.getElementById('stockEditCodeDisplay').textContent = code;
  document.getElementById('stockEditName').value          = it.name  || '';
  document.getElementById('stockEditPrice').value         = it.price || '';
  document.getElementById('stockEditQty').value           = it.qty   || 0;
  _fillStockGroupSelect(it.group || 'Sans groupe');
  document.getElementById('mStockEdit').classList.add('show');
}

function _fillStockGroupSelect(currentGroup) {
  var groups = ['Sans groupe'];
  Object.values(inv).forEach(function(it) {
    if (it.group && groups.indexOf(it.group) < 0) groups.push(it.group);
  });
  if (currentGroup && groups.indexOf(currentGroup) < 0) groups.push(currentGroup);
  var sel = document.getElementById('stockEditGroup');
  sel.innerHTML = groups.map(function(g) {
    return '<option value="' + esc(g) + '"' + (g === currentGroup ? ' selected' : '') + '>' + esc(g) + '</option>';
  }).join('') + '<option value="__new__">+ Nouveau groupe…</option>';
  document.getElementById('stockEditGroupCustom').style.display = 'none';
  sel.onchange = function() {
    document.getElementById('stockEditGroupCustom').style.display = sel.value === '__new__' ? 'block' : 'none';
  };
}

function saveStockEdit() {
  var code  = document.getElementById('stockEditCode').value;
  var name  = document.getElementById('stockEditName').value.trim();
  var price = parseFloat(document.getElementById('stockEditPrice').value) || 0;
  var qty   = parseInt(document.getElementById('stockEditQty').value)   || 0;
  var sel   = document.getElementById('stockEditGroup');
  var group = sel.value === '__new__'
    ? (document.getElementById('stockEditGroupCustom').value.trim() || 'Sans groupe')
    : sel.value;
  if (!name) { toast('⚠️ Nom obligatoire'); return; }
  col.doc(code).update({ name: name, group: group, price: price, qty: qty, updatedAt: Date.now() })
    .then(function() { closeM('mStockEdit'); renderStock(); toast('✅ Article mis à jour'); })
    .catch(function(e) { toast('⚠️ Erreur : ' + e.message); });
}

function deleteStockItem() {
  var code = document.getElementById('stockEditCode').value;
  var name = (inv[code] || {}).name || code;
  if (!confirm('Supprimer "' + name + '" du stock ?')) return;
  col.doc(code).delete()
    .then(function() { closeM('mStockEdit'); renderStock(); toast('🗑 Article supprimé'); })
    .catch(function(e) { toast('⚠️ Erreur : ' + e.message); });
}

// ── Recherche depuis douchette sur l'onglet stock
function handleStockDouchette(code) {
  document.getElementById('stockSearch').value = code;
  renderStock();
}

// ══════════════════════════════════════════════════════════
// ── DOUCHETTE USB / BLUETOOTH ─────────────────────────────
// ══════════════════════════════════════════════════════════
// Une douchette se comporte comme un clavier rapide :
// elle envoie les caractères du code très vite puis appuie
// sur Entrée. On détecte ça en chronométrant les frappes.
var _dbuf   = '';
var _dtimer = null;

document.addEventListener('keydown', function(e) {
  var tag = (document.activeElement || {}).tagName || '';
  var isInInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === 'Enter' && _dbuf.length >= 3) {
    var code = _dbuf;
    _dbuf = ''; clearTimeout(_dtimer);
    _dispatchDouchette(code);
    return;
  }

  // Ignorer si on est dans un champ de texte (sauf pour la douchette détectée)
  if (isInInput && e.key !== 'Enter') {
    // Reset buffer si l'utilisateur tape manuellement (délai > 80ms)
    return;
  }

  if (e.key.length === 1) {
    _dbuf += e.key;
    clearTimeout(_dtimer);
    // Si pas de nouvel input dans 80ms → pas une douchette, vider
    _dtimer = setTimeout(function() { _dbuf = ''; }, 80);
  }
});

function _dispatchDouchette(code) {
  if (!code) return;
  // Afficher le toast douchette
  var toast_el = document.getElementById('douchetteToast');
  document.getElementById('douchetteToastCode').textContent = code;
  toast_el.style.display = 'flex';
  clearTimeout(_dispatchDouchette._hideTimer);
  _dispatchDouchette._hideTimer = setTimeout(function() { toast_el.style.display = 'none'; }, 1800);

  // Router vers la bonne fonction selon l'onglet actif
  var activePage = (document.querySelector('.page.on') || {}).id || '';
  if      (activePage === 'page-bl'          && blPhase === 1)   handleBLScan(code);
  else if (activePage === 'page-sortie')                          handleSortie(code);
  else if (activePage === 'page-inventaire'  && invScanning)      handleInvScan(code);
  else if (activePage === 'page-stock')                           handleStockDouchette(code);
  else toast('🔫 Code scanné : ' + code);
}

// ══════════════════════════════════════════════════════════
// ── MODULE EXPORT ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function renderPreview() {
  var items = Object.values(inv);
  var b = document.getElementById('ptbody');
  if (!b) return;
  if (!items.length) {
    b.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:18px">Inventaire vide</td></tr>';
    return;
  }
  var total = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  b.innerHTML = items.map(function(it) {
    return '<tr>' +
      '<td class="td-mono">'  + esc(it.code) + '</td>' +
      '<td>'                  + esc(it.name) + '</td>' +
      '<td>'                  + esc(it.group || '—') + '</td>' +
      '<td class="td-green">' + it.qty + '</td>' +
      '<td class="td-mono">'  + (it.price ? it.price.toFixed(2) : '—') + '</td>' +
      '<td class="td-cyan">'  + (it.price ? (it.price * it.qty).toFixed(2) : '—') + '</td>' +
    '</tr>';
  }).join('') +
  '<tr style="background:var(--surf2);font-weight:700"><td colspan="5" style="text-align:right;color:var(--dim)">TOTAL</td><td class="td-cyan">' + total.toFixed(2) + ' €</td></tr>';
}

function downloadXLSX() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var items = Object.values(inv);
  var data  = [['Code-barres', 'Nom', 'Groupe', 'Quantité', 'Prix unitaire (€)', 'Total (€)']];
  items.forEach(function(it) {
    data.push([
      it.code, it.name, it.group || '',
      it.qty,
      (it.price || 0),
      ((it.price || 0) * it.qty)
    ]);
  });
  var total = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  data.push(['', '', '', '', 'TOTAL', total]);

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(data);

  // Largeurs colonnes
  ws['!cols'] = [{ wch: 18 }, { wch: 35 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 14 }];

  XLSX.utils.book_append_sheet(wb, ws, 'Inventaire');
  var date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'inventaire_' + date + '.xlsx');
  toast('⬇️ Fichier Excel téléchargé !');
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
  lines.push(';;;\"TOTAL\";;' + total.toFixed(2));
  return lines.join('\r\n');
}

function downloadCSV() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'inventaire_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('⬇️ CSV téléchargé !');
}

function exportMail() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var email = document.getElementById('emailInp').value.trim();
  if (!email) { toast('⚠️ Entrez une adresse email'); return; }
  downloadXLSX();
  var items = Object.values(inv);
  var qty   = items.reduce(function(s, i) { return s + i.qty; }, 0);
  var val   = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0).toFixed(2);
  var d     = new Date().toLocaleDateString('fr-FR');
  var corps = 'Bonjour,\n\nInventaire exporté le ' + d + '.\n\nRésumé :\n- Références : ' + items.length + '\n- Quantité totale : ' + qty + '\n- Valeur totale : ' + val + ' EUR\n\nLe fichier Excel a été téléchargé sur votre appareil — joignez-le à cet email.\n\nCordialement';
  window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Inventaire - ' + d) + '&body=' + encodeURIComponent(corps);
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
