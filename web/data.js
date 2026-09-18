/* Our Date data adapter. No account is required for the private, local mode. */
(() => {
  'use strict';

  const TABLES = ['dates', 'places', 'place_images'];
  const ALL_STORES = [...TABLES, 'photos'];
  const SETTINGS_KEY = 'our-date.settings.v2';
  const DATABASE_NAME = 'our-date-v2';
  const URL_TTL_SECONDS = 3600;
  const MAX_BACKUP_PHOTO_BYTES = 100 * 1024 * 1024;
  const MAX_BACKUP_FILE_BYTES = 150 * 1024 * 1024;
  const photoURLs = new Map();
  const cloudURLs = new Map();
  const accessChecks = new Map();
  const columns = {
    dates: ['id', 'date', 'start_time', 'end_time', 'memo', 'created_at', 'updated_at'],
    places: ['id', 'date_id', 'category', 'name', 'address', 'memo', 'latitude', 'longitude', 'created_at', 'updated_at'],
    place_images: ['id', 'place_id', 'storage_path', 'file_size', 'created_at']
  };
  let databasePromise;

  function makeError(message, code = 'OUR_DATE_ERROR', status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function now() { return new Date().toISOString(); }
  function nextTimestamp(previous) { return new Date(Math.max(Date.now(), (Date.parse(previous || '') || 0) + 1)).toISOString(); }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function modeFor(settings) {
    if (settings.mode === 'local' || settings.mode === 'cloud') return settings.mode;
    return settings.supabaseUrl && settings.publishableKey && settings.pairKey ? 'cloud' : 'local';
  }
  function getSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) {}
    const config = Object.assign({}, window.OUR_DATE_CONFIG || {}, saved || {});
    const settings = Object.fromEntries(['supabaseUrl', 'publishableKey', 'pairKey', 'kakaoKey'].map(key => [key, String(config[key] || '').trim()]));
    settings.mode = modeFor(config);
    return settings;
  }
  function validateSettings(settings) {
    if (settings.mode === 'cloud' && (!settings.supabaseUrl || !settings.publishableKey || !settings.pairKey)) throw makeError('클라우드 모드에는 Supabase URL·공용 키·공유 코드가 모두 필요합니다.');
    if (settings.supabaseUrl) {
      let url;
      try { url = new URL(settings.supabaseUrl); } catch (_) { throw makeError('Supabase 프로젝트 URL을 확인해 주세요.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw makeError('Supabase URL은 https://프로젝트.supabase.co 형식의 주소여야 합니다.');
      }
    }
    if (settings.publishableKey.startsWith('sb_secret_')) throw makeError('비밀 키는 앱에 넣을 수 없습니다. Publishable 키를 사용해 주세요.');
    if (settings.publishableKey.startsWith('eyJ')) {
      try {
        const payload = JSON.parse(atob(settings.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role === 'service_role') throw makeError('service_role 키는 앱에 넣을 수 없습니다. Publishable 또는 anon 키를 사용해 주세요.');
      } catch (error) { if (error.code === 'OUR_DATE_ERROR') throw error; }
    }
    if (settings.pairKey && !/^[A-Za-z0-9]{32,128}$/.test(settings.pairKey)) {
      throw makeError('공유 코드는 영문·숫자로 된 32~128자여야 합니다. 새 코드 생성 버튼을 이용해 주세요.');
    }
  }
  function clearURLs() {
    for (const url of photoURLs.values()) URL.revokeObjectURL(url);
    photoURLs.clear();
    cloudURLs.clear();
  }
  function saveSettings(input) {
    const settings = Object.assign(getSettings(), input || {});
    for (const key of ['supabaseUrl', 'publishableKey', 'pairKey', 'kakaoKey']) settings[key] = String(settings[key] || '').trim();
    if (!['local', 'cloud'].includes(settings.mode)) throw makeError('저장 방식을 선택해 주세요.');
    settings.supabaseUrl = settings.supabaseUrl.replace(/\/+$/, '');
    validateSettings(settings);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (_) { throw makeError('설정을 저장할 수 없습니다. 브라우저의 사이트 저장 허용 여부를 확인해 주세요.'); }
    clearURLs();
    window.dispatchEvent(new CustomEvent('our-date-settings-changed', { detail: { mode: modeFor(settings) } }));
    return getSettings();
  }
  function generatePairKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(makeError('이 브라우저에서 로컬 저장을 사용할 수 없습니다. 일반 모드의 최신 브라우저로 열어 주세요.')); return; }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const dates = database.createObjectStore('dates', { keyPath: 'id' });
        dates.createIndex('date', 'date', { unique: true });
        database.createObjectStore('places', { keyPath: 'id' });
        database.createObjectStore('place_images', { keyPath: 'id' });
        database.createObjectStore('photos', { keyPath: 'path' });
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = undefined; };
        resolve(database);
      };
      request.onerror = () => reject(makeError(`로컬 저장소를 열지 못했습니다: ${request.error?.message || '저장 권한을 확인해 주세요.'}`));
      request.onblocked = () => reject(makeError('다른 탭에서 앱을 닫은 다음 다시 시도해 주세요.'));
    }).catch(error => { databasePromise = undefined; throw error; });
    return databasePromise;
  }

  // The synchronous callback runs inside one IDB transaction, including all reads.
  async function transaction(stores, write, callback) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, write ? 'readwrite' : 'readonly');
      const rows = {};
      let result;
      let failure;
      let remaining = stores.length;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || makeError(tx.error?.name === 'QuotaExceededError' ? '기기 저장공간이 부족합니다. 백업 후 공간을 확보해 주세요.' : `로컬 저장 실패: ${tx.error?.message || '트랜잭션이 취소되었습니다.'}`));
      tx.onerror = () => {};
      for (const name of stores) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          rows[name] = request.result;
          if (--remaining) return;
          try { result = callback(rows, tx); }
          catch (error) { failure = error; tx.abort(); }
        };
      }
    });
  }

  function assertTable(table) {
    if (!TABLES.includes(table)) throw makeError('지원하지 않는 데이터 테이블입니다.');
  }
  function validatePath(path) {
    if (typeof path !== 'string' || !path || path.length > 1024 || /[\x00-\x1f\\]/.test(path) || path.startsWith('/') || path.split('/').some(p => p === '.' || p === '..' || !p)) {
      throw makeError('사진 파일 경로가 올바르지 않습니다.');
    }
    return path;
  }
  function isUUID(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
  function validateTables(tables) {
    const ids = {};
    for (const table of TABLES) {
      if (!Array.isArray(tables[table])) throw makeError(`백업에 ${table} 배열이 없습니다.`);
      ids[table] = new Set();
      for (const row of tables[table]) {
        if (!row || typeof row !== 'object' || !isUUID(row.id) || ids[table].has(row.id)) throw makeError(`${table}의 식별자가 올바르지 않거나 중복되었습니다.`);
        if (Object.keys(row).some(key => !columns[table].includes(key))) throw makeError(`${table}에 지원하지 않는 필드가 있습니다.`);
        ids[table].add(row.id);
        for (const key of ['created_at', 'updated_at']) {
          if (row[key] != null && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key])))) throw makeError('날짜 기록 형식이 올바르지 않습니다.');
        }
        for (const key of ['memo', 'address']) if (row[key] != null && typeof row[key] !== 'string') throw makeError('메모 또는 주소 형식이 올바르지 않습니다.');
      }
    }
    const dates = new Set();
    for (const row of tables.dates) {
      if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || dates.has(row.date)) throw makeError('날짜가 올바르지 않거나 중복되었습니다.');
      dates.add(row.date);
      for (const key of ['start_time', 'end_time']) if (row[key] != null && (typeof row[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(row[key]))) throw makeError('시간 형식이 올바르지 않습니다.');
    }
    for (const row of tables.places) {
      if (!ids.dates.has(row.date_id)) throw makeError('날짜와 연결되지 않은 장소가 있습니다.');
      if (!['restaurant', 'cafe', 'activity'].includes(row.category) || typeof row.name !== 'string' || !row.name.trim()) throw makeError('장소 이름 또는 분류가 올바르지 않습니다.');
      for (const [key, maximum] of [['latitude', 90], ['longitude', 180]]) if (row[key] != null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Math.abs(row[key]) > maximum)) throw makeError('장소 좌표가 올바르지 않습니다.');
    }
    for (const row of tables.place_images) {
      if (!ids.places.has(row.place_id)) throw makeError('장소와 연결되지 않은 사진이 있습니다.');
      validatePath(row.storage_path);
      if (row.file_size != null && (!Number.isSafeInteger(row.file_size) || row.file_size < 0)) throw makeError('사진 크기가 올바르지 않습니다.');
    }
  }

  function filterRows(rows, filters) {
    return rows.filter(row => filters.every(([field, operator, value]) => {
      const actual = row[field];
      if (operator === 'eq') return actual === value;
      if (operator === 'in') return value.includes(actual);
      if (actual == null || value == null) return false;
      if (operator === 'gte') return actual >= value;
      if (operator === 'lt') return actual < value;
      if (operator === 'lte') return actual <= value;
      return false;
    }));
  }
  function projectRows(rows, query) {
    let selected = rows.slice();
    if (query.orders.length) selected.sort((a, b) => {
      for (const [field, ascending] of query.orders) {
        if (a[field] === b[field]) continue;
        const value = a[field] == null ? 1 : b[field] == null ? -1 : a[field] < b[field] ? -1 : 1;
        return ascending ? value : -value;
      }
      return 0;
    });
    selected = selected.slice(query.offset, query.maximum == null ? undefined : query.offset + query.maximum);
    if (query.selection && query.selection !== '*') {
      const fields = query.selection.split(',').map(s => s.trim());
      selected = selected.map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])));
    }
    if (query.one) {
      if (selected.length !== 1) throw makeError('요청한 기록이 없거나 여러 개입니다. 목록을 새로고침해 주세요.', 'PGRST116', 406);
      return selected[0];
    }
    return selected;
  }
  async function executeLocal(query) {
    const mutation = query.action !== 'select';
    return transaction(mutation ? ALL_STORES : [query.table], mutation, (data, tx) => {
      let result = filterRows(data[query.table], query.filters);
      if (mutation) {
        const tableRows = data[query.table];
        if (query.action === 'insert' || query.action === 'upsert') {
          const inputs = Array.isArray(query.values) ? query.values : [query.values];
          result = [];
          for (const input of inputs) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw makeError('저장할 기록이 올바르지 않습니다.');
            const conflict = query.conflict || 'id';
            const existing = query.action === 'upsert' ? tableRows.find(row => input[conflict] != null && row[conflict] === input[conflict]) : undefined;
            const stamp = now();
            const defaults = query.table === 'dates' ? { start_time: null, end_time: null, memo: null } : query.table === 'places' ? { address: null, memo: null, latitude: null, longitude: null } : { file_size: 0 };
            const row = Object.assign({ id: uuid(), created_at: stamp }, defaults, existing || {}, input);
            if (query.table !== 'place_images') row.updated_at = nextTimestamp(existing?.updated_at);
            if (existing) tableRows[tableRows.indexOf(existing)] = row;
            else tableRows.push(row);
            result.push(row);
          }
        } else if (query.action === 'update') {
          result = result.map(previous => {
            const row = Object.assign({}, previous, query.values);
            if (row.id !== previous.id) throw makeError('기록의 식별자는 변경할 수 없습니다.');
            if (query.table !== 'place_images') row.updated_at = nextTimestamp(previous.updated_at);
            tableRows[tableRows.indexOf(previous)] = row;
            return row;
          });
        } else if (query.action === 'delete') {
          const removed = new Set(result.map(row => row.id));
          data[query.table] = tableRows.filter(row => !removed.has(row.id));
          if (query.table === 'dates') data.places = data.places.filter(row => !removed.has(row.date_id));
          if (query.table === 'dates' || query.table === 'places') {
            const placeIds = new Set(data.places.map(row => row.id));
            data.place_images = data.place_images.filter(row => placeIds.has(row.place_id));
          }
        }
        validateTables(data);
        for (const table of TABLES) {
          const store = tx.objectStore(table);
          store.clear();
          for (const row of data[table]) store.put(row);
        }
      }
      return query.returning || !mutation ? projectRows(result, query) : null;
    });
  }

  function requestHeaders(settings, extra = {}) {
    const headers = { apikey: settings.publishableKey, 'x-our-date-key': settings.pairKey, ...extra };
    if (settings.publishableKey.startsWith('eyJ')) headers.Authorization = `Bearer ${settings.publishableKey}`;
    return headers;
  }
  async function cloudRequest(settings, path, options = {}) {
    validateSettings(settings);
    if (!settings.supabaseUrl || !settings.publishableKey || !settings.pairKey) throw makeError('먼저 Supabase URL·공용 키·공유 코드를 모두 설정해 주세요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 45000);
    let response;
    try {
      response = await fetch(`${settings.supabaseUrl.replace(/\/+$/, '')}${path}`, {
        ...options, headers: requestHeaders(settings, options.headers), signal: controller.signal, cache: 'no-store'
      });
    } catch (error) {
      throw makeError(error.name === 'AbortError' ? '서버 응답 시간이 초과되었습니다. 저장 결과를 새로고침으로 확인한 뒤 다시 시도해 주세요.' : '클라우드에 연결할 수 없습니다. 인터넷 연결과 서버 설정을 확인해 주세요. 저장되지 않은 변경은 서버에 반영되지 않습니다.', 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch (_) {}
      const original = detail.message || detail.error || detail.msg || response.statusText;
      let message = `클라우드 요청 실패 (${response.status}): ${original}`;
      if (response.status === 401 || response.status === 403) message = '클라우드 접근이 거부되었습니다. 공용 키·공유 코드와 SQL 설치 상태를 확인해 주세요.';
      if (response.status === 409) message = `다른 기기에서 먼저 변경했거나 중복된 기록입니다. 새로고침 후 다시 시도해 주세요. ${original}`;
      throw makeError(message, detail.code || 'CLOUD_ERROR', response.status);
    }
    return response;
  }
  function queryParameters(query) {
    const params = new URLSearchParams();
    if (query.selection) params.set('select', query.selection);
    for (const [field, op, value] of query.filters) {
      const filter = op === 'in' ? `in.(${value.map(item => typeof item === 'number' ? String(item) : `"${String(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})` : `${op}.${value}`;
      params.append(field, filter);
    }
    if (query.orders.length) params.set('order', query.orders.map(([field, ascending]) => `${field}.${ascending ? 'asc' : 'desc'}`).join(','));
    if (query.maximum != null) params.set('limit', String(query.maximum));
    if (query.offset) params.set('offset', String(query.offset));
    if (query.action === 'upsert') params.set('on_conflict', query.conflict || 'id');
    return params;
  }
  async function ensureCloudAccess(settings) {
    const key = `${settings.supabaseUrl}|${settings.publishableKey}|${settings.pairKey}`;
    if (!accessChecks.has(key)) {
      const promise = cloudRequest(settings, '/rest/v1/rpc/get_storage_usage_cache', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_bucket_id: 'place-images' })
      }).then(async response => { await response.json(); }).finally(() => accessChecks.delete(key));
      accessChecks.set(key, promise);
    }
    return accessChecks.get(key);
  }
  async function executeCloud(query) {
    await ensureCloudAccess(query.settings);
    if (query.filters.some(([, operator, value]) => operator === 'in' && value.length === 0)) return query.one ? projectRows([], query) : [];
    const mutation = query.action !== 'select';
    const headers = {};
    const preferences = [];
    if (mutation) preferences.push(query.returning ? 'return=representation' : 'return=minimal');
    if (query.action === 'upsert') preferences.push('resolution=merge-duplicates');
    if (preferences.length) headers.Prefer = preferences.join(',');
    if (query.one) headers.Accept = 'application/vnd.pgrst.object+json';
    const options = { method: { select: 'GET', insert: 'POST', upsert: 'POST', update: 'PATCH', delete: 'DELETE' }[query.action], headers };
    if (query.values != null) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(query.values); }
    const response = await cloudRequest(query.settings, `/rest/v1/${query.table}?${queryParameters(query)}`, options);
    if (response.status === 204 || (mutation && !query.returning)) return null;
    return response.json();
  }

  class Query {
    constructor(table, settings = getSettings(), forceMode) {
      assertTable(table);
      this.table = table; this.settings = settings; this.mode = forceMode || modeFor(settings);
      this.action = 'select'; this.selection = '*'; this.filters = []; this.orders = [];
      this.maximum = null; this.offset = 0; this.returning = false; this.one = false;
    }
    select(selection = '*') { this.selection = selection; this.returning = true; return this; }
    insert(values) { this.action = 'insert'; this.values = values; this.selection = ''; return this; }
    upsert(values, options = {}) { this.action = 'upsert'; this.values = values; this.conflict = options.onConflict || 'id'; this.selection = ''; return this; }
    update(values) { this.action = 'update'; this.values = values; this.selection = ''; return this; }
    delete() { this.action = 'delete'; this.selection = ''; return this; }
    eq(field, value) { this.filters.push([field, 'eq', value]); return this; }
    in(field, value) { this.filters.push([field, 'in', value]); return this; }
    gte(field, value) { this.filters.push([field, 'gte', value]); return this; }
    lt(field, value) { this.filters.push([field, 'lt', value]); return this; }
    lte(field, value) { this.filters.push([field, 'lte', value]); return this; }
    order(field, options = {}) { this.orders.push([field, options.ascending !== false]); return this; }
    limit(value) { this.maximum = Math.max(0, Number(value)); return this; }
    range(from, to) { this.offset = from; this.maximum = to - from + 1; return this; }
    single() { this.one = true; this.returning = true; return this; }
    then(resolve, reject) {
      if (!this.promise) this.promise = (async () => {
        try { return { data: await (this.mode === 'cloud' ? executeCloud(this) : executeLocal(this)), error: null }; }
        catch (error) { return { data: null, error }; }
      })();
      return this.promise.then(resolve, reject);
    }
  }

  function encodedPath(path) { return validatePath(path).split('/').map(encodeURIComponent).join('/'); }
  function storage(bucket, settings = getSettings(), forceMode) {
    if (bucket !== 'place-images') throw makeError('지원하지 않는 사진 보관함입니다.');
    const mode = forceMode || modeFor(settings);
    const wrap = async callback => { try { return { data: await callback(), error: null }; } catch (error) { return { data: null, error }; } };
    const facade = {
      upload(path, blob, options = {}) { return wrap(async () => {
        validatePath(path);
        if (!(blob instanceof Blob)) throw makeError('올릴 사진 파일이 올바르지 않습니다.');
        const mimeType = options.contentType || blob.type || 'application/octet-stream';
        if (!/^image\/(jpeg|png|webp|avif)$/.test(mimeType)) throw makeError('지원하는 사진 파일(JPEG·PNG·WebP·AVIF)만 올릴 수 있습니다.');
        if (blob.size > 10 * 1024 * 1024) throw makeError('사진 한 장은 10MB 이하여야 합니다.');
        if (mode === 'cloud') {
          await cloudRequest(settings, `/storage/v1/object/${bucket}/${encodedPath(path)}`, { method: 'POST', headers: { 'Content-Type': mimeType, 'x-upsert': String(!!options.upsert), 'cache-control': `max-age=${options.cacheControl || '3600'}` }, body: blob, timeout: 120000 });
        } else {
          await transaction(['photos'], true, (data, tx) => {
            if (!options.upsert && data.photos.some(photo => photo.path === path)) throw makeError('같은 경로에 사진이 이미 있습니다.', 'DUPLICATE_PHOTO', 409);
            tx.objectStore('photos').put({ path, blob, mimeType, size: blob.size, created_at: now() });
          });
        }
        if (photoURLs.has(path)) { URL.revokeObjectURL(photoURLs.get(path)); photoURLs.delete(path); }
        cloudURLs.clear();
        return { path, fullPath: `${bucket}/${path}` };
      }); },
      download(path) { return wrap(async () => {
        validatePath(path);
        if (mode === 'cloud') return (await cloudRequest(settings, `/storage/v1/object/authenticated/${bucket}/${encodedPath(path)}`)).blob();
        const photo = await transaction(['photos'], false, data => data.photos.find(row => row.path === path));
        if (!photo) throw makeError('저장된 사진 파일을 찾을 수 없습니다. 백업 원본을 확인해 주세요.', 'PHOTO_NOT_FOUND', 404);
        return photo.blob;
      }); },
      getPublicUrl(path) { return wrap(async () => {
        validatePath(path);
        if (mode === 'local') {
          if (!photoURLs.has(path)) {
            const { data, error } = await facade.download(path);
            if (error) throw error;
            photoURLs.set(path, URL.createObjectURL(data));
          }
          return { publicUrl: photoURLs.get(path) };
        }
        const key = `${settings.supabaseUrl}|${settings.pairKey}|${path}`;
        const cached = cloudURLs.get(key);
        if (cached && cached.expiresAt > Date.now()) return { publicUrl: cached.url };
        const response = await cloudRequest(settings, `/storage/v1/object/sign/${bucket}/${encodedPath(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: URL_TTL_SECONDS }) });
        const data = await response.json();
        const signed = data.signedURL || data.signedUrl;
        if (!signed) throw makeError('사진 접근 주소를 만들 수 없습니다.');
        const url = signed.startsWith('https://') ? signed : `${settings.supabaseUrl}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
        cloudURLs.set(key, { url, expiresAt: Date.now() + (URL_TTL_SECONDS - 600) * 1000 });
        return { publicUrl: url };
      }); },
      remove(paths) { return wrap(async () => {
        if (!Array.isArray(paths)) throw makeError('삭제할 사진 목록이 올바르지 않습니다.');
        paths.forEach(validatePath);
        if (!paths.length) return [];
        if (mode === 'cloud') {
          await cloudRequest(settings, `/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
        } else {
          await transaction(['photos', 'place_images'], true, (data, tx) => {
            if (data.place_images.some(row => paths.includes(row.storage_path))) throw makeError('아직 장소에서 사용하는 사진은 삭제할 수 없습니다.');
            for (const path of paths) tx.objectStore('photos').delete(path);
          });
        }
        for (const path of paths) { if (photoURLs.has(path)) URL.revokeObjectURL(photoURLs.get(path)); photoURLs.delete(path); }
        cloudURLs.clear();
        return paths.map(name => ({ name }));
      }); }
    };
    return facade;
  }

  async function rpc(name, parameters = {}, settings = getSettings()) {
    try {
      if (!['get_storage_usage_cache', 'reconcile_storage_usage', 'adjust_storage_usage', 'restore_empty_backup'].includes(name)) throw makeError('지원하지 않는 서버 함수입니다.');
      if (modeFor(settings) === 'cloud') {
        const response = await cloudRequest(settings, `/rest/v1/rpc/${name === 'adjust_storage_usage' ? 'reconcile_storage_usage' : name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(name === 'adjust_storage_usage' ? { p_bucket_id: parameters.p_bucket_id || 'place-images' } : parameters), timeout: 120000 });
        return { data: await response.json(), error: null };
      }
      if (name === 'restore_empty_backup') throw makeError('이 복원 기능은 클라우드 모드에서만 사용할 수 있습니다.');
      const data = await transaction(['photos'], false, rows => [{ bucket_id: 'place-images', total_bytes: rows.photos.reduce((sum, photo) => sum + photo.blob.size, 0), photo_count: rows.photos.length, last_reconciled_at: now(), updated_at: now() }]);
      return { data, error: null };
    } catch (error) { return { data: null, error }; }
  }

  async function readAllCloudRows(table, settings) {
    await ensureCloudAccess(settings);
    const rows = [];
    let offset = 0;
    for (;;) {
      const response = await cloudRequest(settings, `/rest/v1/${table}?select=*&order=id.asc&offset=${offset}&limit=500`, { headers: { Prefer: 'count=exact' } });
      const page = await response.json();
      if (!Array.isArray(page)) throw makeError('서버에서 기록 목록을 읽지 못했습니다.');
      rows.push(...page);
      offset += page.length;
      const contentRange = response.headers.get('content-range') || '';
      const totalText = contentRange.split('/')[1];
      const total = totalText && totalText !== '*' ? Number(totalText) : null;
      if (!page.length || (total != null && offset >= total) || (total == null && page.length < 500)) return rows;
    }
  }
  async function blobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(binary);
  }
  function base64Blob(base64, mimeType) {
    if (typeof base64 !== 'string' || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw makeError('백업 사진의 인코딩이 올바르지 않습니다.');
    let binary;
    try { binary = atob(base64); } catch (_) { throw makeError('백업 사진을 읽을 수 없습니다.'); }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  async function parseBackup(input) {
    let backup = input;
    if (input && typeof input.text === 'function') {
      if (Number(input.size || 0) > MAX_BACKUP_FILE_BYTES) throw makeError('브라우저 메모리 보호를 위해 150MB 이하의 JSON 백업 파일만 가져올 수 있습니다. 큰 자료는 Supabase DB와 Storage를 별도로 복원해 주세요.');
      try { backup = JSON.parse(await input.text()); } catch (_) { throw makeError('올바른 JSON 백업 파일이 아닙니다.'); }
    } else if (typeof input === 'string') {
      if (input.length > MAX_BACKUP_FILE_BYTES) throw makeError('150MB 이하의 JSON 백업 파일만 가져올 수 있습니다.');
      try { backup = JSON.parse(input); } catch (_) { throw makeError('올바른 JSON 백업 파일이 아닙니다.'); }
    }
    if (!backup || backup.format !== 'our-date-backup' || backup.version !== 2 || !backup.tables || !Array.isArray(backup.photos)) throw makeError('Our Date 버전 2 전체 백업 파일을 선택해 주세요.');
    validateTables(backup.tables);
    const estimatedBytes = backup.photos.reduce((sum, photo) => sum + (typeof photo?.base64 === 'string' ? Math.floor(photo.base64.length / 4) * 3 - (photo.base64.endsWith('==') ? 2 : photo.base64.endsWith('=') ? 1 : 0) : 0), 0);
    if (estimatedBytes > MAX_BACKUP_PHOTO_BYTES) throw makeError('앱의 전체 백업·복원은 사진 원본 합계 100MB까지 지원합니다. 큰 클라우드 자료는 Supabase DB와 Storage를 별도로 복원해 주세요.');
    const photos = [];
    const paths = new Set();
    for (const photo of backup.photos) {
      validatePath(photo.path);
      if (paths.has(photo.path) || typeof photo.mimeType !== 'string' || !/^image\/(jpeg|png|webp|avif)$/.test(photo.mimeType)) throw makeError('사진 경로가 중복되었거나 파일 형식이 올바르지 않습니다.');
      const blob = base64Blob(photo.base64, photo.mimeType);
      if (blob.size > 10 * 1024 * 1024) throw makeError('백업에 10MB를 넘는 사진이 있습니다.');
      paths.add(photo.path);
      photos.push({ path: photo.path, mimeType: photo.mimeType, blob, size: blob.size, created_at: now() });
    }
    const byPath = new Map(photos.map(photo => [photo.path, photo]));
    for (const row of backup.tables.place_images) {
      if (!paths.has(row.storage_path)) throw makeError('백업에 사진 원본이 빠져 있습니다. 전체 백업으로 다시 시도해 주세요.');
      if (row.file_size != null && row.file_size !== 0 && row.file_size !== byPath.get(row.storage_path).size) throw makeError('백업의 사진 크기 정보와 원본 파일이 일치하지 않습니다.');
    }
    return { tables: structuredClone(backup.tables), photos };
  }
  async function exportBackup(options = {}) {
    const settings = getSettings();
    const mode = options.mode || modeFor(settings);
    let tables;
    let photos;
    if (mode === 'local') {
      const snapshot = await transaction(ALL_STORES, false, rows => rows);
      tables = Object.fromEntries(TABLES.map(table => [table, snapshot[table]]));
      if (snapshot.photos.reduce((sum, photo) => sum + photo.blob.size, 0) > MAX_BACKUP_PHOTO_BYTES) throw makeError('브라우저 메모리 보호를 위해 전체 백업은 사진 원본 합계 100MB까지 지원합니다. 현재 기록은 그대로 보존됩니다.');
      photos = [];
      for (const photo of snapshot.photos) photos.push({ path: photo.path, mimeType: photo.mimeType || photo.blob.type, base64: await blobBase64(photo.blob) });
    } else {
      tables = {};
      for (const table of TABLES) tables[table] = await readAllCloudRows(table, settings);
      validateTables(tables);
      const expectedSizes = new Map();
      for (const row of tables.place_images) expectedSizes.set(row.storage_path, Math.max(expectedSizes.get(row.storage_path) || 0, Number(row.file_size || 0)));
      if ([...expectedSizes.values()].reduce((sum, size) => sum + size, 0) > MAX_BACKUP_PHOTO_BYTES) throw makeError('전체 JSON 백업은 사진 원본 합계 100MB까지 지원합니다. 큰 자료는 Supabase DB와 Storage를 별도로 백업해 주세요.');
      photos = [];
      let totalPhotoBytes = 0;
      const photoStore = storage('place-images', settings, 'cloud');
      for (const path of new Set(tables.place_images.map(row => row.storage_path))) {
        const { data: blob, error } = await photoStore.download(path);
        if (error) throw makeError(`사진을 백업하지 못해 전체 백업을 중단했습니다. ${error.message}`);
        totalPhotoBytes += blob.size;
        if (totalPhotoBytes > MAX_BACKUP_PHOTO_BYTES) throw makeError('사진 원본 합계가 100MB를 초과하여 JSON 백업을 중단했습니다. 현재 기록은 그대로 보존됩니다. 큰 자료는 Supabase DB와 Storage를 별도로 백업해 주세요.');
        photos.push({ path, mimeType: blob.type || 'image/jpeg', base64: await blobBase64(blob) });
      }
      const canonical = rows => JSON.stringify(rows.slice().sort((a, b) => a.id.localeCompare(b.id)).map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]))));
      for (const table of TABLES) {
        if (canonical(tables[table]) !== canonical(await readAllCloudRows(table, settings))) throw makeError('백업하는 동안 다른 기기에서 기록이 변경되었습니다. 두 기기의 편집을 잠시 멈추고 전체 백업을 다시 실행해 주세요.', 'BACKUP_CHANGED');
      }
    }
    validateTables(tables);
    return { format: 'our-date-backup', version: 2, createdAt: now(), sourceMode: mode, tables, photos };
  }
  async function importBackup(input) {
    if (modeFor(getSettings()) === 'cloud') throw makeError('로컬 복원은 기기 저장 모드에서만 가능합니다. 클라우드 복원 버튼을 이용하거나 클라우드 연결을 해제해 주세요.');
    const backup = await parseBackup(input);
    await transaction(ALL_STORES, true, (rows, tx) => {
      if (ALL_STORES.some(table => rows[table].length)) throw makeError('이 기기에 이미 기록이 있습니다. 먼저 전체 백업 후, 빈 브라우저 프로필에서 복원해 주세요. 기존 기록은 덮어쓰지 않습니다.');
      for (const table of TABLES) for (const row of backup.tables[table]) tx.objectStore(table).add(row);
      for (const photo of backup.photos) tx.objectStore('photos').add(photo);
    });
    clearURLs();
    return { dates: backup.tables.dates.length, places: backup.tables.places.length, photos: backup.photos.length };
  }
  async function restoreBackupToCloud(input) {
    const settings = getSettings();
    if (modeFor(settings) !== 'cloud') throw makeError('클라우드 복원 전에 Supabase 연결 설정을 완료해 주세요.');
    const backup = await parseBackup(input);
    for (const table of TABLES) {
      const { data, error } = await new Query(table, settings, 'cloud').select('id').limit(1);
      if (error) throw error;
      if (data.length) throw makeError('클라우드에 이미 기록이 있습니다. 복원은 빈 Supabase 프로젝트에서만 가능합니다.');
    }
    const prefix = `restore/${uuid()}/`;
    const mapping = new Map(backup.photos.map(photo => [photo.path, `${prefix}${photo.path}`]));
    const tables = structuredClone(backup.tables);
    for (const row of tables.place_images) row.storage_path = mapping.get(row.storage_path);
    const bucket = storage('place-images', settings, 'cloud');
    const attempted = [];
    async function cleanup() {
      for (let index = 0; index < attempted.length; index += 100) await bucket.remove(attempted.slice(index, index + 100));
    }
    try {
      for (const photo of backup.photos) {
        const path = mapping.get(photo.path);
        attempted.push(path);
        const { error } = await bucket.upload(path, photo.blob, { contentType: photo.mimeType, upsert: false });
        if (error) throw error;
      }
    } catch (error) { await cleanup(); throw error; }
    const { data, error } = await rpc('restore_empty_backup', { p_backup: tables }, settings);
    if (error) {
      if (error.status >= 400 && error.status < 500) {
        await cleanup();
        throw error;
      }
      // A lost RPC response may mean the transaction committed. Never remove its photos.
      let confirmed = true;
      try {
        for (const table of TABLES) {
          const actual = await readAllCloudRows(table, settings);
          const expectedIds = new Set(tables[table].map(row => row.id));
          if (actual.length !== expectedIds.size || actual.some(row => !expectedIds.has(row.id))) confirmed = false;
          if (table === 'place_images' && actual.some(row => row.storage_path !== tables.place_images.find(expected => expected.id === row.id)?.storage_path)) confirmed = false;
        }
      } catch (_) { confirmed = false; }
      if (!confirmed) throw makeError('복원 요청의 응답을 확인하지 못했습니다. 사진 원본과 로컬 기록은 보존했습니다. 인터넷 연결 후 새로고침하여 클라우드 기록을 확인해 주세요. 확인 전에는 같은 복원을 반복하지 마세요.', 'RESTORE_UNCERTAIN');
    }
    clearURLs();
    return data || { dates: tables.dates.length, places: tables.places.length, photos: backup.photos.length };
  }
  async function promoteLocalToCloud() {
    const backup = await exportBackup({ mode: 'local' });
    if (!backup.tables.dates.length && !backup.tables.places.length && !backup.photos.length) throw makeError('이 기기에 옮길 로컬 기록이 없습니다.');
    return restoreBackupToCloud(backup);
  }
  async function getLocalCounts() {
    return transaction(ALL_STORES, false, rows => ({ dates: rows.dates.length, places: rows.places.length, photos: rows.photos.length }));
  }
  async function readAllRows(table, options = {}) {
    assertTable(table);
    const settings = getSettings();
    const mode = options.mode || modeFor(settings);
    return mode === 'cloud' ? readAllCloudRows(table, settings) : transaction([table], false, rows => rows[table]);
  }
  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) return false;
    return navigator.storage.persist();
  }
  window.addEventListener('storage', event => { if (event.key === SETTINGS_KEY) clearURLs(); });
  window.OurDateStore = {
    client: { from: table => new Query(table), storage: { from: bucket => storage(bucket) }, rpc },
    get mode() { return modeFor(getSettings()); },
    getSettings, saveSettings, generatePairKey, exportBackup, importBackup,
    restoreBackupToCloud, promoteLocalToCloud, getLocalCounts, readAllRows, requestPersistentStorage
  };
})();
