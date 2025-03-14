const { exec } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcRenderer, clipboard, app } = require('electron');

// Function to get the correct path for mac_addresses.txt
function getMacAddressesFilePath() {
    // First, try the app's resource directory
    const resourcePath = path.join(process.resourcesPath, 'mac_addresses.txt');
    if (fs.existsSync(resourcePath)) {
        return resourcePath;
    }

    // If not in resources, try the app's directory
    const appPath = path.join(__dirname, 'mac_addresses.txt');
    if (fs.existsSync(appPath)) {
        return appPath;
    }

    // If not found, create in the user's data directory
    const userDataPath = path.join(os.homedir(), '.ip-camera-scanner', 'mac_addresses.txt');
    
    // Ensure the directory exists
    const userDataDir = path.dirname(userDataPath);
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    // Create an empty file if it doesn't exist
    if (!fs.existsSync(userDataPath)) {
        fs.writeFileSync(userDataPath, '', 'utf8');
    }

    return userDataPath;
}

// Check if nmap is installed on startup
document.addEventListener('DOMContentLoaded', checkDependencies);

function checkDependencies() {
    const scanButton = document.getElementById('scan-button');
    const statusLabel = document.getElementById('status-label');

    try {
        execSync('nmap --version', { stdio: 'pipe' });
    } catch (error) {
        statusLabel.textContent = 'Error: Nmap is not installed. Please install Nmap first.';
        scanButton.disabled = true;
        return;
    }

    // Check for mac_addresses.txt
    const macAddressesPath = getMacAddressesFilePath();
    if (!fs.existsSync(macAddressesPath)) {
        statusLabel.textContent = 'Warning: mac_addresses.txt not found. Created empty file.';
        fs.writeFileSync(macAddressesPath, '', 'utf8');
    }
}

document.getElementById('scan-button').addEventListener('click', startScan);

async function startScan() {
    const scanButton = document.getElementById('scan-button');
    const statusLabel = document.getElementById('status-label');
    const resultTableBody = document.getElementById('results-tbody');

    if (!resultTableBody) {
        console.error('Table body element not found');
        return;
    }

    try {
        scanButton.disabled = true;
        statusLabel.textContent = 'Scanning network...';
        resultTableBody.innerHTML = '';

        const localIp = getLocalIp();
        if (!localIp) throw new Error('Unable to determine local IP address');

        const network = `${localIp.substring(0, localIp.lastIndexOf('.'))}.0/24`;
        console.log(`Scanning network: ${network}`);

        const ports = '554,8554,8000,8080';
        const nmapCommand = `nmap -p ${ports} -sS --min-rate=1000 ${network}`;
        exec(nmapCommand, async (error, stdout, stderr) => {
            try {
                if (error) throw new Error(`Nmap error: ${error.message}`);
                if (stderr && !stderr.includes('Starting Nmap')) {
                    throw new Error(`Nmap stderr: ${stderr}`);
                }

                const hosts = parseNmapOutput(stdout);
                const macAddressesPath = getMacAddressesFilePath();
                const macAddresses = loadMacAddresses(macAddressesPath);
                const cameras = [];

                for (const host of hosts) {
                    statusLabel.textContent = `Scanning ${host}...`;
                    const mac = await getMacAddress(host);
                    console.log(`Host: ${host}, MAC: ${mac}`);
                    
                    if (!mac) continue;

                    const credentials = macAddresses.find(entry => 
                        entry.mac.toLowerCase() === mac.toLowerCase()
                    );

                    if (credentials) {
                        const camera = {
                            ip: host,
                            mac,
                            manufacturer: credentials.manufacturer || 'Unknown',
                            rtspLink: generateRtspLink(
                                { 
                                    username: credentials.username, 
                                    password: credentials.password 
                                }, 
                                host, 
                                credentials.manufacturer
                            )
                        };
                        cameras.push(camera);
                    }
                }

                updateResultsTable(cameras, resultTableBody);
                statusLabel.textContent = `Scan completed. Found ${cameras.length} cameras.`;

            } catch (err) {
                console.error(err);
                statusLabel.textContent = `Error: ${err.message}`;
            } finally {
                scanButton.disabled = false;
            }
        });

    } catch (err) {
        console.error(err);
        statusLabel.textContent = `Error: ${err.message}`;
        scanButton.disabled = false;
    }
}

function generateRtspLink(credentials, host, manufacturer) {
    const { username, password } = credentials;
    
    switch (manufacturer.toLowerCase()) {
        case 'tapo':
            // Default Tapo RTSP link format
            return `rtsp://${username}:${password}@${host}:554/stream2`;
        
        case 'imou':
        case 'dahua':
            // Generic IP camera RTSP link format for IMOU, Dahua, and others
            return `rtsp://${username}:${password}@${host}:554/cam/realmonitor?channel=1&subtype=1`;
        
        default:
            // Fallback to default format if manufacturer is not recognized
            return `rtsp://${username}:${password}@${host}:554/stream2`;
    }
}

let streamWindow = null;

function updateResultsTable(cameras, resultTable) {
    if (cameras.length === 0) {
        const row = resultTable.insertRow();
        const cell = row.insertCell(0);
        cell.colSpan = 3;
        cell.textContent = 'No cameras found';
        return;
    }

    cameras.forEach(camera => {
        const row = resultTable.insertRow();
        row.insertCell(0).textContent = camera.ip;
        row.insertCell(1).textContent = camera.mac;
        
        const linkCell = row.insertCell(2);
        
        // Create Copy Link button
        const rtspLink = document.createElement('button');
        rtspLink.className = 'btn btn-sm btn-outline-primary mr-2';
        rtspLink.textContent = 'Copy Link';
        rtspLink.onclick = () => {
            clipboard.writeText(camera.rtspLink);
            rtspLink.textContent = 'Copied!';
            setTimeout(() => {
                rtspLink.textContent = 'Copy Link';
            }, 1000);
        };
        
        // Create View Stream button
        const viewStream = document.createElement('button');
        viewStream.className = 'btn btn-sm btn-primary';
        viewStream.textContent = 'View Stream';
        viewStream.onclick = () => {
            if (!streamWindow) {
                ipcRenderer.send('create-stream-window');
                // Wait for window to be ready before sending stream
                setTimeout(() => {
                    ipcRenderer.send('add-stream', camera);
                }, 1000);
            } else {
                ipcRenderer.send('add-stream', camera);
            }
        };
        
        linkCell.appendChild(rtspLink);
        linkCell.appendChild(viewStream);
    });
}

function getLocalIp() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
        return iface.address;
      }
    }
  }
  return null;
}

function parseNmapOutput(output) {
  const hosts = [];
  const lines = output.split('\n');
  lines.forEach(line => {
    const match = line.match(/Nmap scan report for (.+)/);
    if (match) {
      hosts.push(match[1]);
    }
  });
  return hosts;
}

async function getMacAddress(ip) {
    try {
        const arpOutput = execSync(`arp -a ${ip}`).toString();
        const match = arpOutput.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/i);
        return match ? match[0].toLowerCase() : null;
    } catch (error) {
        console.error(`ARP error for ${ip}: ${error.message}`);
        return null;
    }
}

function loadMacAddresses(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.trim()) {
            return [];
        }

        // Parse plain text file with space-separated values
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                // Split by whitespace, allowing for flexible spacing
                const parts = line.split(/\s+/);
                
                // Ensure we have at least 4 parts (MAC, username, password, manufacturer)
                if (parts.length < 4) {
                    console.warn(`Invalid MAC address entry: ${line}`);
                    return null;
                }

                return {
                    mac: parts[0],
                    username: parts[1],
                    password: parts[2],
                    manufacturer: parts.slice(3).join(' ') // Allow manufacturer to have multiple words
                };
            })
            .filter(entry => entry !== null); // Remove any invalid entries
    } catch (error) {
        console.error('Error reading MAC addresses file:', error);
        return [];
    }
}

function handleError(error, statusLabel) {
    console.error(error);
    statusLabel.textContent = `Error: ${error.message}`;
}

// Add event listener for duplicate camera notification
ipcRenderer.on('camera-exists', (event, cameraIp) => {
    const statusLabel = document.getElementById('status-label');
    statusLabel.textContent = `Camera ${cameraIp} is already being viewed`;
    setTimeout(() => {
        statusLabel.textContent = 'Ready to scan';
    }, 2000);
});

// Update stopStream function to notify main process
function stopStream(streamId) {
    const ffmpeg = streams.get(streamId);
    if (ffmpeg) {
        ffmpeg.kill();
        streams.delete(streamId);
        ipcRenderer.send('stream-closed', streamId);
    }
}