const https = require('https');

console.log('Testing TMDB connection...');
console.log('Node version:', process.version);

const params = new URLSearchParams({
    api_key: '102d8ab756b51c42db4290c0a9909dde',
    query: 'test',
    language: 'zh-CN'
});
const path = '/3/search/movie?' + params.toString();

console.log('Requesting:', path.substring(0, 80));

const req = https.request({
    hostname: 'api.themoviedb.org',
    path: path,
    family: 4,
}, (res) => {
    console.log('✅ Response:', res.statusCode);
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('Body length:', d.length);
        console.log('Data:', d.substring(0, 300));
        process.exit(0);
    });
});

req.on('error', (e) => {
    console.log('❌ Error:', e.code, e.message);
    process.exit(1);
});

req.on('socket', (sock) => {
    console.log('Socket event');
    sock.on('connect', () => console.log('✅ TCP connected'));
    sock.on('lookup', (err, addr, fam) => console.log('DNS resolved:', addr, 'family:', fam));
    sock.on('error', (e) => console.log('Socket err:', e.code, e.message));
});

req.end();

setTimeout(() => {
    console.log('❌ Timeout after 15s');
    process.exit(1);
}, 15000);
