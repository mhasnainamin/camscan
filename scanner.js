let cameraDetails = [];

document.getElementById('cameraFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        try {
            const text = await file.text();
            cameraDetails = text.split('\n')
                .map(line => line.trim())
                .filter(line => line)
                .map(line => {
                    const [mac, username, password, company] = line.split(/\s+/);
                    return { mac, username, password, company };
                });
            console.log('Loaded camera details:', cameraDetails);
        } catch (error) {
            console.error('Error reading file:', error);
        }
    }
});

async function startScan() {
    const port = document.getElementById('port').value;
    const ipPrefix = document.getElementById('ipPrefix').value;
    const resultsDiv = document.getElementById('results');
    const filteredDiv = document.getElementById('filteredResults');
    const loadingDiv = document.getElementById('loading');
    const progressDiv = document.getElementById('progress');
    const scanButton = document.getElementById('scanButton');

    if (!ipPrefix || !port) {
        resultsDiv.innerHTML = '<div class="error">IP prefix and port are required</div>';
        return;
    }

    try {
        resultsDiv.innerHTML = '';
        filteredDiv.innerHTML = '';
        loadingDiv.style.display = 'block';
        progressDiv.innerHTML = 'Initializing scan... 0%';
        scanButton.disabled = true;

        const foundDevices = [];
        
        // Create event source for SSE
        const eventSource = new EventSource(`/scan?port=${port}&ipPrefix=${ipPrefix}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'progress':
                    progressDiv.innerHTML = `Scanning network... ${data.progress}%`;
                    document.getElementById('progressBar').style.width = `${data.progress}%`;
                    break;
                    
                case 'device':
                    foundDevices.push(data.device);
                    displayResults(foundDevices, resultsDiv);
                    const filteredDevices = foundDevices.filter(d => d.rtspLinks);
                    if (filteredDevices.length > 0) {
                        displayFilteredResults(filteredDevices, filteredDiv);
                    }
                    break;
                    
                case 'complete':
                    eventSource.close();
                    progressDiv.innerHTML = 'Scan complete!';
                    break;
                    
                case 'error':
                    throw new Error(data.message);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            throw new Error('Connection lost');
        };

    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">${error.message}</div>`;
    } finally {
        scanButton.disabled = false;
    }
}

function displayFilteredResults(devices, container) {
    container.innerHTML = '<h2>Matched Cameras with RTSP Links</h2>';
    
    devices.forEach(device => {
        const div = document.createElement('div');
        div.className = 'camera-found';
        div.innerHTML = `
            <h3>${device.company} Camera at ${device.ip}</h3>
            <p>MAC: ${device.mac}</p>
            <div class="rtsp-link">
                <span class="stream-type">HD Stream:</span><br>
                ${device.rtspLinks.hd}
            </div>
            <div class="rtsp-link">
                <span class="stream-type">SD Stream:</span><br>
                ${device.rtspLinks.sd}
            </div>
        `;
        container.appendChild(div);
    });
}

function displayResults(devices, container) {
    const table = document.createElement('table');
    table.className = 'results-table';
    table.innerHTML = `
        <tr>
            <th>IP Address</th>
            <th>Port</th>
            <th>MAC Address</th>
            <th>Found At</th>
        </tr>
    `;

    devices.forEach(device => {
        const row = table.insertRow();
        row.innerHTML = `
            <td>${device.ip}</td>
            <td>${device.port}</td>
            <td>${device.mac}</td>
            <td>${new Date(device.timestamp).toLocaleString()}</td>
        `;
    });

    container.appendChild(table);
}