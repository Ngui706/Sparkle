const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  const unsubSecret = Deno.env.get('SPARKLE_UNSUBSCRIBE_SECRET');
  if (!supabaseUrl || !anonKey || !serviceKey || !brevoKey || !senderEmail || !unsubSecret) return json({ error: 'Promotion email service is not configured.' }, 500);

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in to send a promotion.' }, 401);
  const callerResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!callerResponse.ok) return json({ error: 'Your session is invalid. Please sign in again.' }, 401);
  const caller = await callerResponse.json();
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(caller.id)}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!profileResponse.ok) return json({ error: 'Could not verify staff permissions.' }, 500);
  const profiles = await profileResponse.json();
  if (!['staff','admin'].includes(profiles[0]?.role)) return json({ error: 'Staff portal access is required to send promotions.' }, 403);

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  const discount = String(input.discount || '').trim();
  const promoCode = String(input.promoCode || '').trim();
  const expiry = String(input.expiry || '').trim();
  const action = String(input.action || 'send');
  if (!['preview','send'].includes(action)) return json({ error: 'Invalid action.' }, 400);
  if (!title || title.length > 100 || !message || message.length > 2500 || discount.length > 120 || promoCode.length > 80 || expiry.length > 80) {
    return json({ error: 'Add a title and message. Keep the title under 100 characters and message under 2,500.' }, 400);
  }

  const recipients: Array<{ id: string; email: string; name: string }> = [];
  for (let page = 1; page <= 100; page++) {
    const usersResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!usersResponse.ok) return json({ error: 'Could not load customer accounts.' }, 502);
    const usersPage = (await usersResponse.json()).users || [];
    if (!usersPage.length) break;
    const ids = usersPage.map((user: any) => String(user.id)).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id));
    const roleById = new Map<string,string>();
    if (ids.length) {
      const rolesResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,role&id=in.(${ids.map(encodeURIComponent).join(',')})`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      if (!rolesResponse.ok) return json({ error: 'Could not verify customer account roles.' }, 502);
      for (const profile of await rolesResponse.json()) roleById.set(profile.id, profile.role);
    }
    for (const user of usersPage) {
      const role = roleById.get(user.id);
      if (user.email && user.email_confirmed_at && user.user_metadata?.marketing_opt_in === true && !['staff','admin'].includes(role || '')) {
        recipients.push({ id: user.id, email: user.email, name: user.user_metadata?.full_name || user.email.split('@')[0] });
      }
    }
    if (usersPage.length < 100) break;
  }
  if (action === 'preview') return json({ eligible: recipients.length });
  if (!recipients.length) return json({ error: 'No confirmed customers have opted in to promotions yet.', eligible: 0 }, 409);

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(unsubSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const unsubscribeUrl = async (userId: string) => {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)));
    const hex = [...sig].map(byte => byte.toString(16).padStart(2,'0')).join('');
    return `${supabaseUrl}/functions/v1/sparkle-unsubscribe?user=${encodeURIComponent(userId)}&sig=${hex}`;
  };
  const details = [discount && `<p><strong>Offer:</strong> ${esc(discount)}</p>`, promoCode && `<p><strong>Promo code:</strong> ${esc(promoCode)}</p>`, expiry && `<p><strong>Valid until:</strong> ${esc(expiry)}</p>`].filter(Boolean).join('');
  const batchSize = 1000;
  let sent = 0;
  for (let start = 0; start < recipients.length; start += batchSize) {
    const batch = recipients.slice(start, start + batchSize);
    const messageVersions = await Promise.all(batch.map(async customer => {
      const link = await unsubscribeUrl(customer.id);
      const greeting = `Hello ${esc(customer.name)},`;
      const html = `<div style="font:16px Arial,sans-serif;color:#123232;line-height:1.6;max-width:640px"><h1 style="color:#0e847e">${esc(title)}</h1><p>${greeting}</p><p>${esc(message).replace(/\r?\n/g,'<br>')}</p>${details}<hr style="border:0;border-top:1px solid #dce9e4;margin:28px 0"><p style="font-size:12px;color:#607473">You receive Sparkle promotions because you opted in. <a href="${link}">Unsubscribe from future offers</a>.</p></div>`;
      const text = `${title}\n\n${greeting}\n\n${message}${discount ? `\n\nOffer: ${discount}` : ''}${promoCode ? `\nPromo code: ${promoCode}` : ''}${expiry ? `\nValid until: ${expiry}` : ''}\n\nYou receive Sparkle promotions because you opted in. Unsubscribe: ${link}`;
      return { to: [{ email: customer.email, name: customer.name }], subject: `Sparkle Laundry: ${title}`, htmlContent: html, textContent: text };
    }));
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': brevoKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: Deno.env.get('BREVO_SENDER_NAME') || 'Sparkle Laundry', email: senderEmail }, subject: `Sparkle Laundry: ${title}`, htmlContent: '<p>Sparkle Laundry promotion</p>', textContent: 'Sparkle Laundry promotion', messageVersions }),
    });
    if (!response.ok) {
      console.error('Brevo promotion send failed', response.status, await response.text());
      return json({ error: 'Brevo could not send the full promotion.', sent, eligible: recipients.length }, 502);
    }
    sent += batch.length;
  }
  return json({ sent, eligible: recipients.length });
});
