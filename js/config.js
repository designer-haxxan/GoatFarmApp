export const CONFIG = {
  APP_NAME: 'Bakri Farm Manager',
  APP_NAME_UR: 'بکری فارم منیجر',
  APP_ID: 'bakrifarm',
  APP_VERSION: '1.0.0',
  SCHEMA_VERSION: 1,
  BACKUP_VERSION: 1,
  AUTH_API_BASE: 'https://eposwala.com/api',
  SUPPORT_PHONE: '0302-8863131',
  // Gestation periods in days
  GESTATION: { goat: 150, sheep: 147, cattle: 285, buffalo: 315 },
};

export const CDN = {
  html5qrcode: 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
};

export const storageKey = (name) => `${CONFIG.APP_ID}.${name}`;
