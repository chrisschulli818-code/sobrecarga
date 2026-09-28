// Se o CDN do pdf.js não carregar (sem internet, rede bloqueando), o resto do
// app tem que continuar funcionando — antes isso derrubava o app.js inteiro.
if(window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ---------- Idioma da interface (PT/EN) ----------
   Traduz só o texto fixo do app (botões, títulos, rótulos). Nomes de
   sessão/exercício vêm da ficha real do aluno e continuam como foram
   importados — traduzir conteúdo do usuário automaticamente não faz
   sentido aqui. */
const I18N = {
  pt: {
    appName:'Sobrecarga', gateSubhead:'Seu professor te passa esse código.',
    gateTagline:'Seu diário de treino. Registre cargas, acompanhe recordes e veja sua evolução.',
    codeLabel:'Código de acesso', gateFoot:'Professor ou admin? Use o mesmo campo com o seu código.',
    homeTab:'Início', profileTab:'Perfil',
    codePlaceholder:'Ex.: K7M2QX', enter:'Entrar', accessAsCoach:'Acessar como professor',
    coachHintToast:'Digite seu código de professor no campo acima.',
    nextWorkout:'Próximo treino', startWorkout:'Ir para o treino',
    weeksLabel:'semanas', sessionsLabel:'Sessões', exercisesLabel:'Exercícios',
    muscleMap:'Mapa Muscular', muscleMapHint:'Toque num músculo pra montar o treino na hora',
    front:'Frente', back:'Costas', importPdf:'↥ Importar / escanear PDF',
    workoutsTab:'Treinos', progressTab:'Progresso',
    newSession:'+ nova sessão', buildWorkout:'🎯 montar treino',
    noSessionsYet:'Nenhuma sessão ainda', importHint:'Importe um PDF ou crie manualmente.',
    importPdfCta:'Importe sua ficha para começar',
    logout:'sair', tourBtnTitle:'Tour do app',
  },
  en: {
    appName:'Sobrecarga', gateSubhead:'Your coach gives you this code.',
    gateTagline:'Your training diary. Log your loads, track records and see your progress.',
    codeLabel:'Access code', gateFoot:'Coach or admin? Use the same field with your code.',
    homeTab:'Home', profileTab:'Profile',
    codePlaceholder:'e.g. K7M2QX', enter:'Sign in', accessAsCoach:'Continue as coach',
    coachHintToast:'Enter your coach code in the field above.',
    nextWorkout:'Next workout', startWorkout:'Start workout',
    weeksLabel:'weeks', sessionsLabel:'Sessions', exercisesLabel:'Exercises',
    muscleMap:'Muscle map', muscleMapHint:'Tap a muscle to build a workout right now',
    front:'Front', back:'Back', importPdf:'↥ Import / scan PDF',
    workoutsTab:'Workouts', progressTab:'Progress',
    newSession:'+ new session', buildWorkout:'🎯 build workout',
    noSessionsYet:'No sessions yet', importHint:'Import a PDF or create one manually.',
    importPdfCta:'Import your workout sheet to get started',
    logout:'log out', tourBtnTitle:'App tour',
  }
};
let lang = 'pt';
try{ lang = localStorage.getItem('sobrecarga_lang') || 'pt'; }catch(e){}
function t(key){ return (I18N[lang] && I18N[lang][key]) || I18N.pt[key] || key; }
function applyStaticI18n(root){
  (root||document).querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  (root||document).querySelectorAll('[data-i18n-placeholder]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPlaceholder); });
  (root||document).querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('.lang-pill').forEach(b=> b.classList.toggle('active', b.dataset.lang===lang));
}
function setLang(l){
  lang = l;
  try{ localStorage.setItem('sobrecarga_lang', l); }catch(e){}
  applyStaticI18n();
  if(typeof mRender==='function' && auth) mRender();
}
document.querySelectorAll('.lang-pill').forEach(btn=>{
  btn.addEventListener('click', ()=> setLang(btn.dataset.lang));
});
document.getElementById('gateCoachHint')?.addEventListener('click', ()=>{
  document.getElementById('gateCodeInput').focus();
  showToast(t('coachHintToast'));
});
applyStaticI18n();

/* ---------- Autenticação por código ----------
   Sem e-mail/senha: o professor tem um código fixo e cria um código por aluno.
   O código fica guardado neste aparelho para não pedir de novo toda hora. */
const AUTH_KEY = 'sobrecarga_auth';
let auth = loadAuth();          // {role:'student', studentId, code, name} | {role:'professor', code} | {role:'admin', code} | null
let currentStudentId = null;    // aluno que o professor (ou o admin) está vendo agora
let currentProfessorCode = null; // quando o admin entra no painel de um professor, o código real dele
let currentProfessorName = null;
let READONLY = false;           // true quando o professor/admin está vendo a ficha de alguém

function loadAuth(){
  try{ return JSON.parse(localStorage.getItem(AUTH_KEY)); }catch(e){ return null; }
}
function saveAuth(a){
  auth = a;
  try{ localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }catch(e){}
}
function logout(){
  auth = null; currentStudentId = null; currentProfessorCode = null; currentProfessorName = null;
  try{ localStorage.removeItem(AUTH_KEY); }catch(e){}
  boot();
}
function activeStudentId(){ return auth && (auth.role==='professor' || auth.role==='admin') ? currentStudentId : (auth && auth.studentId); }
function apiHeaders(extra){
  const h = Object.assign({}, extra);
  if(auth && auth.role==='admin'){
    // Navegando dentro do painel de um professor: usa o código real dele
    // (só o admin consegue ver esse código, na própria lista de professores).
    // Ainda sem escolher um professor: usa o código de admin (endpoints /api/admin/*).
    if(currentProfessorCode) h['x-professor-code'] = currentProfessorCode;
    else h['x-admin-code'] = auth.code;
  }
  else if(auth && auth.role==='professor') h['x-professor-code'] = auth.code;
  else if(auth) h['x-student-code'] = auth.code;
  return h;
}

function getDeviceId(){
  let id = localStorage.getItem('sobrecarga_device_id');
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)));
    localStorage.setItem('sobrecarga_device_id', id);
  }
  return id;
}

const gateScreen = document.getElementById('gateScreen');
const gateCodeInput = document.getElementById('gateCodeInput');
const gateError = document.getElementById('gateError');
const gateUnlockReqBtn = document.getElementById('gateUnlockReqBtn');
const adminDashboard = document.getElementById('adminDashboard');
const professorDashboard = document.getElementById('professorDashboard');
const appWrap = document.getElementById('appWrap');

async function submitGateCode(){
  const code = gateCodeInput.value.trim().toUpperCase();
  if(!code) return;
  gateError.textContent = '';
  gateUnlockReqBtn.hidden = true;
  try{
    const res = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code, deviceId: getDeviceId()}) });
    if(!res.ok){
      if(res.status===409){
        gateError.textContent = 'Esse código já está em uso em outro aparelho. Peça pro seu professor liberar o acesso.';
        gateUnlockReqBtn.hidden = false;
      }
      else if(res.status===429){ gateError.textContent = 'Muitas tentativas. Espere alguns minutos e tente de novo.'; }
      else if(res.status>=500){ gateError.textContent = 'O servidor está acordando. Tente de novo em alguns segundos.'; }
      else{ gateError.textContent = 'Código inválido.'; }
      return;
    }
    const data = await res.json();
    if(data.role==='student' && data.needsName){
      const chosen = await promptStudentName();
      if(chosen){
        try{
          await fetch(`/api/students/${data.studentId}/name`, {
            method:'PUT',
            headers:{'Content-Type':'application/json','x-student-code':data.code},
            body: JSON.stringify({name: chosen})
          });
          data.name = chosen;
        }catch(e){}
      }
    }
    saveAuth(data);
    boot();
  }catch(e){
    gateError.textContent = 'Não consegui conectar. Tente de novo.';
  }
}
gateUnlockReqBtn.addEventListener('click', async ()=>{
  const code = gateCodeInput.value.trim().toUpperCase();
  if(!code) return;
  gateUnlockReqBtn.disabled = true;
  try{
    const res = await fetch('/api/unlock-request', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code}) });
    gateError.textContent = res.ok ? 'Pedido enviado! Avise seu professor pra liberar seu acesso.' : 'Não consegui enviar o pedido agora. Fale com seu professor.';
    if(res.ok) gateUnlockReqBtn.hidden = true;
  }catch(e){
    gateError.textContent = 'Não consegui enviar o pedido agora. Fale com seu professor.';
  }
  gateUnlockReqBtn.disabled = false;
});
document.getElementById('gateSubmitBtn').addEventListener('click', submitGateCode);
gateCodeInput.addEventListener('keydown', e=>{ if(e.key==='Enter') submitGateCode(); });

document.getElementById('logoutBtnProf').addEventListener('click', logout);
document.getElementById('logoutBtnAdmin').addEventListener('click', logout);
document.getElementById('profDashBackToAdmin').addEventListener('click', e=>{
  e.preventDefault();
  currentProfessorCode = null; currentProfessorName = null; currentStudentId = null;
  boot();
});
document.getElementById('professorLink').addEventListener('click', e=>{
  e.preventDefault();
  if(auth.role==='professor' || auth.role==='admin'){ currentStudentId = null; boot(); }
  else{ logout(); }
});

/* ---------- Painel do admin: cadastrar professores ---------- */
async function loadProfessors(){
  try{
    const res = await fetch('/api/admin/professors', { headers: apiHeaders() });
    if(res.status===403){ logout(); return []; }
    if(!res.ok) throw new Error('bad status');
    return await res.json();
  }catch(e){ return []; }
}
let adminProfessors = [];
async function renderAdminDashboard(){
  const list = document.getElementById('professorsList');
  list.innerHTML = `<div class="empty">Carregando…</div>`;
  adminProfessors = await loadProfessors();
  const students = adminProfessors.reduce((n,p)=> n + p.studentCount, 0);
  const withEnergy = adminProfessors.filter(p=> p.energy).reduce((n,p)=> n + p.studentCount, 0);
  document.getElementById('adminKpis').innerHTML = [
    ['Professores', adminProfessors.length],
    ['Alunos', students],
    ['Alunos com gráfico de kcal', withEnergy]
  ].map(([l,v])=> `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div></div>`).join('');
  renderProfessorRows();
}
function renderProfessorRows(){
  const list = document.getElementById('professorsList');
  if(adminProfessors.length===0){
    list.innerHTML = `<div class="empty"><strong>Nenhum professor ainda</strong>Cadastre o primeiro professor para gerar o código dele.</div>`;
    return;
  }
  const q = (document.getElementById('profSearch').value||'').trim().toLowerCase();
  const rows = adminProfessors.filter(p=> !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  if(rows.length===0){
    list.innerHTML = `<div class="empty">Nenhum professor encontrado.</div>`;
    return;
  }
  list.innerHTML = rows.map(p=> `
    <div class="prof-row">
      <div class="prof-name"><span class="avatar-sm">${escapeHtml((p.name||'?').trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(p.name)}</span></div>
      <span class="prof-code">${escapeHtml(p.code)}</span>
      <span class="prof-count">${p.studentCount} ${p.studentCount===1?'aluno':'alunos'}</span>
      <button type="button" class="switch${p.energy?' on':''}" role="switch" aria-checked="${p.energy?'true':'false'}" data-energyprof="${p.id}" data-on="${p.energy?1:0}" aria-label="Gráfico de kcal para os alunos de ${escapeAttr(p.name)}">
        <span class="switch-track"><span class="switch-knob"></span></span>
        <span class="switch-label">${p.energy?'Ligado':'Desligado'}</span>
      </button>
      <div class="prof-actions">
        <button class="small" data-viewprofessor="${p.id}" data-code="${escapeAttr(p.code)}" data-name="${escapeAttr(p.name)}">Ver painel</button>
        <button class="ghost small icon-btn" data-copyprof="${escapeAttr(p.code)}" title="Copiar código" aria-label="Copiar código">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>
        </button>
        <button class="ghost small icon-btn" data-delprof="${p.id}" data-name="${escapeAttr(p.name)}" data-count="${p.studentCount}" title="Remover professor" aria-label="Remover professor">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </div>
    </div>`).join('');
}
document.getElementById('profSearch').addEventListener('input', renderProfessorRows);
document.getElementById('addProfessorBtn').addEventListener('click', async ()=>{
  const name = prompt('Nome do novo professor:');
  if(!name || !name.trim()) return;
  const res = await fetch('/api/admin/professors', { method:'POST', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({name: name.trim()}) });
  if(!res.ok){ alert('Não consegui criar o professor.'); return; }
  const prof = await res.json();
  await renderAdminDashboard();
  alert(`Professor "${prof.name}" criado!\n\nCódigo de acesso: ${prof.code}\n\nPasse esse código para ele entrar como professor.`);
});
// Escolher pra qual professor transferir os alunos de quem está sendo removido.
function pickProfessorModal(title, options){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:360px;">
        <p style="margin-bottom:10px;"><strong>${escapeHtml(title)}</strong></p>
        <select id="pickProfSel" style="width:100%;margin-bottom:6px;">
          ${options.map(o=> `<option value="${escapeAttr(o.id)}">${escapeHtml(o.name)}</option>`).join('')}
        </select>
        <div class="confirm-actions">
          <button class="ghost small" data-act="cancel">Cancelar</button>
          <button class="primary small" data-act="ok">Transferir e remover</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e=>{
      const act = e.target.dataset && e.target.dataset.act;
      if(act==='ok'){ const v = overlay.querySelector('#pickProfSel').value; overlay.remove(); resolve(v); }
      else if(act==='cancel' || e.target===overlay){ overlay.remove(); resolve(null); }
    });
  });
}
document.getElementById('professorsList').addEventListener('click', async e=>{
  const view = e.target.closest('[data-viewprofessor]');
  if(view){
    currentProfessorCode = view.dataset.code;
    currentProfessorName = view.dataset.name;
    boot();
    return;
  }
  const energy = e.target.closest('[data-energyprof]');
  if(energy){
    const enabled = energy.dataset.on!=='1';
    const res = await fetch(`/api/admin/professors/${energy.dataset.energyprof}/energy`, { method:'PUT', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({enabled}) });
    if(!res.ok){ alert('Não consegui mudar o gráfico de kcal.'); return; }
    showToast(enabled ? 'Gráfico de kcal ligado para todos os alunos desse professor' : 'Gráfico de kcal desligado para esse professor');
    renderAdminDashboard();
    return;
  }
  const copy = e.target.closest('[data-copyprof]');
  if(copy){
    navigator.clipboard?.writeText(copy.dataset.copyprof).then(()=> showToast('Código copiado!')).catch(()=>{});
    return;
  }
  const del = e.target.closest('[data-delprof]');
  if(del){
    const n = +del.dataset.count;
    const id = del.dataset.delprof;
    let url = `/api/admin/professors/${id}`;
    if(n>0){
      const others = (await loadProfessors()).filter(p=> p.id!==id);
      if(!others.length){ alert('Esse professor tem alunos e não há outro professor pra receber. Cadastre outro antes.'); return; }
      const to = await pickProfessorModal(`"${del.dataset.name}" tem ${n} aluno(s). Pra quem transferir?`, others);
      if(!to) return;
      url += `?transferTo=${encodeURIComponent(to)}`;
    }else if(!(await confirmDialog(`Remover o professor "${del.dataset.name}"?`))) return;
    const res = await fetch(url, { method:'DELETE', headers: apiHeaders() });
    if(!res.ok) alert('Não consegui remover o professor.');
    renderAdminDashboard();
  }
});
document.getElementById('backupBtn').addEventListener('click', async ()=>{
  try{
    const res = await fetch('/api/admin/export', { headers: apiHeaders() });
    if(!res.ok) throw new Error('bad status');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sobrecarga-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
    showToast('Backup baixado!');
  }catch(e){ alert('Não consegui gerar o backup agora.'); }
});

/* ---------- Painel de vídeos de execução (admin e professor) ---------- */
// mode 'admin': biblioteca geral. mode 'professor': vídeos do professor, que
// valem por cima da biblioteca para os alunos dele (a biblioteca aparece junto).
function videoApi(mode){
  if(mode==='admin') return { url:'/api/admin/videos', headers: extra=> Object.assign({'x-admin-code': auth.code}, extra) };
  return { url:'/api/professor/videos', headers: extra=> apiHeaders(extra) };
}
function fillExerciseDatalist(){
  const dl = document.getElementById('exerciseNameList');
  if(dl && !dl.children.length) dl.innerHTML = EXERCISE_DB.map(e=> `<option value="${escapeAttr(e.name)}">`).join('');
}
async function renderVideoManager(container, mode){
  fillExerciseDatalist();
  const api = videoApi(mode);
  container.innerHTML = `<div class="empty">Carregando…</div>`;
  let own = [], library = [];
  try{
    const res = await fetch(api.url, { headers: api.headers() });
    if(!res.ok) throw new Error('bad status');
    const data = await res.json();
    if(mode==='admin') own = data; else { own = data.own || []; library = data.global || []; }
  }catch(e){
    container.innerHTML = `<div class="empty">Não consegui carregar os vídeos agora.</div>`;
    return;
  }
  const ownKeys = new Set(own.map(v=> v.key));
  const rows = own.map(v=> ({...v, source:'own'}))
    .concat(library.filter(v=> !ownKeys.has(v.key)).map(v=> ({...v, source:'library'})))
    .sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
  const ownLabel = mode==='admin' ? 'Biblioteca' : 'Seu vídeo';
  container.innerHTML = `
    <form class="video-form" novalidate>
      <label class="vf-field"><span>Exercício</span><input type="text" name="name" list="exerciseNameList" placeholder="Ex.: Supino reto (barra)" maxlength="80" autocomplete="off" required></label>
      <label class="vf-field"><span>Link do YouTube</span><input type="url" name="url" placeholder="https://youtu.be/…" autocomplete="off" required></label>
      <button type="submit" class="primary">Salvar vídeo</button>
    </form>
    <p class="hint vf-hint">Pode ser vídeo "não listado". O vídeo aparece para o aluno em qualquer exercício com esse nome (acentos e maiúsculas não importam; "Supino reto (barra)" também vale para "Supino reto").${mode==='admin' ? '' : ' Um vídeo seu com o mesmo nome substitui o da biblioteca para os seus alunos.'}</p>
    <div class="vf-msg" role="status"></div>
    ${rows.length ? `<div class="video-grid">${rows.map(v=> `
      <div class="video-card">
        <button type="button" class="video-thumb" data-video="${escapeAttr(v.youtubeId)}" data-video-title="${escapeAttr(v.name)}" aria-label="Assistir ${escapeAttr(v.name)}">
          <img src="https://i.ytimg.com/vi/${escapeAttr(v.youtubeId)}/mqdefault.jpg" alt="" loading="lazy">
          <span class="video-play"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></span>
        </button>
        <div class="video-card-body">
          <div class="video-card-name" title="${escapeAttr(v.name)}">${escapeHtml(v.name)}</div>
        </div>
        <div class="video-card-actions">
          <span class="badge ${v.source==='own'?'badge-ok':''}">${v.source==='own' ? ownLabel : 'Biblioteca'}</span>
          <button type="button" class="ghost small" data-vedit="${escapeAttr(v.name)}" data-vurl="${v.source==='own' ? 'https://youtu.be/'+escapeAttr(v.youtubeId) : ''}">${v.source==='own' ? 'Trocar' : 'Usar outro vídeo'}</button>
          ${v.source==='own' ? `<button type="button" class="ghost small" data-vdel="${escapeAttr(v.key)}" data-vname="${escapeAttr(v.name)}">Remover</button>` : ''}
        </div>
      </div>`).join('')}</div>`
    : `<div class="empty"><strong>Nenhum vídeo ainda</strong>Cole o link do YouTube de um exercício acima.</div>`}`;

  const form = container.querySelector('.video-form');
  const msg = container.querySelector('.vf-msg');
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const name = form.name.value.trim(), url = form.url.value.trim();
    if(!name || !url){ msg.textContent = 'Preencha o exercício e o link.'; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try{
      const res = await fetch(api.url, { method:'PUT', headers: api.headers({'Content-Type':'application/json'}), body: JSON.stringify({name, url}) });
      if(res.status===400){
        const err = await res.json().catch(()=>({}));
        msg.textContent = err.error==='invalid_url' ? 'Esse link não parece ser de um vídeo do YouTube.' : 'Confira o nome do exercício.';
        btn.disabled = false;
        return;
      }
      if(!res.ok) throw new Error('bad status');
      showToast('Vídeo salvo!');
      renderVideoManager(container, mode);
    }catch(err){ msg.textContent = 'Não consegui salvar agora. Tente de novo.'; btn.disabled = false; }
  });
  container.onclick = async e=>{
    const edit = e.target.closest('[data-vedit]');
    if(edit){
      form.name.value = edit.dataset.vedit;
      form.url.value = edit.dataset.vurl;
      form.url.focus();
      form.scrollIntoView({behavior:'smooth', block:'center'});
      return;
    }
    const del = e.target.closest('[data-vdel]');
    if(del){
      if(!(await confirmDialog(`Remover o vídeo de "${del.dataset.vname}"?`))) return;
      const res = await fetch(`${api.url}?key=${encodeURIComponent(del.dataset.vdel)}`, { method:'DELETE', headers: api.headers() });
      if(!res.ok){ alert('Não consegui remover o vídeo.'); return; }
      renderVideoManager(container, mode);
    }
  };
}
document.querySelectorAll('[data-adminview]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const view = btn.dataset.adminview;
    document.querySelectorAll('[data-adminview]').forEach(b=>{
      const on = b===btn;
      b.classList.toggle('active', on);
      if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    });
    document.getElementById('adminViewProfs').hidden = view!=='profs';
    document.getElementById('adminViewVideos').hidden = view!=='videos';
    if(view==='videos') renderVideoManager(document.getElementById('adminVideos'), 'admin');
    else renderAdminDashboard();
  });
});

/* ---------- Painel do professor: gerenciar alunos ---------- */
// Monta um link wa.me com o telefone (assume DDI 55/Brasil se vier só DDD+número).
// "treinou há 3 dias" / "nunca treinou" a partir da data (YYYY-MM-DD) da última sessão com carga.
function daysSince(iso){
  const d = new Date(iso+'T00:00:00');
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.round((t - d)/86400000);
}
function activityLabel(s){
  if(!s.lastTrainedAt) return s.name ? 'ainda não treinou' : '';
  const n = daysSince(s.lastTrainedAt);
  const quando = n<=0 ? 'treinou hoje' : (n===1 ? 'treinou ontem' : `treinou há ${n} dias`);
  return `${quando} · ${s.weekDone} nesta semana`;
}
function whatsappLink(phone, name){
  let digits = String(phone||'').replace(/\D/g,'');
  if(digits.length<=11) digits = '55'+digits;
  const msg = `Oi${name?' '+name:''}! Passando aqui sobre o Sobrecarga.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}
const studentsList = document.getElementById('studentsList');
async function loadStudents(){
  try{
    const res = await fetch('/api/students', { headers: apiHeaders() });
    if(res.status===403){ logout(); return []; }
    if(!res.ok) throw new Error('bad status');
    return await res.json();
  }catch(e){ return []; }
}
async function renderProfessorDashboard(){
  studentsList.innerHTML = `<div class="empty">Carregando…</div>`;
  renderVideoManager(document.getElementById('profVideos'), 'professor');
  const students = await loadStudents();
  if(students.length===0){
    studentsList.innerHTML = `<div class="empty"><strong>Nenhum aluno ainda</strong>Adicione o primeiro aluno para gerar o código dele.</div>`;
    return;
  }
  studentsList.innerHTML = students.map(s=> `
    <div class="student-row${s.name?'':' student-row-unclaimed'}">
      <div>
        <div class="sname">${s.name ? escapeHtml(s.name) : '— aguardando aluno —'}${s.locked ? ' <span title="Aparelho travado" style="opacity:.7;">🔒</span>' : ''}</div>
        <div class="scode">${escapeHtml(s.code)}</div>
        ${s.unlockRequested ? '<div class="sactivity" style="color:var(--accent-text);font-weight:700;">🔔 pediu liberação do aparelho</div>' : ''}
        ${activityLabel(s) ? `<div class="sactivity${s.lastTrainedAt && daysSince(s.lastTrainedAt)>7 ? ' stale' : ''}">${activityLabel(s)}</div>` : ''}
      </div>
      <div class="student-actions">
        ${s.name ? `<button class="small" data-viewstudent="${s.id}">Ver treino</button>` : ''}
        ${auth.role==='admin' ? `<button class="ghost small energy-toggle${s.energy?' on':''}" data-energystudent="${s.id}" data-on="${s.energyOwn?1:0}" ${s.energy && !s.energyOwn ? 'disabled title="Ligado para todos os alunos deste professor"' : `title="${s.energy?'Gráfico de kcal ligado — clique para desligar':'Ligar gráfico de kcal para este aluno'}"`}>🔥</button>` : ''}
        ${s.phone ? `<a class="ghost small" href="${whatsappLink(s.phone, s.name)}" target="_blank" rel="noopener" title="Chamar no WhatsApp">💬</a>` : ''}
        ${s.locked ? `<button class="ghost small" data-unlockstudent="${s.id}" title="Liberar aparelho">🔓</button>` : ''}
        <button class="ghost small" data-editphone="${s.id}" data-phone="${escapeAttr(s.phone)}" title="Telefone (WhatsApp)">📱</button>
        <button class="ghost small" data-renamestudent="${s.id}" data-name="${escapeAttr(s.name)}" title="Renomear">✎</button>
        <button class="ghost small" data-delstudent="${s.id}" data-name="${escapeAttr(s.name)}" title="Remover aluno">✕</button>
      </div>
    </div>`).join('');
}
function showCodesModal(title, codes){
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box" style="max-width:360px;">
      <p style="margin-bottom:10px;"><strong>${escapeHtml(title)}</strong></p>
      <div style="background:var(--surface-2);border:1px solid var(--border);padding:10px;max-height:260px;overflow:auto;font-family:'Archivo',sans-serif;">
        ${codes.map(c=> `<div style="padding:5px 2px;letter-spacing:.08em;font-weight:700;color:var(--accent-text);">${escapeHtml(c)}</div>`).join('')}
      </div>
      <div class="confirm-actions">
        <button class="ghost small" data-act="copy">Copiar tudo</button>
        <button class="primary small" data-act="ok">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{
    const act = e.target.dataset && e.target.dataset.act;
    if(act==='copy'){
      navigator.clipboard?.writeText(codes.join('\n')).then(()=> showToast('Códigos copiados!')).catch(()=>{});
    }
    if(act==='ok' || e.target===overlay) overlay.remove();
  });
}
document.getElementById('bulkCodesBtn').addEventListener('click', async ()=>{
  const res = await fetch('/api/students/bulk', { method:'POST', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({count:10}) });
  if(!res.ok){ alert('Não consegui gerar os códigos.'); return; }
  const created = await res.json();
  await renderProfessorDashboard();
  showCodesModal('10 códigos gerados — distribua um pra cada aluno. Cada um coloca o próprio nome ao entrar pela primeira vez.', created.map(c=> c.code));
});
document.getElementById('addStudentBtn').addEventListener('click', async ()=>{
  const name = prompt('Nome do novo aluno:');
  if(!name || !name.trim()) return;
  const res = await fetch('/api/students', { method:'POST', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({name: name.trim()}) });
  if(!res.ok){ alert('Não consegui criar o aluno.'); return; }
  const student = await res.json();
  await renderProfessorDashboard();
  alert(`Aluno "${student.name}" criado!\n\nCódigo de acesso: ${student.code}\n\nPasse esse código para ele entrar no site.`);
});
studentsList.addEventListener('click', async e=>{
  const view = e.target.closest('[data-viewstudent]');
  if(view){ currentStudentId = view.dataset.viewstudent; boot(); return; }
  const rename = e.target.closest('[data-renamestudent]');
  if(rename){
    const novo = prompt('Novo nome do aluno:', rename.dataset.name);
    if(!novo || !novo.trim()) return;
    await fetch(`/api/students/${rename.dataset.renamestudent}`, { method:'PUT', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({name: novo.trim()}) });
    renderProfessorDashboard();
    return;
  }
  const del = e.target.closest('[data-delstudent]');
  if(del){
    if(!(await confirmDialog(`Remover "${del.dataset.name}" e apagar todos os treinos dele? Isso não pode ser desfeito.`))) return;
    await fetch(`/api/students/${del.dataset.delstudent}`, { method:'DELETE', headers: apiHeaders() });
    renderProfessorDashboard();
    return;
  }
  const energy = e.target.closest('[data-energystudent]');
  if(energy){
    if(auth.role!=='admin') return;
    const enabled = energy.dataset.on!=='1';
    // As rotas de liberação são do admin: usa o código de admin mesmo navegando no painel de um professor.
    const res = await fetch(`/api/admin/students/${energy.dataset.energystudent}/energy`, { method:'PUT', headers: {'Content-Type':'application/json','x-admin-code': auth.code}, body: JSON.stringify({enabled}) });
    if(!res.ok){ alert('Não consegui mudar o gráfico de kcal.'); return; }
    renderProfessorDashboard();
    return;
  }
  const unlock = e.target.closest('[data-unlockstudent]');
  if(unlock){
    await fetch(`/api/students/${unlock.dataset.unlockstudent}/unlock`, { method:'PUT', headers: apiHeaders() });
    renderProfessorDashboard();
    return;
  }
  const editphone = e.target.closest('[data-editphone]');
  if(editphone){
    const novo = prompt('Telefone (com DDD) para WhatsApp:', editphone.dataset.phone||'');
    if(novo===null) return;
    await fetch(`/api/students/${editphone.dataset.editphone}/phone`, { method:'PUT', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({phone: novo}) });
    renderProfessorDashboard();
  }
});

/* ---------- Estado do treino (por aluno) ---------- */
let STORE_KEY = 'sobrecarga_v1';
let state = { sessions: [], protocols: [] };
let stageRows = [];
let syncTimer = null;
// true entre uma edição local (save()) e ela realmente ir pro servidor —
// enquanto isso, loadRemote() não pode sobrescrever state com dados velhos
// do servidor, senão a edição em andamento some (foi o que duplicava
// protocolo/sessão quando dois cliques aconteciam antes do primeiro salvar).
let hasPendingSave = false;
// Marca de "tem edição que ainda não chegou no servidor" GUARDADA no aparelho.
// A variável acima morre quando a página recarrega; foi assim que cargas
// registradas sem conexão sumiam: ao reabrir, o app achava que não havia nada
// pendente e trocava a cópia local pela do servidor (sem as cargas).
let saveSeq = 0;
const dirtyKey = () => STORE_KEY + '_dirty';
const prevKey = () => STORE_KEY + '_prev';
function markDirty(){ try{ localStorage.setItem(dirtyKey(), String(Date.now())); }catch(e){} }
function clearDirty(){ try{ localStorage.removeItem(dirtyKey()); }catch(e){} }
function isDirtyStored(){ try{ return !!localStorage.getItem(dirtyKey()); }catch(e){ return false; } }
function needsSync(){ return hasPendingSave || isDirtyStored(); }

function countWeightedSets(st){
  return ((st && st.sessions) || []).reduce((n, s)=>
    n + ((s && s.exercises) || []).reduce((m, e)=> m + ((e && e.sets) || []).filter(t=> t && t.weight > 0).length, 0), 0);
}

// Funde a ficha do servidor com a do aparelho, sem perder carga registrada.
// preferLocal=true (há edição não enviada): sessão com o mesmo id fica como está
// no aparelho, que é a mais nova. false: o servidor manda, mas cargas que o
// aparelho tem e o servidor tem zeradas são preservadas. Nunca altera os argumentos.
function mergeStates(server, local, preferLocal){
  const clone = v => JSON.parse(JSON.stringify(v));
  const out = { sessions: clone(server.sessions || []), protocols: clone(server.protocols || []) };
  const byId = new Map(out.sessions.map(s=> [s.id, s]));
  (local.sessions || []).forEach(ls=>{
    const ss = byId.get(ls.id);
    if(!ss){ const c = clone(ls); out.sessions.push(c); byId.set(c.id, c); return; }
    if(preferLocal){
      const idx = out.sessions.indexOf(ss);
      out.sessions[idx] = clone(ls);
      byId.set(ls.id, out.sessions[idx]);
      return;
    }
    (ls.exercises || []).forEach(le=>{
      const se = (ss.exercises || []).find(e=> e.id === le.id);
      if(!se){ (ss.exercises = ss.exercises || []).push(clone(le)); return; }
      (le.sets || []).forEach((lt, i)=>{
        const st = (se.sets || [])[i];
        if(!st){ (se.sets = se.sets || []).push(clone(lt)); }
        else if(lt.weight > 0 && !(st.weight > 0)){ st.weight = lt.weight; st.reps = lt.reps; }
      });
    });
    if(ls.feedback && !ss.feedback) ss.feedback = ls.feedback;
  });
  const known = new Set(out.protocols.map(p=> p.id));
  (local.protocols || []).forEach(p=>{ if(!known.has(p.id)){ out.protocols.push(clone(p)); known.add(p.id); } });
  return out;
}
const syncBadge = () => document.getElementById('syncBadge');

function loadLocal(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(!Array.isArray(d.protocols)) d.protocols = [];
      return d;
    }
  }catch(e){}
  return { sessions: [], protocols: [] };
}
function saveLocal(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){}
}
function setSyncStatus(status){
  const el = syncBadge();
  if(!el) return;
  el.dataset.status = status;
  el.textContent = status==='synced' ? 'Sincronizado' : status==='syncing' ? 'Sincronizando…' : status==='offline' ? 'Só neste aparelho' : 'Erro ao sincronizar';
}
async function loadRemote(){
  const sid = activeStudentId();
  if(!sid) return;
  try{
    setSyncStatus('syncing');
    const res = await fetch(`/api/state/${sid}`, { headers: apiHeaders() });
    if(!res.ok) throw new Error('bad status');
    const data = await res.json();
    if(!(data && Array.isArray(data.sessions))){ setSyncStatus('synced'); return; }
    if(!Array.isArray(data.protocols)) data.protocols = [];

    // Professor só olha: o servidor manda, e nada local é enviado.
    if(!READONLY){
      // Há edição que ainda não chegou no servidor (marca guardada no aparelho,
      // não só em memória), ou o aparelho tem cargas que o servidor não tem?
      // Nunca trocar a cópia do aparelho pela do servidor nesses casos: funde,
      // guarda antes uma cópia de segurança e envia o resultado.
      const unsynced = needsSync();
      if(unsynced || countWeightedSets(state) > countWeightedSets(data)){
        try{ localStorage.setItem(prevKey(), JSON.stringify({ at: Date.now(), state })); }catch(e){}
        state = mergeStates(data, state, unsynced);
        ensureProtocols();
        saveLocal();
        renderAll();
        save();
        return;
      }
    }
    state = data;
    ensureProtocols();
    saveLocal();
    renderAll();
    setSyncStatus('synced');
  }catch(e){
    setSyncStatus('offline');
  }
}
function save(){
  saveLocal();
  hasPendingSave = true;
  saveSeq++;
  markDirty();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncRemote, 500);
}
async function syncRemote(){
  const sid = activeStudentId();
  if(!sid) return;
  const seqAtSend = saveSeq;
  try{
    setSyncStatus('syncing');
    const res = await fetch(`/api/state/${sid}`, {
      method: 'PUT',
      headers: apiHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify(state)
    });
    if(!res.ok) throw new Error('bad status');
    // Só considera enviado se não houve edição nova durante o envio.
    if(seqAtSend === saveSeq){ hasPendingSave = false; clearDirty(); }
    setSyncStatus('synced');
  }catch(e){
    setSyncStatus('offline');
  }
}
// Sem internet no meio do treino? A edição fica no aparelho (localStorage) e
// sobe sozinha quando a conexão voltar, em vez de esperar a próxima edição.
window.addEventListener('online', ()=>{ if(needsSync()) syncRemote(); });
setInterval(()=>{ if(needsSync() && navigator.onLine!==false && !document.hidden) syncRemote(); }, 30000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && needsSync() && navigator.onLine!==false) syncRemote(); });

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('/sw.js').catch(()=>{}); });
}

function confirmDialog(message, opts={}){
  const okLabel = opts.okLabel || 'Excluir';
  const danger = opts.danger !== false;
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="ghost small" data-act="cancel">Cancelar</button>
          <button class="primary small" data-act="ok" ${danger?'style="background:var(--down);color:#fff;"':''}>${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function done(result){ overlay.remove(); resolve(result); }
    overlay.addEventListener('click', e=>{
      if(e.target===overlay) done(false);
      const act = e.target.dataset && e.target.dataset.act;
      if(act==='cancel') done(false);
      if(act==='ok') done(true);
    });
  });
}

// Primeiro acesso de um código gerado em lote (sem nome ainda) — pede o nome
// do aluno antes de entrar no app. Só aparece uma vez, quando o nome está vazio.
function promptStudentName(){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p style="margin-bottom:4px;"><strong>Bem-vindo! 👋</strong></p>
        <p style="margin-bottom:12px;color:var(--text-dim);font-size:13px;">Como podemos te chamar?</p>
        <input type="text" id="studentNameInput" class="minput" maxlength="60" placeholder="Seu nome" autocomplete="off" style="margin-bottom:4px;">
        <div class="confirm-actions">
          <button class="primary small" data-act="ok" style="width:100%;justify-content:center;">Continuar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#studentNameInput');
    setTimeout(()=> input.focus(), 50);
    function submit(){
      const v = input.value.trim();
      if(!v) return;
      overlay.remove();
      resolve(v);
    }
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
    overlay.addEventListener('click', e=>{
      const act = e.target.dataset && e.target.dataset.act;
      if(act==='ok') submit();
    });
  });
}

function uid(){ return Math.random().toString(36).slice(2,10); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
}
function epley1RM(weight,reps){
  if(!weight||!reps) return 0;
  return weight*(1+reps/30);
}

/* ---------- PDF import ---------- */
const fileInput = document.getElementById('fileInput');
const drop = document.getElementById('drop');
const dropLabel = document.getElementById('dropLabel');

drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', ()=> drop.classList.remove('drag'));
drop.addEventListener('drop', e=>{
  e.preventDefault(); drop.classList.remove('drag');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) handleFile(f);
});
fileInput.addEventListener('change', e=>{
  const f = e.target.files[0];
  if(f) handleFile(f);
});

// O PDF é lido só no aparelho (nada é enviado ao servidor), mas mesmo assim
// limita tamanho e páginas pra um arquivo enorme ou malformado não travar a aba.
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 60;
async function handleFile(file){
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if(!isPdf){ alert('Envie um arquivo PDF.'); return; }
  if(file.size > MAX_PDF_BYTES){ alert('Esse PDF é grande demais (máximo 15 MB).'); return; }
  const safeName = escapeHtml(file.name);
  dropLabel.innerHTML = `<strong>Lendo…</strong> ${safeName}`;
  try{
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
    if(!new TextDecoder('latin1').decode(head).includes('%PDF-')){ alert('Esse arquivo não parece ser um PDF de verdade.'); dropLabel.innerHTML = '<strong>Clique para escolher</strong> ou arraste um PDF de treino aqui'; return; }
    if(!window.pdfjsLib){ alert('Não consegui carregar o leitor de PDF. Confira a internet e tente de novo.'); dropLabel.innerHTML = '<strong>Clique para escolher</strong> ou arraste um PDF de treino aqui'; return; }
    const pdf = await pdfjsLib.getDocument({data:buf}).promise;
    if(pdf.numPages > MAX_PDF_PAGES){ alert(`Esse PDF tem páginas demais (máximo ${MAX_PDF_PAGES}).`); dropLabel.innerHTML = '<strong>Clique para escolher</strong> ou arraste um PDF de treino aqui'; return; }

    const gridGroups = await extractGridWorkouts(pdf);

    let groups;
    if(gridGroups.length){
      groups = gridGroups;
    }else{
      // fallback: PDF não tem o formato de grade (Séries/Aquec/Prep/1ª..5ª) — usa
      // leitura linha a linha genérica, separando por dia de treino quando dá
      // pra reconhecer títulos tipo "TREINO A"/"DIA 1"/"Segunda-feira".
      let lines = [];
      for(let p=1;p<=pdf.numPages;p++){
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        lines = lines.concat(groupIntoLines(content.items, 8));
      }
      if(lines.length===0){
        dropLabel.innerHTML = '<strong>Não consegui ler texto desse PDF.</strong> Pode ser um PDF escaneado (imagem) — tente outro arquivo ou monte o treino na mão.';
        return;
      }
      const baseTitle = file.name.replace(/\.pdf$/i,'');
      const dayGroups = splitIntoDayGroups(lines, baseTitle);
      groups = dayGroups
        .map(g=> ({ title: g.title, rows: parseLines(g.lines) }))
        .filter(g=> g.rows.length>0);
      if(groups.length===0) groups = [{ title: baseTitle, rows: [] }];
    }

    dropLabel.innerHTML = `<strong>${safeName}</strong> — clique para trocar o arquivo`;
    openStage(groups, file.name);
    mobile.tab = 'treinos'; mobile.screen = 'import'; mRenderImportScreen();
  }catch(err){
    console.error(err);
    dropLabel.innerHTML = '<strong>Não consegui ler esse PDF.</strong> Clique para tentar outro';
  }
}

/* Reconstrói tabelas no formato "grade de treino" (colunas Aquec/Prep/1ª..5ª por
   série), agrupando por posição x/y dos textos — esse tipo de PDF não tem "kg",
   só faixas de repetição prescritas (ex.: "6 a 10", "max"), sem carga. */
async function extractGridWorkouts(pdf){
  const groups = [];
  const COLS = ['aquec','prep','1','2','3','4','5'];

  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map(it=> ({ x: it.transform[4], y: it.transform[5], str: it.str }))
      .filter(it=> it.str && it.str.trim());
    if(!items.length) continue;

    const rows = clusterByY(items, 18, true);

    let headerIdx=-1, anchors=null;
    for(let i=0;i<rows.length;i++){
      // pdf.js às vezes extrai "AQUEC" como "A Q U E C" (letras espaçadas) — remove espaços antes de comparar
      const upper = rows[i].map(w=> w.str.toUpperCase().replace(/\s+/g,''));
      if(upper.some(t=>t.includes('AQUEC')) && upper.some(t=>t.includes('PREP'))){
        anchors = {};
        rows[i].forEach((w,wi)=>{
          const t = upper[wi];
          if(t.includes('AQUEC')) anchors.aquec = w.x;
          else if(t.includes('PREP')) anchors.prep = w.x;
          else{ const m = t.match(/^([1-5])/); if(m) anchors[m[1]] = w.x; }
        });
        headerIdx = i;
        break;
      }
    }
    if(!anchors) continue;

    const titleParts = [];
    for(let i=0;i<headerIdx;i++){
      const line = rows[i].slice().sort((a,b)=> a.x-b.x).map(w=> w.str).join(' ').replace(/\s+/g,' ').trim();
      if(line) titleParts.push(line);
    }
    const title = titleParts.join(' — ').trim() || `Treino ${groups.length+1}`;
    const group = { title, rows: [] };
    groups.push(group);

    function nearestCol(x){
      let best=null, bestd=Infinity;
      COLS.forEach(c=>{
        if(!(c in anchors)) return;
        const d = Math.abs(x-anchors[c]);
        if(d<bestd){ best=c; bestd=d; }
      });
      return bestd<32 ? best : null;
    }

    for(let i=headerIdx+1;i<rows.length;i++){
      const nameToks=[], colToks={aquec:[],prep:[],'1':[],'2':[],'3':[],'4':[],'5':[]};
      let setsCount=null;
      rows[i].forEach(w=>{
        const t = w.str.trim();
        if(!t) return;
        if(w.x < 160){ nameToks.push(w); }
        else if(w.x>=175 && w.x<=215 && /^\d+$/.test(t)){ setsCount = t; }
        else{
          const c = nearestCol(w.x);
          if(c) colToks[c].push(w);
        }
      });
      const name = nameToks.slice().sort((a,b)=> (b.y-a.y) || (a.x-b.x)).map(w=> w.str).join(' ').replace(/\s+/g,' ').trim();
      if(!name) continue;

      const populated = COLS.filter(c=> colToks[c].length);
      if(populated.length===0){
        group.rows.push({ name, sets: parseInt(setsCount,10)||1, reps: 10, weight: 0, target: '' });
        continue;
      }
      populated.forEach(c=>{
        const text = colToks[c].slice().sort((a,b)=> (b.y-a.y) || (a.x-b.x)).map(w=> w.str).join(' ').replace(/\s+/g,' ').trim();
        // Guarda a faixa prescrita como veio da ficha ("6 a 10", "max", "12/10/8")
        // além do número usado como valor inicial da série.
        group.rows.push({ name, sets: 1, reps: parseRepsTarget(text), weight: 0, target: cleanTarget(text) });
      });
    }
  }
  return groups.filter(g=> g.rows.length>0);
}

// Agrupa itens de texto em "linhas" por proximidade de Y (não Y exato — uma
// linha de tabela real varia alguns pontos entre células/baseline).
function clusterByY(items, gap, topFirst){
  const sorted = [...items].sort((a,b)=> topFirst ? b.y-a.y : a.y-b.y);
  const rows = [];
  let cur=[], lastY=null;
  sorted.forEach(it=>{
    if(lastY!==null && Math.abs(lastY-it.y) > gap){ rows.push(cur); cur=[]; }
    cur.push(it);
    lastY = it.y;
  });
  if(cur.length) rows.push(cur);
  return rows;
}

function parseRepsTarget(text){
  const nums = (String(text).match(/\d+/g)||[]).map(n=> parseInt(n,10));
  if(!nums.length) return 10; // ex.: "max"
  return nums[nums.length-1];
}

// Faixa de repetições prescrita ("alvo"), como está no protocolo.
function cleanTarget(text){
  return String(text||'').replace(/\s+/g,' ').trim().slice(0,24);
}
// Resumo do alvo de um exercício: junta os alvos distintos das séries na ordem
// (ex.: aquecimento "15", preparatória "10" e as válidas "6 a 10").
function exerciseTarget(ex){
  const seen = [];
  ex.sets.forEach(s=>{
    const t = (s.target||'').trim();
    if(t && !seen.includes(t)) seen.push(t);
  });
  return seen.join(' · ');
}

function groupIntoLines(items, gap){
  const rows = clusterByY(
    items.map(it=> ({x: it.transform[4], y: it.transform[5], str: it.str})),
    gap!==undefined ? gap : 3, true
  );
  return rows.map(r=> r.slice().sort((a,b)=> a.x-b.x).map(w=> w.str).join(' ').replace(/\s+/g,' ').trim())
             .filter(Boolean);
}

// Detecta linhas de título de treino ("TREINO A", "DIA 1", "Segunda-feira",
// ou uma linha curta em CAIXA ALTA sem números) pra separar um PDF com vários
// dias de treino em várias sessões, mesmo fora do formato de grade.
function isWorkoutHeadingLine(line){
  const l = line.trim();
  if(!l || l.length>48) return false;
  if(/^treino\b/i.test(l)) return true;
  if(/^dia\s*\d+/i.test(l)) return true;
  if(/^(day)\s*\d+/i.test(l)) return true;
  if(/^(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)([\s-]?feira)?\b/i.test(l)) return true;
  if(l.length<=40 && !/\d/.test(l) && l===l.toUpperCase() && /[A-ZÀ-Ú]{3,}/.test(l)) return true;
  return false;
}
function splitIntoDayGroups(lines, fallbackTitle){
  const groups = [];
  let current = null;
  lines.forEach(line=>{
    if(isWorkoutHeadingLine(line)){
      current = { title: line.trim(), lines: [] };
      groups.push(current);
    }else{
      if(!current){ current = { title: fallbackTitle, lines: [] }; groups.push(current); }
      current.lines.push(line);
    }
  });
  // Só um "dia" encontrado (ou nenhum título reconhecido) → não vale a pena
  // dividir, fica tudo numa sessão só com o nome do arquivo.
  const withContent = groups.filter(g=> g.lines.length>0);
  if(withContent.length<=1) return [{ title: fallbackTitle, lines }];
  return withContent;
}

// Leitor genérico de fichas fora do formato "grade" — tenta reconhecer vários
// jeitos de escrever séries/reps/carga que aparecem em fichas de academia:
// "4x10 60kg", "3 séries de 12 repetições", "4  8 a 12" (faixa sem 'x'),
// "peso: 25kg", "@20kg", "até a falha"/"MAX", nome numa linha e dados na
// próxima, etc. Cada caso foi conferido com exemplos sintéticos antes de
// entrar aqui (não temos como testar contra todo PDF real que existe).
function parseLines(lines){
  const rows = [];
  let pendingName = null;
  const weightAtRe = /@\s*(\d{1,3}(?:[.,]\d)?)\s*kg\b/i;
  const weightWordRe = /(?:peso|carga)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d)?)\s*(?:kg)?/i;
  const weightRe = /(\d{1,3}(?:[.,]\d)?)\s*(?:kg|kgs|kilos)\b/i;
  const setsxRepsRangeRe = /(\d{1,2})\s*[xX×]\s*(\d{1,3})\s*(?:a|à|-|–|até|ate)\s*(\d{1,3})\b/i;
  const setsPhraseRe = /(\d{1,2})\s*s[ée]ries?\s*(?:de|x|×)?\s*(\d{1,3})\s*rep[a-zà-ú]*/i;
  const setsxRepsRe = /(\d{1,2})\s*[xX×]\s*(\d{1,3})\b(?:\s*rep[a-zà-ú]*)?/;
  const setsSpaceRangeRe = /(\d{1,2})\s+(\d{1,3})\s*(?:a|à|-|–|até|ate)\s*(\d{1,3})\s*$/i;
  const repsRangeRe = /(\d{1,3})\s*(?:a|à|-|–|até|ate)\s*(\d{1,3})(?:\s*rep[a-zà-ú]*)?/i;
  const repsWordRe = /(\d{1,3})\s*rep[a-zà-ú]*/i;
  const setsOnlyRe = /(\d{1,2})\s*s[ée]ries?\b/i;
  const maxRe = /\bm[aá]x(?:imo)?\b|at[ée]\s*(?:a\s*)?falha/i;
  const bareNumRe = /^\d{1,3}([.,]\d)?$/;
  const headerWordsRe = /^(exerc[ií]cio|s[ée]ries?|reps?|repeti[cç][oõ]es?|carga|peso|kg)$/i;

  lines.forEach(line=>{
    if(!line || line.length<2 || headerWordsRe.test(line.trim())) return;

    let rest = line;
    let sets=null, reps=null, weight=null, target=null;

    // peso/carga — tenta a forma com rótulo ("peso: 25kg") primeiro, depois
    // "@20kg", depois um "20kg" solto em qualquer lugar da linha.
    let weightM = rest.match(weightWordRe);
    if(weightM){ weight = parseFloat(weightM[1].replace(',','.')); rest = rest.replace(weightWordRe,''); }
    else{
      weightM = rest.match(weightAtRe);
      if(weightM){ weight = parseFloat(weightM[1].replace(',','.')); rest = rest.replace(weightAtRe,''); }
      else{
        weightM = rest.match(weightRe);
        if(weightM){ weight = parseFloat(weightM[1].replace(',','.')); rest = rest.replace(weightRe,''); }
      }
    }

    let m = rest.match(setsxRepsRangeRe);
    if(m){
      sets = parseInt(m[1],10); reps = parseInt(m[3],10);
      target = `${m[2]} a ${m[3]}`;
      rest = rest.replace(setsxRepsRangeRe,'');
    }else if((m = rest.match(setsPhraseRe))){
      sets = parseInt(m[1],10); reps = parseInt(m[2],10);
      rest = rest.replace(setsPhraseRe,'');
    }else if((m = rest.match(setsxRepsRe))){
      sets = parseInt(m[1],10); reps = parseInt(m[2],10);
      rest = rest.replace(setsxRepsRe,'');
    }else if((m = rest.match(setsSpaceRangeRe))){
      sets = parseInt(m[1],10); reps = parseInt(m[3],10);
      target = `${m[2]} a ${m[3]}`;
      rest = rest.replace(setsSpaceRangeRe,'');
    }else{
      m = rest.match(repsRangeRe);
      if(m){
        reps = parseInt(m[2],10);
        target = `${m[1]} a ${m[2]}`;
        rest = rest.replace(repsRangeRe,'');
      }else{
        m = rest.match(repsWordRe);
        if(m){ reps = parseInt(m[1],10); rest = rest.replace(repsWordRe,''); }
      }
    }

    // "4 séries" sem repetições na mesma expressão (ex.: "4 séries até a falha")
    if(sets===null){
      const so = rest.match(setsOnlyRe);
      if(so){ sets = parseInt(so[1],10); rest = rest.replace(setsOnlyRe,''); }
    }

    // table-style rows: "Exercício  4  10" (sets e reps em colunas separadas, sem 'x')
    if(sets===null && reps===null){
      const twoTrailing = rest.match(/(\d{1,2})\s+(\d{1,3})\s*$/);
      if(twoTrailing && /[a-zA-Zà-úÀ-Ú]/.test(rest.slice(0, twoTrailing.index))){
        sets = parseInt(twoTrailing[1],10); reps = parseInt(twoTrailing[2],10);
        rest = rest.slice(0, twoTrailing.index);
      }else{
        const oneTrailing = rest.match(/(\d{1,3})\s*$/);
        if(oneTrailing && /[a-zA-Zà-úÀ-Ú]/.test(rest.slice(0, oneTrailing.index))){
          reps = parseInt(oneTrailing[1],10);
          rest = rest.slice(0, oneTrailing.index);
        }
      }
    }

    let usedMax = false;
    if(reps===null && weight===null && maxRe.test(rest)){
      target = 'Máx'; usedMax = true; rest = rest.replace(maxRe,'');
    }

    let name = rest
      .replace(/^\s*\d{1,2}\s*(?:[).:]|[-–—])\s+/,'')      // numeração do item: "1) ", "2. ", "3 - "
      .replace(/[-–—:|@]+/g,' ')
      .replace(/\(\s*\)/g,' ')                              // parênteses que ficaram vazios: "(carga 14kg)" → "()"
      .replace(/\s+(?:reps?|repeti[cç][oõ]es|s[ée]ries?)\s*$/i,'') // "rep" / "séries" soltos no fim
      .replace(/\s{2,}/g,' ')
      .trim();

    const hasData = sets!==null || reps!==null || weight!==null || usedMax;

    if(!hasData){
      if(bareNumRe.test(line.trim())) return;
      pendingName = line.trim();
      return;
    }
    if(!name && pendingName) name = pendingName;
    if(!name) name = 'Exercício';
    pendingName = null;
    rows.push({ name, sets: sets||1, reps: reps||10, weight: weight||0, target: target||'' });
  });

  if(rows.length===0){
    lines.forEach(l=>{ if(l.length>2 && l.length<60) rows.push({name:l, sets:1, reps:10, weight:0, target:''}); });
  }
  return rows.slice(0,60);
}

/* Junta linhas de mesmo exercício (mesmo nome) em UM exercício com várias séries —
   necessário porque a grade de treino gera uma linha por coluna (1ª,2ª,3ª...). */
function buildExercisesFromRows(rows){
  const byKey = new Map();
  const order = [];
  rows.forEach(r=>{
    if(!r.name || !r.name.trim()) return;
    const key = r.name.trim().toLowerCase();
    if(!byKey.has(key)){
      byKey.set(key, { id: uid(), name: r.name.trim(), sets: [] });
      order.push(key);
    }
    const ex = byKey.get(key);
    const n = Math.max(1, r.sets||1);
    for(let i=0;i<n;i++) ex.sets.push({ reps: r.reps||0, weight: r.weight||0, target: r.target||'' });
  });
  return order.map(k=> byKey.get(k));
}

function addDaysISO(iso, n){
  const d = new Date(iso+'T00:00:00');
  d.setDate(d.getDate()+n);
  return d.toISOString().slice(0,10);
}

/* ---------- Staging (múltiplas sessões por PDF) ---------- */
const stageWrap = document.getElementById('stageWrap');
const stageGroupsWrap = document.getElementById('stageGroupsWrap');
let stageGroups = [];

function openStage(groups, fileName){
  const today = todayISO();
  stageGroups = (groups.length? groups : [{title: fileName.replace(/\.pdf$/i,''), rows:[]}]).map((g,i)=> ({
    id: uid(),
    name: (g.title || `Treino ${i+1}`).slice(0,80),
    date: addDaysISO(today, i),
    rows: g.rows.length? g.rows : [{name:'', sets:1, reps:10, weight:0}]
  }));
  stageProtocol = { mode: 'new', id: null, name: suggestProtocolName(stageGroups[0].date), weeks: 4 };
  stageWrap.style.display = 'block';
  renderStageProtocol();
  renderStageGroups();
  stageWrap.scrollIntoView({behavior:'smooth', block:'nearest'});
}

/* Uma importação = uma ficha = um protocolo (ou anexada a um já existente). */
let stageProtocol = { mode:'new', id:null, name:'', weeks:4 };
const stageProtocolSelect = document.getElementById('stageProtocolSelect');
const stageProtocolName = document.getElementById('stageProtocolName');
const stageProtocolNameWrap = document.getElementById('stageProtocolNameWrap');
const stageProtocolWeeks = document.getElementById('stageProtocolWeeks');

function renderStageProtocol(){
  stageProtocolSelect.innerHTML =
    `<option value="__new">➕ Novo protocolo</option>` +
    state.protocols.map(p=> `<option value="${escapeAttr(p.id)}" ${stageProtocol.id===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  stageProtocolSelect.value = stageProtocol.mode==='new' ? '__new' : stageProtocol.id;
  stageProtocolName.value = stageProtocol.name;
  stageProtocolWeeks.value = stageProtocol.weeks;
  stageProtocolNameWrap.style.display = stageProtocol.mode==='new' ? '' : 'none';
}
stageProtocolSelect.addEventListener('change', e=>{
  if(e.target.value==='__new'){ stageProtocol.mode='new'; stageProtocol.id=null; }
  else{ stageProtocol.mode='existing'; stageProtocol.id=e.target.value; }
  renderStageProtocol();
});
stageProtocolName.addEventListener('input', e=>{ stageProtocol.name = e.target.value; });
stageProtocolWeeks.addEventListener('input', e=>{ stageProtocol.weeks = clampWeeks(e.target.value); });

function clampWeeks(v){
  const n = parseInt(v,10);
  if(!n || n<1) return 1;
  return Math.min(52, n);
}

// Resolve o protocolo escolhido na importação, criando-o se for novo.
function resolveStageProtocolId(){
  if(stageProtocol.mode==='existing' && state.protocols.some(p=> p.id===stageProtocol.id)){
    return stageProtocol.id;
  }
  const prot = {
    id: uid(),
    name: (stageProtocol.name||'').trim() || suggestProtocolName(todayISO()),
    createdAt: todayISO(),
    weeks: clampWeeks(stageProtocol.weeks)
  };
  state.protocols.push(prot);
  return prot.id;
}

function renderStageGroups(){
  stageGroupsWrap.innerHTML = '';
  stageGroups.forEach((group, gi)=>{
    const card = document.createElement('div');
    card.className = 'stage-group';
    card.innerHTML = `
      <div class="row-fields" style="grid-template-columns:1fr 160px 90px;">
        <div><label class="hint">Nome da sessão</label><input type="text" data-gfield="name" value="${escapeAttr(group.name)}"></div>
        <div><label class="hint">Data</label><input type="date" data-gfield="date" value="${group.date}"></div>
        <div style="display:flex;align-items:flex-end;gap:8px;">
          <span class="badge-count">${group.rows.length} linhas</span>
          ${stageGroups.length>1 ? `<button class="ghost small" data-delgroup="1" title="Remover este treino">✕</button>` : ''}
        </div>
      </div>
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>Exercício</th><th style="width:70px">Séries</th><th style="width:100px">Alvo (reps)</th><th style="width:80px">Reps</th><th style="width:90px">Carga (kg)</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <button class="ghost small" data-addrow="1" style="margin-top:8px;">+ linha</button>`;
    stageGroupsWrap.appendChild(card);

    card.querySelector('[data-gfield="name"]').addEventListener('input', e=>{ group.name = e.target.value; });
    card.querySelector('[data-gfield="date"]').addEventListener('input', e=>{ group.date = e.target.value; });
    const delBtn = card.querySelector('[data-delgroup]');
    if(delBtn) delBtn.addEventListener('click', ()=>{
      stageGroups = stageGroups.filter(g=> g.id!==group.id);
      renderStageGroups();
    });

    const tbody = card.querySelector('tbody');
    function renderRows(){
      tbody.innerHTML = '';
      group.rows.forEach((r,i)=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" data-i="${i}" data-f="name" value="${escapeAttr(r.name)}"></td>
          <td><input type="number" min="1" data-i="${i}" data-f="sets" value="${r.sets}"></td>
          <td><input type="text" data-i="${i}" data-f="target" value="${escapeAttr(r.target||'')}" placeholder="6 a 10"></td>
          <td><input type="number" min="0" data-i="${i}" data-f="reps" value="${r.reps}"></td>
          <td><input type="number" min="0" step="0.5" data-i="${i}" data-f="weight" value="${r.weight}"></td>
          <td><button class="ghost small" data-del="${i}" title="Remover linha">✕</button></td>`;
        tbody.appendChild(tr);
      });
      card.querySelector('.badge-count').textContent = group.rows.length + ' linhas';
    }
    tbody.addEventListener('input', e=>{
      const t = e.target;
      if(t.dataset.i===undefined) return;
      const i = +t.dataset.i, f = t.dataset.f;
      if(f==='name'){ group.rows[i].name = t.value; return; }
      if(f==='target'){
        // O alvo é o que vale do protocolo; as reps iniciais saem dele.
        group.rows[i].target = cleanTarget(t.value);
        group.rows[i].reps = parseRepsTarget(t.value);
        const repsInput = tbody.querySelector(`[data-i="${i}"][data-f="reps"]`);
        if(repsInput) repsInput.value = group.rows[i].reps;
        return;
      }
      group.rows[i][f] = parseFloat(t.value)||0;
    });
    tbody.addEventListener('click', e=>{
      if(e.target.dataset.del!==undefined){
        group.rows.splice(+e.target.dataset.del,1);
        renderRows();
      }
    });
    card.querySelector('[data-addrow]').addEventListener('click', ()=>{
      group.rows.push({name:'', sets:1, reps:10, weight:0, target:''});
      renderRows();
    });
    renderRows();
  });
}

function closeStage(){
  stageWrap.style.display='none';
  fileInput.value='';
  dropLabel.innerHTML = '<strong>Clique para escolher</strong> ou arraste um PDF de treino aqui';
}
document.getElementById('stageCancel').addEventListener('click', closeStage);
function commitStagedSessions(){
  let added = 0;
  const hasValid = stageGroups.some(g=> buildExercisesFromRows(g.rows).length>0);
  if(!hasValid){ alert('Adicione ao menos um exercício com nome.'); return 0; }
  const protocolId = resolveStageProtocolId();
  const weeks = clampWeeks(stageProtocol.weeks);
  // O protocolo já nasce com todas as semanas: a divisão de treino se repete
  // em cada uma, sem carga, para ser preenchida conforme você treina.
  for(let w=0; w<weeks; w++){
    stageGroups.forEach(group=>{
      const exercises = buildExercisesFromRows(group.rows);
      if(exercises.length===0) return;
      const name = group.name.trim() || 'Sessão';
      const date = addDaysISO(group.date || todayISO(), 7*w);
      if(sessionExists(name, date)) return;
      const session = { id: uid(), protocolId, date, name, exercises };
      state.sessions.push(session);
      openMonths.add(getMonthKey(session.date));
      openWeeks.add(getWeekKey(session.date));
      added++;
    });
  }
  openProtocols.clear();
  openProtocols.add(protocolId);
  save();
  closeStage();
  stageGroups = [];
  renderAll();
  document.getElementById('sessionsList').scrollIntoView({behavior:'smooth', block:'nearest'});
  return added;
}
document.getElementById('stageConfirm').addEventListener('click', commitStagedSessions);

/* ---------- Sessions render (agrupado por mês > semana > dia) ---------- */
const sessionsList = document.getElementById('sessionsList');
let openSessionId = null;
const openProtocols = new Set();
const openMonths = new Set();
const openWeeks = new Set();

// Sessão manual entra no protocolo mais recente (criando um, se não houver).
function newManualSession(){
  let protocolId = newestProtocolId();
  if(!protocolId){
    const prot = { id: uid(), name: suggestProtocolName(todayISO()), createdAt: todayISO() };
    state.protocols.push(prot);
    protocolId = prot.id;
  }
  const session = { id: uid(), protocolId, date: todayISO(), name: 'Nova sessão', exercises: [
    { id: uid(), name: 'Exercício', sets:[{reps:10, weight:0, target:''}] }
  ]};
  state.sessions.push(session);
  openSessionId = session.id;
  openProtocols.add(protocolId);
  openMonths.add(getMonthKey(session.date));
  openWeeks.add(getWeekKey(session.date));
  return session;
}

document.getElementById('addSessionBtn').addEventListener('click', ()=>{
  newManualSession();
  save(); renderAll();
});

document.getElementById('addProtocolBtn').addEventListener('click', ()=>{
  const prot = { id: uid(), name: suggestProtocolName(todayISO()), createdAt: todayISO() };
  state.protocols.push(prot);
  openProtocols.clear();
  openProtocols.add(prot.id);
  save(); renderAll();
  const inp = sessionsList.querySelector(`[data-protname="${prot.id}"]`);
  if(inp){ inp.focus(); inp.select(); }
});

function getMonthKey(iso){ return iso.slice(0,7); }
function getMonthLabel(iso){
  const d = new Date(iso+'T00:00:00');
  const s = d.toLocaleDateString('pt-BR',{month:'long', year:'numeric'});
  return s.charAt(0).toUpperCase()+s.slice(1);
}
function getWeekKey(iso){
  const d = new Date(iso+'T00:00:00');
  const day = d.getDay();
  const diff = (day===0 ? -6 : 1-day);
  d.setDate(d.getDate()+diff);
  return d.toISOString().slice(0,10);
}
function getWeekLabel(mondayIso){
  const start = new Date(mondayIso+'T00:00:00');
  const end = new Date(start); end.setDate(start.getDate()+6);
  const f = d=> d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  return `Semana de ${f(start)} a ${f(end)}`;
}

/* ---------- Repetir semana / sessão ----------
   O treino é mensal e se repete toda semana, então copiar a estrutura evita
   reimportar o PDF. A carga vai zerada de propósito: assim a cópia ainda não
   treinada não entra no relatório de rendimento (1RM só conta com peso > 0)
   e não finge um resultado que não aconteceu. */
function cloneSessionTo(session, newDate){
  return {
    id: uid(),
    protocolId: session.protocolId,
    date: newDate,
    name: session.name,
    exercises: session.exercises.map(ex=> ({
      id: uid(),
      name: ex.name,
      sets: ex.sets.map(s=> ({ reps: s.reps, weight: 0, target: s.target||'' }))
    }))
  };
}
function sessionExists(name, date){
  const key = (name||'').trim().toLowerCase();
  return state.sessions.some(s=> s.date===date && s.name.trim().toLowerCase()===key);
}
function pushCopy(copy){
  state.sessions.push(copy);
  openMonths.add(getMonthKey(copy.date));
  openWeeks.add(getWeekKey(copy.date));
}

async function doRepeatSession(session){
  const newDate = addDaysISO(session.date, 7);
  if(sessionExists(session.name, newDate)){
    alert(`"${session.name}" já existe em ${fmtDate(newDate)}.`);
    return false;
  }
  const ok = await confirmDialog(`Repetir "${session.name}" em ${fmtDate(newDate)}?`, {okLabel:'Repetir', danger:false});
  if(!ok) return false;
  const copy = cloneSessionTo(session, newDate);
  pushCopy(copy);
  openSessionId = copy.id;
  save(); renderAll();
  return true;
}

/* Semanas de um protocolo, em ordem. */
function protocolWeekKeys(protocolId){
  const keys = new Set();
  state.sessions.forEach(s=>{ if(s.protocolId===protocolId) keys.add(getWeekKey(s.date)); });
  return [...keys].sort();
}
/* A divisão de treino do protocolo é a primeira semana dele — é ela que se
   repete quando o protocolo é estendido. */
function protocolDivision(protocolId){
  const keys = protocolWeekKeys(protocolId);
  if(!keys.length) return [];
  return state.sessions
    .filter(s=> s.protocolId===protocolId && getWeekKey(s.date)===keys[0])
    .sort((a,b)=> a.date.localeCompare(b.date));
}
function diffDays(a, b){
  return Math.round((new Date(a+'T00:00:00') - new Date(b+'T00:00:00')) / 86400000);
}

/* Acrescenta mais uma semana ao protocolo, repetindo a divisão de treino. */
async function addProtocolWeek(protocolId){
  const base = protocolDivision(protocolId);
  if(base.length===0){
    alert('Este protocolo ainda não tem treinos para repetir. Importe a ficha ou crie uma sessão primeiro.');
    return false;
  }
  const keys = protocolWeekKeys(protocolId);
  const newWeekKey = addDaysISO(keys[keys.length-1], 7);
  const offset = diffDays(newWeekKey, keys[0]);
  const ok = await confirmDialog(
    `Adicionar a ${getWeekLabel(newWeekKey).toLowerCase()} com os ${base.length} treinos da divisão?`,
    {okLabel:'Adicionar', danger:false}
  );
  if(!ok) return false;
  let added = 0;
  base.forEach(s=>{
    const newDate = addDaysISO(s.date, offset);
    if(sessionExists(s.name, newDate)) return;
    pushCopy(cloneSessionTo(s, newDate));
    added++;
  });
  if(added===0){ alert('Essas sessões já existem na semana seguinte.'); return false; }
  const prot = state.protocols.find(p=> p.id===protocolId);
  if(prot) prot.weeks = protocolWeekKeys(protocolId).length;
  save(); renderAll();
  return true;
}

/* ---------- Protocolos ----------
   Cada ficha nova do professor é um protocolo: um bloco que guarda dentro os
   meses/semanas e as sessões daquele período. */
function ensureProtocols(){
  if(!Array.isArray(state.protocols)) state.protocols = [];
  const orphans = state.sessions.filter(s=> !s.protocolId);
  if(!orphans.length) return false;
  // Sessões antigas (anteriores aos protocolos) entram num bloco inicial.
  let p = state.protocols[0];
  if(!p){
    p = { id: uid(), name: suggestProtocolName(orphans.map(s=> s.date).sort()[0]), createdAt: todayISO() };
    state.protocols.push(p);
  }
  orphans.forEach(s=> s.protocolId = p.id);
  return true;
}
function suggestProtocolName(iso){
  const d = new Date((iso||todayISO())+'T00:00:00');
  const mes = d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').trim();
  return `Protocolo ${mes}/${d.getFullYear()}`;
}
function newestProtocolId(){
  if(!state.protocols.length) return null;
  return [...state.protocols].sort((a,b)=> String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0].id;
}
function fmtDayMonth(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
}

function groupByProtocol(sessions){
  const byProt = new Map();
  sessions.forEach(s=>{
    const k = s.protocolId || '__none';
    if(!byProt.has(k)) byProt.set(k, []);
    byProt.get(k).push(s);
  });
  const blocks = [];
  byProt.forEach((list, k)=>{
    const prot = state.protocols.find(p=> p.id===k) || null;
    const dates = list.map(s=> s.date).sort();
    blocks.push({
      key: k,
      protocol: prot,
      name: prot ? prot.name : 'Sem protocolo',
      sessions: list,
      start: dates[0],
      end: dates[dates.length-1],
      months: groupSessions(list)
    });
  });
  // Protocolo recém-criado ainda sem sessões também aparece, para receber treinos.
  state.protocols.forEach(p=>{
    if(byProt.has(p.id)) return;
    blocks.push({
      key: p.id, protocol: p, name: p.name, sessions: [],
      start: p.createdAt || todayISO(), end: p.createdAt || todayISO(), months: []
    });
  });
  // Protocolo mais recente primeiro.
  blocks.sort((a,b)=> b.end.localeCompare(a.end));
  return blocks;
}

/* Dentro de um protocolo a ordem é cronológica: semana 1 → última, e cada
   semana da segunda para o fim de semana. */
function groupSessions(sessions){
  const sorted = [...sessions].sort((a,b)=> a.date.localeCompare(b.date));
  const months = [];
  const monthIdx = {};
  sorted.forEach(session=>{
    const mKey = getMonthKey(session.date);
    if(!(mKey in monthIdx)){ monthIdx[mKey] = months.length; months.push({key:mKey, label:getMonthLabel(session.date), weeks:[], weekIdx:{}}); }
    const month = months[monthIdx[mKey]];
    const wKey = getWeekKey(session.date);
    if(!(wKey in month.weekIdx)){ month.weekIdx[wKey] = month.weeks.length; month.weeks.push({key:wKey, label:getWeekLabel(wKey), sessions:[]}); }
    month.weeks[month.weekIdx[wKey]].sessions.push(session);
  });
  return months;
}

function renderSessions(){
  if(state.sessions.length===0){
    sessionsList.innerHTML = `<div class="empty"><strong>Nenhuma sessão ainda</strong>Importe um PDF acima ou crie uma sessão manual.</div>`;
    return;
  }
  const blocks = groupByProtocol(state.sessions);
  if(!blocks.some(b=> openProtocols.has(b.key))) openProtocols.add(blocks[0].key);

  sessionsList.innerHTML = '';
  blocks.forEach(block=>{
    const isOpen = openProtocols.has(block.key);
    const protEl = document.createElement('div');
    protEl.className = 'protocol-group' + (isOpen ? ' open':'');
    const range = block.start===block.end ? fmtDayMonth(block.start) : `${fmtDayMonth(block.start)} – ${fmtDayMonth(block.end)}`;
    const nWeeks = block.key==='__none' ? 0 : protocolWeekKeys(block.key).length;
    const meta = block.sessions.length
      ? `${range} · ${nWeeks} ${nWeeks===1?'semana':'semanas'} · ${block.sessions.length} ${block.sessions.length===1?'treino':'treinos'}`
      : 'vazio';
    protEl.innerHTML = `
      <div class="protocol-head" data-protocol="${block.key}">
        <span class="chev">›</span>
        ${READONLY
          ? `<span class="protocol-name">${escapeHtml(block.name)}</span>`
          : `<input class="protocol-name" data-protname="${block.key}" value="${escapeAttr(block.name)}">`}
        <span class="group-meta">${meta}</span>
        ${READONLY ? '' : `<button class="ghost small repeat" data-addweek="${block.key}" title="Repetir a divisão de treino em mais uma semana">+ semana</button>`}
      </div>
      <div class="protocol-body"></div>`;
    sessionsList.appendChild(protEl);
    if(!isOpen) return;
    const body = protEl.querySelector('.protocol-body');
    if(block.months.length===0){
      body.innerHTML = `<div class="empty" style="padding:18px;">Nenhuma sessão neste protocolo ainda. Importe o PDF da ficha ou crie uma sessão manual.</div>`;
      return;
    }
    const ordem = protocolWeekKeys(block.key);
    renderMonthGroups(body, block.months, k=> ordem.indexOf(k)+1);
  });
}

/* Dentro de um protocolo: se ele cabe num mês só, pula o nível de mês e mostra
   as semanas direto — menos cliques para chegar na sessão. */
function renderMonthGroups(container, months, weekNumber){
  if(openMonths.size===0 && months.length) openMonths.add(months[0].key);
  months.forEach(month=>{
    if((months.length===1 || openMonths.has(month.key)) && !month.weeks.some(w=> openWeeks.has(w.key))){
      openWeeks.add(month.weeks[0].key);
    }
  });

  if(months.length===1){
    renderWeekGroups(container, months[0].weeks, weekNumber);
    return;
  }

  months.forEach(month=>{
    const sessionCount = month.weeks.reduce((n,w)=> n+w.sessions.length, 0);
    const monthOpen = openMonths.has(month.key);
    const monthEl = document.createElement('div');
    monthEl.className = 'month-group' + (monthOpen ? ' open':'');
    monthEl.innerHTML = `
      <div class="month-head" data-month="${month.key}">
        <span class="chev">›</span><span class="group-label">${month.label}</span>
        <span class="group-meta">${sessionCount} ${sessionCount===1?'sessão':'sessões'}</span>
      </div>
      <div class="month-body"></div>`;
    container.appendChild(monthEl);
    if(!monthOpen) return;
    renderWeekGroups(monthEl.querySelector('.month-body'), month.weeks, weekNumber);
  });
}

function renderWeekGroups(container, weeks, weekNumber){
  weeks.forEach(week=>{
    const weekOpen = openWeeks.has(week.key);
    const n = weekNumber ? weekNumber(week.key) : 0;
    const label = n>0 ? `Semana ${n} · ${week.label.replace('Semana de ','').replace(' a ',' – ')}` : week.label;
    const weekEl = document.createElement('div');
    weekEl.className = 'week-group' + (weekOpen ? ' open':'');
    weekEl.innerHTML = `
      <div class="week-head" data-week="${week.key}">
        <span class="chev">›</span><span class="group-label">${label}</span>
        <span class="group-meta">${week.sessions.length} ${week.sessions.length===1?'treino':'treinos'}</span>
      </div>
      <div class="week-body"></div>`;
    container.appendChild(weekEl);
    if(!weekOpen) return;
    const weekBody = weekEl.querySelector('.week-body');

    week.sessions.forEach(session=>{
      const div = document.createElement('div');
      div.className = 'session' + (openSessionId===session.id ? ' open':'');
      div.innerHTML = `
        <div class="session-head" data-open="${session.id}">
          <span class="session-name">${escapeHtml(session.name)} ${session.feedback?'<span class="feedback-flag" title="Tem feedback do professor">💬</span>':''}</span>
          <div style="display:flex;align-items:center;gap:4px;">
            ${READONLY ? '' : `<button class="ghost small repeat" data-repeatsession="${session.id}" title="Repetir esta sessão daqui a 7 dias">⟳</button>`}
            ${READONLY ? '' : `<button class="ghost small" data-quickdel="${session.id}" title="Excluir sessão">✕</button>`}
            <span class="chev">›</span>
          </div>
        </div>
        <div class="session-body"></div>`;
      weekBody.appendChild(div);
      if(openSessionId===session.id) renderSessionBody(div.querySelector('.session-body'), session);
    });
  });
}

/* ---------- Feedback do professor ----------
   O login de professor já deixa ver a ficha de qualquer aluno, somente
   leitura. O único campo que ele PODE escrever é este: um comentário por
   sessão, visível para o aluno. */
function feedbackBlockHtml(session){
  const fb = session.feedback || '';
  if(READONLY){
    return `<div class="feedback-block feedback-editing">
      <label class="hint">💬 Feedback para o aluno</label>
      <textarea data-feedback rows="2" placeholder="Deixe um comentário sobre esta sessão...">${escapeHtml(fb)}</textarea>
    </div>`;
  }
  if(!fb) return '';
  return `<div class="feedback-block">
    <div class="hint">💬 Feedback do professor</div>
    <div class="feedback-text">${escapeHtml(fb)}</div>
  </div>`;
}
function wireFeedbackBlock(container, session){
  if(!READONLY) return;
  const ta = container.querySelector('[data-feedback]');
  if(!ta) return;
  ta.addEventListener('input', ()=>{ session.feedback = ta.value; save(); });
}

function renderSessionBody(container, session){
  const ro = READONLY;
  const roAttr = ro ? 'disabled' : '';
  container.innerHTML = `
    <div class="row-fields" style="grid-template-columns:1fr 160px 90px;">
      <div><label class="hint">Nome</label><input type="text" data-sfield="name" value="${escapeAttr(session.name)}" ${roAttr}></div>
      <div><label class="hint">Data</label><input type="date" data-sfield="date" value="${session.date}" ${roAttr}></div>
      <div style="display:flex;align-items:flex-end;">${ro?'':'<button class="ghost small" data-delsession="1">✕ excluir sessão</button>'}</div>
    </div>
    ${feedbackBlockHtml(session)}
    <div id="exList-${session.id}"></div>
    ${ro?'':'<button class="small" data-addex="1">+ exercício</button>'}`;

  wireFeedbackBlock(container, session);

  if(!ro){
    container.querySelectorAll('[data-sfield]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        session[inp.dataset.sfield] = inp.value;
        save();
        if(inp.dataset.sfield==='date'){
          openMonths.add(getMonthKey(session.date));
          openWeeks.add(getWeekKey(session.date));
          renderSessions();
          refreshComputed();
          return;
        }
        const head = container.parentElement.querySelector('.session-head');
        head.querySelector('.session-name').textContent = session.name;
        refreshComputed();
      });
    });
    container.querySelector('[data-delsession]').addEventListener('click', async ()=>{
      if(!(await confirmDialog(`Excluir a sessão "${session.name}"?`))) return;
      state.sessions = state.sessions.filter(s=> s.id!==session.id);
      save(); renderAll();
    });
    container.querySelector('[data-addex]').addEventListener('click', ()=>{
      session.exercises.push({id:uid(), name:'Exercício', sets:[{reps:10,weight:0}]});
      save(); renderExList();
    });
  }

  const exListEl = container.querySelector(`#exList-${session.id}`);
  function renderExList(){
    exListEl.innerHTML = '';
    session.exercises.forEach(ex=>{
      const block = document.createElement('div');
      block.className = 'ex-block';
      const targetLabel = exerciseTarget(ex);
      const record = recordFor(ex.name);
      block.innerHTML = `
        <div class="ex-head">
          <input type="text" class="ex-name-input" value="${escapeAttr(ex.name)}" ${roAttr}>
          <span class="ex-target hint">${targetLabel ? 'alvo '+escapeHtml(targetLabel)+' reps' : ''}</span>
          ${record ? `<span class="pr-badge">🏆 ${record.weight}kg × ${record.reps}</span>` : ''}
          ${videoButtonHtml(ex.name, 'small')}
          ${ro?'':`<button class="ghost small" data-delex="${ex.id}">✕</button>`}
        </div>
        <div class="set-rows"></div>
        ${ro?'':`<button class="ghost small set-add" data-addset="${ex.id}">+ série</button>`}`;
      exListEl.appendChild(block);

      if(!ro){
        block.querySelector('.ex-name-input').addEventListener('input', e=>{
          ex.name = e.target.value; save(); refreshComputed();
        });
        block.querySelector('[data-delex]').addEventListener('click', ()=>{
          session.exercises = session.exercises.filter(e=> e.id!==ex.id);
          save(); renderExList(); refreshComputed();
        });
        block.querySelector('[data-addset]').addEventListener('click', ()=>{
          const last = ex.sets[ex.sets.length-1];
          ex.sets.push({reps:last?last.reps:10, weight:last?last.weight:0, target:last?(last.target||''):''});
          save(); renderSetRows();
        });
      }

      const setRowsEl = block.querySelector('.set-rows');
      function renderSetRows(){
        setRowsEl.innerHTML = '';
        ex.sets.forEach((s,i)=>{
          const row = document.createElement('div');
          row.className = 'set-row';
          row.innerHTML = `
            <span class="set-idx">${i+1}</span>
            <input type="text" class="set-target" placeholder="alvo" value="${escapeAttr(s.target||'')}" data-k="target" ${roAttr}>
            <input type="number" min="0" placeholder="reps" value="${s.reps}" data-k="reps" ${roAttr}>
            <input type="number" min="0" step="0.5" placeholder="kg" value="${s.weight}" data-k="weight" ${roAttr}>
            ${ro?'':`<button class="ghost small" data-delset="${i}">✕</button>`}`;
          setRowsEl.appendChild(row);
          if(!ro){
            row.querySelector('[data-k="target"]').addEventListener('input', e=>{
              s.target = cleanTarget(e.target.value);
              save();
              block.querySelector('.ex-target').textContent = exerciseTarget(ex) ? 'alvo '+exerciseTarget(ex)+' reps' : '';
            });
            function updatePrBadge(){
              const record = recordFor(ex.name);
              const badge = block.querySelector('.pr-badge');
              const html = record ? `<span class="pr-badge">🏆 ${record.weight}kg × ${record.reps}</span>` : '';
              if(badge) badge.outerHTML = html;
              else if(html) block.querySelector('.ex-target').insertAdjacentHTML('afterend', html);
            }
            row.querySelector('[data-k="reps"]').addEventListener('input', e=>{
              s.reps=parseFloat(e.target.value)||0; save(); refreshComputed();
              maybeCelebratePR(ex.name, s); updatePrBadge();
            });
            row.querySelector('[data-k="weight"]').addEventListener('input', e=>{
              s.weight=parseFloat(e.target.value)||0; save(); refreshComputed();
              maybeCelebratePR(ex.name, s); updatePrBadge();
            });
            row.querySelector('[data-delset]').addEventListener('click', ()=>{
              ex.sets.splice(i,1);
              if(ex.sets.length===0) ex.sets.push({reps:10,weight:0});
              save(); renderSetRows(); refreshComputed();
            });
          }
        });
      }
      renderSetRows();
    });
  }
  renderExList();
}

sessionsList.addEventListener('click', async e=>{
  const addWeekBtn = e.target.closest('[data-addweek]');
  if(addWeekBtn){
    await addProtocolWeek(addWeekBtn.dataset.addweek);
    return;
  }
  const repeatSessionBtn = e.target.closest('[data-repeatsession]');
  if(repeatSessionBtn){
    const session = state.sessions.find(s=> s.id===repeatSessionBtn.dataset.repeatsession);
    if(session) await doRepeatSession(session);
    return;
  }
  const quickDel = e.target.closest('[data-quickdel]');
  if(quickDel){
    const id = quickDel.dataset.quickdel;
    const session = state.sessions.find(s=> s.id===id);
    if(session && (await confirmDialog(`Excluir a sessão "${session.name}"?`))){
      state.sessions = state.sessions.filter(s=> s.id!==id);
      if(openSessionId===id) openSessionId = null;
      save(); renderAll();
    }
    return;
  }
  const protHead = e.target.closest('[data-protocol]');
  if(protHead && !e.target.closest('input, button')){
    const k = protHead.dataset.protocol;
    if(openProtocols.has(k)) openProtocols.delete(k); else openProtocols.add(k);
    renderSessions();
    return;
  }
  const monthHead = e.target.closest('[data-month]');
  if(monthHead){
    const k = monthHead.dataset.month;
    if(openMonths.has(k)) openMonths.delete(k); else openMonths.add(k);
    renderSessions();
    return;
  }
  const weekHead = e.target.closest('[data-week]');
  if(weekHead){
    const k = weekHead.dataset.week;
    if(openWeeks.has(k)) openWeeks.delete(k); else openWeeks.add(k);
    renderSessions();
    return;
  }
  const head = e.target.closest('[data-open]');
  if(!head) return;
  const id = head.dataset.open;
  openSessionId = (openSessionId===id) ? null : id;
  renderSessions();
});

// Renomear protocolo direto no cabeçalho do bloco.
sessionsList.addEventListener('input', e=>{
  const inp = e.target.closest('[data-protname]');
  if(!inp) return;
  const prot = state.protocols.find(p=> p.id===inp.dataset.protname);
  if(prot){ prot.name = inp.value; save(); }
});

/* ---------- Progress table (com ramificação por série) ---------- */
function computeProgress(){
  const byExercise = {};
  state.sessions.forEach(session=>{
    session.exercises.forEach(ex=>{
      const key = ex.name.trim().toLowerCase();
      if(!key) return;
      if(!byExercise[key]) byExercise[key] = { label: ex.name.trim(), sessionsData: [] };
      byExercise[key].sessionsData.push({
        date: session.date,
        sets: ex.sets.map(s=> ({reps:s.reps, weight:s.weight, rm: epley1RM(s.weight,s.reps)}))
      });
    });
  });

  return Object.values(byExercise).map(e=>{
    e.sessionsData.sort((a,b)=> a.date.localeCompare(b.date));

    const points = e.sessionsData.map(sd=>{
      const top = sd.sets.reduce((best,s)=> (!best || s.rm>best.rm) ? s : best, null);
      return (top && top.rm>0) ? {date: sd.date, ...top} : null;
    }).filter(Boolean);

    const maxSets = e.sessionsData.reduce((n,sd)=> Math.max(n, sd.sets.length), 0);
    const bySet = [];
    for(let i=0;i<maxSets;i++){
      const pts = e.sessionsData
        .filter(sd=> sd.sets[i] && sd.sets[i].rm>0)
        .map(sd=> ({date: sd.date, ...sd.sets[i]}));
      if(pts.length>0) bySet.push(pts);
    }

    return { label: e.label, points, bySet };
  }).filter(e=> e.points.length>0)
    .sort((a,b)=> a.label.localeCompare(b.label,'pt-BR'));
}

function trendDelta(pts){
  const cur = pts[pts.length-1];
  const prev = pts.length>1 ? pts[pts.length-2] : null;
  let deltaHtml = '<span class="hint">—</span>';
  if(prev){
    const diff = cur.rm - prev.rm;
    const pct = (diff/prev.rm)*100;
    const dir = Math.abs(pct)<0.5 ? 'flat' : (diff>0?'up':'down');
    const arrow = dir==='up' ? '▲' : dir==='down' ? '▼' : '▬';
    deltaHtml = `<span class="trend ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
  }
  return { cur, prev, deltaHtml };
}

function sparkline(points){
  const w=110, h=32, pad=4;
  const vals = points.map(p=> p.rm);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max-min)||1;
  const step = (w-pad*2)/Math.max(1,points.length-1);
  const pts = vals.map((v,i)=> [pad+i*step, h-pad-((v-min)/span)*(h-pad*2)]);
  const path = pts.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const last = pts[pts.length-1];
  const rising = vals[vals.length-1] >= vals[0];
  const color = rising ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/>
  </svg>`;
}

const expandedExercises = new Set();

function progressSubRow(label, pts){
  const {cur, deltaHtml} = trendDelta(pts);
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:12px;color:var(--text-dim);">
    <span>${escapeHtml(label)}</span>
    <span class="num">${cur.weight}kg × ${cur.reps}</span>
    <span>${deltaHtml}</span>
  </div>`;
}

function progressCard(e){
  const {cur, prev, deltaHtml} = trendDelta(e.points);
  const key = e.label.toLowerCase();
  const hasBranches = e.bySet.length>1;
  const isOpen = hasBranches && expandedExercises.has(key);
  return `<div class="prog-card">
    <div class="pc-name">${escapeHtml(e.label)}</div>
    <div class="pc-rm">${cur.rm.toFixed(1)}kg</div>
    <div class="hint" style="margin:2px 0 6px;">${cur.weight}kg × ${cur.reps} ${prev?'· antes '+prev.weight+'kg × '+prev.reps:''}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      ${deltaHtml}
      ${e.points.length>1 ? sparkline(e.points.slice(-8)) : '<span class="hint">1 registro</span>'}
    </div>
    ${hasBranches ? `<button class="ghost small ex-toggle" data-ex="${escapeAttr(key)}" style="margin-top:8px;">${isOpen?'▾':'▸'} ${e.bySet.length} séries</button>` : ''}
    ${isOpen ? `<div class="pc-sets">${e.bySet.map((pts,i)=> progressSubRow(`Série ${i+1}`, pts)).join('')}</div>` : ''}
  </div>`;
}

function renderProgress(){
  const wrap = document.getElementById('progressWrap');
  const data = computeProgress();
  if(data.length===0){
    wrap.innerHTML = `<div class="empty"><strong>Sem dados suficientes</strong>Registre pelo menos uma sessão para ver a evolução do rendimento.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="prog-grid">${data.map(progressCard).join('')}</div>`;

  wrap.querySelectorAll('.ex-toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const k = btn.dataset.ex;
      if(expandedExercises.has(k)) expandedExercises.delete(k); else expandedExercises.add(k);
      renderProgress();
    });
  });
}

/* ---------- Stats + helpers ---------- */
function refreshComputed(){
  renderProgress();
  renderStats();
  renderDashboard();
  renderVolumeChart();
  renderEnergyChart();
}

function renderStats(){
  let up=0;
  computeProgress().forEach(e=>{
    if(e.points.length>1 && e.points[e.points.length-1].rm > e.points[e.points.length-2].rm) up++;
  });
  document.getElementById('statSessions').textContent = state.sessions.length;
  document.getElementById('statUp').textContent = up;
  document.getElementById('statStreak').textContent = computeStreak();
}

/* ---------- Dashboard: streak, próximo treino, recordes ---------- */

// Semanas seguidas (a partir de hoje) com pelo menos uma série com carga.
function computeStreak(){
  const trainedWeeks = new Set();
  state.sessions.forEach(s=>{
    if(s.exercises.some(e=> e.sets.some(x=> x.weight>0))) trainedWeeks.add(getWeekKey(s.date));
  });
  if(trainedWeeks.size===0) return 0;
  let cursor = getWeekKey(todayISO());
  if(!trainedWeeks.has(cursor)) cursor = addDaysISO(cursor, -7);
  let streak = 0;
  while(trainedWeeks.has(cursor)){ streak++; cursor = addDaysISO(cursor, -7); }
  return streak;
}

// Sessão a fazer: a mais recente que já passou (ou hoje) e ainda tem série sem
// carga; se não houver nenhuma atrasada, a próxima futura com série pendente.
function findNextSession(){
  const pending = state.sessions.filter(s=> s.exercises.some(e=> e.sets.some(x=> !(x.weight>0))));
  if(!pending.length) return null;
  pending.sort((a,b)=> a.date.localeCompare(b.date));
  const today = todayISO();
  const overdue = pending.filter(s=> s.date<=today);
  return overdue.length ? overdue[overdue.length-1] : pending[0];
}

function renderDashboard(){
  const next = findNextSession();
  const label = document.getElementById('dashNextLabel');
  const btn = document.getElementById('dashNextBtn');
  if(next){
    label.textContent = next.name;
    btn.disabled = false;
    btn.onclick = ()=> openSessionFromDashboard(next.id);
  }else{
    label.textContent = state.sessions.length ? 'Tudo em dia 🎉' : 'Importe sua ficha para começar';
    btn.disabled = true;
  }
}
function openSessionFromDashboard(id){
  const session = state.sessions.find(s=> s.id===id);
  if(!session) return;
  openProtocols.clear(); openProtocols.add(session.protocolId);
  openMonths.add(getMonthKey(session.date));
  openWeeks.add(getWeekKey(session.date));
  openSessionId = id;
  renderSessions();
  document.getElementById('sessionsList').scrollIntoView({behavior:'smooth', block:'start'});
}

// Melhor 1RM já registrado para um exercício (para badge de recorde pessoal).
function recordFor(label){
  const key = (label||'').trim().toLowerCase();
  if(!key) return null;
  let best = null;
  state.sessions.forEach(s=> s.exercises.forEach(e=>{
    if(e.name.trim().toLowerCase()!==key) return;
    e.sets.forEach(x=>{
      if(x.weight>0){ const rm = epley1RM(x.weight,x.reps); if(!best || rm>best.rm) best = {weight:x.weight, reps:x.reps, rm}; }
    });
  }));
  return best;
}
// Igual a recordFor, mas ignorando uma série específica — usado para saber se
// a série que acabou de ser editada É o novo recorde (comparando com o resto).
function bestExcluding(label, excludeSet){
  const key = (label||'').trim().toLowerCase();
  let best = null;
  state.sessions.forEach(s=> s.exercises.forEach(e=>{
    if(e.name.trim().toLowerCase()!==key) return;
    e.sets.forEach(x=>{
      if(x===excludeSet) return;
      if(x.weight>0){ const rm = epley1RM(x.weight,x.reps); if(!best || rm>best.rm) best = {weight:x.weight, reps:x.reps, rm}; }
    });
  }));
  return best;
}
function maybeCelebratePR(exName, set){
  if(!(set.weight>0)) return;
  const rm = epley1RM(set.weight, set.reps);
  const prev = bestExcluding(exName, set);
  if(!prev || rm > prev.rm + 0.05) showToast(`🏆 Novo recorde em ${exName}: ${set.weight}kg × ${set.reps}`);
}
function showToast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=> t.remove(), 300); }, 2800);
}

// Volume total (peso × reps) por semana, últimas 8 semanas com dados.
function computeWeeklyVolume(){
  const byWeek = {};
  state.sessions.forEach(s=>{
    const wk = getWeekKey(s.date);
    s.exercises.forEach(e=> e.sets.forEach(x=>{
      if(x.weight>0 && x.reps>0) byWeek[wk] = (byWeek[wk]||0) + x.weight*x.reps;
    }));
  });
  return Object.keys(byWeek).sort().map(k=> ({week:k, volume:byWeek[k]})).slice(-8);
}
function renderVolumeChart(){
  const wrap = document.getElementById('volumeWrap');
  if(!wrap) return;
  const data = computeWeeklyVolume();
  if(data.length===0){
    wrap.innerHTML = `<div class="empty" style="padding:16px;"><strong>Sem volume ainda</strong>Registre cargas para ver o total levantado por semana.</div>`;
    return;
  }
  const max = Math.max(...data.map(d=> d.volume));
  wrap.innerHTML = `<div class="volume-chart">${data.map(d=>{
    const h = Math.max(4, Math.round((d.volume/max)*80));
    const lbl = fmtDayMonth(d.week);
    return `<div class="volume-bar" style="height:${h}px;" title="${Math.round(d.volume)}kg na semana de ${lbl}"><span class="vb-label">${lbl}</span></div>`;
  }).join('')}</div>`;
}

/* ---------- Gasto de energia (kcal) — só para quem o admin liberou ----------
   Estimativa pelo trabalho mecânico: cada repetição desloca a carga ~0,5 m
   (peso × g × 0,5 m, em joules) e o músculo converte só ~20% da energia em
   movimento; 1 kcal = 4184 J. Dá ≈ 0,006 kcal por kg levantado por repetição. */
let energyEnabled = false;
function energyKcal(weight, reps){
  const DISPLACEMENT_M = 0.5, MUSCLE_EFFICIENCY = 0.2, J_PER_KCAL = 4184;
  const w = +weight, r = +reps;
  if(!(w>0) || !(r>0)) return 0;
  return w * r * 9.81 * DISPLACEMENT_M / MUSCLE_EFFICIENCY / J_PER_KCAL;
}
function computeSessionEnergy(sessions){
  return (sessions||[])
    .map(s=> ({ id: s.id, name: s.name, date: s.date,
      kcal: (s.exercises||[]).reduce((n,e)=> n + (e.sets||[]).reduce((m,x)=> m + energyKcal(x && x.weight, x && x.reps), 0), 0) }))
    .filter(x=> x.kcal>0 && x.date)
    .sort((a,b)=> a.date.localeCompare(b.date));
}
function energyChartHtml(){
  const all = computeSessionEnergy(state.sessions);
  if(!all.length){
    return `<div class="empty" style="padding:16px;"><strong>Sem gasto calculado ainda</strong>Registre peso e repetições nas séries para ver as kcal de cada treino.</div>`;
  }
  const data = all.slice(-12);
  const max = Math.max(...data.map(d=> d.kcal));
  const maxIdx = data.findIndex(d=> d.kcal===max);
  const lastIdx = data.length-1;
  const weekKey = getWeekKey(todayISO());
  const week = all.filter(d=> getWeekKey(d.date)===weekKey).reduce((n,d)=> n+d.kcal, 0);
  const total = all.reduce((n,d)=> n+d.kcal, 0);
  const fmt = v=> Math.round(v).toLocaleString('pt-BR');
  return `<div class="energy-summary">
      <div><div class="es-num">${fmt(data[lastIdx].kcal)} kcal</div><div class="es-lbl">último treino</div></div>
      <div><div class="es-num">${fmt(week)} kcal</div><div class="es-lbl">nesta semana</div></div>
      <div><div class="es-num">${fmt(total)} kcal</div><div class="es-lbl">total (${all.length} treinos)</div></div>
    </div>
    <div class="energy-chart" role="img" aria-label="Kcal gastas nos últimos ${data.length} treinos">${data.map((d,i)=>{
      const h = Math.max(2, (d.kcal/max)*100);
      const tip = `${fmtDate(d.date)} · ${d.name||'Treino'}: ${fmt(d.kcal)} kcal`;
      return `<div class="energy-col" tabindex="0" title="${escapeAttr(tip)}">
        <div class="energy-bar" style="height:${h.toFixed(1)}%;">${i===maxIdx || i===lastIdx ? `<span class="energy-val">${fmt(d.kcal)}</span>` : ''}</div>
      </div>`;
    }).join('')}</div>
    <div class="energy-axis">${data.map((d,i)=> `<span>${data.length<=6 || (lastIdx-i)%2===0 ? d.date.slice(8,10)+'/'+d.date.slice(5,7) : ''}</span>`).join('')}</div>
    <div class="energy-note">Estimativa pelo trabalho de levantar a carga (≈0,006 kcal por kg × repetição). Não inclui o gasto do corpo em repouso nem o aeróbico.</div>`;
}
function renderEnergyChart(){
  const card = document.getElementById('energyCard');
  if(!card) return;
  card.hidden = !energyEnabled;
  if(energyEnabled) document.getElementById('energyWrap').innerHTML = energyChartHtml();
}
const energyFlagKey = () => 'sobrecarga_energy_' + (activeStudentId() || 'x');
async function loadFeatures(){
  const sid = activeStudentId();
  if(!sid) return;
  try{
    const res = await fetch(`/api/features/${sid}`, { headers: apiHeaders() });
    if(!res.ok) return;
    const f = await res.json();
    if(sid!==activeStudentId()) return;
    const on = !!(f && f.energy);
    try{ localStorage.setItem(energyFlagKey(), on ? '1' : '0'); }catch(e){}
    if(on!==energyEnabled){ energyEnabled = on; renderAll(); }
  }catch(e){}
}

/* ---------- Vídeos de execução (links do YouTube) ----------
   A biblioteca do admin vale para todos; o professor pode trocar ou completar
   para os alunos dele. O vídeo é achado pelo nome do exercício normalizado —
   mesma regra de exerciseKey() em lib/videos.js. */
let exerciseVideos = {};
function exerciseKey(name){
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}
// Nome sem o que está entre parênteses: "Supino reto (barra)" também acha "Supino reto".
function baseExerciseKey(name){ return exerciseKey(String(name||'').replace(/\([^)]*\)/g, ' ')); }
function findVideo(map, name){
  const k = exerciseKey(name);
  if(!k) return null;
  if(map[k]) return map[k];
  const base = baseExerciseKey(name);
  if(map[base]) return map[base];
  // A chave salva não tem mais os parênteses; compara pelo nome original.
  const hit = Object.values(map).find(v=> v && baseExerciseKey(v.name)===base);
  return hit || null;
}
function videoFor(name){ return findVideo(exerciseVideos, name); }
const videosCacheKey = () => 'sobrecarga_videos_' + (activeStudentId() || 'x');
function loadVideosFromCache(){
  try{ exerciseVideos = JSON.parse(localStorage.getItem(videosCacheKey())) || {}; }catch(e){ exerciseVideos = {}; }
}
async function loadVideos(){
  const sid = activeStudentId();
  if(!sid) return;
  try{
    const res = await fetch(`/api/videos/${sid}`, { headers: apiHeaders() });
    if(!res.ok) return;
    const v = await res.json();
    if(sid!==activeStudentId() || !v || typeof v!=='object') return;
    const changed = JSON.stringify(v)!==JSON.stringify(exerciseVideos);
    exerciseVideos = v;
    try{ localStorage.setItem(videosCacheKey(), JSON.stringify(v)); }catch(e){}
    if(changed) renderAll();
  }catch(e){}
}
function videoButtonHtml(name, cls){
  const v = videoFor(name);
  if(!v) return '';
  return `<button type="button" class="video-btn ${cls||''}" data-video="${escapeAttr(v.youtubeId)}" data-video-title="${escapeAttr(name)}" aria-label="Ver execução de ${escapeAttr(name)}">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span>Ver execução</span></button>`;
}
// Player embutido (youtube-nocookie, liberado na CSP como frame-src).
function openVideo(youtubeId, title){
  if(!/^[A-Za-z0-9_-]{11}$/.test(youtubeId||'')) return;
  const overlay = document.createElement('div');
  overlay.className = 'video-overlay';
  overlay.innerHTML = `
    <div class="video-box" role="dialog" aria-modal="true" aria-label="Vídeo de execução">
      <div class="video-head">
        <div class="video-title">${escapeHtml(title||'Execução')}</div>
        <button type="button" class="video-close" aria-label="Fechar vídeo">✕</button>
      </div>
      <div class="video-frame">
        <iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&amp;modestbranding=1&amp;playsinline=1&amp;autoplay=1" title="${escapeAttr(title||'Vídeo de execução')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
      <a class="video-ext" href="https://www.youtube.com/watch?v=${youtubeId}" target="_blank" rel="noopener">Abrir no YouTube</a>
    </div>`;
  const close = ()=>{ overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e=>{ if(e.key==='Escape') close(); };
  overlay.addEventListener('click', e=>{ if(e.target===overlay || e.target.closest('.video-close')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('.video-close').focus();
}
document.addEventListener('click', e=>{
  const v = e.target.closest('[data-video]');
  if(v){ e.preventDefault(); openVideo(v.dataset.video, v.dataset.videoTitle); }
});

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- Montar treino: banco de exercícios + mapa muscular ---------- */
const MUSCLE_LABELS = {
  chest:'Peito', back:'Costas', shoulders:'Ombros', biceps:'Bíceps', triceps:'Tríceps',
  forearms:'Antebraço', abs:'Abdômen', quads:'Quadríceps', hamstrings:'Posterior de coxa',
  glutes:'Glúteos', calves:'Panturrilha', traps:'Trapézio'
};
const EXERCISE_DB = [
  // Peito
  {name:'Supino reto (barra)', muscle:'chest', target:'8 a 12'},
  {name:'Supino inclinado (halteres)', muscle:'chest', target:'8 a 12'},
  {name:'Supino declinado', muscle:'chest', target:'8 a 12'},
  {name:'Crucifixo reto', muscle:'chest', target:'10 a 15'},
  {name:'Crucifixo inclinado (cabo)', muscle:'chest', target:'10 a 15'},
  {name:'Peck deck (voador)', muscle:'chest', target:'12 a 15'},
  {name:'Crossover', muscle:'chest', target:'12 a 15'},
  {name:'Flexão de braço', muscle:'chest', target:'max'},
  {name:'Supino máquina', muscle:'chest', target:'8 a 12'},
  // Costas
  {name:'Puxada frente (pulley)', muscle:'back', target:'8 a 12'},
  {name:'Puxada supinada', muscle:'back', target:'8 a 12'},
  {name:'Remada curvada (barra)', muscle:'back', target:'8 a 12'},
  {name:'Remada cavalinho', muscle:'back', target:'8 a 12'},
  {name:'Remada unilateral (halter)', muscle:'back', target:'10 a 12'},
  {name:'Remada baixa (cabo)', muscle:'back', target:'10 a 12'},
  {name:'Pull-over', muscle:'back', target:'10 a 15'},
  {name:'Barra fixa', muscle:'back', target:'max'},
  {name:'Levantamento terra', muscle:'back', target:'6 a 10'},
  // Ombros
  {name:'Desenvolvimento militar', muscle:'shoulders', target:'8 a 12'},
  {name:'Desenvolvimento com halteres', muscle:'shoulders', target:'8 a 12'},
  {name:'Elevação lateral', muscle:'shoulders', target:'12 a 15'},
  {name:'Elevação frontal', muscle:'shoulders', target:'12 a 15'},
  {name:'Remada alta', muscle:'shoulders', target:'10 a 12'},
  {name:'Crucifixo invertido', muscle:'shoulders', target:'12 a 15'},
  // Bíceps
  {name:'Rosca direta (barra)', muscle:'biceps', target:'8 a 12'},
  {name:'Rosca alternada (halteres)', muscle:'biceps', target:'10 a 12'},
  {name:'Rosca scott', muscle:'biceps', target:'10 a 12'},
  {name:'Rosca martelo', muscle:'biceps', target:'10 a 12'},
  {name:'Rosca concentrada', muscle:'biceps', target:'10 a 12'},
  {name:'Rosca no cabo', muscle:'biceps', target:'10 a 12'},
  // Tríceps
  {name:'Tríceps corda (pulley)', muscle:'triceps', target:'10 a 15'},
  {name:'Tríceps testa', muscle:'triceps', target:'8 a 12'},
  {name:'Tríceps francês', muscle:'triceps', target:'10 a 12'},
  {name:'Mergulho no banco', muscle:'triceps', target:'10 a 15'},
  {name:'Tríceps coice', muscle:'triceps', target:'12 a 15'},
  {name:'Supino fechado', muscle:'triceps', target:'8 a 12'},
  // Antebraço
  {name:'Rosca de punho', muscle:'forearms', target:'15 a 20'},
  {name:'Rosca inversa', muscle:'forearms', target:'12 a 15'},
  {name:"Farmer's walk", muscle:'forearms', target:'20 a 30'},
  // Abdômen
  {name:'Abdominal supra', muscle:'abs', target:'15 a 20'},
  {name:'Abdominal infra', muscle:'abs', target:'15 a 20'},
  {name:'Prancha', muscle:'abs', target:'max'},
  {name:'Abdominal oblíquo', muscle:'abs', target:'15 a 20'},
  {name:'Elevação de pernas', muscle:'abs', target:'12 a 15'},
  {name:'Abdominal na polia', muscle:'abs', target:'12 a 15'},
  // Quadríceps
  {name:'Agachamento livre', muscle:'quads', target:'8 a 12'},
  {name:'Leg press', muscle:'quads', target:'10 a 15'},
  {name:'Cadeira extensora', muscle:'quads', target:'12 a 15'},
  {name:'Agachamento hack', muscle:'quads', target:'10 a 12'},
  {name:'Afundo', muscle:'quads', target:'10 a 12'},
  {name:'Agachamento búlgaro', muscle:'quads', target:'10 a 12'},
  // Posterior de coxa
  {name:'Mesa flexora', muscle:'hamstrings', target:'10 a 15'},
  {name:'Cadeira flexora', muscle:'hamstrings', target:'10 a 15'},
  {name:'Stiff', muscle:'hamstrings', target:'8 a 12'},
  {name:'Levantamento terra romeno', muscle:'hamstrings', target:'8 a 12'},
  {name:'Flexora em pé', muscle:'hamstrings', target:'12 a 15'},
  // Glúteos
  {name:'Elevação pélvica (hip thrust)', muscle:'glutes', target:'10 a 15'},
  {name:'Cadeira abdutora', muscle:'glutes', target:'15 a 20'},
  {name:'Glúteo no cabo (coice)', muscle:'glutes', target:'12 a 15'},
  {name:'Agachamento sumô', muscle:'glutes', target:'10 a 12'},
  // Panturrilha
  {name:'Panturrilha em pé', muscle:'calves', target:'15 a 20'},
  {name:'Panturrilha sentado', muscle:'calves', target:'15 a 20'},
  {name:'Panturrilha no leg press', muscle:'calves', target:'15 a 20'},
  // Trapézio
  {name:'Encolhimento com halteres', muscle:'traps', target:'12 a 15'},
  {name:'Encolhimento com barra', muscle:'traps', target:'12 a 15'},
  {name:'Face pull', muscle:'traps', target:'12 a 15'}
];

function muscleMapSvg(view){
  const isBack = view==='back';
  const lineArtD = isBack ? BACK_LINEART_D : FRONT_LINEART_D;
  const hotspots = isBack ? BACK_HOTSPOTS_SVG : FRONT_HOTSPOTS_SVG;
  const w = isBack ? 560 : 570;
  return `<svg viewBox="0 0 ${w} 870" class="muscle-svg" data-view="${view}">
    <path class="body-lineart" fill-rule="evenodd" d="${lineArtD}"/>
    <g class="body-hotspots">${hotspots}</g>
  </svg>`;
}
const FRONT_LINEART_D = `M 249.00,0.00 L 249.00,3.00 L 250.00,4.00 L 250.00,31.00 L 249.00,32.00 L 249.00,35.00 L 243.00,41.00 L 242.00,41.00 L 240.00,43.00 L 239.00,43.00 L 238.00,44.00 L 237.00,44.00 L 236.00,45.00 L 235.00,45.00 L 234.00,46.00 L 233.00,46.00 L 232.00,47.00 L 230.00,47.00 L 229.00,48.00 L 228.00,48.00 L 227.00,49.00 L 226.00,49.00 L 225.00,50.00 L 224.00,50.00 L 223.00,51.00 L 222.00,51.00 L 221.00,52.00 L 219.00,52.00 L 218.00,53.00 L 217.00,53.00 L 216.00,54.00 L 215.00,54.00 L 214.00,55.00 L 213.00,55.00 L 211.00,57.00 L 210.00,57.00 L 207.00,60.00 L 206.00,60.00 L 203.00,63.00 L 200.00,63.00 L 199.00,64.00 L 196.00,64.00 L 195.00,65.00 L 193.00,65.00 L 192.00,66.00 L 188.00,66.00 L 187.00,67.00 L 184.00,67.00 L 183.00,68.00 L 181.00,68.00 L 180.00,69.00 L 178.00,69.00 L 177.00,70.00 L 176.00,70.00 L 175.00,71.00 L 174.00,71.00 L 173.00,72.00 L 172.00,72.00 L 170.00,74.00 L 169.00,74.00 L 166.00,77.00 L 165.00,77.00 L 160.00,82.00 L 160.00,83.00 L 157.00,86.00 L 157.00,87.00 L 155.00,89.00 L 155.00,90.00 L 154.00,91.00 L 154.00,92.00 L 153.00,93.00 L 153.00,94.00 L 152.00,95.00 L 152.00,96.00 L 151.00,97.00 L 151.00,99.00 L 150.00,100.00 L 150.00,101.00 L 149.00,102.00 L 149.00,105.00 L 148.00,106.00 L 148.00,107.00 L 147.00,108.00 L 147.00,110.00 L 146.00,111.00 L 146.00,113.00 L 145.00,114.00 L 145.00,116.00 L 144.00,117.00 L 144.00,119.00 L 143.00,120.00 L 143.00,122.00 L 142.00,123.00 L 142.00,125.00 L 141.00,126.00 L 141.00,129.00 L 140.00,130.00 L 140.00,132.00 L 139.00,133.00 L 139.00,136.00 L 138.00,137.00 L 138.00,138.00 L 136.00,140.00 L 136.00,141.00 L 132.00,145.00 L 132.00,146.00 L 130.00,148.00 L 130.00,149.00 L 128.00,151.00 L 128.00,152.00 L 126.00,154.00 L 126.00,155.00 L 125.00,156.00 L 125.00,157.00 L 124.00,158.00 L 124.00,159.00 L 122.00,161.00 L 122.00,162.00 L 121.00,163.00 L 121.00,165.00 L 120.00,166.00 L 120.00,167.00 L 119.00,168.00 L 119.00,169.00 L 118.00,170.00 L 118.00,171.00 L 117.00,172.00 L 117.00,173.00 L 116.00,174.00 L 116.00,175.00 L 115.00,176.00 L 115.00,178.00 L 114.00,179.00 L 114.00,180.00 L 113.00,181.00 L 113.00,182.00 L 112.00,183.00 L 112.00,184.00 L 111.00,185.00 L 111.00,187.00 L 110.00,188.00 L 110.00,189.00 L 109.00,190.00 L 109.00,191.00 L 108.00,192.00 L 108.00,193.00 L 106.00,195.00 L 106.00,196.00 L 99.00,203.00 L 99.00,204.00 L 91.00,212.00 L 91.00,213.00 L 86.00,218.00 L 86.00,219.00 L 84.00,221.00 L 84.00,222.00 L 82.00,224.00 L 82.00,225.00 L 80.00,227.00 L 80.00,228.00 L 79.00,229.00 L 79.00,230.00 L 78.00,231.00 L 78.00,232.00 L 77.00,233.00 L 77.00,234.00 L 75.00,236.00 L 75.00,237.00 L 74.00,238.00 L 74.00,240.00 L 73.00,241.00 L 73.00,242.00 L 72.00,243.00 L 72.00,244.00 L 71.00,245.00 L 71.00,246.00 L 70.00,247.00 L 70.00,248.00 L 69.00,249.00 L 69.00,250.00 L 68.00,251.00 L 68.00,253.00 L 67.00,254.00 L 67.00,255.00 L 66.00,256.00 L 66.00,258.00 L 65.00,259.00 L 65.00,260.00 L 64.00,261.00 L 64.00,262.00 L 63.00,263.00 L 63.00,265.00 L 62.00,266.00 L 62.00,267.00 L 61.00,268.00 L 61.00,270.00 L 60.00,271.00 L 60.00,272.00 L 59.00,273.00 L 59.00,275.00 L 58.00,276.00 L 58.00,277.00 L 57.00,278.00 L 57.00,280.00 L 56.00,281.00 L 56.00,282.00 L 55.00,283.00 L 55.00,285.00 L 54.00,286.00 L 54.00,287.00 L 53.00,288.00 L 53.00,290.00 L 52.00,291.00 L 52.00,292.00 L 51.00,293.00 L 51.00,295.00 L 50.00,296.00 L 50.00,297.00 L 49.00,298.00 L 49.00,300.00 L 48.00,301.00 L 48.00,302.00 L 47.00,303.00 L 47.00,304.00 L 46.00,305.00 L 46.00,306.00 L 45.00,307.00 L 45.00,308.00 L 44.00,309.00 L 44.00,311.00 L 43.00,312.00 L 43.00,313.00 L 42.00,314.00 L 42.00,316.00 L 41.00,317.00 L 41.00,319.00 L 40.00,320.00 L 40.00,322.00 L 39.00,323.00 L 39.00,325.00 L 38.00,326.00 L 38.00,328.00 L 37.00,329.00 L 37.00,331.00 L 36.00,332.00 L 36.00,334.00 L 35.00,335.00 L 35.00,336.00 L 34.00,337.00 L 34.00,339.00 L 33.00,340.00 L 33.00,341.00 L 32.00,342.00 L 32.00,343.00 L 31.00,344.00 L 31.00,345.00 L 30.00,346.00 L 30.00,347.00 L 29.00,348.00 L 29.00,349.00 L 28.00,350.00 L 28.00,351.00 L 27.00,352.00 L 27.00,354.00 L 26.00,355.00 L 26.00,357.00 L 25.00,358.00 L 25.00,368.00 L 24.00,369.00 L 24.00,381.00 L 23.00,382.00 L 23.00,386.00 L 24.00,387.00 L 24.00,393.00 L 25.00,394.00 L 25.00,397.00 L 26.00,398.00 L 26.00,400.00 L 27.00,401.00 L 27.00,404.00 L 28.00,405.00 L 31.00,405.00 L 32.00,404.00 L 33.00,404.00 L 35.00,402.00 L 35.00,401.00 L 37.00,399.00 L 38.00,399.00 L 39.00,398.00 L 40.00,398.00 L 41.00,397.00 L 41.00,396.00 L 42.00,395.00 L 42.00,391.00 L 41.00,390.00 L 41.00,384.00 L 42.00,383.00 L 42.00,374.00 L 43.00,373.00 L 43.00,372.00 L 44.00,371.00 L 44.00,369.00 L 45.00,368.00 L 45.00,363.00 L 46.00,362.00 L 48.00,364.00 L 48.00,370.00 L 49.00,371.00 L 49.00,373.00 L 50.00,374.00 L 50.00,375.00 L 51.00,376.00 L 52.00,376.00 L 53.00,377.00 L 57.00,377.00 L 60.00,374.00 L 60.00,373.00 L 61.00,372.00 L 61.00,368.00 L 62.00,367.00 L 62.00,354.00 L 63.00,353.00 L 63.00,349.00 L 64.00,348.00 L 64.00,346.00 L 65.00,345.00 L 65.00,344.00 L 66.00,343.00 L 66.00,342.00 L 68.00,340.00 L 68.00,337.00 L 69.00,336.00 L 69.00,332.00 L 68.00,331.00 L 68.00,329.00 L 67.00,328.00 L 67.00,327.00 L 66.00,326.00 L 66.00,325.00 L 67.00,324.00 L 67.00,323.00 L 68.00,322.00 L 68.00,321.00 L 69.00,320.00 L 69.00,319.00 L 70.00,318.00 L 70.00,317.00 L 72.00,315.00 L 72.00,314.00 L 81.00,305.00 L 82.00,305.00 L 87.00,300.00 L 88.00,300.00 L 92.00,296.00 L 93.00,296.00 L 100.00,289.00 L 101.00,289.00 L 103.00,287.00 L 103.00,286.00 L 111.00,278.00 L 111.00,277.00 L 114.00,274.00 L 114.00,273.00 L 117.00,270.00 L 117.00,269.00 L 119.00,267.00 L 119.00,266.00 L 121.00,264.00 L 121.00,263.00 L 122.00,262.00 L 122.00,261.00 L 124.00,259.00 L 124.00,258.00 L 125.00,257.00 L 125.00,256.00 L 126.00,255.00 L 126.00,254.00 L 127.00,253.00 L 127.00,252.00 L 128.00,251.00 L 128.00,250.00 L 129.00,249.00 L 129.00,248.00 L 130.00,247.00 L 130.00,246.00 L 131.00,245.00 L 131.00,244.00 L 132.00,243.00 L 132.00,242.00 L 133.00,241.00 L 133.00,240.00 L 135.00,238.00 L 135.00,237.00 L 136.00,236.00 L 136.00,235.00 L 138.00,233.00 L 138.00,232.00 L 141.00,229.00 L 141.00,228.00 L 143.00,226.00 L 143.00,225.00 L 146.00,222.00 L 146.00,221.00 L 149.00,218.00 L 149.00,217.00 L 152.00,214.00 L 152.00,213.00 L 155.00,210.00 L 155.00,209.00 L 157.00,207.00 L 157.00,206.00 L 160.00,203.00 L 160.00,202.00 L 163.00,199.00 L 163.00,198.00 L 167.00,194.00 L 167.00,193.00 L 178.00,182.00 L 178.00,181.00 L 181.00,178.00 L 181.00,177.00 L 183.00,175.00 L 184.00,176.00 L 184.00,178.00 L 185.00,179.00 L 185.00,181.00 L 186.00,182.00 L 186.00,184.00 L 187.00,185.00 L 187.00,187.00 L 188.00,188.00 L 188.00,190.00 L 189.00,191.00 L 189.00,193.00 L 190.00,194.00 L 190.00,196.00 L 191.00,197.00 L 191.00,199.00 L 192.00,200.00 L 192.00,201.00 L 193.00,202.00 L 193.00,204.00 L 194.00,205.00 L 194.00,206.00 L 195.00,207.00 L 195.00,208.00 L 196.00,209.00 L 196.00,211.00 L 197.00,212.00 L 197.00,213.00 L 198.00,214.00 L 198.00,215.00 L 199.00,216.00 L 199.00,217.00 L 200.00,218.00 L 200.00,219.00 L 201.00,220.00 L 201.00,221.00 L 202.00,222.00 L 202.00,223.00 L 203.00,224.00 L 203.00,225.00 L 204.00,226.00 L 204.00,228.00 L 205.00,229.00 L 205.00,230.00 L 206.00,231.00 L 206.00,234.00 L 207.00,235.00 L 207.00,239.00 L 208.00,240.00 L 208.00,261.00 L 207.00,262.00 L 207.00,270.00 L 206.00,271.00 L 206.00,278.00 L 205.00,279.00 L 205.00,288.00 L 204.00,289.00 L 204.00,297.00 L 203.00,298.00 L 203.00,304.00 L 202.00,305.00 L 202.00,313.00 L 201.00,314.00 L 201.00,321.00 L 200.00,322.00 L 200.00,328.00 L 199.00,329.00 L 199.00,335.00 L 198.00,336.00 L 198.00,341.00 L 197.00,342.00 L 197.00,346.00 L 196.00,347.00 L 196.00,350.00 L 195.00,351.00 L 195.00,354.00 L 194.00,355.00 L 194.00,358.00 L 193.00,359.00 L 193.00,363.00 L 192.00,364.00 L 192.00,367.00 L 191.00,368.00 L 191.00,372.00 L 190.00,373.00 L 190.00,377.00 L 189.00,378.00 L 189.00,382.00 L 188.00,383.00 L 188.00,387.00 L 187.00,388.00 L 187.00,393.00 L 186.00,394.00 L 186.00,400.00 L 185.00,401.00 L 185.00,406.00 L 184.00,407.00 L 184.00,415.00 L 183.00,416.00 L 183.00,425.00 L 182.00,426.00 L 182.00,438.00 L 181.00,439.00 L 181.00,488.00 L 182.00,489.00 L 182.00,498.00 L 183.00,499.00 L 183.00,508.00 L 184.00,509.00 L 184.00,516.00 L 185.00,517.00 L 185.00,521.00 L 186.00,522.00 L 186.00,526.00 L 187.00,527.00 L 187.00,531.00 L 188.00,532.00 L 188.00,535.00 L 189.00,536.00 L 189.00,539.00 L 190.00,540.00 L 190.00,543.00 L 191.00,544.00 L 191.00,559.00 L 190.00,560.00 L 190.00,566.00 L 189.00,567.00 L 189.00,570.00 L 188.00,571.00 L 188.00,580.00 L 187.00,581.00 L 187.00,587.00 L 186.00,588.00 L 186.00,591.00 L 185.00,592.00 L 185.00,594.00 L 184.00,595.00 L 184.00,597.00 L 183.00,598.00 L 183.00,600.00 L 182.00,601.00 L 182.00,604.00 L 181.00,605.00 L 181.00,608.00 L 180.00,609.00 L 180.00,612.00 L 179.00,613.00 L 179.00,617.00 L 178.00,618.00 L 178.00,623.00 L 177.00,624.00 L 177.00,630.00 L 176.00,631.00 L 176.00,641.00 L 175.00,642.00 L 175.00,667.00 L 176.00,668.00 L 176.00,679.00 L 177.00,680.00 L 177.00,687.00 L 178.00,688.00 L 178.00,694.00 L 179.00,695.00 L 179.00,703.00 L 180.00,704.00 L 180.00,712.00 L 181.00,713.00 L 181.00,721.00 L 182.00,722.00 L 182.00,732.00 L 183.00,733.00 L 183.00,758.00 L 182.00,759.00 L 182.00,764.00 L 181.00,765.00 L 181.00,773.00 L 180.00,774.00 L 180.00,775.00 L 179.00,776.00 L 179.00,777.00 L 178.00,778.00 L 178.00,779.00 L 177.00,780.00 L 177.00,781.00 L 175.00,783.00 L 175.00,784.00 L 174.00,785.00 L 174.00,786.00 L 172.00,788.00 L 172.00,789.00 L 171.00,790.00 L 171.00,791.00 L 169.00,793.00 L 169.00,794.00 L 168.00,795.00 L 168.00,796.00 L 167.00,797.00 L 167.00,798.00 L 158.00,807.00 L 157.00,807.00 L 150.00,814.00 L 150.00,815.00 L 147.00,818.00 L 147.00,819.00 L 146.00,820.00 L 146.00,821.00 L 145.00,822.00 L 145.00,824.00 L 144.00,825.00 L 144.00,828.00 L 145.00,829.00 L 145.00,830.00 L 146.00,831.00 L 147.00,831.00 L 149.00,833.00 L 149.00,834.00 L 150.00,835.00 L 151.00,835.00 L 153.00,837.00 L 153.00,838.00 L 154.00,838.00 L 155.00,839.00 L 158.00,839.00 L 160.00,841.00 L 161.00,841.00 L 162.00,842.00 L 164.00,842.00 L 165.00,841.00 L 168.00,841.00 L 169.00,842.00 L 170.00,842.00 L 171.00,843.00 L 173.00,843.00 L 174.00,844.00 L 176.00,844.00 L 177.00,843.00 L 179.00,843.00 L 180.00,842.00 L 181.00,842.00 L 186.00,837.00 L 186.00,836.00 L 188.00,834.00 L 189.00,834.00 L 190.00,833.00 L 191.00,833.00 L 193.00,831.00 L 194.00,831.00 L 196.00,829.00 L 196.00,828.00 L 198.00,826.00 L 198.00,824.00 L 199.00,823.00 L 199.00,818.00 L 200.00,817.00 L 200.00,816.00 L 203.00,813.00 L 204.00,813.00 L 206.00,811.00 L 207.00,811.00 L 209.00,809.00 L 210.00,809.00 L 213.00,806.00 L 213.00,805.00 L 214.00,804.00 L 214.00,788.00 L 213.00,787.00 L 213.00,777.00 L 215.00,775.00 L 215.00,773.00 L 216.00,772.00 L 216.00,767.00 L 217.00,766.00 L 217.00,764.00 L 216.00,763.00 L 216.00,738.00 L 217.00,737.00 L 217.00,731.00 L 218.00,730.00 L 218.00,725.00 L 219.00,724.00 L 219.00,721.00 L 220.00,720.00 L 220.00,716.00 L 221.00,715.00 L 221.00,712.00 L 222.00,711.00 L 222.00,708.00 L 223.00,707.00 L 223.00,705.00 L 224.00,704.00 L 224.00,701.00 L 225.00,700.00 L 225.00,697.00 L 226.00,696.00 L 226.00,694.00 L 227.00,693.00 L 227.00,690.00 L 228.00,689.00 L 228.00,687.00 L 229.00,686.00 L 229.00,684.00 L 230.00,683.00 L 230.00,681.00 L 231.00,680.00 L 231.00,679.00 L 232.00,678.00 L 232.00,677.00 L 233.00,676.00 L 233.00,675.00 L 234.00,674.00 L 234.00,673.00 L 236.00,671.00 L 236.00,668.00 L 237.00,667.00 L 237.00,663.00 L 238.00,662.00 L 238.00,651.00 L 237.00,650.00 L 237.00,639.00 L 236.00,638.00 L 236.00,631.00 L 235.00,630.00 L 235.00,622.00 L 234.00,621.00 L 234.00,611.00 L 233.00,610.00 L 233.00,603.00 L 234.00,602.00 L 234.00,600.00 L 235.00,599.00 L 235.00,598.00 L 236.00,597.00 L 236.00,596.00 L 237.00,595.00 L 237.00,594.00 L 239.00,592.00 L 239.00,590.00 L 241.00,588.00 L 241.00,587.00 L 242.00,586.00 L 242.00,585.00 L 243.00,584.00 L 243.00,583.00 L 244.00,582.00 L 244.00,581.00 L 245.00,580.00 L 245.00,579.00 L 246.00,578.00 L 246.00,577.00 L 247.00,576.00 L 247.00,575.00 L 248.00,574.00 L 248.00,572.00 L 249.00,571.00 L 249.00,569.00 L 250.00,568.00 L 250.00,564.00 L 251.00,563.00 L 251.00,560.00 L 252.00,559.00 L 252.00,552.00 L 253.00,551.00 L 253.00,542.00 L 254.00,541.00 L 254.00,535.00 L 255.00,534.00 L 255.00,527.00 L 256.00,526.00 L 256.00,521.00 L 257.00,520.00 L 257.00,516.00 L 258.00,515.00 L 258.00,511.00 L 259.00,510.00 L 259.00,507.00 L 260.00,506.00 L 260.00,503.00 L 261.00,502.00 L 261.00,499.00 L 262.00,498.00 L 262.00,495.00 L 263.00,494.00 L 263.00,492.00 L 264.00,491.00 L 264.00,489.00 L 265.00,488.00 L 265.00,486.00 L 266.00,485.00 L 266.00,483.00 L 267.00,482.00 L 267.00,480.00 L 268.00,479.00 L 268.00,477.00 L 269.00,476.00 L 269.00,474.00 L 270.00,473.00 L 270.00,471.00 L 271.00,470.00 L 271.00,468.00 L 272.00,467.00 L 272.00,465.00 L 273.00,464.00 L 273.00,462.00 L 274.00,461.00 L 274.00,459.00 L 275.00,458.00 L 275.00,455.00 L 276.00,454.00 L 276.00,452.00 L 277.00,451.00 L 277.00,448.00 L 278.00,447.00 L 278.00,444.00 L 279.00,443.00 L 279.00,439.00 L 280.00,438.00 L 280.00,434.00 L 281.00,433.00 L 281.00,426.00 L 282.00,425.00 L 282.00,417.00 L 283.00,416.00 L 284.00,417.00 L 284.00,431.00 L 285.00,432.00 L 285.00,437.00 L 286.00,438.00 L 286.00,442.00 L 287.00,443.00 L 287.00,446.00 L 288.00,447.00 L 288.00,450.00 L 289.00,451.00 L 289.00,453.00 L 290.00,454.00 L 290.00,457.00 L 291.00,458.00 L 291.00,460.00 L 292.00,461.00 L 292.00,463.00 L 293.00,464.00 L 293.00,466.00 L 294.00,467.00 L 294.00,469.00 L 295.00,470.00 L 295.00,472.00 L 296.00,473.00 L 296.00,475.00 L 297.00,476.00 L 297.00,478.00 L 298.00,479.00 L 298.00,481.00 L 299.00,482.00 L 299.00,484.00 L 300.00,485.00 L 300.00,487.00 L 301.00,488.00 L 301.00,490.00 L 302.00,491.00 L 302.00,493.00 L 303.00,494.00 L 303.00,497.00 L 304.00,498.00 L 304.00,501.00 L 305.00,502.00 L 305.00,505.00 L 306.00,506.00 L 306.00,509.00 L 307.00,510.00 L 307.00,514.00 L 308.00,515.00 L 308.00,519.00 L 309.00,520.00 L 309.00,525.00 L 310.00,526.00 L 310.00,531.00 L 311.00,532.00 L 311.00,539.00 L 312.00,540.00 L 312.00,548.00 L 313.00,549.00 L 313.00,557.00 L 314.00,558.00 L 314.00,562.00 L 315.00,563.00 L 315.00,567.00 L 316.00,568.00 L 316.00,570.00 L 317.00,571.00 L 317.00,573.00 L 318.00,574.00 L 318.00,575.00 L 319.00,576.00 L 319.00,578.00 L 320.00,579.00 L 320.00,580.00 L 321.00,581.00 L 321.00,582.00 L 322.00,583.00 L 322.00,584.00 L 324.00,586.00 L 324.00,587.00 L 325.00,588.00 L 325.00,589.00 L 326.00,590.00 L 326.00,591.00 L 327.00,592.00 L 327.00,593.00 L 328.00,594.00 L 328.00,595.00 L 330.00,597.00 L 330.00,598.00 L 331.00,599.00 L 331.00,601.00 L 332.00,602.00 L 332.00,613.00 L 331.00,614.00 L 331.00,623.00 L 330.00,624.00 L 330.00,632.00 L 329.00,633.00 L 329.00,641.00 L 328.00,642.00 L 328.00,666.00 L 329.00,667.00 L 329.00,670.00 L 330.00,671.00 L 330.00,672.00 L 331.00,673.00 L 331.00,674.00 L 333.00,676.00 L 333.00,677.00 L 334.00,678.00 L 334.00,679.00 L 335.00,680.00 L 335.00,682.00 L 336.00,683.00 L 336.00,685.00 L 337.00,686.00 L 337.00,688.00 L 338.00,689.00 L 338.00,692.00 L 339.00,693.00 L 339.00,695.00 L 340.00,696.00 L 340.00,699.00 L 341.00,700.00 L 341.00,703.00 L 342.00,704.00 L 342.00,706.00 L 343.00,707.00 L 343.00,710.00 L 344.00,711.00 L 344.00,714.00 L 345.00,715.00 L 345.00,719.00 L 346.00,720.00 L 346.00,723.00 L 347.00,724.00 L 347.00,728.00 L 348.00,729.00 L 348.00,734.00 L 349.00,735.00 L 349.00,772.00 L 350.00,773.00 L 350.00,774.00 L 352.00,776.00 L 352.00,789.00 L 351.00,790.00 L 351.00,803.00 L 352.00,804.00 L 352.00,805.00 L 354.00,807.00 L 354.00,808.00 L 355.00,809.00 L 356.00,809.00 L 358.00,811.00 L 359.00,811.00 L 360.00,812.00 L 361.00,812.00 L 366.00,817.00 L 366.00,822.00 L 367.00,823.00 L 367.00,825.00 L 368.00,826.00 L 368.00,827.00 L 373.00,832.00 L 374.00,832.00 L 375.00,833.00 L 376.00,833.00 L 380.00,837.00 L 380.00,838.00 L 383.00,841.00 L 384.00,841.00 L 386.00,843.00 L 389.00,843.00 L 390.00,844.00 L 391.00,844.00 L 392.00,843.00 L 394.00,843.00 L 395.00,842.00 L 396.00,842.00 L 397.00,841.00 L 400.00,841.00 L 401.00,842.00 L 403.00,842.00 L 404.00,841.00 L 405.00,841.00 L 406.00,840.00 L 407.00,840.00 L 408.00,839.00 L 411.00,839.00 L 413.00,837.00 L 413.00,836.00 L 414.00,835.00 L 415.00,835.00 L 417.00,833.00 L 417.00,832.00 L 418.00,831.00 L 419.00,831.00 L 421.00,829.00 L 421.00,824.00 L 420.00,823.00 L 420.00,821.00 L 419.00,820.00 L 419.00,819.00 L 417.00,817.00 L 417.00,816.00 L 406.00,805.00 L 405.00,805.00 L 399.00,799.00 L 399.00,798.00 L 398.00,797.00 L 398.00,796.00 L 397.00,795.00 L 397.00,794.00 L 395.00,792.00 L 395.00,791.00 L 394.00,790.00 L 394.00,789.00 L 392.00,787.00 L 392.00,786.00 L 391.00,785.00 L 391.00,784.00 L 389.00,782.00 L 389.00,781.00 L 388.00,780.00 L 388.00,779.00 L 387.00,778.00 L 387.00,777.00 L 385.00,775.00 L 385.00,772.00 L 384.00,771.00 L 384.00,763.00 L 383.00,762.00 L 383.00,757.00 L 382.00,756.00 L 382.00,736.00 L 383.00,735.00 L 383.00,725.00 L 384.00,724.00 L 384.00,715.00 L 385.00,714.00 L 385.00,707.00 L 386.00,706.00 L 386.00,697.00 L 387.00,696.00 L 387.00,690.00 L 388.00,689.00 L 388.00,683.00 L 389.00,682.00 L 389.00,672.00 L 390.00,671.00 L 390.00,639.00 L 389.00,638.00 L 389.00,629.00 L 388.00,628.00 L 388.00,623.00 L 387.00,622.00 L 387.00,617.00 L 386.00,616.00 L 386.00,612.00 L 385.00,611.00 L 385.00,608.00 L 384.00,607.00 L 384.00,604.00 L 383.00,603.00 L 383.00,600.00 L 382.00,599.00 L 382.00,597.00 L 381.00,596.00 L 381.00,594.00 L 380.00,593.00 L 380.00,591.00 L 379.00,590.00 L 379.00,587.00 L 378.00,586.00 L 378.00,576.00 L 377.00,575.00 L 377.00,570.00 L 376.00,569.00 L 376.00,566.00 L 375.00,565.00 L 375.00,556.00 L 374.00,555.00 L 374.00,545.00 L 375.00,544.00 L 375.00,541.00 L 376.00,540.00 L 376.00,537.00 L 377.00,536.00 L 377.00,533.00 L 378.00,532.00 L 378.00,529.00 L 379.00,528.00 L 379.00,524.00 L 380.00,523.00 L 380.00,518.00 L 381.00,517.00 L 381.00,510.00 L 382.00,509.00 L 382.00,502.00 L 383.00,501.00 L 383.00,492.00 L 384.00,491.00 L 384.00,471.00 L 385.00,470.00 L 385.00,456.00 L 384.00,455.00 L 384.00,435.00 L 383.00,434.00 L 383.00,422.00 L 382.00,421.00 L 382.00,414.00 L 381.00,413.00 L 381.00,405.00 L 380.00,404.00 L 380.00,399.00 L 379.00,398.00 L 379.00,393.00 L 378.00,392.00 L 378.00,387.00 L 377.00,386.00 L 377.00,381.00 L 376.00,380.00 L 376.00,376.00 L 375.00,375.00 L 375.00,371.00 L 374.00,370.00 L 374.00,367.00 L 373.00,366.00 L 373.00,362.00 L 372.00,361.00 L 372.00,358.00 L 371.00,357.00 L 371.00,354.00 L 370.00,353.00 L 370.00,350.00 L 369.00,349.00 L 369.00,345.00 L 368.00,344.00 L 368.00,340.00 L 367.00,339.00 L 367.00,334.00 L 366.00,333.00 L 366.00,327.00 L 365.00,326.00 L 365.00,320.00 L 364.00,319.00 L 364.00,312.00 L 363.00,311.00 L 363.00,304.00 L 362.00,303.00 L 362.00,296.00 L 361.00,295.00 L 361.00,286.00 L 360.00,285.00 L 360.00,276.00 L 359.00,275.00 L 359.00,268.00 L 358.00,267.00 L 358.00,259.00 L 357.00,258.00 L 357.00,241.00 L 358.00,240.00 L 358.00,236.00 L 359.00,235.00 L 359.00,232.00 L 360.00,231.00 L 360.00,229.00 L 361.00,228.00 L 361.00,227.00 L 362.00,226.00 L 362.00,225.00 L 363.00,224.00 L 363.00,223.00 L 364.00,222.00 L 364.00,221.00 L 365.00,220.00 L 365.00,219.00 L 366.00,218.00 L 366.00,217.00 L 367.00,216.00 L 367.00,214.00 L 368.00,213.00 L 368.00,212.00 L 369.00,211.00 L 369.00,210.00 L 370.00,209.00 L 370.00,208.00 L 371.00,207.00 L 371.00,205.00 L 372.00,204.00 L 372.00,203.00 L 373.00,202.00 L 373.00,200.00 L 374.00,199.00 L 374.00,198.00 L 375.00,197.00 L 375.00,195.00 L 376.00,194.00 L 376.00,192.00 L 377.00,191.00 L 377.00,189.00 L 378.00,188.00 L 378.00,186.00 L 379.00,185.00 L 379.00,183.00 L 380.00,182.00 L 380.00,180.00 L 381.00,179.00 L 381.00,176.00 L 382.00,175.00 L 385.00,178.00 L 385.00,179.00 L 396.00,190.00 L 396.00,191.00 L 400.00,195.00 L 400.00,196.00 L 403.00,199.00 L 403.00,200.00 L 406.00,203.00 L 406.00,204.00 L 409.00,207.00 L 409.00,208.00 L 411.00,210.00 L 411.00,211.00 L 414.00,214.00 L 414.00,215.00 L 417.00,218.00 L 417.00,219.00 L 420.00,222.00 L 420.00,223.00 L 423.00,226.00 L 423.00,227.00 L 425.00,229.00 L 425.00,230.00 L 428.00,233.00 L 428.00,234.00 L 430.00,236.00 L 430.00,237.00 L 431.00,238.00 L 431.00,239.00 L 432.00,240.00 L 432.00,241.00 L 433.00,242.00 L 433.00,243.00 L 434.00,244.00 L 434.00,245.00 L 435.00,246.00 L 435.00,247.00 L 436.00,248.00 L 436.00,249.00 L 437.00,250.00 L 437.00,251.00 L 438.00,252.00 L 438.00,253.00 L 439.00,254.00 L 439.00,255.00 L 441.00,257.00 L 441.00,258.00 L 442.00,259.00 L 442.00,260.00 L 443.00,261.00 L 443.00,262.00 L 445.00,264.00 L 445.00,265.00 L 447.00,267.00 L 447.00,268.00 L 449.00,270.00 L 449.00,271.00 L 452.00,274.00 L 452.00,275.00 L 456.00,279.00 L 456.00,280.00 L 471.00,295.00 L 472.00,295.00 L 476.00,299.00 L 477.00,299.00 L 481.00,303.00 L 482.00,303.00 L 493.00,314.00 L 493.00,315.00 L 495.00,317.00 L 495.00,318.00 L 497.00,320.00 L 497.00,321.00 L 498.00,322.00 L 498.00,323.00 L 499.00,324.00 L 499.00,327.00 L 498.00,328.00 L 498.00,329.00 L 497.00,330.00 L 497.00,333.00 L 496.00,334.00 L 496.00,335.00 L 497.00,336.00 L 497.00,339.00 L 498.00,340.00 L 498.00,341.00 L 499.00,342.00 L 499.00,343.00 L 501.00,345.00 L 501.00,347.00 L 502.00,348.00 L 502.00,351.00 L 503.00,352.00 L 503.00,363.00 L 504.00,364.00 L 504.00,371.00 L 505.00,372.00 L 505.00,374.00 L 507.00,376.00 L 508.00,376.00 L 509.00,377.00 L 512.00,377.00 L 513.00,376.00 L 514.00,376.00 L 516.00,374.00 L 516.00,372.00 L 517.00,371.00 L 517.00,367.00 L 518.00,366.00 L 518.00,359.00 L 519.00,358.00 L 520.00,359.00 L 520.00,367.00 L 521.00,368.00 L 521.00,370.00 L 522.00,371.00 L 522.00,373.00 L 523.00,374.00 L 523.00,379.00 L 524.00,380.00 L 524.00,396.00 L 525.00,397.00 L 525.00,398.00 L 526.00,398.00 L 527.00,399.00 L 529.00,399.00 L 530.00,400.00 L 530.00,402.00 L 532.00,404.00 L 533.00,404.00 L 534.00,405.00 L 537.00,405.00 L 538.00,404.00 L 538.00,402.00 L 539.00,401.00 L 539.00,399.00 L 540.00,398.00 L 540.00,395.00 L 541.00,394.00 L 541.00,390.00 L 542.00,389.00 L 542.00,377.00 L 541.00,376.00 L 541.00,367.00 L 540.00,366.00 L 540.00,357.00 L 539.00,356.00 L 539.00,354.00 L 538.00,353.00 L 538.00,352.00 L 537.00,351.00 L 537.00,350.00 L 536.00,349.00 L 536.00,348.00 L 535.00,347.00 L 535.00,346.00 L 534.00,345.00 L 534.00,344.00 L 533.00,343.00 L 533.00,341.00 L 532.00,340.00 L 532.00,339.00 L 531.00,338.00 L 531.00,337.00 L 530.00,336.00 L 530.00,334.00 L 529.00,333.00 L 529.00,331.00 L 528.00,330.00 L 528.00,329.00 L 527.00,328.00 L 527.00,325.00 L 526.00,324.00 L 526.00,322.00 L 525.00,321.00 L 525.00,319.00 L 524.00,318.00 L 524.00,316.00 L 523.00,315.00 L 523.00,314.00 L 522.00,313.00 L 522.00,311.00 L 521.00,310.00 L 521.00,308.00 L 520.00,307.00 L 520.00,306.00 L 519.00,305.00 L 519.00,304.00 L 518.00,303.00 L 518.00,302.00 L 517.00,301.00 L 517.00,300.00 L 516.00,299.00 L 516.00,297.00 L 515.00,296.00 L 515.00,295.00 L 514.00,294.00 L 514.00,293.00 L 513.00,292.00 L 513.00,290.00 L 512.00,289.00 L 512.00,288.00 L 511.00,287.00 L 511.00,285.00 L 510.00,284.00 L 510.00,283.00 L 509.00,282.00 L 509.00,280.00 L 508.00,279.00 L 508.00,278.00 L 507.00,277.00 L 507.00,275.00 L 506.00,274.00 L 506.00,273.00 L 505.00,272.00 L 505.00,270.00 L 504.00,269.00 L 504.00,268.00 L 503.00,267.00 L 503.00,265.00 L 502.00,264.00 L 502.00,263.00 L 501.00,262.00 L 501.00,260.00 L 500.00,259.00 L 500.00,258.00 L 499.00,257.00 L 499.00,256.00 L 498.00,255.00 L 498.00,253.00 L 497.00,252.00 L 497.00,251.00 L 496.00,250.00 L 496.00,249.00 L 495.00,248.00 L 495.00,246.00 L 494.00,245.00 L 494.00,244.00 L 493.00,243.00 L 493.00,242.00 L 492.00,241.00 L 492.00,240.00 L 491.00,239.00 L 491.00,238.00 L 490.00,237.00 L 490.00,236.00 L 489.00,235.00 L 489.00,234.00 L 488.00,233.00 L 488.00,232.00 L 487.00,231.00 L 487.00,230.00 L 485.00,228.00 L 485.00,227.00 L 484.00,226.00 L 484.00,225.00 L 482.00,223.00 L 482.00,222.00 L 480.00,220.00 L 480.00,219.00 L 476.00,215.00 L 476.00,214.00 L 469.00,207.00 L 469.00,206.00 L 460.00,197.00 L 460.00,196.00 L 458.00,194.00 L 458.00,193.00 L 456.00,191.00 L 456.00,189.00 L 455.00,188.00 L 455.00,187.00 L 454.00,186.00 L 454.00,185.00 L 453.00,184.00 L 453.00,182.00 L 452.00,181.00 L 452.00,180.00 L 451.00,179.00 L 451.00,178.00 L 450.00,177.00 L 450.00,176.00 L 449.00,175.00 L 449.00,174.00 L 448.00,173.00 L 448.00,171.00 L 447.00,170.00 L 447.00,169.00 L 446.00,168.00 L 446.00,167.00 L 445.00,166.00 L 445.00,165.00 L 444.00,164.00 L 444.00,163.00 L 443.00,162.00 L 443.00,161.00 L 442.00,160.00 L 442.00,159.00 L 440.00,157.00 L 440.00,156.00 L 439.00,155.00 L 439.00,154.00 L 438.00,153.00 L 438.00,152.00 L 436.00,150.00 L 436.00,149.00 L 434.00,147.00 L 434.00,146.00 L 431.00,143.00 L 431.00,142.00 L 428.00,139.00 L 428.00,138.00 L 427.00,137.00 L 427.00,136.00 L 426.00,135.00 L 426.00,132.00 L 425.00,131.00 L 425.00,129.00 L 424.00,128.00 L 424.00,125.00 L 423.00,124.00 L 423.00,122.00 L 422.00,121.00 L 422.00,119.00 L 421.00,118.00 L 421.00,116.00 L 420.00,115.00 L 420.00,113.00 L 419.00,112.00 L 419.00,110.00 L 418.00,109.00 L 418.00,108.00 L 417.00,107.00 L 417.00,105.00 L 416.00,104.00 L 416.00,102.00 L 415.00,101.00 L 415.00,99.00 L 414.00,98.00 L 414.00,96.00 L 413.00,95.00 L 413.00,94.00 L 412.00,93.00 L 412.00,92.00 L 410.00,90.00 L 410.00,89.00 L 409.00,88.00 L 409.00,87.00 L 406.00,84.00 L 406.00,83.00 L 399.00,76.00 L 398.00,76.00 L 395.00,73.00 L 394.00,73.00 L 393.00,72.00 L 392.00,72.00 L 391.00,71.00 L 390.00,71.00 L 389.00,70.00 L 388.00,70.00 L 387.00,69.00 L 385.00,69.00 L 384.00,68.00 L 382.00,68.00 L 381.00,67.00 L 378.00,67.00 L 377.00,66.00 L 374.00,66.00 L 373.00,65.00 L 370.00,65.00 L 369.00,64.00 L 366.00,64.00 L 365.00,63.00 L 363.00,63.00 L 362.00,62.00 L 361.00,62.00 L 358.00,59.00 L 357.00,59.00 L 354.00,56.00 L 353.00,56.00 L 351.00,54.00 L 349.00,54.00 L 348.00,53.00 L 347.00,53.00 L 346.00,52.00 L 345.00,52.00 L 344.00,51.00 L 342.00,51.00 L 341.00,50.00 L 340.00,50.00 L 339.00,49.00 L 338.00,49.00 L 337.00,48.00 L 336.00,48.00 L 335.00,47.00 L 333.00,47.00 L 332.00,46.00 L 331.00,46.00 L 330.00,45.00 L 329.00,45.00 L 328.00,44.00 L 327.00,44.00 L 326.00,43.00 L 325.00,43.00 L 321.00,39.00 L 320.00,39.00 L 316.00,35.00 L 316.00,25.00 L 315.00,24.00 L 315.00,5.00 L 316.00,4.00 L 316.00,1.00 L 317.00,0.00 L 315.00,0.00 L 315.00,1.00 L 314.00,2.00 L 314.00,3.00 L 313.00,4.00 L 313.00,5.00 L 312.00,6.00 L 312.00,7.00 L 304.00,15.00 L 303.00,15.00 L 300.00,18.00 L 299.00,18.00 L 298.00,19.00 L 297.00,19.00 L 296.00,20.00 L 295.00,20.00 L 294.00,21.00 L 292.00,21.00 L 291.00,22.00 L 289.00,22.00 L 288.00,23.00 L 284.00,23.00 L 283.00,24.00 L 282.00,24.00 L 281.00,23.00 L 278.00,23.00 L 277.00,22.00 L 274.00,22.00 L 273.00,21.00 L 272.00,21.00 L 271.00,20.00 L 270.00,20.00 L 269.00,19.00 L 268.00,19.00 L 267.00,18.00 L 266.00,18.00 L 264.00,16.00 L 263.00,16.00 L 260.00,13.00 L 259.00,13.00 L 257.00,11.00 L 257.00,10.00 L 252.00,5.00 L 252.00,4.00 L 251.00,3.00 L 251.00,1.00 L 250.00,0.00 Z M 333.00,603.00 L 334.00,602.00 L 335.00,603.00 L 334.00,604.00 Z M 375.00,590.00 L 376.00,589.00 L 377.00,589.00 L 378.00,590.00 L 378.00,592.00 L 379.00,593.00 L 379.00,595.00 L 380.00,596.00 L 380.00,599.00 L 381.00,600.00 L 381.00,602.00 L 382.00,603.00 L 382.00,606.00 L 383.00,607.00 L 383.00,610.00 L 384.00,611.00 L 384.00,614.00 L 385.00,615.00 L 385.00,619.00 L 386.00,620.00 L 386.00,626.00 L 387.00,627.00 L 387.00,634.00 L 388.00,635.00 L 388.00,653.00 L 389.00,654.00 L 389.00,656.00 L 388.00,657.00 L 388.00,676.00 L 387.00,677.00 L 387.00,685.00 L 386.00,686.00 L 386.00,691.00 L 385.00,692.00 L 385.00,699.00 L 384.00,700.00 L 384.00,709.00 L 383.00,710.00 L 383.00,718.00 L 382.00,719.00 L 382.00,727.00 L 381.00,728.00 L 381.00,741.00 L 380.00,742.00 L 380.00,753.00 L 381.00,754.00 L 381.00,760.00 L 382.00,761.00 L 382.00,768.00 L 383.00,769.00 L 383.00,774.00 L 384.00,775.00 L 384.00,776.00 L 385.00,777.00 L 385.00,778.00 L 386.00,779.00 L 386.00,780.00 L 387.00,781.00 L 387.00,782.00 L 388.00,783.00 L 388.00,784.00 L 390.00,786.00 L 390.00,787.00 L 391.00,788.00 L 391.00,789.00 L 393.00,791.00 L 393.00,792.00 L 394.00,793.00 L 394.00,794.00 L 396.00,796.00 L 396.00,797.00 L 397.00,798.00 L 397.00,799.00 L 399.00,801.00 L 399.00,802.00 L 401.00,804.00 L 402.00,804.00 L 408.00,810.00 L 409.00,810.00 L 412.00,813.00 L 412.00,814.00 L 416.00,818.00 L 416.00,819.00 L 418.00,821.00 L 418.00,822.00 L 419.00,823.00 L 419.00,828.00 L 417.00,830.00 L 416.00,830.00 L 415.00,831.00 L 415.00,832.00 L 413.00,834.00 L 412.00,834.00 L 412.00,835.00 L 410.00,837.00 L 407.00,837.00 L 404.00,840.00 L 401.00,840.00 L 400.00,839.00 L 397.00,839.00 L 395.00,841.00 L 393.00,841.00 L 392.00,842.00 L 388.00,842.00 L 387.00,841.00 L 386.00,841.00 L 380.00,835.00 L 380.00,834.00 L 378.00,832.00 L 377.00,832.00 L 376.00,831.00 L 375.00,831.00 L 369.00,825.00 L 369.00,824.00 L 368.00,823.00 L 368.00,817.00 L 367.00,816.00 L 367.00,815.00 L 364.00,812.00 L 363.00,812.00 L 361.00,810.00 L 360.00,810.00 L 358.00,808.00 L 357.00,808.00 L 354.00,805.00 L 354.00,804.00 L 353.00,803.00 L 353.00,799.00 L 352.00,798.00 L 352.00,797.00 L 353.00,796.00 L 353.00,787.00 L 354.00,786.00 L 354.00,778.00 L 353.00,777.00 L 353.00,774.00 L 351.00,772.00 L 351.00,767.00 L 350.00,766.00 L 350.00,762.00 L 351.00,761.00 L 351.00,739.00 L 350.00,738.00 L 350.00,731.00 L 349.00,730.00 L 349.00,726.00 L 348.00,725.00 L 348.00,721.00 L 347.00,720.00 L 347.00,716.00 L 346.00,715.00 L 346.00,712.00 L 345.00,711.00 L 345.00,708.00 L 344.00,707.00 L 344.00,705.00 L 343.00,704.00 L 343.00,701.00 L 342.00,700.00 L 342.00,697.00 L 341.00,696.00 L 341.00,694.00 L 340.00,693.00 L 340.00,690.00 L 339.00,689.00 L 339.00,687.00 L 338.00,686.00 L 338.00,684.00 L 337.00,683.00 L 337.00,680.00 L 336.00,679.00 L 336.00,678.00 L 335.00,677.00 L 335.00,676.00 L 334.00,675.00 L 334.00,674.00 L 332.00,672.00 L 332.00,671.00 L 331.00,670.00 L 331.00,668.00 L 330.00,667.00 L 330.00,663.00 L 329.00,662.00 L 329.00,650.00 L 330.00,649.00 L 330.00,639.00 L 331.00,638.00 L 331.00,630.00 L 332.00,629.00 L 332.00,621.00 L 333.00,620.00 L 333.00,610.00 L 334.00,609.00 L 334.00,604.00 L 335.00,603.00 L 336.00,604.00 L 337.00,604.00 L 339.00,606.00 L 340.00,606.00 L 341.00,607.00 L 342.00,607.00 L 343.00,608.00 L 344.00,608.00 L 345.00,609.00 L 348.00,609.00 L 349.00,610.00 L 352.00,610.00 L 353.00,609.00 L 357.00,609.00 L 358.00,608.00 L 359.00,608.00 L 360.00,607.00 L 361.00,607.00 L 364.00,604.00 L 364.00,603.00 L 366.00,601.00 L 366.00,600.00 L 368.00,598.00 L 368.00,597.00 L 369.00,596.00 L 369.00,595.00 L 374.00,590.00 Z M 188.00,590.00 L 189.00,589.00 L 190.00,590.00 L 191.00,590.00 L 196.00,595.00 L 196.00,596.00 L 198.00,598.00 L 198.00,599.00 L 200.00,601.00 L 200.00,602.00 L 202.00,604.00 L 202.00,605.00 L 203.00,605.00 L 206.00,608.00 L 208.00,608.00 L 209.00,609.00 L 212.00,609.00 L 213.00,610.00 L 216.00,610.00 L 217.00,609.00 L 220.00,609.00 L 221.00,608.00 L 223.00,608.00 L 225.00,606.00 L 226.00,606.00 L 228.00,604.00 L 229.00,604.00 L 231.00,602.00 L 232.00,603.00 L 232.00,617.00 L 233.00,618.00 L 233.00,627.00 L 234.00,628.00 L 234.00,635.00 L 235.00,636.00 L 235.00,645.00 L 236.00,646.00 L 236.00,664.00 L 235.00,665.00 L 235.00,668.00 L 234.00,669.00 L 234.00,670.00 L 233.00,671.00 L 233.00,672.00 L 232.00,673.00 L 232.00,674.00 L 231.00,675.00 L 231.00,676.00 L 229.00,678.00 L 229.00,680.00 L 228.00,681.00 L 228.00,683.00 L 227.00,684.00 L 227.00,687.00 L 226.00,688.00 L 226.00,690.00 L 225.00,691.00 L 225.00,694.00 L 224.00,695.00 L 224.00,697.00 L 223.00,698.00 L 223.00,701.00 L 222.00,702.00 L 222.00,705.00 L 221.00,706.00 L 221.00,708.00 L 220.00,709.00 L 220.00,712.00 L 219.00,713.00 L 219.00,717.00 L 218.00,718.00 L 218.00,721.00 L 217.00,722.00 L 217.00,726.00 L 216.00,727.00 L 216.00,732.00 L 215.00,733.00 L 215.00,740.00 L 214.00,741.00 L 214.00,757.00 L 215.00,758.00 L 215.00,769.00 L 214.00,770.00 L 214.00,772.00 L 213.00,773.00 L 213.00,774.00 L 212.00,775.00 L 212.00,781.00 L 211.00,782.00 L 212.00,783.00 L 212.00,792.00 L 213.00,793.00 L 213.00,801.00 L 212.00,802.00 L 212.00,804.00 L 207.00,809.00 L 206.00,809.00 L 204.00,811.00 L 203.00,811.00 L 202.00,812.00 L 201.00,812.00 L 199.00,814.00 L 199.00,815.00 L 198.00,816.00 L 198.00,820.00 L 197.00,821.00 L 197.00,824.00 L 195.00,826.00 L 195.00,827.00 L 192.00,830.00 L 191.00,830.00 L 190.00,831.00 L 189.00,831.00 L 188.00,832.00 L 187.00,832.00 L 186.00,833.00 L 186.00,834.00 L 182.00,838.00 L 182.00,839.00 L 181.00,840.00 L 180.00,840.00 L 179.00,841.00 L 178.00,841.00 L 177.00,842.00 L 173.00,842.00 L 172.00,841.00 L 170.00,841.00 L 168.00,839.00 L 166.00,839.00 L 165.00,840.00 L 162.00,840.00 L 161.00,839.00 L 160.00,839.00 L 158.00,837.00 L 155.00,837.00 L 154.00,836.00 L 154.00,835.00 L 152.00,833.00 L 151.00,833.00 L 150.00,832.00 L 150.00,830.00 L 148.00,830.00 L 146.00,828.00 L 146.00,824.00 L 147.00,823.00 L 147.00,822.00 L 148.00,821.00 L 148.00,820.00 L 149.00,819.00 L 149.00,818.00 L 161.00,806.00 L 162.00,806.00 L 167.00,801.00 L 167.00,800.00 L 169.00,798.00 L 169.00,797.00 L 170.00,796.00 L 170.00,795.00 L 171.00,794.00 L 171.00,793.00 L 173.00,791.00 L 173.00,790.00 L 174.00,789.00 L 174.00,788.00 L 176.00,786.00 L 176.00,785.00 L 177.00,784.00 L 177.00,783.00 L 179.00,781.00 L 179.00,780.00 L 180.00,779.00 L 180.00,778.00 L 181.00,777.00 L 181.00,776.00 L 182.00,775.00 L 182.00,771.00 L 183.00,770.00 L 183.00,763.00 L 184.00,762.00 L 184.00,756.00 L 185.00,755.00 L 185.00,737.00 L 184.00,736.00 L 184.00,725.00 L 183.00,724.00 L 183.00,716.00 L 182.00,715.00 L 182.00,707.00 L 181.00,706.00 L 181.00,698.00 L 180.00,697.00 L 180.00,691.00 L 179.00,690.00 L 179.00,683.00 L 178.00,682.00 L 178.00,673.00 L 177.00,672.00 L 177.00,639.00 L 178.00,638.00 L 178.00,629.00 L 179.00,628.00 L 179.00,622.00 L 180.00,621.00 L 180.00,617.00 L 181.00,616.00 L 181.00,612.00 L 182.00,611.00 L 182.00,608.00 L 183.00,607.00 L 183.00,604.00 L 184.00,603.00 L 184.00,600.00 L 185.00,599.00 L 185.00,597.00 L 186.00,596.00 L 186.00,594.00 L 187.00,593.00 L 187.00,591.00 Z M 193.00,550.00 L 194.00,549.00 L 196.00,551.00 L 197.00,551.00 L 198.00,552.00 L 200.00,552.00 L 201.00,553.00 L 203.00,553.00 L 204.00,552.00 L 206.00,552.00 L 207.00,551.00 L 211.00,551.00 L 212.00,552.00 L 212.00,553.00 L 213.00,554.00 L 213.00,557.00 L 214.00,558.00 L 214.00,560.00 L 215.00,561.00 L 215.00,564.00 L 216.00,565.00 L 216.00,566.00 L 217.00,567.00 L 217.00,569.00 L 222.00,574.00 L 223.00,574.00 L 224.00,575.00 L 227.00,575.00 L 228.00,576.00 L 230.00,576.00 L 231.00,575.00 L 234.00,575.00 L 235.00,574.00 L 236.00,574.00 L 238.00,572.00 L 239.00,572.00 L 241.00,570.00 L 241.00,569.00 L 244.00,566.00 L 244.00,565.00 L 245.00,564.00 L 245.00,563.00 L 246.00,562.00 L 246.00,561.00 L 247.00,560.00 L 247.00,559.00 L 248.00,558.00 L 248.00,557.00 L 249.00,556.00 L 250.00,557.00 L 250.00,560.00 L 249.00,561.00 L 249.00,565.00 L 248.00,566.00 L 248.00,568.00 L 247.00,569.00 L 247.00,571.00 L 246.00,572.00 L 246.00,574.00 L 245.00,575.00 L 245.00,576.00 L 244.00,577.00 L 244.00,578.00 L 243.00,579.00 L 243.00,580.00 L 242.00,581.00 L 242.00,582.00 L 241.00,583.00 L 241.00,584.00 L 240.00,585.00 L 240.00,586.00 L 239.00,587.00 L 239.00,588.00 L 237.00,590.00 L 237.00,591.00 L 235.00,593.00 L 235.00,594.00 L 234.00,595.00 L 234.00,596.00 L 226.00,604.00 L 225.00,604.00 L 223.00,606.00 L 221.00,606.00 L 220.00,607.00 L 218.00,607.00 L 217.00,608.00 L 210.00,608.00 L 209.00,607.00 L 208.00,607.00 L 207.00,606.00 L 206.00,606.00 L 202.00,602.00 L 202.00,601.00 L 200.00,599.00 L 200.00,598.00 L 199.00,597.00 L 199.00,596.00 L 197.00,594.00 L 197.00,593.00 L 193.00,589.00 L 192.00,589.00 L 191.00,588.00 L 190.00,588.00 L 189.00,587.00 L 189.00,576.00 L 190.00,575.00 L 190.00,570.00 L 191.00,569.00 L 191.00,565.00 L 192.00,564.00 L 192.00,555.00 L 193.00,554.00 L 193.00,551.00 Z M 371.00,549.00 L 372.00,548.00 L 373.00,549.00 L 373.00,562.00 L 374.00,563.00 L 374.00,568.00 L 375.00,569.00 L 375.00,572.00 L 376.00,573.00 L 376.00,585.00 L 377.00,586.00 L 375.00,588.00 L 374.00,588.00 L 372.00,590.00 L 371.00,590.00 L 369.00,592.00 L 369.00,593.00 L 367.00,595.00 L 367.00,596.00 L 366.00,597.00 L 366.00,598.00 L 364.00,600.00 L 364.00,601.00 L 359.00,606.00 L 358.00,606.00 L 357.00,607.00 L 356.00,607.00 L 355.00,608.00 L 348.00,608.00 L 347.00,607.00 L 345.00,607.00 L 344.00,606.00 L 342.00,606.00 L 340.00,604.00 L 339.00,604.00 L 332.00,597.00 L 332.00,596.00 L 330.00,594.00 L 330.00,593.00 L 329.00,592.00 L 329.00,591.00 L 327.00,589.00 L 327.00,588.00 L 326.00,587.00 L 326.00,586.00 L 324.00,584.00 L 324.00,583.00 L 323.00,582.00 L 323.00,581.00 L 322.00,580.00 L 322.00,579.00 L 321.00,578.00 L 321.00,577.00 L 320.00,576.00 L 320.00,574.00 L 319.00,573.00 L 319.00,572.00 L 318.00,571.00 L 318.00,569.00 L 317.00,568.00 L 317.00,565.00 L 316.00,564.00 L 316.00,560.00 L 315.00,559.00 L 315.00,556.00 L 316.00,555.00 L 317.00,556.00 L 317.00,557.00 L 318.00,558.00 L 318.00,560.00 L 319.00,561.00 L 319.00,562.00 L 320.00,563.00 L 320.00,564.00 L 322.00,566.00 L 322.00,567.00 L 328.00,573.00 L 329.00,573.00 L 330.00,574.00 L 331.00,574.00 L 332.00,575.00 L 335.00,575.00 L 336.00,576.00 L 337.00,576.00 L 338.00,575.00 L 341.00,575.00 L 342.00,574.00 L 343.00,574.00 L 344.00,573.00 L 345.00,573.00 L 346.00,572.00 L 346.00,571.00 L 348.00,569.00 L 348.00,568.00 L 349.00,567.00 L 349.00,565.00 L 350.00,564.00 L 350.00,562.00 L 351.00,561.00 L 351.00,559.00 L 352.00,558.00 L 352.00,554.00 L 353.00,553.00 L 353.00,552.00 L 355.00,550.00 L 356.00,551.00 L 358.00,551.00 L 359.00,552.00 L 361.00,552.00 L 362.00,553.00 L 365.00,553.00 L 366.00,552.00 L 368.00,552.00 L 370.00,550.00 Z M 522.00,367.00 L 523.00,366.00 L 525.00,368.00 L 525.00,369.00 L 526.00,370.00 L 526.00,371.00 L 528.00,373.00 L 528.00,376.00 L 529.00,377.00 L 529.00,381.00 L 530.00,382.00 L 530.00,393.00 L 529.00,394.00 L 529.00,396.00 L 528.00,397.00 L 527.00,397.00 L 525.00,395.00 L 525.00,390.00 L 526.00,389.00 L 526.00,386.00 L 525.00,385.00 L 525.00,374.00 L 524.00,373.00 L 524.00,372.00 L 523.00,371.00 L 523.00,369.00 L 522.00,368.00 Z M 41.00,367.00 L 42.00,366.00 L 43.00,367.00 L 43.00,369.00 L 42.00,370.00 L 42.00,372.00 L 41.00,373.00 L 41.00,374.00 L 40.00,375.00 L 40.00,395.00 L 38.00,397.00 L 37.00,397.00 L 36.00,396.00 L 36.00,392.00 L 35.00,391.00 L 35.00,383.00 L 36.00,382.00 L 36.00,379.00 L 37.00,378.00 L 37.00,374.00 L 38.00,373.00 L 38.00,372.00 L 39.00,371.00 L 39.00,370.00 L 41.00,368.00 Z M 45.00,360.00 L 46.00,359.00 L 47.00,360.00 L 47.00,361.00 L 46.00,362.00 L 45.00,361.00 Z M 519.00,314.00 L 520.00,313.00 L 521.00,314.00 L 521.00,315.00 L 522.00,316.00 L 522.00,318.00 L 523.00,319.00 L 523.00,321.00 L 524.00,322.00 L 524.00,324.00 L 525.00,325.00 L 525.00,327.00 L 526.00,328.00 L 526.00,330.00 L 527.00,331.00 L 527.00,333.00 L 528.00,334.00 L 528.00,335.00 L 529.00,336.00 L 529.00,338.00 L 530.00,339.00 L 530.00,340.00 L 531.00,341.00 L 531.00,342.00 L 532.00,343.00 L 532.00,345.00 L 533.00,346.00 L 533.00,347.00 L 534.00,348.00 L 534.00,349.00 L 535.00,350.00 L 535.00,351.00 L 536.00,352.00 L 536.00,353.00 L 537.00,354.00 L 537.00,355.00 L 538.00,356.00 L 538.00,361.00 L 539.00,362.00 L 539.00,372.00 L 540.00,373.00 L 540.00,391.00 L 539.00,392.00 L 539.00,395.00 L 538.00,396.00 L 538.00,398.00 L 537.00,399.00 L 537.00,402.00 L 536.00,403.00 L 534.00,403.00 L 531.00,400.00 L 531.00,392.00 L 532.00,391.00 L 532.00,384.00 L 531.00,383.00 L 531.00,379.00 L 530.00,378.00 L 530.00,374.00 L 529.00,373.00 L 529.00,371.00 L 527.00,369.00 L 527.00,368.00 L 525.00,366.00 L 525.00,365.00 L 524.00,364.00 L 524.00,363.00 L 523.00,362.00 L 523.00,360.00 L 522.00,359.00 L 522.00,358.00 L 519.00,355.00 L 518.00,355.00 L 517.00,354.00 L 516.00,355.00 L 516.00,369.00 L 515.00,370.00 L 515.00,372.00 L 512.00,375.00 L 509.00,375.00 L 506.00,372.00 L 506.00,369.00 L 505.00,368.00 L 505.00,355.00 L 504.00,354.00 L 504.00,350.00 L 503.00,349.00 L 503.00,346.00 L 502.00,345.00 L 502.00,344.00 L 501.00,343.00 L 501.00,342.00 L 500.00,341.00 L 500.00,340.00 L 499.00,339.00 L 499.00,338.00 L 498.00,337.00 L 498.00,333.00 L 499.00,332.00 L 499.00,330.00 L 500.00,329.00 L 500.00,328.00 L 501.00,327.00 L 501.00,325.00 L 500.00,324.00 L 501.00,323.00 L 510.00,323.00 L 511.00,322.00 L 512.00,322.00 L 513.00,321.00 L 514.00,321.00 L 516.00,319.00 L 516.00,318.00 L 518.00,316.00 L 518.00,315.00 Z M 44.00,314.00 L 45.00,313.00 L 47.00,315.00 L 47.00,316.00 L 50.00,319.00 L 50.00,320.00 L 51.00,320.00 L 53.00,322.00 L 55.00,322.00 L 56.00,323.00 L 64.00,323.00 L 65.00,324.00 L 65.00,328.00 L 66.00,329.00 L 66.00,330.00 L 67.00,331.00 L 67.00,338.00 L 66.00,339.00 L 66.00,340.00 L 65.00,341.00 L 65.00,342.00 L 63.00,344.00 L 63.00,346.00 L 62.00,347.00 L 62.00,350.00 L 61.00,351.00 L 61.00,356.00 L 60.00,357.00 L 60.00,370.00 L 59.00,371.00 L 59.00,372.00 L 56.00,375.00 L 53.00,375.00 L 51.00,373.00 L 51.00,372.00 L 50.00,371.00 L 50.00,368.00 L 49.00,367.00 L 49.00,354.00 L 48.00,354.00 L 47.00,355.00 L 46.00,355.00 L 44.00,357.00 L 44.00,358.00 L 43.00,359.00 L 43.00,360.00 L 42.00,361.00 L 42.00,363.00 L 41.00,364.00 L 41.00,365.00 L 39.00,367.00 L 39.00,368.00 L 37.00,370.00 L 37.00,371.00 L 36.00,372.00 L 36.00,374.00 L 35.00,375.00 L 35.00,379.00 L 34.00,380.00 L 34.00,400.00 L 31.00,403.00 L 30.00,403.00 L 28.00,401.00 L 28.00,398.00 L 27.00,397.00 L 27.00,395.00 L 26.00,394.00 L 26.00,390.00 L 25.00,389.00 L 25.00,376.00 L 26.00,375.00 L 26.00,366.00 L 27.00,365.00 L 27.00,357.00 L 28.00,356.00 L 28.00,354.00 L 29.00,353.00 L 29.00,352.00 L 30.00,351.00 L 30.00,350.00 L 31.00,349.00 L 31.00,348.00 L 32.00,347.00 L 32.00,346.00 L 33.00,345.00 L 33.00,344.00 L 34.00,343.00 L 34.00,342.00 L 35.00,341.00 L 35.00,339.00 L 36.00,338.00 L 36.00,337.00 L 37.00,336.00 L 37.00,334.00 L 38.00,333.00 L 38.00,332.00 L 39.00,331.00 L 39.00,329.00 L 40.00,328.00 L 40.00,326.00 L 41.00,325.00 L 41.00,323.00 L 42.00,322.00 L 42.00,320.00 L 43.00,319.00 L 43.00,317.00 L 44.00,316.00 L 44.00,315.00 Z M 356.00,308.00 L 357.00,307.00 L 360.00,307.00 L 361.00,308.00 L 361.00,309.00 L 362.00,310.00 L 362.00,316.00 L 363.00,317.00 L 363.00,324.00 L 364.00,325.00 L 364.00,331.00 L 365.00,332.00 L 365.00,337.00 L 366.00,338.00 L 366.00,343.00 L 367.00,344.00 L 367.00,348.00 L 368.00,349.00 L 368.00,352.00 L 369.00,353.00 L 369.00,356.00 L 370.00,357.00 L 370.00,360.00 L 371.00,361.00 L 371.00,365.00 L 372.00,366.00 L 372.00,369.00 L 373.00,370.00 L 373.00,374.00 L 374.00,375.00 L 374.00,379.00 L 375.00,380.00 L 375.00,384.00 L 376.00,385.00 L 376.00,389.00 L 377.00,390.00 L 377.00,396.00 L 378.00,397.00 L 378.00,402.00 L 379.00,403.00 L 379.00,410.00 L 380.00,411.00 L 380.00,418.00 L 381.00,419.00 L 381.00,429.00 L 382.00,430.00 L 382.00,443.00 L 383.00,444.00 L 383.00,482.00 L 382.00,483.00 L 382.00,494.00 L 381.00,495.00 L 381.00,505.00 L 380.00,506.00 L 380.00,511.00 L 379.00,512.00 L 379.00,516.00 L 378.00,517.00 L 378.00,522.00 L 377.00,523.00 L 377.00,527.00 L 376.00,528.00 L 376.00,531.00 L 375.00,532.00 L 375.00,535.00 L 374.00,536.00 L 374.00,539.00 L 373.00,540.00 L 373.00,542.00 L 372.00,543.00 L 372.00,545.00 L 367.00,550.00 L 366.00,550.00 L 365.00,551.00 L 362.00,551.00 L 361.00,550.00 L 358.00,550.00 L 357.00,549.00 L 353.00,549.00 L 352.00,550.00 L 352.00,551.00 L 351.00,552.00 L 351.00,555.00 L 350.00,556.00 L 350.00,558.00 L 349.00,559.00 L 349.00,562.00 L 348.00,563.00 L 348.00,565.00 L 347.00,566.00 L 347.00,567.00 L 346.00,568.00 L 346.00,569.00 L 343.00,572.00 L 342.00,572.00 L 341.00,573.00 L 340.00,573.00 L 339.00,574.00 L 334.00,574.00 L 333.00,573.00 L 331.00,573.00 L 329.00,571.00 L 328.00,571.00 L 324.00,567.00 L 324.00,566.00 L 322.00,564.00 L 322.00,563.00 L 321.00,562.00 L 321.00,561.00 L 320.00,560.00 L 320.00,559.00 L 319.00,558.00 L 319.00,556.00 L 318.00,555.00 L 318.00,554.00 L 317.00,553.00 L 317.00,551.00 L 316.00,550.00 L 316.00,547.00 L 315.00,546.00 L 315.00,544.00 L 314.00,543.00 L 314.00,539.00 L 313.00,538.00 L 313.00,533.00 L 312.00,532.00 L 312.00,528.00 L 311.00,527.00 L 311.00,521.00 L 310.00,520.00 L 310.00,516.00 L 309.00,515.00 L 309.00,512.00 L 308.00,511.00 L 308.00,507.00 L 307.00,506.00 L 307.00,503.00 L 306.00,502.00 L 306.00,499.00 L 305.00,498.00 L 305.00,495.00 L 304.00,494.00 L 304.00,492.00 L 303.00,491.00 L 303.00,488.00 L 302.00,487.00 L 302.00,485.00 L 301.00,484.00 L 301.00,482.00 L 300.00,481.00 L 300.00,480.00 L 299.00,479.00 L 299.00,477.00 L 298.00,476.00 L 298.00,474.00 L 297.00,473.00 L 297.00,471.00 L 296.00,470.00 L 296.00,468.00 L 295.00,467.00 L 295.00,465.00 L 294.00,464.00 L 294.00,462.00 L 293.00,461.00 L 293.00,458.00 L 292.00,457.00 L 292.00,455.00 L 291.00,454.00 L 291.00,451.00 L 290.00,450.00 L 290.00,448.00 L 289.00,447.00 L 289.00,444.00 L 288.00,443.00 L 288.00,439.00 L 287.00,438.00 L 287.00,434.00 L 286.00,433.00 L 286.00,427.00 L 285.00,426.00 L 285.00,406.00 L 286.00,405.00 L 287.00,405.00 L 288.00,404.00 L 289.00,404.00 L 290.00,403.00 L 291.00,403.00 L 296.00,398.00 L 296.00,397.00 L 297.00,396.00 L 297.00,395.00 L 299.00,393.00 L 299.00,391.00 L 300.00,390.00 L 300.00,389.00 L 301.00,388.00 L 301.00,387.00 L 302.00,386.00 L 302.00,384.00 L 303.00,383.00 L 303.00,381.00 L 304.00,380.00 L 304.00,379.00 L 305.00,378.00 L 305.00,376.00 L 306.00,375.00 L 306.00,373.00 L 307.00,372.00 L 307.00,369.00 L 308.00,368.00 L 308.00,366.00 L 309.00,365.00 L 309.00,363.00 L 310.00,362.00 L 310.00,360.00 L 311.00,359.00 L 311.00,356.00 L 312.00,355.00 L 312.00,354.00 L 313.00,353.00 L 313.00,351.00 L 314.00,350.00 L 314.00,348.00 L 315.00,347.00 L 315.00,346.00 L 316.00,345.00 L 316.00,344.00 L 317.00,343.00 L 317.00,342.00 L 318.00,341.00 L 318.00,340.00 L 319.00,339.00 L 319.00,338.00 L 320.00,337.00 L 320.00,336.00 L 322.00,334.00 L 322.00,333.00 L 326.00,329.00 L 326.00,328.00 L 335.00,319.00 L 336.00,319.00 L 338.00,317.00 L 339.00,317.00 L 342.00,314.00 L 343.00,314.00 L 344.00,313.00 L 345.00,313.00 L 346.00,312.00 L 347.00,312.00 L 348.00,311.00 L 349.00,311.00 L 350.00,310.00 L 351.00,310.00 L 352.00,309.00 L 353.00,309.00 L 354.00,308.00 L 355.00,308.00 Z M 204.00,308.00 L 205.00,307.00 L 208.00,307.00 L 209.00,308.00 L 212.00,308.00 L 213.00,309.00 L 214.00,309.00 L 215.00,310.00 L 216.00,310.00 L 217.00,311.00 L 218.00,311.00 L 219.00,312.00 L 220.00,312.00 L 221.00,313.00 L 222.00,313.00 L 224.00,315.00 L 225.00,315.00 L 228.00,318.00 L 229.00,318.00 L 242.00,331.00 L 242.00,332.00 L 245.00,335.00 L 245.00,336.00 L 246.00,337.00 L 246.00,338.00 L 247.00,339.00 L 247.00,340.00 L 248.00,341.00 L 248.00,342.00 L 249.00,343.00 L 249.00,344.00 L 250.00,345.00 L 250.00,346.00 L 251.00,347.00 L 251.00,349.00 L 252.00,350.00 L 252.00,352.00 L 253.00,353.00 L 253.00,355.00 L 254.00,356.00 L 254.00,358.00 L 255.00,359.00 L 255.00,361.00 L 256.00,362.00 L 256.00,364.00 L 257.00,365.00 L 257.00,367.00 L 258.00,368.00 L 258.00,370.00 L 259.00,371.00 L 259.00,373.00 L 260.00,374.00 L 260.00,376.00 L 261.00,377.00 L 261.00,379.00 L 262.00,380.00 L 262.00,382.00 L 263.00,383.00 L 263.00,385.00 L 264.00,386.00 L 264.00,387.00 L 265.00,388.00 L 265.00,390.00 L 266.00,391.00 L 266.00,392.00 L 267.00,393.00 L 267.00,394.00 L 268.00,395.00 L 268.00,396.00 L 270.00,398.00 L 270.00,399.00 L 274.00,403.00 L 275.00,403.00 L 276.00,404.00 L 277.00,404.00 L 278.00,405.00 L 280.00,405.00 L 281.00,406.00 L 281.00,407.00 L 280.00,408.00 L 280.00,429.00 L 279.00,430.00 L 279.00,435.00 L 278.00,436.00 L 278.00,440.00 L 277.00,441.00 L 277.00,444.00 L 276.00,445.00 L 276.00,448.00 L 275.00,449.00 L 275.00,452.00 L 274.00,453.00 L 274.00,455.00 L 273.00,456.00 L 273.00,458.00 L 272.00,459.00 L 272.00,462.00 L 271.00,463.00 L 271.00,465.00 L 270.00,466.00 L 270.00,468.00 L 269.00,469.00 L 269.00,471.00 L 268.00,472.00 L 268.00,474.00 L 267.00,475.00 L 267.00,476.00 L 266.00,477.00 L 266.00,479.00 L 265.00,480.00 L 265.00,482.00 L 264.00,483.00 L 264.00,485.00 L 263.00,486.00 L 263.00,488.00 L 262.00,489.00 L 262.00,492.00 L 261.00,493.00 L 261.00,495.00 L 260.00,496.00 L 260.00,499.00 L 259.00,500.00 L 259.00,503.00 L 258.00,504.00 L 258.00,507.00 L 257.00,508.00 L 257.00,512.00 L 256.00,513.00 L 256.00,517.00 L 255.00,518.00 L 255.00,522.00 L 254.00,523.00 L 254.00,528.00 L 253.00,529.00 L 253.00,533.00 L 252.00,534.00 L 252.00,539.00 L 251.00,540.00 L 251.00,544.00 L 250.00,545.00 L 250.00,547.00 L 249.00,548.00 L 249.00,550.00 L 248.00,551.00 L 248.00,553.00 L 247.00,554.00 L 247.00,556.00 L 246.00,557.00 L 246.00,558.00 L 245.00,559.00 L 245.00,561.00 L 243.00,563.00 L 243.00,564.00 L 242.00,565.00 L 242.00,566.00 L 237.00,571.00 L 236.00,571.00 L 234.00,573.00 L 233.00,573.00 L 232.00,574.00 L 227.00,574.00 L 226.00,573.00 L 224.00,573.00 L 223.00,572.00 L 222.00,572.00 L 221.00,571.00 L 221.00,570.00 L 219.00,568.00 L 219.00,567.00 L 218.00,566.00 L 218.00,565.00 L 217.00,564.00 L 217.00,562.00 L 216.00,561.00 L 216.00,558.00 L 215.00,557.00 L 215.00,555.00 L 214.00,554.00 L 214.00,552.00 L 213.00,551.00 L 213.00,550.00 L 212.00,549.00 L 208.00,549.00 L 207.00,550.00 L 205.00,550.00 L 204.00,551.00 L 200.00,551.00 L 199.00,550.00 L 198.00,550.00 L 194.00,546.00 L 194.00,545.00 L 193.00,544.00 L 193.00,543.00 L 192.00,542.00 L 192.00,539.00 L 191.00,538.00 L 191.00,535.00 L 190.00,534.00 L 190.00,531.00 L 189.00,530.00 L 189.00,527.00 L 188.00,526.00 L 188.00,521.00 L 187.00,520.00 L 187.00,516.00 L 186.00,515.00 L 186.00,511.00 L 185.00,510.00 L 185.00,503.00 L 184.00,502.00 L 184.00,493.00 L 183.00,492.00 L 183.00,473.00 L 182.00,472.00 L 182.00,454.00 L 183.00,453.00 L 183.00,434.00 L 184.00,433.00 L 184.00,422.00 L 185.00,421.00 L 185.00,413.00 L 186.00,412.00 L 186.00,405.00 L 187.00,404.00 L 187.00,399.00 L 188.00,398.00 L 188.00,392.00 L 189.00,391.00 L 189.00,386.00 L 190.00,385.00 L 190.00,381.00 L 191.00,380.00 L 191.00,376.00 L 192.00,375.00 L 192.00,371.00 L 193.00,370.00 L 193.00,367.00 L 194.00,366.00 L 194.00,362.00 L 195.00,361.00 L 195.00,358.00 L 196.00,357.00 L 196.00,354.00 L 197.00,353.00 L 197.00,350.00 L 198.00,349.00 L 198.00,345.00 L 199.00,344.00 L 199.00,340.00 L 200.00,339.00 L 200.00,334.00 L 201.00,333.00 L 201.00,327.00 L 202.00,326.00 L 202.00,319.00 L 203.00,318.00 L 203.00,312.00 L 204.00,311.00 L 204.00,309.00 Z M 141.00,223.00 L 142.00,222.00 L 143.00,223.00 L 142.00,224.00 Z M 239.00,221.00 L 240.00,220.00 L 241.00,221.00 L 241.00,245.00 L 242.00,246.00 L 242.00,263.00 L 243.00,264.00 L 243.00,279.00 L 244.00,280.00 L 244.00,291.00 L 245.00,292.00 L 245.00,299.00 L 246.00,300.00 L 246.00,303.00 L 247.00,304.00 L 247.00,307.00 L 248.00,308.00 L 248.00,311.00 L 249.00,312.00 L 249.00,314.00 L 250.00,315.00 L 250.00,317.00 L 251.00,318.00 L 251.00,320.00 L 252.00,321.00 L 252.00,322.00 L 253.00,323.00 L 253.00,325.00 L 254.00,326.00 L 254.00,327.00 L 255.00,328.00 L 255.00,329.00 L 256.00,330.00 L 256.00,331.00 L 257.00,332.00 L 257.00,333.00 L 258.00,334.00 L 258.00,335.00 L 260.00,337.00 L 260.00,338.00 L 261.00,339.00 L 261.00,340.00 L 263.00,342.00 L 263.00,343.00 L 265.00,345.00 L 265.00,346.00 L 270.00,351.00 L 270.00,352.00 L 272.00,354.00 L 273.00,354.00 L 277.00,358.00 L 278.00,358.00 L 279.00,359.00 L 282.00,359.00 L 283.00,360.00 L 284.00,359.00 L 286.00,359.00 L 287.00,358.00 L 288.00,358.00 L 290.00,356.00 L 291.00,356.00 L 297.00,350.00 L 297.00,349.00 L 300.00,346.00 L 300.00,345.00 L 302.00,343.00 L 302.00,342.00 L 304.00,340.00 L 304.00,339.00 L 306.00,337.00 L 306.00,336.00 L 307.00,335.00 L 307.00,334.00 L 308.00,333.00 L 308.00,332.00 L 309.00,331.00 L 309.00,330.00 L 310.00,329.00 L 310.00,328.00 L 311.00,327.00 L 311.00,326.00 L 312.00,325.00 L 312.00,324.00 L 313.00,323.00 L 313.00,321.00 L 314.00,320.00 L 314.00,319.00 L 315.00,318.00 L 315.00,316.00 L 316.00,315.00 L 316.00,313.00 L 317.00,312.00 L 317.00,309.00 L 318.00,308.00 L 318.00,305.00 L 319.00,304.00 L 319.00,301.00 L 320.00,300.00 L 320.00,295.00 L 321.00,294.00 L 321.00,287.00 L 322.00,286.00 L 322.00,268.00 L 323.00,267.00 L 323.00,253.00 L 324.00,252.00 L 324.00,228.00 L 325.00,227.00 L 325.00,223.00 L 326.00,222.00 L 327.00,223.00 L 327.00,229.00 L 328.00,230.00 L 328.00,239.00 L 329.00,240.00 L 329.00,255.00 L 328.00,256.00 L 328.00,279.00 L 329.00,280.00 L 329.00,284.00 L 330.00,285.00 L 330.00,286.00 L 331.00,287.00 L 331.00,290.00 L 333.00,292.00 L 333.00,293.00 L 334.00,294.00 L 334.00,295.00 L 336.00,297.00 L 336.00,298.00 L 339.00,301.00 L 340.00,301.00 L 343.00,304.00 L 345.00,304.00 L 346.00,305.00 L 348.00,305.00 L 349.00,306.00 L 351.00,306.00 L 352.00,307.00 L 351.00,308.00 L 350.00,308.00 L 349.00,309.00 L 348.00,309.00 L 347.00,310.00 L 346.00,310.00 L 345.00,311.00 L 344.00,311.00 L 343.00,312.00 L 342.00,312.00 L 340.00,314.00 L 339.00,314.00 L 336.00,317.00 L 335.00,317.00 L 331.00,321.00 L 330.00,321.00 L 325.00,326.00 L 325.00,327.00 L 322.00,330.00 L 322.00,331.00 L 319.00,334.00 L 319.00,335.00 L 318.00,336.00 L 318.00,337.00 L 317.00,338.00 L 317.00,339.00 L 316.00,340.00 L 316.00,341.00 L 315.00,342.00 L 315.00,343.00 L 314.00,344.00 L 314.00,345.00 L 313.00,346.00 L 313.00,348.00 L 312.00,349.00 L 312.00,350.00 L 311.00,351.00 L 311.00,353.00 L 310.00,354.00 L 310.00,356.00 L 309.00,357.00 L 309.00,359.00 L 308.00,360.00 L 308.00,362.00 L 307.00,363.00 L 307.00,366.00 L 306.00,367.00 L 306.00,369.00 L 305.00,370.00 L 305.00,372.00 L 304.00,373.00 L 304.00,375.00 L 303.00,376.00 L 303.00,378.00 L 302.00,379.00 L 302.00,381.00 L 301.00,382.00 L 301.00,384.00 L 300.00,385.00 L 300.00,386.00 L 299.00,387.00 L 299.00,389.00 L 298.00,390.00 L 298.00,391.00 L 297.00,392.00 L 297.00,393.00 L 295.00,395.00 L 295.00,396.00 L 289.00,402.00 L 288.00,402.00 L 287.00,403.00 L 285.00,403.00 L 284.00,404.00 L 283.00,403.00 L 282.00,404.00 L 281.00,403.00 L 278.00,403.00 L 277.00,402.00 L 276.00,402.00 L 271.00,397.00 L 271.00,396.00 L 269.00,394.00 L 269.00,393.00 L 268.00,392.00 L 268.00,391.00 L 267.00,390.00 L 267.00,389.00 L 266.00,388.00 L 266.00,387.00 L 265.00,386.00 L 265.00,384.00 L 264.00,383.00 L 264.00,381.00 L 263.00,380.00 L 263.00,378.00 L 262.00,377.00 L 262.00,375.00 L 261.00,374.00 L 261.00,372.00 L 260.00,371.00 L 260.00,369.00 L 259.00,368.00 L 259.00,366.00 L 258.00,365.00 L 258.00,363.00 L 257.00,362.00 L 257.00,359.00 L 256.00,358.00 L 256.00,356.00 L 255.00,355.00 L 255.00,353.00 L 254.00,352.00 L 254.00,351.00 L 253.00,350.00 L 253.00,348.00 L 252.00,347.00 L 252.00,345.00 L 251.00,344.00 L 251.00,343.00 L 250.00,342.00 L 250.00,341.00 L 249.00,340.00 L 249.00,339.00 L 248.00,338.00 L 248.00,337.00 L 247.00,336.00 L 247.00,335.00 L 244.00,332.00 L 244.00,331.00 L 241.00,328.00 L 241.00,327.00 L 232.00,318.00 L 231.00,318.00 L 229.00,316.00 L 228.00,316.00 L 225.00,313.00 L 224.00,313.00 L 223.00,312.00 L 222.00,312.00 L 221.00,311.00 L 220.00,311.00 L 218.00,309.00 L 217.00,309.00 L 216.00,308.00 L 215.00,308.00 L 214.00,307.00 L 215.00,306.00 L 216.00,306.00 L 217.00,305.00 L 219.00,305.00 L 220.00,304.00 L 222.00,304.00 L 225.00,301.00 L 226.00,301.00 L 231.00,296.00 L 231.00,295.00 L 232.00,294.00 L 232.00,293.00 L 233.00,292.00 L 233.00,291.00 L 234.00,290.00 L 234.00,288.00 L 235.00,287.00 L 235.00,285.00 L 236.00,284.00 L 236.00,281.00 L 237.00,280.00 L 237.00,274.00 L 238.00,273.00 L 238.00,263.00 L 237.00,262.00 L 237.00,250.00 L 236.00,249.00 L 236.00,248.00 L 237.00,247.00 L 237.00,232.00 L 238.00,231.00 L 238.00,225.00 L 239.00,224.00 L 239.00,222.00 Z M 454.00,193.00 L 455.00,192.00 L 456.00,193.00 L 456.00,194.00 L 457.00,195.00 L 457.00,196.00 L 461.00,200.00 L 461.00,201.00 L 469.00,209.00 L 469.00,210.00 L 476.00,217.00 L 476.00,218.00 L 479.00,221.00 L 479.00,222.00 L 482.00,225.00 L 482.00,226.00 L 483.00,227.00 L 483.00,228.00 L 485.00,230.00 L 485.00,231.00 L 486.00,232.00 L 486.00,233.00 L 487.00,234.00 L 487.00,235.00 L 488.00,236.00 L 488.00,237.00 L 489.00,238.00 L 489.00,239.00 L 490.00,240.00 L 490.00,241.00 L 491.00,242.00 L 491.00,243.00 L 492.00,244.00 L 492.00,245.00 L 493.00,246.00 L 493.00,247.00 L 494.00,248.00 L 494.00,250.00 L 495.00,251.00 L 495.00,252.00 L 496.00,253.00 L 496.00,254.00 L 497.00,255.00 L 497.00,257.00 L 498.00,258.00 L 498.00,259.00 L 499.00,260.00 L 499.00,262.00 L 500.00,263.00 L 500.00,264.00 L 501.00,265.00 L 501.00,266.00 L 502.00,267.00 L 502.00,269.00 L 503.00,270.00 L 503.00,271.00 L 504.00,272.00 L 504.00,274.00 L 505.00,275.00 L 505.00,276.00 L 506.00,277.00 L 506.00,279.00 L 507.00,280.00 L 507.00,281.00 L 508.00,282.00 L 508.00,284.00 L 509.00,285.00 L 509.00,286.00 L 510.00,287.00 L 510.00,289.00 L 511.00,290.00 L 511.00,291.00 L 512.00,292.00 L 512.00,294.00 L 513.00,295.00 L 513.00,296.00 L 514.00,297.00 L 514.00,299.00 L 515.00,300.00 L 515.00,301.00 L 516.00,302.00 L 516.00,303.00 L 517.00,304.00 L 517.00,305.00 L 518.00,306.00 L 518.00,312.00 L 517.00,313.00 L 517.00,315.00 L 512.00,320.00 L 511.00,320.00 L 510.00,321.00 L 509.00,321.00 L 508.00,322.00 L 506.00,322.00 L 505.00,321.00 L 501.00,321.00 L 500.00,320.00 L 499.00,320.00 L 498.00,319.00 L 498.00,318.00 L 497.00,317.00 L 497.00,316.00 L 494.00,313.00 L 494.00,312.00 L 487.00,305.00 L 486.00,305.00 L 481.00,300.00 L 480.00,300.00 L 475.00,295.00 L 474.00,295.00 L 456.00,277.00 L 456.00,276.00 L 452.00,272.00 L 452.00,271.00 L 450.00,269.00 L 450.00,268.00 L 448.00,266.00 L 448.00,265.00 L 446.00,263.00 L 446.00,262.00 L 444.00,260.00 L 444.00,259.00 L 443.00,258.00 L 443.00,257.00 L 441.00,255.00 L 441.00,254.00 L 440.00,253.00 L 440.00,252.00 L 439.00,251.00 L 439.00,250.00 L 438.00,249.00 L 438.00,248.00 L 437.00,247.00 L 437.00,246.00 L 436.00,245.00 L 436.00,244.00 L 435.00,243.00 L 435.00,242.00 L 434.00,241.00 L 434.00,240.00 L 433.00,239.00 L 433.00,238.00 L 432.00,237.00 L 432.00,236.00 L 430.00,234.00 L 430.00,233.00 L 428.00,231.00 L 428.00,230.00 L 425.00,227.00 L 425.00,226.00 L 423.00,224.00 L 423.00,223.00 L 424.00,222.00 L 426.00,224.00 L 427.00,224.00 L 428.00,225.00 L 430.00,225.00 L 431.00,226.00 L 433.00,226.00 L 434.00,227.00 L 442.00,227.00 L 443.00,226.00 L 445.00,226.00 L 447.00,224.00 L 448.00,224.00 L 452.00,220.00 L 452.00,219.00 L 453.00,218.00 L 453.00,216.00 L 454.00,215.00 L 454.00,211.00 L 455.00,210.00 L 455.00,199.00 L 454.00,198.00 L 454.00,194.00 Z M 453.00,192.00 L 454.00,191.00 L 455.00,192.00 L 454.00,193.00 Z M 110.00,192.00 L 111.00,191.00 L 112.00,192.00 L 112.00,194.00 L 111.00,195.00 L 111.00,203.00 L 110.00,204.00 L 110.00,208.00 L 111.00,209.00 L 111.00,214.00 L 112.00,215.00 L 112.00,217.00 L 113.00,218.00 L 113.00,219.00 L 115.00,221.00 L 115.00,222.00 L 116.00,223.00 L 117.00,223.00 L 120.00,226.00 L 122.00,226.00 L 123.00,227.00 L 132.00,227.00 L 133.00,226.00 L 135.00,226.00 L 136.00,225.00 L 137.00,225.00 L 138.00,224.00 L 139.00,224.00 L 140.00,223.00 L 141.00,223.00 L 142.00,224.00 L 141.00,225.00 L 141.00,226.00 L 138.00,229.00 L 138.00,230.00 L 136.00,232.00 L 136.00,233.00 L 134.00,235.00 L 134.00,236.00 L 133.00,237.00 L 133.00,238.00 L 131.00,240.00 L 131.00,241.00 L 130.00,242.00 L 130.00,243.00 L 129.00,244.00 L 129.00,245.00 L 128.00,246.00 L 128.00,247.00 L 127.00,248.00 L 127.00,249.00 L 126.00,250.00 L 126.00,251.00 L 125.00,252.00 L 125.00,253.00 L 124.00,254.00 L 124.00,255.00 L 123.00,256.00 L 123.00,257.00 L 121.00,259.00 L 121.00,260.00 L 120.00,261.00 L 120.00,262.00 L 118.00,264.00 L 118.00,265.00 L 116.00,267.00 L 116.00,268.00 L 114.00,270.00 L 114.00,271.00 L 111.00,274.00 L 111.00,275.00 L 105.00,281.00 L 105.00,282.00 L 97.00,290.00 L 96.00,290.00 L 90.00,296.00 L 89.00,296.00 L 84.00,301.00 L 83.00,301.00 L 76.00,308.00 L 75.00,308.00 L 72.00,311.00 L 72.00,312.00 L 69.00,315.00 L 69.00,316.00 L 68.00,317.00 L 68.00,318.00 L 65.00,321.00 L 61.00,321.00 L 60.00,322.00 L 57.00,322.00 L 56.00,321.00 L 55.00,321.00 L 54.00,320.00 L 53.00,320.00 L 49.00,316.00 L 49.00,315.00 L 48.00,314.00 L 48.00,313.00 L 47.00,312.00 L 47.00,307.00 L 48.00,306.00 L 48.00,305.00 L 49.00,304.00 L 49.00,303.00 L 50.00,302.00 L 50.00,300.00 L 51.00,299.00 L 51.00,298.00 L 52.00,297.00 L 52.00,295.00 L 53.00,294.00 L 53.00,293.00 L 54.00,292.00 L 54.00,290.00 L 55.00,289.00 L 55.00,288.00 L 56.00,287.00 L 56.00,286.00 L 57.00,285.00 L 57.00,283.00 L 58.00,282.00 L 58.00,280.00 L 59.00,279.00 L 59.00,278.00 L 60.00,277.00 L 60.00,275.00 L 61.00,274.00 L 61.00,273.00 L 62.00,272.00 L 62.00,271.00 L 63.00,270.00 L 63.00,268.00 L 64.00,267.00 L 64.00,266.00 L 65.00,265.00 L 65.00,263.00 L 66.00,262.00 L 66.00,261.00 L 67.00,260.00 L 67.00,258.00 L 68.00,257.00 L 68.00,256.00 L 69.00,255.00 L 69.00,254.00 L 70.00,253.00 L 70.00,251.00 L 71.00,250.00 L 71.00,249.00 L 72.00,248.00 L 72.00,247.00 L 73.00,246.00 L 73.00,245.00 L 74.00,244.00 L 74.00,243.00 L 75.00,242.00 L 75.00,241.00 L 76.00,240.00 L 76.00,238.00 L 77.00,237.00 L 77.00,236.00 L 79.00,234.00 L 79.00,233.00 L 80.00,232.00 L 80.00,231.00 L 81.00,230.00 L 81.00,229.00 L 83.00,227.00 L 83.00,226.00 L 84.00,225.00 L 84.00,224.00 L 87.00,221.00 L 87.00,220.00 L 91.00,216.00 L 91.00,215.00 L 99.00,207.00 L 99.00,206.00 L 106.00,199.00 L 106.00,198.00 L 109.00,195.00 L 109.00,194.00 L 110.00,193.00 Z M 352.00,162.00 L 353.00,161.00 L 354.00,161.00 L 355.00,162.00 L 352.00,165.00 L 351.00,165.00 L 341.00,175.00 L 340.00,175.00 L 328.00,187.00 L 327.00,186.00 L 327.00,184.00 L 328.00,183.00 L 328.00,180.00 L 329.00,179.00 L 329.00,173.00 L 328.00,172.00 L 328.00,171.00 L 323.00,166.00 L 324.00,165.00 L 325.00,165.00 L 326.00,166.00 L 336.00,166.00 L 337.00,165.00 L 342.00,165.00 L 343.00,164.00 L 346.00,164.00 L 347.00,163.00 L 349.00,163.00 L 350.00,162.00 L 351.00,162.00 Z M 211.00,162.00 L 212.00,161.00 L 213.00,161.00 L 214.00,162.00 L 215.00,162.00 L 216.00,163.00 L 218.00,163.00 L 219.00,164.00 L 222.00,164.00 L 223.00,165.00 L 228.00,165.00 L 229.00,166.00 L 239.00,166.00 L 240.00,165.00 L 241.00,165.00 L 242.00,166.00 L 238.00,170.00 L 238.00,171.00 L 237.00,172.00 L 237.00,173.00 L 236.00,174.00 L 236.00,177.00 L 237.00,178.00 L 237.00,182.00 L 238.00,183.00 L 238.00,186.00 L 237.00,187.00 L 222.00,172.00 L 221.00,172.00 L 212.00,163.00 Z M 354.00,161.00 L 355.00,160.00 L 356.00,161.00 L 355.00,162.00 Z M 265.00,159.00 L 266.00,158.00 L 277.00,158.00 L 278.00,159.00 L 279.00,159.00 L 280.00,160.00 L 280.00,161.00 L 281.00,162.00 L 281.00,163.00 L 282.00,164.00 L 282.00,166.00 L 283.00,166.00 L 284.00,165.00 L 284.00,162.00 L 288.00,158.00 L 299.00,158.00 L 300.00,159.00 L 303.00,159.00 L 304.00,160.00 L 306.00,160.00 L 307.00,161.00 L 309.00,161.00 L 310.00,162.00 L 311.00,162.00 L 312.00,163.00 L 314.00,163.00 L 315.00,164.00 L 316.00,164.00 L 317.00,165.00 L 318.00,165.00 L 319.00,166.00 L 320.00,166.00 L 323.00,169.00 L 324.00,169.00 L 325.00,170.00 L 325.00,171.00 L 327.00,173.00 L 327.00,180.00 L 326.00,181.00 L 326.00,184.00 L 325.00,185.00 L 325.00,188.00 L 324.00,189.00 L 324.00,194.00 L 323.00,195.00 L 323.00,240.00 L 322.00,241.00 L 322.00,258.00 L 321.00,259.00 L 321.00,276.00 L 320.00,277.00 L 320.00,288.00 L 319.00,289.00 L 319.00,296.00 L 318.00,297.00 L 318.00,301.00 L 317.00,302.00 L 317.00,305.00 L 316.00,306.00 L 316.00,309.00 L 315.00,310.00 L 315.00,312.00 L 314.00,313.00 L 314.00,315.00 L 313.00,316.00 L 313.00,318.00 L 312.00,319.00 L 312.00,321.00 L 311.00,322.00 L 311.00,323.00 L 310.00,324.00 L 310.00,325.00 L 309.00,326.00 L 309.00,327.00 L 308.00,328.00 L 308.00,329.00 L 307.00,330.00 L 307.00,331.00 L 306.00,332.00 L 306.00,333.00 L 305.00,334.00 L 305.00,335.00 L 304.00,336.00 L 304.00,337.00 L 302.00,339.00 L 302.00,340.00 L 300.00,342.00 L 300.00,343.00 L 299.00,344.00 L 299.00,345.00 L 288.00,356.00 L 287.00,356.00 L 286.00,357.00 L 285.00,357.00 L 284.00,358.00 L 282.00,358.00 L 281.00,357.00 L 279.00,357.00 L 277.00,355.00 L 276.00,355.00 L 269.00,348.00 L 269.00,347.00 L 265.00,343.00 L 265.00,342.00 L 264.00,341.00 L 264.00,340.00 L 262.00,338.00 L 262.00,337.00 L 260.00,335.00 L 260.00,334.00 L 259.00,333.00 L 259.00,332.00 L 258.00,331.00 L 258.00,330.00 L 257.00,329.00 L 257.00,328.00 L 256.00,327.00 L 256.00,326.00 L 255.00,325.00 L 255.00,324.00 L 254.00,323.00 L 254.00,321.00 L 253.00,320.00 L 253.00,318.00 L 252.00,317.00 L 252.00,315.00 L 251.00,314.00 L 251.00,312.00 L 250.00,311.00 L 250.00,309.00 L 249.00,308.00 L 249.00,305.00 L 248.00,304.00 L 248.00,301.00 L 247.00,300.00 L 247.00,294.00 L 246.00,293.00 L 246.00,285.00 L 245.00,284.00 L 245.00,269.00 L 244.00,268.00 L 244.00,254.00 L 243.00,253.00 L 243.00,230.00 L 242.00,229.00 L 242.00,193.00 L 241.00,192.00 L 241.00,188.00 L 240.00,187.00 L 240.00,184.00 L 239.00,183.00 L 239.00,180.00 L 238.00,179.00 L 238.00,174.00 L 239.00,173.00 L 239.00,172.00 L 244.00,167.00 L 245.00,167.00 L 246.00,166.00 L 247.00,166.00 L 249.00,164.00 L 251.00,164.00 L 252.00,163.00 L 253.00,163.00 L 254.00,162.00 L 256.00,162.00 L 257.00,161.00 L 258.00,161.00 L 259.00,160.00 L 261.00,160.00 L 262.00,159.00 L 264.00,159.00 Z M 282.00,293.00 L 281.00,294.00 L 281.00,348.00 L 282.00,349.00 L 283.00,349.00 L 284.00,348.00 L 284.00,294.00 L 283.00,293.00 Z M 257.00,272.00 L 257.00,273.00 L 258.00,274.00 L 270.00,274.00 L 271.00,275.00 L 275.00,275.00 L 276.00,276.00 L 279.00,276.00 L 281.00,278.00 L 281.00,281.00 L 282.00,282.00 L 282.00,287.00 L 283.00,287.00 L 284.00,286.00 L 284.00,279.00 L 287.00,276.00 L 289.00,276.00 L 290.00,275.00 L 294.00,275.00 L 295.00,274.00 L 308.00,274.00 L 308.00,272.00 L 297.00,272.00 L 296.00,273.00 L 291.00,273.00 L 290.00,274.00 L 286.00,274.00 L 285.00,275.00 L 284.00,275.00 L 283.00,276.00 L 282.00,276.00 L 281.00,275.00 L 280.00,275.00 L 279.00,274.00 L 275.00,274.00 L 274.00,273.00 L 269.00,273.00 L 268.00,272.00 L 258.00,272.00 Z M 282.00,253.00 L 282.00,259.00 L 281.00,260.00 L 281.00,265.00 L 279.00,267.00 L 278.00,267.00 L 277.00,268.00 L 256.00,268.00 L 255.00,267.00 L 251.00,267.00 L 251.00,269.00 L 262.00,269.00 L 263.00,270.00 L 276.00,270.00 L 277.00,269.00 L 279.00,269.00 L 280.00,268.00 L 281.00,268.00 L 283.00,266.00 L 286.00,269.00 L 288.00,269.00 L 289.00,270.00 L 303.00,270.00 L 304.00,269.00 L 314.00,269.00 L 315.00,268.00 L 314.00,267.00 L 310.00,267.00 L 309.00,268.00 L 288.00,268.00 L 287.00,267.00 L 286.00,267.00 L 285.00,266.00 L 285.00,265.00 L 284.00,264.00 L 284.00,254.00 L 283.00,253.00 Z M 282.00,211.00 L 282.00,222.00 L 281.00,223.00 L 281.00,225.00 L 279.00,227.00 L 278.00,227.00 L 277.00,228.00 L 273.00,228.00 L 272.00,229.00 L 265.00,229.00 L 264.00,230.00 L 250.00,230.00 L 250.00,231.00 L 263.00,231.00 L 264.00,232.00 L 263.00,233.00 L 260.00,233.00 L 259.00,234.00 L 257.00,234.00 L 257.00,235.00 L 264.00,235.00 L 265.00,234.00 L 278.00,234.00 L 281.00,237.00 L 281.00,240.00 L 282.00,241.00 L 282.00,245.00 L 283.00,245.00 L 284.00,244.00 L 284.00,237.00 L 287.00,234.00 L 300.00,234.00 L 301.00,235.00 L 308.00,235.00 L 308.00,234.00 L 306.00,234.00 L 305.00,233.00 L 302.00,233.00 L 301.00,232.00 L 302.00,231.00 L 316.00,231.00 L 316.00,230.00 L 301.00,230.00 L 300.00,229.00 L 293.00,229.00 L 292.00,228.00 L 288.00,228.00 L 287.00,227.00 L 286.00,227.00 L 284.00,225.00 L 284.00,212.00 L 283.00,211.00 Z M 281.00,228.00 L 282.00,227.00 L 283.00,227.00 L 284.00,228.00 L 285.00,228.00 L 286.00,229.00 L 287.00,229.00 L 288.00,230.00 L 291.00,230.00 L 292.00,231.00 L 291.00,232.00 L 288.00,232.00 L 287.00,233.00 L 286.00,233.00 L 285.00,234.00 L 284.00,234.00 L 284.00,235.00 L 283.00,236.00 L 280.00,233.00 L 278.00,233.00 L 277.00,232.00 L 274.00,232.00 L 273.00,231.00 L 274.00,230.00 L 277.00,230.00 L 278.00,229.00 L 280.00,229.00 Z M 270.00,192.00 L 269.00,193.00 L 263.00,193.00 L 262.00,194.00 L 259.00,194.00 L 258.00,195.00 L 257.00,195.00 L 257.00,196.00 L 261.00,196.00 L 262.00,195.00 L 266.00,195.00 L 267.00,194.00 L 276.00,194.00 L 277.00,195.00 L 278.00,195.00 L 281.00,198.00 L 281.00,200.00 L 282.00,201.00 L 282.00,204.00 L 283.00,204.00 L 284.00,203.00 L 284.00,198.00 L 287.00,195.00 L 289.00,195.00 L 290.00,194.00 L 299.00,194.00 L 300.00,195.00 L 303.00,195.00 L 304.00,196.00 L 308.00,196.00 L 308.00,195.00 L 307.00,195.00 L 306.00,194.00 L 303.00,194.00 L 302.00,193.00 L 296.00,193.00 L 295.00,192.00 L 290.00,192.00 L 289.00,193.00 L 287.00,193.00 L 286.00,194.00 L 285.00,194.00 L 283.00,196.00 L 282.00,196.00 L 280.00,194.00 L 279.00,194.00 L 278.00,193.00 L 276.00,193.00 L 275.00,192.00 L 271.00,192.00 Z M 282.00,173.00 L 282.00,180.00 L 281.00,181.00 L 281.00,185.00 L 280.00,186.00 L 280.00,187.00 L 279.00,188.00 L 270.00,188.00 L 269.00,189.00 L 263.00,189.00 L 262.00,190.00 L 259.00,190.00 L 258.00,191.00 L 255.00,191.00 L 254.00,192.00 L 251.00,192.00 L 250.00,193.00 L 248.00,193.00 L 247.00,194.00 L 248.00,195.00 L 249.00,195.00 L 250.00,194.00 L 252.00,194.00 L 253.00,193.00 L 256.00,193.00 L 257.00,192.00 L 261.00,192.00 L 262.00,191.00 L 267.00,191.00 L 268.00,190.00 L 279.00,190.00 L 280.00,189.00 L 281.00,189.00 L 281.00,188.00 L 282.00,187.00 L 283.00,187.00 L 286.00,190.00 L 298.00,190.00 L 299.00,191.00 L 303.00,191.00 L 304.00,192.00 L 308.00,192.00 L 309.00,193.00 L 312.00,193.00 L 313.00,194.00 L 315.00,194.00 L 316.00,195.00 L 318.00,195.00 L 318.00,194.00 L 317.00,193.00 L 315.00,193.00 L 314.00,192.00 L 311.00,192.00 L 310.00,191.00 L 307.00,191.00 L 306.00,190.00 L 303.00,190.00 L 302.00,189.00 L 297.00,189.00 L 296.00,188.00 L 287.00,188.00 L 284.00,185.00 L 284.00,174.00 L 283.00,173.00 Z M 298.00,156.00 L 299.00,155.00 L 300.00,156.00 L 299.00,157.00 Z M 377.00,142.00 L 378.00,141.00 L 379.00,142.00 L 379.00,143.00 L 378.00,144.00 L 378.00,162.00 L 379.00,163.00 L 379.00,167.00 L 380.00,168.00 L 380.00,176.00 L 379.00,177.00 L 379.00,179.00 L 378.00,180.00 L 378.00,183.00 L 377.00,184.00 L 377.00,186.00 L 376.00,187.00 L 376.00,189.00 L 375.00,190.00 L 375.00,192.00 L 374.00,193.00 L 374.00,195.00 L 373.00,196.00 L 373.00,197.00 L 372.00,198.00 L 372.00,200.00 L 371.00,201.00 L 371.00,202.00 L 370.00,203.00 L 370.00,205.00 L 369.00,206.00 L 369.00,207.00 L 368.00,208.00 L 368.00,209.00 L 367.00,210.00 L 367.00,211.00 L 366.00,212.00 L 366.00,214.00 L 365.00,215.00 L 365.00,216.00 L 364.00,217.00 L 364.00,218.00 L 363.00,219.00 L 363.00,220.00 L 362.00,221.00 L 362.00,222.00 L 361.00,223.00 L 361.00,224.00 L 360.00,225.00 L 360.00,226.00 L 359.00,227.00 L 359.00,229.00 L 358.00,230.00 L 358.00,232.00 L 357.00,233.00 L 357.00,236.00 L 356.00,237.00 L 356.00,244.00 L 355.00,245.00 L 355.00,254.00 L 356.00,255.00 L 356.00,264.00 L 357.00,265.00 L 357.00,272.00 L 358.00,273.00 L 358.00,281.00 L 359.00,282.00 L 359.00,292.00 L 360.00,293.00 L 360.00,301.00 L 361.00,302.00 L 361.00,303.00 L 359.00,305.00 L 352.00,305.00 L 351.00,304.00 L 348.00,304.00 L 347.00,303.00 L 346.00,303.00 L 345.00,302.00 L 344.00,302.00 L 343.00,301.00 L 342.00,301.00 L 336.00,295.00 L 336.00,294.00 L 335.00,293.00 L 335.00,292.00 L 333.00,290.00 L 333.00,288.00 L 332.00,287.00 L 332.00,285.00 L 331.00,284.00 L 331.00,281.00 L 330.00,280.00 L 330.00,275.00 L 329.00,274.00 L 329.00,262.00 L 330.00,261.00 L 330.00,233.00 L 329.00,232.00 L 329.00,225.00 L 328.00,224.00 L 328.00,219.00 L 327.00,218.00 L 327.00,213.00 L 326.00,212.00 L 326.00,206.00 L 325.00,205.00 L 325.00,196.00 L 326.00,195.00 L 326.00,193.00 L 327.00,192.00 L 327.00,191.00 L 331.00,187.00 L 331.00,186.00 L 335.00,182.00 L 336.00,182.00 L 345.00,173.00 L 346.00,173.00 L 355.00,164.00 L 356.00,164.00 L 372.00,148.00 L 372.00,147.00 L 376.00,143.00 Z M 186.00,141.00 L 187.00,140.00 L 189.00,142.00 L 189.00,143.00 L 196.00,150.00 L 196.00,151.00 L 203.00,158.00 L 204.00,158.00 L 217.00,171.00 L 218.00,171.00 L 227.00,180.00 L 228.00,180.00 L 237.00,189.00 L 237.00,190.00 L 239.00,192.00 L 239.00,193.00 L 240.00,194.00 L 240.00,207.00 L 239.00,208.00 L 239.00,214.00 L 238.00,215.00 L 238.00,220.00 L 237.00,221.00 L 237.00,226.00 L 236.00,227.00 L 236.00,234.00 L 235.00,235.00 L 235.00,258.00 L 236.00,259.00 L 236.00,276.00 L 235.00,277.00 L 235.00,281.00 L 234.00,282.00 L 234.00,285.00 L 233.00,286.00 L 233.00,288.00 L 232.00,289.00 L 232.00,290.00 L 231.00,291.00 L 231.00,292.00 L 230.00,293.00 L 230.00,294.00 L 222.00,302.00 L 221.00,302.00 L 220.00,303.00 L 218.00,303.00 L 217.00,304.00 L 214.00,304.00 L 213.00,305.00 L 206.00,305.00 L 205.00,304.00 L 205.00,295.00 L 206.00,294.00 L 206.00,285.00 L 207.00,284.00 L 207.00,276.00 L 208.00,275.00 L 208.00,268.00 L 209.00,267.00 L 209.00,259.00 L 210.00,258.00 L 210.00,241.00 L 209.00,240.00 L 209.00,236.00 L 208.00,235.00 L 208.00,232.00 L 207.00,231.00 L 207.00,229.00 L 206.00,228.00 L 206.00,227.00 L 205.00,226.00 L 205.00,224.00 L 204.00,223.00 L 204.00,222.00 L 203.00,221.00 L 203.00,220.00 L 202.00,219.00 L 202.00,218.00 L 201.00,217.00 L 201.00,216.00 L 200.00,215.00 L 200.00,214.00 L 199.00,213.00 L 199.00,212.00 L 198.00,211.00 L 198.00,210.00 L 197.00,209.00 L 197.00,207.00 L 196.00,206.00 L 196.00,205.00 L 195.00,204.00 L 195.00,203.00 L 194.00,202.00 L 194.00,200.00 L 193.00,199.00 L 193.00,197.00 L 192.00,196.00 L 192.00,195.00 L 191.00,194.00 L 191.00,192.00 L 190.00,191.00 L 190.00,189.00 L 189.00,188.00 L 189.00,186.00 L 188.00,185.00 L 188.00,183.00 L 187.00,182.00 L 187.00,179.00 L 186.00,178.00 L 186.00,175.00 L 185.00,174.00 L 185.00,169.00 L 186.00,168.00 L 186.00,165.00 L 187.00,164.00 L 187.00,157.00 L 188.00,156.00 L 188.00,149.00 L 187.00,148.00 L 187.00,143.00 L 186.00,142.00 Z M 140.00,136.00 L 141.00,135.00 L 142.00,136.00 L 141.00,137.00 Z M 281.00,135.00 L 282.00,134.00 L 283.00,134.00 L 284.00,135.00 L 284.00,136.00 L 285.00,137.00 L 285.00,139.00 L 286.00,140.00 L 286.00,141.00 L 288.00,143.00 L 288.00,144.00 L 291.00,147.00 L 291.00,148.00 L 296.00,153.00 L 297.00,153.00 L 299.00,155.00 L 298.00,156.00 L 290.00,156.00 L 289.00,157.00 L 287.00,157.00 L 286.00,158.00 L 285.00,158.00 L 283.00,160.00 L 282.00,160.00 L 279.00,157.00 L 277.00,157.00 L 276.00,156.00 L 268.00,156.00 L 267.00,155.00 L 276.00,146.00 L 276.00,145.00 L 278.00,143.00 L 278.00,142.00 L 280.00,140.00 L 280.00,138.00 L 281.00,137.00 L 281.00,136.00 Z M 396.00,133.00 L 397.00,132.00 L 404.00,132.00 L 405.00,133.00 L 410.00,133.00 L 411.00,134.00 L 414.00,134.00 L 415.00,135.00 L 417.00,135.00 L 418.00,136.00 L 419.00,136.00 L 420.00,137.00 L 421.00,137.00 L 422.00,138.00 L 423.00,138.00 L 424.00,139.00 L 425.00,139.00 L 431.00,145.00 L 431.00,146.00 L 434.00,149.00 L 434.00,150.00 L 436.00,152.00 L 436.00,153.00 L 437.00,154.00 L 437.00,155.00 L 438.00,156.00 L 438.00,157.00 L 440.00,159.00 L 440.00,160.00 L 441.00,161.00 L 441.00,163.00 L 442.00,164.00 L 442.00,165.00 L 443.00,166.00 L 443.00,167.00 L 444.00,168.00 L 444.00,169.00 L 445.00,170.00 L 445.00,172.00 L 446.00,173.00 L 446.00,174.00 L 447.00,175.00 L 447.00,177.00 L 448.00,178.00 L 448.00,180.00 L 449.00,181.00 L 449.00,183.00 L 450.00,184.00 L 450.00,187.00 L 451.00,188.00 L 451.00,191.00 L 452.00,192.00 L 452.00,196.00 L 453.00,197.00 L 453.00,212.00 L 452.00,213.00 L 452.00,216.00 L 451.00,217.00 L 451.00,218.00 L 445.00,224.00 L 444.00,224.00 L 443.00,225.00 L 438.00,225.00 L 437.00,226.00 L 436.00,225.00 L 432.00,225.00 L 431.00,224.00 L 430.00,224.00 L 429.00,223.00 L 428.00,223.00 L 427.00,222.00 L 426.00,222.00 L 424.00,220.00 L 423.00,220.00 L 413.00,210.00 L 413.00,209.00 L 409.00,205.00 L 409.00,204.00 L 406.00,201.00 L 406.00,200.00 L 403.00,197.00 L 403.00,196.00 L 400.00,193.00 L 400.00,192.00 L 389.00,181.00 L 389.00,180.00 L 386.00,177.00 L 386.00,176.00 L 384.00,174.00 L 384.00,173.00 L 383.00,172.00 L 383.00,171.00 L 382.00,170.00 L 382.00,169.00 L 381.00,168.00 L 381.00,165.00 L 380.00,164.00 L 380.00,158.00 L 379.00,157.00 L 379.00,148.00 L 380.00,147.00 L 380.00,143.00 L 381.00,142.00 L 381.00,141.00 L 382.00,140.00 L 382.00,139.00 L 387.00,134.00 L 389.00,134.00 L 390.00,133.00 L 395.00,133.00 Z M 161.00,133.00 L 162.00,132.00 L 169.00,132.00 L 170.00,133.00 L 176.00,133.00 L 177.00,134.00 L 178.00,134.00 L 180.00,136.00 L 181.00,136.00 L 182.00,137.00 L 182.00,138.00 L 184.00,140.00 L 184.00,141.00 L 185.00,142.00 L 185.00,145.00 L 186.00,146.00 L 186.00,159.00 L 185.00,160.00 L 185.00,165.00 L 184.00,166.00 L 184.00,168.00 L 183.00,169.00 L 183.00,171.00 L 182.00,172.00 L 182.00,173.00 L 180.00,175.00 L 180.00,176.00 L 178.00,178.00 L 178.00,179.00 L 166.00,191.00 L 166.00,192.00 L 163.00,195.00 L 163.00,196.00 L 160.00,199.00 L 160.00,200.00 L 157.00,203.00 L 157.00,204.00 L 154.00,207.00 L 154.00,208.00 L 147.00,215.00 L 147.00,216.00 L 146.00,217.00 L 145.00,217.00 L 141.00,221.00 L 140.00,221.00 L 139.00,222.00 L 138.00,222.00 L 137.00,223.00 L 136.00,223.00 L 135.00,224.00 L 134.00,224.00 L 133.00,225.00 L 122.00,225.00 L 121.00,224.00 L 120.00,224.00 L 116.00,220.00 L 116.00,219.00 L 114.00,217.00 L 114.00,216.00 L 113.00,215.00 L 113.00,212.00 L 112.00,211.00 L 112.00,200.00 L 113.00,199.00 L 113.00,194.00 L 114.00,193.00 L 114.00,189.00 L 115.00,188.00 L 115.00,186.00 L 116.00,185.00 L 116.00,182.00 L 117.00,181.00 L 117.00,180.00 L 118.00,179.00 L 118.00,177.00 L 119.00,176.00 L 119.00,174.00 L 120.00,173.00 L 120.00,171.00 L 121.00,170.00 L 121.00,169.00 L 122.00,168.00 L 122.00,166.00 L 123.00,165.00 L 123.00,164.00 L 124.00,163.00 L 124.00,162.00 L 125.00,161.00 L 125.00,160.00 L 126.00,159.00 L 126.00,158.00 L 127.00,157.00 L 127.00,156.00 L 129.00,154.00 L 129.00,153.00 L 130.00,152.00 L 130.00,151.00 L 132.00,149.00 L 132.00,148.00 L 135.00,145.00 L 135.00,144.00 L 139.00,140.00 L 140.00,140.00 L 142.00,138.00 L 143.00,138.00 L 144.00,137.00 L 145.00,137.00 L 146.00,136.00 L 148.00,136.00 L 149.00,135.00 L 150.00,135.00 L 151.00,134.00 L 154.00,134.00 L 155.00,133.00 L 160.00,133.00 Z M 303.00,69.00 L 304.00,68.00 L 318.00,68.00 L 319.00,69.00 L 324.00,69.00 L 325.00,70.00 L 327.00,70.00 L 328.00,71.00 L 331.00,71.00 L 332.00,72.00 L 333.00,72.00 L 334.00,73.00 L 336.00,73.00 L 337.00,74.00 L 338.00,74.00 L 339.00,75.00 L 340.00,75.00 L 342.00,77.00 L 343.00,77.00 L 345.00,79.00 L 346.00,79.00 L 352.00,85.00 L 353.00,85.00 L 354.00,86.00 L 354.00,87.00 L 358.00,91.00 L 358.00,92.00 L 361.00,95.00 L 361.00,96.00 L 364.00,99.00 L 364.00,100.00 L 368.00,104.00 L 368.00,105.00 L 374.00,111.00 L 374.00,112.00 L 379.00,117.00 L 380.00,117.00 L 388.00,125.00 L 389.00,125.00 L 392.00,128.00 L 393.00,128.00 L 395.00,130.00 L 394.00,131.00 L 389.00,131.00 L 388.00,132.00 L 386.00,132.00 L 384.00,134.00 L 383.00,134.00 L 381.00,136.00 L 380.00,136.00 L 367.00,149.00 L 367.00,150.00 L 365.00,152.00 L 364.00,152.00 L 361.00,155.00 L 360.00,155.00 L 358.00,157.00 L 357.00,157.00 L 356.00,158.00 L 355.00,158.00 L 354.00,159.00 L 353.00,159.00 L 352.00,160.00 L 350.00,160.00 L 349.00,161.00 L 347.00,161.00 L 346.00,162.00 L 344.00,162.00 L 343.00,163.00 L 339.00,163.00 L 338.00,164.00 L 323.00,164.00 L 322.00,163.00 L 319.00,163.00 L 318.00,162.00 L 316.00,162.00 L 315.00,161.00 L 313.00,161.00 L 312.00,160.00 L 311.00,160.00 L 310.00,159.00 L 309.00,159.00 L 308.00,158.00 L 307.00,158.00 L 306.00,157.00 L 305.00,157.00 L 304.00,156.00 L 303.00,156.00 L 300.00,153.00 L 299.00,153.00 L 290.00,144.00 L 290.00,143.00 L 289.00,142.00 L 289.00,141.00 L 287.00,139.00 L 287.00,138.00 L 286.00,137.00 L 286.00,135.00 L 285.00,134.00 L 285.00,132.00 L 284.00,131.00 L 284.00,81.00 L 285.00,80.00 L 285.00,79.00 L 286.00,78.00 L 286.00,77.00 L 289.00,74.00 L 290.00,74.00 L 292.00,72.00 L 293.00,72.00 L 294.00,71.00 L 295.00,71.00 L 296.00,70.00 L 298.00,70.00 L 299.00,69.00 L 302.00,69.00 Z M 246.00,69.00 L 247.00,68.00 L 262.00,68.00 L 263.00,69.00 L 267.00,69.00 L 268.00,70.00 L 269.00,70.00 L 270.00,71.00 L 272.00,71.00 L 274.00,73.00 L 275.00,73.00 L 280.00,78.00 L 280.00,80.00 L 281.00,81.00 L 281.00,83.00 L 282.00,84.00 L 282.00,125.00 L 281.00,126.00 L 281.00,132.00 L 280.00,133.00 L 280.00,135.00 L 279.00,136.00 L 279.00,137.00 L 278.00,138.00 L 278.00,139.00 L 277.00,140.00 L 277.00,141.00 L 275.00,143.00 L 275.00,144.00 L 266.00,153.00 L 265.00,153.00 L 262.00,156.00 L 261.00,156.00 L 259.00,158.00 L 258.00,158.00 L 257.00,159.00 L 256.00,159.00 L 255.00,160.00 L 253.00,160.00 L 252.00,161.00 L 250.00,161.00 L 249.00,162.00 L 248.00,162.00 L 247.00,163.00 L 243.00,163.00 L 242.00,164.00 L 227.00,164.00 L 226.00,163.00 L 222.00,163.00 L 221.00,162.00 L 219.00,162.00 L 218.00,161.00 L 216.00,161.00 L 215.00,160.00 L 213.00,160.00 L 212.00,159.00 L 211.00,159.00 L 209.00,157.00 L 208.00,157.00 L 207.00,156.00 L 206.00,156.00 L 204.00,154.00 L 203.00,154.00 L 184.00,135.00 L 183.00,135.00 L 181.00,133.00 L 180.00,133.00 L 179.00,132.00 L 177.00,132.00 L 176.00,131.00 L 171.00,131.00 L 170.00,130.00 L 172.00,128.00 L 173.00,128.00 L 175.00,126.00 L 176.00,126.00 L 180.00,122.00 L 181.00,122.00 L 192.00,111.00 L 192.00,110.00 L 198.00,104.00 L 198.00,103.00 L 202.00,99.00 L 202.00,98.00 L 205.00,95.00 L 205.00,94.00 L 208.00,91.00 L 208.00,90.00 L 218.00,80.00 L 219.00,80.00 L 222.00,77.00 L 223.00,77.00 L 224.00,76.00 L 225.00,76.00 L 226.00,75.00 L 227.00,75.00 L 228.00,74.00 L 229.00,74.00 L 230.00,73.00 L 231.00,73.00 L 232.00,72.00 L 234.00,72.00 L 235.00,71.00 L 237.00,71.00 L 238.00,70.00 L 241.00,70.00 L 242.00,69.00 L 245.00,69.00 Z M 349.00,66.00 L 350.00,65.00 L 363.00,65.00 L 364.00,66.00 L 370.00,66.00 L 371.00,67.00 L 374.00,67.00 L 375.00,68.00 L 378.00,68.00 L 379.00,69.00 L 382.00,69.00 L 383.00,70.00 L 385.00,70.00 L 386.00,71.00 L 387.00,71.00 L 388.00,72.00 L 389.00,72.00 L 390.00,73.00 L 391.00,73.00 L 392.00,74.00 L 393.00,74.00 L 396.00,77.00 L 397.00,77.00 L 406.00,86.00 L 406.00,87.00 L 408.00,89.00 L 408.00,90.00 L 409.00,91.00 L 409.00,92.00 L 411.00,94.00 L 411.00,95.00 L 412.00,96.00 L 412.00,98.00 L 413.00,99.00 L 413.00,100.00 L 414.00,101.00 L 414.00,103.00 L 415.00,104.00 L 415.00,106.00 L 416.00,107.00 L 416.00,109.00 L 417.00,110.00 L 417.00,111.00 L 418.00,112.00 L 418.00,114.00 L 419.00,115.00 L 419.00,117.00 L 420.00,118.00 L 420.00,120.00 L 421.00,121.00 L 421.00,123.00 L 422.00,124.00 L 422.00,127.00 L 423.00,128.00 L 423.00,130.00 L 424.00,131.00 L 424.00,134.00 L 425.00,135.00 L 425.00,136.00 L 424.00,137.00 L 423.00,136.00 L 422.00,136.00 L 421.00,135.00 L 420.00,135.00 L 419.00,134.00 L 417.00,134.00 L 416.00,133.00 L 415.00,133.00 L 414.00,132.00 L 410.00,132.00 L 409.00,131.00 L 406.00,131.00 L 405.00,130.00 L 402.00,130.00 L 401.00,129.00 L 399.00,129.00 L 398.00,128.00 L 396.00,128.00 L 395.00,127.00 L 394.00,127.00 L 392.00,125.00 L 391.00,125.00 L 387.00,121.00 L 386.00,121.00 L 374.00,109.00 L 374.00,108.00 L 368.00,102.00 L 368.00,101.00 L 364.00,97.00 L 364.00,96.00 L 361.00,93.00 L 361.00,92.00 L 358.00,89.00 L 358.00,88.00 L 349.00,79.00 L 348.00,79.00 L 345.00,76.00 L 344.00,76.00 L 343.00,75.00 L 342.00,75.00 L 341.00,74.00 L 340.00,74.00 L 338.00,72.00 L 336.00,72.00 L 335.00,71.00 L 334.00,71.00 L 333.00,70.00 L 335.00,68.00 L 338.00,68.00 L 339.00,67.00 L 342.00,67.00 L 343.00,66.00 L 348.00,66.00 Z M 201.00,66.00 L 202.00,65.00 L 216.00,65.00 L 217.00,66.00 L 222.00,66.00 L 223.00,67.00 L 226.00,67.00 L 227.00,68.00 L 230.00,68.00 L 232.00,70.00 L 231.00,71.00 L 230.00,71.00 L 229.00,72.00 L 228.00,72.00 L 227.00,73.00 L 226.00,73.00 L 225.00,74.00 L 224.00,74.00 L 223.00,75.00 L 222.00,75.00 L 220.00,77.00 L 219.00,77.00 L 216.00,80.00 L 215.00,80.00 L 209.00,86.00 L 209.00,87.00 L 205.00,91.00 L 205.00,92.00 L 202.00,95.00 L 202.00,96.00 L 199.00,99.00 L 199.00,100.00 L 193.00,106.00 L 193.00,107.00 L 178.00,122.00 L 177.00,122.00 L 173.00,126.00 L 172.00,126.00 L 171.00,127.00 L 170.00,127.00 L 169.00,128.00 L 168.00,128.00 L 167.00,129.00 L 165.00,129.00 L 164.00,130.00 L 161.00,130.00 L 160.00,131.00 L 156.00,131.00 L 155.00,132.00 L 152.00,132.00 L 151.00,133.00 L 149.00,133.00 L 148.00,134.00 L 147.00,134.00 L 146.00,135.00 L 144.00,135.00 L 143.00,136.00 L 142.00,136.00 L 141.00,135.00 L 141.00,132.00 L 142.00,131.00 L 142.00,129.00 L 143.00,128.00 L 143.00,125.00 L 144.00,124.00 L 144.00,122.00 L 145.00,121.00 L 145.00,119.00 L 146.00,118.00 L 146.00,116.00 L 147.00,115.00 L 147.00,113.00 L 148.00,112.00 L 148.00,111.00 L 149.00,110.00 L 149.00,108.00 L 150.00,107.00 L 150.00,105.00 L 151.00,104.00 L 151.00,102.00 L 152.00,101.00 L 152.00,99.00 L 153.00,98.00 L 153.00,97.00 L 154.00,96.00 L 154.00,95.00 L 155.00,94.00 L 155.00,93.00 L 156.00,92.00 L 156.00,91.00 L 158.00,89.00 L 158.00,88.00 L 160.00,86.00 L 160.00,85.00 L 168.00,77.00 L 169.00,77.00 L 171.00,75.00 L 172.00,75.00 L 174.00,73.00 L 175.00,73.00 L 176.00,72.00 L 177.00,72.00 L 178.00,71.00 L 180.00,71.00 L 181.00,70.00 L 182.00,70.00 L 183.00,69.00 L 186.00,69.00 L 187.00,68.00 L 191.00,68.00 L 192.00,67.00 L 195.00,67.00 L 196.00,66.00 L 200.00,66.00 Z M 315.00,39.00 L 316.00,38.00 L 317.00,39.00 L 318.00,39.00 L 323.00,44.00 L 324.00,44.00 L 325.00,45.00 L 326.00,45.00 L 327.00,46.00 L 328.00,46.00 L 329.00,47.00 L 330.00,47.00 L 331.00,48.00 L 332.00,48.00 L 333.00,49.00 L 334.00,49.00 L 335.00,50.00 L 337.00,50.00 L 338.00,51.00 L 339.00,51.00 L 340.00,52.00 L 342.00,52.00 L 343.00,53.00 L 344.00,53.00 L 345.00,54.00 L 346.00,54.00 L 347.00,55.00 L 348.00,55.00 L 349.00,56.00 L 350.00,56.00 L 351.00,57.00 L 352.00,57.00 L 355.00,60.00 L 356.00,60.00 L 358.00,62.00 L 357.00,63.00 L 353.00,63.00 L 352.00,64.00 L 345.00,64.00 L 344.00,65.00 L 340.00,65.00 L 339.00,66.00 L 336.00,66.00 L 335.00,67.00 L 333.00,67.00 L 332.00,68.00 L 330.00,68.00 L 329.00,69.00 L 328.00,68.00 L 326.00,68.00 L 325.00,67.00 L 324.00,67.00 L 323.00,66.00 L 322.00,66.00 L 320.00,64.00 L 319.00,64.00 L 318.00,63.00 L 318.00,62.00 L 317.00,61.00 L 317.00,60.00 L 316.00,59.00 L 316.00,56.00 L 315.00,55.00 L 315.00,40.00 Z M 248.00,39.00 L 249.00,38.00 L 250.00,39.00 L 250.00,57.00 L 249.00,58.00 L 249.00,60.00 L 248.00,61.00 L 248.00,62.00 L 245.00,65.00 L 244.00,65.00 L 242.00,67.00 L 241.00,67.00 L 240.00,68.00 L 237.00,68.00 L 236.00,69.00 L 235.00,68.00 L 234.00,68.00 L 233.00,67.00 L 231.00,67.00 L 230.00,66.00 L 227.00,66.00 L 226.00,65.00 L 221.00,65.00 L 220.00,64.00 L 214.00,64.00 L 213.00,63.00 L 208.00,63.00 L 207.00,62.00 L 209.00,60.00 L 210.00,60.00 L 213.00,57.00 L 214.00,57.00 L 215.00,56.00 L 216.00,56.00 L 217.00,55.00 L 218.00,55.00 L 219.00,54.00 L 220.00,54.00 L 221.00,53.00 L 223.00,53.00 L 224.00,52.00 L 225.00,52.00 L 226.00,51.00 L 227.00,51.00 L 228.00,50.00 L 230.00,50.00 L 231.00,49.00 L 232.00,49.00 L 233.00,48.00 L 234.00,48.00 L 235.00,47.00 L 236.00,47.00 L 237.00,46.00 L 238.00,46.00 L 239.00,45.00 L 240.00,45.00 L 241.00,44.00 L 242.00,44.00 L 245.00,41.00 L 246.00,41.00 L 247.00,40.00 Z M 252.00,10.00 L 253.00,9.00 L 260.00,16.00 L 261.00,16.00 L 264.00,19.00 L 265.00,19.00 L 266.00,20.00 L 267.00,20.00 L 268.00,21.00 L 269.00,21.00 L 270.00,22.00 L 272.00,22.00 L 273.00,23.00 L 274.00,23.00 L 275.00,24.00 L 278.00,24.00 L 279.00,25.00 L 282.00,25.00 L 283.00,26.00 L 284.00,25.00 L 287.00,25.00 L 288.00,24.00 L 291.00,24.00 L 292.00,23.00 L 293.00,23.00 L 294.00,22.00 L 296.00,22.00 L 297.00,21.00 L 298.00,21.00 L 300.00,19.00 L 301.00,19.00 L 302.00,18.00 L 303.00,18.00 L 306.00,15.00 L 307.00,15.00 L 312.00,10.00 L 313.00,10.00 L 314.00,11.00 L 314.00,59.00 L 315.00,60.00 L 315.00,61.00 L 316.00,62.00 L 316.00,63.00 L 318.00,65.00 L 318.00,66.00 L 317.00,67.00 L 316.00,67.00 L 315.00,66.00 L 307.00,66.00 L 306.00,67.00 L 300.00,67.00 L 299.00,68.00 L 297.00,68.00 L 296.00,69.00 L 294.00,69.00 L 293.00,70.00 L 292.00,70.00 L 291.00,71.00 L 290.00,71.00 L 284.00,77.00 L 284.00,78.00 L 283.00,79.00 L 282.00,79.00 L 281.00,78.00 L 281.00,77.00 L 280.00,76.00 L 280.00,75.00 L 277.00,72.00 L 276.00,72.00 L 274.00,70.00 L 273.00,70.00 L 272.00,69.00 L 270.00,69.00 L 269.00,68.00 L 266.00,68.00 L 265.00,67.00 L 260.00,67.00 L 259.00,66.00 L 251.00,66.00 L 250.00,67.00 L 248.00,67.00 L 247.00,66.00 L 249.00,64.00 L 249.00,63.00 L 250.00,62.00 L 250.00,61.00 L 251.00,60.00 L 251.00,36.00 L 252.00,35.00 L 252.00,11.00 Z`;
const BACK_LINEART_D = `M 210.00,866.00 L 207.00,869.00 L 286.00,869.00 L 283.00,866.00 L 211.00,866.00 Z M 246.00,0.00 L 246.00,2.00 L 247.00,3.00 L 247.00,32.00 L 246.00,33.00 L 246.00,37.00 L 241.00,42.00 L 240.00,42.00 L 236.00,46.00 L 235.00,46.00 L 234.00,47.00 L 232.00,47.00 L 231.00,48.00 L 230.00,48.00 L 229.00,49.00 L 228.00,49.00 L 227.00,50.00 L 226.00,50.00 L 225.00,51.00 L 223.00,51.00 L 222.00,52.00 L 221.00,52.00 L 220.00,53.00 L 218.00,53.00 L 217.00,54.00 L 216.00,54.00 L 215.00,55.00 L 213.00,55.00 L 212.00,56.00 L 211.00,56.00 L 210.00,57.00 L 209.00,57.00 L 207.00,59.00 L 206.00,59.00 L 205.00,60.00 L 204.00,60.00 L 203.00,61.00 L 202.00,61.00 L 200.00,63.00 L 195.00,63.00 L 194.00,64.00 L 190.00,64.00 L 189.00,65.00 L 187.00,65.00 L 186.00,66.00 L 184.00,66.00 L 183.00,67.00 L 181.00,67.00 L 180.00,68.00 L 178.00,68.00 L 177.00,69.00 L 176.00,69.00 L 175.00,70.00 L 174.00,70.00 L 173.00,71.00 L 172.00,71.00 L 171.00,72.00 L 170.00,72.00 L 169.00,73.00 L 168.00,73.00 L 166.00,75.00 L 165.00,75.00 L 162.00,78.00 L 161.00,78.00 L 154.00,85.00 L 153.00,85.00 L 153.00,86.00 L 149.00,90.00 L 149.00,91.00 L 147.00,93.00 L 147.00,94.00 L 145.00,96.00 L 145.00,97.00 L 144.00,98.00 L 144.00,99.00 L 143.00,100.00 L 143.00,101.00 L 142.00,102.00 L 142.00,103.00 L 141.00,104.00 L 141.00,105.00 L 140.00,106.00 L 140.00,107.00 L 139.00,108.00 L 139.00,110.00 L 138.00,111.00 L 138.00,113.00 L 137.00,114.00 L 137.00,117.00 L 136.00,118.00 L 136.00,121.00 L 135.00,122.00 L 135.00,126.00 L 128.00,133.00 L 128.00,134.00 L 124.00,138.00 L 124.00,139.00 L 121.00,142.00 L 121.00,143.00 L 119.00,145.00 L 119.00,146.00 L 118.00,147.00 L 118.00,148.00 L 116.00,150.00 L 116.00,151.00 L 115.00,152.00 L 115.00,153.00 L 114.00,154.00 L 114.00,155.00 L 113.00,156.00 L 113.00,158.00 L 112.00,159.00 L 112.00,161.00 L 111.00,162.00 L 111.00,163.00 L 110.00,164.00 L 110.00,166.00 L 109.00,167.00 L 109.00,168.00 L 108.00,169.00 L 108.00,170.00 L 107.00,171.00 L 107.00,172.00 L 106.00,173.00 L 106.00,174.00 L 105.00,175.00 L 105.00,176.00 L 104.00,177.00 L 104.00,178.00 L 102.00,180.00 L 102.00,182.00 L 101.00,183.00 L 101.00,184.00 L 100.00,185.00 L 100.00,187.00 L 99.00,188.00 L 99.00,190.00 L 98.00,191.00 L 98.00,193.00 L 97.00,194.00 L 97.00,195.00 L 96.00,196.00 L 96.00,197.00 L 82.00,211.00 L 82.00,212.00 L 78.00,216.00 L 78.00,217.00 L 74.00,221.00 L 74.00,222.00 L 72.00,224.00 L 72.00,225.00 L 69.00,228.00 L 69.00,229.00 L 68.00,230.00 L 68.00,231.00 L 66.00,233.00 L 66.00,234.00 L 65.00,235.00 L 65.00,236.00 L 63.00,238.00 L 63.00,239.00 L 62.00,240.00 L 62.00,241.00 L 61.00,242.00 L 61.00,243.00 L 60.00,244.00 L 60.00,245.00 L 59.00,246.00 L 59.00,247.00 L 58.00,248.00 L 58.00,249.00 L 57.00,250.00 L 57.00,252.00 L 56.00,253.00 L 56.00,254.00 L 55.00,255.00 L 55.00,257.00 L 54.00,258.00 L 54.00,259.00 L 53.00,260.00 L 53.00,262.00 L 52.00,263.00 L 52.00,265.00 L 51.00,266.00 L 51.00,267.00 L 50.00,268.00 L 50.00,270.00 L 49.00,271.00 L 49.00,273.00 L 48.00,274.00 L 48.00,276.00 L 47.00,277.00 L 47.00,279.00 L 46.00,280.00 L 46.00,281.00 L 45.00,282.00 L 45.00,284.00 L 44.00,285.00 L 44.00,287.00 L 43.00,288.00 L 43.00,290.00 L 42.00,291.00 L 42.00,293.00 L 41.00,294.00 L 41.00,296.00 L 40.00,297.00 L 40.00,299.00 L 39.00,300.00 L 39.00,302.00 L 38.00,303.00 L 38.00,305.00 L 37.00,306.00 L 37.00,308.00 L 36.00,309.00 L 36.00,311.00 L 35.00,312.00 L 35.00,314.00 L 34.00,315.00 L 34.00,317.00 L 32.00,319.00 L 32.00,320.00 L 31.00,321.00 L 31.00,323.00 L 30.00,324.00 L 30.00,330.00 L 29.00,331.00 L 29.00,343.00 L 28.00,344.00 L 28.00,346.00 L 27.00,347.00 L 27.00,350.00 L 26.00,351.00 L 26.00,353.00 L 25.00,354.00 L 25.00,357.00 L 24.00,358.00 L 24.00,360.00 L 23.00,361.00 L 23.00,364.00 L 22.00,365.00 L 22.00,367.00 L 21.00,368.00 L 21.00,372.00 L 20.00,373.00 L 21.00,374.00 L 21.00,380.00 L 22.00,381.00 L 22.00,384.00 L 23.00,385.00 L 23.00,388.00 L 24.00,389.00 L 24.00,393.00 L 25.00,394.00 L 25.00,397.00 L 26.00,398.00 L 26.00,399.00 L 27.00,400.00 L 27.00,401.00 L 31.00,405.00 L 32.00,405.00 L 36.00,409.00 L 37.00,409.00 L 40.00,412.00 L 42.00,412.00 L 43.00,411.00 L 43.00,410.00 L 44.00,409.00 L 44.00,406.00 L 47.00,403.00 L 47.00,401.00 L 48.00,400.00 L 48.00,397.00 L 47.00,396.00 L 47.00,395.00 L 45.00,393.00 L 45.00,392.00 L 44.00,391.00 L 44.00,390.00 L 43.00,389.00 L 43.00,386.00 L 44.00,385.00 L 44.00,381.00 L 45.00,380.00 L 45.00,374.00 L 46.00,373.00 L 46.00,371.00 L 49.00,368.00 L 50.00,369.00 L 50.00,373.00 L 51.00,374.00 L 51.00,378.00 L 52.00,379.00 L 52.00,380.00 L 53.00,381.00 L 53.00,382.00 L 54.00,383.00 L 55.00,383.00 L 56.00,384.00 L 61.00,384.00 L 63.00,382.00 L 64.00,382.00 L 64.00,375.00 L 63.00,374.00 L 63.00,369.00 L 62.00,368.00 L 62.00,364.00 L 61.00,363.00 L 61.00,358.00 L 62.00,357.00 L 62.00,347.00 L 61.00,346.00 L 61.00,344.00 L 60.00,343.00 L 60.00,342.00 L 59.00,341.00 L 59.00,340.00 L 56.00,337.00 L 56.00,335.00 L 57.00,334.00 L 57.00,332.00 L 58.00,331.00 L 58.00,329.00 L 59.00,328.00 L 59.00,327.00 L 60.00,326.00 L 60.00,325.00 L 62.00,323.00 L 62.00,322.00 L 63.00,321.00 L 63.00,320.00 L 66.00,317.00 L 66.00,316.00 L 70.00,312.00 L 70.00,311.00 L 75.00,306.00 L 75.00,305.00 L 90.00,290.00 L 90.00,289.00 L 94.00,285.00 L 94.00,284.00 L 97.00,281.00 L 97.00,280.00 L 100.00,277.00 L 100.00,276.00 L 102.00,274.00 L 102.00,273.00 L 104.00,271.00 L 104.00,270.00 L 106.00,268.00 L 106.00,267.00 L 107.00,266.00 L 107.00,265.00 L 109.00,263.00 L 109.00,262.00 L 110.00,261.00 L 110.00,260.00 L 112.00,258.00 L 112.00,257.00 L 113.00,256.00 L 113.00,255.00 L 115.00,253.00 L 115.00,252.00 L 116.00,251.00 L 116.00,250.00 L 118.00,248.00 L 118.00,247.00 L 119.00,246.00 L 119.00,245.00 L 121.00,243.00 L 121.00,242.00 L 123.00,240.00 L 123.00,239.00 L 125.00,237.00 L 125.00,236.00 L 128.00,233.00 L 128.00,232.00 L 131.00,229.00 L 131.00,228.00 L 134.00,225.00 L 134.00,224.00 L 137.00,221.00 L 137.00,220.00 L 141.00,216.00 L 141.00,215.00 L 146.00,210.00 L 146.00,209.00 L 152.00,203.00 L 152.00,202.00 L 155.00,199.00 L 155.00,198.00 L 157.00,196.00 L 157.00,195.00 L 160.00,192.00 L 160.00,191.00 L 162.00,189.00 L 162.00,188.00 L 164.00,186.00 L 164.00,185.00 L 166.00,183.00 L 166.00,182.00 L 168.00,180.00 L 168.00,179.00 L 170.00,177.00 L 170.00,176.00 L 172.00,174.00 L 172.00,173.00 L 174.00,171.00 L 174.00,170.00 L 176.00,168.00 L 177.00,169.00 L 177.00,170.00 L 178.00,171.00 L 178.00,174.00 L 179.00,175.00 L 179.00,177.00 L 180.00,178.00 L 180.00,181.00 L 181.00,182.00 L 181.00,184.00 L 182.00,185.00 L 182.00,187.00 L 183.00,188.00 L 183.00,190.00 L 184.00,191.00 L 184.00,193.00 L 185.00,194.00 L 185.00,195.00 L 186.00,196.00 L 186.00,198.00 L 187.00,199.00 L 187.00,200.00 L 188.00,201.00 L 188.00,202.00 L 189.00,203.00 L 189.00,204.00 L 190.00,205.00 L 190.00,206.00 L 191.00,207.00 L 191.00,208.00 L 192.00,209.00 L 192.00,210.00 L 193.00,211.00 L 193.00,212.00 L 195.00,214.00 L 195.00,215.00 L 196.00,216.00 L 196.00,218.00 L 197.00,219.00 L 197.00,221.00 L 198.00,222.00 L 198.00,224.00 L 199.00,225.00 L 199.00,228.00 L 200.00,229.00 L 200.00,234.00 L 201.00,235.00 L 201.00,249.00 L 202.00,250.00 L 202.00,265.00 L 201.00,266.00 L 201.00,279.00 L 200.00,280.00 L 200.00,289.00 L 199.00,290.00 L 199.00,297.00 L 198.00,298.00 L 198.00,304.00 L 197.00,305.00 L 197.00,310.00 L 196.00,311.00 L 196.00,316.00 L 195.00,317.00 L 195.00,321.00 L 194.00,322.00 L 194.00,326.00 L 193.00,327.00 L 193.00,340.00 L 192.00,341.00 L 192.00,345.00 L 191.00,346.00 L 191.00,348.00 L 190.00,349.00 L 190.00,351.00 L 189.00,352.00 L 189.00,355.00 L 188.00,356.00 L 188.00,358.00 L 187.00,359.00 L 187.00,362.00 L 186.00,363.00 L 186.00,366.00 L 185.00,367.00 L 185.00,371.00 L 184.00,372.00 L 184.00,376.00 L 183.00,377.00 L 183.00,382.00 L 182.00,383.00 L 182.00,387.00 L 181.00,388.00 L 181.00,393.00 L 180.00,394.00 L 180.00,399.00 L 179.00,400.00 L 179.00,407.00 L 178.00,408.00 L 178.00,415.00 L 177.00,416.00 L 177.00,423.00 L 176.00,424.00 L 176.00,436.00 L 175.00,437.00 L 175.00,456.00 L 174.00,457.00 L 174.00,478.00 L 175.00,479.00 L 175.00,495.00 L 176.00,496.00 L 176.00,505.00 L 177.00,506.00 L 177.00,512.00 L 178.00,513.00 L 178.00,519.00 L 179.00,520.00 L 179.00,525.00 L 180.00,526.00 L 180.00,530.00 L 181.00,531.00 L 181.00,535.00 L 182.00,536.00 L 182.00,553.00 L 181.00,554.00 L 181.00,560.00 L 180.00,561.00 L 180.00,568.00 L 179.00,569.00 L 179.00,583.00 L 178.00,584.00 L 178.00,590.00 L 177.00,591.00 L 177.00,595.00 L 176.00,596.00 L 176.00,599.00 L 175.00,600.00 L 175.00,602.00 L 174.00,603.00 L 174.00,605.00 L 173.00,606.00 L 173.00,608.00 L 172.00,609.00 L 172.00,612.00 L 171.00,613.00 L 171.00,615.00 L 170.00,616.00 L 170.00,619.00 L 169.00,620.00 L 169.00,622.00 L 168.00,623.00 L 168.00,626.00 L 167.00,627.00 L 167.00,630.00 L 166.00,631.00 L 166.00,635.00 L 165.00,636.00 L 165.00,643.00 L 164.00,644.00 L 164.00,656.00 L 163.00,657.00 L 163.00,661.00 L 164.00,662.00 L 164.00,677.00 L 165.00,678.00 L 165.00,688.00 L 166.00,689.00 L 166.00,698.00 L 167.00,699.00 L 167.00,708.00 L 168.00,709.00 L 168.00,718.00 L 169.00,719.00 L 169.00,728.00 L 170.00,729.00 L 170.00,739.00 L 171.00,740.00 L 171.00,750.00 L 172.00,751.00 L 172.00,765.00 L 173.00,766.00 L 173.00,770.00 L 172.00,771.00 L 172.00,778.00 L 171.00,779.00 L 171.00,784.00 L 170.00,785.00 L 170.00,790.00 L 169.00,791.00 L 169.00,792.00 L 168.00,793.00 L 168.00,794.00 L 155.00,807.00 L 153.00,807.00 L 152.00,808.00 L 151.00,808.00 L 150.00,809.00 L 149.00,809.00 L 147.00,811.00 L 144.00,811.00 L 142.00,813.00 L 141.00,813.00 L 140.00,814.00 L 140.00,815.00 L 137.00,818.00 L 137.00,819.00 L 136.00,820.00 L 136.00,822.00 L 137.00,823.00 L 137.00,824.00 L 139.00,826.00 L 140.00,826.00 L 141.00,827.00 L 143.00,827.00 L 144.00,828.00 L 147.00,828.00 L 148.00,829.00 L 151.00,829.00 L 152.00,830.00 L 154.00,830.00 L 155.00,831.00 L 157.00,831.00 L 158.00,832.00 L 160.00,832.00 L 161.00,833.00 L 163.00,833.00 L 168.00,838.00 L 169.00,838.00 L 170.00,839.00 L 171.00,839.00 L 173.00,841.00 L 175.00,841.00 L 176.00,842.00 L 179.00,842.00 L 180.00,843.00 L 185.00,843.00 L 186.00,844.00 L 190.00,844.00 L 191.00,843.00 L 195.00,843.00 L 196.00,842.00 L 198.00,842.00 L 204.00,836.00 L 204.00,834.00 L 205.00,833.00 L 205.00,828.00 L 206.00,827.00 L 206.00,824.00 L 205.00,823.00 L 205.00,800.00 L 206.00,799.00 L 206.00,774.00 L 207.00,773.00 L 207.00,768.00 L 208.00,767.00 L 208.00,763.00 L 209.00,762.00 L 209.00,759.00 L 210.00,758.00 L 210.00,754.00 L 211.00,753.00 L 211.00,750.00 L 212.00,749.00 L 212.00,746.00 L 213.00,745.00 L 213.00,742.00 L 214.00,741.00 L 214.00,739.00 L 215.00,738.00 L 215.00,735.00 L 216.00,734.00 L 216.00,731.00 L 217.00,730.00 L 217.00,728.00 L 218.00,727.00 L 218.00,724.00 L 219.00,723.00 L 219.00,721.00 L 220.00,720.00 L 220.00,718.00 L 221.00,717.00 L 221.00,715.00 L 222.00,714.00 L 222.00,712.00 L 223.00,711.00 L 223.00,709.00 L 224.00,708.00 L 224.00,706.00 L 225.00,705.00 L 225.00,703.00 L 226.00,702.00 L 226.00,700.00 L 227.00,699.00 L 227.00,698.00 L 228.00,697.00 L 228.00,696.00 L 229.00,695.00 L 229.00,694.00 L 230.00,693.00 L 230.00,691.00 L 231.00,690.00 L 231.00,689.00 L 232.00,688.00 L 232.00,686.00 L 233.00,685.00 L 233.00,680.00 L 234.00,679.00 L 234.00,660.00 L 233.00,659.00 L 233.00,647.00 L 232.00,646.00 L 232.00,637.00 L 231.00,636.00 L 231.00,627.00 L 230.00,626.00 L 230.00,618.00 L 229.00,617.00 L 229.00,609.00 L 228.00,608.00 L 228.00,602.00 L 229.00,601.00 L 229.00,599.00 L 230.00,598.00 L 230.00,597.00 L 231.00,596.00 L 231.00,595.00 L 234.00,592.00 L 234.00,591.00 L 238.00,587.00 L 238.00,586.00 L 239.00,585.00 L 239.00,584.00 L 241.00,582.00 L 241.00,581.00 L 242.00,580.00 L 242.00,579.00 L 243.00,578.00 L 243.00,576.00 L 244.00,575.00 L 244.00,573.00 L 245.00,572.00 L 245.00,569.00 L 246.00,568.00 L 246.00,564.00 L 247.00,563.00 L 247.00,559.00 L 248.00,558.00 L 248.00,552.00 L 249.00,551.00 L 249.00,545.00 L 250.00,544.00 L 250.00,539.00 L 251.00,538.00 L 251.00,533.00 L 252.00,532.00 L 252.00,527.00 L 253.00,526.00 L 253.00,522.00 L 254.00,521.00 L 254.00,517.00 L 255.00,516.00 L 255.00,513.00 L 256.00,512.00 L 256.00,509.00 L 257.00,508.00 L 257.00,505.00 L 258.00,504.00 L 258.00,501.00 L 259.00,500.00 L 259.00,497.00 L 260.00,496.00 L 260.00,494.00 L 261.00,493.00 L 261.00,490.00 L 262.00,489.00 L 262.00,487.00 L 263.00,486.00 L 263.00,483.00 L 264.00,482.00 L 264.00,480.00 L 265.00,479.00 L 265.00,476.00 L 266.00,475.00 L 266.00,472.00 L 267.00,471.00 L 267.00,468.00 L 268.00,467.00 L 268.00,465.00 L 269.00,464.00 L 269.00,461.00 L 270.00,460.00 L 270.00,456.00 L 271.00,455.00 L 271.00,452.00 L 272.00,451.00 L 272.00,447.00 L 273.00,446.00 L 273.00,442.00 L 274.00,441.00 L 274.00,436.00 L 275.00,435.00 L 275.00,430.00 L 276.00,429.00 L 276.00,422.00 L 277.00,421.00 L 277.00,413.00 L 278.00,412.00 L 278.00,402.00 L 279.00,401.00 L 279.00,399.00 L 280.00,398.00 L 281.00,399.00 L 281.00,409.00 L 282.00,410.00 L 282.00,419.00 L 283.00,420.00 L 283.00,426.00 L 284.00,427.00 L 284.00,433.00 L 285.00,434.00 L 285.00,439.00 L 286.00,440.00 L 286.00,445.00 L 287.00,446.00 L 287.00,449.00 L 288.00,450.00 L 288.00,454.00 L 289.00,455.00 L 289.00,458.00 L 290.00,459.00 L 290.00,462.00 L 291.00,463.00 L 291.00,466.00 L 292.00,467.00 L 292.00,470.00 L 293.00,471.00 L 293.00,474.00 L 294.00,475.00 L 294.00,477.00 L 295.00,478.00 L 295.00,481.00 L 296.00,482.00 L 296.00,485.00 L 297.00,486.00 L 297.00,488.00 L 298.00,489.00 L 298.00,492.00 L 299.00,493.00 L 299.00,495.00 L 300.00,496.00 L 300.00,499.00 L 301.00,500.00 L 301.00,503.00 L 302.00,504.00 L 302.00,507.00 L 303.00,508.00 L 303.00,511.00 L 304.00,512.00 L 304.00,515.00 L 305.00,516.00 L 305.00,519.00 L 306.00,520.00 L 306.00,525.00 L 307.00,526.00 L 307.00,530.00 L 308.00,531.00 L 308.00,536.00 L 309.00,537.00 L 309.00,542.00 L 310.00,543.00 L 310.00,549.00 L 311.00,550.00 L 311.00,556.00 L 312.00,557.00 L 312.00,562.00 L 313.00,563.00 L 313.00,567.00 L 314.00,568.00 L 314.00,570.00 L 315.00,571.00 L 315.00,574.00 L 316.00,575.00 L 316.00,577.00 L 317.00,578.00 L 317.00,579.00 L 318.00,580.00 L 318.00,581.00 L 319.00,582.00 L 319.00,583.00 L 320.00,584.00 L 320.00,585.00 L 323.00,588.00 L 323.00,589.00 L 326.00,592.00 L 326.00,593.00 L 329.00,596.00 L 329.00,597.00 L 330.00,598.00 L 330.00,600.00 L 331.00,601.00 L 331.00,611.00 L 330.00,612.00 L 330.00,620.00 L 329.00,621.00 L 329.00,629.00 L 328.00,630.00 L 328.00,639.00 L 327.00,640.00 L 327.00,650.00 L 326.00,651.00 L 326.00,664.00 L 325.00,665.00 L 325.00,674.00 L 326.00,675.00 L 326.00,683.00 L 327.00,684.00 L 327.00,687.00 L 328.00,688.00 L 328.00,690.00 L 329.00,691.00 L 329.00,692.00 L 330.00,693.00 L 330.00,694.00 L 331.00,695.00 L 331.00,696.00 L 332.00,697.00 L 332.00,699.00 L 333.00,700.00 L 333.00,701.00 L 334.00,702.00 L 334.00,704.00 L 335.00,705.00 L 335.00,707.00 L 336.00,708.00 L 336.00,710.00 L 337.00,711.00 L 337.00,713.00 L 338.00,714.00 L 338.00,716.00 L 339.00,717.00 L 339.00,719.00 L 340.00,720.00 L 340.00,722.00 L 341.00,723.00 L 341.00,726.00 L 342.00,727.00 L 342.00,729.00 L 343.00,730.00 L 343.00,733.00 L 344.00,734.00 L 344.00,736.00 L 345.00,737.00 L 345.00,740.00 L 346.00,741.00 L 346.00,744.00 L 347.00,745.00 L 347.00,748.00 L 348.00,749.00 L 348.00,752.00 L 349.00,753.00 L 349.00,756.00 L 350.00,757.00 L 350.00,761.00 L 351.00,762.00 L 351.00,766.00 L 352.00,767.00 L 352.00,771.00 L 353.00,772.00 L 353.00,781.00 L 354.00,782.00 L 354.00,786.00 L 353.00,787.00 L 353.00,797.00 L 354.00,798.00 L 354.00,806.00 L 355.00,807.00 L 355.00,816.00 L 354.00,817.00 L 354.00,832.00 L 355.00,833.00 L 355.00,835.00 L 356.00,836.00 L 356.00,837.00 L 360.00,841.00 L 361.00,841.00 L 362.00,842.00 L 363.00,842.00 L 364.00,843.00 L 368.00,843.00 L 369.00,844.00 L 373.00,844.00 L 374.00,843.00 L 380.00,843.00 L 381.00,842.00 L 383.00,842.00 L 384.00,841.00 L 386.00,841.00 L 387.00,840.00 L 388.00,840.00 L 390.00,838.00 L 391.00,838.00 L 393.00,836.00 L 394.00,836.00 L 394.00,835.00 L 396.00,833.00 L 398.00,833.00 L 399.00,832.00 L 401.00,832.00 L 402.00,831.00 L 404.00,831.00 L 405.00,830.00 L 408.00,830.00 L 409.00,829.00 L 411.00,829.00 L 412.00,828.00 L 416.00,828.00 L 417.00,827.00 L 418.00,827.00 L 419.00,826.00 L 420.00,826.00 L 423.00,823.00 L 423.00,819.00 L 422.00,818.00 L 422.00,817.00 L 417.00,812.00 L 416.00,812.00 L 415.00,811.00 L 412.00,811.00 L 409.00,808.00 L 407.00,808.00 L 406.00,807.00 L 405.00,807.00 L 404.00,806.00 L 403.00,806.00 L 393.00,796.00 L 393.00,795.00 L 390.00,792.00 L 390.00,789.00 L 389.00,788.00 L 389.00,783.00 L 388.00,782.00 L 388.00,777.00 L 387.00,776.00 L 387.00,755.00 L 388.00,754.00 L 388.00,743.00 L 389.00,742.00 L 389.00,733.00 L 390.00,732.00 L 390.00,722.00 L 391.00,721.00 L 391.00,712.00 L 392.00,711.00 L 392.00,702.00 L 393.00,701.00 L 393.00,692.00 L 394.00,691.00 L 394.00,682.00 L 395.00,681.00 L 395.00,669.00 L 396.00,668.00 L 396.00,654.00 L 395.00,653.00 L 395.00,642.00 L 394.00,641.00 L 394.00,635.00 L 393.00,634.00 L 393.00,630.00 L 392.00,629.00 L 392.00,626.00 L 391.00,625.00 L 391.00,622.00 L 390.00,621.00 L 390.00,619.00 L 389.00,618.00 L 389.00,615.00 L 388.00,614.00 L 388.00,612.00 L 387.00,611.00 L 387.00,608.00 L 386.00,607.00 L 386.00,606.00 L 385.00,605.00 L 385.00,602.00 L 384.00,601.00 L 384.00,599.00 L 383.00,598.00 L 383.00,595.00 L 382.00,594.00 L 382.00,590.00 L 381.00,589.00 L 381.00,577.00 L 380.00,576.00 L 380.00,566.00 L 379.00,565.00 L 379.00,559.00 L 378.00,558.00 L 378.00,551.00 L 377.00,550.00 L 377.00,537.00 L 378.00,536.00 L 378.00,533.00 L 379.00,532.00 L 379.00,528.00 L 380.00,527.00 L 380.00,523.00 L 381.00,522.00 L 381.00,515.00 L 382.00,514.00 L 382.00,508.00 L 383.00,507.00 L 383.00,500.00 L 384.00,499.00 L 384.00,488.00 L 385.00,487.00 L 385.00,446.00 L 384.00,445.00 L 384.00,433.00 L 383.00,432.00 L 383.00,421.00 L 382.00,420.00 L 382.00,413.00 L 381.00,412.00 L 381.00,405.00 L 380.00,404.00 L 380.00,398.00 L 379.00,397.00 L 379.00,392.00 L 378.00,391.00 L 378.00,386.00 L 377.00,385.00 L 377.00,381.00 L 376.00,380.00 L 376.00,375.00 L 375.00,374.00 L 375.00,370.00 L 374.00,369.00 L 374.00,366.00 L 373.00,365.00 L 373.00,362.00 L 372.00,361.00 L 372.00,358.00 L 371.00,357.00 L 371.00,354.00 L 370.00,353.00 L 370.00,351.00 L 369.00,350.00 L 369.00,348.00 L 368.00,347.00 L 368.00,344.00 L 367.00,343.00 L 367.00,338.00 L 366.00,337.00 L 366.00,335.00 L 367.00,334.00 L 367.00,331.00 L 366.00,330.00 L 366.00,325.00 L 365.00,324.00 L 365.00,320.00 L 364.00,319.00 L 364.00,315.00 L 363.00,314.00 L 363.00,310.00 L 362.00,309.00 L 362.00,303.00 L 361.00,302.00 L 361.00,296.00 L 360.00,295.00 L 360.00,287.00 L 359.00,286.00 L 359.00,277.00 L 358.00,276.00 L 358.00,238.00 L 359.00,237.00 L 359.00,231.00 L 360.00,230.00 L 360.00,226.00 L 361.00,225.00 L 361.00,223.00 L 362.00,222.00 L 362.00,220.00 L 363.00,219.00 L 363.00,217.00 L 364.00,216.00 L 364.00,215.00 L 365.00,214.00 L 365.00,213.00 L 366.00,212.00 L 366.00,211.00 L 367.00,210.00 L 367.00,209.00 L 369.00,207.00 L 369.00,206.00 L 370.00,205.00 L 370.00,204.00 L 371.00,203.00 L 371.00,202.00 L 372.00,201.00 L 372.00,200.00 L 373.00,199.00 L 373.00,197.00 L 374.00,196.00 L 374.00,194.00 L 375.00,193.00 L 375.00,192.00 L 376.00,191.00 L 376.00,189.00 L 377.00,188.00 L 377.00,186.00 L 378.00,185.00 L 378.00,183.00 L 379.00,182.00 L 379.00,179.00 L 380.00,178.00 L 380.00,176.00 L 381.00,175.00 L 381.00,172.00 L 382.00,171.00 L 382.00,169.00 L 383.00,168.00 L 384.00,168.00 L 385.00,169.00 L 385.00,170.00 L 386.00,171.00 L 386.00,172.00 L 388.00,174.00 L 388.00,175.00 L 390.00,177.00 L 390.00,178.00 L 392.00,180.00 L 392.00,181.00 L 394.00,183.00 L 394.00,184.00 L 396.00,186.00 L 396.00,187.00 L 398.00,189.00 L 398.00,190.00 L 400.00,192.00 L 400.00,193.00 L 403.00,196.00 L 403.00,197.00 L 405.00,199.00 L 405.00,200.00 L 409.00,204.00 L 409.00,205.00 L 415.00,211.00 L 415.00,212.00 L 420.00,217.00 L 420.00,218.00 L 423.00,221.00 L 423.00,222.00 L 427.00,226.00 L 427.00,227.00 L 430.00,230.00 L 430.00,231.00 L 432.00,233.00 L 432.00,234.00 L 435.00,237.00 L 435.00,238.00 L 437.00,240.00 L 437.00,241.00 L 439.00,243.00 L 439.00,244.00 L 441.00,246.00 L 441.00,247.00 L 442.00,248.00 L 442.00,249.00 L 444.00,251.00 L 444.00,252.00 L 445.00,253.00 L 445.00,254.00 L 446.00,255.00 L 446.00,256.00 L 448.00,258.00 L 448.00,259.00 L 449.00,260.00 L 449.00,261.00 L 451.00,263.00 L 451.00,264.00 L 453.00,266.00 L 453.00,267.00 L 454.00,268.00 L 454.00,269.00 L 456.00,271.00 L 456.00,272.00 L 458.00,274.00 L 458.00,275.00 L 460.00,277.00 L 460.00,278.00 L 463.00,281.00 L 463.00,282.00 L 466.00,285.00 L 466.00,286.00 L 475.00,295.00 L 475.00,296.00 L 486.00,307.00 L 486.00,308.00 L 491.00,313.00 L 491.00,314.00 L 494.00,317.00 L 494.00,318.00 L 496.00,320.00 L 496.00,321.00 L 498.00,323.00 L 498.00,324.00 L 499.00,325.00 L 499.00,326.00 L 500.00,327.00 L 500.00,328.00 L 501.00,329.00 L 501.00,330.00 L 502.00,331.00 L 502.00,332.00 L 503.00,333.00 L 503.00,337.00 L 501.00,339.00 L 501.00,340.00 L 500.00,341.00 L 500.00,342.00 L 499.00,343.00 L 499.00,344.00 L 498.00,345.00 L 498.00,347.00 L 497.00,348.00 L 497.00,355.00 L 498.00,356.00 L 498.00,364.00 L 497.00,365.00 L 497.00,370.00 L 496.00,371.00 L 496.00,377.00 L 495.00,378.00 L 495.00,381.00 L 497.00,383.00 L 498.00,383.00 L 499.00,384.00 L 503.00,384.00 L 504.00,383.00 L 505.00,383.00 L 507.00,381.00 L 507.00,379.00 L 508.00,378.00 L 508.00,376.00 L 509.00,375.00 L 509.00,369.00 L 510.00,368.00 L 511.00,368.00 L 513.00,370.00 L 513.00,371.00 L 514.00,372.00 L 514.00,378.00 L 515.00,379.00 L 515.00,384.00 L 516.00,385.00 L 516.00,390.00 L 515.00,391.00 L 515.00,392.00 L 513.00,394.00 L 513.00,395.00 L 512.00,396.00 L 512.00,402.00 L 513.00,403.00 L 513.00,404.00 L 515.00,406.00 L 515.00,408.00 L 516.00,409.00 L 516.00,410.00 L 518.00,412.00 L 520.00,412.00 L 526.00,406.00 L 527.00,406.00 L 532.00,401.00 L 532.00,400.00 L 534.00,398.00 L 534.00,395.00 L 535.00,394.00 L 535.00,391.00 L 536.00,390.00 L 536.00,387.00 L 537.00,386.00 L 537.00,382.00 L 538.00,381.00 L 538.00,377.00 L 539.00,376.00 L 539.00,371.00 L 538.00,370.00 L 538.00,367.00 L 537.00,366.00 L 537.00,363.00 L 536.00,362.00 L 536.00,360.00 L 535.00,359.00 L 535.00,357.00 L 534.00,356.00 L 534.00,353.00 L 533.00,352.00 L 533.00,350.00 L 532.00,349.00 L 532.00,346.00 L 531.00,345.00 L 531.00,342.00 L 530.00,341.00 L 530.00,327.00 L 529.00,326.00 L 529.00,323.00 L 528.00,322.00 L 528.00,320.00 L 527.00,319.00 L 527.00,318.00 L 525.00,316.00 L 525.00,314.00 L 524.00,313.00 L 524.00,311.00 L 523.00,310.00 L 523.00,308.00 L 522.00,307.00 L 522.00,305.00 L 521.00,304.00 L 521.00,302.00 L 520.00,301.00 L 520.00,299.00 L 519.00,298.00 L 519.00,296.00 L 518.00,295.00 L 518.00,293.00 L 517.00,292.00 L 517.00,290.00 L 516.00,289.00 L 516.00,287.00 L 515.00,286.00 L 515.00,285.00 L 514.00,284.00 L 514.00,282.00 L 513.00,281.00 L 513.00,279.00 L 512.00,278.00 L 512.00,276.00 L 511.00,275.00 L 511.00,273.00 L 510.00,272.00 L 510.00,270.00 L 509.00,269.00 L 509.00,267.00 L 508.00,266.00 L 508.00,265.00 L 507.00,264.00 L 507.00,262.00 L 506.00,261.00 L 506.00,259.00 L 505.00,258.00 L 505.00,257.00 L 504.00,256.00 L 504.00,254.00 L 503.00,253.00 L 503.00,252.00 L 502.00,251.00 L 502.00,250.00 L 501.00,249.00 L 501.00,247.00 L 500.00,246.00 L 500.00,245.00 L 499.00,244.00 L 499.00,243.00 L 498.00,242.00 L 498.00,241.00 L 496.00,239.00 L 496.00,238.00 L 495.00,237.00 L 495.00,236.00 L 494.00,235.00 L 494.00,234.00 L 492.00,232.00 L 492.00,231.00 L 491.00,230.00 L 491.00,229.00 L 488.00,226.00 L 488.00,225.00 L 486.00,223.00 L 486.00,222.00 L 483.00,219.00 L 483.00,218.00 L 478.00,213.00 L 478.00,212.00 L 464.00,198.00 L 464.00,197.00 L 462.00,195.00 L 462.00,193.00 L 461.00,192.00 L 461.00,190.00 L 460.00,189.00 L 460.00,187.00 L 459.00,186.00 L 459.00,184.00 L 458.00,183.00 L 458.00,182.00 L 457.00,181.00 L 457.00,180.00 L 456.00,179.00 L 456.00,178.00 L 455.00,177.00 L 455.00,176.00 L 454.00,175.00 L 454.00,174.00 L 453.00,173.00 L 453.00,172.00 L 452.00,171.00 L 452.00,170.00 L 451.00,169.00 L 451.00,168.00 L 450.00,167.00 L 450.00,166.00 L 449.00,165.00 L 449.00,164.00 L 448.00,163.00 L 448.00,161.00 L 447.00,160.00 L 447.00,158.00 L 446.00,157.00 L 446.00,156.00 L 445.00,155.00 L 445.00,154.00 L 444.00,153.00 L 444.00,151.00 L 442.00,149.00 L 442.00,148.00 L 441.00,147.00 L 441.00,146.00 L 439.00,144.00 L 439.00,143.00 L 437.00,141.00 L 437.00,140.00 L 433.00,136.00 L 433.00,135.00 L 425.00,127.00 L 425.00,125.00 L 424.00,124.00 L 424.00,120.00 L 423.00,119.00 L 423.00,117.00 L 422.00,116.00 L 422.00,113.00 L 421.00,112.00 L 421.00,110.00 L 420.00,109.00 L 420.00,108.00 L 419.00,107.00 L 419.00,105.00 L 418.00,104.00 L 418.00,103.00 L 417.00,102.00 L 417.00,101.00 L 416.00,100.00 L 416.00,99.00 L 414.00,97.00 L 414.00,96.00 L 413.00,95.00 L 413.00,94.00 L 411.00,92.00 L 411.00,91.00 L 407.00,87.00 L 407.00,86.00 L 401.00,80.00 L 400.00,80.00 L 397.00,77.00 L 396.00,77.00 L 393.00,74.00 L 392.00,74.00 L 391.00,73.00 L 390.00,73.00 L 389.00,72.00 L 388.00,72.00 L 387.00,71.00 L 386.00,71.00 L 385.00,70.00 L 384.00,70.00 L 383.00,69.00 L 382.00,69.00 L 381.00,68.00 L 380.00,68.00 L 379.00,67.00 L 377.00,67.00 L 376.00,66.00 L 374.00,66.00 L 373.00,65.00 L 370.00,65.00 L 369.00,64.00 L 366.00,64.00 L 365.00,63.00 L 359.00,63.00 L 357.00,61.00 L 356.00,61.00 L 354.00,59.00 L 353.00,59.00 L 352.00,58.00 L 351.00,58.00 L 350.00,57.00 L 349.00,57.00 L 348.00,56.00 L 347.00,56.00 L 346.00,55.00 L 345.00,55.00 L 344.00,54.00 L 342.00,54.00 L 341.00,53.00 L 340.00,53.00 L 339.00,52.00 L 337.00,52.00 L 336.00,51.00 L 335.00,51.00 L 334.00,50.00 L 332.00,50.00 L 331.00,49.00 L 330.00,49.00 L 329.00,48.00 L 328.00,48.00 L 327.00,47.00 L 326.00,47.00 L 325.00,46.00 L 324.00,46.00 L 323.00,45.00 L 322.00,45.00 L 319.00,42.00 L 318.00,42.00 L 313.00,37.00 L 313.00,23.00 L 312.00,22.00 L 312.00,4.00 L 313.00,3.00 L 313.00,1.00 L 314.00,0.00 L 312.00,0.00 L 312.00,1.00 L 311.00,2.00 L 311.00,34.00 L 312.00,35.00 L 312.00,39.00 L 314.00,41.00 L 315.00,41.00 L 319.00,45.00 L 318.00,46.00 L 317.00,46.00 L 316.00,45.00 L 303.00,45.00 L 302.00,44.00 L 288.00,44.00 L 287.00,45.00 L 272.00,45.00 L 271.00,44.00 L 257.00,44.00 L 256.00,45.00 L 244.00,45.00 L 243.00,46.00 L 241.00,46.00 L 240.00,45.00 L 242.00,43.00 L 243.00,43.00 L 248.00,38.00 L 248.00,21.00 L 249.00,20.00 L 249.00,4.00 L 248.00,3.00 L 248.00,1.00 L 249.00,0.00 L 251.00,2.00 L 251.00,3.00 L 252.00,4.00 L 252.00,5.00 L 256.00,9.00 L 260.00,9.00 L 261.00,8.00 L 262.00,8.00 L 263.00,7.00 L 264.00,7.00 L 265.00,6.00 L 266.00,6.00 L 267.00,5.00 L 268.00,5.00 L 269.00,4.00 L 270.00,4.00 L 271.00,3.00 L 274.00,3.00 L 275.00,2.00 L 285.00,2.00 L 286.00,3.00 L 288.00,3.00 L 289.00,4.00 L 290.00,4.00 L 291.00,5.00 L 292.00,5.00 L 293.00,6.00 L 295.00,6.00 L 296.00,7.00 L 297.00,7.00 L 298.00,8.00 L 299.00,8.00 L 300.00,9.00 L 303.00,9.00 L 304.00,8.00 L 305.00,8.00 L 306.00,7.00 L 306.00,6.00 L 307.00,5.00 L 307.00,4.00 L 309.00,2.00 L 309.00,1.00 L 310.00,0.00 L 308.00,0.00 L 307.00,1.00 L 307.00,2.00 L 305.00,4.00 L 305.00,5.00 L 302.00,8.00 L 301.00,7.00 L 299.00,7.00 L 298.00,6.00 L 297.00,6.00 L 296.00,5.00 L 295.00,5.00 L 293.00,3.00 L 292.00,3.00 L 291.00,2.00 L 289.00,2.00 L 288.00,1.00 L 285.00,1.00 L 284.00,0.00 L 275.00,0.00 L 274.00,1.00 L 272.00,1.00 L 271.00,2.00 L 269.00,2.00 L 268.00,3.00 L 267.00,3.00 L 266.00,4.00 L 265.00,4.00 L 264.00,5.00 L 263.00,5.00 L 262.00,6.00 L 261.00,6.00 L 260.00,7.00 L 259.00,7.00 L 258.00,8.00 L 253.00,3.00 L 253.00,2.00 L 251.00,0.00 L 249.00,0.00 L 248.00,1.00 L 247.00,0.00 Z M 222.00,702.00 L 223.00,701.00 L 224.00,702.00 L 223.00,703.00 Z M 390.00,693.00 L 391.00,692.00 L 392.00,693.00 L 392.00,694.00 L 391.00,695.00 L 390.00,694.00 Z M 358.00,678.00 L 359.00,677.00 L 361.00,679.00 L 361.00,680.00 L 363.00,682.00 L 363.00,684.00 L 364.00,685.00 L 364.00,686.00 L 365.00,687.00 L 365.00,688.00 L 367.00,690.00 L 367.00,691.00 L 368.00,692.00 L 368.00,693.00 L 370.00,695.00 L 370.00,696.00 L 374.00,700.00 L 375.00,700.00 L 376.00,701.00 L 378.00,701.00 L 379.00,702.00 L 380.00,702.00 L 381.00,701.00 L 384.00,701.00 L 387.00,698.00 L 387.00,697.00 L 390.00,694.00 L 391.00,695.00 L 391.00,704.00 L 390.00,705.00 L 390.00,714.00 L 389.00,715.00 L 389.00,724.00 L 388.00,725.00 L 388.00,735.00 L 387.00,736.00 L 387.00,746.00 L 386.00,747.00 L 386.00,758.00 L 385.00,759.00 L 385.00,774.00 L 386.00,775.00 L 386.00,781.00 L 387.00,782.00 L 387.00,786.00 L 388.00,787.00 L 388.00,792.00 L 389.00,793.00 L 389.00,794.00 L 392.00,797.00 L 392.00,798.00 L 401.00,807.00 L 402.00,807.00 L 404.00,809.00 L 407.00,809.00 L 411.00,813.00 L 412.00,812.00 L 413.00,813.00 L 415.00,813.00 L 421.00,819.00 L 421.00,822.00 L 418.00,825.00 L 417.00,825.00 L 416.00,826.00 L 413.00,826.00 L 412.00,827.00 L 409.00,827.00 L 408.00,828.00 L 406.00,828.00 L 405.00,829.00 L 402.00,829.00 L 401.00,830.00 L 399.00,830.00 L 398.00,831.00 L 396.00,831.00 L 395.00,832.00 L 394.00,832.00 L 388.00,838.00 L 387.00,838.00 L 386.00,839.00 L 385.00,839.00 L 384.00,840.00 L 382.00,840.00 L 381.00,841.00 L 378.00,841.00 L 377.00,842.00 L 367.00,842.00 L 366.00,841.00 L 364.00,841.00 L 363.00,840.00 L 362.00,840.00 L 357.00,835.00 L 357.00,833.00 L 356.00,832.00 L 356.00,828.00 L 355.00,827.00 L 355.00,825.00 L 356.00,824.00 L 356.00,800.00 L 355.00,799.00 L 355.00,774.00 L 354.00,773.00 L 354.00,768.00 L 353.00,767.00 L 353.00,763.00 L 352.00,762.00 L 352.00,759.00 L 351.00,758.00 L 351.00,754.00 L 350.00,753.00 L 350.00,750.00 L 349.00,749.00 L 349.00,746.00 L 348.00,745.00 L 348.00,742.00 L 347.00,741.00 L 347.00,738.00 L 346.00,737.00 L 346.00,734.00 L 345.00,733.00 L 345.00,731.00 L 344.00,730.00 L 344.00,727.00 L 343.00,726.00 L 343.00,724.00 L 342.00,723.00 L 342.00,721.00 L 341.00,720.00 L 341.00,717.00 L 340.00,716.00 L 340.00,714.00 L 339.00,713.00 L 339.00,711.00 L 338.00,710.00 L 338.00,708.00 L 337.00,707.00 L 337.00,705.00 L 336.00,704.00 L 336.00,703.00 L 337.00,702.00 L 338.00,702.00 L 339.00,703.00 L 340.00,703.00 L 341.00,704.00 L 348.00,704.00 L 349.00,703.00 L 350.00,703.00 L 354.00,699.00 L 354.00,698.00 L 355.00,697.00 L 355.00,694.00 L 356.00,693.00 L 356.00,688.00 L 357.00,687.00 L 357.00,681.00 L 358.00,680.00 L 358.00,679.00 Z M 199.00,678.00 L 200.00,677.00 L 201.00,678.00 L 201.00,679.00 L 202.00,680.00 L 202.00,685.00 L 203.00,686.00 L 203.00,692.00 L 204.00,693.00 L 204.00,696.00 L 205.00,697.00 L 205.00,698.00 L 206.00,699.00 L 206.00,700.00 L 209.00,703.00 L 210.00,703.00 L 211.00,704.00 L 218.00,704.00 L 219.00,703.00 L 221.00,703.00 L 222.00,702.00 L 223.00,703.00 L 223.00,705.00 L 222.00,706.00 L 222.00,708.00 L 221.00,709.00 L 221.00,711.00 L 220.00,712.00 L 220.00,714.00 L 219.00,715.00 L 219.00,717.00 L 218.00,718.00 L 218.00,721.00 L 217.00,722.00 L 217.00,724.00 L 216.00,725.00 L 216.00,727.00 L 215.00,728.00 L 215.00,731.00 L 214.00,732.00 L 214.00,735.00 L 213.00,736.00 L 213.00,738.00 L 212.00,739.00 L 212.00,742.00 L 211.00,743.00 L 211.00,746.00 L 210.00,747.00 L 210.00,750.00 L 209.00,751.00 L 209.00,755.00 L 208.00,756.00 L 208.00,759.00 L 207.00,760.00 L 207.00,764.00 L 206.00,765.00 L 206.00,769.00 L 205.00,770.00 L 205.00,776.00 L 204.00,777.00 L 204.00,790.00 L 205.00,791.00 L 205.00,795.00 L 204.00,796.00 L 204.00,801.00 L 203.00,802.00 L 203.00,820.00 L 204.00,821.00 L 204.00,830.00 L 203.00,831.00 L 203.00,833.00 L 202.00,834.00 L 202.00,835.00 L 201.00,836.00 L 201.00,837.00 L 200.00,838.00 L 199.00,838.00 L 197.00,840.00 L 196.00,840.00 L 195.00,841.00 L 193.00,841.00 L 192.00,842.00 L 182.00,842.00 L 181.00,841.00 L 178.00,841.00 L 177.00,840.00 L 176.00,840.00 L 175.00,839.00 L 174.00,839.00 L 173.00,838.00 L 172.00,838.00 L 171.00,837.00 L 170.00,837.00 L 164.00,831.00 L 161.00,831.00 L 160.00,830.00 L 158.00,830.00 L 157.00,829.00 L 155.00,829.00 L 154.00,828.00 L 151.00,828.00 L 150.00,827.00 L 147.00,827.00 L 146.00,826.00 L 144.00,826.00 L 143.00,825.00 L 141.00,825.00 L 138.00,822.00 L 138.00,820.00 L 139.00,819.00 L 139.00,818.00 L 143.00,814.00 L 144.00,814.00 L 145.00,813.00 L 148.00,813.00 L 151.00,810.00 L 152.00,810.00 L 153.00,809.00 L 155.00,809.00 L 156.00,808.00 L 157.00,808.00 L 162.00,803.00 L 163.00,803.00 L 163.00,802.00 L 169.00,796.00 L 169.00,795.00 L 171.00,793.00 L 171.00,789.00 L 172.00,788.00 L 172.00,784.00 L 173.00,783.00 L 173.00,777.00 L 174.00,776.00 L 174.00,755.00 L 173.00,754.00 L 173.00,743.00 L 172.00,742.00 L 172.00,732.00 L 171.00,731.00 L 171.00,722.00 L 170.00,721.00 L 170.00,712.00 L 169.00,711.00 L 169.00,702.00 L 168.00,701.00 L 168.00,694.00 L 169.00,693.00 L 170.00,694.00 L 170.00,695.00 L 172.00,697.00 L 172.00,698.00 L 173.00,699.00 L 174.00,699.00 L 176.00,701.00 L 178.00,701.00 L 179.00,702.00 L 180.00,702.00 L 181.00,701.00 L 183.00,701.00 L 184.00,700.00 L 185.00,700.00 L 191.00,694.00 L 191.00,693.00 L 192.00,692.00 L 192.00,691.00 L 193.00,690.00 L 193.00,689.00 L 194.00,688.00 L 194.00,687.00 L 195.00,686.00 L 195.00,685.00 L 196.00,684.00 L 196.00,683.00 L 197.00,682.00 L 197.00,681.00 L 198.00,680.00 L 198.00,679.00 Z M 379.00,606.00 L 380.00,605.00 L 382.00,605.00 L 384.00,607.00 L 384.00,608.00 L 385.00,609.00 L 385.00,611.00 L 386.00,612.00 L 386.00,614.00 L 387.00,615.00 L 387.00,617.00 L 388.00,618.00 L 388.00,620.00 L 389.00,621.00 L 389.00,624.00 L 390.00,625.00 L 390.00,628.00 L 391.00,629.00 L 391.00,632.00 L 392.00,633.00 L 392.00,639.00 L 393.00,640.00 L 393.00,647.00 L 394.00,648.00 L 394.00,666.00 L 393.00,667.00 L 393.00,675.00 L 392.00,676.00 L 392.00,681.00 L 391.00,682.00 L 391.00,685.00 L 390.00,686.00 L 390.00,689.00 L 389.00,690.00 L 389.00,691.00 L 388.00,692.00 L 388.00,693.00 L 387.00,694.00 L 387.00,695.00 L 383.00,699.00 L 382.00,699.00 L 381.00,700.00 L 378.00,700.00 L 377.00,699.00 L 376.00,699.00 L 370.00,693.00 L 370.00,692.00 L 369.00,691.00 L 369.00,690.00 L 368.00,689.00 L 368.00,688.00 L 367.00,687.00 L 367.00,686.00 L 365.00,684.00 L 365.00,683.00 L 364.00,682.00 L 364.00,681.00 L 363.00,680.00 L 363.00,679.00 L 360.00,676.00 L 357.00,676.00 L 357.00,677.00 L 356.00,678.00 L 356.00,681.00 L 355.00,682.00 L 355.00,689.00 L 354.00,690.00 L 354.00,694.00 L 353.00,695.00 L 353.00,697.00 L 352.00,698.00 L 352.00,699.00 L 349.00,702.00 L 347.00,702.00 L 346.00,703.00 L 343.00,703.00 L 342.00,702.00 L 341.00,702.00 L 340.00,701.00 L 339.00,701.00 L 334.00,696.00 L 334.00,695.00 L 332.00,693.00 L 332.00,692.00 L 331.00,691.00 L 331.00,690.00 L 330.00,689.00 L 330.00,687.00 L 329.00,686.00 L 329.00,685.00 L 328.00,684.00 L 328.00,680.00 L 327.00,679.00 L 327.00,660.00 L 328.00,659.00 L 328.00,647.00 L 329.00,646.00 L 329.00,637.00 L 330.00,636.00 L 330.00,635.00 L 331.00,634.00 L 331.00,629.00 L 332.00,628.00 L 332.00,626.00 L 333.00,625.00 L 333.00,624.00 L 338.00,619.00 L 341.00,619.00 L 342.00,618.00 L 345.00,618.00 L 346.00,619.00 L 348.00,619.00 L 349.00,620.00 L 350.00,620.00 L 351.00,621.00 L 352.00,621.00 L 353.00,622.00 L 358.00,622.00 L 359.00,621.00 L 361.00,621.00 L 363.00,619.00 L 364.00,619.00 L 374.00,609.00 L 375.00,609.00 L 378.00,606.00 Z M 177.00,606.00 L 178.00,605.00 L 179.00,605.00 L 180.00,606.00 L 181.00,606.00 L 183.00,608.00 L 184.00,608.00 L 193.00,617.00 L 194.00,617.00 L 197.00,620.00 L 198.00,620.00 L 199.00,621.00 L 200.00,621.00 L 201.00,622.00 L 206.00,622.00 L 207.00,621.00 L 208.00,621.00 L 209.00,620.00 L 210.00,620.00 L 211.00,619.00 L 213.00,619.00 L 214.00,618.00 L 218.00,618.00 L 219.00,619.00 L 221.00,619.00 L 227.00,625.00 L 227.00,627.00 L 228.00,628.00 L 228.00,633.00 L 230.00,635.00 L 230.00,643.00 L 231.00,644.00 L 231.00,654.00 L 232.00,655.00 L 232.00,681.00 L 231.00,682.00 L 231.00,685.00 L 230.00,686.00 L 230.00,687.00 L 229.00,688.00 L 229.00,689.00 L 228.00,690.00 L 228.00,691.00 L 227.00,692.00 L 227.00,693.00 L 226.00,694.00 L 226.00,695.00 L 220.00,701.00 L 219.00,701.00 L 218.00,702.00 L 217.00,702.00 L 216.00,703.00 L 213.00,703.00 L 212.00,702.00 L 211.00,702.00 L 207.00,698.00 L 207.00,697.00 L 206.00,696.00 L 206.00,694.00 L 205.00,693.00 L 205.00,688.00 L 204.00,687.00 L 204.00,681.00 L 203.00,680.00 L 203.00,678.00 L 202.00,677.00 L 202.00,676.00 L 199.00,676.00 L 197.00,678.00 L 197.00,679.00 L 195.00,681.00 L 195.00,682.00 L 194.00,683.00 L 194.00,684.00 L 193.00,685.00 L 193.00,686.00 L 192.00,687.00 L 192.00,688.00 L 191.00,689.00 L 191.00,690.00 L 189.00,692.00 L 189.00,693.00 L 186.00,696.00 L 186.00,697.00 L 185.00,698.00 L 184.00,698.00 L 182.00,700.00 L 178.00,700.00 L 177.00,699.00 L 176.00,699.00 L 173.00,696.00 L 173.00,695.00 L 171.00,693.00 L 171.00,691.00 L 170.00,690.00 L 170.00,689.00 L 169.00,688.00 L 169.00,685.00 L 168.00,684.00 L 168.00,680.00 L 167.00,679.00 L 167.00,673.00 L 166.00,672.00 L 166.00,657.00 L 165.00,656.00 L 165.00,654.00 L 166.00,653.00 L 166.00,642.00 L 167.00,641.00 L 167.00,635.00 L 168.00,634.00 L 168.00,630.00 L 169.00,629.00 L 169.00,626.00 L 170.00,625.00 L 170.00,622.00 L 171.00,621.00 L 171.00,619.00 L 172.00,618.00 L 172.00,616.00 L 173.00,615.00 L 173.00,613.00 L 174.00,612.00 L 174.00,610.00 L 175.00,609.00 L 175.00,608.00 L 176.00,607.00 Z M 213.00,542.00 L 214.00,541.00 L 216.00,543.00 L 216.00,559.00 L 217.00,560.00 L 217.00,565.00 L 218.00,566.00 L 218.00,568.00 L 219.00,569.00 L 219.00,571.00 L 220.00,572.00 L 220.00,573.00 L 225.00,578.00 L 233.00,578.00 L 234.00,577.00 L 235.00,577.00 L 240.00,572.00 L 240.00,571.00 L 241.00,570.00 L 241.00,569.00 L 242.00,568.00 L 242.00,567.00 L 243.00,566.00 L 244.00,567.00 L 244.00,569.00 L 243.00,570.00 L 243.00,572.00 L 242.00,573.00 L 242.00,575.00 L 241.00,576.00 L 241.00,578.00 L 240.00,579.00 L 240.00,580.00 L 238.00,582.00 L 238.00,583.00 L 237.00,584.00 L 237.00,585.00 L 234.00,588.00 L 234.00,589.00 L 231.00,592.00 L 231.00,593.00 L 229.00,595.00 L 229.00,596.00 L 228.00,597.00 L 228.00,598.00 L 227.00,599.00 L 227.00,604.00 L 226.00,605.00 L 226.00,606.00 L 227.00,607.00 L 227.00,615.00 L 228.00,616.00 L 228.00,621.00 L 227.00,622.00 L 223.00,618.00 L 222.00,618.00 L 221.00,617.00 L 218.00,617.00 L 217.00,616.00 L 214.00,616.00 L 213.00,617.00 L 211.00,617.00 L 210.00,618.00 L 209.00,618.00 L 208.00,619.00 L 207.00,619.00 L 206.00,620.00 L 205.00,620.00 L 204.00,621.00 L 203.00,621.00 L 202.00,620.00 L 200.00,620.00 L 198.00,618.00 L 197.00,618.00 L 186.00,607.00 L 185.00,607.00 L 183.00,605.00 L 182.00,605.00 L 181.00,604.00 L 177.00,604.00 L 176.00,603.00 L 177.00,602.00 L 177.00,599.00 L 178.00,598.00 L 178.00,595.00 L 179.00,594.00 L 179.00,590.00 L 180.00,589.00 L 180.00,577.00 L 181.00,576.00 L 181.00,566.00 L 182.00,565.00 L 182.00,559.00 L 183.00,558.00 L 183.00,551.00 L 184.00,550.00 L 185.00,550.00 L 186.00,551.00 L 186.00,553.00 L 187.00,554.00 L 187.00,556.00 L 188.00,557.00 L 188.00,558.00 L 189.00,559.00 L 189.00,560.00 L 191.00,562.00 L 191.00,563.00 L 194.00,566.00 L 200.00,566.00 L 204.00,562.00 L 204.00,561.00 L 205.00,560.00 L 205.00,559.00 L 206.00,558.00 L 206.00,557.00 L 207.00,556.00 L 207.00,555.00 L 208.00,554.00 L 208.00,553.00 L 209.00,552.00 L 209.00,551.00 L 210.00,550.00 L 210.00,548.00 L 211.00,547.00 L 211.00,546.00 L 212.00,545.00 L 212.00,544.00 L 213.00,543.00 Z M 344.00,541.00 L 345.00,540.00 L 346.00,541.00 L 346.00,542.00 L 347.00,543.00 L 347.00,544.00 L 348.00,545.00 L 348.00,546.00 L 349.00,547.00 L 349.00,549.00 L 350.00,550.00 L 350.00,551.00 L 351.00,552.00 L 351.00,553.00 L 352.00,554.00 L 352.00,556.00 L 353.00,557.00 L 353.00,558.00 L 354.00,559.00 L 354.00,560.00 L 356.00,562.00 L 356.00,563.00 L 359.00,566.00 L 365.00,566.00 L 366.00,565.00 L 367.00,565.00 L 367.00,564.00 L 369.00,562.00 L 369.00,561.00 L 371.00,559.00 L 371.00,557.00 L 372.00,556.00 L 372.00,555.00 L 373.00,554.00 L 373.00,552.00 L 374.00,551.00 L 374.00,550.00 L 375.00,549.00 L 376.00,550.00 L 376.00,555.00 L 377.00,556.00 L 377.00,563.00 L 378.00,564.00 L 378.00,572.00 L 379.00,573.00 L 379.00,587.00 L 380.00,588.00 L 380.00,593.00 L 381.00,594.00 L 381.00,597.00 L 382.00,598.00 L 382.00,601.00 L 383.00,602.00 L 383.00,603.00 L 382.00,604.00 L 378.00,604.00 L 376.00,606.00 L 375.00,606.00 L 370.00,611.00 L 369.00,611.00 L 362.00,618.00 L 361.00,618.00 L 359.00,620.00 L 358.00,620.00 L 357.00,621.00 L 355.00,621.00 L 354.00,620.00 L 353.00,620.00 L 352.00,619.00 L 351.00,619.00 L 350.00,618.00 L 349.00,618.00 L 348.00,617.00 L 346.00,617.00 L 345.00,616.00 L 342.00,616.00 L 341.00,617.00 L 339.00,617.00 L 338.00,618.00 L 337.00,618.00 L 336.00,619.00 L 335.00,619.00 L 332.00,622.00 L 331.00,621.00 L 331.00,618.00 L 332.00,617.00 L 332.00,610.00 L 333.00,609.00 L 333.00,602.00 L 332.00,601.00 L 332.00,599.00 L 331.00,598.00 L 331.00,596.00 L 330.00,595.00 L 330.00,594.00 L 326.00,590.00 L 326.00,589.00 L 323.00,586.00 L 323.00,585.00 L 321.00,583.00 L 321.00,582.00 L 320.00,581.00 L 320.00,580.00 L 319.00,579.00 L 319.00,578.00 L 318.00,577.00 L 318.00,575.00 L 317.00,574.00 L 317.00,572.00 L 316.00,571.00 L 316.00,569.00 L 315.00,568.00 L 315.00,566.00 L 316.00,565.00 L 317.00,566.00 L 317.00,567.00 L 318.00,568.00 L 318.00,569.00 L 319.00,570.00 L 319.00,571.00 L 321.00,573.00 L 321.00,574.00 L 323.00,576.00 L 324.00,576.00 L 326.00,578.00 L 334.00,578.00 L 335.00,577.00 L 336.00,577.00 L 338.00,575.00 L 338.00,574.00 L 340.00,572.00 L 340.00,570.00 L 341.00,569.00 L 341.00,567.00 L 342.00,566.00 L 342.00,562.00 L 343.00,561.00 L 343.00,551.00 L 344.00,550.00 L 344.00,542.00 Z M 515.00,373.00 L 516.00,372.00 L 519.00,372.00 L 520.00,373.00 L 520.00,375.00 L 521.00,376.00 L 521.00,381.00 L 522.00,382.00 L 522.00,384.00 L 523.00,385.00 L 523.00,388.00 L 524.00,389.00 L 524.00,390.00 L 523.00,391.00 L 523.00,392.00 L 521.00,394.00 L 521.00,395.00 L 520.00,396.00 L 520.00,397.00 L 519.00,398.00 L 519.00,399.00 L 515.00,403.00 L 514.00,402.00 L 514.00,401.00 L 513.00,400.00 L 513.00,398.00 L 514.00,397.00 L 514.00,396.00 L 515.00,395.00 L 515.00,394.00 L 517.00,392.00 L 517.00,391.00 L 518.00,390.00 L 518.00,386.00 L 517.00,385.00 L 517.00,381.00 L 516.00,380.00 L 516.00,374.00 Z M 40.00,373.00 L 41.00,372.00 L 43.00,372.00 L 44.00,373.00 L 44.00,375.00 L 43.00,376.00 L 43.00,382.00 L 42.00,383.00 L 42.00,387.00 L 41.00,388.00 L 41.00,389.00 L 42.00,390.00 L 42.00,391.00 L 43.00,392.00 L 43.00,393.00 L 45.00,395.00 L 45.00,396.00 L 46.00,397.00 L 46.00,401.00 L 44.00,403.00 L 42.00,401.00 L 42.00,400.00 L 40.00,398.00 L 40.00,397.00 L 38.00,395.00 L 38.00,394.00 L 37.00,393.00 L 37.00,392.00 L 35.00,390.00 L 36.00,389.00 L 36.00,386.00 L 37.00,385.00 L 37.00,383.00 L 38.00,382.00 L 38.00,378.00 L 39.00,377.00 L 39.00,374.00 Z M 525.00,323.00 L 526.00,322.00 L 527.00,323.00 L 527.00,324.00 L 528.00,325.00 L 528.00,340.00 L 529.00,341.00 L 529.00,345.00 L 530.00,346.00 L 530.00,348.00 L 531.00,349.00 L 531.00,352.00 L 532.00,353.00 L 532.00,355.00 L 533.00,356.00 L 533.00,358.00 L 534.00,359.00 L 534.00,362.00 L 535.00,363.00 L 535.00,365.00 L 536.00,366.00 L 536.00,369.00 L 537.00,370.00 L 537.00,378.00 L 536.00,379.00 L 536.00,382.00 L 535.00,383.00 L 535.00,387.00 L 534.00,388.00 L 534.00,391.00 L 533.00,392.00 L 533.00,395.00 L 532.00,396.00 L 532.00,398.00 L 524.00,406.00 L 523.00,406.00 L 519.00,410.00 L 518.00,410.00 L 517.00,409.00 L 517.00,404.00 L 519.00,402.00 L 519.00,401.00 L 521.00,399.00 L 521.00,398.00 L 522.00,397.00 L 522.00,396.00 L 524.00,394.00 L 524.00,393.00 L 525.00,392.00 L 525.00,386.00 L 524.00,385.00 L 524.00,383.00 L 523.00,382.00 L 523.00,378.00 L 522.00,377.00 L 522.00,373.00 L 520.00,371.00 L 519.00,371.00 L 518.00,370.00 L 517.00,370.00 L 516.00,369.00 L 515.00,369.00 L 514.00,368.00 L 513.00,368.00 L 510.00,365.00 L 508.00,365.00 L 508.00,370.00 L 507.00,371.00 L 507.00,376.00 L 506.00,377.00 L 506.00,378.00 L 505.00,379.00 L 505.00,380.00 L 503.00,382.00 L 499.00,382.00 L 497.00,380.00 L 497.00,375.00 L 498.00,374.00 L 498.00,369.00 L 499.00,368.00 L 499.00,364.00 L 500.00,363.00 L 500.00,358.00 L 499.00,357.00 L 499.00,348.00 L 500.00,347.00 L 500.00,345.00 L 501.00,344.00 L 501.00,343.00 L 502.00,342.00 L 502.00,341.00 L 504.00,339.00 L 504.00,338.00 L 505.00,337.00 L 505.00,335.00 L 504.00,334.00 L 504.00,332.00 L 505.00,331.00 L 506.00,332.00 L 509.00,332.00 L 510.00,333.00 L 516.00,333.00 L 517.00,332.00 L 518.00,332.00 L 520.00,330.00 L 521.00,330.00 L 523.00,328.00 L 523.00,327.00 L 525.00,325.00 L 525.00,324.00 Z M 32.00,323.00 L 33.00,322.00 L 34.00,323.00 L 34.00,324.00 L 35.00,325.00 L 35.00,326.00 L 41.00,332.00 L 42.00,332.00 L 43.00,333.00 L 50.00,333.00 L 51.00,332.00 L 53.00,332.00 L 54.00,331.00 L 55.00,332.00 L 55.00,339.00 L 57.00,341.00 L 57.00,342.00 L 59.00,344.00 L 59.00,346.00 L 60.00,347.00 L 60.00,350.00 L 61.00,351.00 L 60.00,352.00 L 60.00,367.00 L 61.00,368.00 L 61.00,372.00 L 62.00,373.00 L 62.00,380.00 L 60.00,382.00 L 56.00,382.00 L 54.00,380.00 L 54.00,379.00 L 53.00,378.00 L 53.00,375.00 L 52.00,374.00 L 52.00,366.00 L 51.00,365.00 L 50.00,365.00 L 49.00,366.00 L 48.00,366.00 L 46.00,368.00 L 45.00,368.00 L 43.00,370.00 L 41.00,370.00 L 40.00,371.00 L 39.00,371.00 L 38.00,372.00 L 38.00,373.00 L 37.00,374.00 L 37.00,379.00 L 36.00,380.00 L 36.00,383.00 L 35.00,384.00 L 35.00,386.00 L 34.00,387.00 L 34.00,392.00 L 36.00,394.00 L 36.00,395.00 L 37.00,396.00 L 37.00,397.00 L 39.00,399.00 L 39.00,400.00 L 42.00,403.00 L 42.00,409.00 L 41.00,410.00 L 40.00,409.00 L 39.00,409.00 L 35.00,405.00 L 34.00,405.00 L 28.00,399.00 L 28.00,398.00 L 27.00,397.00 L 27.00,395.00 L 26.00,394.00 L 26.00,390.00 L 25.00,389.00 L 25.00,386.00 L 24.00,385.00 L 24.00,382.00 L 23.00,381.00 L 23.00,377.00 L 22.00,376.00 L 22.00,371.00 L 23.00,370.00 L 23.00,367.00 L 24.00,366.00 L 24.00,364.00 L 25.00,363.00 L 25.00,360.00 L 26.00,359.00 L 26.00,357.00 L 27.00,356.00 L 27.00,354.00 L 28.00,353.00 L 28.00,350.00 L 29.00,349.00 L 29.00,347.00 L 30.00,346.00 L 30.00,342.00 L 31.00,341.00 L 31.00,327.00 L 32.00,326.00 L 32.00,324.00 Z M 196.00,320.00 L 197.00,319.00 L 198.00,320.00 L 197.00,321.00 Z M 343.00,309.00 L 344.00,308.00 L 345.00,308.00 L 348.00,311.00 L 349.00,311.00 L 355.00,317.00 L 356.00,317.00 L 359.00,320.00 L 359.00,321.00 L 362.00,324.00 L 362.00,325.00 L 363.00,326.00 L 363.00,327.00 L 364.00,328.00 L 364.00,331.00 L 365.00,332.00 L 365.00,343.00 L 366.00,344.00 L 366.00,347.00 L 367.00,348.00 L 367.00,350.00 L 368.00,351.00 L 368.00,353.00 L 369.00,354.00 L 369.00,356.00 L 370.00,357.00 L 370.00,360.00 L 371.00,361.00 L 371.00,364.00 L 372.00,365.00 L 372.00,368.00 L 373.00,369.00 L 373.00,373.00 L 374.00,374.00 L 374.00,378.00 L 375.00,379.00 L 375.00,384.00 L 376.00,385.00 L 376.00,390.00 L 377.00,391.00 L 377.00,395.00 L 378.00,396.00 L 378.00,402.00 L 379.00,403.00 L 379.00,410.00 L 380.00,411.00 L 380.00,418.00 L 381.00,419.00 L 381.00,428.00 L 382.00,429.00 L 382.00,441.00 L 383.00,442.00 L 383.00,490.00 L 382.00,491.00 L 382.00,502.00 L 381.00,503.00 L 381.00,509.00 L 380.00,510.00 L 380.00,516.00 L 379.00,517.00 L 379.00,521.00 L 378.00,522.00 L 378.00,526.00 L 377.00,527.00 L 377.00,530.00 L 376.00,531.00 L 376.00,535.00 L 375.00,536.00 L 375.00,542.00 L 374.00,543.00 L 374.00,546.00 L 373.00,547.00 L 373.00,549.00 L 372.00,550.00 L 372.00,552.00 L 371.00,553.00 L 371.00,554.00 L 370.00,555.00 L 370.00,557.00 L 368.00,559.00 L 368.00,560.00 L 367.00,561.00 L 367.00,562.00 L 365.00,564.00 L 364.00,564.00 L 363.00,565.00 L 361.00,565.00 L 357.00,561.00 L 357.00,560.00 L 355.00,558.00 L 355.00,557.00 L 354.00,556.00 L 354.00,555.00 L 353.00,554.00 L 353.00,552.00 L 352.00,551.00 L 352.00,550.00 L 351.00,549.00 L 351.00,548.00 L 350.00,547.00 L 350.00,545.00 L 349.00,544.00 L 349.00,543.00 L 348.00,542.00 L 348.00,541.00 L 346.00,539.00 L 346.00,538.00 L 345.00,537.00 L 344.00,537.00 L 343.00,538.00 L 343.00,539.00 L 342.00,540.00 L 342.00,555.00 L 341.00,556.00 L 341.00,562.00 L 340.00,563.00 L 340.00,567.00 L 339.00,568.00 L 339.00,569.00 L 338.00,570.00 L 338.00,571.00 L 337.00,572.00 L 337.00,573.00 L 334.00,576.00 L 332.00,576.00 L 331.00,577.00 L 329.00,577.00 L 328.00,576.00 L 326.00,576.00 L 321.00,571.00 L 321.00,570.00 L 319.00,568.00 L 319.00,566.00 L 318.00,565.00 L 318.00,564.00 L 317.00,563.00 L 317.00,561.00 L 316.00,560.00 L 316.00,558.00 L 315.00,557.00 L 315.00,555.00 L 314.00,554.00 L 314.00,551.00 L 313.00,550.00 L 313.00,547.00 L 312.00,546.00 L 312.00,542.00 L 311.00,541.00 L 311.00,536.00 L 310.00,535.00 L 310.00,530.00 L 309.00,529.00 L 309.00,524.00 L 308.00,523.00 L 308.00,521.00 L 307.00,520.00 L 307.00,517.00 L 306.00,516.00 L 306.00,513.00 L 305.00,512.00 L 305.00,508.00 L 304.00,507.00 L 304.00,505.00 L 303.00,504.00 L 303.00,501.00 L 302.00,500.00 L 302.00,497.00 L 301.00,496.00 L 301.00,493.00 L 300.00,492.00 L 300.00,490.00 L 299.00,489.00 L 299.00,486.00 L 298.00,485.00 L 298.00,483.00 L 297.00,482.00 L 297.00,479.00 L 296.00,478.00 L 296.00,475.00 L 295.00,474.00 L 295.00,472.00 L 294.00,471.00 L 294.00,468.00 L 293.00,467.00 L 293.00,464.00 L 292.00,463.00 L 292.00,460.00 L 291.00,459.00 L 291.00,456.00 L 290.00,455.00 L 290.00,451.00 L 289.00,450.00 L 289.00,447.00 L 288.00,446.00 L 288.00,442.00 L 287.00,441.00 L 287.00,436.00 L 286.00,435.00 L 286.00,429.00 L 285.00,428.00 L 285.00,422.00 L 284.00,421.00 L 284.00,413.00 L 283.00,412.00 L 283.00,402.00 L 282.00,401.00 L 282.00,399.00 L 283.00,398.00 L 287.00,402.00 L 288.00,402.00 L 290.00,404.00 L 293.00,404.00 L 294.00,405.00 L 300.00,405.00 L 301.00,406.00 L 310.00,406.00 L 311.00,405.00 L 322.00,405.00 L 323.00,404.00 L 329.00,404.00 L 330.00,403.00 L 332.00,403.00 L 333.00,402.00 L 335.00,402.00 L 336.00,401.00 L 337.00,401.00 L 338.00,400.00 L 339.00,400.00 L 340.00,399.00 L 341.00,399.00 L 343.00,397.00 L 344.00,397.00 L 352.00,389.00 L 352.00,388.00 L 354.00,386.00 L 354.00,385.00 L 355.00,384.00 L 355.00,382.00 L 356.00,381.00 L 356.00,379.00 L 357.00,378.00 L 357.00,375.00 L 358.00,374.00 L 358.00,357.00 L 357.00,356.00 L 357.00,351.00 L 356.00,350.00 L 356.00,347.00 L 355.00,346.00 L 355.00,343.00 L 354.00,342.00 L 354.00,340.00 L 353.00,339.00 L 353.00,337.00 L 352.00,336.00 L 352.00,333.00 L 351.00,332.00 L 351.00,329.00 L 350.00,328.00 L 350.00,326.00 L 349.00,325.00 L 349.00,323.00 L 348.00,322.00 L 348.00,320.00 L 347.00,319.00 L 347.00,317.00 L 346.00,316.00 L 346.00,315.00 L 345.00,314.00 L 345.00,313.00 L 344.00,312.00 L 344.00,311.00 L 343.00,310.00 Z M 342.00,308.00 L 343.00,307.00 L 344.00,308.00 L 343.00,309.00 Z M 215.00,308.00 L 216.00,307.00 L 217.00,308.00 L 217.00,309.00 L 215.00,311.00 L 215.00,312.00 L 214.00,313.00 L 214.00,314.00 L 213.00,315.00 L 213.00,317.00 L 212.00,318.00 L 212.00,320.00 L 211.00,321.00 L 211.00,323.00 L 210.00,324.00 L 210.00,327.00 L 209.00,328.00 L 209.00,330.00 L 208.00,331.00 L 208.00,333.00 L 207.00,334.00 L 207.00,337.00 L 206.00,338.00 L 206.00,340.00 L 205.00,341.00 L 205.00,344.00 L 204.00,345.00 L 204.00,347.00 L 203.00,348.00 L 203.00,351.00 L 202.00,352.00 L 202.00,358.00 L 201.00,359.00 L 201.00,372.00 L 202.00,373.00 L 202.00,378.00 L 203.00,379.00 L 203.00,380.00 L 204.00,381.00 L 204.00,383.00 L 205.00,384.00 L 205.00,385.00 L 206.00,386.00 L 206.00,387.00 L 208.00,389.00 L 208.00,390.00 L 215.00,397.00 L 216.00,397.00 L 218.00,399.00 L 219.00,399.00 L 220.00,400.00 L 221.00,400.00 L 222.00,401.00 L 224.00,401.00 L 225.00,402.00 L 226.00,402.00 L 227.00,403.00 L 229.00,403.00 L 230.00,404.00 L 236.00,404.00 L 237.00,405.00 L 249.00,405.00 L 250.00,406.00 L 258.00,406.00 L 259.00,405.00 L 266.00,405.00 L 267.00,404.00 L 269.00,404.00 L 270.00,403.00 L 271.00,403.00 L 273.00,401.00 L 274.00,401.00 L 276.00,399.00 L 277.00,400.00 L 277.00,405.00 L 276.00,406.00 L 276.00,415.00 L 275.00,416.00 L 275.00,423.00 L 274.00,424.00 L 274.00,431.00 L 273.00,432.00 L 273.00,437.00 L 272.00,438.00 L 272.00,442.00 L 271.00,443.00 L 271.00,447.00 L 270.00,448.00 L 270.00,452.00 L 269.00,453.00 L 269.00,456.00 L 268.00,457.00 L 268.00,460.00 L 267.00,461.00 L 267.00,464.00 L 266.00,465.00 L 266.00,468.00 L 265.00,469.00 L 265.00,472.00 L 264.00,473.00 L 264.00,476.00 L 263.00,477.00 L 263.00,479.00 L 262.00,480.00 L 262.00,483.00 L 261.00,484.00 L 261.00,486.00 L 260.00,487.00 L 260.00,490.00 L 259.00,491.00 L 259.00,494.00 L 258.00,495.00 L 258.00,497.00 L 257.00,498.00 L 257.00,501.00 L 256.00,502.00 L 256.00,505.00 L 255.00,506.00 L 255.00,509.00 L 254.00,510.00 L 254.00,513.00 L 253.00,514.00 L 253.00,517.00 L 252.00,518.00 L 252.00,521.00 L 251.00,522.00 L 251.00,525.00 L 250.00,526.00 L 250.00,531.00 L 249.00,532.00 L 249.00,537.00 L 248.00,538.00 L 248.00,543.00 L 247.00,544.00 L 247.00,547.00 L 246.00,548.00 L 246.00,551.00 L 245.00,552.00 L 245.00,555.00 L 244.00,556.00 L 244.00,558.00 L 243.00,559.00 L 243.00,561.00 L 242.00,562.00 L 242.00,564.00 L 241.00,565.00 L 241.00,566.00 L 240.00,567.00 L 240.00,568.00 L 239.00,569.00 L 239.00,570.00 L 233.00,576.00 L 231.00,576.00 L 230.00,577.00 L 229.00,577.00 L 228.00,576.00 L 226.00,576.00 L 221.00,571.00 L 221.00,570.00 L 220.00,569.00 L 220.00,567.00 L 219.00,566.00 L 219.00,562.00 L 218.00,561.00 L 218.00,549.00 L 217.00,548.00 L 217.00,539.00 L 216.00,538.00 L 216.00,537.00 L 215.00,537.00 L 212.00,540.00 L 212.00,541.00 L 211.00,542.00 L 211.00,543.00 L 210.00,544.00 L 210.00,545.00 L 209.00,546.00 L 209.00,548.00 L 208.00,549.00 L 208.00,550.00 L 207.00,551.00 L 207.00,552.00 L 206.00,553.00 L 206.00,554.00 L 205.00,555.00 L 205.00,557.00 L 203.00,559.00 L 203.00,560.00 L 202.00,561.00 L 202.00,562.00 L 201.00,563.00 L 200.00,563.00 L 198.00,565.00 L 196.00,565.00 L 191.00,560.00 L 191.00,559.00 L 190.00,558.00 L 190.00,557.00 L 189.00,556.00 L 189.00,555.00 L 188.00,554.00 L 188.00,552.00 L 187.00,551.00 L 187.00,549.00 L 186.00,548.00 L 186.00,545.00 L 185.00,544.00 L 185.00,541.00 L 184.00,540.00 L 184.00,534.00 L 183.00,533.00 L 183.00,530.00 L 182.00,529.00 L 182.00,525.00 L 181.00,524.00 L 181.00,520.00 L 180.00,519.00 L 180.00,515.00 L 179.00,514.00 L 179.00,508.00 L 178.00,507.00 L 178.00,500.00 L 177.00,499.00 L 177.00,488.00 L 176.00,487.00 L 176.00,446.00 L 177.00,445.00 L 177.00,433.00 L 178.00,432.00 L 178.00,421.00 L 179.00,420.00 L 179.00,413.00 L 180.00,412.00 L 180.00,405.00 L 181.00,404.00 L 181.00,398.00 L 182.00,397.00 L 182.00,392.00 L 183.00,391.00 L 183.00,387.00 L 184.00,386.00 L 184.00,381.00 L 185.00,380.00 L 185.00,376.00 L 186.00,375.00 L 186.00,371.00 L 187.00,370.00 L 187.00,366.00 L 188.00,365.00 L 188.00,362.00 L 189.00,361.00 L 189.00,358.00 L 190.00,357.00 L 190.00,355.00 L 191.00,354.00 L 191.00,352.00 L 192.00,351.00 L 192.00,349.00 L 193.00,348.00 L 193.00,345.00 L 194.00,344.00 L 194.00,338.00 L 195.00,337.00 L 195.00,335.00 L 194.00,334.00 L 195.00,333.00 L 195.00,328.00 L 197.00,326.00 L 197.00,325.00 L 198.00,324.00 L 198.00,323.00 L 208.00,313.00 L 209.00,313.00 L 213.00,309.00 L 214.00,309.00 Z M 304.00,298.00 L 305.00,297.00 L 318.00,297.00 L 319.00,298.00 L 323.00,298.00 L 324.00,299.00 L 326.00,299.00 L 327.00,300.00 L 328.00,300.00 L 329.00,301.00 L 331.00,301.00 L 333.00,303.00 L 334.00,303.00 L 336.00,305.00 L 337.00,305.00 L 339.00,307.00 L 339.00,308.00 L 342.00,311.00 L 342.00,312.00 L 344.00,314.00 L 344.00,316.00 L 345.00,317.00 L 345.00,318.00 L 346.00,319.00 L 346.00,322.00 L 347.00,323.00 L 347.00,325.00 L 348.00,326.00 L 348.00,328.00 L 349.00,329.00 L 349.00,331.00 L 350.00,332.00 L 350.00,335.00 L 351.00,336.00 L 351.00,338.00 L 352.00,339.00 L 352.00,342.00 L 353.00,343.00 L 353.00,346.00 L 354.00,347.00 L 354.00,349.00 L 355.00,350.00 L 355.00,354.00 L 356.00,355.00 L 356.00,360.00 L 357.00,361.00 L 357.00,371.00 L 356.00,372.00 L 356.00,376.00 L 355.00,377.00 L 355.00,379.00 L 354.00,380.00 L 354.00,382.00 L 353.00,383.00 L 353.00,384.00 L 351.00,386.00 L 351.00,387.00 L 349.00,389.00 L 349.00,390.00 L 348.00,391.00 L 347.00,391.00 L 342.00,396.00 L 341.00,396.00 L 339.00,398.00 L 338.00,398.00 L 337.00,399.00 L 336.00,399.00 L 335.00,400.00 L 333.00,400.00 L 332.00,401.00 L 330.00,401.00 L 329.00,402.00 L 325.00,402.00 L 324.00,403.00 L 318.00,403.00 L 317.00,404.00 L 297.00,404.00 L 296.00,403.00 L 293.00,403.00 L 292.00,402.00 L 291.00,402.00 L 290.00,401.00 L 289.00,401.00 L 288.00,400.00 L 287.00,400.00 L 286.00,399.00 L 286.00,398.00 L 283.00,395.00 L 283.00,393.00 L 282.00,392.00 L 282.00,389.00 L 281.00,388.00 L 281.00,323.00 L 282.00,322.00 L 282.00,319.00 L 283.00,318.00 L 283.00,316.00 L 284.00,315.00 L 284.00,314.00 L 285.00,313.00 L 285.00,312.00 L 286.00,311.00 L 286.00,310.00 L 288.00,308.00 L 288.00,307.00 L 292.00,303.00 L 293.00,303.00 L 295.00,301.00 L 296.00,301.00 L 297.00,300.00 L 298.00,300.00 L 299.00,299.00 L 301.00,299.00 L 302.00,298.00 L 303.00,298.00 Z M 240.00,298.00 L 241.00,297.00 L 254.00,297.00 L 255.00,298.00 L 258.00,298.00 L 259.00,299.00 L 260.00,299.00 L 261.00,300.00 L 262.00,300.00 L 263.00,301.00 L 264.00,301.00 L 265.00,302.00 L 266.00,302.00 L 273.00,309.00 L 273.00,310.00 L 274.00,311.00 L 274.00,312.00 L 275.00,313.00 L 275.00,314.00 L 276.00,315.00 L 276.00,316.00 L 277.00,317.00 L 277.00,320.00 L 278.00,321.00 L 278.00,327.00 L 279.00,328.00 L 279.00,332.00 L 278.00,333.00 L 279.00,334.00 L 279.00,383.00 L 278.00,384.00 L 278.00,390.00 L 277.00,391.00 L 277.00,393.00 L 276.00,394.00 L 276.00,395.00 L 274.00,397.00 L 274.00,398.00 L 271.00,401.00 L 270.00,401.00 L 269.00,402.00 L 267.00,402.00 L 266.00,403.00 L 263.00,403.00 L 262.00,404.00 L 242.00,404.00 L 241.00,403.00 L 235.00,403.00 L 234.00,402.00 L 230.00,402.00 L 229.00,401.00 L 227.00,401.00 L 226.00,400.00 L 224.00,400.00 L 223.00,399.00 L 222.00,399.00 L 220.00,397.00 L 219.00,397.00 L 218.00,396.00 L 217.00,396.00 L 208.00,387.00 L 208.00,386.00 L 207.00,385.00 L 207.00,384.00 L 206.00,383.00 L 206.00,382.00 L 205.00,381.00 L 205.00,379.00 L 204.00,378.00 L 204.00,376.00 L 203.00,375.00 L 203.00,357.00 L 204.00,356.00 L 204.00,351.00 L 205.00,350.00 L 205.00,348.00 L 206.00,347.00 L 206.00,344.00 L 207.00,343.00 L 207.00,340.00 L 208.00,339.00 L 208.00,337.00 L 209.00,336.00 L 209.00,333.00 L 210.00,332.00 L 210.00,330.00 L 211.00,329.00 L 211.00,327.00 L 212.00,326.00 L 212.00,323.00 L 213.00,322.00 L 213.00,321.00 L 214.00,320.00 L 214.00,318.00 L 215.00,317.00 L 215.00,316.00 L 216.00,315.00 L 216.00,313.00 L 218.00,311.00 L 218.00,310.00 L 224.00,304.00 L 225.00,304.00 L 227.00,302.00 L 228.00,302.00 L 229.00,301.00 L 230.00,301.00 L 231.00,300.00 L 232.00,300.00 L 233.00,299.00 L 235.00,299.00 L 236.00,298.00 L 239.00,298.00 Z M 425.00,221.00 L 426.00,220.00 L 427.00,221.00 L 426.00,222.00 Z M 132.00,221.00 L 133.00,220.00 L 134.00,221.00 L 133.00,222.00 Z M 133.00,220.00 L 134.00,219.00 L 135.00,220.00 L 134.00,221.00 Z M 95.00,201.00 L 96.00,200.00 L 98.00,202.00 L 98.00,203.00 L 99.00,204.00 L 106.00,204.00 L 107.00,203.00 L 109.00,203.00 L 110.00,202.00 L 115.00,202.00 L 116.00,203.00 L 116.00,204.00 L 117.00,205.00 L 117.00,211.00 L 118.00,212.00 L 118.00,219.00 L 119.00,220.00 L 119.00,221.00 L 122.00,224.00 L 125.00,224.00 L 126.00,223.00 L 128.00,223.00 L 129.00,222.00 L 130.00,222.00 L 131.00,221.00 L 132.00,221.00 L 133.00,222.00 L 133.00,223.00 L 130.00,226.00 L 130.00,227.00 L 127.00,230.00 L 127.00,231.00 L 124.00,234.00 L 124.00,235.00 L 122.00,237.00 L 122.00,238.00 L 120.00,240.00 L 120.00,241.00 L 118.00,243.00 L 118.00,244.00 L 117.00,245.00 L 117.00,246.00 L 115.00,248.00 L 115.00,249.00 L 114.00,250.00 L 114.00,251.00 L 112.00,253.00 L 112.00,254.00 L 111.00,255.00 L 111.00,256.00 L 109.00,258.00 L 109.00,259.00 L 108.00,260.00 L 108.00,261.00 L 106.00,263.00 L 106.00,264.00 L 105.00,265.00 L 105.00,266.00 L 103.00,268.00 L 103.00,269.00 L 101.00,271.00 L 101.00,272.00 L 99.00,274.00 L 99.00,275.00 L 97.00,277.00 L 97.00,278.00 L 94.00,281.00 L 94.00,282.00 L 89.00,287.00 L 89.00,288.00 L 75.00,302.00 L 75.00,303.00 L 69.00,309.00 L 69.00,310.00 L 65.00,314.00 L 65.00,315.00 L 63.00,317.00 L 63.00,318.00 L 61.00,320.00 L 61.00,321.00 L 59.00,323.00 L 59.00,324.00 L 58.00,325.00 L 58.00,326.00 L 54.00,330.00 L 52.00,330.00 L 51.00,331.00 L 43.00,331.00 L 41.00,329.00 L 40.00,329.00 L 38.00,327.00 L 38.00,326.00 L 36.00,324.00 L 36.00,323.00 L 35.00,322.00 L 35.00,318.00 L 36.00,317.00 L 36.00,315.00 L 37.00,314.00 L 37.00,312.00 L 38.00,311.00 L 38.00,309.00 L 39.00,308.00 L 39.00,306.00 L 40.00,305.00 L 40.00,303.00 L 41.00,302.00 L 41.00,300.00 L 42.00,299.00 L 42.00,297.00 L 43.00,296.00 L 43.00,294.00 L 44.00,293.00 L 44.00,291.00 L 45.00,290.00 L 45.00,288.00 L 46.00,287.00 L 46.00,285.00 L 47.00,284.00 L 47.00,282.00 L 48.00,281.00 L 48.00,279.00 L 49.00,278.00 L 49.00,276.00 L 50.00,275.00 L 50.00,274.00 L 51.00,273.00 L 51.00,271.00 L 52.00,270.00 L 52.00,268.00 L 53.00,267.00 L 53.00,265.00 L 54.00,264.00 L 54.00,263.00 L 55.00,262.00 L 55.00,260.00 L 56.00,259.00 L 56.00,257.00 L 57.00,256.00 L 57.00,255.00 L 58.00,254.00 L 58.00,253.00 L 59.00,252.00 L 59.00,250.00 L 60.00,249.00 L 60.00,248.00 L 61.00,247.00 L 61.00,246.00 L 62.00,245.00 L 62.00,244.00 L 63.00,243.00 L 63.00,242.00 L 64.00,241.00 L 64.00,240.00 L 65.00,239.00 L 65.00,238.00 L 67.00,236.00 L 67.00,235.00 L 69.00,233.00 L 69.00,232.00 L 70.00,231.00 L 70.00,230.00 L 73.00,227.00 L 73.00,226.00 L 75.00,224.00 L 75.00,223.00 L 78.00,220.00 L 78.00,219.00 L 82.00,215.00 L 82.00,214.00 L 94.00,202.00 Z M 462.00,200.00 L 463.00,199.00 L 471.00,207.00 L 471.00,208.00 L 478.00,215.00 L 478.00,216.00 L 482.00,220.00 L 482.00,221.00 L 485.00,224.00 L 485.00,225.00 L 487.00,227.00 L 487.00,228.00 L 489.00,230.00 L 489.00,231.00 L 491.00,233.00 L 491.00,234.00 L 493.00,236.00 L 493.00,237.00 L 494.00,238.00 L 494.00,239.00 L 495.00,240.00 L 495.00,241.00 L 496.00,242.00 L 496.00,243.00 L 498.00,245.00 L 498.00,246.00 L 499.00,247.00 L 499.00,249.00 L 500.00,250.00 L 500.00,251.00 L 501.00,252.00 L 501.00,253.00 L 502.00,254.00 L 502.00,255.00 L 503.00,256.00 L 503.00,258.00 L 504.00,259.00 L 504.00,261.00 L 505.00,262.00 L 505.00,263.00 L 506.00,264.00 L 506.00,266.00 L 507.00,267.00 L 507.00,269.00 L 508.00,270.00 L 508.00,272.00 L 509.00,273.00 L 509.00,274.00 L 510.00,275.00 L 510.00,277.00 L 511.00,278.00 L 511.00,280.00 L 512.00,281.00 L 512.00,283.00 L 513.00,284.00 L 513.00,286.00 L 514.00,287.00 L 514.00,289.00 L 515.00,290.00 L 515.00,292.00 L 516.00,293.00 L 516.00,295.00 L 517.00,296.00 L 517.00,298.00 L 518.00,299.00 L 518.00,301.00 L 519.00,302.00 L 519.00,304.00 L 520.00,305.00 L 520.00,307.00 L 521.00,308.00 L 521.00,310.00 L 522.00,311.00 L 522.00,313.00 L 523.00,314.00 L 523.00,316.00 L 524.00,317.00 L 524.00,318.00 L 525.00,319.00 L 525.00,320.00 L 524.00,321.00 L 524.00,322.00 L 523.00,323.00 L 523.00,324.00 L 522.00,325.00 L 522.00,326.00 L 518.00,330.00 L 517.00,330.00 L 516.00,331.00 L 508.00,331.00 L 507.00,330.00 L 506.00,330.00 L 505.00,329.00 L 504.00,329.00 L 502.00,327.00 L 502.00,326.00 L 501.00,325.00 L 501.00,324.00 L 499.00,322.00 L 499.00,321.00 L 497.00,319.00 L 497.00,318.00 L 495.00,316.00 L 495.00,315.00 L 492.00,312.00 L 492.00,311.00 L 486.00,305.00 L 486.00,304.00 L 474.00,292.00 L 474.00,291.00 L 467.00,284.00 L 467.00,283.00 L 464.00,280.00 L 464.00,279.00 L 461.00,276.00 L 461.00,275.00 L 459.00,273.00 L 459.00,272.00 L 457.00,270.00 L 457.00,269.00 L 455.00,267.00 L 455.00,266.00 L 453.00,264.00 L 453.00,263.00 L 452.00,262.00 L 452.00,261.00 L 450.00,259.00 L 450.00,258.00 L 449.00,257.00 L 449.00,256.00 L 448.00,255.00 L 448.00,254.00 L 446.00,252.00 L 446.00,251.00 L 445.00,250.00 L 445.00,249.00 L 443.00,247.00 L 443.00,246.00 L 442.00,245.00 L 442.00,244.00 L 440.00,242.00 L 440.00,241.00 L 438.00,239.00 L 438.00,238.00 L 436.00,236.00 L 436.00,235.00 L 433.00,232.00 L 433.00,231.00 L 430.00,228.00 L 430.00,227.00 L 427.00,224.00 L 427.00,223.00 L 426.00,222.00 L 427.00,221.00 L 428.00,221.00 L 429.00,222.00 L 430.00,222.00 L 431.00,223.00 L 434.00,223.00 L 435.00,224.00 L 437.00,224.00 L 438.00,223.00 L 439.00,223.00 L 440.00,222.00 L 440.00,221.00 L 441.00,220.00 L 441.00,216.00 L 442.00,215.00 L 442.00,206.00 L 443.00,205.00 L 443.00,204.00 L 445.00,202.00 L 449.00,202.00 L 450.00,203.00 L 453.00,203.00 L 454.00,204.00 L 460.00,204.00 L 462.00,202.00 L 462.00,201.00 Z M 267.00,175.00 L 268.00,174.00 L 269.00,175.00 L 269.00,176.00 L 270.00,177.00 L 270.00,179.00 L 271.00,180.00 L 271.00,181.00 L 272.00,182.00 L 272.00,183.00 L 273.00,184.00 L 273.00,185.00 L 276.00,188.00 L 277.00,188.00 L 278.00,189.00 L 282.00,189.00 L 286.00,185.00 L 286.00,184.00 L 287.00,183.00 L 287.00,182.00 L 288.00,181.00 L 288.00,180.00 L 289.00,179.00 L 289.00,178.00 L 290.00,177.00 L 290.00,175.00 L 291.00,174.00 L 292.00,175.00 L 292.00,191.00 L 293.00,192.00 L 293.00,194.00 L 294.00,195.00 L 294.00,198.00 L 295.00,199.00 L 295.00,201.00 L 296.00,202.00 L 296.00,204.00 L 297.00,205.00 L 297.00,206.00 L 298.00,207.00 L 298.00,209.00 L 299.00,210.00 L 299.00,211.00 L 300.00,212.00 L 300.00,214.00 L 301.00,215.00 L 301.00,216.00 L 302.00,217.00 L 302.00,218.00 L 303.00,219.00 L 303.00,221.00 L 304.00,222.00 L 304.00,223.00 L 305.00,224.00 L 305.00,225.00 L 306.00,226.00 L 306.00,227.00 L 307.00,228.00 L 307.00,229.00 L 308.00,230.00 L 308.00,231.00 L 309.00,232.00 L 309.00,233.00 L 310.00,234.00 L 310.00,235.00 L 311.00,236.00 L 311.00,237.00 L 312.00,238.00 L 312.00,239.00 L 313.00,240.00 L 313.00,241.00 L 314.00,242.00 L 314.00,243.00 L 315.00,244.00 L 315.00,246.00 L 316.00,247.00 L 316.00,248.00 L 317.00,249.00 L 317.00,252.00 L 318.00,253.00 L 318.00,257.00 L 319.00,258.00 L 319.00,289.00 L 320.00,290.00 L 320.00,291.00 L 321.00,292.00 L 321.00,293.00 L 322.00,294.00 L 322.00,295.00 L 321.00,296.00 L 317.00,296.00 L 316.00,295.00 L 307.00,295.00 L 306.00,296.00 L 302.00,296.00 L 301.00,297.00 L 299.00,297.00 L 298.00,298.00 L 297.00,298.00 L 296.00,299.00 L 295.00,299.00 L 294.00,300.00 L 293.00,300.00 L 291.00,302.00 L 290.00,302.00 L 288.00,304.00 L 288.00,305.00 L 285.00,308.00 L 285.00,309.00 L 283.00,311.00 L 283.00,312.00 L 282.00,313.00 L 282.00,315.00 L 281.00,316.00 L 281.00,318.00 L 280.00,319.00 L 278.00,317.00 L 278.00,315.00 L 277.00,314.00 L 277.00,313.00 L 276.00,312.00 L 276.00,311.00 L 275.00,310.00 L 275.00,309.00 L 273.00,307.00 L 273.00,306.00 L 268.00,301.00 L 267.00,301.00 L 266.00,300.00 L 265.00,300.00 L 263.00,298.00 L 261.00,298.00 L 260.00,297.00 L 258.00,297.00 L 257.00,296.00 L 253.00,296.00 L 252.00,295.00 L 243.00,295.00 L 242.00,296.00 L 238.00,296.00 L 237.00,295.00 L 238.00,294.00 L 238.00,293.00 L 239.00,292.00 L 239.00,291.00 L 240.00,290.00 L 240.00,287.00 L 241.00,286.00 L 241.00,255.00 L 242.00,254.00 L 242.00,250.00 L 243.00,249.00 L 243.00,248.00 L 244.00,247.00 L 244.00,245.00 L 245.00,244.00 L 245.00,243.00 L 246.00,242.00 L 246.00,241.00 L 247.00,240.00 L 247.00,239.00 L 248.00,238.00 L 248.00,237.00 L 249.00,236.00 L 249.00,235.00 L 250.00,234.00 L 250.00,233.00 L 251.00,232.00 L 251.00,231.00 L 252.00,230.00 L 252.00,229.00 L 253.00,228.00 L 253.00,227.00 L 254.00,226.00 L 254.00,225.00 L 255.00,224.00 L 255.00,223.00 L 256.00,222.00 L 256.00,221.00 L 257.00,220.00 L 257.00,218.00 L 258.00,217.00 L 258.00,216.00 L 259.00,215.00 L 259.00,214.00 L 260.00,213.00 L 260.00,211.00 L 261.00,210.00 L 261.00,209.00 L 262.00,208.00 L 262.00,206.00 L 263.00,205.00 L 263.00,203.00 L 264.00,202.00 L 264.00,200.00 L 265.00,199.00 L 265.00,196.00 L 266.00,195.00 L 266.00,193.00 L 267.00,192.00 L 267.00,184.00 L 268.00,183.00 L 268.00,178.00 L 267.00,177.00 L 267.00,176.00 Z M 386.00,120.00 L 387.00,119.00 L 388.00,119.00 L 389.00,120.00 L 393.00,120.00 L 394.00,121.00 L 397.00,121.00 L 398.00,122.00 L 405.00,122.00 L 406.00,123.00 L 414.00,123.00 L 415.00,124.00 L 417.00,124.00 L 418.00,125.00 L 419.00,125.00 L 421.00,127.00 L 422.00,127.00 L 433.00,138.00 L 433.00,139.00 L 436.00,142.00 L 436.00,143.00 L 438.00,145.00 L 438.00,146.00 L 440.00,148.00 L 440.00,149.00 L 441.00,150.00 L 441.00,151.00 L 442.00,152.00 L 442.00,153.00 L 443.00,154.00 L 443.00,155.00 L 444.00,156.00 L 444.00,157.00 L 445.00,158.00 L 445.00,159.00 L 446.00,160.00 L 446.00,162.00 L 447.00,163.00 L 447.00,165.00 L 448.00,166.00 L 448.00,167.00 L 449.00,168.00 L 449.00,169.00 L 450.00,170.00 L 450.00,171.00 L 451.00,172.00 L 451.00,173.00 L 452.00,174.00 L 452.00,175.00 L 453.00,176.00 L 453.00,177.00 L 454.00,178.00 L 454.00,179.00 L 455.00,180.00 L 455.00,181.00 L 456.00,182.00 L 456.00,183.00 L 457.00,184.00 L 457.00,186.00 L 458.00,187.00 L 458.00,190.00 L 459.00,191.00 L 459.00,193.00 L 460.00,194.00 L 460.00,198.00 L 461.00,199.00 L 460.00,200.00 L 460.00,201.00 L 458.00,203.00 L 457.00,202.00 L 453.00,202.00 L 452.00,201.00 L 449.00,201.00 L 448.00,200.00 L 445.00,200.00 L 444.00,201.00 L 443.00,201.00 L 442.00,202.00 L 442.00,203.00 L 441.00,204.00 L 441.00,207.00 L 440.00,208.00 L 440.00,216.00 L 439.00,217.00 L 439.00,219.00 L 438.00,220.00 L 438.00,221.00 L 437.00,222.00 L 433.00,222.00 L 432.00,221.00 L 431.00,221.00 L 430.00,220.00 L 429.00,220.00 L 427.00,218.00 L 426.00,218.00 L 423.00,215.00 L 422.00,215.00 L 417.00,210.00 L 416.00,210.00 L 415.00,209.00 L 415.00,208.00 L 409.00,202.00 L 409.00,201.00 L 406.00,198.00 L 406.00,197.00 L 403.00,194.00 L 403.00,193.00 L 401.00,191.00 L 401.00,190.00 L 399.00,188.00 L 399.00,187.00 L 397.00,185.00 L 397.00,184.00 L 395.00,182.00 L 395.00,181.00 L 393.00,179.00 L 393.00,178.00 L 391.00,176.00 L 391.00,175.00 L 389.00,173.00 L 389.00,172.00 L 387.00,170.00 L 387.00,169.00 L 385.00,167.00 L 385.00,166.00 L 384.00,165.00 L 384.00,164.00 L 383.00,163.00 L 383.00,162.00 L 382.00,161.00 L 382.00,153.00 L 383.00,152.00 L 383.00,147.00 L 384.00,146.00 L 384.00,142.00 L 385.00,141.00 L 385.00,137.00 L 386.00,136.00 L 386.00,130.00 L 387.00,129.00 L 387.00,122.00 L 386.00,121.00 Z M 170.00,120.00 L 171.00,119.00 L 172.00,119.00 L 173.00,120.00 L 173.00,134.00 L 174.00,135.00 L 174.00,139.00 L 175.00,140.00 L 175.00,144.00 L 176.00,145.00 L 176.00,150.00 L 177.00,151.00 L 177.00,162.00 L 176.00,163.00 L 176.00,164.00 L 175.00,165.00 L 175.00,166.00 L 173.00,168.00 L 173.00,169.00 L 171.00,171.00 L 171.00,172.00 L 169.00,174.00 L 169.00,175.00 L 167.00,177.00 L 167.00,178.00 L 165.00,180.00 L 165.00,181.00 L 163.00,183.00 L 163.00,184.00 L 161.00,186.00 L 161.00,187.00 L 159.00,189.00 L 159.00,190.00 L 157.00,192.00 L 157.00,193.00 L 154.00,196.00 L 154.00,197.00 L 151.00,200.00 L 151.00,201.00 L 147.00,205.00 L 147.00,206.00 L 142.00,211.00 L 141.00,211.00 L 136.00,216.00 L 135.00,216.00 L 132.00,219.00 L 131.00,219.00 L 130.00,220.00 L 129.00,220.00 L 127.00,222.00 L 123.00,222.00 L 120.00,219.00 L 120.00,215.00 L 119.00,214.00 L 119.00,206.00 L 118.00,205.00 L 118.00,203.00 L 117.00,202.00 L 117.00,201.00 L 115.00,201.00 L 114.00,200.00 L 111.00,200.00 L 110.00,201.00 L 107.00,201.00 L 106.00,202.00 L 102.00,202.00 L 101.00,203.00 L 99.00,201.00 L 99.00,195.00 L 100.00,194.00 L 100.00,192.00 L 101.00,191.00 L 101.00,189.00 L 102.00,188.00 L 102.00,185.00 L 103.00,184.00 L 103.00,182.00 L 105.00,180.00 L 105.00,179.00 L 106.00,178.00 L 106.00,177.00 L 107.00,176.00 L 107.00,175.00 L 108.00,174.00 L 108.00,173.00 L 109.00,172.00 L 109.00,171.00 L 110.00,170.00 L 110.00,169.00 L 111.00,168.00 L 111.00,167.00 L 112.00,166.00 L 112.00,164.00 L 113.00,163.00 L 113.00,161.00 L 114.00,160.00 L 114.00,159.00 L 115.00,158.00 L 115.00,156.00 L 116.00,155.00 L 116.00,154.00 L 117.00,153.00 L 117.00,152.00 L 118.00,151.00 L 118.00,150.00 L 120.00,148.00 L 120.00,147.00 L 121.00,146.00 L 121.00,145.00 L 124.00,142.00 L 124.00,141.00 L 128.00,137.00 L 128.00,136.00 L 136.00,128.00 L 137.00,128.00 L 140.00,125.00 L 142.00,125.00 L 143.00,124.00 L 144.00,124.00 L 145.00,123.00 L 153.00,123.00 L 154.00,122.00 L 161.00,122.00 L 162.00,121.00 L 165.00,121.00 L 166.00,120.00 L 169.00,120.00 Z M 264.00,82.00 L 265.00,81.00 L 295.00,81.00 L 296.00,82.00 L 302.00,82.00 L 303.00,83.00 L 309.00,83.00 L 310.00,84.00 L 314.00,84.00 L 315.00,85.00 L 324.00,85.00 L 325.00,84.00 L 326.00,84.00 L 327.00,85.00 L 327.00,86.00 L 326.00,87.00 L 326.00,88.00 L 325.00,89.00 L 325.00,90.00 L 324.00,91.00 L 324.00,92.00 L 323.00,93.00 L 323.00,94.00 L 322.00,95.00 L 322.00,96.00 L 321.00,97.00 L 321.00,98.00 L 320.00,99.00 L 320.00,100.00 L 319.00,101.00 L 319.00,102.00 L 318.00,103.00 L 318.00,104.00 L 317.00,105.00 L 317.00,106.00 L 316.00,107.00 L 316.00,108.00 L 315.00,109.00 L 315.00,110.00 L 314.00,111.00 L 314.00,112.00 L 313.00,113.00 L 313.00,115.00 L 312.00,116.00 L 312.00,117.00 L 311.00,118.00 L 311.00,119.00 L 310.00,120.00 L 310.00,121.00 L 309.00,122.00 L 309.00,124.00 L 308.00,125.00 L 308.00,126.00 L 307.00,127.00 L 307.00,128.00 L 306.00,129.00 L 306.00,130.00 L 305.00,131.00 L 305.00,132.00 L 304.00,133.00 L 304.00,135.00 L 303.00,136.00 L 303.00,137.00 L 302.00,138.00 L 302.00,140.00 L 301.00,141.00 L 301.00,143.00 L 300.00,144.00 L 300.00,145.00 L 299.00,146.00 L 299.00,147.00 L 298.00,148.00 L 298.00,150.00 L 297.00,151.00 L 297.00,152.00 L 296.00,153.00 L 296.00,155.00 L 295.00,156.00 L 295.00,158.00 L 294.00,159.00 L 294.00,161.00 L 293.00,162.00 L 293.00,164.00 L 292.00,165.00 L 292.00,166.00 L 291.00,167.00 L 291.00,169.00 L 290.00,170.00 L 290.00,172.00 L 289.00,173.00 L 289.00,174.00 L 288.00,175.00 L 288.00,177.00 L 287.00,178.00 L 287.00,179.00 L 286.00,180.00 L 286.00,181.00 L 285.00,182.00 L 285.00,183.00 L 284.00,184.00 L 284.00,185.00 L 283.00,186.00 L 282.00,186.00 L 281.00,187.00 L 278.00,187.00 L 275.00,184.00 L 275.00,183.00 L 273.00,181.00 L 273.00,180.00 L 272.00,179.00 L 272.00,177.00 L 271.00,176.00 L 271.00,175.00 L 270.00,174.00 L 270.00,172.00 L 269.00,171.00 L 269.00,169.00 L 268.00,168.00 L 268.00,167.00 L 267.00,166.00 L 267.00,164.00 L 266.00,163.00 L 266.00,161.00 L 265.00,160.00 L 265.00,158.00 L 264.00,157.00 L 264.00,155.00 L 263.00,154.00 L 263.00,152.00 L 262.00,151.00 L 262.00,149.00 L 260.00,147.00 L 260.00,145.00 L 259.00,144.00 L 259.00,143.00 L 258.00,142.00 L 258.00,140.00 L 257.00,139.00 L 257.00,138.00 L 256.00,137.00 L 256.00,135.00 L 255.00,134.00 L 255.00,133.00 L 254.00,132.00 L 254.00,131.00 L 253.00,130.00 L 253.00,128.00 L 252.00,127.00 L 252.00,126.00 L 251.00,125.00 L 251.00,124.00 L 250.00,123.00 L 250.00,122.00 L 249.00,121.00 L 249.00,119.00 L 248.00,118.00 L 248.00,117.00 L 247.00,116.00 L 247.00,115.00 L 246.00,114.00 L 246.00,112.00 L 245.00,111.00 L 245.00,110.00 L 244.00,109.00 L 244.00,108.00 L 243.00,107.00 L 243.00,106.00 L 242.00,105.00 L 242.00,104.00 L 241.00,103.00 L 241.00,102.00 L 240.00,101.00 L 240.00,100.00 L 239.00,99.00 L 239.00,98.00 L 238.00,97.00 L 238.00,96.00 L 237.00,95.00 L 237.00,94.00 L 236.00,93.00 L 236.00,92.00 L 235.00,91.00 L 235.00,90.00 L 234.00,89.00 L 234.00,88.00 L 233.00,87.00 L 233.00,86.00 L 232.00,85.00 L 233.00,84.00 L 234.00,84.00 L 235.00,85.00 L 244.00,85.00 L 245.00,84.00 L 250.00,84.00 L 251.00,83.00 L 257.00,83.00 L 258.00,82.00 L 263.00,82.00 Z M 331.00,81.00 L 332.00,80.00 L 333.00,80.00 L 334.00,81.00 L 335.00,81.00 L 342.00,88.00 L 343.00,88.00 L 347.00,92.00 L 348.00,92.00 L 351.00,95.00 L 352.00,95.00 L 355.00,98.00 L 356.00,98.00 L 360.00,102.00 L 361.00,102.00 L 365.00,106.00 L 366.00,106.00 L 369.00,109.00 L 370.00,109.00 L 373.00,112.00 L 374.00,112.00 L 376.00,114.00 L 377.00,114.00 L 379.00,116.00 L 380.00,116.00 L 381.00,117.00 L 382.00,117.00 L 384.00,119.00 L 384.00,120.00 L 385.00,121.00 L 385.00,131.00 L 384.00,132.00 L 384.00,137.00 L 383.00,138.00 L 383.00,142.00 L 382.00,143.00 L 382.00,147.00 L 381.00,148.00 L 381.00,153.00 L 380.00,154.00 L 380.00,160.00 L 381.00,161.00 L 381.00,168.00 L 380.00,169.00 L 380.00,172.00 L 379.00,173.00 L 379.00,176.00 L 378.00,177.00 L 378.00,179.00 L 377.00,180.00 L 377.00,182.00 L 376.00,183.00 L 376.00,185.00 L 375.00,186.00 L 375.00,189.00 L 374.00,190.00 L 374.00,191.00 L 373.00,192.00 L 373.00,194.00 L 372.00,195.00 L 372.00,196.00 L 371.00,197.00 L 371.00,199.00 L 370.00,200.00 L 370.00,201.00 L 369.00,202.00 L 369.00,203.00 L 368.00,204.00 L 368.00,205.00 L 367.00,206.00 L 367.00,207.00 L 365.00,209.00 L 365.00,210.00 L 364.00,211.00 L 364.00,212.00 L 363.00,213.00 L 363.00,214.00 L 362.00,215.00 L 362.00,216.00 L 361.00,217.00 L 361.00,219.00 L 360.00,220.00 L 360.00,223.00 L 359.00,224.00 L 359.00,226.00 L 358.00,227.00 L 358.00,232.00 L 357.00,233.00 L 357.00,241.00 L 356.00,242.00 L 356.00,272.00 L 357.00,273.00 L 357.00,283.00 L 358.00,284.00 L 358.00,292.00 L 359.00,293.00 L 359.00,300.00 L 360.00,301.00 L 360.00,307.00 L 361.00,308.00 L 361.00,313.00 L 362.00,314.00 L 362.00,318.00 L 363.00,319.00 L 363.00,320.00 L 362.00,321.00 L 359.00,318.00 L 359.00,317.00 L 356.00,314.00 L 355.00,314.00 L 352.00,311.00 L 351.00,311.00 L 348.00,308.00 L 347.00,308.00 L 345.00,306.00 L 344.00,306.00 L 343.00,305.00 L 342.00,305.00 L 340.00,303.00 L 339.00,303.00 L 338.00,302.00 L 337.00,302.00 L 336.00,301.00 L 334.00,301.00 L 333.00,300.00 L 332.00,300.00 L 331.00,299.00 L 330.00,299.00 L 329.00,298.00 L 328.00,298.00 L 322.00,292.00 L 322.00,290.00 L 321.00,289.00 L 321.00,286.00 L 320.00,285.00 L 320.00,254.00 L 319.00,253.00 L 319.00,250.00 L 318.00,249.00 L 318.00,247.00 L 317.00,246.00 L 317.00,244.00 L 316.00,243.00 L 316.00,242.00 L 315.00,241.00 L 315.00,240.00 L 314.00,239.00 L 314.00,238.00 L 313.00,237.00 L 313.00,236.00 L 312.00,235.00 L 312.00,234.00 L 311.00,233.00 L 311.00,232.00 L 310.00,231.00 L 310.00,230.00 L 309.00,229.00 L 309.00,228.00 L 308.00,227.00 L 308.00,226.00 L 307.00,225.00 L 307.00,224.00 L 306.00,223.00 L 306.00,222.00 L 305.00,221.00 L 305.00,220.00 L 304.00,219.00 L 304.00,218.00 L 303.00,217.00 L 303.00,215.00 L 302.00,214.00 L 302.00,213.00 L 301.00,212.00 L 301.00,211.00 L 300.00,210.00 L 300.00,208.00 L 299.00,207.00 L 299.00,205.00 L 298.00,204.00 L 298.00,203.00 L 297.00,202.00 L 297.00,200.00 L 296.00,199.00 L 296.00,196.00 L 295.00,195.00 L 295.00,193.00 L 294.00,192.00 L 294.00,185.00 L 293.00,184.00 L 293.00,176.00 L 294.00,175.00 L 294.00,168.00 L 295.00,167.00 L 295.00,163.00 L 296.00,162.00 L 296.00,160.00 L 297.00,159.00 L 297.00,157.00 L 298.00,156.00 L 298.00,154.00 L 299.00,153.00 L 299.00,151.00 L 300.00,150.00 L 300.00,149.00 L 301.00,148.00 L 301.00,146.00 L 302.00,145.00 L 302.00,144.00 L 303.00,143.00 L 303.00,141.00 L 304.00,140.00 L 304.00,139.00 L 305.00,138.00 L 305.00,136.00 L 306.00,135.00 L 306.00,134.00 L 307.00,133.00 L 307.00,132.00 L 308.00,131.00 L 308.00,129.00 L 309.00,128.00 L 309.00,127.00 L 310.00,126.00 L 310.00,125.00 L 311.00,124.00 L 311.00,123.00 L 312.00,122.00 L 312.00,120.00 L 313.00,119.00 L 313.00,118.00 L 314.00,117.00 L 314.00,116.00 L 315.00,115.00 L 315.00,114.00 L 316.00,113.00 L 316.00,111.00 L 317.00,110.00 L 317.00,109.00 L 318.00,108.00 L 318.00,107.00 L 319.00,106.00 L 319.00,105.00 L 320.00,104.00 L 320.00,103.00 L 321.00,102.00 L 321.00,101.00 L 322.00,100.00 L 322.00,99.00 L 323.00,98.00 L 323.00,97.00 L 324.00,96.00 L 324.00,95.00 L 325.00,94.00 L 325.00,93.00 L 326.00,92.00 L 326.00,91.00 L 327.00,90.00 L 327.00,89.00 L 328.00,88.00 L 328.00,87.00 L 329.00,86.00 L 329.00,85.00 L 330.00,84.00 L 330.00,83.00 L 331.00,82.00 Z M 225.00,81.00 L 226.00,80.00 L 227.00,80.00 L 228.00,81.00 L 228.00,82.00 L 229.00,83.00 L 229.00,84.00 L 230.00,85.00 L 230.00,86.00 L 231.00,87.00 L 231.00,88.00 L 233.00,90.00 L 233.00,91.00 L 234.00,92.00 L 234.00,93.00 L 235.00,94.00 L 235.00,95.00 L 236.00,96.00 L 236.00,97.00 L 237.00,98.00 L 237.00,99.00 L 238.00,100.00 L 238.00,101.00 L 239.00,102.00 L 239.00,103.00 L 240.00,104.00 L 240.00,105.00 L 241.00,106.00 L 241.00,107.00 L 242.00,108.00 L 242.00,109.00 L 243.00,110.00 L 243.00,111.00 L 244.00,112.00 L 244.00,114.00 L 245.00,115.00 L 245.00,116.00 L 246.00,117.00 L 246.00,118.00 L 247.00,119.00 L 247.00,120.00 L 248.00,121.00 L 248.00,123.00 L 249.00,124.00 L 249.00,125.00 L 250.00,126.00 L 250.00,127.00 L 251.00,128.00 L 251.00,129.00 L 252.00,130.00 L 252.00,132.00 L 253.00,133.00 L 253.00,134.00 L 254.00,135.00 L 254.00,136.00 L 255.00,137.00 L 255.00,139.00 L 256.00,140.00 L 256.00,141.00 L 257.00,142.00 L 257.00,144.00 L 258.00,145.00 L 258.00,147.00 L 259.00,148.00 L 259.00,150.00 L 260.00,151.00 L 260.00,152.00 L 261.00,153.00 L 261.00,155.00 L 262.00,156.00 L 262.00,158.00 L 263.00,159.00 L 263.00,161.00 L 264.00,162.00 L 264.00,165.00 L 265.00,166.00 L 265.00,171.00 L 266.00,172.00 L 266.00,186.00 L 265.00,187.00 L 265.00,193.00 L 264.00,194.00 L 264.00,196.00 L 263.00,197.00 L 263.00,199.00 L 262.00,200.00 L 262.00,202.00 L 261.00,203.00 L 261.00,205.00 L 260.00,206.00 L 260.00,208.00 L 259.00,209.00 L 259.00,210.00 L 258.00,211.00 L 258.00,212.00 L 257.00,213.00 L 257.00,215.00 L 256.00,216.00 L 256.00,217.00 L 255.00,218.00 L 255.00,219.00 L 254.00,220.00 L 254.00,222.00 L 253.00,223.00 L 253.00,224.00 L 252.00,225.00 L 252.00,226.00 L 251.00,227.00 L 251.00,228.00 L 250.00,229.00 L 250.00,230.00 L 249.00,231.00 L 249.00,232.00 L 248.00,233.00 L 248.00,234.00 L 247.00,235.00 L 247.00,236.00 L 246.00,237.00 L 246.00,238.00 L 244.00,240.00 L 244.00,242.00 L 243.00,243.00 L 243.00,244.00 L 242.00,245.00 L 242.00,247.00 L 241.00,248.00 L 241.00,250.00 L 240.00,251.00 L 240.00,256.00 L 239.00,257.00 L 239.00,287.00 L 238.00,288.00 L 238.00,290.00 L 237.00,291.00 L 237.00,292.00 L 234.00,295.00 L 234.00,296.00 L 233.00,297.00 L 232.00,297.00 L 231.00,298.00 L 230.00,298.00 L 229.00,299.00 L 228.00,299.00 L 227.00,300.00 L 226.00,300.00 L 225.00,301.00 L 224.00,301.00 L 223.00,302.00 L 221.00,302.00 L 219.00,304.00 L 218.00,304.00 L 217.00,305.00 L 216.00,305.00 L 214.00,307.00 L 213.00,307.00 L 211.00,309.00 L 210.00,309.00 L 207.00,312.00 L 206.00,312.00 L 198.00,320.00 L 197.00,319.00 L 197.00,316.00 L 198.00,315.00 L 198.00,310.00 L 199.00,309.00 L 199.00,304.00 L 200.00,303.00 L 200.00,296.00 L 201.00,295.00 L 201.00,287.00 L 202.00,286.00 L 202.00,277.00 L 203.00,276.00 L 203.00,238.00 L 202.00,237.00 L 202.00,231.00 L 201.00,230.00 L 201.00,226.00 L 200.00,225.00 L 200.00,222.00 L 199.00,221.00 L 199.00,219.00 L 198.00,218.00 L 198.00,217.00 L 197.00,216.00 L 197.00,214.00 L 196.00,213.00 L 196.00,212.00 L 194.00,210.00 L 194.00,209.00 L 193.00,208.00 L 193.00,207.00 L 192.00,206.00 L 192.00,205.00 L 191.00,204.00 L 191.00,203.00 L 190.00,202.00 L 190.00,201.00 L 189.00,200.00 L 189.00,199.00 L 188.00,198.00 L 188.00,197.00 L 187.00,196.00 L 187.00,194.00 L 186.00,193.00 L 186.00,191.00 L 185.00,190.00 L 185.00,189.00 L 184.00,188.00 L 184.00,186.00 L 183.00,185.00 L 183.00,182.00 L 182.00,181.00 L 182.00,179.00 L 181.00,178.00 L 181.00,176.00 L 180.00,175.00 L 180.00,172.00 L 179.00,171.00 L 179.00,168.00 L 178.00,167.00 L 178.00,163.00 L 179.00,162.00 L 179.00,152.00 L 178.00,151.00 L 178.00,146.00 L 177.00,145.00 L 177.00,141.00 L 176.00,140.00 L 176.00,136.00 L 175.00,135.00 L 175.00,130.00 L 174.00,129.00 L 174.00,122.00 L 175.00,121.00 L 175.00,120.00 L 179.00,116.00 L 180.00,116.00 L 182.00,114.00 L 183.00,114.00 L 185.00,112.00 L 186.00,112.00 L 188.00,110.00 L 189.00,110.00 L 192.00,107.00 L 193.00,107.00 L 197.00,103.00 L 198.00,103.00 L 202.00,99.00 L 203.00,99.00 L 206.00,96.00 L 207.00,96.00 L 210.00,93.00 L 211.00,93.00 L 215.00,89.00 L 216.00,89.00 L 221.00,84.00 L 222.00,84.00 L 224.00,82.00 Z M 355.00,66.00 L 356.00,65.00 L 366.00,65.00 L 367.00,66.00 L 371.00,66.00 L 372.00,67.00 L 374.00,67.00 L 375.00,68.00 L 377.00,68.00 L 378.00,69.00 L 380.00,69.00 L 381.00,70.00 L 382.00,70.00 L 383.00,71.00 L 384.00,71.00 L 385.00,72.00 L 386.00,72.00 L 387.00,73.00 L 388.00,73.00 L 390.00,75.00 L 391.00,75.00 L 393.00,77.00 L 394.00,77.00 L 396.00,79.00 L 397.00,79.00 L 407.00,89.00 L 407.00,90.00 L 411.00,94.00 L 411.00,95.00 L 412.00,96.00 L 412.00,97.00 L 414.00,99.00 L 414.00,100.00 L 415.00,101.00 L 415.00,102.00 L 416.00,103.00 L 416.00,104.00 L 417.00,105.00 L 417.00,106.00 L 418.00,107.00 L 418.00,109.00 L 419.00,110.00 L 419.00,112.00 L 420.00,113.00 L 420.00,115.00 L 421.00,116.00 L 421.00,118.00 L 422.00,119.00 L 422.00,123.00 L 421.00,124.00 L 420.00,124.00 L 419.00,123.00 L 418.00,123.00 L 417.00,122.00 L 413.00,122.00 L 412.00,121.00 L 403.00,121.00 L 402.00,120.00 L 397.00,120.00 L 396.00,119.00 L 392.00,119.00 L 391.00,118.00 L 389.00,118.00 L 388.00,117.00 L 386.00,117.00 L 385.00,116.00 L 384.00,116.00 L 383.00,115.00 L 381.00,115.00 L 379.00,113.00 L 378.00,113.00 L 377.00,112.00 L 376.00,112.00 L 374.00,110.00 L 373.00,110.00 L 368.00,105.00 L 367.00,105.00 L 363.00,101.00 L 362.00,101.00 L 359.00,98.00 L 358.00,98.00 L 355.00,95.00 L 354.00,95.00 L 350.00,91.00 L 349.00,91.00 L 344.00,86.00 L 343.00,86.00 L 339.00,82.00 L 338.00,82.00 L 334.00,78.00 L 340.00,72.00 L 341.00,72.00 L 343.00,70.00 L 344.00,70.00 L 345.00,69.00 L 346.00,69.00 L 347.00,68.00 L 348.00,68.00 L 349.00,67.00 L 351.00,67.00 L 352.00,66.00 L 354.00,66.00 Z M 192.00,66.00 L 193.00,65.00 L 203.00,65.00 L 204.00,66.00 L 208.00,66.00 L 209.00,67.00 L 211.00,67.00 L 212.00,68.00 L 213.00,68.00 L 214.00,69.00 L 215.00,69.00 L 217.00,71.00 L 218.00,71.00 L 225.00,78.00 L 221.00,82.00 L 220.00,82.00 L 214.00,88.00 L 213.00,88.00 L 209.00,92.00 L 208.00,92.00 L 204.00,96.00 L 203.00,96.00 L 200.00,99.00 L 199.00,99.00 L 196.00,102.00 L 195.00,102.00 L 191.00,106.00 L 190.00,106.00 L 186.00,110.00 L 185.00,110.00 L 183.00,112.00 L 182.00,112.00 L 180.00,114.00 L 179.00,114.00 L 178.00,115.00 L 176.00,115.00 L 175.00,116.00 L 174.00,116.00 L 173.00,117.00 L 172.00,117.00 L 171.00,118.00 L 168.00,118.00 L 167.00,119.00 L 163.00,119.00 L 162.00,120.00 L 157.00,120.00 L 156.00,121.00 L 147.00,121.00 L 146.00,122.00 L 142.00,122.00 L 141.00,123.00 L 140.00,123.00 L 139.00,124.00 L 138.00,124.00 L 137.00,123.00 L 137.00,121.00 L 138.00,120.00 L 138.00,117.00 L 139.00,116.00 L 139.00,114.00 L 140.00,113.00 L 140.00,111.00 L 141.00,110.00 L 141.00,108.00 L 142.00,107.00 L 142.00,106.00 L 143.00,105.00 L 143.00,104.00 L 144.00,103.00 L 144.00,102.00 L 145.00,101.00 L 145.00,100.00 L 146.00,99.00 L 146.00,98.00 L 148.00,96.00 L 148.00,95.00 L 149.00,94.00 L 149.00,93.00 L 153.00,89.00 L 153.00,88.00 L 161.00,80.00 L 162.00,80.00 L 164.00,78.00 L 165.00,78.00 L 168.00,75.00 L 169.00,75.00 L 170.00,74.00 L 171.00,74.00 L 172.00,73.00 L 173.00,73.00 L 175.00,71.00 L 176.00,71.00 L 177.00,70.00 L 179.00,70.00 L 180.00,69.00 L 182.00,69.00 L 183.00,68.00 L 185.00,68.00 L 186.00,67.00 L 188.00,67.00 L 189.00,66.00 L 191.00,66.00 Z M 250.00,47.00 L 251.00,46.00 L 309.00,46.00 L 310.00,47.00 L 318.00,47.00 L 319.00,48.00 L 323.00,48.00 L 324.00,49.00 L 327.00,49.00 L 328.00,50.00 L 329.00,50.00 L 330.00,51.00 L 332.00,51.00 L 333.00,52.00 L 334.00,52.00 L 335.00,53.00 L 337.00,53.00 L 338.00,54.00 L 339.00,54.00 L 340.00,55.00 L 342.00,55.00 L 343.00,56.00 L 344.00,56.00 L 345.00,57.00 L 346.00,57.00 L 347.00,58.00 L 348.00,58.00 L 349.00,59.00 L 350.00,59.00 L 351.00,60.00 L 352.00,60.00 L 354.00,62.00 L 355.00,62.00 L 356.00,63.00 L 355.00,64.00 L 353.00,64.00 L 352.00,65.00 L 349.00,65.00 L 348.00,66.00 L 347.00,66.00 L 346.00,67.00 L 345.00,67.00 L 344.00,68.00 L 343.00,68.00 L 342.00,69.00 L 341.00,69.00 L 338.00,72.00 L 337.00,72.00 L 327.00,82.00 L 326.00,82.00 L 325.00,83.00 L 314.00,83.00 L 313.00,82.00 L 308.00,82.00 L 307.00,81.00 L 301.00,81.00 L 300.00,80.00 L 290.00,80.00 L 289.00,79.00 L 271.00,79.00 L 270.00,80.00 L 260.00,80.00 L 259.00,81.00 L 252.00,81.00 L 251.00,82.00 L 246.00,82.00 L 245.00,83.00 L 235.00,83.00 L 234.00,82.00 L 233.00,82.00 L 232.00,81.00 L 231.00,81.00 L 229.00,79.00 L 229.00,78.00 L 228.00,77.00 L 227.00,77.00 L 221.00,71.00 L 220.00,71.00 L 218.00,69.00 L 217.00,69.00 L 216.00,68.00 L 215.00,68.00 L 214.00,67.00 L 213.00,67.00 L 212.00,66.00 L 211.00,66.00 L 210.00,65.00 L 207.00,65.00 L 206.00,64.00 L 204.00,64.00 L 203.00,63.00 L 204.00,62.00 L 205.00,62.00 L 206.00,61.00 L 207.00,61.00 L 209.00,59.00 L 210.00,59.00 L 211.00,58.00 L 212.00,58.00 L 213.00,57.00 L 214.00,57.00 L 215.00,56.00 L 217.00,56.00 L 218.00,55.00 L 219.00,55.00 L 220.00,54.00 L 222.00,54.00 L 223.00,53.00 L 224.00,53.00 L 225.00,52.00 L 227.00,52.00 L 228.00,51.00 L 229.00,51.00 L 230.00,50.00 L 231.00,50.00 L 232.00,49.00 L 235.00,49.00 L 236.00,48.00 L 240.00,48.00 L 241.00,47.00 L 249.00,47.00 Z`;
const FRONT_HOTSPOTS_SVG = `<ellipse cx="352.5" cy="101.0" rx="30.5" ry="39.0" class="muscle" data-muscle="shoulders" data-muscle-name="Ombros"/>
    <ellipse cx="186.5" cy="100.5" rx="48.5" ry="38.5" class="muscle" data-muscle="shoulders" data-muscle-name="Ombros"/>
    <ellipse cx="339.5" cy="116.0" rx="58.5" ry="51.0" class="muscle" data-muscle="chest" data-muscle-name="Peito"/>
    <ellipse cx="226.0" cy="116.0" rx="59.0" ry="51.0" class="muscle" data-muscle="chest" data-muscle-name="Peito"/>
    <ellipse cx="282.5" cy="258.0" rx="47.5" ry="103.0" class="muscle" data-muscle="abs" data-muscle-name="Abdômen"/>
    <ellipse cx="416.0" cy="179.0" rx="50" ry="62" class="muscle" data-muscle="biceps" data-muscle-name="Bíceps"/>
    <ellipse cx="149.0" cy="178.5" rx="50" ry="62" class="muscle" data-muscle="biceps" data-muscle-name="Bíceps"/>
    <ellipse cx="470.5" cy="257.0" rx="50.5" ry="68.0" class="muscle" data-muscle="forearms" data-muscle-name="Antebraço"/>
    <ellipse cx="94.5" cy="256.5" rx="50.5" ry="68.5" class="muscle" data-muscle="forearms" data-muscle-name="Antebraço"/>
    <ellipse cx="334.0" cy="440.5" rx="52.0" ry="136.5" class="muscle" data-muscle="quads" data-muscle-name="Quadríceps"/>
    <ellipse cx="231.5" cy="440.5" rx="52.5" ry="136.5" class="muscle" data-muscle="quads" data-muscle-name="Quadríceps"/>`;
const BACK_HOTSPOTS_SVG = `<ellipse cx="378.0" cy="94.5" rx="47.0" ry="32.5" class="muscle" data-muscle="shoulders" data-muscle-name="Ombros"/>
    <ellipse cx="181.0" cy="94.5" rx="47.0" ry="32.5" class="muscle" data-muscle="shoulders" data-muscle-name="Ombros"/>
    <ellipse cx="279.5" cy="64.5" rx="79.5" ry="21.5" class="muscle" data-muscle="traps" data-muscle-name="Trapézio"/>
    <ellipse cx="339.0" cy="200.5" rx="49.0" ry="123.5" class="muscle" data-muscle="back" data-muscle-name="Costas"/>
    <ellipse cx="220.0" cy="200.0" rx="49.0" ry="123.0" class="muscle" data-muscle="back" data-muscle-name="Costas"/>
    <ellipse cx="421.5" cy="170.5" rx="55" ry="62" class="muscle" data-muscle="triceps" data-muscle-name="Tríceps"/>
    <ellipse cx="138.0" cy="170.5" rx="55" ry="62" class="muscle" data-muscle="triceps" data-muscle-name="Tríceps"/>
    <ellipse cx="475.5" cy="265.0" rx="52.5" ry="69.0" class="muscle" data-muscle="forearms" data-muscle-name="Antebraço"/>
    <ellipse cx="84.0" cy="265.5" rx="52.0" ry="68.5" class="muscle" data-muscle="forearms" data-muscle-name="Antebraço"/>
    <ellipse cx="319.0" cy="350.5" rx="41.0" ry="56.5" class="muscle" data-muscle="glutes" data-muscle-name="Glúteos"/>
    <ellipse cx="241.0" cy="350.5" rx="41.0" ry="56.5" class="muscle" data-muscle="glutes" data-muscle-name="Glúteos"/>
    <ellipse cx="332.5" cy="442.5" rx="53.5" ry="137.5" class="muscle" data-muscle="hamstrings" data-muscle-name="Posterior de coxa"/>
    <ellipse cx="226.5" cy="442.0" rx="53.5" ry="138.0" class="muscle" data-muscle="hamstrings" data-muscle-name="Posterior de coxa"/>
    <ellipse cx="360.5" cy="654.0" rx="45" ry="58" class="muscle" data-muscle="calves" data-muscle-name="Panturrilha"/>
    <ellipse cx="198.5" cy="654.0" rx="45" ry="58" class="muscle" data-muscle="calves" data-muscle-name="Panturrilha"/>`;

function bodyMapHtml(view){
  return `<div class="body-map-tabs">
    <button type="button" class="bmtab${view!=='back'?' active':''}" data-bmview="front">${t('front')}</button>
    <button type="button" class="bmtab${view==='back'?' active':''}" data-bmview="back">${t('back')}</button>
  </div>
  <div class="body-map">${muscleMapSvg(view==='back'?'back':'front')}</div>`;
}
function wireBodyMap(root, onPick){
  root.querySelectorAll('[data-muscle]').forEach(el=>{
    el.addEventListener('click', ()=> onPick(el.dataset.muscle));
  });
}
function syncBodyMapSelection(root, activeMuscle){
  root.querySelectorAll('[data-muscle]').forEach(el=>{
    el.classList.toggle('selected', el.dataset.muscle===activeMuscle);
  });
}

/* ---------- Estado do construtor ---------- */
const builder = { muscle:null, view:'front', search:'', selected:[] };
const builderOverlay = document.getElementById('builderOverlay');
const muscleMapWrap = document.getElementById('muscleMapWrap');

// initialMuscle: quando aberto a partir do mapa da tela inicial, já entra filtrado nesse músculo
// (na mesma vista frente/costas que estava aberta lá).
function openBuilder(initialMuscle, initialView){
  builder.muscle = initialMuscle || null;
  builder.view = initialView || 'front';
  builder.search=''; builder.selected=[];
  document.getElementById('builderSearch').value = '';
  document.getElementById('builderSessionName').value = '';
  document.getElementById('builderSessionDate').value = todayISO();
  renderBuilderProtocolSelect();
  renderMuscleMap();
  renderBuilderExerciseList();
  renderBuilderSelected();
  builderOverlay.hidden = false;
}
function closeBuilder(){ builderOverlay.hidden = true; }
document.getElementById('openBuilderBtn').addEventListener('click', ()=> openBuilder());
document.getElementById('builderCloseBtn').addEventListener('click', closeBuilder);
builderOverlay.addEventListener('click', e=>{ if(e.target===builderOverlay) closeBuilder(); });

function renderBuilderProtocolSelect(){
  const sel = document.getElementById('builderProtocolSelect');
  sel.innerHTML = `<option value="__new">➕ Novo protocolo</option>` +
    state.protocols.map(p=> `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  const latest = newestProtocolId();
  if(latest) sel.value = latest;
}

function renderMuscleMap(){
  muscleMapWrap.innerHTML = bodyMapHtml(builder.view);
  muscleMapWrap.querySelectorAll('[data-bmview]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ builder.view = btn.dataset.bmview; renderMuscleMap(); });
  });
  syncBodyMapSelection(muscleMapWrap, builder.muscle);
  wireBodyMap(muscleMapWrap, m=>{
    builder.muscle = (builder.muscle===m) ? null : m;
    syncBodyMapSelection(muscleMapWrap, builder.muscle);
    renderBuilderExerciseList();
  });
}
/* ---------- Mapa muscular da tela inicial ---------- */
let homeMapView = 'front';
let homeMapOpen = false; // aba "Mapa Muscular" retraída por padrão na tela inicial
function renderHomeMuscleMap(){
  const wrap = document.getElementById('homeMuscleMapWrap');
  if(!wrap) return;
  wrap.innerHTML = bodyMapHtml(homeMapView);
  wrap.querySelectorAll('[data-bmview]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ homeMapView = btn.dataset.bmview; renderHomeMuscleMap(); });
  });
  wireBodyMap(wrap, m=> openBuilder(m, homeMapView));
}
renderHomeMuscleMap();

document.getElementById('muscleClearBtn').addEventListener('click', ()=>{
  builder.muscle = null;
  syncBodyMapSelection(muscleMapWrap, null);
  renderBuilderExerciseList();
});
document.getElementById('builderSearch').addEventListener('input', e=>{
  builder.search = e.target.value.trim().toLowerCase();
  renderBuilderExerciseList();
});

function renderBuilderExerciseList(){
  document.getElementById('builderMuscleLabel').textContent = builder.muscle ? MUSCLE_LABELS[builder.muscle] : 'Todos os músculos';
  const list = document.getElementById('builderExerciseList');
  const filtered = EXERCISE_DB.filter(ex=>
    (!builder.muscle || ex.muscle===builder.muscle) &&
    (!builder.search || ex.name.toLowerCase().includes(builder.search))
  );
  if(filtered.length===0){
    list.innerHTML = `<div class="empty" style="padding:20px 10px;">Nenhum exercício encontrado.</div>`;
    return;
  }
  list.innerHTML = filtered.map((ex,i)=> `
    <div class="ex-pick-row" data-pickex="${escapeAttr(ex.name)}">
      <div><div class="epn">${escapeHtml(ex.name)}</div><div class="epm">${MUSCLE_LABELS[ex.muscle]} · alvo ${escapeHtml(ex.target)}</div></div>
      <span class="epadd">+</span>
    </div>`).join('');
  list.querySelectorAll('[data-pickex]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const ex = EXERCISE_DB.find(e=> e.name===row.dataset.pickex);
      if(!ex) return;
      builder.selected.push({ name: ex.name, muscle: ex.muscle, sets: 3, target: ex.target });
      renderBuilderSelected();
    });
  });
}

function renderBuilderSelected(){
  document.getElementById('builderCount').textContent = builder.selected.length;
  const list = document.getElementById('builderSelectedList');
  if(builder.selected.length===0){
    list.innerHTML = `<div class="empty" style="padding:16px 6px;font-size:12px;">Toque num músculo ou busque um exercício para adicionar.</div>`;
    return;
  }
  list.innerHTML = builder.selected.map((s,i)=> `
    <div class="sel-ex-row">
      <div class="sen"><span>${escapeHtml(s.name)}</span><button class="ghost small" data-rmsel="${i}" style="padding:0 4px;">✕</button></div>
      <div class="sefields">
        <input type="number" min="1" max="10" value="${s.sets}" data-selfield="${i}:sets" title="séries" style="width:60px;">
        <input type="text" value="${escapeAttr(s.target)}" data-selfield="${i}:target" title="alvo (reps)" placeholder="alvo" style="flex:1;">
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-rmsel]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ builder.selected.splice(+btn.dataset.rmsel,1); renderBuilderSelected(); });
  });
  list.querySelectorAll('[data-selfield]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const [idx,field] = e.target.dataset.selfield.split(':');
      builder.selected[+idx][field] = field==='sets' ? (parseInt(e.target.value,10)||1) : e.target.value;
    });
  });
}

document.getElementById('builderSaveBtn').addEventListener('click', ()=>{
  if(builder.selected.length===0){ alert('Adicione ao menos um exercício.'); return; }
  const name = document.getElementById('builderSessionName').value.trim() || 'Treino montado';
  const date = document.getElementById('builderSessionDate').value || todayISO();
  const protoSel = document.getElementById('builderProtocolSelect').value;
  let protocolId;
  if(protoSel==='__new'){
    const prot = { id: uid(), name: suggestProtocolName(date), createdAt: todayISO() };
    state.protocols.push(prot);
    protocolId = prot.id;
  }else{
    protocolId = protoSel;
  }
  const exercises = builder.selected.map(s=>{
    const reps = parseRepsTarget(s.target);
    const target = cleanTarget(s.target);
    const sets = [];
    for(let i=0;i<Math.max(1,s.sets);i++) sets.push({ reps, weight:0, target });
    return { id: uid(), name: s.name, sets };
  });
  const session = { id: uid(), protocolId, date, name, exercises };
  state.sessions.push(session);
  openProtocols.clear(); openProtocols.add(protocolId);
  openMonths.add(getMonthKey(date)); openWeeks.add(getWeekKey(date));
  openSessionId = session.id;
  save();
  closeBuilder();
  renderAll();
  const list = document.getElementById('sessionsList');
  if(list) list.scrollIntoView({behavior:'smooth', block:'start'});
});

/* ---------- Mobile app shell (telas estilo app: abas embaixo, teclado numérico) ---------- */
const mobile = {
  tab: 'inicio',     // inicio | treinos | progresso | perfil
  screen: 'list',   // treinos: list|history|week|session|entry|import ; progresso: list|detail
  progView: 'resumo', // aba interna do Progresso: resumo | forca | energia
  protKey: null,     // protocolo aberto
  weekKey: null,     // semana aberta dentro do protocolo
  sessionId: null,
  exId: null,
  setIdx: null,      // série sendo preenchida (null = adicionando uma nova)
  progKey: null,
  padWeight: '',
  padReps: '',
  padActive: 'weight',
  timerActive: false,
  timerEnd: 0
};

/* ---------- Timer de descanso (celular) ---------- */
let restTimerInterval = null;
function startRestTimer(seconds){
  mobile.timerEnd = Date.now() + seconds*1000;
  mobile.timerActive = true;
  clearInterval(restTimerInterval);
  restTimerInterval = setInterval(updateRestTimer, 250);
}
function stopRestTimer(){
  mobile.timerActive = false;
  clearInterval(restTimerInterval);
  const bar = document.getElementById('mRestTimer');
  if(bar) bar.remove();
}
function fmtSecs(s){ const m=Math.floor(s/60), r=s%60; return m+':'+String(r).padStart(2,'0'); }
function updateRestTimer(){
  const bar = document.getElementById('mRestTimer');
  if(!bar || !mobile.timerActive){ clearInterval(restTimerInterval); return; }
  const remaining = Math.max(0, Math.ceil((mobile.timerEnd - Date.now())/1000));
  const timeEl = bar.querySelector('.rt-time');
  if(timeEl) timeEl.textContent = fmtSecs(remaining);
  if(remaining<=0){
    stopRestTimer();
    if(navigator.vibrate) navigator.vibrate(250);
  }
}
function renderRestTimerBar(){
  if(!mobile.timerActive) return '';
  const remaining = Math.max(0, Math.ceil((mobile.timerEnd - Date.now())/1000));
  return `<div id="mRestTimer" class="rest-timer">
    ${ICONS.clock}
    <span class="rt-label">Descanso</span>
    <span class="rt-time">${fmtSecs(remaining)}</span>
    <button class="rt-btn" data-rt="+15" aria-label="Mais 15 segundos">+15s</button>
    <button class="rt-btn rt-skip" data-rt="skip">Pular</button>
  </div>`;
}

const mShell = document.getElementById('mShell');
const mContent = document.getElementById('mContent');
const mTitle = document.getElementById('mTitle');
const mBack = document.getElementById('mBack');
const mProfessorBar = document.getElementById('mProfessorBar');
const mSub = document.getElementById('mSub');
const mAvatar = document.getElementById('mAvatar');
// Cabeçalho do celular: título grande, linha menor opcional acima dele,
// botão de voltar nas telas internas e o avatar (atalho pro Perfil) no Início.
function mHeader(title, opts){
  const o = opts || {};
  mTitle.textContent = title;
  mBack.hidden = !o.back;
  mSub.hidden = !o.sub;
  mSub.textContent = o.sub || '';
  mAvatar.hidden = !o.avatar;
  if(o.avatar) mAvatar.textContent = userInitial();
}
function userInitial(){
  const n = (auth && auth.role==='student' && auth.name) ? auth.name.trim() : '';
  return (n.charAt(0) || '·').toUpperCase();
}
mAvatar.addEventListener('click', ()=>{ mobile.tab = 'perfil'; mobile.screen = 'list'; mRender(); });
// Ícones de traço usados nas telas do celular (mesmos da proposta de design).
const ICONS = {
  chevron: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/></svg>',
  trophy: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/></svg>',
  file: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6"/></svg>',
  target: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  download: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  flame: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 2 3 4"/></svg>',
  globe: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18c-3-3-3-15 0-18"/></svg>',
  help: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01"/></svg>',
  logout: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  back: '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'
};
if(new URLSearchParams(location.search).get('tab')==='progresso') mobile.tab = 'progresso';

/* ---------- Tour guiado (primeiro acesso do aluno) ---------- */
// TOUR_VERSION sobe sempre que o tour ganha passos novos sobre funcionalidades
// recém-lançadas — isso faz o tour reaparecer uma vez até pra quem já tinha
// visto uma versão anterior, sem precisar de um fluxo de "novidades" à parte.
const TOUR_VERSION = 4;
const TOUR_STEPS = [
  { target: null, title: 'Bem-vindo ao Sobrecarga 👋', text: 'O app foi reorganizado em quatro abas. Vamos dar uma volta rápida — leva menos de um minuto.' },
  { target: '.mweek', title: 'Sua semana', text: 'Os dias em que você treinou ficam preenchidos; hoje aparece com contorno.' },
  { target: '.mtoday', title: 'Treino de hoje', text: 'O próximo treino da sua ficha, com os primeiros exercícios e um botão pra começar direto.' },
  { target: '.mstat-grid', title: 'Suas estatísticas', text: 'Semanas seguidas treinando, treinos no mês e recordes novos dos últimos 30 dias.' },
  { target: '[data-mtab="treinos"]', title: 'Aba Treinos', text: 'Importe a ficha em PDF, monte um treino pelo mapa muscular e veja cada semana do protocolo.' },
  { target: null, title: 'Botões − e + ✨', text: 'Ao registrar uma série, ajuste peso e repetições com um toque. O app já sugere a carga da última vez.' },
  { target: '[data-mtab="progresso"]', title: 'Aba Progresso', text: 'Volume por semana, evolução do 1RM estimado em cada exercício e, se liberado, o gasto de energia.' },
  { target: '[data-mtab="perfil"]', title: 'Aba Perfil', text: 'Relatório em PDF, idioma, o tour de novo e o botão de sair ficam aqui.' },
];
let tourIndex = -1;
let tourOverlayEl = null, tourSpotlightEl = null, tourTooltipEl = null;
let tourTimer = null;
function tourStorageKey(){ return 'sobrecarga_tour_seen_v' + TOUR_VERSION + '_' + (activeStudentId() || 'x'); }
function startTour(){
  if(mShell.hidden) return; // tour cobre só a versão mobile por enquanto
  endTour(false);
  mobile.tab = 'inicio'; mobile.screen = 'list'; mRender();
  tourIndex = 0;
  buildTourDOM();
  renderTourStep();
}
function endTour(markSeen){
  clearTimeout(tourTimer);
  if(markSeen!==false){ try{ localStorage.setItem(tourStorageKey(), '1'); }catch(e){} }
  if(tourOverlayEl){ tourOverlayEl.remove(); tourSpotlightEl.remove(); tourTooltipEl.remove(); }
  tourOverlayEl = tourSpotlightEl = tourTooltipEl = null;
  tourIndex = -1;
}
function buildTourDOM(){
  tourOverlayEl = document.createElement('div');
  tourOverlayEl.className = 'tour-overlay';
  tourSpotlightEl = document.createElement('div');
  tourSpotlightEl.className = 'tour-spotlight none';
  tourTooltipEl = document.createElement('div');
  tourTooltipEl.className = 'tour-tooltip';
  document.body.appendChild(tourOverlayEl);
  document.body.appendChild(tourSpotlightEl);
  document.body.appendChild(tourTooltipEl);
  tourOverlayEl.addEventListener('click', ()=> endTour());
}
function renderTourStep(){
  const step = TOUR_STEPS[tourIndex];
  const last = tourIndex === TOUR_STEPS.length - 1;
  const targetEl = step.target ? mShell.querySelector(step.target) : null;
  if(targetEl){
    targetEl.scrollIntoView({block:'center', behavior:'auto'});
  }
  clearTimeout(tourTimer);
  tourTimer = setTimeout(()=>{
    if(!tourSpotlightEl || !tourTooltipEl) return; // tour foi fechado antes deste timer disparar
    if(targetEl){
      const r = targetEl.getBoundingClientRect();
      const pad = 6;
      tourSpotlightEl.classList.remove('none');
      tourSpotlightEl.style.top = (r.top-pad)+'px';
      tourSpotlightEl.style.left = (r.left-pad)+'px';
      tourSpotlightEl.style.width = (r.width+pad*2)+'px';
      tourSpotlightEl.style.height = (r.height+pad*2)+'px';
      const spaceBelow = window.innerHeight - r.bottom;
      if(spaceBelow > 200 || r.top < 160){
        tourTooltipEl.style.top = Math.min(r.bottom+16, window.innerHeight-220)+'px';
        tourTooltipEl.style.bottom = '';
      }else{
        tourTooltipEl.style.bottom = (window.innerHeight-r.top+16)+'px';
        tourTooltipEl.style.top = '';
      }
    }else{
      tourSpotlightEl.classList.add('none');
      tourSpotlightEl.style.top = '50%'; tourSpotlightEl.style.left = '50%';
      tourSpotlightEl.style.width = '0px'; tourSpotlightEl.style.height = '0px';
      tourTooltipEl.style.top = '40%'; tourTooltipEl.style.bottom = '';
    }
    tourTooltipEl.innerHTML = `
      <div class="tt-step">${tourIndex+1} de ${TOUR_STEPS.length}</div>
      <div class="tt-title">${escapeHtml(step.title)}</div>
      <div class="tt-text">${escapeHtml(step.text)}</div>
      <div class="tt-actions">
        <button class="tt-skip" id="tourSkipBtn">Pular</button>
        <button class="tt-next" id="tourNextBtn">${last ? 'Concluir' : 'Próximo'}</button>
      </div>`;
    document.getElementById('tourSkipBtn').addEventListener('click', ()=> endTour());
    document.getElementById('tourNextBtn').addEventListener('click', ()=>{
      if(tourIndex >= TOUR_STEPS.length-1){ endTour(); return; }
      tourIndex++;
      renderTourStep();
    });
  }, 60);
}
async function confirmLogout(){
  if(await confirmDialog('Sair da sua conta? Você pode entrar de novo como aluno ou como professor.', {okLabel:'Sair', danger:false})){
    logout();
  }
}

document.querySelectorAll('.mtab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    stopRestTimer();
    const tab = btn.dataset.mtab;
    mobile.tab = tab;
    mobile.screen = 'list';
    mRender();
  });
});
mBack.addEventListener('click', ()=>{
  if(mobile.tab==='treinos'){
    if(mobile.screen==='entry'){ mobile.screen='session'; stopRestTimer(); }
    else if(mobile.screen==='session'){
      mobile.sessionId=null;
      mobile.screen = mobile.weekKey ? 'week' : 'list';
    }
    else if(mobile.screen==='week'){ mobile.screen='history'; mobile.weekKey=null; mobile.protKey=null; }
    else{ mobile.screen='list'; mobile.sessionId=null; }
  }else if(mobile.tab==='progresso'){
    mobile.screen='list'; mobile.progKey=null;
  }
  mRender();
});

function mSetActiveTabUI(){
  document.querySelectorAll('.mtab').forEach(b=> b.classList.toggle('active', b.dataset.mtab===mobile.tab));
}

function mRender(){
  mSetActiveTabUI();
  mContent.scrollTop = 0;
  if(mobile.tab==='inicio') mRenderInicio();
  else if(mobile.tab==='progresso') mRenderProgresso();
  else if(mobile.tab==='perfil') mRenderPerfil();
  else mRenderTreinos();
}

/* --- Treinos --- */
function mRenderTreinos(){
  if(mobile.screen==='session') return mRenderSessionScreen();
  if(mobile.screen==='entry') return mRenderEntryScreen();
  if(mobile.screen==='import') return mRenderImportScreen();
  if(mobile.screen==='week') return mRenderWeekScreen();
  if(mobile.screen==='history') return mRenderHistoryScreen();
  mRenderSessionsList();
}

// Sessões de uma semana (dentro do protocolo, quando ele estiver definido).
function mWeekSessions(){
  return state.sessions
    .filter(s=> getWeekKey(s.date)===mobile.weekKey && (!mobile.protKey || s.protocolId===mobile.protKey))
    .sort((a,b)=> a.date.localeCompare(b.date));
}

// Sessões da semana atual (calendário real, não a semana do protocolo) —
// é isso que a home mostra de forma achatada; o resto vive em "Histórico".
function mThisWeekSessions(){
  const wk = getWeekKey(todayISO());
  return state.sessions.filter(s=> getWeekKey(s.date)===wk).sort((a,b)=> a.date.localeCompare(b.date));
}


function mRenderHistoryScreen(){
  mHeader('Treinos');
  let html = '<div class="mpage mpage-flush">' + mSegmented([['list','Esta semana'],['history','Histórico']], 'history', 'treinosview') + '</div>';
  if(!READONLY){
    html += `<div style="padding:0 20px 4px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="mghostbtn" data-maction="addsession">${t('newSession')}</button>
    </div>`;
  }
  if(state.sessions.length===0){
    html += `<div class="mempty"><strong>${t('noSessionsYet')}</strong>${t('importHint')}</div>`;
  }else{
    // Bloco por protocolo; dentro dele, uma linha por semana. A divisão de
    // treino (segunda, terça…) aparece ao abrir a semana.
    groupByProtocol(state.sessions).forEach(block=>{
      if(block.sessions.length===0) return;
      const nWeeks = protocolWeekKeys(block.key).length;
      html += `<div class="mprotocol-head">
        <span>${escapeHtml(block.name)}</span>
        <span class="mmono">${nWeeks} ${nWeeks===1?'semana':'semanas'}</span>
      </div>`;
      const ordem = protocolWeekKeys(block.key);
      block.months.forEach(month=>{
        if(block.months.length>1) html += `<div class="mgrouplabel">${month.label}</div>`;
        month.weeks.forEach(week=>{
          const end = addDaysISO(week.key, 6);
          const n = ordem.indexOf(week.key)+1;
          const feitas = week.sessions.filter(s=> s.exercises.some(e=> e.sets.some(x=> x.weight>0))).length;
          html += `<div class="mrow" data-mopen-week="${week.key}" data-mprot="${block.key}">
            <div class="mrow-main">
              <div class="mrow-title">Semana ${n} · ${fmtDayMonth(week.key)} – ${fmtDayMonth(end)}</div>
              <div class="mrow-sub">${week.sessions.length} ${week.sessions.length===1?'treino':'treinos'}${feitas?` · ${feitas} iniciados`:''}</div>
            </div>
            <span class="mchev">›</span>
          </div>`;
        });
      });
      if(!READONLY){
        html += `<div style="padding:2px 16px 8px;">
          <button class="mghostbtn" data-maction="addweek" data-prot="${block.key}" style="width:100%;">+ semana</button>
        </div>`;
      }
    });
  }
  mContent.innerHTML = html;
}

function mRenderWeekScreen(){
  const sessions = mWeekSessions();
  if(sessions.length===0){ mobile.screen='history'; return mRenderHistoryScreen(); }
  const end = addDaysISO(mobile.weekKey, 6);
  const n = mobile.protKey ? protocolWeekKeys(mobile.protKey).indexOf(mobile.weekKey)+1 : 0;
  mHeader(n>0 ? `Semana ${n}` : `${fmtDayMonth(mobile.weekKey)} – ${fmtDayMonth(end)}`, {back: true});
  const prot = state.protocols.find(p=> p.id===mobile.protKey);
  let html = `<div class="mgrouplabel" style="margin-top:14px;">${prot?escapeHtml(prot.name)+' · ':''}${fmtDayMonth(mobile.weekKey)} – ${fmtDayMonth(end)}</div>`;
  html += `<div class="msection-title" style="margin-top:6px;">Divisão de treino</div>`;
  sessions.forEach(sess=>{
    const setCount = sess.exercises.reduce((n,e)=> n+e.sets.length,0);
    const feitas = sess.exercises.flatMap(e=> e.sets).filter(s=> s.weight>0).length;
    html += `<div class="mrow" data-mopen-session="${sess.id}">
      <div class="mrow-main">
        <div class="mrow-title">${escapeHtml(sess.name)} ${sess.feedback?'<span class="feedback-flag">💬</span>':''}</div>
        <div class="mrow-sub">${fmtDate(sess.date)} · ${sess.exercises.length} exerc. · ${feitas}/${setCount} séries feitas</div>
      </div>
      <span class="mchev">›</span>
    </div>`;
  });
  mContent.innerHTML = html;
}

function mFeedbackBlockHtml(session){
  const fb = session.feedback || '';
  if(READONLY){
    return `<div class="feedback-block feedback-editing">
      <label class="hint">💬 Feedback para o aluno</label>
      <textarea data-mfeedback rows="2" placeholder="Deixe um comentário sobre esta sessão...">${escapeHtml(fb)}</textarea>
    </div>`;
  }
  if(!fb) return '';
  return `<div class="feedback-block">
    <div class="hint">💬 Feedback do professor</div>
    <div class="feedback-text">${escapeHtml(fb)}</div>
  </div>`;
}

function mRenderSessionScreen(){
  const session = state.sessions.find(s=> s.id===mobile.sessionId);
  if(!session){ mobile.screen='list'; return mRenderSessionsList(); }
  mHeader('Sessão', {back: true, sub: fmtDate(session.date)});
  const ro = READONLY;
  let html = `<div style="padding:4px 20px 6px;">
    <input type="text" class="minput" data-msessname value="${escapeAttr(session.name)}" ${ro?'disabled':''}>
    ${ro?'':`<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="mghostbtn" data-maction="repeatsession">⟳ repetir (+7 dias)</button>
      <button class="mghostbtn mdanger" data-mdel-session="${session.id}">✕ excluir sessão</button>
    </div>`}
  </div>
  <div style="padding:0 20px;">${mFeedbackBlockHtml(session)}</div>
  <div class="msection-title">Exercícios</div>`;
  session.exercises.forEach(ex=>{
    const setCount = ex.sets.length;
    const done = ex.sets.filter(s=> s.weight>0).length;
    const targetLabel = exerciseTarget(ex);
    const record = recordFor(ex.name);
    const parts = [`${setCount} séries`];
    if(targetLabel) parts.push(`alvo ${targetLabel}`);
    if(done) parts.push(`${done}/${setCount} feitas`);
    const meta = parts.join(' · ');
    html += `<div class="mrow">
      <div class="mrow-main" data-mopen-ex="${ex.id}">
        <div class="mrow-title">${escapeHtml(ex.name)} ${record?`<span class="pr-badge">🏆 ${record.weight}kg</span>`:''}</div>
        <div class="mrow-sub mmono">${meta}</div>
      </div>
      ${videoFor(ex.name) ? `<button type="button" class="video-dot" data-video="${escapeAttr(videoFor(ex.name).youtubeId)}" data-video-title="${escapeAttr(ex.name)}" aria-label="Ver execução de ${escapeAttr(ex.name)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button>` : ''}
      ${ro?'':`<button class="micon-btn" data-mdel-ex="${ex.id}">✕</button>`}
    </div>`;
  });
  if(!ro) html += `<div style="padding:4px 20px 20px;"><button class="mghostbtn" data-maction="addexercise">+ exercício</button></div>`;
  mContent.innerHTML = html;
}

// Última sessão anterior (que não seja a atual) em que o exercício foi
// feito com carga — é a referência mostrada ao abrir o exercício de novo.
function findPrevSessionExercise(exName, currentSessionId){
  const cur = state.sessions.find(s=> s.id===currentSessionId);
  const key = exName.trim().toLowerCase();
  const candidates = state.sessions.filter(s=>
    s.id!==currentSessionId &&
    (!cur || s.date<=cur.date) &&
    s.exercises.some(e=> e.name.trim().toLowerCase()===key && e.sets.some(x=> x.weight>0))
  );
  if(candidates.length===0) return null;
  candidates.sort((a,b)=> b.date.localeCompare(a.date));
  return candidates[0].exercises.find(e=> e.name.trim().toLowerCase()===key);
}
// Carga anotada da última vez, casando pelo índice da série quando possível.
function lastLoadFor(exName, currentSessionId, idx){
  const prevEx = findPrevSessionExercise(exName, currentSessionId);
  if(!prevEx) return null;
  const done = prevEx.sets.filter(x=> x.weight>0);
  if(done.length===0) return null;
  return done[idx] || done[done.length-1];
}


// Seleciona uma série para preencher. Se ainda não tem carga anotada,
// sugere a carga da última vez que o exercício foi feito.
function mSelectSet(idx){
  const session = state.sessions.find(s=> s.id===mobile.sessionId);
  const ex = session && session.exercises.find(x=> x.id===mobile.exId);
  const s = ex && ex.sets[idx];
  mobile.setIdx = idx;
  if(s && s.weight>0){
    mobile.padWeight = String(s.weight);
    mobile.padReps = String(s.reps);
  }else{
    const prev = ex && session ? lastLoadFor(ex.name, session.id, idx) : null;
    mobile.padWeight = prev ? String(prev.weight) : '';
    mobile.padReps = prev ? String(prev.reps) : '';
  }
  mobile.padActive = 'weight';
}
// Primeira série ainda sem carga — é por onde se começa numa ficha prescrita.
function mFirstPendingSet(ex, from){
  for(let i=(from||0);i<ex.sets.length;i++){ if(!(ex.sets[i].weight>0)) return i; }
  return null;
}

function mRenderImportScreen(){
  mHeader('Importar', {back: true});
  if(!stageGroups.length){
    mContent.innerHTML = `<div style="padding:24px 16px;text-align:center;">
      <div style="border:2px dashed var(--border);border-radius:var(--radius-lg);padding:34px 18px;margin-bottom:18px;">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:14px;">Escolha um PDF do treino</div>
        <button class="mghostbtn" data-maction="pickfile">📄 Escolher arquivo</button>
      </div>
      <div class="mrow-sub">Detecta cada treino como uma sessão separada.</div>
    </div>`;
    return;
  }
  let html = `<div style="padding:16px 16px 20px;">
    <div class="mrow-sub" style="margin-bottom:6px;">Protocolo</div>
    <select class="minput" data-mstageprot style="margin-bottom:8px;">
      <option value="__new" ${stageProtocol.mode==='new'?'selected':''}>➕ Novo protocolo</option>
      ${state.protocols.map(p=> `<option value="${escapeAttr(p.id)}" ${stageProtocol.id===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
    </select>
    ${stageProtocol.mode==='new' ? `<input type="text" class="minput" data-mstageprotname value="${escapeAttr(stageProtocol.name)}" placeholder="nome do protocolo" style="margin-bottom:8px;">` : ''}
    <div class="mrow-sub" style="margin-bottom:6px;">Duração (semanas)</div>
    <input type="number" min="1" max="52" class="minput mmono" data-mstageweeks value="${stageProtocol.weeks}" style="margin-bottom:12px;">
    <div class="mrow-sub" style="margin-bottom:12px;">Revise a divisão de treino — ela vai se repetir em todas as semanas:</div>`;
  stageGroups.forEach((group,gi)=>{
    html += `<div class="mcard">
      <input type="text" class="minput" data-mstagename="${group.id}" value="${escapeAttr(group.name)}" style="margin-bottom:8px;">
      <input type="date" class="minput" data-mstagedate="${group.id}" value="${group.date}" style="margin-bottom:8px;">`;
    group.rows.forEach((r,ri)=>{
      html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <input type="text" class="minput" data-mstagerow="${gi}:${ri}:name" value="${escapeAttr(r.name)}" placeholder="exercício" style="flex:1;">
        <input type="number" class="minput mmono" data-mstagerow="${gi}:${ri}:sets" value="${r.sets}" style="width:48px;text-align:center;">
        <input type="number" class="minput mmono" data-mstagerow="${gi}:${ri}:reps" value="${r.reps}" style="width:48px;text-align:center;">
        <button class="micon-btn" data-mstagedelrow="${gi}:${ri}">✕</button>
      </div>`;
    });
    html += `<button class="mghostbtn small" data-mstageaddrow="${gi}">+ linha</button></div>`;
  });
  html += `<div style="display:flex;gap:10px;margin-top:14px;">
    <button class="mghostbtn" style="flex:1;" data-maction="cancelimport">Cancelar</button>
    <button class="mprimarybtn" style="flex:1;" data-maction="confirmimport">Adicionar sessões</button>
  </div></div>`;
  mContent.innerHTML = html;
}

/* --- Progresso --- */

function mBigSparkPath(points){
  const w=280,h=110,pad=8;
  const vals = points.map(p=>p.rm);
  const min=Math.min(...vals), max=Math.max(...vals), span=(max-min)||1;
  const step=(w-pad*2)/Math.max(1,points.length-1);
  const pts = vals.map((v,i)=>[pad+i*step, h-pad-((v-min)/span)*(h-pad*2)]);
  return pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
}

function mRenderProgressDetail(){
  const data = computeProgress();
  const e = data.find(x=> x.label.toLowerCase()===mobile.progKey);
  if(!e){ mobile.screen='list'; return mRenderProgresso(); }
  mHeader(e.label, {back: true});
  const { deltaHtml } = trendDelta(e.points);
  const cur = e.points[e.points.length-1];
  const path = mBigSparkPath(e.points);
  let html = `<div style="padding:16px 16px 24px;">
    <div class="mbig-num">${cur.rm.toFixed(1)}kg</div>
    <div style="font-size:13px;font-weight:600;margin:4px 0 16px;">${deltaHtml} desde a sessão anterior</div>
    <svg width="100%" height="120" viewBox="0 0 280 110" style="background:var(--surface);border-radius:var(--radius-md);border:1px solid var(--border);">
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="msection-title" style="margin:18px 0 10px;">Histórico</div>`;
  e.points.slice().reverse().forEach(p=>{
    html += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--surface-2);">
      <span class="mrow-sub">${fmtDate(p.date)}</span>
      <span class="mmono" style="font-size:12.5px;">${p.weight}kg × ${p.reps}</span>
      <span class="mmono" style="font-size:12.5px;color:var(--accent-text);">${p.rm.toFixed(1)}kg</span>
    </div>`;
  });
  html += '</div>';
  mContent.innerHTML = html;
}

/* --- Peças comuns das telas do celular --- */
// Situação de uma sessão pela quantidade de séries com carga anotada.
function sessionStatus(s){
  const sets = s.exercises.flatMap(e=> e.sets);
  const done = sets.filter(x=> x.weight>0).length;
  if(sets.length && done>=sets.length) return 'done';
  return done>0 ? 'going' : 'todo';
}
function statusBadge(st){
  if(st==='done') return '<span class="badge badge-ok">Feito</span>';
  if(st==='going') return '<span class="badge badge-warn">Em andamento</span>';
  return '<span class="badge">A fazer</span>';
}
function mSegmented(items, active, action){
  return `<div class="seg" role="tablist">${items.map(([key,label])=>
    `<button type="button" role="tab" aria-selected="${key===active}" class="${key===active?'active':''}" data-maction="${action}" data-val="${key}">${label}</button>`
  ).join('')}</div>`;
}
const DOW_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function dowOf(iso){ return new Date(iso+'T00:00:00').getDay(); }
function plural(n, one, many){ return `${n} ${n===1?one:many}`; }
// Recordes (1RM estimado acima de todas as sessões anteriores) dos últimos 30 dias.
function recentRecords(){
  const out = [];
  computeProgress().forEach(e=>{
    if(e.points.length<2) return;
    const last = e.points[e.points.length-1];
    const prevBest = Math.max(...e.points.slice(0,-1).map(p=> p.rm));
    if(last.rm > prevBest && daysSince(last.date) <= 30){
      out.push({ label: e.label, weight: last.weight, reps: last.reps, date: last.date, pct: ((last.rm-prevBest)/prevBest)*100 });
    }
  });
  return out.sort((a,b)=> b.date.localeCompare(a.date));
}
function fmtPct(v){ return (v>0?'▲ ':v<0?'▼ ':'▬ ') + Math.abs(v).toFixed(1).replace('.',',') + '%'; }
function weekVolume(weekKey){
  let v = 0;
  state.sessions.forEach(s=>{
    if(getWeekKey(s.date)!==weekKey) return;
    s.exercises.forEach(e=> e.sets.forEach(x=>{ if(x.weight>0 && x.reps>0) v += x.weight*x.reps; }));
  });
  return v;
}

/* --- Início --- */
function mRenderInicio(){
  const first = (auth && auth.role==='student' && auth.name) ? auth.name.trim().split(/\s+/)[0] : '';
  const dateLabel = new Date().toLocaleDateString(lang==='en'?'en-US':'pt-BR', {weekday:'long', day:'numeric', month:'long'});
  mHeader(READONLY ? 'Resumo do aluno' : (first ? `Olá, ${first}` : 'Sobrecarga'), { sub: dateLabel.charAt(0).toUpperCase()+dateLabel.slice(1), avatar: !READONLY });
  const today = todayISO();
  const monday = getWeekKey(today);
  const trained = new Set(state.sessions.filter(s=> s.exercises.some(e=> e.sets.some(x=> x.weight>0))).map(s=> s.date));
  let html = '<div class="mpage">';
  html += '<div class="mweek">';
  for(let i=0;i<7;i++){
    const d = addDaysISO(monday, i);
    const cls = trained.has(d) ? 'done' : (d===today ? 'today' : '');
    html += `<div class="mweek-day"><span class="mweek-l">${DOW_SHORT[dowOf(d)].charAt(0)}</span><span class="mweek-n ${cls}">${+d.slice(8,10)}</span></div>`;
  }
  html += '</div>';

  const next = findNextSession();
  if(next){
    const nSets = next.exercises.reduce((a,e)=> a+e.sets.length, 0);
    html += `<section class="mtoday">
      <div class="mtoday-top"><span class="overline accent">${next.date<=today ? 'Treino de hoje' : 'Próximo treino'}</span><span class="mmeta">${plural(next.exercises.length,'exercício','exercícios')} · ${plural(nSets,'série','séries')}</span></div>
      <div class="mtoday-name">${escapeHtml(next.name)}</div>
      <div class="mtoday-list">
        ${next.exercises.slice(0,3).map(ex=> `<div><span>${escapeHtml(ex.name)}</span><span class="dim">${ex.sets.length}${exerciseTarget(ex) ? ' × '+escapeHtml(exerciseTarget(ex)) : ' séries'}</span></div>`).join('')}
        ${next.exercises.length>3 ? `<div class="faint">+ ${plural(next.exercises.length-3,'exercício','exercícios')}</div>` : ''}
      </div>
      <button class="mprimarybtn big" data-maction="gotonext" data-session="${next.id}">${READONLY ? 'Ver treino' : 'Começar treino'} ${ICONS.chevron}</button>
    </section>`;
  }else{
    html += `<section class="mtoday">
      <div class="mtoday-name">${state.sessions.length ? 'Tudo em dia 🎉' : 'Importe sua ficha para começar'}</div>
      <div class="mmeta">${state.sessions.length ? 'Nenhuma série pendente na sua ficha.' : 'Traga o PDF do seu professor ou monte um treino pelo mapa muscular.'}</div>
      ${READONLY ? '' : `<button class="mprimarybtn big" data-maction="gotab" data-val="treinos">Ir para Treinos ${ICONS.chevron}</button>`}
    </section>`;
  }

  const month = today.slice(0,7);
  const monthCount = state.sessions.filter(s=> s.date.slice(0,7)===month && s.exercises.some(e=> e.sets.some(x=> x.weight>0))).length;
  const records = recentRecords();
  html += `<div class="mstat-grid">
    <div class="mstat"><div class="n">${computeStreak()}</div><div class="l">semanas seguidas</div></div>
    <div class="mstat"><div class="n">${monthCount}</div><div class="l">treinos no mês</div></div>
    <div class="mstat"><div class="n">${records.length}</div><div class="l">recordes novos</div></div>
  </div>`;

  if(records.length){
    html += `<section class="mstack">
      <div class="msec-head"><h2 class="overline">Recordes recentes</h2><button class="mlink" data-maction="gotab" data-val="progresso">Ver progresso</button></div>
      ${records.slice(0,2).map(r=> `<div class="mitem">
        <span class="micon-tile">${ICONS.trophy}</span>
        <div class="mitem-main"><div class="mitem-title">${escapeHtml(r.label)}</div><div class="mitem-sub">${r.weight}kg × ${r.reps} · ${fmtDayMonth(r.date)}</div></div>
        <span class="trend up">${fmtPct(r.pct)}</span>
      </div>`).join('')}
    </section>`;
  }
  html += '</div>';
  mContent.innerHTML = html;
}

/* --- Treinos --- */
function mRenderSessionsList(){
  mHeader('Treinos');
  let html = '<div class="mpage">';
  if(!READONLY){
    html += `<div class="mtiles">
      <button class="mtile" data-maction="import"><span class="micon-tile">${ICONS.file}</span><span class="mtile-title">Importar ficha</span><span class="mtile-sub">PDF do professor</span></button>
      <button class="mtile" data-maction="openbuilder"><span class="micon-tile">${ICONS.target}</span><span class="mtile-title">Montar treino</span><span class="mtile-sub">pelo mapa muscular</span></button>
    </div>`;
  }
  html += mSegmented([['list','Esta semana'],['history','Histórico']], 'list', 'treinosview');

  const next = findNextSession();
  const protId = (next && next.protocolId) || newestProtocolId();
  const prot = state.protocols.find(p=> p.id===protId);
  const weeks = protId ? protocolWeekKeys(protId) : [];
  if(prot && weeks.length){
    const idx = weeks.indexOf(getWeekKey(todayISO()));
    const pct = idx>=0 ? Math.round(((idx+1)/weeks.length)*100) : (todayISO() > weeks[weeks.length-1] ? 100 : 0);
    html += `<section class="mprot">
      <div class="mprot-top">
        <div><div class="overline">Protocolo</div><div class="mprot-name">${escapeHtml(prot.name)}</div></div>
        <span class="mmeta">${idx>=0 ? `semana ${idx+1} de ${weeks.length}` : plural(weeks.length,'semana','semanas')}</span>
      </div>
      <div class="mbar"><div style="width:${pct}%;"></div></div>
    </section>`;
  }

  const thisWeek = mThisWeekSessions();
  if(thisWeek.length===0){
    html += `<div class="mempty"><strong>${t('noSessionsYet')} nesta semana</strong>${state.sessions.length ? 'Veja as outras semanas em Histórico.' : t('importHint')}</div>`;
  }else{
    html += '<div class="mstack">';
    thisWeek.forEach(s=>{
      const st = sessionStatus(s);
      const nSets = s.exercises.reduce((a,e)=> a+e.sets.length, 0);
      const exDone = s.exercises.filter(e=> e.sets.some(x=> x.weight>0)).length;
      const meta = st==='going' ? `${exDone} de ${plural(s.exercises.length,'exercício','exercícios')}` : `${plural(s.exercises.length,'exercício','exercícios')} · ${plural(nSets,'série','séries')}`;
      html += `<button class="mday" data-mopen-session="${s.id}" data-fromhome="1">
        <span class="mday-date"><span class="mday-dow">${DOW_SHORT[dowOf(s.date)]}</span><span class="mday-n">${+s.date.slice(8,10)}</span></span>
        <span class="mitem-main"><span class="mitem-title">${escapeHtml(s.name)}${s.feedback?' <span class="feedback-flag">💬</span>':''}</span><span class="mitem-sub">${meta}</span></span>
        ${statusBadge(st)}
      </button>`;
    });
    html += '</div>';
  }
  html += '</div>';
  mContent.innerHTML = html;
}

/* --- Registrar série --- */
function mRenderEntryScreen(){
  const session = state.sessions.find(s=> s.id===mobile.sessionId);
  const ex = session && session.exercises.find(x=> x.id===mobile.exId);
  if(!ex){ mobile.screen='session'; return mRenderSessionScreen(); }
  const exIdx = session.exercises.indexOf(ex);
  mHeader(`Exercício ${exIdx+1} de ${session.exercises.length}`, {back: true, sub: session.name});
  const ro = READONLY;
  const editing = mobile.setIdx!==null && ex.sets[mobile.setIdx];
  // O alvo mostrado é o da série que está sendo preenchida (a ficha prescreve
  // faixas diferentes para aquecimento, preparatória e séries válidas).
  const curTarget = editing ? (ex.sets[mobile.setIdx].target||'')
                            : ((ex.sets[ex.sets.length-1]||{}).target||'');
  const lastLoad = lastLoadFor(ex.name, session.id, editing ? mobile.setIdx : ex.sets.length);
  let html = `<div class="mexprog">${session.exercises.map((e,i)=>
    `<span class="${i<exIdx || e.sets.every(x=> x.weight>0) ? 'done' : (i===exIdx ? 'cur' : '')}"></span>`).join('')}</div>`;
  html += '<div class="mpage">';
  html += renderRestTimerBar();
  html += `<section>
    <div class="mex-head"><h1 class="mex-name">${escapeHtml(ex.name)}</h1>${videoButtonHtml(ex.name)}</div>
    <div class="mchips">
      <span class="mchip-pill strong">${editing ? `Série ${mobile.setIdx+1}` : 'Nova série'}${curTarget ? ' · alvo '+escapeHtml(curTarget)+' reps' : ''}</span>
      <span class="mchip-pill">${lastLoad ? `Última vez: ${lastLoad.weight}kg × ${lastLoad.reps}` : 'Sem histórico anterior'}</span>
    </div>
  </section>
  <div class="msteppers">
    <div class="mstepper">
      <label for="mPadWeight">Peso (kg)</label>
      <input id="mPadWeight" class="mpad-input" data-mweightinput type="number" inputmode="decimal" step="0.5" min="0" placeholder="0" value="${escapeAttr(mobile.padWeight)}" ${ro?'disabled':''}>
      ${ro?'':`<div class="mstep-btns"><button type="button" data-mstep="weight:-2.5" aria-label="Menos 2,5 kg">−</button><button type="button" data-mstep="weight:2.5" aria-label="Mais 2,5 kg">+</button></div>`}
    </div>
    <div class="mstepper">
      <label for="mPadReps">Repetições</label>
      <input id="mPadReps" class="mpad-input" data-mrepsinput type="number" inputmode="numeric" step="1" min="0" placeholder="0" value="${escapeAttr(mobile.padReps)}" ${ro?'disabled':''}>
      ${ro?'':`<div class="mstep-btns"><button type="button" data-mstep="reps:-1" aria-label="Menos uma repetição">−</button><button type="button" data-mstep="reps:1" aria-label="Mais uma repetição">+</button></div>`}
    </div>
  </div>
  <section class="mstack">
    <h2 class="overline">Séries</h2>`;
  if(ex.sets.length===0){
    html += `<div class="mempty">Nenhuma série ainda</div>`;
  }else{
    ex.sets.forEach((s,i)=>{
      const sel = mobile.setIdx===i;
      const feito = s.weight>0;
      html += `<div class="mset ${sel?'sel':''}" data-mselset="${i}">
        <span class="mset-dot ${feito?'done':(sel?'cur':'')}">${feito ? ICONS.check : i+1}</span>
        <span class="mset-name">Série ${i+1}</span>
        <span class="mset-val">${feito ? `${s.weight}kg × ${s.reps}` : (sel ? 'agora' : (s.target ? 'alvo '+escapeHtml(s.target) : '—'))}</span>
        ${ro?'':`<button class="micon-btn" data-mdelset="${i}" aria-label="Remover série ${i+1}">✕</button>`}
      </div>`;
    });
  }
  html += `</section>
  <div class="mrow-actions">
    ${ro?'':`<button class="mghostbtn" data-maction="newset">+ Série extra</button>`}
    <button class="mghostbtn" data-maction="backtosession">Concluir exercício</button>
  </div>
  </div>`;
  if(!ro){
    html += `<div class="msticky-actions">
      <button class="mghostbtn" data-maction="skipset">Pular série</button>
      <button class="mprimarybtn" data-msaveset>${editing ? `Salvar série ${mobile.setIdx+1}` : 'Adicionar série'}</button>
    </div>`;
  }
  mContent.innerHTML = html;
}

/* --- Progresso --- */
function mRenderProgresso(){
  if(mobile.screen==='detail') return mRenderProgressDetail();
  mHeader('Progresso');
  const views = [['resumo','Resumo'],['forca','Força']];
  if(energyEnabled) views.push(['energia','Energia']);
  if(!views.some(v=> v[0]===mobile.progView)) mobile.progView = 'resumo';
  let html = '<div class="mpage">' + mSegmented(views, mobile.progView, 'progview');
  const data = computeProgress();

  if(mobile.progView==='resumo'){
    const wk = getWeekKey(todayISO());
    const cur = weekVolume(wk), prev = weekVolume(addDaysISO(wk,-7));
    const weekSessions = state.sessions.filter(s=> getWeekKey(s.date)===wk && s.exercises.some(e=> e.sets.some(x=> x.weight>0)));
    const fmtN = v=> Math.round(v).toLocaleString('pt-BR');
    const second = energyEnabled
      ? `<div class="kpi"><div class="kpi-l">Energia na semana</div><div class="kpi-v">${fmtN(computeSessionEnergy(weekSessions).reduce((n,d)=> n+d.kcal,0))} kcal</div><div class="kpi-s">${plural(weekSessions.length,'treino','treinos')}</div></div>`
      : `<div class="kpi"><div class="kpi-l">Treinos na semana</div><div class="kpi-v">${weekSessions.length}</div><div class="kpi-s">${computeStreak()} semanas seguidas</div></div>`;
    html += `<div class="kpi-grid two">
      <div class="kpi"><div class="kpi-l">Volume na semana</div><div class="kpi-v">${fmtN(cur)} kg</div>
        ${prev>0 && cur>0 ? `<div class="kpi-s trend ${cur>=prev?'up':'down'}">${fmtPct(((cur-prev)/prev)*100)} vs. anterior</div>` : `<div class="kpi-s">${prev>0 ? 'semana anterior: '+fmtN(prev)+' kg' : 'peso × repetições'}</div>`}</div>
      ${second}
    </div>`;
    const vol = computeWeeklyVolume();
    html += `<section class="mcard-lg"><div class="msec-head"><h2>Volume por semana</h2><span class="mmeta">kg</span></div>`;
    if(vol.length===0){
      html += `<div class="mempty">Registre cargas para ver o total levantado por semana.</div>`;
    }else{
      const max = Math.max(...vol.map(d=> d.volume));
      html += `<div class="energy-chart">${vol.map((d,i)=> `<div class="energy-col" tabindex="0" title="${fmtN(d.volume)} kg na semana de ${fmtDayMonth(d.week)}"><div class="energy-bar" style="height:${Math.max(2,(d.volume/max)*100).toFixed(1)}%;">${i===vol.length-1 ? `<span class="energy-val">${fmtN(d.volume)}</span>` : ''}</div></div>`).join('')}</div>
      <div class="energy-axis">${vol.map(d=> `<span>${d.week.slice(8,10)}/${d.week.slice(5,7)}</span>`).join('')}</div>`;
    }
    html += `</section>`;
  }else if(mobile.progView==='forca'){
    if(data.length===0){
      html += `<div class="mempty"><strong>Sem dados suficientes</strong>Registre sessões para ver a evolução.</div>`;
    }else{
      html += '<h2 class="overline">1RM estimado</h2><div class="mstack">';
      data.forEach(e=>{
        const pts = e.points, cur = pts[pts.length-1], prev = pts.length>1 ? pts[pts.length-2] : null;
        const pct = prev ? ((cur.rm-prev.rm)/prev.rm)*100 : null;
        html += `<button class="mitem" data-mopen-prog="${escapeAttr(e.label.toLowerCase())}">
          <span class="mitem-main"><span class="mitem-title">${escapeHtml(e.label)}</span><span class="mitem-sub">${cur.rm.toFixed(1).replace('.',',')} kg</span></span>
          ${pct===null ? '<span class="trend">—</span>' : `<span class="trend ${pct>0?'up':pct<0?'down':''}">${fmtPct(pct)}</span>`}
          <span class="faint">${ICONS.chevron}</span>
        </button>`;
      });
      html += '</div>';
    }
  }else{
    html += `<section class="mcard-lg"><div class="msec-head"><h2>Gasto de energia por treino</h2><span class="mmeta">kcal</span></div>${energyChartHtml()}</section>`;
  }
  html += '</div>';
  mContent.innerHTML = html;
}

/* --- Perfil --- */
function mRenderPerfil(){
  mHeader('Perfil');
  const isStudent = auth && auth.role==='student';
  const name = isStudent ? (auth.name || 'Aluno') : 'Visualizando como professor';
  let html = `<div class="mpage">
    <section class="mprofile">
      <span class="mavatar lg">${isStudent ? userInitial() : '👁'}</span>
      <div><div class="mprofile-name">${escapeHtml(name)}</div><div class="mitem-sub">${isStudent ? 'Código '+escapeHtml(auth.code||'') : 'Somente leitura'}</div></div>
    </section>
    <section class="mstack">
      <h2 class="overline">Meus dados</h2>
      <div class="mlist">
        <button class="mlist-row" data-maction="exportpdf"><span class="accent">${ICONS.download}</span><span class="mlist-label">Baixar relatório em PDF</span><span class="faint">${ICONS.chevron}</span></button>
        ${energyEnabled ? `<div class="mlist-row"><span class="accent">${ICONS.flame}</span><span class="mlist-label">Gasto de energia</span><span class="badge badge-ok">Liberado</span></div>` : ''}
      </div>
    </section>
    <section class="mstack">
      <h2 class="overline">Preferências</h2>
      <div class="mlist">
        <div class="mlist-row"><span class="accent">${ICONS.globe}</span><span class="mlist-label">Idioma</span>
          <div class="seg seg-sm">${['pt','en'].map(l=> `<button type="button" class="${lang===l?'active':''}" data-maction="lang" data-val="${l}">${l.toUpperCase()}</button>`).join('')}</div>
        </div>
        ${isStudent ? `<button class="mlist-row" data-maction="tour"><span class="accent">${ICONS.help}</span><span class="mlist-label">Ver o tour do app</span><span class="faint">${ICONS.chevron}</span></button>` : ''}
      </div>
    </section>
    ${READONLY
      ? `<button class="mghostbtn big" data-maction="backtostudents">${ICONS.back} Voltar aos alunos</button>`
      : `<button class="mdangerbtn" data-maction="logout">${ICONS.logout} Sair</button>`}
  </div>`;
  mContent.innerHTML = html;
}

/* --- Event delegation --- */
mContent.addEventListener('click', async e=>{
  const action = e.target.closest('[data-maction]');
  if(action){
    const act = action.dataset.maction;
    if(act==='import'){ mobile.screen='import'; mRenderImportScreen(); return; }
    if(act==='treinosview'){ mobile.screen = action.dataset.val==='history' ? 'history' : 'list'; mRender(); return; }
    if(act==='progview'){ mobile.progView = action.dataset.val; mRenderProgresso(); return; }
    if(act==='gotab'){ mobile.tab = action.dataset.val; mobile.screen = 'list'; mRender(); return; }
    if(act==='lang'){ setLang(action.dataset.val); return; }
    if(act==='tour'){ startTour(); return; }
    if(act==='logout'){ confirmLogout(); return; }
    if(act==='backtostudents'){ currentStudentId = null; boot(); return; }
    if(act==='skipset'){
      const session = state.sessions.find(s=> s.id===mobile.sessionId);
      const ex = session && session.exercises.find(x=> x.id===mobile.exId);
      const next = ex ? mFirstPendingSet(ex, (mobile.setIdx===null ? 0 : mobile.setIdx+1)) : null;
      if(next!==null && next!==mobile.setIdx){ mSelectSet(next); mRenderEntryScreen(); }
      else showToast('Não há outra série pendente neste exercício.');
      return;
    }
    if(act==='exportpdf'){ exportPdf(); return; }
    if(act==='togglemap'){ homeMapOpen = !homeMapOpen; mRenderSessionsList(); return; }
    if(act==='history'){ mobile.screen='history'; mRender(); return; }
    if(act==='gotonext'){
      const session = state.sessions.find(s=> s.id===action.dataset.session);
      if(session){
        mobile.protKey = session.protocolId;
        mobile.weekKey = getWeekKey(session.date);
        mobile.sessionId = session.id;
        mobile.tab = 'treinos';
        mobile.screen = 'session';
        mRender();
      }
      return;
    }
    if(act==='pickfile'){ fileInput.click(); return; }
    if(act==='openbuilder'){ openBuilder(); return; }
    if(act==='addsession'){
      const session = newManualSession();
      mobile.sessionId = session.id;
      mobile.weekKey = getWeekKey(session.date);
      mobile.protKey = session.protocolId;
      mobile.screen = 'session';
      save(); renderAll();
      return;
    }
    if(act==='addexercise'){
      const session = state.sessions.find(s=> s.id===mobile.sessionId);
      if(session){ session.exercises.push({id:uid(), name:'Exercício', sets:[{reps:10,weight:0}]}); save(); renderAll(); }
      return;
    }
    if(act==='addweek'){
      await addProtocolWeek(action.dataset.prot);
      return;
    }
    if(act==='repeatsession'){
      const session = state.sessions.find(s=> s.id===mobile.sessionId);
      if(session && (await doRepeatSession(session))){
        // Volta para a semana de destino; a semana de origem continua intacta.
        mobile.weekKey = getWeekKey(addDaysISO(session.date, 7));
        mobile.protKey = session.protocolId;
        mobile.sessionId = null;
        mobile.screen = 'week';
        mRender();
      }
      return;
    }
    if(act==='newset'){
      mobile.setIdx = null; mobile.padWeight=''; mobile.padReps=''; mobile.padActive='weight';
      mRenderEntryScreen();
      return;
    }
    if(act==='backtosession'){ stopRestTimer(); mobile.screen='session'; mRender(); return; }
    if(act==='cancelimport'){ closeStage(); stageGroups = []; mobile.screen='list'; mRender(); return; }
    if(act==='confirmimport'){
      const added = commitStagedSessions();
      if(added) mobile.screen='list';
      mRender();
      return;
    }
    return;
  }
  const bmviewBtn = e.target.closest('[data-bmview]');
  if(bmviewBtn){ homeMapView = bmviewBtn.dataset.bmview; mRenderSessionsList(); return; }
  const homeMuscle = e.target.closest('[data-muscle]');
  if(homeMuscle){ openBuilder(homeMuscle.dataset.muscle, homeMapView); return; }
  const openWeek = e.target.closest('[data-mopen-week]');
  if(openWeek){
    mobile.weekKey = openWeek.dataset.mopenWeek;
    mobile.protKey = openWeek.dataset.mprot || null;
    mobile.screen = 'week';
    mRender();
    return;
  }
  const openSession = e.target.closest('[data-mopen-session]');
  if(openSession){
    mobile.sessionId = openSession.dataset.mopenSession;
    if(openSession.dataset.fromhome){ mobile.weekKey = null; mobile.protKey = null; }
    mobile.screen='session'; mRender(); return;
  }
  const delSession = e.target.closest('[data-mdel-session]');
  if(delSession){
    const id = delSession.dataset.mdelSession;
    const session = state.sessions.find(s=> s.id===id);
    if(session && (await confirmDialog(`Excluir a sessão "${session.name}"?`))){
      state.sessions = state.sessions.filter(s=> s.id!==id);
      mobile.screen='list'; mobile.sessionId=null;
      save(); renderAll();
    }
    return;
  }
  const openEx = e.target.closest('[data-mopen-ex]');
  if(openEx){
    mobile.exId = openEx.dataset.mopenEx;
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    const ex = session && session.exercises.find(x=> x.id===mobile.exId);
    const pending = ex ? mFirstPendingSet(ex, 0) : null;
    if(pending!==null){
      mSelectSet(pending);
    }else{
      mobile.setIdx = null;
      const last = ex && ex.sets[ex.sets.length-1];
      const prev = ex && session ? lastLoadFor(ex.name, session.id, ex.sets.length) : null;
      mobile.padWeight = last && last.weight ? String(last.weight) : (prev ? String(prev.weight) : '');
      mobile.padReps = last && last.weight ? String(last.reps) : (prev ? String(prev.reps) : '');
      mobile.padActive = 'weight';
    }
    mobile.screen = 'entry';
    mRender();
    return;
  }
  const selSet = e.target.closest('[data-mselset]');
  if(selSet && !e.target.closest('[data-mdelset]')){
    mSelectSet(+selSet.dataset.mselset);
    mRenderEntryScreen();
    return;
  }
  const delEx = e.target.closest('[data-mdel-ex]');
  if(delEx){
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    if(session){ session.exercises = session.exercises.filter(x=> x.id!==delEx.dataset.mdelEx); save(); renderAll(); }
    return;
  }
  const stepBtn = e.target.closest('[data-mstep]');
  if(stepBtn){
    const [field, delta] = stepBtn.dataset.mstep.split(':');
    const key = field==='weight' ? 'padWeight' : 'padReps';
    const cur = parseFloat(String(mobile[key]).replace(',','.')) || 0;
    const val = Math.max(0, Math.round((cur + parseFloat(delta))*100)/100);
    mobile[key] = String(val);
    const input = mContent.querySelector(field==='weight' ? '[data-mweightinput]' : '[data-mrepsinput]');
    if(input) input.value = mobile[key];
    return;
  }
  const rtBtn = e.target.closest('[data-rt]');
  if(rtBtn){
    const v = rtBtn.dataset.rt;
    if(v==='skip'){ stopRestTimer(); }
    else{ mobile.timerEnd += (v==='+15'?15000:-15000); updateRestTimer(); }
    return;
  }
  const saveSet = e.target.closest('[data-msaveset]');
  if(saveSet){
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    const ex = session && session.exercises.find(x=> x.id===mobile.exId);
    if(ex){
      const weight = parseFloat(mobile.padWeight)||0;
      const reps = parseFloat(mobile.padReps)||0;
      let targetSet;
      if(mobile.setIdx!==null && ex.sets[mobile.setIdx]){
        // Preenche a série prescrita, mantendo o alvo do protocolo.
        targetSet = ex.sets[mobile.setIdx];
        targetSet.weight = weight;
        targetSet.reps = reps;
      }else{
        const last = ex.sets[ex.sets.length-1];
        targetSet = { weight, reps, target: last ? (last.target||'') : '' };
        ex.sets.push(targetSet);
      }
      if(weight>0){ maybeCelebratePR(ex.name, targetSet); startRestTimer(90); }
      // Vai para a próxima série ainda não feita; se acabou, fica no modo "nova".
      const next = mFirstPendingSet(ex, (mobile.setIdx===null?ex.sets.length:mobile.setIdx+1));
      if(next!==null){ mSelectSet(next); }
      else{ mobile.setIdx = null; mobile.padWeight=''; mobile.padReps=''; mobile.padActive='weight'; }
      save(); renderAll();
    }
    return;
  }
  const delSet = e.target.closest('[data-mdelset]');
  if(delSet){
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    const ex = session && session.exercises.find(x=> x.id===mobile.exId);
    if(ex){
      ex.sets.splice(+delSet.dataset.mdelset,1);
      if(ex.sets.length===0) ex.sets.push({reps:10,weight:0,target:''});
      mobile.setIdx = null; mobile.padWeight=''; mobile.padReps='';
      save(); renderAll();
    }
    return;
  }
  const delRow = e.target.closest('[data-mstagedelrow]');
  if(delRow){
    const [gi,ri] = delRow.dataset.mstagedelrow.split(':').map(Number);
    stageGroups[gi].rows.splice(ri,1);
    mRenderImportScreen();
    return;
  }
  const addRow = e.target.closest('[data-mstageaddrow]');
  if(addRow){
    stageGroups[+addRow.dataset.mstageaddrow].rows.push({name:'', sets:1, reps:10, weight:0});
    mRenderImportScreen();
    return;
  }
  const openProg = e.target.closest('[data-mopen-prog]');
  if(openProg){ mobile.progKey = openProg.dataset.mopenProg; mobile.screen='detail'; mRenderProgresso(); return; }
});

mContent.addEventListener('change', e=>{
  if(e.target.matches('[data-mstageprot]')){
    if(e.target.value==='__new'){ stageProtocol.mode='new'; stageProtocol.id=null; }
    else{ stageProtocol.mode='existing'; stageProtocol.id=e.target.value; }
    renderStageProtocol();
    mRenderImportScreen();
  }
});

mContent.addEventListener('input', e=>{
  if(e.target.matches('[data-mweightinput]')){
    mobile.padWeight = e.target.value;
    return;
  }
  if(e.target.matches('[data-mrepsinput]')){
    mobile.padReps = e.target.value;
    return;
  }
  if(e.target.matches('[data-mstageprotname]')){
    stageProtocol.name = e.target.value;
    stageProtocolName.value = e.target.value;
    return;
  }
  if(e.target.matches('[data-mstageweeks]')){
    stageProtocol.weeks = clampWeeks(e.target.value);
    stageProtocolWeeks.value = stageProtocol.weeks;
    return;
  }
  if(e.target.matches('[data-mfeedback]')){
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    if(session){ session.feedback = e.target.value; save(); }
    return;
  }
  if(e.target.matches('[data-msessname]')){
    const session = state.sessions.find(s=> s.id===mobile.sessionId);
    if(session){ session.name = e.target.value; save(); }
    return;
  }
  if(e.target.matches('[data-mstagename]')){
    const g = stageGroups.find(g=> g.id===e.target.dataset.mstagename);
    if(g) g.name = e.target.value;
    return;
  }
  if(e.target.matches('[data-mstagedate]')){
    const g = stageGroups.find(g=> g.id===e.target.dataset.mstagedate);
    if(g) g.date = e.target.value;
    return;
  }
  if(e.target.matches('[data-mstagerow]')){
    const [gi,ri,f] = e.target.dataset.mstagerow.split(':');
    const row = stageGroups[+gi].rows[+ri];
    row[f] = f==='name' ? e.target.value : (parseFloat(e.target.value)||0);
    return;
  }
});

function renderAll(){
  renderSessions();
  renderProgress();
  renderStats();
  renderDashboard();
  renderVolumeChart();
  renderEnergyChart();
  mRender();
}

function applyReadonlyUI(){
  document.getElementById('importCard').style.display = READONLY ? 'none' : '';
  document.getElementById('addSessionBtn').style.display = READONLY ? 'none' : '';
  document.getElementById('addProtocolBtn').style.display = READONLY ? 'none' : '';
  document.getElementById('openBuilderBtn').style.display = READONLY ? 'none' : '';
  const banner = document.getElementById('readonlyBanner');
  if(READONLY){
    banner.style.display = 'block';
    banner.innerHTML = '<div class="card" style="border-color:var(--accent);padding:12px 16px;margin-bottom:22px;">👁 <strong style="color:var(--text);">Área do professor</strong> — modo somente leitura, nada pode ser editado ou excluído aqui, exceto o campo de feedback em cada sessão.</div>';
  }else{
    banner.style.display = 'none';
  }
  document.getElementById('professorLink').textContent = READONLY ? '‹ voltar aos alunos' : 'sair';
  mProfessorBar.hidden = !READONLY;
}

/* ---------- Decide o que mostrar: login, painel do admin/professor ou o app ---------- */
function boot(){
  gateScreen.hidden = !!auth;
  if(!auth){
    adminDashboard.hidden = true;
    professorDashboard.hidden = true;
    appWrap.hidden = true;
    mShell.hidden = true;
    gateCodeInput.value = '';
    gateError.textContent = '';
    setTimeout(()=> gateCodeInput.focus(), 50);
    return;
  }
  if(auth.role==='admin' && !currentProfessorCode){
    adminDashboard.hidden = false;
    professorDashboard.hidden = true;
    appWrap.hidden = true;
    mShell.hidden = true;
    renderAdminDashboard();
    return;
  }
  if((auth.role==='professor' || auth.role==='admin') && !currentStudentId){
    adminDashboard.hidden = true;
    professorDashboard.hidden = false;
    appWrap.hidden = true;
    mShell.hidden = true;
    const isAdminBrowsing = auth.role==='admin';
    document.getElementById('profDashBackToAdmin').style.display = isAdminBrowsing ? '' : 'none';
    document.getElementById('logoutBtnProf').style.display = isAdminBrowsing ? 'none' : '';
    document.getElementById('profDashTagline').textContent = isAdminBrowsing
      ? `Painel de ${currentProfessorName || 'professor'} — gerencie os alunos dele.`
      : 'Área do professor — gerencie os alunos e acompanhe o treino de cada um.';
    renderProfessorDashboard();
    return;
  }
  adminDashboard.hidden = true;
  professorDashboard.hidden = true;
  appWrap.hidden = false;
  mShell.hidden = false;
  READONLY = (auth.role==='professor' || auth.role==='admin');
  STORE_KEY = 'sobrecarga_v1_' + activeStudentId();
  state = loadLocal();
  try{ energyEnabled = localStorage.getItem(energyFlagKey())==='1'; }catch(e){ energyEnabled = false; }
  loadVideosFromCache();
  applyReadonlyUI();
  if(ensureProtocols()) save();
  renderAll();
  loadRemote();
  loadFeatures();
  loadVideos();
  if(auth.role==='student' && !mShell.hidden){
    let seen = false;
    try{ seen = localStorage.getItem(tourStorageKey()) === '1'; }catch(e){}
    if(!seen) setTimeout(startTour, 500);
  }
}
boot();

/* ---------- Exportar PDF ---------- */
function fmtW(w){ return w>0 ? (w+'kg') : '—'; }

// Antes o botão só existia na versão de computador — no celular (tela ≤ 640px)
// não havia como exportar. Agora o mesmo relatório sai pelos dois lugares.
document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
function exportPdf(){
  if(state.sessions.length===0){ alert('Registre pelo menos uma sessão antes de exportar.'); return; }
  if(!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable)){
    alert('Não consegui carregar o gerador de PDF. Confira a internet e tente de novo.');
    return;
  }
  let doc;
  try{ doc = buildPdfReport(); }
  catch(e){ console.error(e); alert('Não consegui gerar o PDF agora. Tente de novo.'); return; }
  deliverPdf(doc, `sobrecarga-relatorio-${todayISO()}.pdf`);
}
// No app instalado do iPhone (tela inicial) o download direto não faz nada;
// no celular manda pelo compartilhar do sistema (salvar em Arquivos, WhatsApp…)
// e, se não der, cai no download normal.
function deliverPdf(doc, fileName){
  const isPhone = window.matchMedia && window.matchMedia('(max-width:640px)').matches;
  if(isPhone && navigator.share && navigator.canShare && typeof File==='function'){
    try{
      const file = new File([doc.output('blob')], fileName, { type:'application/pdf' });
      if(navigator.canShare({ files:[file] })){
        navigator.share({ files:[file], title:'Relatório Sobrecarga' })
          .catch(err=>{ if(!err || err.name!=='AbortError') doc.save(fileName); });
        return;
      }
    }catch(e){}
  }
  doc.save(fileName);
}
function buildPdfReport(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 20;

  doc.setFont('helvetica','bold');
  doc.setFontSize(20);
  doc.text('SOBRECARGA', marginX, y);
  y += 7;
  doc.setFont('helvetica','normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text('Relatório de treinos — gerado em ' + fmtDate(todayISO()), marginX, y);
  y += 10;

  const sorted = [...state.sessions].sort((a,b)=> a.date.localeCompare(b.date));
  const exSet = new Set();
  sorted.forEach(s=> s.exercises.forEach(e=> { if(e.name.trim()) exSet.add(e.name.trim().toLowerCase()); }));
  const totalSets = sorted.reduce((n,s)=> n+s.exercises.reduce((m,e)=> m+e.sets.length,0), 0);

  doc.setTextColor(20);
  doc.setFontSize(11);
  doc.text(`${sorted.length} sessões · ${exSet.size} exercícios · ${totalSets} séries registradas`, marginX, y);
  if(sorted.length){
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`Período: ${fmtDate(sorted[0].date)} a ${fmtDate(sorted[sorted.length-1].date)}`, marginX, y+5);
  }
  y += 14;
  if(energyEnabled){
    const kcal = computeSessionEnergy(sorted).reduce((n,d)=> n+d.kcal, 0);
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`Gasto de energia estimado (peso × repetições): ${Math.round(kcal).toLocaleString('pt-BR')} kcal no total`, marginX, y-4);
    y += 4;
  }

  // Rendimento
  const progress = computeProgress();
  doc.setTextColor(20);
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('Rendimento', marginX, y);
  y += 4;
  if(progress.length===0){
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text('Sem carga registrada ainda.', marginX, y+4);
    y += 10;
  }else{
    const rows = progress.map(e=>{
      const cur = e.points[e.points.length-1];
      const prev = e.points.length>1 ? e.points[e.points.length-2] : null;
      let variacao = '—';
      if(prev){
        const pct = ((cur.rm-prev.rm)/prev.rm)*100;
        variacao = (pct>0?'+':'') + pct.toFixed(1) + '%';
      }
      return [e.label, `${fmtW(cur.weight)} × ${cur.reps}`, prev?`${fmtW(prev.weight)} × ${prev.reps}`:'—', cur.rm.toFixed(1)+'kg', variacao];
    });
    doc.autoTable({
      startY: y, margin:{left:marginX, right:marginX},
      head: [['Exercício','Atual','Anterior','1RM est.','Variação']],
      body: rows,
      styles:{fontSize:8.5, cellPadding:2.5},
      headStyles:{fillColor:[59,112,61], textColor:255},
      alternateRowStyles:{fillColor:[245,243,250]}
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // Sessões
  if(y > 260){ doc.addPage(); y = 20; }
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20);
  doc.text('Sessões registradas', marginX, y);
  y += 8;

  sorted.forEach(session=>{
    if(y > 265){ doc.addPage(); y = 20; }
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(20);
    doc.text(`${fmtDate(session.date)} — ${session.name}`, marginX, y);
    y += 5;

    const rows = [];
    session.exercises.forEach(ex=>{
      ex.sets.forEach((s,i)=>{
        rows.push([i===0?ex.name:'', String(i+1), s.target||'—', String(s.reps||0), fmtW(s.weight)]);
      });
    });
    if(rows.length===0) rows.push(['—','—','—','—','—']);

    doc.autoTable({
      startY: y, margin:{left:marginX, right:marginX},
      head: [['Exercício','Série','Alvo','Reps','Carga']],
      body: rows,
      styles:{fontSize:8.5, cellPadding:2.2},
      headStyles:{fillColor:[59,112,61], textColor:255},
      columnStyles:{1:{cellWidth:16},2:{cellWidth:24},3:{cellWidth:18},4:{cellWidth:22}}
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  return doc;
}
