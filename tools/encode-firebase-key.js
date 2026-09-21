// Prepara a chave de serviço do Firebase pra colar no Render, SEM mostrar a chave:
//   node tools/encode-firebase-key.js "C:\caminho\sobrecarga-app-...-firebase-adminsdk-....json"
// Converte para base64 e copia para a área de transferência (Windows/macOS/Linux).
const fs = require('fs');
const { spawnSync } = require('child_process');

const file = process.argv[2];
if (!file) { console.error('Uso: node tools/encode-firebase-key.js <arquivo-da-chave.json>'); process.exit(1); }

const raw = fs.readFileSync(file, 'utf8');
let cred;
try { cred = JSON.parse(raw); } catch (e) { console.error('Esse arquivo não é um JSON válido.'); process.exit(1); }
if (cred.type !== 'service_account' || !cred.private_key || !cred.client_email) {
  console.error('Esse JSON não parece ser uma chave de conta de serviço do Firebase.');
  process.exit(1);
}

const b64 = Buffer.from(JSON.stringify(cred)).toString('base64');
const cmds = process.platform === 'win32' ? [['clip']] : process.platform === 'darwin' ? [['pbcopy']] : [['xclip', '-selection', 'clipboard'], ['xsel', '-b', '-i']];
let copied = false;
for (const [cmd, ...args] of cmds) {
  const r = spawnSync(cmd, args, { input: b64 });
  if (!r.error && r.status === 0) { copied = true; break; }
}
console.log(`Projeto: ${cred.project_id}  |  conta de serviço: ${cred.client_email}`);
console.log(copied
  ? 'Chave (base64) copiada para a área de transferência. Cole no Render como FIREBASE_SERVICE_ACCOUNT_B64.'
  : 'Não consegui copiar automaticamente; salvei em firebase-key.b64.txt (apague depois de colar no Render).');
if (!copied) fs.writeFileSync('firebase-key.b64.txt', b64);
