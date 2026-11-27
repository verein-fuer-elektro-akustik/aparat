// The sound card list: without a microphone (a usb interface that was the
// only one is unplugged) it still lists what the browser tells and says why
// names may be missing; a card that goes away falls back to the default.

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/');
  const options = () => ev(`[...document.getElementById('device').options].map((o) => o.value || 'default').join(' ')`);
  // two outputs while the usb card is there
  await ev(`(() => {
    window.__cards = [{ kind: 'audiooutput', deviceId: 'default', label: 'Default' }, { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' }, { kind: 'audiooutput', deviceId: 'usb', label: 'USB audio' }];
    navigator.mediaDevices.enumerateDevices = async () => window.__cards;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] });
    return 0; })()`);
  await ev(`document.getElementById('devices').click(); 0`); await sleep(300);
  ok(await options() === 'default speakers usb', `listed: ${await options()}`);

  // unplugged: no microphone any more, the page was allowed before
  await ev(`(() => {
    window.__cards = window.__cards.filter((d) => d.deviceId !== 'usb');
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
    return 0; })()`);
  await ev(`document.getElementById('device').value = ''; document.getElementById('devices').click(); 0`); await sleep(300);
  ok(await options() === 'default speakers', `still listed without a microphone: ${await options()}`);
  ok(!/not found/i.test(await ev(`document.getElementById('error').textContent`)), 'no error');

  // never allowed and no microphone: the browser gives no outputs; it says why
  await ev(`window.__cards = [{ kind: 'audiooutput', deviceId: '', label: '' }]; document.getElementById('devices').click(); 0`); await sleep(300);
  ok(await options() === 'default' && /no microphone is connected/.test(await ev(`document.getElementById('error').textContent`)), `explained: ${await ev(`document.getElementById('error').textContent`)}`);

  // the chosen card goes away: the default instead
  await ev(`window.__cards = [{ kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' }, { kind: 'audiooutput', deviceId: 'usb', label: 'USB audio' }]; document.getElementById('devices').click(); 0`); await sleep(300);
  await ev(`document.getElementById('device').value = 'usb'; 0`);
  await ev(`window.__cards = window.__cards.filter((d) => d.deviceId !== 'usb'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); 0`); await sleep(300);
  ok(await options() === 'default speakers' && await ev(`document.getElementById('device').value`) === '', `unplugged: back to the default (${await options()})`);
};
