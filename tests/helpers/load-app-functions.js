// O app é um arquivo só de JS de navegador (sem exports), então pra testar as
// funções puras (leitor de PDF etc.) a gente recorta o código-fonte delas do
// app.js e roda num contexto isolado, sem DOM.
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`^function ${name}\\s*\\(`, 'm'));
  if (start < 0) throw new Error(`função ${name} não encontrada`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`fim da função ${name} não encontrado`);
}

function loadFunctions(names) {
  const file = path.join(__dirname, '..', '..', 'app.js');
  const source = fs.readFileSync(file, 'utf8');
  const code = names.map(n => extractFunction(source, n)).join('\n\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.exports = { ${names.join(', ')} };`, ctx);
  return ctx.exports;
}

module.exports = { loadFunctions, extractFunction };
