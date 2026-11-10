/**
 * Katalog permission granular. Disinkronkan ke tabel `permissions` oleh seed.
 * Tambahkan permission baru di sini; jangan hapus key yang sudah dipakai tanpa migrasi data.
 */
export const PERMISSIONS = {
  'org.read': 'Melihat informasi organisasi',
  'org.manage': 'Mengubah pengaturan organisasi',
  'members.read': 'Melihat anggota organisasi',
  'members.manage': 'Menambah, mengubah, dan menonaktifkan anggota',
  'roles.manage': 'Mengelola role dan permission',
  'websites.read': 'Melihat website dan landing page',
  'websites.manage': 'Mengelola website dan landing page',
  'offers.read': 'Melihat offer',
  'offers.manage': 'Mengelola offer',
  'affiliates.read': 'Melihat affiliate network',
  'affiliates.manage': 'Mengelola affiliate network dan token postback masuk',
  'networks.read': 'Melihat akun jaringan iklan',
  'networks.manage': 'Mengelola akun jaringan iklan',
  'networks.credentials': 'Mengatur kredensial & template postback jaringan iklan',
  'campaigns.read': 'Melihat campaign',
  'campaigns.manage': 'Membuat dan mengubah campaign',
  'conversions.read': 'Melihat konversi',
  'postbacks.read': 'Melihat log postback masuk & keluar',
  'postbacks.retry': 'Mengirim ulang postback yang gagal',
  'analytics.read': 'Melihat laporan & analitik',
  'spend.manage': 'Mencatat spend manual',
  'audit.read': 'Melihat audit log',
  'alerts.read': 'Melihat alert operasional',
  'alerts.manage': 'Mengakui (acknowledge) dan menutup alert',
  'notifications.manage': 'Mengelola channel notifikasi (Telegram)',
  'tasks.read': 'Melihat board & kartu tugas',
  'tasks.write': 'Membuat, mengubah, dan memindahkan kartu tugas',
  'tasks.approve': 'Menyetujui kartu yang butuh approval sebelum selesai',
  'boards.manage': 'Mengelola board & kolom Kanban',
  'teams.manage': 'Mengelola tim dan jabatan anggota',
  'ai.use': 'Memakai AI Assistant sesuai jabatan',
  'ai.manage': 'Mengatur model AI, budget, dan skill',
  'ai.credentials': 'Mengatur API key OpenRouter organisasi',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

const READ_BASICS: PermissionKey[] = [
  'org.read',
  'websites.read',
  'offers.read',
  'affiliates.read',
  'networks.read',
  'campaigns.read',
  'conversions.read',
  'analytics.read',
  'alerts.read',
  'tasks.read',
  'tasks.write',
  'ai.use',
];

export type SystemRoleKey =
  | 'OWNER'
  | 'TEAM_LEADER'
  | 'MEDIA_BUYER'
  | 'DATA_ANALYST'
  | 'TRACKING_SPECIALIST'
  | 'COMPLIANCE_ANALYST'
  | 'VIEWER';

export interface SystemRoleDef {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** Role admin wajib MFA bila MFA_ENFORCE_ADMIN=true */
  isAdmin: boolean;
}

/** Role sistem bawaan (Bagian B read.md). Super Admin adalah flag pada user, bukan role organisasi. */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'OWNER',
    name: 'Organization Owner',
    description: 'Akses penuh ke organisasi',
    permissions: ALL_PERMISSIONS,
    isAdmin: true,
  },
  {
    key: 'TEAM_LEADER',
    name: 'Team Leader',
    description: 'Mengelola tim, campaign, dan melihat seluruh laporan',
    permissions: ALL_PERMISSIONS.filter((p) => !['org.manage', 'roles.manage', 'networks.credentials', 'ai.credentials'].includes(p)),
    isAdmin: false,
  },
  {
    key: 'MEDIA_BUYER',
    name: 'Media Buyer',
    description: 'Mengelola campaign yang di-assign dan mencatat spend',
    permissions: [...READ_BASICS, 'campaigns.manage', 'spend.manage', 'postbacks.read', 'alerts.manage'],
    isAdmin: false,
  },
  {
    key: 'DATA_ANALYST',
    name: 'Data Analyst',
    description: 'Membaca data dan laporan',
    permissions: [...READ_BASICS, 'postbacks.read'],
    isAdmin: false,
  },
  {
    key: 'TRACKING_SPECIALIST',
    name: 'Tracking Specialist',
    description: 'Mengelola setup tracking, offer, affiliate, dan postback',
    permissions: [
      ...READ_BASICS,
      'websites.manage',
      'offers.manage',
      'affiliates.manage',
      'networks.manage',
      'networks.credentials',
      'postbacks.read',
      'postbacks.retry',
      'alerts.manage',
    ],
    isAdmin: false,
  },
  {
    key: 'COMPLIANCE_ANALYST',
    name: 'Quality & Compliance Analyst',
    description: 'Membaca data dan audit log',
    permissions: [...READ_BASICS, 'postbacks.read', 'audit.read', 'members.read'],
    isAdmin: false,
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Hanya membaca laporan',
    permissions: ['org.read', 'campaigns.read', 'analytics.read', 'tasks.read'],
    isAdmin: false,
  },
];

export const ADMIN_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.isAdmin).map((r) => r.key as string);
