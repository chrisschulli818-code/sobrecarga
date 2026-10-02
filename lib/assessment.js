// Avaliação física: anamnese, medidas, dobras cutâneas e os cálculos
// (IMC/OMS e % de gordura por Pollock 7 dobras + Siri). Portado do projeto
// "avaliacao-fisica" (Next.js) com as mesmas fórmulas e casos de teste.
//
// Este arquivo roda no servidor (require) e no navegador (<script>, expõe
// window.Assessment) — assim a prévia do formulário e o que fica salvo
// usam exatamente a mesma conta.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Assessment = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITES_IMC = [
    [0, 'Abaixo do peso'],
    [18.5, 'Peso normal'],
    [25, 'Sobrepeso'],
    [30, 'Obesidade Grau I'],
    [35, 'Obesidade Grau II'],
    [40, 'Obesidade Grau III']
  ];

  const CIRC = [['ombro', 'Ombro'], ['torax', 'Tórax'], ['cintura', 'Cintura'], ['abdominal', 'Abdominal'], ['quadril', 'Quadril']];
  const CIRC_LR = [['bracoNormal', 'Braço normal'], ['bracoContraido', 'Braço contraído'], ['antebraco', 'Antebraço'], ['coxa', 'Coxa'], ['panturrilha', 'Panturrilha']];
  const DOBRAS = [
    ['triceps', 'Tríceps'], ['peito', 'Peito'], ['axilarMedia', 'Axilar média'], ['subescapular', 'Subescapular'],
    ['abdominal', 'Abdominal'], ['supraIliaca', 'Supra-ilíaca'], ['coxa', 'Coxa']
  ];
  const FOTOS = [['anterior', 'Anterior'], ['posterior', 'Posterior'], ['ladoEsquerdo', 'Lado esquerdo'], ['ladoDireito', 'Lado direito']];

  // Perguntas sim/não da anamnese; as com detalhe têm um campo "qual?".
  const YES_NO = [
    ['jaTreinouAntes', 'Já treinou antes?'],
    ['estaFazendoDieta', 'Está fazendo dieta?'],
    ['consomeAlcool', 'Consome álcool?'],
    ['fuma', 'Fuma?']
  ];
  const YES_NO_DETAIL = [
    ['temDoencaOuProblemaSaude', 'doencaOuProblemaSaudeDetalhe', 'Doença/problema de saúde?', 'Qual?'],
    ['temLimitacaoMovimento', 'limitacaoMovimentoDetalhe', 'Limitação de movimento?', 'Qual?'],
    ['temDorEmMovimento', 'dorEmMovimentoDetalhe', 'Dor em algum movimento?', 'Qual movimento?'],
    ['fezCirurgias', 'cirurgiasDetalhe', 'Cirurgias?', 'Quais?'],
    ['usaMedicamentoControlado', 'medicamentoControladoDetalhe', 'Medicamento controlado?', 'Qual?']
  ];
  const TEXT_FIELDS = [
    ['tempoDeTreino', 'Treina há quanto tempo?'],
    ['tempoSemAtividadeFisica', 'Tempo sem atividade física?'],
    ['objetivo', 'Objetivo?'],
    ['tempoTreinoPorDia', 'Tempo de treino por dia?']
  ];

  const round = (v, d) => { const f = 10 ** (d == null ? 2 : d); return Math.round(v * f) / f; };
  const isPositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

  // "1,75" e "1.75" valem; vazio ou inválido vira null. max evita lixo absurdo.
  function num(v, max) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > (max || 1000)) return null;
    return round(n, 2);
  }
  function text(v, max) {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max || 300);
    return s || null;
  }
  function photoUrl(v) {
    const s = text(v, 500);
    if (!s) return null;
    try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; }
  }

  function calcularIMC(alturaM, pesoKg) {
    if (!isPositive(alturaM) || !isPositive(pesoKg)) return null;
    return round(pesoKg / (alturaM * alturaM));
  }
  function classificarIMC(imc) {
    if (imc === null || !Number.isFinite(imc) || imc <= 0) return null;
    let r = LIMITES_IMC[0][1];
    for (const [limite, c] of LIMITES_IMC) if (imc >= limite) r = c;
    return r;
  }
  function somarDobras(d) {
    const v = DOBRAS.map(([k]) => d && d[k]);
    if (!v.every(isPositive)) return null;
    return v.reduce((a, b) => a + b, 0);
  }
  // Pollock 7 dobras (densidade) + Siri: %G = 495/DC − 450.
  function percentualGorduraPollock7(sexo, idade, dobras) {
    const soma = somarDobras(dobras);
    if (soma === null || !isPositive(idade) || (sexo !== 'masculino' && sexo !== 'feminino')) return null;
    const dc = sexo === 'masculino'
      ? 1.112 - 0.00043499 * soma + 0.00000055 * soma ** 2 - 0.00028826 * idade
      : 1.097 - 0.00046971 * soma + 0.00000056 * soma ** 2 - 0.00012828 * idade;
    const p = 495 / dc - 450;
    if (!Number.isFinite(p) || p < 0) return null;
    return round(p);
  }
  function calcularAvaliacao({ altura, peso, sexo, idade, dobras }) {
    const imc = calcularIMC(altura, peso);
    const percentualGordura = percentualGorduraPollock7(sexo, idade, dobras);
    const massaGorda = percentualGordura !== null && isPositive(peso) ? round(peso * percentualGordura / 100) : null;
    const massaMagra = massaGorda !== null ? round(peso - massaGorda) : null;
    return { imc, classificacaoImc: classificarIMC(imc), percentualGordura, massaGorda, massaMagra };
  }

  // Normaliza o que vem do formulário: só os campos conhecidos, números
  // validados e o resultado recalculado aqui (nunca confia no do cliente).
  function sanitizeAssessment(input, profile) {
    const i = input || {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(i.date || '')) ? i.date : null;
    const circ = {};
    CIRC.forEach(([k]) => { circ[k] = num(i.circunferencias && i.circunferencias[k], 300); });
    CIRC_LR.forEach(([k]) => {
      const c = (i.circunferencias && i.circunferencias[k]) || {};
      circ[k] = { esquerdo: num(c.esquerdo, 300), direito: num(c.direito, 300) };
    });
    const dobras = {};
    DOBRAS.forEach(([k]) => { dobras[k] = num(i.dobras && i.dobras[k], 150); });
    const fotos = {};
    FOTOS.forEach(([k]) => { fotos[k] = photoUrl(i.fotos && i.fotos[k]); });
    const out = {
      date,
      altura: num(i.altura, 3),
      peso: num(i.peso, 500),
      circunferencias: circ,
      dobras,
      fotos,
      observacoes: text(i.observacoes, 2000)
    };
    const p = profile || {};
    Object.assign(out, calcularAvaliacao({ altura: out.altura, peso: out.peso, sexo: p.sexo, idade: p.idade, dobras }));
    return out;
  }

  function sanitizeProfile(input) {
    const i = input || {};
    const idade = num(i.idade, 120);
    const out = {
      idade: idade === null ? null : Math.round(idade),
      sexo: i.sexo === 'masculino' || i.sexo === 'feminino' ? i.sexo : null,
      frequenciaSemanal: (() => { const f = num(i.frequenciaSemanal, 7); return f === null ? null : Math.round(f); })()
    };
    TEXT_FIELDS.forEach(([k]) => { out[k] = text(i[k], 200); });
    YES_NO.forEach(([k]) => { out[k] = i[k] === true; });
    YES_NO_DETAIL.forEach(([k, d]) => { out[k] = i[k] === true; out[d] = out[k] ? text(i[d], 200) : null; });
    return out;
  }

  return {
    LIMITES_IMC, CIRC, CIRC_LR, DOBRAS, FOTOS, YES_NO, YES_NO_DETAIL, TEXT_FIELDS,
    calcularIMC, classificarIMC, somarDobras, percentualGorduraPollock7, calcularAvaliacao,
    sanitizeAssessment, sanitizeProfile, num
  };
});
