const express = require('express');
const net = require('net');
const { exec } = require('child_process');
const app = express();
const port = 3000;

app.use(express.static('.'));

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

async function getMacAddress(ip) {
    return new Promise((resolve) => {
        // Use system's arp command to get MAC address
        exec(`ping -n 1 ${ip} && arp -a ${ip}`, (error, stdout) => {
            if (error) {
                resolve('Unknown');
                return;
            }
            
            const macMatch = stdout.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
            resolve(macMatch ? macMatch[0] : 'Unknown');
        });
    });
}

function generateRtspLink(camera, ip) {
    const { username, password, company } = camera;
    if (company.toLowerCase() === 'tapo') {
        return {
            hd: `rtsp://${username}:${password}@${ip}:554/stream1`,
            sd: `rtsp://${username}:${password}@${ip}:554/stream2`
        };
    } else {
        return {
            hd: `rtsp://${username}:${password}@${ip}:554/cam/realmonitor?channel=1&subtype=0`,
            sd: `rtsp://${username}:${password}@${ip}:554/cam/realmonitor?channel=1&subtype=1`
        };
    }
}

app.get('/scan', async (req, res) => {
    try {
        const scanPort = parseInt(req.query.port);
        const subnet = req.query.ipPrefix;
        const batchSize = 10; // Reduced batch size to accommodate MAC address lookup

        if (!subnet || !scanPort || scanPort < 1 || scanPort > 65535) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const cameras = [];
        console.log(`Starting scan on subnet ${subnet} port ${scanPort}`);

        const ipAddresses = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
        
        // Scan in batches
        for (let i = 0; i < ipAddresses.length; i += batchSize) {
            const batch = ipAddresses.slice(i, i + batchSize);
            const promises = batch.map(async ip => {
                try {
                    const isOpen = await checkPort(ip, scanPort);
                    if (isOpen) {
                        const mac = await getMacAddress(ip);
                        cameras.push({ 
                            ip, 
                            port: scanPort,
                            mac,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`Found device at ${ip}:${scanPort} MAC: ${mac}`);
                    }
                } catch (error) {
                    console.error(`Error scanning ${ip}:${scanPort}:`, error);
                }
            });
            await Promise.all(promises);
        }

        console.log(`Scan complete. Found ${cameras.length} devices`);
        res.json(cameras);
    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/scan', express.json(), async (req, res) => {
    try {
        const { port: scanPort, ipPrefix, cameraDetails } = req.body;
        const subnet = ipPrefix || '192.168.18';
        const batchSize = 10;
        
        // Input validation...

        const cameras = [];
        const cameraMap = new Map(
            cameraDetails.map(cam => [cam.mac.toLowerCase(), cam])
        );

        // Send headers for SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const totalIPs = 254;
        let scannedCount = 0;

        // Scan in batches
        for (let i = 1; i < 255; i += batchSize) {
            const batch = Array.from({length: Math.min(batchSize, 255-i)}, (_, j) => i + j);
            const promises = batch.map(async num => {
                const ip = `${subnet}.${num}`;
                try {
                    const isOpen = await checkPort(ip, scanPort);
                    scannedCount++;
                    
                    // Send progress update
                    const progress = Math.floor((scannedCount / totalIPs) * 100);
                    res.write(`data: ${JSON.stringify({ type: 'progress', progress })}\n\n`);

                    if (isOpen) {
                        const mac = await getMacAddress(ip);
                        const cameraInfo = cameraMap.get(mac.toLowerCase());
                        
                        const device = {
                            ip,
                            port: scanPort,
                            mac,
                            timestamp: new Date().toISOString()
                        };

                        if (cameraInfo) {
                            device.username = cameraInfo.username;
                            device.password = cameraInfo.password;
                            device.company = cameraInfo.company;
                            device.rtspLinks = generateRtspLink(cameraInfo, ip);
                        }

                        cameras.push(device);
                        // Send device found update
                        res.write(`data: ${JSON.stringify({ type: 'device', device })}\n\n`);
                    }
                } catch (error) {
                    console.error(`Error scanning ${ip}:${scanPort}:`, error);
                }
            });
            await Promise.all(promises);
        }

        // Send completion message
        res.write(`data: ${JSON.stringify({ type: 'complete', cameras })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Scan error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
    }
});

function checkPort(ip, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, ip);
    });
}

app.listen(port, () => {
    console.log(`Scanner app running at http://localhost:${port}`);
});