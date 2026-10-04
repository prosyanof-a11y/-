'use strict';
/* Снять ОДНО живое сообщение из ядра (office WebSocket) и напечатать его.
 * Ключ берётся из переменной окружения OFFICE_KEY (его спрашивает .bat-файл),
 * либо можно задать здесь в CONFIG. Ничего больше менять не нужно. */

const CONFIG = {
  url: 'wss://ai-trading-team-ctrader-production.up.railway.app/ws/office',
  key: process.env.OFFICE_KEY || ''   // ← .bat подставит сюда то, что вы введёте
};

let WebSocket;
try { WebSocket = require('ws'); }
catch { console.error('Нет модуля ws. Запустите: npm install ws'); process.exit(1); }

if (!CONFIG.key) { console.error('Не задан office-ключ (OFFICE_KEY).'); process.exit(1); }

const ws = new WebSocket(CONFIG.url, { headers: { 'X-Office-Key': CONFIG.key }, handshakeTimeout: 12000 });
const timer = setTimeout(() => { console.error('Нет сообщения 15с — проверьте ключ/сеть/VPN.'); process.exit(2); }, 15000);

ws.on('open', () => console.error('Подключено к ядру, ждём сообщение…'));
ws.on('message', (d) => {
  clearTimeout(timer);
  console.error('\n===== СКОПИРУЙТЕ ВСЁ, ЧТО НИЖЕ, И ВСТАВЬТЕ В ЧАТ =====\n');
  console.log(d.toString());                 // сам JSON — в stdout
  console.error('\n===== КОНЕЦ =====');
  try { ws.close(); } catch {}
  process.exit(0);
});
ws.on('error', (e) => { clearTimeout(timer); console.error('Ошибка:', e.message); process.exit(1); });
