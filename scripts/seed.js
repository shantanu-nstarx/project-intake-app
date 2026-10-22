const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

const { Pool } = require('pg');
const crypto = require('crypto');

const SALT_CHARS = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bcryptBase64Encode(input) {
  const standard = input.toString('base64');
  let out = '';
  for (const ch of standard) {
    const idx = STANDARD_ALPHABET.indexOf(ch);
    if (idx >= 0) {
      out += BCRYPT_ALPHABET[idx];
    } else if (ch === '=') {
      out += '';
    } else {
      out += ch;
    }
  }
  return out;
}

function hashPassword(password) {
  let salt = '';
  for (let i = 0; i < 22; i++) {
    salt += SALT_CHARS[Math.floor(Math.random() * SALT_CHARS.length)];
  }
  const derived = crypto.scryptSync(password, salt, 24, { N: 1024, r: 1, p: 1 });
  const encoded = bcryptBase64Encode(derived);
  return `$2b$10$${salt}${encoded.slice(0, 31)}`;
}

function verifyPassword(password, hash) {
  if (!hash.startsWith('$2b$10$')) return false;
  const body = hash.slice('$2b$10$'.length);
  if (body.length < 22) return false;
  const salt = body.slice(0, 22);
  const stored = body.slice(22);
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, 24, { N: 1024, r: 1, p: 1 });
  } catch {
    return false;
  }
  const encoded = bcryptBase64Encode(derived).slice(0, stored.length);
  if (stored.length !== encoded.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(encoded));
  } catch {
    return false;
  }
}

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? true : false,
});

const admins = [
  { email: 'shantanu.chaturvedi@nstarxinc.com', name: 'Shantanu', password: process.env.ADMIN_SHANTANU_PASSWORD },
  { email: 'sujay@nstarxinc.com', name: 'Sujay', password: process.env.ADMIN_SUJAY_PASSWORD },
];

async function main() {
  for (const admin of admins) {
    if (!admin.password) {
      throw new Error(`Missing password env for ${admin.email}`);
    }
    const hash = hashPassword(admin.password);
    const ok = verifyPassword(admin.password, hash);
    console.log(`hash ok for ${admin.email}:`, ok, hash.slice(0, 40) + '...');
    await pool.query(
      'INSERT INTO admin_users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name',
      [admin.email, admin.name, hash]
    );
    console.log(`Seeded admin ${admin.email}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
