import type { Position, SkillRisk } from '@prisma/client';

export interface BuiltinSkill {
  key: string;
  name: string;
  category: string;
  positions: Position[];
  riskClass: SkillRisk;
  tools: string[];
  skillMd: string;
}

/** Nama AI Assistant per jabatan (read.md 19.1). */
export const AGENT_NAME: Record<Position, string> = {
  ADS_MANAGER: 'Strategy Agent',
  MEDIA_BUYER: 'Media Buyer Agent',
  ADS_ANALYST: 'Analytics Agent',
  TRACKING_SPECIALIST: 'Tracking Agent',
  FRAUD_ANALYST: 'Fraud Agent',
  CREATIVE_SPECIALIST: 'Creative Agent',
  LANDING_PAGE_SPECIALIST: 'CRO Agent',
  AUTOMATION_SPECIALIST: 'Automation Agent',
};

const md = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;

/**
 * Skill internal per jabatan (read.md 18.5). Ditulis sendiri — bukan hasil impor — sehingga langsung berstatus APPROVED.
 * Admin dapat membuat versi baru; versi baru wajib direview sebelum aktif.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    key: 'strategy-review',
    name: 'Strategy review',
    category: 'strategi',
    positions: ['ADS_MANAGER'],
    riskClass: 'DRAFT',
    tools: ['list_campaigns', 'campaign_performance', 'list_alerts', 'my_tasks', 'propose_task'],
    skillMd: md(
      'strategy-review',
      'Ringkas profitabilitas portofolio, risiko, dan prioritas tim untuk Ads Manager.',
      `
## Kapan dipakai
Pertanyaan tentang kondisi bisnis, alokasi budget, campaign mana yang di-scale/di-stop, atau prioritas tim.

## Langkah
1. Ambil performa per campaign untuk 7 hari terakhir (dan 7 hari sebelumnya bila perlu pembanding).
2. Urutkan berdasarkan profit; tandai campaign rugi dengan spend berarti dan campaign untung yang stabil.
3. Periksa alert terbuka yang memengaruhi kepercayaan data (selisih rekonsiliasi, postback gagal).
4. Beri maksimal 3 rekomendasi, masing-masing dengan angka pendukung dan tingkat keyakinan.
5. Untuk tindakan, buat draft task (propose_task) yang ditujukan ke jabatan yang tepat. Perubahan budget/bid/status adalah aksi berisiko: hanya usulan, keputusan di tangan manusia.

## Batasan
Jangan menyimpulkan dari sampel kecil (< 30 klik atau < 3 konversi): sebut "data belum cukup".
`,
    ),
  },
  {
    key: 'media-buying-optimizer',
    name: 'Media buying optimizer',
    category: 'media buying',
    positions: ['MEDIA_BUYER'],
    riskClass: 'DRAFT',
    tools: ['list_campaigns', 'campaign_performance', 'propose_task'],
    skillMd: md(
      'media-buying-optimizer',
      'Analisis CPA/CPC/ROI per campaign, zone, dan negara untuk optimasi bid dan budget.',
      `
## Langkah
1. Mulai dari performa campaign; lalu pecah per zone dan negara untuk campaign yang dibahas.
2. Kandidat blacklist zone: spend ≥ 2× target CPA tanpa konversi VERIFIED. Kandidat whitelist: ROI positif dengan ≥ 3 konversi.
3. Bedakan spend dari jaringan (reported) dan estimasi.
4. Usulan perubahan bid/budget ditulis sebagai draft task berisi nilai sekarang, usulan, dan alasan.

## Batasan
Tidak ada perubahan langsung ke jaringan iklan. Jangan sarankan scaling dari satu hari data.
`,
    ),
  },
  {
    key: 'performance-analysis',
    name: 'Performance analysis',
    category: 'analitik',
    positions: ['ADS_ANALYST'],
    riskClass: 'READ_ONLY',
    tools: ['list_campaigns', 'campaign_performance'],
    skillMd: md(
      'performance-analysis',
      'Analisis tren, funnel, dan segmentasi performa dengan kehati-hatian statistik.',
      `
## Langkah
1. Tentukan pertanyaan, rentang tanggal, dan dimensi (day untuk tren; country/device/os/zone untuk segmentasi).
2. Laporkan angka absolut di samping rasio (CR, CPA, ROI).
3. Untuk perbandingan, sebut ukuran sampel dan apakah selisihnya bermakna.
4. Tutup dengan temuan utama dan pertanyaan lanjutan yang perlu dicek.

## Batasan
Revenue hanya dari konversi VERIFIED. Jangan mengekstrapolasi di luar rentang data.
`,
    ),
  },
  {
    key: 'tracking-diagnostics',
    name: 'Tracking diagnostics',
    category: 'tracking',
    positions: ['TRACKING_SPECIALIST'],
    riskClass: 'DRAFT',
    tools: ['postback_health', 'list_alerts', 'list_campaigns', 'propose_task'],
    skillMd: md(
      'tracking-diagnostics',
      'Diagnosa postback S2S, konversi OBSERVED vs VERIFIED, dan insiden tracking.',
      `
## Langkah
1. Cek postback_health 7 hari: rasio postback keluar DELIVERED vs FAILED/DEAD, postback masuk UNKNOWN_CLICK/INVALID.
2. Hubungkan dengan alert terbuka (postback gagal, DNS domain, sinkronisasi).
3. Susun dugaan penyebab berurutan dari yang paling mungkin, masing-masing dengan cara verifikasinya.
4. Buat draft task insiden bila ada masalah yang belum ditangani.

## Batasan
Jangan meminta atau menampilkan token/secret. Konversi OBSERVED bukan bukti konversi.
`,
    ),
  },
  {
    key: 'traffic-quality-review',
    name: 'Traffic quality review',
    category: 'fraud',
    positions: ['FRAUD_ANALYST'],
    riskClass: 'DRAFT',
    tools: ['list_campaigns', 'campaign_performance', 'propose_task'],
    skillMd: md(
      'traffic-quality-review',
      'Temukan pola traffic mencurigakan per zone/negara/device sebagai temuan berbukti, bukan vonis.',
      `
## Langkah
1. Bandingkan per zone: klik tinggi dengan CR nol, porsi bot click, lonjakan mendadak per hari.
2. Setiap temuan wajib memuat: entitas, metrik pembanding, ukuran sampel, dan penjelasan alternatif yang wajar.
3. Usulkan investigasi atau blacklist sebagai draft task untuk diverifikasi manusia.

## Batasan
Jangan menyatakan "fraud" tanpa bukti yang cukup. Gunakan istilah "mencurigakan, perlu verifikasi".
`,
    ),
  },
  {
    key: 'creative-insights',
    name: 'Creative insights',
    category: 'creative',
    positions: ['CREATIVE_SPECIALIST'],
    riskClass: 'READ_ONLY',
    tools: ['list_campaigns', 'campaign_performance'],
    skillMd: md(
      'creative-insights',
      'Ide dan evaluasi creative push/in-page/native berdasarkan performa campaign.',
      `
## Langkah
1. Lihat tren CR per hari untuk mendeteksi creative fatigue (penurunan bertahap dengan volume stabil).
2. Beri ide variasi judul/teks yang patuh kebijakan jaringan: tanpa klaim menyesatkan, tanpa meniru notifikasi sistem.
3. Sarankan desain A/B test: satu variabel per pengujian dan target ukuran sampel.
`,
    ),
  },
  {
    key: 'landing-cro',
    name: 'Landing page CRO',
    category: 'cro',
    positions: ['LANDING_PAGE_SPECIALIST'],
    riskClass: 'DRAFT',
    tools: ['list_campaigns', 'campaign_performance', 'propose_task'],
    skillMd: md(
      'landing-cro',
      'Optimasi konversi landing page: perbandingan landing, device, dan rencana eksperimen.',
      `
## Langkah
1. Bandingkan landing (groupBy landing) dan device untuk campaign terkait.
2. Identifikasi segmen dengan CR jauh di bawah rata-rata dan volume cukup.
3. Usulkan eksperimen (hipotesis, varian, metrik utama, durasi minimum) sebagai draft task.
`,
    ),
  },
  {
    key: 'automation-ops',
    name: 'Automation operations',
    category: 'automation',
    positions: ['AUTOMATION_SPECIALIST'],
    riskClass: 'DRAFT',
    tools: ['list_alerts', 'postback_health', 'propose_task'],
    skillMd: md(
      'automation-ops',
      'Pantau keandalan integrasi, alert, dan retry; usulkan aturan automation yang aman.',
      `
## Langkah
1. Rangkum alert terbuka per jenis dan frekuensi.
2. Cek postback gagal dan pola retry.
3. Usulkan perbaikan atau aturan automation sebagai draft task, lengkap dengan kondisi pemicu dan batas aman.

## Batasan
Aturan yang mengubah campaign wajib melalui approval Ads Manager.
`,
    ),
  },
];
