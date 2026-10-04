import nodemailer from 'nodemailer';
import {mailConfig} from './mail-config.js';

export const mailProvider = env => String(env.MAIL_PROVIDER || 'smtp').trim().toLowerCase();
export const mailRequiredKeys = env => mailProvider(env) === 'brevo'
  ? ['BREVO_API_KEY', 'MAIL_FROM']
  : ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];

// NovaCart sends one recipient per message. Reject ambiguous lists and header newlines.
function mailbox(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('Invalid email address.');
  const match = value.trim().match(/^(.*?)\s*<([^<>]+)>$/);
  const email = (match ? match[2] : value).trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) throw new Error('Invalid email address.');
  const name = match?.[1]?.trim();
  return {email, ...(name ? {name} : {})};
}

export function createMailer(env, {fetchImpl = globalThis.fetch} = {}) {
  const provider = mailProvider(env);
  if (!['smtp', 'brevo'].includes(provider)) throw new Error('MAIL_PROVIDER must be smtp or brevo.');
  if (provider === 'smtp') {
    return env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
      ? nodemailer.createTransport(mailConfig(env)) : null;
  }
  if (!env.BREVO_API_KEY) return null;

  async function request(path, body) {
    try {
      const response = await fetchImpl('https://api.brevo.com/v3/' + path, {
        method: body ? 'POST' : 'GET',
        headers: {'api-key': env.BREVO_API_KEY, accept: 'application/json',
          ...(body ? {'content-type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}),
        signal: AbortSignal.timeout(20000), redirect: 'error'
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      // Provider responses and network errors can contain private message/credential data.
      throw new Error('Email provider request failed. Check private mail settings and provider status.');
    }
  }
  return {
    async verify() {
      await request('account'); // Authentication check only; does not send a message.
      return true;
    },
    async sendMail(message) {
      const sender = mailbox(message.from || env.MAIL_FROM), recipient = mailbox(message.to);
      const result = await request('smtp/email', {
        sender, to: [recipient], subject: String(message.subject || ''),
        ...(message.html ? {htmlContent: String(message.html)} : {}),
        ...(message.text ? {textContent: String(message.text)} : {})
      });
      if (typeof result?.messageId !== 'string' || !result.messageId.trim()) {
        throw new Error('Email provider did not acknowledge the message.');
      }
      return {messageId: result.messageId, accepted: [recipient.email], rejected: []};
    },
    close() {}
  };
}
