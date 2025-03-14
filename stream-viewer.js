const { ipcRenderer } = require('electron');
const streams = new Map(); // Store all stream instances

document.addEventListener('DOMContentLoaded', () => {
    const streamsContainer = document.getElementById('streamsContainer');

    ipcRenderer.on('add-stream', (event, camera) => {
        addStreamContainer(camera);
    });
});

function addStreamContainer(camera) {
    const streamDiv = document.createElement('div');
    streamDiv.id = `stream-${camera.ip}`;
    streamDiv.className = 'stream-container';
    streamDiv.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div class="stream-info">
                <strong>IP:</strong> ${camera.ip}
            </div>
            <div class="custom-control custom-switch">
                <input type="checkbox" class="custom-control-input" id="switch-${camera.ip}">
                <label class="custom-control-label" for="switch-${camera.ip}">Stream -</label>
            </div>
        </div>
        <div class="video-container" id="video-container-${camera.ip}">
            <video id="video-${camera.ip}" autoplay></video>
        </div>
    `;

    document.getElementById('streamsContainer').appendChild(streamDiv);

    // Add fullscreen handling
    const videoContainer = document.getElementById(`video-container-${camera.ip}`);
    const videoElement = document.getElementById(`video-${camera.ip}`);

    videoContainer.addEventListener('dblclick', () => {
        if (!videoContainer.classList.contains('fullscreen')) {
            videoContainer.classList.add('fullscreen');
            if (videoContainer.requestFullscreen) {
                videoContainer.requestFullscreen();
            }
        }
    });

    // Handle ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && videoContainer.classList.contains('fullscreen')) {
            videoContainer.classList.remove('fullscreen');
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });

    // Handle fullscreen change
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            videoContainer.classList.remove('fullscreen');
        }
    });

    const toggle = document.getElementById(`switch-${camera.ip}`);

    toggle.addEventListener('change', () => {
        if (toggle.checked) {
            startStream(camera.rtspLink, videoElement, camera.ip);
        } else {
            stopStream(camera.ip);
        }
    });
}

function startStream(rtspUrl, videoElement, streamId) {
    const { spawn } = require('child_process');
    
    const ffmpeg = spawn('ffmpeg', [
        '-i', rtspUrl,
        '-c:v', 'libvpx',
        '-c:a', 'libvorbis',
        '-f', 'webm',
        '-deadline', 'realtime',
        '-speed', '4',
        'pipe:1'
    ]);

    const mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        const sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8,vorbis"');
        
        ffmpeg.stdout.on('data', (data) => {
            try {
                sourceBuffer.appendBuffer(new Uint8Array(data));
            } catch (error) {
                console.error('Error appending buffer:', error);
            }
        });
    });

    ffmpeg.stderr.on('data', (data) => {
        console.log(`FFmpeg ${streamId}:`, data.toString());
    });

    streams.set(streamId, ffmpeg);
}

function stopStream(streamId) {
    const ffmpeg = streams.get(streamId);
    if (ffmpeg) {
        ffmpeg.kill();
        streams.delete(streamId);
    }
}

window.onbeforeunload = () => {
    for (const [streamId, ffmpeg] of streams) {
        ffmpeg.kill();
    }
    streams.clear();
};