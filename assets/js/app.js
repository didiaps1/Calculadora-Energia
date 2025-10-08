/* ==========================
   ===== SUPABASE =====
   ========================== */
const SUPABASE_URL = 'https://qlgzktpcwlpyeqfkcaut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsZ3prdHBjd2xweWVxZmtjYXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NjYxMjIsImV4cCI6MjA3NTQ0MjEyMn0.Zuo9F2lo6rkhopeMAITWUBSNuobWti_ai0YDrhJWklE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Listener de auth state
sb.auth.onAuthStateChange((event, session) => {
  console.log('Supabase auth state:', event, session?.user?.id || 'No user');
});

// login anônimo (gera um user_id por navegador)
let currentUser = null;
async function ensureAuth() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (user) { 
      currentUser = user; 
      return user; 
    }

    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw error;

    currentUser = data.user;
    return currentUser;
  } catch (error) {
    console.error('Supabase auth error:', error);
    alert('Falha ao autenticar: ' + (error.message || error.error_description || 'ver console'));
    throw error;
  }
}

/* ==========================
   Utilidades / Formatação
   ========================== */
function toNumber(str){
  if (typeof str !== 'string') return NaN;
  let s = str.trim().replace(/\s+/g,'');
  if (!s) return NaN;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD){
    const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
    if (lastC > lastD){ s = s.replace(/\./g,'').replace(',','.'); }
    else { s = s.replace(/,/g,''); }
  } else if (hasC){ s = s.replace(',','.'); }
  return Number(s);
}
const fmtBRL = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(isFinite(n)?n:0);
const clamp = (v,min,max)=>Math.min(Math.max(v,min),max);

/* ==========================
   Elementos principais
   ========================== */
const inj = document.getElementById('inj');
const unit = document.getElementById('unit');
const err = document.getElementById('err');
const resBox = document.getElementById('res');

const billTrigger = document.getElementById('billTrigger');
const billInput = document.getElementById('billUpload');
const billFileName = document.getElementById('billFileName');
const billStatus = document.getElementById('billStatus');
const BILL_STATUS_DEFAULT = 'Envie a conta em PDF para preencher automaticamente.';
const PDF_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.js';
const PDF_JS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js';

let pdfjsLoaderPromise = null;

function resolvePdfGlobal(){
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (lib && !window.pdfjsLib) {
    window.pdfjsLib = lib;
  }
  if (lib?.GlobalWorkerOptions && lib.GlobalWorkerOptions.workerSrc !== PDF_JS_WORKER_SRC) {
    lib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_SRC;
  }
  return lib || null;
}

function loadPdfjsScript(){
  if (pdfjsLoaderPromise) return pdfjsLoaderPromise;
  pdfjsLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDF_JS_SRC;
    script.async = true;
    script.onload = () => {
      const lib = resolvePdfGlobal();
      if (lib) resolve(lib);
      else reject(new Error('Leitor de PDF não pôde ser inicializado.'));
    };
    script.onerror = () => reject(new Error('Falha ao carregar leitor de PDF.'));
    document.head.appendChild(script);
  }).catch(error => {
    pdfjsLoaderPromise = null;
    throw error;
  });
  return pdfjsLoaderPromise;
}

async function ensurePdfjs(){
  const lib = resolvePdfGlobal();
  if (lib) return lib;
  return loadPdfjsScript();
}

function setBillStatus(text, state = 'muted'){
  if (!billStatus) return;
  billStatus.textContent = text;
  billStatus.classList.remove('ok', 'error');
  if (state === 'ok') billStatus.classList.add('ok');
  if (state === 'error') billStatus.classList.add('error');
}

function formatLocaleNumber(n, digits){
  return isFinite(n) ? n.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '';
}

async function extractBillValues(file){
  const pdfjs = await ensurePdfjs();
  if (!pdfjs) throw new Error('Leitor de PDF não carregado.');
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  let fullText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++){
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map(item=>item.str).join(' ');
    fullText += ' ' + pageText;
  }
  const normalized = fullText.replace(/\s+/g,' ').trim();
  const marker = 'INJEÇÃO SCEE';
  const upper = normalized.toUpperCase();
  const idx = upper.indexOf(marker);
  if (idx === -1) throw new Error('Linha de INJEÇÃO SCEE não encontrada.');
  const snippet = normalized.slice(idx, idx + 220);
  const lowerSnippet = snippet.toLowerCase();
  const afterIndex = lowerSnippet.indexOf('kwh');
  const numberPattern = /(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:\.\d+)?)/g;
  let kwhStr = '';
  let priceStr = '';
  if (afterIndex !== -1){
    const after = snippet.slice(afterIndex + 3);
    const numbers = [...after.matchAll(numberPattern)].map(m=>m[1] || m[0]);
    if (numbers.length) kwhStr = numbers[0];
    if (numbers.length > 1) priceStr = numbers[1];
  }
  if (!kwhStr || !priceStr){
    const allNumbers = [...snippet.matchAll(numberPattern)].map(m=>m[1] || m[0])
      .filter(n => n.replace(/\D/g,'').length <= 8 || n.includes(',') || n.includes('.'));
    if (!kwhStr && allNumbers.length >= 2) kwhStr = allNumbers[allNumbers.length - 2];
    if (!priceStr && allNumbers.length >= 1) priceStr = allNumbers[allNumbers.length - 1];
  }
  const kwhNum = toNumber(kwhStr);
  const priceNum = toNumber(priceStr);
  if (!isFinite(kwhNum)) throw new Error('Valor de kWh não identificado.');
  if (!isFinite(priceNum)) throw new Error('Valor unitário não identificado.');
  return { kwh: kwhNum, price: priceNum };
}

if (billTrigger && billInput){
  billTrigger.addEventListener('click', ()=> billInput.click());
}

if (billInput){
  billInput.addEventListener('change', async ()=>{
    const file = billInput.files && billInput.files[0];
    if (!file){
      if (billFileName) billFileName.textContent = 'Nenhum arquivo selecionado';
      setBillStatus(BILL_STATUS_DEFAULT);
      return;
    }
    if (billFileName) billFileName.textContent = file.name;
    setBillStatus('Lendo PDF, aguarde...');
    try {
      const { kwh, price } = await extractBillValues(file);
      inj.value = formatLocaleNumber(kwh, 2);
      unit.value = formatLocaleNumber(price, 6);
      calculate();
      setBillStatus('Valores preenchidos com sucesso!', 'ok');
      billInput.value = '';
    } catch (error) {
      console.error('PDF parse error:', error);
      setBillStatus(error.message || 'Não foi possível ler o PDF.', 'error');
    }
  });
}

const vBase = document.getElementById('vBase');
const vPct = document.getElementById('vPct');
const vDesc = document.getElementById('vDesc');
const vFinal = document.getElementById('vFinal');

const sInj = document.getElementById('sInj');
const sUnit = document.getElementById('sUnit');
const sPct = document.getElementById('sPct');
const sFinal = document.getElementById('sFinal');

const calcBtn = document.getElementById('calcBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const copied = document.getElementById('copied');

const discountRow = document.getElementById('discountRow');
const chipCustom = document.getElementById('chipCustom');
const customPct = document.getElementById('customPct');
const toggleDiscountsBtn = document.getElementById('toggleDiscountsBtn');

const radioNodes = [...discountRow.querySelectorAll('input[type="radio"]')];
const defaultRadio = radioNodes.find(r => r.value === '10');

/* ==========================
   PIX modal
   ========================== */
const overlay = document.getElementById('overlay');
const advBtn = document.getElementById('advBtn');
const advFields = document.getElementById('advFields');
const cancelModal = document.getElementById('cancelModal');
const payBtn = document.getElementById('payBtn');
const genPixBtn = document.getElementById('genPix');
const pixKeyType = document.getElementById('pixKeyType');
const pixKey = document.getElementById('pixKey');
const pixAmount = document.getElementById('pixAmount');
const pixName = document.getElementById('pixName');
const pixCity = document.getElementById('pixCity');

/* Contas salvas – elementos do modal */
const accountSelect = document.getElementById('accountSelect');
const useAccountBtn = document.getElementById('useAccountBtn');
const saveAccountBtn = document.getElementById('saveAccountBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const clearAccountBtn = document.getElementById('clearAccountBtn'); // NOVO: botão limpar campos

/* ==========================
   Área do QR
   ========================== */
const qrArea = document.getElementById('qrArea');
const qrcodeBox = document.getElementById('qrcode');
const qrValor = document.getElementById('qrValor');
const qrKey = document.getElementById('qrKey');
const qrPayload = document.getElementById('qrPayload');
const copyPayloadBtn = document.getElementById('copyPayload');
const downloadQRBtn = document.getElementById('downloadQR');

/* ==========================
   Chips (descontos)
   ========================== */
function syncChips(){
  radioNodes.forEach(r => {
    const chip = r.closest('.chip');
    chip.dataset.on = r.checked ? 'true':'false';
  });
  chipCustom.querySelector('input[type="radio"]').checked
    ? (customPct.disabled = false, customPct.focus())
    : (customPct.disabled = true);
}
function showAllDiscounts(){
  [...discountRow.querySelectorAll('.chip')].forEach(c=>c.classList.remove('hidden'));
  toggleDiscountsBtn.classList.add('hidden');
}
function hideUnselectedDiscounts(){
  const selected = radioNodes.find(r=>r.checked);
  [...discountRow.querySelectorAll('.chip')].forEach(ch=>{
    const isSel = ch.querySelector('input') === selected;
    ch.classList.toggle('hidden', !isSel);
  });
  toggleDiscountsBtn.classList.remove('hidden');
}
radioNodes.forEach(r => r.addEventListener('change', ()=>{
  syncChips(); calculate(); hideUnselectedDiscounts();
}));
toggleDiscountsBtn.addEventListener('click', showAllDiscounts);
if (defaultRadio){ defaultRadio.checked = true; }
syncChips();

/* ==========================
   Cálculo
   ========================== */
function getSelectedPct(){
  const sel = radioNodes.find(r=>r.checked);
  if (!sel) return NaN;
  if (sel.value === 'custom'){
    const raw = String(customPct.value || '').replace(',','.');
    const v = Number(raw);
    return clamp(isFinite(v)?v:NaN, 0, 100);
  }
  return Number(sel.value);
}
function calculate(){
  err.classList.remove('show');
  copied.hidden = true;

  const nInj = toNumber(inj.value);
  const nUnit = toNumber(unit.value);
  const pct = getSelectedPct();

  if (!isFinite(nInj) || nInj < 0 || !isFinite(nUnit) || nUnit < 0 || !isFinite(pct)){
    resBox.hidden = true;
    if (inj.value || unit.value) err.classList.add('show');
    sInj.textContent = '—'; sUnit.textContent = '—'; sPct.textContent = '—'; sFinal.textContent = fmtBRL(0);
    return;
  }

  const base = nInj * nUnit;
  const desc = base * (pct/100);
  const final = base - desc;

  vBase.textContent = fmtBRL(base);
  vPct.textContent = `${pct.toLocaleString('pt-BR')}%`;
  vDesc.textContent = fmtBRL(desc);
  vFinal.textContent = fmtBRL(final);

  sInj.textContent = `${nInj.toLocaleString('pt-BR')} kWh`;
  sUnit.textContent = `${fmtBRL(nUnit)} / kWh`;
  sPct.textContent = `${pct.toLocaleString('pt-BR')}%`;
  sFinal.textContent = fmtBRL(final);

  resBox.hidden = false;

  pixAmount.value = (final || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
calcBtn.addEventListener('click', calculate);
[inj, unit].forEach(el=>{
  el.addEventListener('input', calculate);
  el.addEventListener('blur', calculate);
  el.addEventListener('keydown', e=>{ if(e.key==='Enter') calculate(); });
});
customPct.addEventListener('input', calculate);
customPct.addEventListener('keydown', e=>{ if(e.key==='Enter') calculate(); });

/* ==========================
   Limpar
   ========================== */
clearBtn.addEventListener('click', ()=>{
  inj.value=''; unit.value=''; customPct.value='';
  radioNodes.forEach(r=>r.checked=false);
  if (defaultRadio){ defaultRadio.checked = true; }
  syncChips(); showAllDiscounts();
  err.classList.remove('show'); resBox.hidden=true;
  sInj.textContent='—'; sUnit.textContent='—'; sPct.textContent='—'; sFinal.textContent=fmtBRL(0);
  qrcodeBox.innerHTML=''; qrArea.classList.add('hidden'); qrPayload.value='';
  if (billInput) billInput.value='';
  if (billFileName) billFileName.textContent='Nenhum arquivo selecionado';
  setBillStatus(BILL_STATUS_DEFAULT);
});

/* ==========================
   Copiar valor final
   ========================== */
copyBtn.addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(vFinal.textContent);
    copied.hidden = false; setTimeout(()=> copied.hidden = true, 1400);
  }catch{
    copied.textContent='Falhou'; copied.hidden=false; setTimeout(()=>{copied.hidden=true;copied.textContent='Copiado'},1200);
  }
});

/* ==========================
   Modal PIX
   ========================== */
function openModal(){
  const total = toNumber(vFinal.textContent.replace(/[^\d,.-]/g,''));
  pixAmount.value = (isFinite(total)?total:0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  overlay.classList.add('show');
  // carrega as contas do Supabase ao abrir
  refreshAccountSelect();
  setTimeout(()=>pixKey.focus(),50);
}
function closeModal(){ overlay.classList.remove('show'); }
payBtn.addEventListener('click', ()=>{ if (resBox.hidden) calculate(); openModal(); });
cancelModal.addEventListener('click', closeModal);
overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
advBtn.addEventListener('click', ()=>{ advFields.classList.toggle('hidden'); });

/* ==========================
   PIX payload simples
   ========================== */
function tlv(id, value){
  const len = String(value.length).padStart(2,'0');
  return id + len + value;
}
function crc16(payload){
  let crc = 0xFFFF;
  for (let i=0;i<payload.length;i++){
    crc ^= payload.charCodeAt(i) << 8;
    for (let j=0;j<8;j++){
      crc = (crc & 0x8000) ? ((crc<<1) ^ 0x1021) : (crc<<1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function buildPixPayload({key, name, city, amount}){
  const gui = tlv('00','br.gov.bcb.pix');
  const keyT = tlv('01', key);
  const mai = tlv('26', gui + keyT);
  const mcc = tlv('52','0000');
  const cur = tlv('53','986');
  const amt = amount ? tlv('54', amount) : '';
  const cty = tlv('58','BR');
  const nm  = tlv('59', name || 'RECEBEDOR');
  const cy  = tlv('60', (city || 'CIDADE').toUpperCase());
  const add = tlv('62', tlv('05','***'));
  const base = tlv('00','01') + tlv('01','11') + mai + mcc + cur + amt + cty + nm + cy + add;
  const toCRC = base + '6304';
  const crc = crc16(toCRC);
  return toCRC + crc;
}
function sanitizeAmountBRL(str){
  const n = toNumber(str);
  return (isFinite(n) ? n : 0).toFixed(2);
}

/* ==========================
   Gerar PIX e QRCode
   ========================== */
genPixBtn.addEventListener('click', ()=>{
  const key = (pixKey.value || '').trim();
  let amount = sanitizeAmountBRL(pixAmount.value || '0');
  if (!key){ alert('Informe a chave Pix'); pixKey.focus(); return; }
  if (parseFloat(amount) <= 0){ alert('Valor inválido'); pixAmount.focus(); return; }

  const payload = buildPixPayload({
    key,
    name: (pixName.value || '').trim(),
    city: (pixCity.value || '').trim(),
    amount
  });

  qrcodeBox.innerHTML = '';
  new QRCode(qrcodeBox, { text: payload, width: 180, height: 180 });

  qrValor.textContent = fmtBRL(parseFloat(amount));
  qrKey.textContent = key;
  qrPayload.value = payload;
  qrArea.classList.remove('hidden');
  closeModal();
});

/* ==========================
   Copiar e Baixar QR
   ========================== */
copyPayloadBtn.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(qrPayload.value); copyPayloadBtn.textContent='Copiado'; setTimeout(()=>copyPayloadBtn.textContent='Copiar código',1200); }
  catch{ copyPayloadBtn.textContent='Falhou'; setTimeout(()=>copyPayloadBtn.textContent='Copiar código',1200); }
});
downloadQRBtn.addEventListener('click', ()=>{
  const canvas = qrcodeBox.querySelector('canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'PIX_QR.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

/* ==========================
   UX: placeholder por tipo de chave
   ========================== */
pixKeyType.addEventListener('change', ()=>{
  const t = pixKeyType.value;
  if (t === 'Telefone'){ pixKey.placeholder = '+55DDDNUMERO'; if (!pixKey.value.startsWith('+55')) pixKey.value = '+55'; }
  else { pixKey.placeholder = 'Digite a chave'; }
});

/* ==========================
   Download “como está” (PDF A4 paisagem)
   ========================== */
const downloadBtn = document.getElementById('downloadBtn');
async function exportShellToPDF(){
  const node = document.querySelector('.wrap'); // captura com o fundo
  window.scrollTo(0, 0);
  const canvas = await html2canvas(node, {
    backgroundColor: null,
    scale: Math.max(2, window.devicePixelRatio || 1),
    useCORS: true,
    logging: false,
    windowWidth: document.documentElement.scrollWidth,
    windowHeight: document.documentElement.scrollHeight
  });
  const imgData = canvas.toDataURL('image/jpeg', 0.98);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 6;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;
  const ratio = canvas.width / canvas.height;
  let w = contentW;
  let h = w / ratio;
  if (h > contentH) { h = contentH; w = h * ratio; }
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;
  pdf.addImage(imgData, 'JPEG', x, y, w, h);
  pdf.save('SCEE-Resumo.pdf');
}
downloadBtn.addEventListener('click', exportShellToPDF);

/* ==========================
   Contas salvas — helpers (COM amount COMENTADO)
   ========================== */
function getPixFormData(){
  return {
    type: pixKeyType.value,           // CPF, CNPJ, Telefone, Email, Aleatoria
    key: (pixKey.value || '').trim(),
    // amount: (pixAmount.value || '').trim(),  // COMENTADO: não salvar, é variável
    name: (pixName.value || '').trim(),
    city: (pixCity.value || '').trim()
  };
}
function setPixFormData(acc){
  if (!acc) return;
  pixKeyType.value = acc.type || 'Aleatoria';
  pixKey.value = acc.key || '';
  // if (acc.amount) pixAmount.value = acc.amount;  // COMENTADO: não setar, valor é dinâmico
  pixName.value = acc.name || '';
  pixCity.value = acc.city || '';
  // placeholder de telefone (permanece igual)
  const t = pixKeyType.value;
  if (t === 'Telefone'){ pixKey.placeholder = '+55DDDNUMERO'; if (!pixKey.value.startsWith('+55') && !pixKey.value) pixKey.value = '+55'; }
  else { pixKey.placeholder = 'Digite a chave'; }
}

/* ===== Supabase: CRUD de contas ===== */
async function dbLoadAccounts(){
  try {
    await ensureAuth();
    const { data, error } = await sb.from('accounts')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Load error:', error);
    alert('Erro ao listar contas: ' + error.message);
    return [];
  }
}
async function dbSaveAccount(acc){ // {label,type,key,name?,city?}
  try {
    const user = await ensureAuth();
    const payload = { ...acc, user_id: user.id, created_at: new Date().toISOString() };
    const { error } = await sb.from('accounts')
      .upsert(payload, { onConflict: 'user_id,label' });
    if (error) throw error;
  } catch (error) {
    console.error('Save error:', error);
    alert('Erro ao salvar conta: ' + error.message);
  }
}
async function dbDeleteAccount(idOrLabel){
  try {
    await ensureAuth();
    let { error } = await sb.from('accounts').delete().eq('id', idOrLabel).eq('user_id', currentUser.id);
    if (error) {
      const { error: e2 } = await sb.from('accounts')
        .delete().eq('user_id', currentUser.id).eq('label', idOrLabel);
      if (e2) throw e2;
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert('Erro ao excluir conta: ' + error.message);
  }
}
async function refreshAccountSelect(){
  try {
    const list = await dbLoadAccounts();
    accountSelect.innerHTML = '<option value="">— selecionar conta —</option>';
    list.forEach(acc=>{
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.label || acc.key || 'Sem nome';
      opt.dataset.payload = JSON.stringify(acc);
      accountSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('Refresh error:', error);
  }
}

/* ===== Botões de contas ===== */
// NOVO: Auto-aplicar ao selecionar (change event)
accountSelect.addEventListener('change', ()=>{
  const sel = accountSelect.selectedOptions[0];
  if (!sel || !sel.dataset.payload) return;
  setPixFormData(JSON.parse(sel.dataset.payload));
  // Opcional: Scroll pro campo chave pra UX
  pixKey.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Fallback: Botão "Usar" (ainda funciona, mas redundante)
useAccountBtn.addEventListener('click', ()=>{
  const sel = accountSelect.selectedOptions[0];
  if (!sel || !sel.dataset.payload){ alert('Selecione uma conta.'); return; }
  setPixFormData(JSON.parse(sel.dataset.payload));
});

saveAccountBtn.addEventListener('click', async ()=>{
  const data = getPixFormData();
  if (!data.key){ alert('Informe a chave Pix para salvar.'); pixKey.focus(); return; }
  const label = prompt('Nome da conta (ex.: Conta 1, Leticia):', data.name || data.key);
  if (label === null) return;
  const payload = { ...data, label: (label||'').trim() || data.key };
  await dbSaveAccount(payload);
  await refreshAccountSelect();
  alert('Conta salva!');
});

deleteAccountBtn.addEventListener('click', async ()=>{
  const sel = accountSelect.selectedOptions[0];
  if (!sel || !sel.value){ alert('Selecione uma conta para excluir.'); return; }
  const acc = JSON.parse(sel.dataset.payload);
  if (!confirm(`Excluir a conta "${acc.label || acc.key}"?`)) return;
  await dbDeleteAccount(acc.id || acc.label);
  await refreshAccountSelect();
  accountSelect.value = '';
  alert('Conta excluída.');
});

// NOVO: Botão limpar campos (só formulários, não DB)
clearAccountBtn.addEventListener('click', ()=>{
  pixKeyType.value = 'Aleatoria';
  pixKey.value = '';
  pixName.value = '';
  pixCity.value = '';
  pixKey.placeholder = 'Digite a chave'; // Reset placeholder
  accountSelect.value = ''; // Desseleciona
  pixKey.focus(); // Foco pro campo principal
});