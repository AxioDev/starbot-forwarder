let ws;
let recorder;

async function start() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  recorder.ondataavailable = e => { if (ws.readyState === 1) ws.send(e.data); };
  recorder.start(250);
}

function stop() {
  if (recorder) recorder.stop();
  if (ws) ws.close();
}

document.getElementById('start').onclick = start;
document.getElementById('stop').onclick = stop;
