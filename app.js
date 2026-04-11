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
var blCol = db.collection('bons_livraison');

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
  if (name === 'historique-bl') loadBLHistory();
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
var blItems       = [];
var blPhase       = 1;
var blStream      = null;
var blScanning    = false;
var blCooldown    = false;
var blPendingCode = null;
var blModalOpen   = false; // Scanner pausé quand modal ouvert
var blInfo        = { fournisseur: '', numero: '', date: '' };
var blDraftId     = null;

// ── DRAFT AUTO-SAVE ───────────────────────────────────────
function saveBLDraft() {
  if (!blItems.length && !blInfo.fournisseur && !blInfo.numero) return;
  var draft = {
    id: blDraftId || ('draft_' + Date.now()),
    fournisseur: blInfo.fournisseur,
    numero: blInfo.numero,
    date: blInfo.date || new Date().toISOString().slice(0,10),
    items: blItems,
    savedAt: Date.now()
  };
  blDraftId = draft.id;
  localStorage.setItem('bl_draft', JSON.stringify(draft));
}

function loadBLDraftFromStorage() {
  try {
    var raw = localStorage.getItem('bl_draft');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function clearBLDraft() {
  localStorage.removeItem('bl_draft');
  blDraftId = null;
}

// Vérifier brouillon au chargement
window.addEventListener('load', function() {
  var draft = loadBLDraftFromStorage();
  if (draft && (draft.items && draft.items.length > 0 || draft.fournisseur || draft.numero)) {
    document.getElementById('blDraftFournisseur').textContent = draft.fournisseur || '(sans fournisseur)';
    document.getElementById('blDraftNumero').textContent = draft.numero || '(sans numéro)';
    document.getElementById('blDraftDate').textContent = draft.date ? ' — ' + draft.date : '';
    document.getElementById('blDraftCount').textContent = (draft.items ? draft.items.length : 0) + ' article(s)';
    document.getElementById('blDraftBanner').style.display = 'flex';
  }
  updateBLInfoDisplay();
});

function resumeBLDraft() {
  var draft = loadBLDraftFromStorage();
  if (!draft) return;
  blItems = draft.items || [];
  blInfo = { fournisseur: draft.fournisseur || '', numero: draft.numero || '', date: draft.date || '' };
  blDraftId = draft.id;
  document.getElementById('blDraftBanner').style.display = 'none';
  updateBLInfoDisplay();
  setBLPhase(1);
  renderBLScanList();
  toast('📋 BL repris : ' + (blInfo.fournisseur || 'BL') + (blInfo.numero ? ' #' + blInfo.numero : ''));
}

function discardBLDraft() {
  clearBLDraft();
  document.getElementById('blDraftBanner').style.display = 'none';
  toast('🗑 Brouillon supprimé');
}

// Auto-save en quittant
window.addEventListener('beforeunload', function() {
  if (blItems.length > 0 || blInfo.fournisseur || blInfo.numero) saveBLDraft();
});
document.addEventListener('visibilitychange', function() {
  if (document.hidden && (blItems.length > 0 || blInfo.fournisseur)) saveBLDraft();
});

// ── MODAL INFO BL ─────────────────────────────────────────
function openBLInfoModal() {
  document.getElementById('blInfoFournisseur').value = blInfo.fournisseur || '';
  document.getElementById('blInfoNumero').value = blInfo.numero || '';
  document.getElementById('blInfoDate').value = blInfo.date || new Date().toISOString().slice(0,10);
  document.getElementById('mBLInfo').classList.add('show');
  setTimeout(function() { document.getElementById('blInfoFournisseur').focus(); }, 350);
}

function saveBLInfo() {
  var fournisseur = document.getElementById('blInfoFournisseur').value.trim();
  var numero = document.getElementById('blInfoNumero').value.trim();
  var date = document.getElementById('blInfoDate').value;
  if (!fournisseur) { toast('⚠️ Le nom du fournisseur est obligatoire'); return; }
  if (!numero) { toast('⚠️ Le numéro de BL est obligatoire'); return; }
  blInfo = { fournisseur: fournisseur, numero: numero, date: date };
  closeM('mBLInfo');
  updateBLInfoDisplay();
  saveBLDraft();
  toast('✅ Infos BL enregistrées');
}

function updateBLInfoDisplay() {
  var badge = document.getElementById('blInfoBadge');
  var noInfo = document.getElementById('blInfoPrompt');
  if (blInfo.fournisseur && blInfo.numero) {
    badge.style.display = 'flex';
    document.getElementById('blBadgeFournisseur').textContent = blInfo.fournisseur;
    document.getElementById('blBadgeNumero').textContent = 'BL #' + blInfo.numero;
    noInfo.style.display = 'none';
  } else {
    badge.style.display = 'none';
    noInfo.style.display = 'flex';
  }
}

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

function removeBLScanItem(idx) {
  blItems.splice(idx, 1);
  renderBLScanList();
  saveBLDraft();
}

function startBLCam() {
  if (!blInfo.fournisseur || !blInfo.numero) {
    openBLInfoModal();
    return;
  }
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
    blModalOpen = false;
    document.getElementById('blStatus').textContent = 'Scanner actif';
    document.getElementById('blStatus').className   = 'status ok';
    var bd = makeBarcodeDetector();
    if (!bd) { document.getElementById('blStatus').textContent = 'Saisie manuelle uniquement'; return; }
    function loop() {
      if (!blScanning) return;
      if (blModalOpen) { requestAnimationFrame(loop); return; } // PAUSE si modal
      bd.detect(vid).then(function(codes) {
        if (codes.length > 0 && !blCooldown && !blModalOpen) handleBLScan(codes[0].rawValue);
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
  if (blCooldown || blModalOpen) return;
  blCooldown = true;
  if (navigator.vibrate) navigator.vibrate(70);
  var existing = blItems.findIndex(function(i) { return i.code === code; });
  if (existing >= 0) {
    blItems[existing].qty++;
    toast('✅ ' + blItems[existing].name + ' — qté : ' + blItems[existing].qty);
    document.getElementById('blStatus').textContent = '✅ ' + blItems[existing].name + ' (×' + blItems[existing].qty + ')';
    document.getElementById('blStatus').className = 'status ok';
    renderBLScanList();
    saveBLDraft();
    setTimeout(function() { blCooldown = false; }, 1200);
    return;
  }
  if (inv[code]) {
    var it = inv[code];
    blItems.push({ code: code, name: it.name, group: it.group || 'Sans groupe', price: it.price || 0, qty: 1 });
    toast('✅ ' + it.name + ' ajouté');
    document.getElementById('blStatus').textContent = '✅ ' + it.name;
    document.getElementById('blStatus').className = 'status ok';
    renderBLScanList();
    saveBLDraft();
    setTimeout(function() { blCooldown = false; }, 1200);
    return;
  }
  // Article inconnu → PAUSE scanner + modal
  blPendingCode = code;
  blModalOpen = true;
  document.getElementById('blNewCode').textContent = code;
  document.getElementById('blNewName').value  = '';
  document.getElementById('blNewPrice').value = '';
  document.getElementById('blNewQty').value   = '1';
  _fillBLGroupSelect();
  document.getElementById('mBLNewItem').classList.add('show');
  document.getElementById('blStatus').textContent = '⏸ Scanner pausé — saisissez les infos';
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
  var qty   = parseInt(document.getElementById('blNewQty').value) || 1;
  var sel   = document.getElementById('blNewGroup');
  var group = sel.value === '__new__'
    ? (document.getElementById('blNewGroupCustom').value.trim() || 'Sans groupe')
    : sel.value;
  if (!name) { toast('⚠️ Nom obligatoire'); return; }
  blItems.push({ code: blPendingCode, name: name, group: group, price: price, qty: qty });
  closeM('mBLNewItem');
  blModalOpen = false; // REPRENDRE le scan
  document.getElementById('blStatus').textContent = '✅ ' + name + ' ajouté — scanner actif';
  document.getElementById('blStatus').className = 'status ok';
  renderBLScanList();
  saveBLDraft();
  toast('✅ ' + name + ' ajouté au BL');
}

function closeBLNewItemModal() {
  closeM('mBLNewItem');
  blModalOpen = false; // REPRENDRE le scan
  document.getElementById('blStatus').textContent = 'Scanner actif';
  document.getElementById('blStatus').className = 'status ok';
}

function blManualScan() {
  var v = document.getElementById('blManInput').value.trim();
  if (!v) { toast('⚠️ Entrez un code-barres'); return; }
  document.getElementById('blManInput').value = '';
  handleBLScan(v);
}

function goToBLRecap() {
  if (!blItems.length) { toast('⚠️ Aucun article scanné'); return; }
  if (!blInfo.fournisseur || !blInfo.numero) {
    toast('⚠️ Renseignez d\'abord le fournisseur et le N° de BL');
    openBLInfoModal();
    return;
  }
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
    '<div class="bl-stat"><span>Fournisseur</span><strong>' + esc(blInfo.fournisseur) + '</strong></div>' +
    '<div class="bl-stat"><span>N° BL</span><strong>' + esc(blInfo.numero) + '</strong></div>' +
    '<div class="bl-stat"><span>Date</span><strong>' + (blInfo.date || '—') + '</strong></div>' +
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
  // Enregistrer dans l'historique BL
  var blDoc = {
    fournisseur: blInfo.fournisseur,
    numero: blInfo.numero,
    date: blInfo.date || new Date().toISOString().slice(0,10),
    items: blItems.map(function(i) { return Object.assign({}, i); }),
    totalQty: blItems.reduce(function(s, i) { return s + i.qty; }, 0),
    totalHT: blItems.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0),
    createdAt: now
  };
  batch.set(blCol.doc(), blDoc);
  batch.commit()
    .then(function() {
      toast('✅ ' + blItems.length + ' article(s) intégré(s) au stock !');
      clearBLDraft();
      cancelBL();
    })
    .catch(function(e) { toast('⚠️ Erreur : ' + e.message); });
}

function cancelBL() {
  stopBLCam();
  blItems = []; blPhase = 1; blPendingCode = null; blModalOpen = false;
  blInfo = { fournisseur: '', numero: '', date: '' };
  clearBLDraft();
  setBLPhase(1);
  renderBLScanList();
  updateBLInfoDisplay();
  toast('🗑 BL annulé');
}

document.getElementById('blManInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') blManualScan(); });


// ══════════════════════════════════════════════════════════
// ── MODULE HISTORIQUE BL ──────────────────────────────────
// ══════════════════════════════════════════════════════════
var blHistoryList     = [];
var blHistorySort     = 'date_desc';
var blHistorySearch   = '';
var blHistoryExpanded = {};

function loadBLHistory() {
  var el = document.getElementById('blHistoryList');
  if (el) el.innerHTML = '<div class="empty"><div class="eico">⏳</div><div class="etit">Chargement…</div></div>';
  blCol.orderBy('createdAt', 'desc').limit(200).get().then(function(snap) {
    blHistoryList = [];
    snap.forEach(function(doc) {
      blHistoryList.push(Object.assign({ _id: doc.id }, doc.data()));
    });
    _doRenderBLHistory();
  }).catch(function(e) {
    toast('⚠️ Erreur chargement BLs : ' + e.message);
    if (el) el.innerHTML = '<div class="empty"><div class="eico">⚠️</div><div class="etit">Erreur</div><div class="esub">' + esc(e.message) + '</div></div>';
  });
}

function _doRenderBLHistory() {
  var el = document.getElementById('blHistoryList');
  if (!el) return;
  var search = blHistorySearch.toLowerCase().trim();
  var filtered = blHistoryList.filter(function(bl) {
    if (!search) return true;
    return (bl.fournisseur || '').toLowerCase().indexOf(search) >= 0 ||
           (bl.numero || '').toLowerCase().indexOf(search) >= 0 ||
           (bl.date || '').indexOf(search) >= 0;
  });
  filtered.sort(function(a, b) {
    switch (blHistorySort) {
      case 'date_asc':    return (a.createdAt || 0) - (b.createdAt || 0);
      case 'fournisseur': return (a.fournisseur || '').localeCompare(b.fournisseur || '');
      case 'numero':      return (a.numero || '').localeCompare(b.numero || '');
      default:            return (b.createdAt || 0) - (a.createdAt || 0);
    }
  });
  var count = document.getElementById('blHistoryCount');
  if (count) count.textContent = filtered.length + ' BL' + (filtered.length > 1 ? 's' : '');

  if (!filtered.length) {
    el.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="eico">📋</div><div class="etit">Aucun bon de livraison</div><div class="esub">' +
      (search ? 'Aucun résultat pour "' + esc(search) + '"' : 'Les BLs validés apparaîtront ici') + '</div></div>';
    return;
  }

  el.innerHTML = filtered.map(function(bl) {
    var dateStr  = bl.date || (bl.createdAt ? new Date(bl.createdAt).toLocaleDateString('fr-FR') : '—');
    var isExp    = blHistoryExpanded[bl._id];
    var nItems   = (bl.items || []).length;
    var totalQty = bl.totalQty || 0;
    var totalHT  = bl.totalHT  || 0;

    var itemsHtml = '';
    if (isExp && bl.items && bl.items.length) {
      itemsHtml = '<div class="bl-hist-items">' +
        bl.items.map(function(it) {
          var lt = (it.price || 0) * it.qty;
          return '<div class="bl-hist-item">' +
            '<span class="bl-hist-item-name">' + esc(it.name) + '</span>' +
            '<span class="bl-hist-item-code">' + esc(it.code) + '</span>' +
            '<span class="bl-hist-item-qty">×' + it.qty + '</span>' +
            (lt ? '<span class="bl-hist-item-price">' + lt.toFixed(2) + ' €</span>' : '<span></span>') +
          '</div>';
        }).join('') +
        (totalHT ? '<div class="bl-hist-total">Total HT : <strong>' + totalHT.toFixed(2) + ' €</strong></div>' : '') +
      '</div>';
    }

    return '<div class="bl-hist-card" id="blhcard_' + bl._id + '">' +
      '<div class="bl-hist-header" onclick="toggleBLHistoryItem(\'' + bl._id + '\')">' +
        '<div class="bl-hist-icon">📋</div>' +
        '<div class="bl-hist-info">' +
          '<div class="bl-hist-fournisseur">' + esc(bl.fournisseur || '—') + '</div>' +
          '<div class="bl-hist-meta">' +
            '<span class="bl-hist-numero">BL #' + esc(bl.numero || '—') + '</span>' +
            '<span class="bl-hist-date">📅 ' + dateStr + '</span>' +
          '</div>' +
          '<div class="bl-hist-stats">' +
            '<span>' + nItems + ' réf.</span>' +
            '<span>·</span><span>' + totalQty + ' u.</span>' +
            (totalHT ? '<span>·</span><span>' + totalHT.toFixed(2) + ' €</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="bl-hist-arrow">' + (isExp ? '▲' : '▼') + '</div>' +
      '</div>' +
      itemsHtml +
    '</div>';
  }).join('');
}

function toggleBLHistoryItem(id) {
  blHistoryExpanded[id] = !blHistoryExpanded[id];
  _doRenderBLHistory();
}

function setBLHistorySort(val) {
  blHistorySort = val;
  document.querySelectorAll('.bl-hist-sort-btn').forEach(function(b) {
    b.classList.toggle('on', b.dataset.sort === val);
  });
  _doRenderBLHistory();
}

function onBLHistorySearch() {
  blHistorySearch = document.getElementById('blHistorySearch').value || '';
  var cl = document.getElementById('blHistorySearchClear');
  if (cl) cl.style.display = blHistorySearch ? 'block' : 'none';
  _doRenderBLHistory();
}

function clearBLHistorySearch() {
  document.getElementById('blHistorySearch').value = '';
  blHistorySearch = '';
  var cl = document.getElementById('blHistorySearchClear');
  if (cl) cl.style.display = 'none';
  _doRenderBLHistory();
}


// ══════════════════════════════════════════════════════════
// ── MODULE SORTIE DE STOCK ────────────────────────────────
// ══════════════════════════════════════════════════════════
var sortieStream   = null;
var sortieScanning = false;
var sortieCooldown = false;
var sortieHistory  = [];

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
    qty: firebase.firestore.FieldValue.increment(-1),
    updatedAt: Date.now()
  }).then(function() {
    var newQty = capturedQty - 1;
    document.getElementById('sortieLscode').textContent  = code;
    document.getElementById('sortieLsname').textContent  = capturedName;
    document.getElementById('sortieLsqty').textContent   = 'Stock restant : ' + newQty;
    document.getElementById('sortieLsbadge').textContent = '−1';
    document.getElementById('sortieLsbadge').className   = 'ls-badge ' + (newQty === 0 ? '' : 'fb');
    document.getElementById('sortieLscan').classList.add('show');
    document.getElementById('sortieStatus').textContent  = '✅ ' + capturedName + ' retiré (reste ' + newQty + ')';
    document.getElementById('sortieStatus').className    = 'status ok';
    toast('📤 −1 ' + capturedName + ' (reste ' + newQty + ')');
    sortieHistory.unshift({ code: code, name: capturedName, qtyBefore: capturedQty, qtyAfter: newQty, time: new Date().toLocaleTimeString('fr-FR') });
    renderSortieHistory();
    if (newQty === 0) setTimeout(function() { toast('⚠️ ' + capturedName + ' : stock épuisé !'); }, 1000);
  }).catch(function(e) { toast('⚠️ ' + e.message); });
  setTimeout(function() { sortieCooldown = false; document.getElementById('sortieStatus').className = 'status ok'; }, 1500);
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
    return '<div class="icard"><div class="iico">📤</div><div class="iinf">' +
      '<div class="iname">' + esc(h.name) + '</div>' +
      '<div class="icode">' + esc(h.code) + ' · ' + h.time + '</div>' +
      '<div class="igrp">Reste en stock : ' + h.qtyAfter + '</div>' +
      '</div><div class="irt"><span class="' + bCls + '">' + badge + '</span></div></div>';
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
var invSession    = {};
var invPendingNew = null;

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
    invSession[code] = (invSession[code] || 0) + 1;
    var newCount = invSession[code];
    var stockQty = inv[code].qty;
    var diff     = newCount - stockQty;
    var badge, badgeCls;
    if (diff === 0)    { badge = '✅ OK';           badgeCls = 'ls-badge fb'; }
    else if (diff > 0) { badge = '+' + diff + ' excédent'; badgeCls = 'ls-badge'; }
    else               { badge = diff + ' manquant';       badgeCls = 'ls-badge nb'; }
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
    return '<div class="icard"><div class="iico">' + icon + '</div><div class="iinf">' +
      '<div class="iname">' + esc(name) + '</div><div class="icode">' + esc(code) + '</div>' +
      '<div class="igrp">Scanné : ' + scanned + ' · Stock : ' + stockQty + '</div></div>' +
      '<div class="irt"><div class="iqty" style="color:' + diffCls + '">' + diffTxt + '</div></div></div>';
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
  var reportItems = [];
  var allCodes    = new Set(Object.keys(inv).concat(Object.keys(invSession)));
  var totalDiff   = 0;
  allCodes.forEach(function(code) {
    var stockQty = inv[code] ? (inv[code].qty || 0) : 0;
    var scanned  = invSession[code] || 0;
    var diff     = scanned - stockQty;
    var price    = inv[code] ? (inv[code].price || 0) : 0;
    var name     = inv[code] ? inv[code].name : ('Inconnu ' + code);
    totalDiff   += diff * price;
    reportItems.push({ code: code, name: name, stockQty: stockQty, scanned: scanned, diff: diff, price: price });
  });
  reportItems.sort(function(a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  var nOk = reportItems.filter(function(r) { return r.diff === 0; }).length;
  var nMissing = reportItems.filter(function(r) { return r.diff < 0; }).length;
  var nExtra   = reportItems.filter(function(r) { return r.diff > 0; }).length;
  document.getElementById('invActive').style.display = 'none';
  document.getElementById('invReport').style.display = 'block';
  document.getElementById('invReportDate').textContent = new Date().toLocaleString('fr-FR');
  document.getElementById('invSummaryGrid').innerHTML =
    '<div class="inv-stat-card ok"><div class="inv-stat-val">' + nOk + '</div><div class="inv-stat-lbl">Conformes</div></div>' +
    '<div class="inv-stat-card err"><div class="inv-stat-val">' + nMissing + '</div><div class="inv-stat-lbl">Manquants</div></div>' +
    '<div class="inv-stat-card warn"><div class="inv-stat-val">' + nExtra + '</div><div class="inv-stat-lbl">Excédents</div></div>' +
    '<div class="inv-stat-card"><div class="inv-stat-val">' + reportItems.length + '</div><div class="inv-stat-lbl">Total réf.</div></div>';
  var itemsWithDiff = reportItems.filter(function(r) { return r.diff !== 0; });
  if (!itemsWithDiff.length) {
    document.getElementById('invReportList').innerHTML = '<div class="empty" style="padding:20px 0"><div class="eico">✅</div><div class="etit">Inventaire parfait !</div><div class="esub">Toutes les quantités correspondent</div></div>';
  } else {
    document.getElementById('invReportList').innerHTML = itemsWithDiff.map(function(r) {
      var icon = r.diff > 0 ? '⚠️' : '❌';
      var diffTxt = (r.diff > 0 ? '+' : '') + r.diff;
      var sign = r.diff > 0 ? '+' : '';
      var color = r.diff > 0 ? 'var(--cyan)' : 'var(--red)';
      return '<div class="icard"><div class="iico">' + icon + '</div><div class="iinf">' +
        '<div class="iname">' + esc(r.name) + '</div><div class="icode">' + esc(r.code) + '</div>' +
        '<div class="igrp">Stock : ' + r.stockQty + ' · Scanné : ' + r.scanned + (r.price ? ' · ' + r.price.toFixed(2) + ' €/u' : '') + '</div></div>' +
        '<div class="irt"><div class="iqty" style="color:' + color + '">' + diffTxt + '</div>' +
        '<div class="iprc" style="color:' + color + '">' + sign + (r.diff * r.price).toFixed(2) + ' €</div></div></div>';
    }).join('');
  }
  var sign = totalDiff >= 0 ? '+' : '';
  document.getElementById('invReportTotal').innerHTML =
    '<div class="bl-total"><span>Écart financier total</span><span class="bl-total-val" style="color:' +
    (totalDiff < 0 ? 'var(--red)' : totalDiff > 0 ? 'var(--cyan)' : 'var(--green)') + '">' +
    sign + totalDiff.toFixed(2) + ' €</span></div>';
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
    if (inv[r.code]) batch.update(col.doc(r.code), { qty: r.scanned, updatedAt: now });
  });
  batch.commit()
    .then(function() { toast('✅ Stock mis à jour — ' + items.length + ' correction(s) appliquée(s)'); resetInventaire(); })
    .catch(function(e) { toast('⚠️ ' + e.message); });
}

function resetInventaire() {
  invSession = []; window._invReportItems = null;
  document.getElementById('invIdle').style.display   = 'block';
  document.getElementById('invActive').style.display = 'none';
  document.getElementById('invReport').style.display = 'none';
}

document.getElementById('invManInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') invManualScan(); });


// ══════════════════════════════════════════════════════════
// ── MODULE STOCK ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════
var stockSortBy  = 'name';
var stockSortDir = 1;

function renderStock() {
  var query = (document.getElementById('stockSearch').value || '').toLowerCase().trim();
  var items = Object.values(inv);
  document.getElementById('stockSearchClear').style.display = query ? 'block' : 'none';
  if (query) {
    items = items.filter(function(it) {
      return (it.name || '').toLowerCase().indexOf(query) >= 0 ||
             (it.code || '').toLowerCase().indexOf(query) >= 0 ||
             (it.group || '').toLowerCase().indexOf(query) >= 0;
    });
  }
  items.sort(function(a, b) {
    var va = a[stockSortBy], vb = b[stockSortBy];
    if (typeof va === 'string') return stockSortDir * va.localeCompare(vb || '');
    return stockSortDir * ((va || 0) - (vb || 0));
  });
  var list = document.getElementById('stockList');
  var empty = document.getElementById('stockEmpty');
  var count = document.getElementById('stockCount');
  if (!items.length) { list.innerHTML = ''; empty.style.display = 'block'; count.textContent = ''; return; }
  empty.style.display = 'none';
  count.textContent = items.length + ' article' + (items.length > 1 ? 's' : '') +
    (query ? ' · résultat' + (items.length > 1 ? 's' : '') + ' pour "' + query + '"' : '');
  list.innerHTML = items.map(function(it) {
    var total = (it.price || 0) * (it.qty || 0);
    var qtyClass = it.qty === 0 ? 'iqty red' : (it.qty <= 2 ? 'iqty warn' : 'iqty');
    return '<div class="icard" onclick="openStockEdit(\'' + esc(it.code) + '\')" style="cursor:pointer">' +
      '<div class="iico">📦</div><div class="iinf">' +
      '<div class="iname">' + esc(it.name) + '</div>' +
      '<div class="icode">' + esc(it.code) + '</div>' +
      '<div class="igrp">' + esc(it.group || 'Sans groupe') + (it.price ? ' · ' + it.price.toFixed(2) + ' €/u' : '') + (total ? ' · Total : ' + total.toFixed(2) + ' €' : '') + '</div>' +
      '</div><div class="irt"><div class="' + qtyClass + '">' + (it.qty || 0) + '</div></div></div>';
  }).join('');
}

function setStockSort(field) {
  if (stockSortBy === field) { stockSortDir *= -1; }
  else { stockSortBy = field; stockSortDir = 1; }
  document.querySelectorAll('.sort-btn').forEach(function(b) { b.classList.remove('on'); b.querySelector('.sort-arrow') && (b.querySelector('.sort-arrow').textContent = ''); });
  var btn = document.getElementById('sortBtn-' + field);
  if (btn) { btn.classList.add('on'); var arr = btn.querySelector('.sort-arrow'); if (arr) arr.textContent = stockSortDir === 1 ? '▲' : '▼'; }
  renderStock();
}

function clearStockSearch() {
  document.getElementById('stockSearch').value = '';
  document.getElementById('stockSearchClear').style.display = 'none';
  renderStock();
}

function openStockEdit(code) {
  var it = inv[code]; if (!it) return;
  document.getElementById('stockEditCode').value = code;
  document.getElementById('stockEditCodeDisplay').textContent = code;
  document.getElementById('stockEditName').value  = it.name  || '';
  document.getElementById('stockEditPrice').value = it.price || '';
  document.getElementById('stockEditQty').value   = it.qty   || 0;
  _fillStockGroupSelect(it.group || 'Sans groupe');
  document.getElementById('mStockEdit').classList.add('show');
}

function _fillStockGroupSelect(currentGroup) {
  var groups = ['Sans groupe'];
  Object.values(inv).forEach(function(it) { if (it.group && groups.indexOf(it.group) < 0) groups.push(it.group); });
  if (currentGroup && groups.indexOf(currentGroup) < 0) groups.push(currentGroup);
  var sel = document.getElementById('stockEditGroup');
  sel.innerHTML = groups.map(function(g) {
    return '<option value="' + esc(g) + '"' + (g === currentGroup ? ' selected' : '') + '>' + esc(g) + '</option>';
  }).join('') + '<option value="__new__">+ Nouveau groupe…</option>';
  document.getElementById('stockEditGroupCustom').style.display = 'none';
  sel.onchange = function() { document.getElementById('stockEditGroupCustom').style.display = sel.value === '__new__' ? 'block' : 'none'; };
}

function saveStockEdit() {
  var code  = document.getElementById('stockEditCode').value;
  var name  = document.getElementById('stockEditName').value.trim();
  var price = parseFloat(document.getElementById('stockEditPrice').value) || 0;
  var qty   = parseInt(document.getElementById('stockEditQty').value) || 0;
  var sel   = document.getElementById('stockEditGroup');
  var group = sel.value === '__new__' ? (document.getElementById('stockEditGroupCustom').value.trim() || 'Sans groupe') : sel.value;
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

function handleStockDouchette(code) {
  document.getElementById('stockSearch').value = code;
  renderStock();
}

// ══════════════════════════════════════════════════════════
// ── DOUCHETTE USB / BLUETOOTH ─────────────────────────────
// ══════════════════════════════════════════════════════════
var _dbuf = '', _dtimer = null;
document.addEventListener('keydown', function(e) {
  var tag = (document.activeElement || {}).tagName || '';
  var isInInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === 'Enter' && _dbuf.length >= 3) {
    var code = _dbuf; _dbuf = ''; clearTimeout(_dtimer); _dispatchDouchette(code); return;
  }
  if (isInInput && e.key !== 'Enter') return;
  if (e.key.length === 1) {
    _dbuf += e.key; clearTimeout(_dtimer);
    _dtimer = setTimeout(function() { _dbuf = ''; }, 80);
  }
});

function _dispatchDouchette(code) {
  if (!code) return;
  var te = document.getElementById('douchetteToast');
  document.getElementById('douchetteToastCode').textContent = code;
  te.style.display = 'flex';
  clearTimeout(_dispatchDouchette._t);
  _dispatchDouchette._t = setTimeout(function() { te.style.display = 'none'; }, 1800);
  var ap = (document.querySelector('.page.on') || {}).id || '';
  if      (ap === 'page-bl'        && blPhase === 1) handleBLScan(code);
  else if (ap === 'page-sortie')                      handleSortie(code);
  else if (ap === 'page-inventaire' && invScanning)   handleInvScan(code);
  else if (ap === 'page-stock')                       handleStockDouchette(code);
  else toast('🔫 Code scanné : ' + code);
}

// ══════════════════════════════════════════════════════════
// ── MODULE EXPORT ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function renderPreview() {
  var items = Object.values(inv);
  var b = document.getElementById('ptbody'); if (!b) return;
  if (!items.length) { b.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:18px">Inventaire vide</td></tr>'; return; }
  var total = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  b.innerHTML = items.map(function(it) {
    return '<tr><td class="td-mono">' + esc(it.code) + '</td><td>' + esc(it.name) + '</td><td>' + esc(it.group || '—') + '</td>' +
      '<td class="td-green">' + it.qty + '</td><td class="td-mono">' + (it.price ? it.price.toFixed(2) : '—') + '</td>' +
      '<td class="td-cyan">' + (it.price ? (it.price * it.qty).toFixed(2) : '—') + '</td></tr>';
  }).join('') + '<tr style="background:var(--surf2);font-weight:700"><td colspan="5" style="text-align:right;color:var(--dim)">TOTAL</td><td class="td-cyan">' + total.toFixed(2) + ' €</td></tr>';
}

function downloadXLSX() {
  if (!Object.keys(inv).length) { toast('⚠️ Inventaire vide'); return; }
  var items = Object.values(inv);
  var data  = [['Code-barres', 'Nom', 'Groupe', 'Quantité', 'Prix unitaire (€)', 'Total (€)']];
  items.forEach(function(it) { data.push([it.code, it.name, it.group || '', it.qty, (it.price || 0), ((it.price || 0) * it.qty)]); });
  var total = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0);
  data.push(['', '', '', '', 'TOTAL', total]);
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 18 }, { wch: 35 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Inventaire');
  XLSX.writeFile(wb, 'inventaire_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('⬇️ Fichier Excel téléchargé !');
}

function buildCSV() {
  var items = Object.values(inv);
  var lines = ['\uFEFF' + 'Code-barres;Nom;Groupe;Quantite;Prix (EUR);Total (EUR)'];
  items.forEach(function(it) {
    lines.push([it.code, it.name, it.group || '', it.qty, (it.price || 0).toFixed(2), ((it.price || 0) * it.qty).toFixed(2)]
      .map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';'));
  });
  lines.push(';;;"TOTAL";;' + items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0).toFixed(2));
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
  var qty = items.reduce(function(s, i) { return s + i.qty; }, 0);
  var val = items.reduce(function(s, i) { return s + (i.price || 0) * i.qty; }, 0).toFixed(2);
  var d = new Date().toLocaleDateString('fr-FR');
  window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Inventaire - ' + d) +
    '&body=' + encodeURIComponent('Bonjour,\n\nInventaire exporté le ' + d + '.\n\nRésumé :\n- Références : ' + items.length + '\n- Quantité totale : ' + qty + '\n- Valeur totale : ' + val + ' EUR\n\nCordialement');
  toast('📧 Client mail ouvert');
}

function clearAll() {
  if (!confirm('Effacer TOUT l\'inventaire sur TOUS les appareils ?\nAction irréversible.')) return;
  var batch = db.batch();
  Object.keys(inv).forEach(function(code) { batch.delete(col.doc(code)); });
  batch.commit().then(function() { toast('🗑 Inventaire effacé sur tous les appareils'); }).catch(function(e) { toast('⚠️ ' + e.message); });
}
