// index.js - ملف واحد كامل
const express = require('express')
const axios = require('axios')
const fs = require('fs')
const pino = require('pino')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')

const app = express()
app.use(express.json())

let sock = null
let isConnected = false
let queue = []
let isProcessing = false

const HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ربط البوت</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:sans-serif}
  body{background:#0f0f0f;color:white;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px}
  .card{background:#1e1e1e;width:100%;max-width:400px;padding:25px;border-radius:20px;border:1px solid #333;text-align:center}
  h1{font-size:22px} p{color:#aaa;font-size:13px;margin:8px 0 20px}
  input{width:100%;padding:14px;background:#2a2a2a;border:1px solid #444;border-radius:12px;color:white;font-size:16px;outline:none;text-align:center}
  input:focus{border-color:#25D366}
  button{width:100%;padding:14px;margin-top:15px;background:#25D366;color:#000;font-weight:bold;border:none;border-radius:12px;font-size:16px;cursor:pointer}
  .code-box{display:none;margin-top:20px;background:#111;border:2px dashed #25D366;padding:20px;border-radius:15px}
  .code-box h2{font-size:34px;letter-spacing:6px;color:#25D366;margin:10px 0}
  .status{padding:10px;border-radius:20px;background:#333;font-size:13px;margin-bottom:15px}
  .status.on{background:#12381f;color:#7dff9a}
  .info{background:#2a2a2a;padding:12px;border-radius:10px;margin-top:15px;font-size:12px;line-height:1.7;color:#ccc;text-align:right}
</style>
</head>
<body>
<div class="card">
  <h1>📱 ربط البوت</h1>
  <p>مرة وحدة فقط، و كيبقى محفوظ</p>
  <div id="status" class="status">🔴 ما مربوطش</div>
  <input id="phone" type="tel" placeholder="0612345678">
  <button id="btn" onclick="getCode()">جيب كود الربط - 8 أرقام</button>
  <div id="codeBox" class="code-box">
    <p>دخل هاد الكود فواتساب:</p>
    <h2 id="pairCode">--------</h2>
    <p>WhatsApp > الإعدادات > الأجهزة المرتبطة > ربط بالرقم</p>
  </div>
  <div class="info">
    ✅ من بعد الربط، البوت كيخدم بوحدو<br>
    ✅ المستخدمين كيصيفطو فالخاص فقط: <b>.apk tiktok</b><br>
    ✅ إلا كان الملف كتر من 100MB، كيقول ليهم لا يمكن<br>
    ✅ الطابور: 15 واحد فدقة وحدة
  </div>
</div>
<script>
async function getCode(){
  const phone=document.getElementById('phone').value
  if(!phone) return alert('دخل النمرة')
  const btn=document.getElementById('btn'); btn.textContent='كنجيب الكود...'; btn.disabled=true
  const res=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})})
  const data=await res.json()
  if(data.code==='ALREADY_CONNECTED'){
    document.getElementById('status').textContent='🟢 مربوط من قبل - البوت خدام'
    document.getElementById('status').className='status on'
    btn.textContent='مربوط ✅'; return
  }
  document.getElementById('codeBox').style.display='block'
  document.getElementById('pairCode').textContent=data.code
  btn.textContent='جيب كود الربط - 8 أرقام'; btn.disabled=false
  const it=setInterval(async()=>{
    const r=await fetch('/api/status'); const d=await r.json()
    if(d.connected){ document.getElementById('status').textContent='🟢 تربط! البوت خدام دابا'; document.getElementById('status').className='status on'; clearInterval(it) }
  },3000)
}
</script>
</body>
</html>`

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Bot APK", "Chrome", "1.0"]
    })
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            isConnected = true
            console.log('✅ البوت مربوط و خدام')
        }
        if (connection === 'close') {
            isConnected = false
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue
            const from = msg.key.remoteJid
            if (from.endsWith('@g.us')) continue
            if (from.endsWith('@broadcast') || from.endsWith('@newsletter')) continue
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
            if (!text.startsWith('.apk')) continue
            const appName = text.replace('.apk', '').trim()
            if (!appName) {
                await sock.sendMessage(from, { text: 'كتب هكا: .apk tiktok' })
                continue
            }
            queue.push({ from, appName })
            if (queue.length > 1) {
                await sock.sendMessage(from, { text: `⏳ كاين ${queue.length - 1} واحد قبلك، دورك جاي...` })
            }
            processQueue()
        }
    })
}

async function searchApp(appName) {
    try {
        const url = `https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(appName)}&limit=3`
        const res = await axios.get(url)
        const a = res.data.datalist.list[0]
        if (!a) return null
        return {
            name: a.name,
            package: a.package,
            sizeMB: a.size / 1024 / 1024,
            sizeText: (a.size / 1024 / 1024).toFixed(1) + " MB",
            downloads: a.stats.downloads,
            icon: a.icon,
            downloadLink: a.file.path,
            version: a.file.vername
        }
    } catch (e) { return null }
}

async function processQueue() {
    if (isProcessing) return
    isProcessing = true
    while (queue.length > 0) {
        const item = queue.shift()
        try {
            await sock.sendPresenceUpdate('composing', item.from)
            await new Promise(r => setTimeout(r, 1500))
            const app = await searchApp(item.appName)
            if (!app) {
                await sock.sendMessage(item.from, { text: `❌ ما لقيتش "${item.appName}"، جرب تكتبو بالانجليزية\nمثال: .apk whatsapp` })
                continue
            }
            if (app.sizeMB > 100) {
                await sock.sendMessage(item.from, {
                    image: { url: app.icon },
                    caption: `📱 *${app.name}*\n\n📦 النسخة: ${app.version}\n💾 الحجم: ${app.sizeText}\n⬇️ التحميلات: ${app.downloads}\n\n❌ *لا يمكن تحميل ملفات أكثر من 100 ميغا*\nالملف ديال هاد التطبيق كبير بزاف باش نصيفطو ليك فواتساب.\n\n🔗 حملو من هنا نيشان:\n${app.downloadLink}`
                })
            } else {
                await sock.sendMessage(item.from, { text: `⏳ كانحمل ليك *${app.name}* - ${app.sizeText} ... تسنى شوية` })
                const response = await axios.get(app.downloadLink, { responseType: 'stream' })
                const filePath = `./${app.package}.apk`
                const writer = fs.createWriteStream(filePath)
                response.data.pipe(writer)
                await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject) })
                await sock.sendMessage(item.from, {
                    document: { url: filePath },
                    fileName: `${app.name}.apk`,
                    mimetype: 'application/vnd.android.package-archive',
                    caption: `📱 *${app.name}*\n📦 ${app.version} | 💾 ${app.sizeText}\n✅ هاهو التطبيق ديالك`
                })
                fs.unlinkSync(filePath)
            }
        } catch (e) {
            console.log('خطأ:', e.message)
            await sock.sendMessage(item.from, { text: 'وقع شي مشكل، عاود جرب' }).catch(()=>{})
        }
        const wait = Math.floor(Math.random() * 1000) + 2000
        await new Promise(r => setTimeout(r, wait))
    }
    isProcessing = false
}

app.get('/', (req, res) => res.send(HTML))

app.post('/api/pair', async (req, res) => {
    const { phone } = req.body
    let clean = phone.replace(/[^0-9]/g, '')
    if (clean.startsWith('0')) clean = '212' + clean.slice(1)
    if (!clean.startsWith('212')) clean = '212' + clean
    if (!sock) await startBot()
    await new Promise(r => setTimeout(r, 2000))
    if (sock.authState.creds.registered) {
        return res.json({ code: 'ALREADY_CONNECTED' })
    }
    try {
        const code = await sock.requestPairingCode(clean)
        res.json({ code })
    } catch (e) {
        res.json({ code: null, error: 'عاود جرب' })
    }
})

app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, queue: queue.length })
})

startBot()
app.listen(3000, () => console.log('🚀 خدام على http://localhost:3000'))
