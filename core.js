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
/* หมวดที่บันทึกไว้ (ให้ Project ลิงก์ยอดได้)
   raw = ชื่อหมวดตามแอปจดรายจ่าย (เก็บไว้ใน ie[เดือน].raw = {inc:{ชื่อ:ยอด}, exp:{…}})
   id  = หมวดของเว็บ (ใช้ได้ทุกเดือน รวมเดือนที่มาจาก Excel) */
function ieCatalog(state){
  const raw = {inc:{}, exp:{}};
  for(const [k,rec] of Object.entries(state.ie||{})){
    if(!rec || rec.deleted || !rec.raw) continue;
    for(const kind of ['inc','exp']) for(const n of Object.keys(rec.raw[kind]||{})) raw[kind][n] = (raw[kind][n]||0)+1;
  }
  const ids = [...IE.income.map(x=>({kind:'inc', id:x.id, n:x.n})),
    ...[...IE.monthly, ...IE.annual.filter(a=>!a.subs), ...IE.unplanSubs, IE.fun, IE.trip].map(x=>({kind:'exp', id:x.id, n:x.n}))];
  return {raw, ids};
}
function srcKey(src){ return !src ? '' : src.t==='raw' ? 'raw|'+src.k+'|'+src.n : 'id|'+src.id; }
function parseSrc(v){
  if(!v) return null;
  const [t,a,...rest] = v.split('|');
  return t==='raw' ? {t:'raw', k:a, n:rest.join('|')} : {t:'id', id:a};
}
function linkedAmount(state, src, from, to){
  let sum = 0, months = 0;
  for(const [k,rec] of Object.entries(state.ie||{})){
    if(!rec || rec.deleted) continue;
    if(from && k < from) continue;
    if(to && k > to) continue;
    const x = src.t==='raw' ? n0(rec.raw && rec.raw[src.k] && rec.raw[src.k][src.n]) : n0(rec.v && rec.v[src.id]);
    if(x){ sum += x; months++; }
  }
  return {sum, months};
}
// ยอดจริงของบรรทัด: ถ้าลิงก์หมวดไว้ ดึงจากรายรับรายจ่ายในช่วงเดือนของ Project
function lineAct(state, p, l){
  if(l.src && state) return linkedAmount(state, l.src, p.from, p.to).sum;
  return l.act;
}
function projectTotals(p, state){
  const t = {incEst:0, incAct:0, expEst:0, expAct:0, due:0, receivable:0};
  const lines = (p.lines||[]).map(l=>({...l, act: lineAct(state, p, l)}));
  for(const l of lines){
    const est = n0(l.est), act = n0(l.act);
    if(l.kind==='inc'){ t.incEst += est; t.incAct += act; if(l.st==='due') t.receivable += act||est; }
    else { t.expEst += est; t.expAct += act; if(l.st==='due') t.due += act||est; }
  }
  // กำไรตามเกณฑ์คงค้าง: รายการที่ยังไม่มียอดจริงใช้ยอดประมาณการ
  const accr = lines.reduce((s,l)=>{
    const val = (l.act!==undefined && l.act!=='' && l.act!==null) ? n0(l.act) : n0(l.est);
    return s + (l.kind==='inc' ? val : -val);
  },0);
  t.profitEst = t.incEst - t.expEst;
  t.profit = accr;
  t.margin = (t.incAct||t.incEst) ? accr/(t.incAct||t.incEst) : null;
  return t;
}

/* ---------- ผลตอบแทนจริง (Reconcile) ----------
   มูลค่าปลายงวด − มูลค่าต้นงวด − เงินออมที่เติมเข้าพอร์ต = ผลตอบแทนจากการลงทุน
   เงินออมที่เติม = รายได้งาน (วิชาชีพ/นายหน้า/คืนภาษี/อื่น) − รายจ่าย − ฟุ่มเฟือย (− ออมเที่ยว ถ้าเงินนั้นไม่ได้อยู่ในพอร์ต)
   รายได้จากการลงทุน (ดอกเบี้ย/ปันผล/ค่าเช่า) เป็นส่วนหนึ่งของผลตอบแทน
   % = Modified Dietz: กำไร ÷ (ต้นงวด + ครึ่งหนึ่งของเงินที่เติม) */
const INV_INCOME = ['int','div','rent'];
function snapTotal(state, snap){ return (state.accounts||[]).reduce((t,a)=>t+(cellVal(snap,a.id)||0),0); }
function liveSnaps(state){ return (state.snapshots||[]).filter(s=>!s.deleted).sort((a,b)=>a.date.localeCompare(b.date)); }
function monthsBetween(a, b){ // เดือนหลังเดือนของ a ถึงเดือนของ b (a < b)
  const out = []; let [y,m] = a.slice(0,7).split('-').map(Number);
  const end = b.slice(0,7);
  for(let i=0;i<600;i++){ m++; if(m>12){m=1;y++;} const k = y+'-'+String(m).padStart(2,'0'); if(k>end) break; out.push(k); }
  return out;
}
function flowsFor(state, months, opt){
  const f = {work:0, inv:0, spend:0, fun:0, trip:0, missing:[]};
  for(const k of months){
    const rec = state.ie && state.ie[k];
    if(!rec || rec.deleted){ f.missing.push(k); continue; }
    const v = rec.v||{};
    for(const i of IE.income) (INV_INCOME.includes(i.id) ? (f.inv += n0(v[i.id])) : (f.work += n0(v[i.id])));
    for(const id of IE_EXP_IDS()) f.spend += n0(v[id]);
    f.fun += n0(v.fun); f.trip += n0(v.trip);
  }
  f.contrib = f.work - f.spend - f.fun - (opt && opt.tripInPort ? 0 : f.trip);
  return f;
}
function reconcile(state, beginSnap, endSnap, opt){
  const begin = snapTotal(state, beginSnap), end = snapTotal(state, endSnap);
  const months = monthsBetween(beginSnap.date, endSnap.date);
  const f = flowsFor(state, months, opt);
  const gain = end - begin - f.contrib;
  const base = begin + f.contrib/2;
  const ret = base ? gain/base : null;
  const days = (new Date(endSnap.date) - new Date(beginSnap.date))/864e5;
  const annual = (ret!==null && days>0) ? Math.pow(1+ret, 365/days)-1 : null;
  return {beginSnap, endSnap, begin, end, months, ...f, gain, invIncome:f.inv, priceGain: gain - f.inv,
    ret, annual, days, carried:(endSnap.carried||[]).length};
}
// เลือกงวดต้น/ปลายตามช่วงเวลา: period = 'YTD' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'ALL' | {from:'YYYY-MM-DD', to:'YYYY-MM-DD'}
function pickPeriod(state, period, opt){
  const S = liveSnaps(state); if(S.length<2) return null;
  let endSnap = S[S.length-1], from;
  if(typeof period==='object'){
    endSnap = [...S].reverse().find(s=>s.date<=period.to) || S[S.length-1];
    from = period.from;
  }else if(period==='ALL'){ from = S[0].date; }
  else if(period==='YTD'){ from = (Number(endSnap.date.slice(0,4))-1)+'-12-31'; }
  else{
    const n = parseInt(period), d = new Date(endSnap.date);
    if(period.endsWith('M')) d.setMonth(d.getMonth()-n); else d.setFullYear(d.getFullYear()-n);
    from = d.toISOString().slice(0,10);
  }
  // งวดต้น = งวดล่าสุดที่ไม่เกินวันเริ่ม (ถ้าไม่มี ใช้งวดแรก)
  let beginSnap = [...S].reverse().find(s=>s.date<=from && s.date<endSnap.date) || S[0];
  if(beginSnap===endSnap) return null;
  const r = reconcile(state, beginSnap, endSnap, opt);
  // แยกรายช่วงระหว่างงวด
  const inner = S.filter(s=>s.date>=beginSnap.date && s.date<=endSnap.date);
  r.intervals = inner.slice(1).map((s,i)=>reconcile(state, inner[i], s, opt));
  r.requestedFrom = from;
  return r;
}

/* ---------- แผนการเงินระยะยาว (สูตรเดียวกับชีต budget_set_2026) ----------
   ปลายปี = ต้นปี × (1+ผลตอบแทน) + รายได้ − รายจ่าย − ฟุ่มเฟือย + รายการก้อน
   รายจ่ายโตตามเงินเฟ้อทุกปี · ฟุ่มเฟือย = % ของรายได้ (ถ้าพอร์ตต้นปีเกินเกณฑ์ ใช้อีก %)
   จุดอิสรภาพทางการเงิน = ปีแรกที่พอร์ตต้นปี ≥ รายจ่ายปีนั้น ÷ (ผลตอบแทน − เงินเฟ้อ)
   (ผลตอบแทนจ่ายค่าใช้จ่ายได้ และพอร์ตยังโตทันเงินเฟ้อ = อยู่ได้ตลอดไปโดยไม่ต้องทำงาน) */
const PLAN_ONEOFFS = [[28,-40000,'มือถือ'],[32,-500000,'รถ'],[33,-40000,'มือถือ'],[38,-40000,'มือถือ'],[43,-40000,'มือถือ'],
  [45,-600000,'รถ'],[48,-40000,'มือถือ'],[53,-40000,'มือถือ'],[58,-40000,'มือถือ'],[60,-700000,'รถ'],[63,-40000,'มือถือ'],
  [68,-40000,'มือถือ'],[73,-40000,'มือถือ'],[78,-40000,'มือถือ']];
function defaultPlan(){
  return {id:'main', name:'แผนหลัก', main:true, updatedAt:0,
    a:{birthYear:1999, startYear:2026, startBal:7150000, useActual:true, exRe:false,
       ret:5, inf:2, income:1000000, incomeGrowth:0, retireAge:36, pension:22800, pensionAge:56,
       expense:357000, funRate:15, richRate:50, richAt:30000000, endAge:100},
    oneoffs: PLAN_ONEOFFS.map(([age,amt,n],i)=>({id:'o'+i, age, amt, n})),
    rules: []};
}
const PLAN_WHAT = {income:'รายได้', expense:'รายจ่าย', ret:'ผลตอบแทน %', inf:'เงินเฟ้อ %'};
function ruleAdj(rules, what, age, base){
  let x = base;
  for(const r of rules||[]){
    if(r.what!==what) continue;
    const from = (r.from===''||r.from==null) ? -Infinity : n0(r.from);
    const to = (r.to===''||r.to==null) ? Infinity : n0(r.to);
    if(age<from || age>to) continue;
    const v = n0(r.v);
    if(r.how==='set') x = v; else if(r.how==='pct') x = x*(1+v/100); else x = x + v;
  }
  return x;
}
// ctx = {actualDate, actualTotal, actualExRe} ยอดพอร์ตจริงล่าสุด (ใช้เมื่อ a.useActual)
function planProject(plan, ctx, over){
  const a = {...plan.a, ...(over||{})}, rules = plan.rules||[];
  const oneoff = {};
  for(const o of plan.oneoffs||[]) oneoff[n0(o.age)] = (oneoff[n0(o.age)]||0) + n0(o.amt);
  const startYear = n0(a.startYear), birth = n0(a.birthYear);
  let bal = n0(a.startBal), firstYear = startYear;
  if(a.useActual && ctx && ctx.actualDate){
    const y = Number(ctx.actualDate.slice(0,4)), m = Number(ctx.actualDate.slice(5,7));
    firstYear = Math.max(startYear, m>=10 ? y+1 : y);   // งวด ต.ค.–ธ.ค. ถือเป็นยอดต้นปีถัดไป
    bal = a.exRe ? n0(ctx.actualExRe) : n0(ctx.actualTotal);
  }
  const rows = [];
  let exp = n0(a.expense);
  for(let y=startYear; y<=birth+n0(a.endAge); y++){
    const age = y - birth;
    const inf = ruleAdj(rules,'inf',age,n0(a.inf))/100;
    if(y>startYear) exp = exp*(1+inf);
    if(y<firstYear) continue;
    const r = ruleAdj(rules,'ret',age,n0(a.ret))/100;
    const work = age < n0(a.retireAge) ? n0(a.income)*Math.pow(1+n0(a.incomeGrowth)/100, y-startYear) : 0;
    const income = ruleAdj(rules,'income',age,work) + (age>=n0(a.pensionAge) ? n0(a.pension) : 0);
    const expense = ruleAdj(rules,'expense',age,exp);
    const begin = bal, retAmt = begin*r;
    const fun = Math.max(0,income) * (begin>n0(a.richAt) ? n0(a.richRate) : n0(a.funRate))/100;
    const one = oneoff[age]||0;
    const end = begin + retAmt + income - expense - fun + one;
    rows.push({year:y, age, begin, r, inf, retAmt, income, work, expense, fun, one, end,
      need: r>inf ? expense/(r-inf) : Infinity, need4: expense*25});
    bal = end;
  }
  return rows;
}
// safe = ใช้กฎถอน 4% (ยอดที่ต้องมี = 25 เท่าของรายจ่าย) แทน
function planSummary(plan, ctx, safe){
  const rows = planProject(plan, ctx);
  const needOf = r => safe ? r.need4 : r.need;
  const fi = rows.find(r => r.begin >= needOf(r));
  const endAt = age => { const r = rows.find(x=>x.age===age); return r ? r.end : null; };
  const dep = rows.find(r => r.end < 0);
  let earliest = null;
  if(rows.length) for(let R=rows[0].age; R<=n0(plan.a.endAge); R++){
    if(planProject(plan, ctx, {retireAge:R}).every(x=>x.end>=0)){ earliest = R; break; }
  }
  const first = rows[0];
  const need0 = first ? needOf(first) : null;
  return {rows, fi, fiAge: fi?fi.age:null, fiYear: fi?fi.year:null, at80:endAt(80), at90:endAt(90),
    depleteAge: dep?dep.age:null, earliest, need0, progress: (first && isFinite(need0) && need0>0) ? first.begin/need0 : null};
}

/* ---------- Budget vs Actual (รายปี) ----------
   งบรายจ่าย = ieCfg.budgets (ชุดเดียวกับแท็บรายรับรายจ่าย) · งบรายรับและเงินเที่ยว = state.budget[ปี]
   งบฟุ่มเฟือย = % ของงบรายได้งาน · คาดการณ์ทั้งปี = จริงถึงเดือนล่าสุด + งบของเดือนที่เหลือ (รายจ่ายรายปีใช้ค่าที่มากกว่า) */
// planIncome = รายได้งานของปีนั้นจากแผนหลัก ใช้เป็นงบรายรับเมื่อยังไม่ได้ตั้งงบรายหมวด
function budgetVsActual(state, year, planIncome){
  const cfg = state.ieCfg || defaultIeCfg(), B = cfg.budgets || {};
  const rec = state.budget && state.budget[year];
  const bud = (rec && !rec.deleted) ? rec : {inc:{}, trip:0};
  const Y = ieYear(state, year), M = Y.months;
  const lastM = M.length ? M[M.length-1].m : 0, share = lastM/12;
  const act = id => M.reduce((t,m)=>t+n0(m.v[id]),0);
  const L = (grp,id,n,b,a,fc) => ({grp, id, n, budget:b, toDate:b*share, actual:a, forecast: fc!==undefined ? fc : a + b*(1-share)});
  const lines = [];
  const hasInc = IE.income.some(i=>n0(bud.inc && bud.inc[i.id]));
  if(!hasInc && n0(planIncome)){
    // ยังไม่ตั้งงบรายหมวด: เทียบรายได้งานรวมกับแผนหลัก ส่วนรายได้จากการลงทุนแสดงยอดจริงอย่างเดียว
    const fa = IE.income.filter(i=>i.fun).reduce((t,i)=>t+act(i.id),0);
    lines.push(L('inc', '_plan', 'รายได้งานรวม (งบจากแผนหลัก)', n0(planIncome), fa));
    for(const i of IE.income.filter(i=>!i.fun)){ const a = act(i.id); if(a) lines.push(L('inc', i.id, i.n, 0, a)); }
  }else for(const i of IE.income){
    const b = n0(bud.inc && bud.inc[i.id]), a = act(i.id);
    if(b || a) lines.push(L('inc', i.id, i.n, b, a));
  }
  for(const c of IE.monthly) lines.push(L('mon', c.id, c.n, n0(B[c.id])*12, act(c.id)));
  for(const c of IE.annual){
    const b = n0(B[c.id]), a = c.subs ? c.subs.reduce((t,id)=>t+act(id),0) : act(c.id);
    lines.push(L('ann', c.id, c.n, b, a, Math.max(a,b)));
  }
  const workBud = hasInc ? IE.income.filter(i=>i.fun).reduce((t,i)=>t+n0(bud.inc && bud.inc[i.id]),0) : n0(planIncome);
  lines.push(L('fun', 'fun', IE.fun.n, workBud*n0(cfg.funRate), act('fun')));
  lines.push(L('trip', 'trip', IE.trip.n, n0(bud.trip), act('trip')));
  const sum = (grps, k) => lines.filter(l=>grps.includes(l.grp)).reduce((t,l)=>t+l[k],0);
  const T = {};
  for(const k of ['budget','toDate','actual','forecast']){
    const inc = sum(['inc'],k), exp = sum(['mon','ann'],k), fun = sum(['fun'],k);
    T[k] = {inc, exp, fun, trip: sum(['trip'],k), save: inc - exp - fun};   // เงินเที่ยวนับเป็นเงินออม (เหมือนแท็บรายรับรายจ่าย)
  }
  const monthlySaveBud = T.budget.save/12;
  let cum = 0;
  const cumRows = M.map(m=>{ cum += m.saved; return {m:m.m, actual:cum, budget:monthlySaveBud*m.m}; });
  return {year, lastM, lines, T, cumRows, hasIncBudget: hasInc, fromPlan: !hasInc && !!n0(planIncome), rec: rec||null};
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
  if(!s.plans) s.plans = {};
  if(!s.plans.main) s.plans.main = defaultPlan();
  if(!s.budget) s.budget = {};
  s.v = 2;
  return s;
}
function normState(s){
  return {v:2, accounts:s.accounts, cf:s.cf, exp:s.exp, settingsUpdatedAt:s.settingsUpdatedAt||0,
    snapshots:[...(s.snapshots||[])].sort((a,b)=>a.date.localeCompare(b.date)),
    ie: sortObj(s.ie||{}), ieCfg: s.ieCfg||null, projects: sortObj(s.projects||{}),
    plans: sortObj(s.plans||{}), budget: sortObj(s.budget||{})};
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
    ie: mergeMap(a.ie, b.ie), ieCfg, projects: mergeMap(a.projects, b.projects),
    plans: mergeMap(a.plans, b.plans), budget: mergeMap(a.budget, b.budget)}));
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

const api = {defaultPlan, PLAN_WHAT, planProject, planSummary, budgetVsActual, reconcile, pickPeriod, snapTotal, CATS, IE, IE_EXP_IDS, defaultIeCfg, ieYear, projectTotals, ieCatalog, srcKey, parseSrc, linkedAmount, lineAct, NEW_ACCOUNTS, migrate, normState,
  mergeStates, mergeMap, evalExpr, cellVal, encryptJSON, decryptJSON, utf8ToB64, b64ToUtf8, GH, n0};
root.PortCore = api;
if(typeof module!=='undefined' && module.exports) module.exports = api;
})(typeof window!=='undefined' ? window : globalThis);
