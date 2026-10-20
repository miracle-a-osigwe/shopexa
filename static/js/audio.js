/**
 * Shopexa Ops — Dedicated Audio & Speech Engine (Pure Nova Sonic Stream)
 * Full-duplex 16kHz PCM capture with downsampler, 24kHz/16kHz PCM queue playback,
 * zero WebSpeech fallback, and full-duplex conversational barge-in.
 */

// ── Global Audio State ────────────────────────────────────────────────────────
let isMicActive         = false;
let isSpeaking          = false;
let playingAudio        = false;
let isFadingOut         = false;
let audioQueue          = [];
let activeAudioSources  = [];
let currentSpokenText   = '';
let recentSpokenTexts   = [];
let lastSpeechEndTime   = 0;
let pendingAmbientAlert = null;

// Nova Sonic output is 24kHz PCM by default (can be updated via session_ready)
let streamAudioCtx        = null;
let streamMasterGain       = null;
let streamAudioSampleRate  = 24000; 
let nextPlayTime           = 0;
let _speakingFinishedTimer = null;

// Microphone capture state
let audioCtx     = null;
let mediaStream  = null;
let processor    = null;
const speechRec  = null; // Completely disabled — pure Sonic streaming

// ── 1. Audio Playback Engine (Smooth 24kHz / 16kHz Queued PCM) ─────────────────
function initStreamAudioContext() {
  if (!streamAudioCtx || streamAudioCtx.state === 'closed') {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    // Let browser use native hardware rate for stability; createBuffer will resample cleanly
    streamAudioCtx = new AudioCtxClass();
    streamMasterGain = streamAudioCtx.createGain();
    streamMasterGain.gain.setValueAtTime(1.0, streamAudioCtx.currentTime);
    streamMasterGain.connect(streamAudioCtx.destination);
    nextPlayTime = streamAudioCtx.currentTime;
    activeAudioSources = [];
  }
  if (streamAudioCtx.state === 'suspended') {
    streamAudioCtx.resume();
  }
}

function playNextAudio() {
  if (audioQueue.length === 0 || isFadingOut) return;
  initStreamAudioContext();

  if (_speakingFinishedTimer) {
    clearTimeout(_speakingFinishedTimer);
    _speakingFinishedTimer = null;
  }

  while (audioQueue.length > 0) {
    const b64 = audioQueue.shift();
    try {
      const rawStr = atob(b64);
      const sampleCount = Math.floor(rawStr.length / 2);
      if (sampleCount === 0) continue;

      const f32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        let val = rawStr.charCodeAt(i * 2) | (rawStr.charCodeAt(i * 2 + 1) << 8);
        if (val >= 32768) val -= 65536;
        f32[i] = val / 32768.0;
      }

      // Web Audio resamples the buffer from streamAudioSampleRate to streamAudioCtx.sampleRate
      const buffer = streamAudioCtx.createBuffer(1, f32.length, streamAudioSampleRate);
      buffer.copyToChannel(f32, 0);

      const src = streamAudioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(streamMasterGain);

      const now = streamAudioCtx.currentTime;
      if (nextPlayTime < now) {
        nextPlayTime = now + 0.02;
      }

      src.start(nextPlayTime);
      nextPlayTime += buffer.duration;
      playingAudio = true;
      isSpeaking = true;
      if (typeof setOrbState === 'function') setOrbState('speaking');
      activeAudioSources.push(src);

      src.onended = () => {
        const idx = activeAudioSources.indexOf(src);
        if (idx !== -1) activeAudioSources.splice(idx, 1);

        if (streamAudioCtx && streamAudioCtx.currentTime >= nextPlayTime - 0.08 && audioQueue.length === 0 && !isFadingOut) {
          if (_speakingFinishedTimer) clearTimeout(_speakingFinishedTimer);
          _speakingFinishedTimer = setTimeout(() => {
            _speakingFinishedTimer = null;
            if (audioQueue.length === 0 && !isFadingOut) onSpeakingFinished();
          }, 200);
        }
      };
    } catch(e) {
      console.error("PCM Chunk Decode Error:", e);
    }
  }
}

function smoothBargeInStop(reason = 'User speech detected') {
  if (typeof VoiceCaption !== 'undefined' && VoiceCaption.clear) {
    VoiceCaption.clear();
  }
  if (!playingAudio && audioQueue.length === 0 && (!activeAudioSources || activeAudioSources.length === 0)) {
    return;
  }
  isFadingOut = true;
  audioQueue = []; // Purge upcoming audio chunks immediately

  if (streamAudioCtx && streamMasterGain) {
    try {
      const now = streamAudioCtx.currentTime;
      streamMasterGain.gain.cancelScheduledValues(now);
      streamMasterGain.gain.setValueAtTime(Math.max(streamMasterGain.gain.value, 0.001), now);
      streamMasterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

      setTimeout(() => {
        for (const src of activeAudioSources) {
          try { src.stop(); src.disconnect(); } catch(_) {}
        }
        activeAudioSources = [];
        nextPlayTime = 0;
        try {
          if (streamMasterGain && streamAudioCtx) {
            streamMasterGain.gain.setValueAtTime(1.0, streamAudioCtx.currentTime);
          }
        } catch(_) {}
        isFadingOut = false;
        onSpeakingFinished();
      }, 65);
    } catch(e) {
      isFadingOut = false;
      onSpeakingFinished();
    }
  } else {
    isFadingOut = false;
    onSpeakingFinished();
  }

  // Also halt HTML5 audio element if active
  const audioOut = document.getElementById('audio-out');
  if (audioOut && !audioOut.paused) {
    audioOut.pause();
    audioOut.currentTime = 0;
  }

  if (typeof addHudEvent === 'function') {
    addHudEvent('barge_in', 'BARGE_IN', `${reason} — audio playback truncated`);
  }
}

function stopAllAudioOutput() {
  smoothBargeInStop('System reset');
}

function onSpeakingFinished() {
  isSpeaking = false;
  playingAudio = false;
  lastSpeechEndTime = Date.now();
  if (typeof setOrbState === 'function') setOrbState(isMicActive ? 'listening' : '');

  setTimeout(() => {
    if (!isSpeaking && !playingAudio && typeof VoiceCaption !== 'undefined') {
      VoiceCaption.clear();
    }
  }, 2000);

  // Release any queued ambient alerts
  if (pendingAmbientAlert && typeof isChatBusy !== 'undefined' && !isChatBusy) {
    const held = pendingAmbientAlert;
    pendingAmbientAlert = null;
    if (typeof addHudEvent === 'function') {
      addHudEvent('ambient', 'ALERT_RELEASED', `Releasing held alert: ${held.scenario}`);
    }
    setTimeout(() => {
      if (typeof handleAmbientScenario === 'function') {
        handleAmbientScenario(held, false, true);
      }
    }, 400);
  }
}

function playInterruptionChime(callback) {
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    const chimeCtx = new AudioCtxClass();
    const osc = chimeCtx.createOscillator();
    const gain = chimeCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, chimeCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, chimeCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.08, chimeCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, chimeCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(chimeCtx.destination);
    osc.onended = () => { try { chimeCtx.close(); } catch(_) {} };
    osc.start();
    osc.stop(chimeCtx.currentTime + 0.36);
  } catch(_) {}
  setTimeout(() => { if (typeof callback === 'function') callback(); }, 380);
}

// ── 2. Full-Duplex Microphone Capture & 16kHz Resampler ───────────────────────
async function startMic() {
  if (mediaStream && mediaStream.active && processor && audioCtx && audioCtx.state !== 'closed') {
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch(_) {}
    }
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtxClass();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = e => {
      // Must be active and connected to stream
      if (typeof sessionReady === 'undefined' || !sessionReady || !isMicActive) return;

      // 2. ECHOGUARD: Do NOT stream mic data while Nova Sonic is speaking or during echo cooldown
      const now = Date.now();
      const isEchoCooldown = (now - lastSpeechEndTime < 400); // 400ms cooldown for room reverb
      if (isSpeaking || playingAudio || isEchoCooldown) {
        return; // Suppress mic input so Nova Sonic cannot hear itself through the speakers
      }

      const inputFloats = e.inputBuffer.getChannelData(0);

      // Local energy threshold for instant barge-in feedback while agent speaks
      if (isSpeaking || playingAudio) {
        let sum = 0;
        for (let i = 0; i < inputFloats.length; i++) {
          sum += inputFloats[i] * inputFloats[i];
        }
        const rms = Math.sqrt(sum / inputFloats.length);
        if (rms > 0.05) { // User started speaking over assistant
          smoothBargeInStop('User speech barge-in');
        }
      }

      // High-quality downsampling from hardware rate (44.1k/48k) to Nova Sonic 16kHz PCM
      const pcm16 = downsampleTo16k(inputFloats, audioCtx.sampleRate);
      const b64 = int16ToBase64(pcm16);

      if (typeof voiceWS !== 'undefined' && voiceWS && voiceWS.readyState === WebSocket.OPEN) {
        voiceWS.send(JSON.stringify({ type: 'audio', data: b64 }));
      }
    };

    source.connect(processor);
    const muteGain = audioCtx.createGain();
    muteGain.gain.value = 0;
    processor.connect(muteGain);
    muteGain.connect(audioCtx.destination);

  } catch(e) {
    console.error("Microphone Access Error:", e);
    if (typeof addHudEvent === 'function') addHudEvent('audio', 'MIC_ERROR', e.message);
    isMicActive = false;
    if (typeof setOrbState === 'function') setOrbState('');
    if (typeof showResponse === 'function') {
      showResponse('Microphone access failed: ' + e.message);
    }
  }
}

function stopMic() {
  if (processor)      { processor.disconnect(); processor = null; }
  if (audioCtx)       { audioCtx.close(); audioCtx = null; }
  smoothBargeInStop('Microphone stopped');
  if (streamAudioCtx) { try { streamAudioCtx.close(); } catch(_) {} streamAudioCtx = null; }
  if (mediaStream)    { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (typeof sessionReady !== 'undefined') sessionReady = false;
  nextPlayTime = 0;
}

// ── 3. High-Quality Downsampler & PCM Helpers ──────────────────────────────────
function downsampleTo16k(inputBuffer, inputSampleRate) {
  if (inputSampleRate === 16000) {
    const out = new Int16Array(inputBuffer.length);
    for (let i = 0; i < inputBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, inputBuffer[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputBuffer.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffsetInput && i < inputBuffer.length; i++) {
      accum += inputBuffer[i];
      count++;
    }
    const sample = count > 0 ? (accum / count) : inputBuffer[offsetInput];
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    offsetResult++;
    offsetInput = nextOffsetInput;
  }
  return result;
}

function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}