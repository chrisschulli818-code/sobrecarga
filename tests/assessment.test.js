const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const A = require('../lib/assessment');

const sete = v => ({ triceps: v, peito: v, axilarMedia: v, subescapular: v, abdominal: v, supraIliaca: v, coxa: v });

test('IMC e classificação (OMS)', () => {
  assert.strictEqual(A.calcularIMC(1.75, 70), 22.86);
  assert.strictEqual(A.calcularIMC(0, 70), null);
  assert.strictEqual(A.calcularIMC(null, 70), null);
  const c = A.classificarIMC;
  assert.strictEqual(c(18.4), 'Abaixo do peso');
  assert.strictEqual(c(18.5), 'Peso normal');
  assert.strictEqual(c(25), 'Sobrepeso');
  assert.strictEqual(c(30), 'Obesidade Grau I');
  assert.strictEqual(c(35), 'Obesidade Grau II');
  assert.strictEqual(c(40), 'Obesidade Grau III');
  assert.strictEqual(c(null), null);
});

test('Pollock 7 dobras + Siri (mesmo caso do projeto original)', () => {
  // Homem, 30 anos, soma 100 mm ≈ 14–18 %
  const r = A.calcularAvaliacao({
    altura: 1.8, peso: 80, sexo: 'masculino', idade: 30,
    dobras: { triceps: 14, peito: 14, axilarMedia: 14, subescapular: 15, abdominal: 15, supraIliaca: 14, coxa: 14 }
  });
  assert.ok(r.percentualGordura > 14 && r.percentualGordura < 18, String(r.percentualGordura));
  assert.strictEqual(Math.round((r.massaGorda + r.massaMagra) * 100) / 100, 80);
  // mulher dá mais gordura que homem com as mesmas dobras e idade
  const f = A.calcularAvaliacao({ altura: 1.7, peso: 65, sexo: 'feminino', idade: 30, dobras: sete(15) });
  const m = A.calcularAvaliacao({ altura: 1.7, peso: 65, sexo: 'masculino', idade: 30, dobras: sete(15) });
  assert.ok(f.percentualGordura > m.percentualGordura);
});

test('sem as 7 dobras, sem idade ou sem sexo: não inventa % de gordura', () => {
  const base = { altura: 1.7, peso: 70, sexo: 'masculino', idade: 30, dobras: sete(12) };
  assert.ok(A.calcularAvaliacao(base).percentualGordura > 0);
  assert.strictEqual(A.calcularAvaliacao({ ...base, dobras: { ...sete(12), coxa: null } }).percentualGordura, null);
  assert.strictEqual(A.calcularAvaliacao({ ...base, idade: null }).percentualGordura, null);
  assert.strictEqual(A.calcularAvaliacao({ ...base, sexo: null }).percentualGordura, null);
  assert.strictEqual(A.calcularAvaliacao({ ...base, sexo: null }).imc, 24.22);
});

test('sanitizeAssessment recalcula e ignora o que o cliente manda pronto', () => {
  const out = A.sanitizeAssessment({
    date: '2026-09-01', altura: '1,80', peso: '80', imc: 999, percentualGordura: 1, massaMagra: 1, classificacaoImc: 'x', lixo: 1,
    dobras: { triceps: 14, peito: 14, axilarMedia: 14, subescapular: 15, abdominal: 15, supraIliaca: 14, coxa: 14 },
    circunferencias: { cintura: '80,5', bracoNormal: { esquerdo: '30', direito: 'abc' } }
  }, { sexo: 'masculino', idade: 30 });
  assert.strictEqual(out.imc, 24.69);
  assert.strictEqual(out.classificacaoImc, 'Peso normal');
  assert.ok(out.percentualGordura > 14 && out.percentualGordura < 18);
  assert.strictEqual(out.circunferencias.cintura, 80.5);
  assert.deepStrictEqual(out.circunferencias.bracoNormal, { esquerdo: 30, direito: null });
  assert.strictEqual(out.lixo, undefined);
});

test('sanitizeAssessment: números absurdos, data inválida e fotos perigosas', () => {
  const out = A.sanitizeAssessment({
    date: 'ontem', altura: 99, peso: -5,
    fotos: { anterior: 'javascript:alert(1)', posterior: 'data:text/html,<script>', ladoEsquerdo: 'ftp://x/y', ladoDireito: 'https://exemplo.com/a.jpg' },
    observacoes: 'oi\u0000\u0007 tudo bem'
  }, {});
  assert.strictEqual(out.date, null);
  assert.strictEqual(out.altura, null);
  assert.strictEqual(out.peso, null);
  assert.deepStrictEqual(out.fotos, { anterior: null, posterior: null, ladoEsquerdo: null, ladoDireito: 'https://exemplo.com/a.jpg' });
  assert.ok(!/[\u0000\u0007]/.test(out.observacoes));
});

test('sanitizeProfile: só campos conhecidos, sim/não de verdade, detalhe só quando marcado', () => {
  const p = A.sanitizeProfile({ idade: '29', sexo: 'feminino', frequenciaSemanal: 9, objetivo: ' Hipertrofia ', fuma: true, consomeAlcool: 'sim',
    fezCirurgias: false, cirurgiasDetalhe: 'não deveria ficar', temDorEmMovimento: true, dorEmMovimentoDetalhe: 'Ombro', admin: true });
  assert.strictEqual(p.idade, 29);
  assert.strictEqual(p.frequenciaSemanal, null, 'mais de 7 dias por semana é inválido');
  assert.strictEqual(A.sanitizeProfile({ frequenciaSemanal: '4' }).frequenciaSemanal, 4);
  assert.strictEqual(p.objetivo, 'Hipertrofia');
  assert.strictEqual(p.fuma, true);
  assert.strictEqual(p.consomeAlcool, false);
  assert.strictEqual(p.cirurgiasDetalhe, null);
  assert.strictEqual(p.dorEmMovimentoDetalhe, 'Ombro');
  assert.strictEqual(p.admin, undefined);
  assert.strictEqual(A.sanitizeProfile({ sexo: 'outro' }).sexo, null);
});

test('o mesmo arquivo funciona no navegador (window.Assessment) com o mesmo resultado', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assessment.js'), 'utf8');
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.ok(ctx.self.Assessment, 'expõe self.Assessment');
  const a = ctx.self.Assessment.calcularAvaliacao({ altura: 1.8, peso: 80, sexo: 'masculino', idade: 30, dobras: sete(14) });
  assert.strictEqual(a.percentualGordura, A.calcularAvaliacao({ altura: 1.8, peso: 80, sexo: 'masculino', idade: 30, dobras: sete(14) }).percentualGordura);
});
