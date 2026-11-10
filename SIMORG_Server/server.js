'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET wajib diisi (minimal 32 karakter) pada environment production.');
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('PERINGATAN: JWT_SECRET sementara dibuat otomatis. Tetapkan JWT_SECRET tetap sebelum deployment online.');
}
const db = new Database(path.join(DATA_DIR, 'simorg.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
 CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER);
 CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, created_at TEXT NOT NULL, created_by INTEGER);
 CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, nisn TEXT UNIQUE, kelas TEXT DEFAULT '', avatar TEXT DEFAULT '', created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS uploaded_files (id INTEGER PRIMARY KEY AUTOINCREMENT, original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by INTEGER, created_at TEXT NOT NULL);
`);
const now = () => new Date().toISOString();
const defaultUsers = [
 ['ketuamuhammad','ketua123','Muhammad Rizky','Ketua','0054829102','Divisi Inti','https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'],
 ['pembinadra','pembina123','Dra. Endang Rahayu, M.Pd','Pembina','19750812','Pembina Utama','https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80'],
 ['sekretarisahmad','sekretaris123','Ahmad Fauzi','Sekretaris','0054829104','Sekretariat','https://images.unsplash.com/photo-1507003211169-0a1dd722f8f2?w=100&auto=format&fit=crop&q=80'],
 ['bendaharanabila','bendahara123','Nabila Putri','Bendahara','0054829105','Keuangan','https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80'],
 ['logistikbudi','perlengkapan123','Budi Santoso','Perlengkapan','0054829106','Logistik','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80'],
 ['anggotarayhan','anggota123','Rayhan M.','Anggota','0054829107','Anggota Umum','https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&auto=format&fit=crop&q=80']
];
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (!countUsers) {
 const insert = db.prepare('INSERT INTO users(username,password_hash,name,role,nisn,kelas,avatar,created_at) VALUES(?,?,?,?,?,?,?,?)');
 const seed = db.transaction(() => defaultUsers.forEach(u => insert.run(u[0], bcrypt.hashSync(u[1], 12), u[2], u[3], u[4], u[5], u[6], now())));
 seed();
 console.warn('Akun demo SIMORG dibuat. Segera ubah password seluruh akun sebelum digunakan online.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit.' } });
function publicUser(u) { return { id:u.id, username:u.username, name:u.name, role:u.role, nisn:u.nisn, kelas:u.kelas, avatar:u.avatar }; }
function requireAuth(req,res,next) {
 const header = req.headers.authorization || '';
 const token = header.startsWith('Bearer ') ? header.slice(7) : '';
 if (!token) return res.status(401).json({error:'Silakan login terlebih dahulu.'});
 try {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(payload.sub);
  if (!user) return res.status(401).json({error:'Akun tidak aktif atau tidak ditemukan.'});
  req.user = user; next();
 } catch { return res.status(401).json({error:'Sesi berakhir. Silakan login kembali.'}); }
}
const signToken = user => jwt.sign({sub:user.id}, process.env.JWT_SECRET, {expiresIn:'12h', issuer:'simorg'});
app.get('/api/health', (_req,res)=>res.json({ok:true,service:'SIMORG Server',time:now()}));
app.post('/api/auth/login', authLimiter, async (req,res)=>{
 const {username,password}=req.body||{};
 if (!username || !password) return res.status(400).json({error:'Username dan password wajib diisi.'});
 const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').get(String(username).trim());
 if (!user || !(await bcrypt.compare(String(password),user.password_hash))) return res.status(401).json({error:'Username atau password salah.'});
 res.json({token:signToken(user),user:publicUser(user)});
});
app.post('/api/auth/qr-login', authLimiter, (req,res)=>{
 if (process.env.ENABLE_QR_LOGIN !== 'true') return res.status(403).json({error:'Login QR dinonaktifkan untuk keamanan. Silakan login menggunakan username dan password.'});
 const nisn=String((req.body||{}).nisn||'').trim();
 if (!nisn) return res.status(400).json({error:'Kode anggota tidak valid.'});
 const user=db.prepare('SELECT * FROM users WHERE nisn=? AND active=1').get(nisn);
 if (!user) return res.status(401).json({error:'Kode anggota tidak terdaftar.'});
 // QR/NISN login retained for compatibility; use password login for stronger security.
 res.json({token:signToken(user),user:publicUser(user),warning:'Login QR berbasis NISN lebih lemah daripada password.'});
});
app.post('/api/auth/register', authLimiter, async (req,res)=>{
 const {username,password,name,role,nisn,kelas,avatar}=req.body||{};
 const cleanUsername=String(username||'').trim().toLowerCase();
 if (!/^[a-z0-9._-]{4,32}$/.test(cleanUsername)) return res.status(400).json({error:'Username 4–32 karakter (huruf, angka, titik, garis bawah, atau strip).'});
 if (String(password||'').length < 8) return res.status(400).json({error:'Password minimal 8 karakter.'});
 if (!String(name||'').trim() || !String(nisn||'').trim()) return res.status(400).json({error:'Nama dan ID/NISN wajib diisi.'});
 // Registrasi publik hanya boleh membuat akun Anggota; mencegah pendaftaran diri sebagai Ketua.
 const assignedRole='Anggota';
 try {
  const info=db.prepare('INSERT INTO users(username,password_hash,name,role,nisn,kelas,avatar,created_at) VALUES(?,?,?,?,?,?,?,?)').run(cleanUsername,await bcrypt.hash(password,12),String(name).trim(),assignedRole,String(nisn).trim(),String(kelas||''),String(avatar||''),now());
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({token:signToken(user),user:publicUser(user)});
 } catch(e) { if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({error:'Username atau NISN sudah terdaftar.'}); throw e; }
});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json({user:publicUser(req.user)}));
app.post('/api/auth/change-password',requireAuth,authLimiter,async(req,res)=>{
 const {oldPassword,newPassword}=req.body||{};
 if (!await bcrypt.compare(String(oldPassword||''),req.user.password_hash)) return res.status(400).json({error:'Password lama salah.'});
 if (String(newPassword||'').length<8) return res.status(400).json({error:'Password baru minimal 8 karakter.'});
 db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(newPassword,12),req.user.id);
 res.json({ok:true});
});
app.get('/api/users',requireAuth,(req,res)=>{
 if(req.user.role!=='Ketua' && req.user.role!=='Pembina') return res.status(403).json({error:'Tidak memiliki izin.'});
 res.json(db.prepare('SELECT id,username,name,role,nisn,kelas,avatar,created_at AS createdAt,active FROM users ORDER BY id').all());
});
app.post('/api/users/import',requireAuth,async(req,res)=>{
 if(req.user.role!=='Ketua') return res.status(403).json({error:'Hanya Ketua yang dapat mengimpor akun lama.'});
 const users=Array.isArray(req.body.users)?req.body.users:[]; let imported=0;
 for(const u of users.slice(0,500)) {
  if(!u.username||!u.password||!u.name||!u.nisn) continue;
  try { db.prepare('INSERT INTO users(username,password_hash,name,role,nisn,kelas,avatar,created_at) VALUES(?,?,?,?,?,?,?,?)').run(String(u.username).toLowerCase(),await bcrypt.hash(String(u.password),12),String(u.name),['Ketua','Pembina','Sekretaris','Bendahara','Perlengkapan','Anggota'].includes(u.role)?u.role:'Anggota',String(u.nisn),String(u.kelas||''),String(u.avatar||''),now()); imported++; } catch {}
 }
 res.json({ok:true,imported});
});
app.get('/api/data',requireAuth,(req,res)=>{
 const row=db.prepare('SELECT payload,updated_at FROM app_state WHERE id=1').get();
 res.json(row?{data:JSON.parse(row.payload),updatedAt:row.updated_at}:{data:null,updatedAt:null});
});
const saveState=db.transaction((payload,timestamp,userId)=>{
 const previous=db.prepare('SELECT payload FROM app_state WHERE id=1').get();
 if(previous){ db.prepare('INSERT INTO backups(payload,created_at,created_by) VALUES(?,?,?)').run(previous.payload,timestamp,userId); db.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 100)').run(); }
 db.prepare(`INSERT INTO app_state(id,payload,updated_at,updated_by) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(payload,timestamp,userId);
});
app.put('/api/data',requireAuth,(req,res)=>{
 const data=req.body;
 if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.pengurus)||!Array.isArray(data.proja)||!Array.isArray(data.kas)) return res.status(400).json({error:'Struktur data SIMORG tidak valid.'});
 try {
  const current=db.prepare('SELECT updated_at FROM app_state WHERE id=1').get();
  const expected=req.get('If-Match') || '';
  if(current && expected !== current.updated_at) return res.status(409).json({error:'Data server telah berubah dari perangkat lain. Muat ulang aplikasi sebelum menyimpan agar perubahan terbaru tidak tertimpa.',updatedAt:current.updated_at});
  if(!current && expected) return res.status(409).json({error:'Status database berubah. Muat ulang aplikasi.'});
  const timestamp=now();saveState(JSON.stringify(data),timestamp,req.user.id);res.json({ok:true,updatedAt:timestamp});
 } catch(e){console.error(e);res.status(500).json({error:'Gagal menyimpan database.'});}
});
app.get('/api/backups',requireAuth,(req,res)=>{
 if(req.user.role!=='Ketua'&&req.user.role!=='Pembina') return res.status(403).json({error:'Tidak memiliki izin.'});
 res.json(db.prepare('SELECT id,created_at AS createdAt FROM backups ORDER BY id DESC LIMIT 100').all());
});
app.get('/api/backups/:id',requireAuth,(req,res)=>{
 if(req.user.role!=='Ketua'&&req.user.role!=='Pembina') return res.status(403).json({error:'Tidak memiliki izin.'});
 const row=db.prepare('SELECT payload,created_at FROM backups WHERE id=?').get(Number(req.params.id));
 if(!row)return res.status(404).json({error:'Backup tidak ditemukan.'});
 res.json({data:JSON.parse(row.payload),createdAt:row.created_at});
});
const storage=multer.diskStorage({destination:(_req,_file,cb)=>cb(null,UPLOAD_DIR),filename:(_req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).slice(0,12))});
const allowedMime = new Set(['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const upload=multer({storage,limits:{fileSize:20*1024*1024},fileFilter:(_req,file,cb)=>{const ok=allowedMime.has(file.mimetype);cb(ok?null:new Error('Format file tidak diizinkan.'),ok);}});
app.post('/api/files',requireAuth,upload.single('file'),(req,res)=>{
 if(!req.file)return res.status(400).json({error:'Pilih file terlebih dahulu.'});
 const info=db.prepare('INSERT INTO uploaded_files(original_name,stored_name,mime_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?)').run(req.file.originalname,req.file.filename,req.file.mimetype,req.file.size,req.user.id,now());
 res.status(201).json({id:info.lastInsertRowid,name:req.file.originalname,size:req.file.size,mimeType:req.file.mimetype,url:`/api/files/${info.lastInsertRowid}`});
});
app.get('/api/files',requireAuth,(req,res)=>res.json(db.prepare('SELECT id,original_name AS name,mime_type AS mimeType,size,created_at AS createdAt FROM uploaded_files ORDER BY id DESC').all()));
app.get('/api/files/:id',requireAuth,(req,res)=>{
 const f=db.prepare('SELECT * FROM uploaded_files WHERE id=?').get(Number(req.params.id));
 if(!f)return res.status(404).json({error:'File tidak ditemukan.'});
 res.download(path.join(UPLOAD_DIR,f.stored_name),f.original_name);
});
app.use(express.static(__dirname,{index:'index.html'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.message||'Permintaan tidak dapat diproses.'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`SIMORG berjalan pada port ${PORT}`));
