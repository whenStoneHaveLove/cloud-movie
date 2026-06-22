/**
 * [调试脚本] 通过本地代理测试和彩云 API 的加密请求/解密响应
 * 不参与主程序运行，仅用于开发调试。
 * 正式导入请使用 Web UI（js/share-parser.js）。
 */
const crypto = require('crypto');
const http = require('http');

const AES_KEY = 'PVGDwmcvfs1uV3d1';

function encrypt(data) {
    const plaintext = JSON.stringify(data);
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(AES_KEY, 'utf8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString('base64');
}

function decrypt(encoded) {
    const raw = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
    if (raw.length < 17) throw new Error('Too short: ' + raw.length);
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
        account: '',
        linkID: '2v3EqfwT2iSlr',
        passwd: 'hlsn',
        caSrt: 0, coSrt: 0, srtDr: 1,
        bNum: 1, pCaID: 'root', eNum: 200,
    }
};

const body = encrypt(payload);
console.log('Encrypted body:', body);
console.log('Encrypted body length:', body.length);

const req = http.request('http://localhost:8080/api/proxy', {
    method: 'POST',
    headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
    },
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response length:', data.length);
        if (data.length === 0) {
            console.log('Empty response');
            return;
        }
        try {
            const decrypted = decrypt(data);
            console.log('Decrypted response:', decrypted.substring(0, 500));
            const parsed = JSON.parse(decrypted);
            console.log('Result code:', parsed.body?.resultCode || parsed.resultCode || 'N/A');
            console.log('Full response:', JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.log('Decrypt failed:', e.message);
            console.log('Raw response (first 500):', data.substring(0, 500));
        }
    });
});

req.on('error', e => console.error('Request error:', e.message));
req.write(body);
req.end();