const http = require('http');

const ports = [3008, 3009, 5173];

function checkPort(port) {
    const data = JSON.stringify({
        requirements: [],
        mode: 'full'
    });

    const options = {
        hostname: 'localhost',
        port: port,
        path: '/api/optimize',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        },
        timeout: 1000
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log(`[${port}] STATUS: ${res.statusCode}`);
            console.log(`[${port}] BODY: ${body}`);
        });
    });

    req.on('error', (e) => {
        console.log(`[${port}] Connection failed: ${e.message}`);
    });

    req.write(data);
    req.end();
}

ports.forEach(checkPort);
