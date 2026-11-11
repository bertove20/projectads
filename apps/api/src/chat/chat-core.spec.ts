import { generateKeyPairSync, sign } from 'crypto';
import { parseApprovalButton, parseDiscordCommand, parseDiscordWebhook, parseTelegramCommand, toTelegramHtml, verifyDiscordSignature } from './chat-core';

describe('perintah chat', () => {
  it('Telegram: perintah grup dengan @bot, alias, argumen multi-baris', () => {
    expect(parseTelegramCommand('/perintah@EaipBot evaluasi\ncampaign TH', 'eaipbot')).toEqual({ cmd: 'perintah', args: 'evaluasi\ncampaign TH' });
    expect(parseTelegramCommand('/start')).toEqual({ cmd: 'bantuan', args: '' });
    expect(parseTelegramCommand('/status@BotLain', 'EaipBot')).toBeNull();
    expect(parseTelegramCommand('halo semua')).toBeNull();
    expect(parseTelegramCommand('/hapusdb')).toBeNull();
  });

  it('Discord: /eaip <subcommand> dengan opsi', () => {
    expect(parseDiscordCommand({ name: 'eaip', options: [{ name: 'perintah', type: 1, options: [{ name: 'teks', value: ' cek postback ' }] }] })).toEqual({ cmd: 'perintah', args: 'cek postback' });
    expect(parseDiscordCommand({ name: 'lain', options: [] })).toBeNull();
  });

  it('webhook Discord hanya host resmi', () => {
    expect(parseDiscordWebhook('https://discord.com/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz_-123')).toEqual({ id: '123456789012', token: 'abcdefghijklmnopqrstuvwxyz_-123' });
    expect(parseDiscordWebhook('https://evil.example/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz')).toBeNull();
  });

  it('verifikasi tanda tangan Ed25519 Discord (timestamp + raw body)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubHex = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex');
    const body = Buffer.from('{"type":1}');
    const ts = '1794380000';
    const sig = sign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');
    expect(verifyDiscordSignature(pubHex, sig, ts, body)).toBe(true);
    expect(verifyDiscordSignature(pubHex, sig, ts, Buffer.from('{"type":2}'))).toBe(false);
    expect(verifyDiscordSignature(pubHex, undefined, ts, body)).toBe(false);
  });

  it('tombol approval: dua langkah & id usulan valid', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseApprovalButton(`ap:${id}`)).toEqual({ step: 'ask', decision: 'APPROVE', proposalId: id });
    expect(parseApprovalButton(`rjc:${id}`)).toEqual({ step: 'confirm', decision: 'REJECT', proposalId: id });
    expect(parseApprovalButton('x')?.step).toBe('cancel');
    expect(parseApprovalButton('apc:../../etc')).toBeNull();
    expect(parseDiscordCommand({ name: 'eaip', options: [{ name: 'revisi', options: [{ name: 'kode', value: 'AB12CD34' }, { name: 'catatan', value: 'tambah data zone' }] }] })).toEqual({ cmd: 'revisi', args: 'AB12CD34 tambah data zone' });
  });

  it('Markdown → HTML Telegram aman', () => {
    expect(toTelegramHtml('## Judul\n- **ROI** <script>')).toBe('<b>Judul</b>\n• <b>ROI</b> &lt;script&gt;');
  });
});
