const url = 'http://localhost:3008/api/optimize';

async function testApi() {
    console.log(`Testing ${url}...`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requirements: [], mode: 'full' })
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`Body: ${text.substring(0, 100)}`);
    } catch (error) {
        console.error('Fetch failed:', error.message);
    }
}

testApi();
