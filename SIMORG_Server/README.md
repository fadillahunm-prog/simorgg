# SIMORG Online — paket deployment

Paket ini menyiapkan SIMORG untuk dipasang pada hosting Node.js. Data organisasi, akun, sesi autentikasi, riwayat backup, dan file dokumen disimpan di server. Browser hanya menyimpan token sesi dan salinan sementara data untuk membantu migrasi.

## Fitur versi online

- Database SQLite persisten (`data/simorg.sqlite`) dengan mode WAL.
- Login server menggunakan password yang di-hash (bcrypt), token sesi 12 jam, pembatasan percobaan login, dan endpoint yang memerlukan autentikasi.
- Pendaftaran akun tersimpan di database server (pendaftaran publik otomatis diberi peran Anggota).
- Penggantian password melalui server.
- Data SIMORG disimpan terpusat dan versi sebelumnya dibackup otomatis (maksimal 100 snapshot).
- API unggah dokumen (PDF, gambar, Word, Excel; maksimal 20 MB per file) ke `data/uploads`.
- Health-check di `/api/health`.

## Persiapan hosting online

Pilih layanan hosting yang mendukung **Node.js 20+** dan menyediakan **persistent disk/volume**. File `render.yaml` dan `Dockerfile` disertakan sebagai contoh konfigurasi deployment. Jangan gunakan penyimpanan filesystem sementara/ephemeral karena database dapat hilang saat aplikasi restart atau redeploy.

1. Unggah folder proyek ini ke layanan hosting (atau hubungkan repository Git).
2. Atur build/install command: `npm install`.
3. Atur start command: `npm start`.
4. Tambahkan environment variables:
   - `NODE_ENV=production`
   - `JWT_SECRET` = string acak panjang minimal 32 karakter (jangan gunakan contoh).
   - `DATA_DIR` = lokasi mount persistent disk, misalnya `/var/data` (sesuaikan petunjuk provider).
   - `PORT` biasanya diisi otomatis oleh provider.
5. Kaitkan persistent disk/volume ke `DATA_DIR`.
6. Deploy, lalu buka domain HTTPS yang diberikan hosting. Pastikan `/api/health` menghasilkan `{"ok":true,...}`.

> Saya belum menerbitkan aplikasi ke domain publik karena akun hosting, persistent disk, dan domain belum diberikan/dihubungkan. Jangan menaruh `JWT_SECRET` di file HTML atau repository publik.

## Akun awal

Database pertama kali dibuat dengan akun demo berikut. **Segera login dan ganti password masing-masing sebelum mengundang anggota atau memasukkan data asli.** Password disimpan dalam bentuk hash pada database.

| Peran | Username | Password awal |
|---|---|---|
| Ketua | `ketuamuhammad` | `ketua123` |
| Pembina | `pembinadra` | `pembina123` |
| Sekretaris | `sekretarisahmad` | `sekretaris123` |
| Bendahara | `bendaharanabila` | `bendahara123` |
| Perlengkapan | `logistikbudi` | `perlengkapan123` |
| Anggota | `anggotarayhan` | `anggota123` |

Password awal tersebut hanya untuk bootstrap/demo. Ganti segera. Pendaftaran akun baru saat ini terbuka tetapi akun publik otomatis mendapat peran Anggota. Peran khusus tidak dapat dipilih dari form pendaftaran publik.

## Migrasi data lama

1. Sebelum berpindah, jangan hapus data browser lama dan jangan bersihkan cache/localStorage.
2. Login ke versi server dari browser/perangkat yang selama ini menyimpan data SIMORG. Jika database server masih kosong, aplikasi mengambil `SIMORG_DATA` lokal lalu mengirimkannya ke server.
3. Untuk migrasi akun lama, login menggunakan akun Ketua di browser lama. Aplikasi akan mencoba mengimpor akun `SIMORG_USERS` lama ke database server. Akun dengan username/NISN yang sudah ada akan dilewati.
4. Setelah migrasi, buka SIMORG dari perangkat lain dan login. Periksa jumlah anggota, program kerja, agenda, kas, dan data lain sebelum mulai mengedit.

## Penyimpanan dokumen

Data arsip/metadata dokumen yang sudah ada pada aplikasi ikut tersimpan sebagai bagian dari data SIMORG. Server juga menyediakan endpoint unggah file nyata (`POST /api/files`, multipart field `file`) dan unduh (`GET /api/files/:id`). Antarmuka HTML saat ini belum menghubungkan tombol arsip ke endpoint unggah tersebut; integrasi tombol unggah dapat ditambahkan setelah alur berkas yang diinginkan dipastikan.

## Backup dan pemulihan

- Database: `DATA_DIR/simorg.sqlite` beserta file pendamping SQLite saat server aktif.
- File unggahan: `DATA_DIR/uploads/`.
- Snapshot data otomatis: maksimal 100 versi terakhir, dapat dilihat melalui `/api/backups` dan dibaca melalui `/api/backups/:id` (login Ketua/Pembina). Server memakai pemeriksaan versi (`If-Match`) agar perubahan dari perangkat lain tidak diam-diam menimpa data yang lebih baru; jika konflik, muat ulang aplikasi sebelum mengulangi perubahan. Endpoint baca backup tersedia; proses restore belum dipasang sebagai tombol antarmuka agar pemulihan tidak dilakukan tanpa konfirmasi.
- Aktifkan backup terjadwal dari provider atau salin volume database dan folder uploads ke lokasi terpisah. Uji pemulihan backup secara berkala.

## Catatan keamanan penting

- Endpoint data dan file membutuhkan token login server.
- Login QR berbasis NISN dinonaktifkan secara default untuk keamanan. Login password menjadi metode utama. Jangan aktifkan `ENABLE_QR_LOGIN=true` pada server publik karena NISN mudah diketahui/ditebak.
- Hak akses menu pada antarmuka lama sebagian besar merupakan pembatasan tampilan; endpoint data bersama mengharuskan login, tetapi pembatasan edit per modul/role belum sepenuhnya diterapkan di server. Jangan simpan data yang membutuhkan kerahasiaan tinggi sebelum audit izin per modul.
- Gunakan HTTPS, persistent disk, password unik, dan backup eksternal. Jangan publikasikan akun demo.
