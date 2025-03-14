const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Add this before app initialization
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow;
let streamWindow = null;
let activeStreams = new Set(); // Track active camera IPs

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false); // Hide the default menu bar
}

function createStreamWindow(rtspUrl) {
  const streamWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webgl: true,
      enableWebGL: true
    },
    // Add GPU acceleration options
    backgroundColor: '#000000',
    show: false, // Don't show until ready
    frame: true
  });

  streamWindow.loadFile('stream-viewer.html');
  
  // Show window when ready to prevent white flash
  streamWindow.once('ready-to-show', () => {
    streamWindow.show();
  });

  // Handle WebGL context lost
  streamWindow.webContents.on('gpu-process-crashed', () => {
    console.log('GPU process crashed, restarting window...');
    streamWindow.reload();
  });
  
  streamWindow.webContents.on('did-finish-load', () => {
    streamWindow.webContents.send('rtsp-url', rtspUrl);
  });
}

ipcMain.on('open-stream', (event, rtspUrl) => {
  createStreamWindow(rtspUrl);
});

ipcMain.on('create-stream-window', () => {
    if (!streamWindow) {
        streamWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webgl: true,
                enableWebGL: true
            },
            backgroundColor: '#000000',
            show: false
        });

        streamWindow.setMenuBarVisibility(false);
        streamWindow.loadFile('stream-viewer.html');
        streamWindow.setFullScreenable(true);
        
        streamWindow.once('ready-to-show', () => {
            streamWindow.show();
        });

        streamWindow.webContents.on('gpu-process-crashed', () => {
            console.log('GPU process crashed, restarting window...');
            streamWindow.reload();
        });
        
        streamWindow.on('closed', () => {
            activeStreams.clear();
            streamWindow = null;
        });
    }
});

ipcMain.on('add-stream', (event, camera) => {
    if (streamWindow) {
        // Check if camera is already added
        if (!activeStreams.has(camera.ip)) {
            activeStreams.add(camera.ip);
            streamWindow.webContents.send('add-stream', camera);
        } else {
            mainWindow.webContents.send('camera-exists', camera.ip);
        }
    }
});

// Remove camera from tracking when stream is closed
ipcMain.on('stream-closed', (event, cameraIp) => {
    activeStreams.delete(cameraIp);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});