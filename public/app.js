let ws;
let recorder;
let mediaStream;

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const audio = document.getElementById('audio');
const volume = document.getElementById('volume');
const errorContainer = document.getElementById('error-container');
const errorLog = document.getElementById('error-log');

const MAX_ERROR_ENTRIES = 50;

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
      console.error(`[Libre antenne] ${message}`);
    } else {
      console.error(`[Libre antenne] ${message}`, error);
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
    ws = new WebSocket(`${protocol}://${location.host}`);
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
