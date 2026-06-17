const crypto = require('crypto');
const https = require('https');

const AES_KEY = 'PVGDwmcvfs1uV3d1';

function encrypt(data) {
    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(AES_KEY, 'utf8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString('base64');
}

function decrypt(encoded) {
    const raw = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
    if (raw.length < 17) throw new Error('Response too short, length: ' + raw.length);
    const iv = raw.subarray(0, 16);
    const ciphertext = raw.subarray(16);
    const key = Buffer.from(AES_KEY, 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

const payload = {
    getOutLinkInfoReq: {
        account: "",
        linkID: "2v3EqfwT2iSlr",
        passwd: "hlsn",
        caSrt: 0,
        coSrt: 0,
        srtDr: 1,
        bNum: 1,
        pCaID: "root",
        eNum: 200
    }
};

const body = encrypt(payload);
console.error('Encrypted body length:', body.length);
console.error('Encrypted body (first 80):', body.substring(0, 80));

const options = {
    hostname: 'share-kd-njs.yun.139.com',
    path: '/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6',
    method: 'POST',
    headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://yun.139.com',
        'Referer': 'https://yun.139.com/',
        'Accept': '*/*',
    }
};

const req = https.request(options, (res) => {
    console.error('Status:', res.statusCode);
    console.error('Headers:', JSON.stringify(res.headers, null, 2));
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.error('Response length:', data.length);
        if (data.length === 0) {
            console.log('Empty response');
            return;
        }
        try {
            const decrypted = decrypt(data);
            const parsed = JSON.parse(decrypted);
            console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.error('Error:', e.message);
            console.error('Raw (first 300):', data.substring(0, 300));
        }
    });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
