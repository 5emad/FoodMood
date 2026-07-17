#!/usr/bin/env node
/**
 * تست قطعی دیتابیس و نمایش صفحه «در دسترس نیست»
 * پیش‌نیاز: سرور با ALLOW_SYSTEM_TEST=true در حال اجرا باشد
 *   Windows: $env:ALLOW_SYSTEM_TEST='true'; npm start
 *   Linux:   ALLOW_SYSTEM_TEST=true npm start
 */
const http = require('http');

const BASE = process.env.APP_BASE || 'http://localhost:3000';
const SECONDS = Number(process.env.OUTAGE_SECONDS || 20);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        Origin: BASE,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fetchHtml(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('▶ بررسی وضعیت فعلی...');
  const before = await request('GET', '/api/system/health');
  console.log(`  health: ${before.status}`, before.body?.data?.healthy ?? before.body);

  console.log(`\n▶ قطع دیتابیس برای ${SECONDS} ثانیه...`);
  const trigger = await request('POST', '/api/system/test-disconnect-db', { seconds: SECONDS });
  if (!trigger.body?.success) {
    console.error('✗ تست ناموفق:', trigger.body?.message || trigger.body);
    console.error('  سرور را با ALLOW_SYSTEM_TEST=true اجرا کنید.');
    process.exit(1);
  }
  console.log(' ', trigger.body.message);

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n▶ بررسی صفحه کاربر (باید FOODMOOD و «در دسترس نیست» باشد)...');
  const page = await fetchHtml('/login');
  const hasBrand = page.html.includes('FOODMOOD');
  const hasMsg = page.html.includes('در دسترس نمی') || page.html.includes('unavail-');
  const is503 = page.status === 503;

  console.log(`  HTTP ${page.status} | FOODMOOD: ${hasBrand ? '✓' : '✗'} | پیام قطعی: ${hasMsg ? '✓' : '✗'}`);

  if ((is503 || hasBrand) && hasMsg) {
    console.log('\n✓ تست موفق — صفحه آرامش‌بخش نمایش داده می‌شود.');
  } else {
    console.log('\n✗ صفحه مورد انتظار نمایش داده نشد.');
    process.exit(1);
  }

  console.log(`\n▶ منتظر بازیابی (${SECONDS}s)...`);
  await new Promise((r) => setTimeout(r, (SECONDS + 3) * 1000));

  const after = await request('GET', '/api/system/health');
  console.log(`  health پس از بازیابی: ${after.status}`, after.body?.data?.healthy ?? after.body);
  if (after.body?.data?.lifecycle) {
    const lc = after.body.data.lifecycle;
    console.log(`  آمار: استارت=${lc.serverStarts} استاپ=${lc.serverStops} اتصال=${lc.dbConnects} قطع=${lc.dbDisconnects}`);
  }
  console.log('\n✓ پایان تست. لاگ‌ها را در پنل سوپرادمین → امنیت → لاگ‌های سیستمی ببینید.');
}

main().catch((err) => {
  console.error('خطا:', err.message);
  process.exit(1);
});
