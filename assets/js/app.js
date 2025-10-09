/* ==========================
   ===== SUPABASE =====
   ========================== */
const SUPABASE_URL = 'https://qlgzktpcwlpyeqfkcaut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsZ3prdHBjd2xweWVxZmtjYXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NjYxMjIsImV4cCI6MjA3NTQ0MjEyMn0.Zuo9F2lo6rkhopeMAITWUBSNuobWti_ai0YDrhJWklE';
const supabaseLib = typeof window !== 'undefined' ? window.supabase : undefined;
const hasSupabaseSDK = !!(supabaseLib && typeof supabaseLib.createClient === 'function');
const sb = hasSupabaseSDK ? supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    console.log('Supabase auth state:', event, session?.user?.id || 'No user');
  });
} else {
  console.warn('Supabase SDK não carregou; recursos de contas salvas foram desativados.');
}

// login anônimo (gera um user_id por navegador)
let currentUser = null;
async function ensureAuth() {
  if (!sb) return null;
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

function findNumberInText(text){
  if (!text) return null;
  const match = String(text).match(/-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const raw = match[0];
  const value = toNumber(raw);
  if (!isFinite(value)) return null;
  return { raw, value };
}

function getDecimalCount(raw){
  if (!raw) return 0;
  const match = String(raw).match(/[.,](\d+)/);
  return match ? match[1].length : 0;
}

function scorePriceCandidate(candidate, { distance = 0, fromLabel = false, hasCurrency = false, sequenceIndex = 0 } = {}){
  if (!candidate || !isFinite(candidate.value)) return -Infinity;
  const decimals = getDecimalCount(candidate.raw);
  let score = 0;
  if (fromLabel) score += 60;
  if (hasCurrency) score += 15;
  if (decimals >= 4) score += 30;
  else if (decimals === 3) score += 18;
  else if (decimals === 2) score += 6;
  if (candidate.value > 0 && candidate.value < 5) score += 35;
  else if (candidate.value >= 5 && candidate.value < 10) score += 12;
  else if (candidate.value >= 10) score -= 12;
  score -= distance * 1.5;
  score -= sequenceIndex * 0.1;
  return score;
}

async function flateDecode(bytes){
  if (typeof DecompressionStream === 'function'){
    for (const format of ['deflate', 'deflate-raw']){
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        const buffer = await new Response(stream).arrayBuffer();
        if (buffer.byteLength){
          return new TextDecoder('utf-8').decode(buffer);
        }
      } catch (error) {
        console.warn(`DecompressionStream ${format} falhou`, error);
      }
    }
  }
  throw new Error('Este navegador não suporta a leitura automática do PDF.');
}

function decodePdfLiteralString(source, startIndex){
  const chars = [];
  let i = startIndex;
  while (i < source.length){
    const ch = source[i];
    if (ch === ')'){
      return { value: chars.join(''), nextIndex: i + 1 };
    }
    if (ch === '\\'){
      const next = source[i + 1];
      if (next === undefined){
        return { value: chars.join(''), nextIndex: source.length };
      }
      if (/^[0-7]$/.test(next)){
        let oct = next;
        let consumed = 1;
        for (let j = 2; j <= 3 && /^[0-7]$/.test(source[i + j]); j++){
          oct += source[i + j];
          consumed++;
        }
        chars.push(String.fromCharCode(parseInt(oct, 8)));
        i += consumed + 1;
        continue;
      }
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      chars.push(map[next] ?? next);
      i += 2;
      continue;
    }
    chars.push(ch);
    i++;
  }
  return { value: chars.join(''), nextIndex: source.length };
}

function decodePdfHexString(source, startIndex){
  let i = startIndex;
  let hex = '';
  while (i < source.length){
    const ch = source[i];
    if (ch === '>'){
      break;
    }
    if (!/\s/.test(ch)){
      hex += ch;
    }
    i++;
  }
  if (hex.length % 2 === 1){
    hex += '0';
  }
  let value = '';
  for (let j = 0; j < hex.length; j += 2){
    const code = parseInt(hex.slice(j, j + 2), 16);
    value += String.fromCharCode(code);
  }
  if (value.length >= 2 && value.charCodeAt(0) === 0xFE && value.charCodeAt(1) === 0xFF){
    let decoded = '';
    for (let k = 2; k < value.length; k += 2){
      decoded += String.fromCharCode((value.charCodeAt(k) << 8) + (value.charCodeAt(k + 1) || 0));
    }
    value = decoded;
  }
  return { value, nextIndex: i + 1 };
}

function sanitizePdfString(raw){
  let value = raw;
  if (value.length >= 2 && value.charCodeAt(0) === 0xFE && value.charCodeAt(1) === 0xFF){
    let decoded = '';
    for (let i = 2; i < value.length; i += 2){
      decoded += String.fromCharCode((value.charCodeAt(i) << 8) + (value.charCodeAt(i + 1) || 0));
    }
    value = decoded;
  }
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function collectPdfStringsInto(content, target){
  for (let i = 0; i < content.length; i++){
    const ch = content[i];
    if (ch === '('){
      const { value, nextIndex } = decodePdfLiteralString(content, i + 1);
      const sanitized = value ? sanitizePdfString(value) : '';
      if (sanitized) target.push(sanitized);
      i = nextIndex - 1;
    } else if (ch === '<' && content[i + 1] !== '<'){
      const { value, nextIndex } = decodePdfHexString(content, i + 1);
      const sanitized = value ? sanitizePdfString(value) : '';
      if (sanitized) target.push(sanitized);
      i = nextIndex - 1;
    }
  }
  return target;
}

async function extractPdfText(buffer){
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const asciiSnapshot = latin1Decoder.decode(bytes);
  const segments = [];
  const stringTokens = [];
  let hadCompressedStream = false;
  let decodeFailed = false;
  let decodeErrorMessage = '';
  const streamRegex = /<<[\s\S]*?>>\s*stream\r?\n/g;
  let match;
  while ((match = streamRegex.exec(asciiSnapshot)) !== null){
    const dict = match[0];
    const hasFlate = /\/Filter\s*(?:\[[^\]]*\/FlateDecode[^\]]*\]|\/FlateDecode)/.test(dict);
    const start = streamRegex.lastIndex;
    const end = asciiSnapshot.indexOf('endstream', start);
    if (end === -1) break;
    let startIndex = start;
    if (bytes[startIndex] === 0x0d && bytes[startIndex + 1] === 0x0a) startIndex += 2;
    else if (bytes[startIndex] === 0x0a || bytes[startIndex] === 0x0d) startIndex += 1;
    let endIndex = end;
    while (endIndex > startIndex && (bytes[endIndex - 1] === 0x0d || bytes[endIndex - 1] === 0x0a)) endIndex--;
    const chunk = bytes.slice(startIndex, endIndex);
    if (!chunk.length) continue;
    let textChunk = '';
    try {
      if (hasFlate){
        hadCompressedStream = true;
        textChunk = await flateDecode(chunk);
      } else {
        textChunk = latin1Decoder.decode(chunk);
      }
    } catch (error) {
      decodeFailed = true;
      if (!decodeErrorMessage && error && error.message) decodeErrorMessage = String(error.message);
      console.warn('Falha ao decodificar parte do PDF', error);
      continue;
    }
    if (textChunk){
      const cleaned = textChunk.replace(/\0/g, ' ');
      segments.push(cleaned);
      collectPdfStringsInto(cleaned, stringTokens);
    }
  }
  if (!segments.length){
    const fallback = asciiSnapshot.replace(/\0/g, ' ');
    segments.push(fallback);
    collectPdfStringsInto(fallback, stringTokens);
  }
  const joinedText = segments.join(' ');
  const joinedSnippets = stringTokens.join(' ');
  return {
    text: joinedText,
    extractedStrings: joinedSnippets,
    tokens: stringTokens,
    hadCompressedStream,
    decodeFailed,
    decodeErrorMessage
  };
}

function normalizeAccents(str){
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function extractBillValues(file){
  const buffer = await file.arrayBuffer();
  const { text, extractedStrings, tokens, hadCompressedStream, decodeFailed, decodeErrorMessage } = await extractPdfText(buffer);
  const sourceText = extractedStrings && extractedStrings.length > 40 ? extractedStrings : text;
  const rawText = sourceText.replace(/\s+/g, ' ').trim();
  if (!rawText && hadCompressedStream && decodeFailed){
    const fallbackMsg = decodeErrorMessage || 'Não foi possível extrair o texto comprimido do PDF neste navegador. Use um navegador atualizado (Chrome ou Edge) ou informe os valores manualmente.';
    throw new Error(fallbackMsg);
  }
  if (!rawText){
    throw new Error('Não foi possível ler o conteúdo do PDF.');
  }

  const anchors = [
    { term: 'INJEÇÃO SCEE', normalized: 'INJECAO SCEE' },
    { term: 'CRÉDITO RECEBIDO', normalized: 'CREDITO RECEBIDO' },
    { term: 'CREDITO RECEBIDO', normalized: 'CREDITO RECEBIDO' },
    { term: '(CRÉDITO RECEBIDO)', normalized: '(CREDITO RECEBIDO)' },
    { term: '(CREDITO RECEBIDO)', normalized: '(CREDITO RECEBIDO)' }
  ];

  const tokenData = (tokens || []).map((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = normalizeAccents(trimmed);
    return {
      raw: trimmed,
      upper: trimmed.toUpperCase(),
      normalized,
      upperNormalized: normalized.toUpperCase(),
      index
    };
  }).filter(Boolean);

  let anchorTokenIndex = -1;
  outerAnchor:
  for (const anchor of anchors){
    const idx = tokenData.findIndex(token =>
      token.upper.includes(anchor.term) || token.upperNormalized.includes(anchor.normalized)
    );
    if (idx !== -1){
      anchorTokenIndex = idx;
      break outerAnchor;
    }
  }
  if (anchorTokenIndex === -1){
    outerCombined:
    for (const anchor of anchors){
      for (let i = 0; i < tokenData.length - 1; i++){
        const combined = `${tokenData[i].upperNormalized} ${tokenData[i + 1].upperNormalized}`;
        if (combined.includes(anchor.normalized)){
          anchorTokenIndex = i;
          break outerCombined;
        }
      }
    }
  }

  const snippetFromTokens = anchorTokenIndex !== -1 && tokenData.length
    ? tokenData.slice(Math.max(0, anchorTokenIndex - 6), Math.min(tokenData.length, anchorTokenIndex + 30)).map(t => t.raw).join(' ')
    : '';

  let kwhCandidate = null;
  let kwhTokenIndex = -1;
  if (tokenData.length){
    const kwhCandidates = [];
    tokenData.forEach((token, idx) => {
      if (!token.upperNormalized.includes('KWH')) return;
      let candidate = findNumberInText(token.raw);
      let candidateIndex = idx;
      if (!candidate || candidate.value < 1){
        for (let j = idx + 1; j < tokenData.length && j <= idx + 4; j++){
          const lookahead = findNumberInText(tokenData[j].raw);
          if (lookahead && lookahead.value >= 1){
            candidate = lookahead;
            candidateIndex = j;
            break;
          }
        }
      }
      if (candidate && candidate.value >= 1){
        const distance = anchorTokenIndex !== -1 ? Math.abs(candidateIndex - anchorTokenIndex) : 0;
        kwhCandidates.push({ candidate, index: candidateIndex, distance });
      }
    });
    if (kwhCandidates.length){
      kwhCandidates.sort((a, b) => {
        if (anchorTokenIndex !== -1 && a.distance !== b.distance){
          return a.distance - b.distance;
        }
        return a.index - b.index;
      });
      kwhCandidate = kwhCandidates[0].candidate;
      kwhTokenIndex = kwhCandidates[0].index;
    }
  }

  let priceCandidate = null;
  if (tokenData.length){
    const referenceIndex = kwhTokenIndex !== -1 ? kwhTokenIndex : (anchorTokenIndex !== -1 ? anchorTokenIndex : 0);
    const priceCandidates = [];
    const maxIndex = Math.min(tokenData.length, referenceIndex + 80);

    const pushCandidate = (number, index, opts = {}) => {
      if (!number || !isFinite(number.value) || number.value <= 0) return;
      if (kwhCandidate && number.value === kwhCandidate.value && Math.abs(index - kwhTokenIndex) <= 1) return;
      const distance = Math.abs(index - referenceIndex);
      priceCandidates.push({
        number,
        index,
        distance,
        fromLabel: !!opts.fromLabel,
        hasCurrency: !!opts.hasCurrency
      });
    };

    for (let i = referenceIndex; i < maxIndex; i++){
      const token = tokenData[i];
      const normalized = token.upperNormalized;
      const number = findNumberInText(token.raw);
      const hasCurrency = token.raw.includes('R$') || normalized.includes('RS');
      const isPriceLabel = normalized.includes('PRECO') && normalized.includes('UNIT');

      if (isPriceLabel){
        for (let j = i + 1; j < tokenData.length && j <= i + 6; j++){
          const lookahead = findNumberInText(tokenData[j].raw);
          const lookaheadCurrency = tokenData[j].raw.includes('R$') || tokenData[j].upperNormalized.includes('RS');
          pushCandidate(lookahead, j, { fromLabel: true, hasCurrency: lookaheadCurrency });
        }
      }

      pushCandidate(number, i, { hasCurrency });
    }

    if (priceCandidates.length){
      let best = null;
      priceCandidates.forEach((candidate, seqIdx) => {
        const score = scorePriceCandidate(candidate.number, {
          distance: candidate.distance,
          fromLabel: candidate.fromLabel,
          hasCurrency: candidate.hasCurrency,
          sequenceIndex: seqIdx
        });
        if (!best || score > best.score || (score === best.score && candidate.distance < best.distance)){
          best = { ...candidate, score };
        }
      });
      if (best) priceCandidate = best.number;
    }
  }

  const normalized = normalizeAccents(rawText);
  const upper = rawText.toUpperCase();
  const upperNormalized = normalized.toUpperCase();

  function buildSnippetFromText(){
    for (const anchor of anchors){
      let idx = upper.indexOf(anchor.term);
      let base = rawText;
      if (idx === -1){
        idx = upperNormalized.indexOf(anchor.normalized);
        base = normalized;
      }
      if (idx !== -1){
        return base.slice(Math.max(0, idx - 80), idx + 260);
      }
    }
    return '';
  }

  function extractFromSnippet(snippetText){
    if (!snippetText) return { kwh: null, price: null };
    const numberPattern = /(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:\.\d+)?)/g;
    const numberMatches = [...snippetText.matchAll(numberPattern)].map(match => ({
      raw: match[1] || match[0],
      value: toNumber(match[1] || match[0]),
      index: match.index ?? snippetText.indexOf(match[0])
    })).filter(entry => isFinite(entry.value));

    const kwhFromTag = (() => {
      const match = snippetText.match(/KWH[^\d]*([\d.,]+)/i);
      if (!match) return null;
      return { raw: match[1], value: toNumber(match[1]) };
    })();

    let kwh = kwhFromTag;
    if (!kwh){
      kwh = numberMatches.find(entry => entry.value >= 1) || null;
    }

    let price = null;
    if (kwh){
      const idx = numberMatches.findIndex(entry => entry.raw === kwh.raw || entry.value === kwh.value);
      if (idx !== -1){
        const after = numberMatches.slice(idx + 1);
        if (after.length){
          let best = null;
          after.forEach((entry, seqIdx) => {
            const score = scorePriceCandidate(entry, { distance: seqIdx + 1, sequenceIndex: seqIdx });
            if (!best || score > best.score){
              best = { entry, score };
            }
          });
          if (best) price = best.entry;
        }
      }
    }
    if (!price){
      const match = snippetText.match(/(?:PRE[CÇ]O\s*UNIT[^\d]*|R\$[^\d]*)\s*([\d.,]+)/i);
      if (match){
        const value = toNumber(match[1]);
        if (isFinite(value)) price = { raw: match[1], value };
      }
    }
    if (!price){
      let best = null;
      numberMatches.forEach((entry, seqIdx) => {
        const score = scorePriceCandidate(entry, { distance: seqIdx + 1, sequenceIndex: seqIdx });
        if (!best || score > best.score){
          best = { entry, score };
        }
      });
      if (best) price = best.entry;
    }

    return { kwh, price };
  }

  let snippet = snippetFromTokens;
  if ((!kwhCandidate || !priceCandidate) && !snippet){
    snippet = buildSnippetFromText();
  }
  if ((!kwhCandidate || !priceCandidate) && !snippet){
    const fallbackMatch = rawText.match(/KWH[^\d]*[\d.,]+/i);
    if (fallbackMatch){
      const idx = fallbackMatch.index ?? rawText.indexOf(fallbackMatch[0]);
      const start = Math.max(0, idx - 120);
      snippet = rawText.slice(start, start + 320);
    }
  }

  if ((!kwhCandidate || !priceCandidate) && !snippet){
    throw new Error('Não foi possível localizar os campos de crédito no PDF. Informe os valores manualmente ou envie o arquivo completo.');
  }

  if (!kwhCandidate || !priceCandidate){
    const { kwh: snippetKwh, price: snippetPrice } = extractFromSnippet(snippet);
    if (!kwhCandidate && snippetKwh) kwhCandidate = snippetKwh;
    if (!priceCandidate && snippetPrice) priceCandidate = snippetPrice;
  }

  if (!kwhCandidate){
    throw new Error('Valor de kWh não identificado no PDF.');
  }
  if (!priceCandidate){
    throw new Error('Valor unitário não identificado no PDF.');
  }

  if (!isFinite(kwhCandidate.value)) throw new Error('Valor de kWh não identificado no PDF.');
  if (!isFinite(priceCandidate.value)) throw new Error('Valor unitário não identificado no PDF.');

  return { kwh: kwhCandidate.value, price: priceCandidate.value };
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

const accountHelperText = accountSelect ? accountSelect.closest('.full')?.querySelector('small.muted') : null;
const ACCOUNT_FEATURES_DISABLED_MESSAGE = 'Sincronizar contas requer conexão com o Supabase, indisponível no momento.';
function disableAccountFeatures(message){
  if (accountSelect){
    accountSelect.innerHTML = '<option value="">Recurso indisponível</option>';
    accountSelect.disabled = true;
  }
  [useAccountBtn, saveAccountBtn, deleteAccountBtn].forEach(btn => {
    if (btn){
      btn.disabled = true;
      btn.title = message;
    }
  });
  if (accountHelperText){
    accountHelperText.textContent = message;
  }
}
if (!sb){
  disableAccountFeatures(ACCOUNT_FEATURES_DISABLED_MESSAGE);
}

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
  if (!sb) return [];
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
  if (!sb) {
    alert(ACCOUNT_FEATURES_DISABLED_MESSAGE);
    return;
  }
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
  if (!sb) {
    alert(ACCOUNT_FEATURES_DISABLED_MESSAGE);
    return;
  }
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
  if (!sb) {
    disableAccountFeatures(ACCOUNT_FEATURES_DISABLED_MESSAGE);
    return;
  }
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
  if (!sb) {
    alert(ACCOUNT_FEATURES_DISABLED_MESSAGE);
    return;
  }
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
  if (!sb) {
    alert(ACCOUNT_FEATURES_DISABLED_MESSAGE);
    return;
  }
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
