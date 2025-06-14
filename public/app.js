let ws;
let recorder;
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');

function updateButtons(isRecording) {
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

async function start() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  recorder.ondataavailable = e => { if (ws.readyState === 1) ws.send(e.data); };
  recorder.start(250);
  updateButtons(true);
}

function stop() {
  if (recorder) recorder.stop();
  if (ws) ws.close();
  updateButtons(false);
}

startBtn.onclick = start;
stopBtn.onclick = stop;

updateButtons(false);
