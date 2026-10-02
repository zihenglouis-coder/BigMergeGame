'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, '.private-data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');
const PORT = Number(process.env.PORT) || 8080;
function loadSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const file = path.join(DATA_DIR, 'session.secret');
    try { return fs.readFileSync(file, 'utf8').trim(); }
    catch (_) {
        fs.mkdirSync(DATA_DIR, {recursive: true});
        const value = crypto.randomBytes(48).toString('hex');
        fs.writeFileSync(file, value, {mode: 0o600, flag: 'wx'});
        return value;
    }
}
const SECRET = loadSecret();
const MAX_BODY = 16 * 1024;
const TOKEN_LIFETIME = 7 * 24 * 60 * 60;
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
let db = {users: [], guests: []};
try { db = {...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))}; }
catch (error) { if (error.code !== 'ENOENT') console.error('Could not read score database:', error.message); }

function persist() {
    fs.mkdirSync(DATA_DIR, {recursive: true});
    const temp = DATA_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(db), {mode: 0o600});
    fs.renameSync(temp, DATA_FILE);
}
function cleanName(value, fallback = '访客') {
    const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
    return name || fallback;
}
function guestFor(deviceId, name) {
    let guest = db.guests.find(item => item.id === deviceId);
    if (!guest) {
        guest = {id: deviceId, displayName: cleanName(name, '访客' + deviceId.slice(-4)), best: 0};
        db.guests.push(guest);
    } else if (name) guest.displayName = cleanName(name, guest.displayName);
    return guest;
}
function issueToken(user) {
    const payload = Buffer.from(JSON.stringify({sub:user.id, exp:Math.floor(Date.now()/1000)+TOKEN_LIFETIME})).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    return payload + '.' + sig;
}
function userFrom(req) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest();
    let actual;
    try { actual = Buffer.from(sig, 'base64url'); } catch (_) { return null; }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (data.exp < Date.now()/1000) return null;
        return db.users.find(user => user.id === data.sub) || null;
    } catch (_) { return null; }
}
function send(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(body)});
    res.end(body);
}
function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY) reject(Object.assign(new Error('请求太大。'), {status:413}));
        });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (_) { reject(Object.assign(new Error('请求格式无效。'), {status:400})); }
        });
        req.on('error', reject);
    });
}
function username(value) { return String(value || '').trim(); }
function passwordError(pass) { return typeof pass !== 'string' || pass.length < 8 || pass.length > 128; }
function hashPassword(pass, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => crypto.scrypt(pass, salt, 64, (err, key) => err ? reject(err) : resolve({salt, passwordHash:key.toString('hex')})));
}
function matchPassword(pass, user) {
    return new Promise((resolve, reject) => crypto.scrypt(pass, user.salt, 64, (err, key) => {
        if (err) return reject(err);
        const stored = Buffer.from(user.passwordHash, 'hex');
        resolve(stored.length === key.length && crypto.timingSafeEqual(stored, key));
    }));
}
const failedLogins = new Map();

const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    try {
        if (url.pathname.startsWith('/api/')) {
            if (req.method === 'GET' && url.pathname === '/api/me') {
                const user = userFrom(req);
                if (user) return send(res,200,{kind:'account',displayName:user.displayName,best:user.best});
                const id = String(url.searchParams.get('deviceId') || '');
                if (!/^[a-zA-Z0-9_-]{6,100}$/.test(id)) return send(res,400,{error:'设备编号无效。'});
                const guest = guestFor(id, url.searchParams.get('displayName'));
                persist(); return send(res,200,{kind:'guest',displayName:guest.displayName,best:guest.best});
            }
            if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
                const user = userFrom(req), id = String(url.searchParams.get('deviceId') || '');
                if (!user && /^[a-zA-Z0-9_-]{6,100}$/.test(id)) guestFor(id);
                const entries = [
                    ...db.users.filter(x=>x.best>0).map(x=>({displayName:x.displayName,score:x.best,kind:'account'})),
                    ...db.guests.filter(x=>x.best>0).map(x=>({displayName:x.displayName,score:x.best,kind:'guest'}))
                ].sort((a,b)=>b.score-a.score || a.displayName.localeCompare(b.displayName))
                 .slice(0,50);
                return send(res,200,{entries});
            }
            if (req.method === 'POST' && url.pathname === '/api/auth/register') {
                const body=await readJson(req), name=username(body.username), pass=body.password;
                if (!/^[\p{L}\p{N}_-]{2,18}$/u.test(name)) return send(res,400,{error:'账号需为 2–18 位中英文、数字、下划线或短横线。'});
                if (passwordError(pass)) return send(res,400,{error:'密码需为 8–128 个字符。'});
                if (db.users.some(x=>x.username.toLowerCase()===name.toLowerCase())) return send(res,409,{error:'这个账号名已被使用。'});
                const credentials=await hashPassword(pass);
                const user={id:crypto.randomUUID(),username:name,displayName:name,best:0,...credentials};
                db.users.push(user); persist();
                return send(res,201,{token:issueToken(user)});
            }
            if (req.method === 'POST' && url.pathname === '/api/auth/login') {
                const address=req.socket.remoteAddress||'unknown', now=Date.now();
                const recent=(failedLogins.get(address)||[]).filter(t=>now-t<10*60*1000);
                if(recent.length>=20)return send(res,429,{error:'登录次数过多，请 10 分钟后再试。'});
                const body=await readJson(req),name=username(body.username);
                const user=db.users.find(x=>x.username.toLowerCase()===name.toLowerCase());
                const ok=user&&!passwordError(body.password)&&await matchPassword(body.password,user);
                if(!ok){recent.push(now);failedLogins.set(address,recent);return send(res,401,{error:'账号或密码不正确。'});}
                failedLogins.delete(address);return send(res,200,{token:issueToken(user)});
            }
            if (req.method === 'POST' && url.pathname === '/api/guest/name') {
                const body=await readJson(req),id=String(body.deviceId||'');
                if(!/^[a-zA-Z0-9_-]{6,100}$/.test(id))return send(res,400,{error:'设备编号无效。'});
                const guest=guestFor(id,body.displayName);persist();return send(res,200,{displayName:guest.displayName});
            }
            if (req.method === 'POST' && url.pathname === '/api/scores') {
                const body=await readJson(req),score=Number(body.score),user=userFrom(req);
                if(!Number.isSafeInteger(score)||score<0||score>1000000000)return send(res,400,{error:'分数无效。'});
                if(user) user.best=Math.max(user.best,score);
                else {
                    const id=String(body.deviceId||'');
                    if(!/^[a-zA-Z0-9_-]{6,100}$/.test(id))return send(res,400,{error:'设备编号无效。'});
                    const guest=guestFor(id,body.displayName);guest.best=Math.max(guest.best,score);
                }
                persist();
                const best=user?user.best:db.guests.find(x=>x.id===body.deviceId).best;
                return send(res,200,{saved:true,best});
            }
            return send(res,404,{error:'找不到这个接口。'});
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'不支持此请求。'});
        let pathname;
        try { pathname=decodeURIComponent(url.pathname); } catch (_) { return send(res,400,{error:'路径无效。'}); }
        if(pathname==='/') pathname='/index.html';
        if(pathname.split('/').some(part => part.startsWith('.'))) return send(res,404,{error:'找不到此页面。'});
        const file=path.resolve(ROOT,'.'+pathname);
        if(!file.startsWith(ROOT+path.sep))return send(res,403,{error:'无法访问此文件。'});
        let stat;
        try { stat=fs.statSync(file); } catch (_) { return send(res,404,{error:'找不到此页面。'}); }
        if(!stat.isFile())return send(res,404,{error:'找不到此页面。'});
        res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600'});
        if(req.method==='HEAD')return res.end();
        fs.createReadStream(file).pipe(res);
    } catch(error) {
        if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'服务器遇到问题。'});
        else res.destroy();
        if(!error.status)console.error(error);
    }
});
server.listen(PORT,'0.0.0.0',()=>console.log('BigMergeGame server running on port ' + PORT));
