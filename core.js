/* My Port — shared logic (browser + Node CLI)
   ใช้ร่วมกันระหว่าง index.html และ tools/port-cli.js เพื่อให้คำนวณ/รวมข้อมูลเหมือนกันทุกที่ */
(function(root){
'use strict';

const CATS = [
  {id:'saving', name:'เงินฝาก (Saving)', color:'#3b82b8'},
  {id:'fund',   name:'กองทุน (Fund)',    color:'#6b5fb5'},
  {id:'bond',   name:'ตราสารหนี้ (Bond)', color:'#0d7a6b'},
  {id:'stock',  name:'หุ้น (Stock)',      color:'#d9534f'},
  {id:'gold',   name:'ทองคำ (Gold)',     color:'#d99a1e'},
  {id:'crypto', name:'คริปโต (Crypto)',  color:'#9b4dca'},
  {id:'re',     name:'อสังหาฯ',          color:'#8a9a9f'},
];

/* ---------- รายรับรายจ่าย (ตามชีต Track_expense) ---------- */
const IE = {
  monthly: [
    {id:'food',     n:'อาหาร'},
    {id:'phone',    n:'โทรศัพท์และ subscription'},
    {id:'personal', n:'ของใช้และตัดผม'},
    {id:'travel',   n:'เดินทาง'},
    {id:'sso',      n:'ประกันสังคม'},
    {id:'sport',    n:'สุขภาพและกีฬา'},
  ],
  annual: [
    {id:'car',       n:'ประกันรถ ต่อทะเบียน พ.ร.บ.'},
    {id:'healthins', n:'ประกันสุขภาพ ตรวจสุขภาพ ทำฟัน'},
    {id:'condo',     n:'ส่วนกลางคอนโดและประกัน'},
    {id:'unplan',    n:'รายจ่าย unplan', subs:['social','medical','auditeq']},
  ],
  unplanSubs: [
    {id:'social',  n:'ภาษีสังคม (ซองงานแต่ง)'},
    {id:'medical', n:'ค่ารักษา'},
    {id:'auditeq', n:'ค่า audit อุปกรณ์'},
  ],
  income: [
    {id:'prof',   n:'ค่าวิชาชีพ (สอบบัญชี/รีวิวงบ)', tax:'40(6)', fun:true},
    {id:'comm',   n:'นายหน้า / Incentive',          tax:'40(2)', fun:true},
    {id:'refund', n:'เงินคืนภาษี',                   tax:'—',     fun:true},
    {id:'int',    n:'ดอกเบี้ย',                       tax:'40(4)ก', fun:false},
    {id:'div',    n:'ปันผล',                          tax:'40(4)ข', fun:false},
    {id:'rent',   n:'ค่าเช่า',                        tax:'40(5)', fun:false},
    {id:'other',  n:'รายได้อื่น (ไม่คิดงบฟุ่มเฟือย)',   tax:'—',     fun:false},
  ],
  fun:  {id:'fun',  n:'ฟุ่มเฟือย (รวมซื้อของให้คนอื่น)'},
  trip: {id:'trip', n:'ออมเงินเที่ยว (ออมเนย)'},
};
function defaultIeCfg(){
  return {
    updatedAt: 0,
    funRate: 0.15,
    budgets: {food:15000, phone:1500, personal:300, travel:1700, sso:500, sport:1000,
              car:12000, healthins:30000, condo:28000, unplan:20000},
    // หมวดในแอปจดรายจ่าย → หมวดในเว็บ (ใช้ตอน Claude ถอดรูป)
    appMap: {
      'อาหาร':'food', 'โทรศัพท์และ subscription':'phone', 'ของใช้':'personal', 'ตัดผม':'personal',
      'เดินทาง':'travel', 'ประกันสังคม':'sso', 'กีฬา':'sport',
      'ยานพาหนะ (ประกันรถ,พรบ,เช็คสภาพ,ซ่อม)':'car', 'ค่าตรวจสุขภาพ,ประกันสุขภาพ ทำฟัน':'healthins',
      'ส่วนกลางคอนโด':'condo', 'ภาษีสังคม':'social', 'ค่ารักษา':'medical', 'สอบบัญชี':'auditeq',
      'ฟุ่มเฟือย':'fun', 'ซื้อของให้คนอื่น':'fun', 'ออมเงินเที่ยว':'trip',
      'ค่าสอบบัญชี':'prof', 'ค่าบริการรีวิวงบและภงด50':'prof', 'ค่าบริการจดทะเบียนบริษัท':'prof',
      'นายหน้าค่าสอบบัญชี':'comm', 'incentive':'comm',
      'เงินปันผลหุ้น และ กองทุน':'div', 'เงินปันผล dime webull':'div', 'ค่าเช่า':'rent',
    },
  };
}
const IE_EXP_IDS = () => [...IE.monthly, ...IE.annual.filter(a=>!a.subs), ...IE.unplanSubs].map(x=>x.id);

function n0(x){ x = Number(x); return isFinite(x) ? x : 0; }

/* คำนวณทั้งปีตามสูตรใน Track_expense
   งบฟุ่มเฟือยเดือนแรก = 15%×รายได้งาน − (รายจ่ายประจำ − งบประจำ) − รายปีเกินแพลนที่เพิ่มขึ้น
   เดือนถัดไป        = ยอดคงเหลือเดือนก่อน + 15%×รายได้งาน − (รายจ่ายประจำ − งบ ถ้ามีรายจ่าย) − รายปีเกินแพลนที่เพิ่ม */
function ieYear(state, year){
  const cfg = state.ieCfg || defaultIeCfg();
  const B = cfg.budgets || {};
  const monthlyBudget = IE.monthly.reduce((s,c)=>s+n0(B[c.id]),0);
  const months = [];
  let prevDiff = null, prevOver = 0, cumNet = 0;
  const cumAnnual = {};
  for(let m=1; m<=12; m++){
    const key = year+'-'+String(m).padStart(2,'0');
    const rec = state.ie && state.ie[key];
    if(!rec || rec.deleted) continue;
    const v = rec.v || {};
    const monthlyTot = IE.monthly.reduce((s,c)=>s+n0(v[c.id]),0);
    const annual = {};
    for(const a of IE.annual){
      annual[a.id] = a.subs ? a.subs.reduce((s,id)=>s+n0(v[id]),0) : n0(v[a.id]);
      cumAnnual[a.id] = (cumAnnual[a.id]||0) + annual[a.id];
    }
    const annualTot = Object.values(annual).reduce((s,x)=>s+x,0);
    const over = IE.annual.reduce((s,a)=>s+Math.max(0, cumAnnual[a.id]-n0(B[a.id])),0);
    const overInc = over - prevOver; prevOver = over;
    const funIncome = IE.income.filter(i=>i.fun).reduce((s,i)=>s+n0(v[i.id]),0);
    const income = IE.income.reduce((s,i)=>s+n0(v[i.id]),0);
    const monthlyOver = prevDiff===null ? (monthlyTot-monthlyBudget) : (monthlyTot>0 ? monthlyTot-monthlyBudget : 0);
    const funBudget = (prevDiff||0) + funIncome*n0(cfg.funRate) - monthlyOver - overInc;
    const funAct = n0(v.fun);
    const diff = funBudget - funAct;
    prevDiff = diff;
    const expense = monthlyTot + annualTot;
    const trip = n0(v.trip);
    const net = income - expense - funAct - trip;
    cumNet += net;
    const saved = income - expense - funAct; // เงินเที่ยวนับเป็นเงินออม
    months.push({key, m, v, monthlyTot, monthlyBudget, annual, annualTot, over, overInc, funIncome, income,
      funBudget, funAct, diff, expense, trip, net, cumNet, saved,
      saveRate: income>0 ? saved/income : null, src: rec.src||'', updatedAt: rec.updatedAt||0});
  }
  const annualStatus = IE.annual.map(a=>({id:a.id, n:a.n, budget:n0(B[a.id]), spent:cumAnnual[a.id]||0,
    left:n0(B[a.id])-(cumAnnual[a.id]||0)}));
  return {year, months, annualStatus, monthlyBudget, cfg};
}

/* ---------- Projects ---------- */
function projectTotals(p){
  const t = {incEst:0, incAct:0, expEst:0, expAct:0, due:0, receivable:0};
  for(const l of (p.lines||[])){
    const est = n0(l.est), act = n0(l.act);
    if(l.kind==='inc'){ t.incEst += est; t.incAct += act; if(l.st==='due') t.receivable += act||est; }
    else { t.expEst += est; t.expAct += act; if(l.st==='due') t.due += act||est; }
  }
  // กำไรตามเกณฑ์คงค้าง: รายการที่ยังไม่มียอดจริงใช้ยอดประมาณการ
  const accr = (p.lines||[]).reduce((s,l)=>{
    const val = (l.act!==undefined && l.act!=='' && l.act!==null) ? n0(l.act) : n0(l.est);
    return s + (l.kind==='inc' ? val : -val);
  },0);
  t.profitEst = t.incEst - t.expEst;
  t.profit = accr;
  t.margin = (t.incAct||t.incEst) ? accr/(t.incAct||t.incEst) : null;
  return t;
}

/* ---------- สถานะ / migrate / merge ---------- */
const NEW_ACCOUNTS = [
  {id:'sv-bls-cash', n:'เงินสดในพอร์ต BLS', c:'saving'},
  {id:'st-bls-th',   n:'BLS หุ้นไทย',        c:'stock'},
  {id:'st-bls-dr',   n:'BLS DR หุ้นนอก',     c:'stock'},
];
function migrate(s){
  if(!s) return s;
  s.accounts = s.accounts || [];
  for(const a of NEW_ACCOUNTS){
    if(!s.accounts.some(x=>x.id===a.id)){
      // แทรกต่อท้ายบัญชีกลุ่มเดียวกัน
      let idx = -1; s.accounts.forEach((x,i)=>{ if(x.c===a.c) idx=i; });
      s.accounts.splice(idx+1, 0, {...a});
    }
  }
  const old = s.accounts.find(x=>x.id==='st-bls');
  if(old && !old.archived){ old.archived = true; old.n = 'BLS (รวม — งวดเก่า)'; }
  if(!s.ie) s.ie = {};
  if(!s.projects) s.projects = {};
  if(!s.ieCfg) s.ieCfg = defaultIeCfg();
  s.v = 2;
  return s;
}
function normState(s){
  return {v:2, accounts:s.accounts, cf:s.cf, exp:s.exp, settingsUpdatedAt:s.settingsUpdatedAt||0,
    snapshots:[...(s.snapshots||[])].sort((a,b)=>a.date.localeCompare(b.date)),
    ie: sortObj(s.ie||{}), ieCfg: s.ieCfg||null, projects: sortObj(s.projects||{})};
}
function sortObj(o){ const r={}; for(const k of Object.keys(o).sort()) r[k]=o[k]; return r; }
function mergeMap(a, b){
  const out = {...(a||{})};
  for(const [k,v] of Object.entries(b||{})){
    if(!out[k] || (v.updatedAt||0) > (out[k].updatedAt||0)) out[k] = v;
  }
  return out;
}
function mergeStates(a, b){
  const map = {};
  for(const sn of [...(a.snapshots||[]), ...(b.snapshots||[])]){
    if(!map[sn.date] || (sn.updatedAt||0) > (map[sn.date].updatedAt||0)) map[sn.date] = sn;
  }
  const base = (a.settingsUpdatedAt||0) >= (b.settingsUpdatedAt||0) ? a : b;
  const ca = a.ieCfg, cb = b.ieCfg;
  const ieCfg = !ca ? cb : !cb ? ca : ((ca.updatedAt||0) >= (cb.updatedAt||0) ? ca : cb);
  return migrate(normState({accounts:base.accounts, cf:base.cf, exp:base.exp,
    settingsUpdatedAt:base.settingsUpdatedAt||0, snapshots:Object.values(map),
    ie: mergeMap(a.ie, b.ie), ieCfg, projects: mergeMap(a.projects, b.projects)}));
}

/* ---------- ค่าในงวด ---------- */
function evalExpr(s){
  if(s===undefined || s===null) return 0;
  s = String(s).replace(/,/g,'').trim(); if(s==='') return 0;
  if(!/^[0-9+\-*/(). ]+$/.test(s)) return NaN;
  try{ const v = Function('"use strict";return('+s+')')(); return (typeof v==='number' && isFinite(v)) ? v : NaN; }catch(e){ return NaN; }
}
function cellVal(snap, accId){
  const c = snap.v && snap.v[accId]; if(!c) return 0;
  const t = evalExpr(c.t), u = evalExpr(c.u);
  if(isNaN(t)||isNaN(u)) return NaN;
  return t + u*(snap.fx||0);
}

/* ---------- เข้ารหัส (AES-256-GCM + PBKDF2 600k) ---------- */
const _te = new TextEncoder(), _td = new TextDecoder();
const _subtle = () => (root.crypto || globalThis.crypto).subtle;
const _rand = n => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));
function _b64(buf){ const a=new Uint8Array(buf); let s=''; for(let i=0;i<a.length;i+=0x8000) s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000)); return btoa(s); }
function _unb64(s){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }
async function deriveKey(pin, salt){
  const km = await _subtle().importKey('raw', _te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return _subtle().deriveKey({name:'PBKDF2', salt, iterations:600000, hash:'SHA-256'}, km, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function encryptJSON(obj, pin){
  const salt = _rand(16), iv = _rand(12);
  const key = await deriveKey(pin, salt);
  const ct = await _subtle().encrypt({name:'AES-GCM', iv}, key, _te.encode(JSON.stringify(obj)));
  return {salt:_b64(salt), iv:_b64(iv), ct:_b64(ct)};
}
async function decryptJSON(blob, pin){
  const key = await deriveKey(pin, _unb64(blob.salt));
  const pt = await _subtle().decrypt({name:'AES-GCM', iv:_unb64(blob.iv)}, key, _unb64(blob.ct));
  return JSON.parse(_td.decode(pt));
}
// base64 ของ UTF-8 (GitHub Contents API)
function utf8ToB64(str){ return _b64(_te.encode(str)); }
function b64ToUtf8(b){ return _td.decode(_unb64(b.replace(/\n/g,''))); }

/* ---------- GitHub ---------- */
// data2.enc.json = รูปแบบข้อมูลใหม่ (มีรายรับรายจ่าย/Projects) — แยกไฟล์จากเวอร์ชันเก่า
// เพื่อกันหน้าเว็บเวอร์ชันเก่าที่ยังเปิดค้างอยู่เขียนทับแล้วทำข้อมูลใหม่หาย
const GH = {owner:'tpnaudit', repo:'port-tracker', path:'data2.enc.json', legacyPath:'data.enc.json', branch:'data'};

const api = {CATS, IE, IE_EXP_IDS, defaultIeCfg, ieYear, projectTotals, NEW_ACCOUNTS, migrate, normState,
  mergeStates, mergeMap, evalExpr, cellVal, encryptJSON, decryptJSON, utf8ToB64, b64ToUtf8, GH, n0};
root.PortCore = api;
if(typeof module!=='undefined' && module.exports) module.exports = api;
})(typeof window!=='undefined' ? window : globalThis);
