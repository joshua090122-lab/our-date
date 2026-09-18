'use strict';
const { randomBytes, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const config = require('../config.js');
const COOKIE = 'our_date_device_v3';
const AGE = 400 * 24 * 60 * 60;
const hash = value => createHash('sha256').update(value).digest();

function cookie(req) {
  return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function setCookie(res, value, age = AGE) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`);
}
function send(res, status, data) { res.statusCode = status; res.end(JSON.stringify(data)); }
async function body(req) {
  if (req.body !== undefined) {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > 2048) throw Error('BAD_BODY');
    return JSON.parse(text);
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2048) throw Error('BAD_BODY'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const password = process.env.OUR_DATE_PASSWORD || '';
    const gateway = process.env.OUR_DATE_PAIR_KEY || '';
    const method = req.method;
    if (!['GET', 'POST', 'DELETE'].includes(method)) { res.setHeader('Allow', 'GET, POST, DELETE'); return send(res, 405, {message:'지원하지 않는 요청입니다.'}); }
    const host = String(req.headers.host || '');
    const local = process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if (!local && host !== new URL(config.appOrigin).host) return send(res, 403, {message:'고정 앱 주소에서 열어 주세요.', code:'WRONG_ORIGIN'});
    const origin = req.headers.origin;
    if (origin && origin !== (local ? `http://${host}` : config.appOrigin)) return send(res, 403, {message:'요청한 주소를 확인해 주세요.'});
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, {message:'앱에서 다시 시도해 주세요.'});
    if (method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, {message:'요청 형식이 올바르지 않습니다.'});
    if (!password) return send(res, 503, {message:'앱 비밀번호가 아직 설정되지 않았어요. Vercel의 OUR_DATE_PASSWORD를 저장한 뒤 재배포해 주세요.', code:'PASSWORD_NOT_SET'});
    if (password.length < 4 || password.length > 256 || !password.trim()) {
      return send(res, 503, {message:'앱 비밀번호는 4~256자로 설정해 주세요. Vercel의 OUR_DATE_PASSWORD를 수정한 뒤 재배포하면 적용돼요.', code:'PASSWORD_LENGTH'});
    }
    if (!/^[A-Za-z0-9]{32,128}$/.test(gateway)) {
      return send(res, 503, {message:'서버 연결용 키 설정을 확인해 주세요. Vercel의 OUR_DATE_PAIR_KEY에 기존 긴 공유코드를 넣고 재배포해 주세요.', code:'GATEWAY_NOT_SET'});
    }
    const epoch = createHmac('sha256', gateway).update('our-date-v3-password\0' + password).digest('hex');
    async function rpc(name, params) {
      const headers = {'Content-Type':'application/json', apikey:config.publishableKey, 'x-our-date-key':gateway};
      if (config.publishableKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.publishableKey}`;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {method:'POST', headers, body:JSON.stringify(params), signal:controller.signal, redirect:'error'});
        const data = await response.json();
        if (!response.ok) throw Error(response.status === 404 ? 'MIGRATION_REQUIRED' : 'SERVER_CONNECTION');
        return data;
      } finally { clearTimeout(timer); }
    }
    const token = cookie(req);
    if (method === 'DELETE') {
      if (/^[a-f0-9]{64}$/.test(token)) await rpc('our_date_close_session', {p_token:token});
      setCookie(res, '', 0); return send(res, 200, {ok:true});
    }
    if (method === 'GET') {
      // Even a missing cookie synchronizes the current password epoch and revokes old sessions after password changes.
      const candidate = /^[a-f0-9]{64}$/.test(token) ? token : '0'.repeat(64);
      const valid = await rpc('our_date_open_session', {p_token:candidate,p_epoch:epoch,p_create:false});
      if (!valid || candidate !== token) { setCookie(res, '', 0); return send(res, 401, {message:'우리 둘의 비밀번호를 입력해 주세요.'}); }
      setCookie(res, token); return send(res, 200, {token});
    }
    let input;
    try { input = await body(req); } catch { return send(res, 400, {message:'비밀번호 입력을 확인해 주세요.'}); }
    if (!input || typeof input !== 'object' || typeof input.password !== 'string' || input.password.length > 256) return send(res, 400, {message:'비밀번호 입력을 확인해 주세요.'});
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const bucket = createHmac('sha256', gateway).update('login\0' + ip).digest('hex');
    if (!await rpc('our_date_auth_attempt', {p_bucket:bucket})) { res.setHeader('Retry-After','900'); return send(res, 429, {message:'입장 시도가 많아요. 15분 후 다시 시도해 주세요.'}); }
    if (!timingSafeEqual(hash(input.password), hash(password))) return send(res, 401, {message:'비밀번호가 달라요. 다시 확인해 주세요.'});
    const fresh = randomBytes(32).toString('hex');
    await rpc('our_date_open_session', {p_token:fresh,p_epoch:epoch,p_create:true});
    if (/^[a-f0-9]{64}$/.test(token)) await rpc('our_date_close_session', {p_token:token});
    setCookie(res, fresh); return send(res, 200, {token:fresh});
  } catch (error) {
    const message = error.message === 'MIGRATION_REQUIRED' ? '앱 업그레이드 준비가 필요해요. 안내서의 SQL 적용 단계를 확인해 주세요.' : '서버 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
    return send(res, 503, {message,code:error.message === 'MIGRATION_REQUIRED'?'MIGRATION_REQUIRED':'SERVER_CONNECTION'});
  }
};
