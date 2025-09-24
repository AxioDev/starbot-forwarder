let ws;
let recorder;
let mediaStream;
let statusSocket;

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const audio = document.getElementById('audio');
const volume = document.getElementById('volume');
const errorContainer = document.getElementById('error-container');
const errorLog = document.getElementById('error-log');
const speakersSection = document.getElementById('speakers-section');
const speakersList = document.getElementById('speakers-list');

const MAX_ERROR_ENTRIES = 50;
const SPEAKERS_RETRY_DELAY = 2000;

if (volume && audio) {
  volume.addEventListener('input', () => {
    audio.volume = volume.value;
  });
}

function getErrorDescription(error) {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof CloseEvent !== 'undefined' && error instanceof CloseEvent) {
    return `code ${error.code}${error.reason ? ` (${error.reason})` : ''}`;
  }

  if (error.error) {
    return getErrorDescription(error.error);
  }

  if (typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  if (error.reason) {
    return getErrorDescription(error.reason);
  }

  if (typeof error.name === 'string') {
    return error.name;
  }

  if (typeof error.type === 'string') {
    return error.type;
  }

  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return String(error);
  }
}

function logError(message, error) {
  const description = getErrorDescription(error);
  const timestamp = new Date().toLocaleTimeString();
  const formattedMessage = description ? `${message} : ${description}` : message;

  if (errorLog) {
    const entry = document.createElement('div');
    entry.className = 'border border-red-500/40 bg-red-500/10 text-red-200 px-3 py-2 rounded leading-relaxed break-words';
    entry.textContent = `[${timestamp}] ${formattedMessage}`;
    errorLog.appendChild(entry);

    while (errorLog.children.length > MAX_ERROR_ENTRIES) {
      errorLog.removeChild(errorLog.firstChild);
    }

    errorLog.scrollTop = errorLog.scrollHeight;
  }

  if (errorContainer) {
    errorContainer.classList.remove('hidden');
  }

  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    if (typeof error === 'undefined') {
      console.error(`[Libre Antenne] ${message}`);
    } else {
      console.error(`[Libre Antenne] ${message}`, error);
    }
  }
}

function updateButtons(isRecording) {
  if (!startBtn || !stopBtn) {
    return;
  }

  if (isRecording) {
    startBtn.textContent = 'En direct...';
    startBtn.classList.add('opacity-50', 'cursor-not-allowed');
    startBtn.disabled = true;

    stopBtn.disabled = false;
    stopBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    stopBtn.classList.add('bg-red-600', 'hover:bg-red-500');
  } else {
    startBtn.textContent = 'Parler';
    startBtn.disabled = false;
    startBtn.classList.remove('opacity-50', 'cursor-not-allowed');

    stopBtn.textContent = 'Stop';
    stopBtn.disabled = true;
    stopBtn.classList.remove('bg-red-600', 'hover:bg-red-500');
    stopBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
}

function releaseMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = undefined;
  }
}

async function start() {
  if (recorder && recorder.state === 'recording') {
    logError('Un enregistrement est déjà en cours');
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logError('Votre navigateur ne supporte pas l\'enregistrement audio');
    return;
  }

  try {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}?mode=upload`);
  } catch (error) {
    logError('Impossible de se connecter au serveur', error);
    updateButtons(false);
    return;
  }

  ws.addEventListener('error', event => {
    logError('Erreur WebSocket', event);
  });

  ws.addEventListener('close', event => {
    if (!event.wasClean) {
      logError('Connexion WebSocket interrompue', event);
    }
    ws = undefined;
    updateButtons(false);
  });

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    logError('Accès au micro refusé ou impossible', error);
    if (ws) {
      try {
        ws.close();
      } catch (closeError) {
        logError('Erreur lors de la fermeture de la connexion WebSocket', closeError);
      }
      ws = undefined;
    }
    updateButtons(false);
    return;
  }

  try {
    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
  } catch (error) {
    logError('Initialisation de l\'enregistreur audio impossible', error);
    releaseMediaStream();
    if (ws) {
      try {
        ws.close();
      } catch (closeError) {
        logError('Erreur lors de la fermeture de la connexion WebSocket', closeError);
      }
      ws = undefined;
    }
    updateButtons(false);
    return;
  }

  recorder.addEventListener('error', event => {
    logError('Erreur de l\'enregistreur audio', event);
  });

  recorder.addEventListener('stop', () => {
    releaseMediaStream();
    recorder = undefined;
  });

  recorder.ondataavailable = e => {
    if (!e.data || !e.data.size || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(e.data);
    } catch (error) {
      logError('Impossible d\'envoyer les données audio', error);
    }
  };

  try {
    recorder.start(250);
  } catch (error) {
    logError('Impossible de démarrer l\'enregistrement audio', error);
    releaseMediaStream();
    if (ws) {
      try {
        ws.close();
      } catch (closeError) {
        logError('Erreur lors de la fermeture de la connexion WebSocket', closeError);
      }
      ws = undefined;
    }
    recorder = undefined;
    updateButtons(false);
    return;
  }

  updateButtons(true);
}

function stop() {
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch (error) {
      logError('Erreur lors de l\'arrêt de l\'enregistrement audio', error);
      releaseMediaStream();
      recorder = undefined;
    }
  } else {
    releaseMediaStream();
    recorder = undefined;
  }

  if (ws) {
    try {
      ws.close();
    } catch (error) {
      logError('Erreur lors de la fermeture de la connexion WebSocket', error);
    }
    ws = undefined;
  }

  updateButtons(false);
}

if (startBtn) {
  startBtn.addEventListener('click', () => {
    start().catch(error => {
      logError('Erreur inattendue lors du démarrage', error);
    });
  });
}

if (stopBtn) {
  stopBtn.addEventListener('click', stop);
}

window.addEventListener('error', event => {
  logError('Erreur non gérée', event.error || event.message || event);
});

window.addEventListener('unhandledrejection', event => {
  logError('Promesse rejetée non gérée', event.reason);
});

updateButtons(false);
renderSpeakers([]);
connectStatusSocket();

function connectStatusSocket() {
  if (!speakersSection || !speakersList || typeof WebSocket === 'undefined') {
    return;
  }

  if (statusSocket && (statusSocket.readyState === WebSocket.OPEN || statusSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}?mode=status`);
  statusSocket = socket;

  socket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.type === 'speakers') {
        renderSpeakers(Array.isArray(payload.speakers) ? payload.speakers : []);
      }
    } catch (error) {
      console.error('[Libre Antenne] Impossible de lire la liste des orateurs', error);
    }
  });

  socket.addEventListener('close', () => {
    statusSocket = undefined;
    setTimeout(connectStatusSocket, SPEAKERS_RETRY_DELAY);
  });

  socket.addEventListener('error', event => {
    console.error('[Libre Antenne] Erreur du flux orateurs', event);
    socket.close();
  });
}

function renderSpeakers(speakers) {
  if (!speakersSection || !speakersList) {
    return;
  }

  const normalized = Array.isArray(speakers) ? speakers : [];
  const existingCards = new Map(Array.from(speakersList.children).map(child => [child.dataset.id, child]));

  normalized
    .map(speaker => normalizeSpeaker(speaker))
    .filter(Boolean)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .forEach(speaker => {
      const currentCard = existingCards.get(speaker.id);
      if (currentCard) {
        updateSpeakerCard(currentCard, speaker);
        existingCards.delete(speaker.id);
      } else {
        const card = createSpeakerCard(speaker);
        speakersList.appendChild(card);
      }
    });

  existingCards.forEach(card => {
    if (card && card.parentNode === speakersList) {
      card.remove();
    }
  });

  speakersSection.classList.toggle('hidden', speakersList.children.length === 0);
}

function normalizeSpeaker(rawSpeaker) {
  if (!rawSpeaker || (typeof rawSpeaker !== 'object' && typeof rawSpeaker !== 'function')) {
    return undefined;
  }

  const id = typeof rawSpeaker.id === 'string' && rawSpeaker.id.trim().length > 0
    ? rawSpeaker.id.trim()
    : (typeof rawSpeaker.userId === 'string' && rawSpeaker.userId.trim().length > 0
      ? rawSpeaker.userId.trim()
      : undefined);

  if (!id) {
    return undefined;
  }

  const displayName = getDisplayName(rawSpeaker, id);
  const avatarUrl = typeof rawSpeaker.avatarUrl === 'string' && rawSpeaker.avatarUrl.length > 0
    ? rawSpeaker.avatarUrl
    : (typeof rawSpeaker.avatar === 'string' && rawSpeaker.avatar.length > 0 ? rawSpeaker.avatar : undefined);

  return {
    id,
    displayName,
    avatarUrl,
    startedAt: typeof rawSpeaker.startedAt === 'number' ? rawSpeaker.startedAt : Date.now()
  };
}

function getDisplayName(rawSpeaker, id) {
  const candidates = [
    rawSpeaker.displayName,
    rawSpeaker.username,
    rawSpeaker.name,
    rawSpeaker.tag
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return `Intervenant ${id.slice(-4)}`;
}

function createSpeakerCard(speaker) {
  const card = document.createElement('article');
  card.className = 'speaker-card rounded-xl border border-green-500/25 bg-gray-900/60 px-4 py-4 flex items-center gap-4 shadow-lg';
  card.dataset.id = speaker.id;

  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = 'speaker-card-avatar';

  const avatarImage = document.createElement('img');
  avatarImage.className = 'hidden';
  avatarImage.decoding = 'async';
  avatarImage.loading = 'lazy';

  const avatarInitial = document.createElement('span');
  avatarInitial.className = 'speaker-card-initial text-green-100';

  avatarWrapper.appendChild(avatarImage);
  avatarWrapper.appendChild(avatarInitial);

  const content = document.createElement('div');
  content.className = 'flex-1 min-w-0';

  const name = document.createElement('p');
  name.className = 'speaker-card-name text-sm text-green-100 tracking-wide mb-1 truncate';

  const status = document.createElement('p');
  status.className = 'speaker-card-status text-xs uppercase tracking-[0.35em] text-green-300/80';

  content.appendChild(name);
  content.appendChild(status);

  card.appendChild(avatarWrapper);
  card.appendChild(content);

  updateSpeakerCard(card, speaker);
  requestAnimationFrame(() => card.classList.add('speaker-card--visible'));
  return card;
}

function updateSpeakerCard(card, speaker) {
  const name = card.querySelector('.speaker-card-name');
  const status = card.querySelector('.speaker-card-status');
  const avatarWrapper = card.querySelector('.speaker-card-avatar');
  const avatarImage = avatarWrapper.querySelector('img');
  const avatarInitial = avatarWrapper.querySelector('.speaker-card-initial');

  name.textContent = speaker.displayName;
  status.textContent = 'EN DIRECT';

  const accent = getAccentColor(speaker.id);
  const accentHsl = toHsl(accent);
  const accentHsla = toHsla(accent, 0.18);

  card.style.borderColor = toHsla(accent, 0.35);
  status.style.color = accentHsl;
  avatarWrapper.style.boxShadow = `0 0 0 1px ${accentHsl}`;
  avatarWrapper.style.background = accentHsla;

  if (speaker.avatarUrl) {
    avatarImage.src = speaker.avatarUrl;
    avatarImage.alt = speaker.displayName;
    avatarImage.classList.remove('hidden');
    avatarInitial.classList.add('hidden');
  } else {
    avatarImage.removeAttribute('src');
    avatarImage.classList.add('hidden');
    avatarInitial.textContent = speaker.displayName.slice(0, 2).toUpperCase();
    avatarInitial.classList.remove('hidden');
  }
}

function getAccentColor(seed) {
  let hash = 0;
  const source = seed || '';
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return { hue, saturation: 70, lightness: 55 };
}

function toHsl(color) {
  return `hsl(${color.hue}, ${color.saturation}%, ${color.lightness}%)`;
}

function toHsla(color, alpha) {
  return `hsla(${color.hue}, ${color.saturation}%, ${color.lightness}%, ${alpha})`;
}
