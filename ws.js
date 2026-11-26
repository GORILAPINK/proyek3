(() => {
  'use strict';

  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  if (!synth) return;

  const STORAGE_KEY = 'website_tts_enabled';

  const CONFIG = {
    lang: 'id-ID',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    hoverDelay: 180,
    clickDelay: 80
  };

  let timerId = null;
  let speakDelayId = null;
  let currentTarget = null;
  let lastSpokenTarget = null;
  let indonesianVoice = null;
  let isEnabled = loadEnabledState();

  function loadEnabledState() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch (_) {
      return true;
    }
  }

  function saveEnabledState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Boolean(state)));
    } catch (_) {}
  }

  function pickIndonesianVoice() {
    const voices = synth.getVoices();
    if (!voices || !voices.length) return null;

    return (
      voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === 'id-id') ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('id')) ||
      voices.find((v) => v.name && /indonesia/i.test(v.name)) ||
      null
    );
  }

  function syncVoice() {
    indonesianVoice = pickIndonesianVoice();
  }

  syncVoice();
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = syncVoice;
  }

  /**
   * Mengambil kalimat pertama tanpa memotong angka ribuan/desimal.
   */
  function extractFirstSentence(rawText) {
    if (!rawText) return '';

    const normalized = String(rawText).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    const match = normalized.match(/^.*?(?:(?<!\d)\.(?!\d)|[!?…])(?=\s|$)/);
    return match ? match[0].trim() : normalized;
  }

  function cleanUtteranceText(raw) {
    if (!raw) return '';

    let text = String(raw)
      .replace(/\s+/g, ' ')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/[•▪▫◆◇★☆►▸➤→←↑↓|\\/_\-=+*~^`]+/g, ' ')
      .replace(/\b([A-Za-z])\s+(?=[A-Za-z]\b)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && !/[.!?…,:;]$/.test(text)) {
      text += '.';
    }

    return text;
  }

  function getSingleParagraphOrText(el) {
    if (!el) return '';

    const explicit =
      el.getAttribute('data-tts-text') ||
      el.getAttribute('data-tts-name') ||
      el.getAttribute('aria-label');

    if (explicit && explicit.trim()) {
      return cleanUtteranceText(extractFirstSentence(explicit));
    }

    if (el.tagName === 'IMG') {
      const altOrTitle = el.getAttribute('alt') || el.getAttribute('title') || '';
      return cleanUtteranceText(extractFirstSentence(altOrTitle));
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const valOrPh = el.value || el.getAttribute('placeholder') || '';
      return cleanUtteranceText(extractFirstSentence(valOrPh));
    }

    if (el.matches('article, section, div') && !el.matches('.product-card')) {
      const singlePara = el.querySelector('p, .product-desc, .description');
      if (singlePara) {
        const paraText = singlePara.innerText || singlePara.textContent || '';
        return cleanUtteranceText(extractFirstSentence(paraText));
      }
    }

    const rawContent = el.innerText || el.textContent || '';
    return cleanUtteranceText(extractFirstSentence(rawContent));
  }

  function formatSentence(el, mode) {
    const ttsType = (el.getAttribute('data-tts-type') || '').toLowerCase();

    const isButton =
      ttsType === 'button' ||
      el.tagName === 'BUTTON' ||
      el.getAttribute('role') === 'button' ||
      (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((el.type || '').toLowerCase()));

    const isProduct =
      ttsType === 'product' ||
      el.classList.contains('product-card') ||
      el.classList.contains('product-title') ||
      el.classList.contains('product-name');

    const isNavOrHeading =
      ttsType === 'heading' ||
      ttsType === 'menu' ||
      /^H[1-6]$/.test(el.tagName) ||
      el.tagName === 'A' ||
      Boolean(el.closest('nav'));

    let phrase = '';
    if (isProduct && !el.classList.contains('product-title') && !el.classList.contains('product-name')) {
      const titleNode = el.querySelector('.product-title, .product-name, [data-tts-type="product-title"], h2, h3');
      phrase = el.getAttribute('data-tts-name')
        ? cleanUtteranceText(extractFirstSentence(el.getAttribute('data-tts-name')))
        : getSingleParagraphOrText(titleNode || el);
    } else {
      phrase = getSingleParagraphOrText(el);
    }

    const core = phrase.replace(/[.!?]+$/g, '').trim();
    if (!core) return '';

    if (isButton) return `Ini adalah tombol ${core}.`;
    if (isProduct) return `Ini adalah produk ${core}.`;
    if (mode === 'click' && isNavOrHeading) return `Membuka ${core}.`;

    return `${core}.`;
  }

  function stopTTS(resetCurrent = true) {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (speakDelayId) {
      clearTimeout(speakDelayId);
      speakDelayId = null;
    }
    try {
      if (synth.speaking || synth.pending) {
        synth.cancel();
      }
    } catch (_) {}

    if (resetCurrent) {
      currentTarget = null;
      lastSpokenTarget = null;
    }
  }

  function syncToggleButtons() {
    document.querySelectorAll('[data-tts-action="toggle"]').forEach((btn) => {
      if (btn.getAttribute('data-tts-keep-label') === 'true') return;
      btn.textContent = isEnabled ? 'Nonaktifkan Suara' : 'Aktifkan Suara';
      btn.setAttribute('aria-pressed', String(isEnabled));
    });
  }

  function setTTSEnabled(enabled, options = {}) {
    const nextState = Boolean(enabled);
    const announce = Boolean(options.announce);

    isEnabled = nextState;
    saveEnabledState(isEnabled);
    syncToggleButtons();

    if (!isEnabled) {
      stopTTS(true);
    } else if (announce) {
      speakText('Fitur suara diaktifkan.', { force: true });
    }

    document.dispatchEvent(
      new CustomEvent('tts:statechange', {
        detail: { enabled: isEnabled }
      })
    );

    return isEnabled;
  }

  function speakText(text, options = {}) {
    if (!isEnabled && !options.force) return;

    const prepared = cleanUtteranceText(extractFirstSentence(text));
    if (!prepared) return;

    if (!indonesianVoice) syncVoice();

    stopTTS(false);

    // Jeda singkat agar synth.cancel() tidak membatalkan utterance baru di Chromium
    speakDelayId = setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(prepared);
      utter.lang = CONFIG.lang;
      utter.rate = CONFIG.rate;
      utter.pitch = CONFIG.pitch;
      utter.volume = CONFIG.volume;
      if (indonesianVoice) utter.voice = indonesianVoice;

      utter.onstart = () => {
        if (options.target instanceof Element) {
          lastSpokenTarget = options.target;
        }
      };

      utter.onend = () => {
        if (options.target === lastSpokenTarget) {
          lastSpokenTarget = null;
        }
      };

      try {
        synth.speak(utter);
      } catch (_) {}
    }, 30);
  }

  function resolveTarget(node) {
    if (!node || !(node instanceof Element)) return null;
    if (node.closest('[data-tts-action], [data-tts-ignore]')) return null;

    return node.closest(
      [
        '[data-tts-type]',
        '[data-tts-text]',
        '[data-tts-name]',
        'button',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        '[role="button"]',
        'a[href]',
        'h1, h2, h3, h4, h5, h6',
        '.product-card',
        '.product-title',
        '.product-name',
        '.product-desc',
        'p',
        'li',
        'img[alt]'
      ].join(',')
    );
  }

  document.addEventListener('pointerover', (e) => {
    if (!isEnabled || e.pointerType === 'touch') return;

    const target = resolveTarget(e.target);
    if (!target || target === currentTarget) return;

    currentTarget = target;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }

    if (target === lastSpokenTarget) return;

    const sentence = formatSentence(target, 'hover');
    if (!sentence) return;

    timerId = setTimeout(() => {
      if (isEnabled && currentTarget === target) {
        speakText(sentence, { mode: 'hover', target });
      }
    }, CONFIG.hoverDelay);
  });

  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch' || !currentTarget) return;

    const nextNode = e.relatedTarget;
    if (!nextNode || !currentTarget.contains(nextNode)) {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      currentTarget = null;
    }
  });

  document.addEventListener('click', (e) => {
    const actionEl = e.target instanceof Element ? e.target.closest('[data-tts-action]') : null;
    if (actionEl) {
      const action = actionEl.getAttribute('data-tts-action');
      if (action === 'stop') stopTTS(true);
      if (action === 'disable') setTTSEnabled(false);
      if (action === 'enable') setTTSEnabled(true, { announce: true });
      if (action === 'toggle') setTTSEnabled(!isEnabled, { announce: !isEnabled });
      return;
    }

    if (!isEnabled) return;

    const target = resolveTarget(e.target);
    if (!target) return;

    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }

    currentTarget = target;
    const sentence = formatSentence(target, 'click');
    if (!sentence) return;

    timerId = setTimeout(() => {
      if (isEnabled) {
        speakText(sentence, { mode: 'click', target });
      }
    }, CONFIG.clickDelay);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTTS(true);
  });

  window.addEventListener('beforeunload', () => {
    stopTTS(true);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleButtons);
  } else {
    syncToggleButtons();
  }

  window.stopTTS = () => stopTTS(true);
  window.speakTTS = (text) => speakText(text, { mode: 'api' });
  window.disableTTS = () => setTTSEnabled(false);
  window.enableTTS = (announce = false) => setTTSEnabled(true, { announce });
  window.toggleTTS = (announce = false) => setTTSEnabled(!isEnabled, { announce });
  window.isTTSEnabled = () => isEnabled;
})();0