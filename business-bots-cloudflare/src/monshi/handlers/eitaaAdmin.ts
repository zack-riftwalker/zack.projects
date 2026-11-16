/** Owner commands to connect Monshi to an Eitaa account: /eitaa, /eitaa_login <phone>, /eitaa_code <code>, /eitaa_logout. */
import { API_HASH, API_ID, call, newImei } from '../eitaa/client';
import { clearSession, loadSession, LOGIN_KEY, saveSession } from '../eitaa/session';
import type { MonshiCtx } from '../types';
import { commandArgs } from './common';

const HELP =
  'اتصال منشی به ایتا:\n' +
  '۱) /eitaa_login 09xxxxxxxxx — کد ورود داخل اپ ایتا می‌آید\n' +
  '۲) /eitaa_code 12345 — ورود (پیام حاوی کد بعد از استفاده پاک می‌شود)\n' +
  'قطع اتصال: /eitaa_logout\n\n' +
  'فعلاً همه‌ی پیام‌های ایتا با برچسب 📗 اینجا می‌آید و با Reply جواب می‌دهید (حداکثر حدود ۱ دقیقه تأخیر).';

/** 0913… / +98913… / 98913… → 98913… */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\D/g, '');
  const p = d.startsWith('0') ? '98' + d.slice(1) : d;
  return /^98\d{10}$/.test(p) ? p : null;
}

export async function cmdEitaa(ctx: MonshiCtx): Promise<void> {
  const s = await loadSession(ctx.app);
  await ctx.reply((s ? `✅ ایتا وصل است: ${s.me.name} (${s.me.id})\n\n` : '❌ ایتا وصل نیست.\n\n') + HELP);
}

export async function cmdEitaaLogin(ctx: MonshiCtx): Promise<void> {
  const phone = normalizePhone(commandArgs(ctx)[0] ?? '');
  if (!phone) return void (await ctx.reply('شماره را این‌طور بفرستید: /eitaa_login 09123456789'));
  const imei = newImei();
  try {
    const sent = await call(ctx.app, { token: '', imei }, 'auth.sendCode', {
      phone_number: phone, api_id: API_ID, api_hash: API_HASH, settings: { _: 'codeSettings', flags: 0 },
    });
    await ctx.app.ctx.setState(LOGIN_KEY, JSON.stringify({ phone, imei, hash: sent.phone_code_hash }));
    await ctx.reply('📨 کد ورود ' + (sent.type?._ === 'auth.sentCodeTypeApp' ? 'داخل اپ ایتا' : 'با پیامک') + ' ارسال شد.\nحالا بفرستید: /eitaa_code 12345');
  } catch (err: any) {
    await ctx.reply('❌ ارسال کد ناموفق بود: ' + (err?.message ?? 'نامشخص'));
  }
}

export async function cmdEitaaCode(ctx: MonshiCtx): Promise<void> {
  const code = (commandArgs(ctx)[0] ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  await ctx.deleteMessage().catch(() => {}); // the code shouldn't stay in the chat
  const pending = await ctx.app.ctx.getState(LOGIN_KEY);
  if (!pending) return void (await ctx.reply('اول /eitaa_login را بزنید.'));
  if (!/^\d{4,6}$/.test(code)) return void (await ctx.reply('کد را این‌طور بفرستید: /eitaa_code 12345'));
  const { phone, imei, hash } = JSON.parse(pending);
  let auth;
  try {
    auth = await call(ctx.app, { token: '', imei }, 'auth.signIn', { phone_number: phone, phone_code_hash: hash, phone_code: code });
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    return void (await ctx.reply(msg.includes('PASSWORD')
      ? '❌ این اکانت رمز دومرحله‌ای دارد که فعلاً پشتیبانی نمی‌شود.'
      : '❌ ورود ناموفق بود (' + (msg || 'نامشخص') + '). اگر کد منقضی شده، دوباره /eitaa_login بزنید.'));
  }
  if (auth?._ !== 'auth.authorization' || !auth.token) return void (await ctx.reply('❌ ورود ناموفق بود: ' + (auth?._ ?? 'پاسخ نامعتبر')));
  const name = [auth.user?.first_name, auth.user?.last_name].filter(Boolean).join(' ') || '—';
  await saveSession(ctx.app, { token: auth.token, imei, me: { id: String(auth.user?.id), name } });
  await ctx.app.ctx.deleteState(LOGIN_KEY);
  await ctx.reply(`✅ ایتا وصل شد: ${name}\nاز همین الان پیام‌های جدید ایتا اینجا می‌آید.`);
}

export async function cmdEitaaLogout(ctx: MonshiCtx): Promise<void> {
  const s = await loadSession(ctx.app);
  if (!s) return void (await ctx.reply('ایتا وصل نیست.'));
  await call(ctx.app, s, 'auth.logOut').catch((err) => console.warn('Eitaa logOut failed', err?.message));
  await clearSession(ctx.app);
  await ctx.reply('✅ اتصال ایتا قطع شد.');
}
