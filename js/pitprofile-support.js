(function () {
  'use strict';

  var MODAL_ID = 'pitprofile-feedback-modal';
  var STYLE_ID = 'pitprofile-feedback-modal-style';
  var ENDPOINT = '/api/app?kind=support-submit';

  function el(sel) { return document.querySelector(sel); }
  function byKey(root, key) { return root.querySelector('[data-pp-feedback="' + key + '"]'); }
  function clean(value, max) {
    var text = String(value || '').replace(/\u0000/g, '').trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function getStoredAppState() {
    try {
      var raw = localStorage.getItem('munsell-stp-local-working-save-v1');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function getTeamContext() {
    var saved = getStoredAppState();
    var teamName = (el('#teamNameInput') && el('#teamNameInput').value) || (el('#teamNameDisplay') && el('#teamNameDisplay').textContent) || '';
    var member = (el('#memberNameInput') && el('#memberNameInput').value) || '';
    try {
      if (window.activeTeam) {
        teamName = teamName || window.activeTeam.name || '';
        member = member || window.activeTeam.member || '';
      }
    } catch (_) {}
    return {
      teamName: clean(teamName, 120),
      memberName: clean(member, 120),
      activeTransect: clean((el('#transectLabel') && el('#transectLabel').textContent) || (saved && (saved.activeTransectName || saved.contextLabel)) || '', 120),
      savedTransects: saved && saved.transects ? Object.keys(saved.transects).slice(0, 80) : []
    };
  }

  function diagnostics() {
    return {
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      visualViewport: window.visualViewport ? {
        width: Math.round(window.visualViewport.width),
        height: Math.round(window.visualViewport.height),
        offsetTop: Math.round(window.visualViewport.offsetTop || 0),
        offsetLeft: Math.round(window.visualViewport.offsetLeft || 0),
        scale: window.visualViewport.scale || 1
      } : null,
      team: getTeamContext()
    };
  }

  function context() {
    return {
      app: 'PitProfile',
      location: { href: location.href, pathname: location.pathname, hash: location.hash },
      team: getTeamContext(),
      timestamp: new Date().toISOString()
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '' +
      '#pitprofile-feedback-modal{position:fixed;inset:0;z-index:99999;display:none;align-items:flex-end;justify-content:center;background:rgba(31,25,16,.36);padding:16px;color:#2f281d;font-family:inherit}' +
      '#pitprofile-feedback-modal.open{display:flex}' +
      '#pitprofile-feedback-modal .sheet{width:min(420px,100%);background:#fff8eb;border:1px solid #d8cab0;border-radius:18px;box-shadow:0 18px 44px rgba(43,35,22,.28);padding:16px}' +
      '#pitprofile-feedback-modal h2{margin:0 0 12px;font-size:1rem;line-height:1.15;font-weight:850;color:#2f281d}' +
      '#pitprofile-feedback-modal label{display:block;margin:10px 0 5px;font-size:.78rem;font-weight:800;color:#5f5138}' +
      '#pitprofile-feedback-modal textarea,#pitprofile-feedback-modal input{box-sizing:border-box;width:100%;border:1px solid #d6c5a6;border-radius:12px;background:#fffdf8;color:#2f281d;font-family:inherit;font-size:.9rem;padding:10px}' +
      '#pitprofile-feedback-modal textarea{min-height:128px;resize:vertical}' +
      '#pitprofile-feedback-modal .hint{margin:6px 0 0;font-size:.72rem;line-height:1.25;color:#73644a}' +
      '#pitprofile-feedback-modal .status{min-height:18px;margin-top:10px;font-size:.78rem;font-weight:800;color:#5f5138}' +
      '#pitprofile-feedback-modal .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}' +
      '#pitprofile-feedback-modal button{border:1px solid #cdbb99;border-radius:10px;padding:8px 12px;font-family:inherit;font-size:.82rem;font-weight:850;cursor:pointer}' +
      '#pitprofile-feedback-modal .cancel{background:#fff8eb;color:#3b3122}' +
      '#pitprofile-feedback-modal .send{background:#6f5b38;color:#fff;border-color:#6f5b38}' +
      '#pitprofile-feedback-modal button:disabled{opacity:.62;cursor:not-allowed}' +
      '@media(min-width:640px){#pitprofile-feedback-modal{align-items:center}#pitprofile-feedback-modal .sheet{padding:18px}}';
    document.head.appendChild(style);
  }

  function modal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    addStyles();
    var root = document.createElement('div');
    root.id = MODAL_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'pitprofile-feedback-title');
    root.innerHTML = '' +
      '<div class="sheet">' +
        '<h2 id="pitprofile-feedback-title">Send Feedback</h2>' +
        '<label for="pitprofile-feedback-message">Message</label>' +
        '<textarea id="pitprofile-feedback-message" data-pp-feedback="message" placeholder="What should we know?"></textarea>' +
        '<label for="pitprofile-feedback-email">Your email <span style="font-weight:700">(optional)</span></label>' +
        '<input id="pitprofile-feedback-email" data-pp-feedback="email" type="email" inputmode="email" autocomplete="email" placeholder="Only if you want replies" />' +
        '<p class="hint">Include your email only if you want a reply.</p>' +
        '<div class="status" data-pp-feedback="status" aria-live="polite"></div>' +
        '<div class="actions">' +
          '<button type="button" class="cancel" data-pp-feedback="cancel">Cancel</button>' +
          '<button type="button" class="send" data-pp-feedback="send">Send</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (event) {
      if (event.target === root) close();
    });
    byKey(root, 'cancel').addEventListener('click', close);
    byKey(root, 'send').addEventListener('click', send);
    return root;
  }

  function open(event) {
    if (event && event.preventDefault) event.preventDefault();
    var root = modal();
    var status = byKey(root, 'status');
    root.classList.add('open');
    if (status) status.textContent = '';
    setTimeout(function () {
      var msg = byKey(root, 'message');
      if (msg) msg.focus();
    }, 0);
    return false;
  }

  function close() {
    var root = document.getElementById(MODAL_ID);
    if (!root) return;
    root.classList.remove('open');
  }

  async function send() {
    var root = modal();
    var msg = byKey(root, 'message');
    var email = byKey(root, 'email');
    var status = byKey(root, 'status');
    var sendBtn = byKey(root, 'send');
    var message = clean(msg && msg.value, 5000);
    var contactEmail = clean(email && email.value, 240);

    if (!message) {
      if (status) status.textContent = 'Add a message first.';
      if (msg) msg.focus();
      return;
    }

    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
    if (status) status.textContent = '';

    try {
      var resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'feedback',
          path: ['Send Feedback'],
          message: message,
          contactEmail: contactEmail,
          context: context(),
          diagnostics: diagnostics(),
          transcript: [{ who: 'user', text: message, ts: new Date().toISOString() }]
        })
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Message could not be sent.');
      if (status) status.textContent = 'Thanks — feedback sent.';
      if (msg) msg.value = '';
      if (email) email.value = '';
      setTimeout(close, 900);
    } catch (_) {
      if (status) status.textContent = 'Sorry, feedback could not be sent. Please try again in a moment.';
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
    }
  }

  window.openPitProfileFeedbackModal = open;

  function wire() {
    document.querySelectorAll('[data-pp-feedback-open]').forEach(function (btn) {
      if (btn.__ppFeedbackWired) return;
      btn.__ppFeedbackWired = true;
      btn.addEventListener('click', open);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
