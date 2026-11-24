#!/usr/bin/env node
/* My Port CLI — ให้ Claude เขียนข้อมูลที่ถอดจากรูปเข้าเว็บ (ข้อมูลเข้ารหัสด้วย PIN ก่อนขึ้น GitHub เสมอ)

   ตั้งค่าเครื่องละครั้ง: ไฟล์ %USERPROFILE%\.port-tracker.json = {"pin":"…"}  (หรือ env PORT_PIN)
   Token GitHub: env PORT_GH_TOKEN หรือ `gh auth token`

   คำสั่ง
     node tools/port-cli.js summary                         สรุปงวดล่าสุด + เดือนล่าสุดของรายรับรายจ่าย
     node tools/port-cli.js pull --out <file.json>          ดึงข้อมูลถอดรหัสแล้วเซฟลงไฟล์ (ใช้ใน scratchpad เท่านั้น)
     node tools/port-cli.js apply --patch <patch.json> [--dry]
     ตัวเลือก --local <state.json> = ทำงานกับไฟล์ในเครื่องแทน GitHub (ทดสอบ)

   รูปแบบ patch.json
   {
     "snapshot": {"date":"2026-11-24", "fx":33.86,
                  "set": {"st-dime":{"u":"23537.83"}, "st-bls-th":{"t":"1045267"}},
                  "holdings": {"bls":[{"s":"SISB","q":6000,"a":9.67,"p":8.24}], "dime":[{"s":"QQQI","v":18451.89,"pl":-1515.14,"ccy":"USD"}]},
                  "note":"…"},
     "ie": {"2026-11": {"v":{"food":12000,"prof":30000}, "src":"แอปจดรายจ่าย"}},
     "projects": {"ws-ai-1": {"name":"…", "lines":[…]}}
   }
   งวดใหม่ (วันที่ยังไม่มี) จะยกยอดบัญชีอื่นจากงวดล่าสุดมาให้ และจดไว้ใน carried[] ให้เว็บแสดงว่า "ยกยอด" */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const {execSync} = require('child_process');
const C = require('../core.js');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = k => { const i = args.indexOf('--'+k); return i>=0 ? (args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : true) : null; };

function cfg(){
  let pin = process.env.PORT_PIN;
  const f = path.join(os.homedir(), '.port-tracker.json');
  if(!pin && fs.existsSync(f)) pin = JSON.parse(fs.readFileSync(f,'utf8')).pin;
  if(!pin) throw new Error('ไม่พบ PIN: สร้างไฟล์ '+f+' = {"pin":"…"}');
  let token = process.env.PORT_GH_TOKEN;
  if(!token && !opt('local')) token = execSync('gh auth token').toString().trim();
  return {pin, token};
}
const H = t => ({'Authorization':'Bearer '+t, 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'port-cli'});
const URL_ = p => `https://api.github.com/repos/${C.GH.owner}/${C.GH.repo}/contents/${p}`;

async function ghGet(c){
  for(const p of [C.GH.path, C.GH.legacyPath]){
    const r = await fetch(URL_(p)+'?ref='+C.GH.branch, {headers:H(c.token), cache:'no-store'});
    if(r.status===404) continue;
    if(!r.ok) throw new Error('GET '+p+' '+r.status);
    const j = await r.json();
    const blob = JSON.parse(C.b64ToUtf8(j.content));
    const data = C.migrate(await C.decryptJSON(blob, c.pin));
    return {sha: p===C.GH.path ? j.sha : null, data, from:p};
  }
  return {sha:null, data:null, from:null};
}
async function ghPut(c, obj, sha){
  const blob = await C.encryptJSON(obj, c.pin);
  const body = {message:'sync (cli) '+new Date().toISOString(), branch:C.GH.branch, content:C.utf8ToB64(JSON.stringify(blob))};
  if(sha) body.sha = sha;
  const r = await fetch(URL_(C.GH.path), {method:'PUT', headers:{...H(c.token),'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if(!r.ok) throw new Error('PUT '+r.status+' '+(await r.text()).slice(0,200));
}
async function load(c){
  const local = opt('local');
  if(local) return {data: C.migrate(JSON.parse(fs.readFileSync(local,'utf8'))), sha:null, from:local};
  return ghGet(c);
}
async function save(c, data, sha){
  const local = opt('local');
  if(local){ fs.writeFileSync(local, JSON.stringify(data,null,1)); return; }
  await ghPut(c, data, sha);
}

const fmt = n => isFinite(n) ? Math.round(n).toLocaleString('en-US') : String(n);
function latest(s){ return (s.snapshots||[]).filter(x=>!x.deleted).sort((a,b)=>a.date.localeCompare(b.date)).pop(); }
function total(s, snap){ return s.accounts.reduce((t,a)=>t+(C.cellVal(snap,a.id)||0),0); }

function applyPatch(s, p){
  const now = Date.now(), log = [];
  if(p.snapshot){
    const P = p.snapshot;
    let snap = s.snapshots.find(x=>x.date===P.date && !x.deleted);
    const prev = latest(s);
    if(!snap){
      snap = {date:P.date, fx:P.fx || (prev&&prev.fx) || 33, v:{}, carried:[]};
      if(prev) for(const a of s.accounts){
        if(a.archived || !prev.v[a.id]) continue;
        snap.v[a.id] = JSON.parse(JSON.stringify(prev.v[a.id]));
        snap.carried.push(a.id);
      }
      s.snapshots = s.snapshots.filter(x=>x.date!==P.date);
      s.snapshots.push(snap);
      log.push(`งวดใหม่ ${P.date} (ยกยอดจาก ${prev?prev.date:'—'})`);
    }
    if(P.fx) snap.fx = P.fx;
    for(const [id,val] of Object.entries(P.set||{})){
      const acc = s.accounts.find(a=>a.id===id);
      if(!acc) throw new Error('ไม่มีบัญชี id '+id);
      const before = snap.v[id] ? C.cellVal(snap,id) : null;
      if(val===null) delete snap.v[id]; else snap.v[id] = {...(val.t!=null?{t:String(val.t)}:{}), ...(val.u!=null?{u:String(val.u)}:{})};
      snap.carried = (snap.carried||[]).filter(x=>x!==id);
      log.push(`  ${acc.n}: ${before===null?'—':fmt(before)} → ${val===null?'ลบ':fmt(C.cellVal(snap,id))}`);
    }
    if(P.holdings) snap.h = {...(snap.h||{}), ...P.holdings};
    if(P.note) snap.note = P.note;
    snap.updatedAt = now;
    log.push(`  รวมทั้งพอร์ต ${fmt(total(s,snap))}` + (snap.carried&&snap.carried.length ? ` · ยกยอด ${snap.carried.length} บัญชี` : ''));
  }
  for(const [k,rec] of Object.entries(p.ie||{})){
    if(!/^\d{4}-\d{2}$/.test(k)) throw new Error('เดือนต้องเป็น YYYY-MM: '+k);
    const ids = new Set([...C.IE_EXP_IDS(), ...C.IE.income.map(i=>i.id), 'fun', 'trip']);
    for(const id of Object.keys(rec.v||{})) if(!ids.has(id)) throw new Error('ไม่รู้จักหมวด '+id+' ใน '+k);
    s.ie[k] = {v:rec.v, src:rec.src||'', note:rec.note||'', updatedAt:now};
    const y = C.ieYear(s, Number(k.slice(0,4))).months.find(m=>m.key===k);
    log.push(`รายรับรายจ่าย ${k}: รับ ${fmt(y.income)} · จ่าย ${fmt(y.expense)} · ฟุ่มเฟือย ${fmt(y.funAct)} (งบคงเหลือ ${fmt(y.diff)}) · ออมเที่ยว ${fmt(y.trip)}`);
  }
  for(const [id,pr] of Object.entries(p.projects||{})){
    const old = s.projects[id] || {};
    s.projects[id] = {...old, ...pr, id, updatedAt:now};
    const t = C.projectTotals(s.projects[id]);
    log.push(`Project ${pr.name||old.name}: รายได้ ${fmt(t.incAct||t.incEst)} · กำไร ${fmt(t.profit)} · ค้างจ่าย ${fmt(t.due)}`);
  }
  return log;
}

(async()=>{
  try{
    const c = cfg();
    if(cmd==='summary' || cmd==='pull'){
      const {data, from} = await load(c);
      if(!data) throw new Error('ยังไม่มีข้อมูลบน GitHub');
      if(cmd==='pull'){ const out = opt('out'); if(!out) throw new Error('ต้องระบุ --out'); fs.writeFileSync(out, JSON.stringify(data,null,1)); }
      const L = latest(data);
      console.log('แหล่ง:', from);
      console.log('งวดล่าสุด:', L.date, '· fx', L.fx, '· รวม', fmt(total(data,L)), L.carried&&L.carried.length?`· ยกยอด ${L.carried.length}`:'');
      for(const a of data.accounts.filter(a=>!a.archived)) if(L.v[a.id]) console.log('  ', a.id.padEnd(14), a.n.padEnd(22), fmt(C.cellVal(L,a.id)), (L.carried||[]).includes(a.id)?'(ยกยอด)':'');
      const ks = Object.keys(data.ie||{}).filter(k=>!data.ie[k].deleted).sort();
      console.log('รายรับรายจ่าย: ', ks.length ? ks[0]+' … '+ks[ks.length-1] : 'ยังไม่มี');
      console.log('Projects:', Object.values(data.projects||{}).filter(p=>!p.deleted).map(p=>p.name).join(', ')||'—');
      return;
    }
    if(cmd==='apply'){
      const patch = JSON.parse(fs.readFileSync(opt('patch'),'utf8'));
      const {data, sha, from} = await load(c);
      const s = data || C.migrate({accounts:[], snapshots:[], cf:[], exp:{}});
      const log = applyPatch(s, patch);
      console.log(log.join('\n'));
      if(opt('dry')){ console.log('\n(--dry: ยังไม่บันทึก)'); return; }
      try{ await save(c, C.normState(s), sha); }
      catch(e){
        if(!String(e.message).includes('409')) throw e;
        const again = await load(c);                       // มีเครื่องอื่นเพิ่งซิงก์: ดึงใหม่ รวม แล้ว apply ซ้ำ
        const merged = C.mergeStates(again.data, s);
        await save(c, C.normState(merged), again.sha);
      }
      console.log('\nบันทึกแล้ว →', opt('local') ? from : `GitHub ${C.GH.branch}/${C.GH.path}`);
      return;
    }
    console.log(fs.readFileSync(__filename,'utf8').split('\n').slice(1,22).join('\n'));
  }catch(e){ console.error('ผิดพลาด:', e.message); process.exit(1); }
})();
