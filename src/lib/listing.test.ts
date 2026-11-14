import { beforeEach, describe, expect, it } from 'vitest';
import { app, hiddenByUsb, listedDevices, usbTwin, wifiTwin } from './state.svelte';
import type { Device, Summary } from './types';

const dev = (serial: string, connection: Device['connection'], stateKind: Device['stateKind'] = 'device'): Device =>
  ({ serial, state: stateKind, stateKind, connection, transportId: serial }) as Device;
const sum = (props: Record<string, string>): Summary => ({ props }) as unknown as Summary;

describe('Wi-Fi do mesmo aparelho ligado por USB', () => {
  beforeEach(() => {
    app.summaries = {};
    app.devices = [];
  });

  it('esconde o Wi-Fi enquanto o USB estiver pronto (serial do adb = ro.serialno)', () => {
    app.devices = [dev('4AF508088', 'usb'), dev('192.168.207.60:5555', 'wifi')];
    app.summaries['192.168.207.60:5555'] = sum({ 'ro.serialno': '4AF508088' });
    expect(hiddenByUsb('192.168.207.60:5555')).toBe(true);
    expect(usbTwin('192.168.207.60:5555')).toBe('4AF508088');
    expect(listedDevices().map((d) => d.serial)).toEqual(['4AF508088']);
  });

  it('casa pelo serial do terminal quando o adb mostra outro (GPOS760)', () => {
    app.devices = [dev('100950089069061453', 'usb'), dev('192.168.207.86:5555', 'wifi')];
    app.summaries['100950089069061453'] = sum({ 'ro.serialno': '100950089069061453', 'persist.sys.device.sn': '5901152448001549' });
    app.summaries['192.168.207.86:5555'] = sum({ 'persist.sys.device.sn': '5901152448001549' });
    expect(hiddenByUsb('192.168.207.86:5555')).toBe(true);
  });

  it('mostra o Wi-Fi quando o cabo sai ou o USB não está pronto', () => {
    app.summaries['192.168.207.60:5555'] = sum({ 'ro.serialno': '4AF508088' });
    app.devices = [dev('192.168.207.60:5555', 'wifi')];
    expect(listedDevices()).toHaveLength(1);
    app.devices = [dev('4AF508088', 'usb', 'unauthorized'), dev('192.168.207.60:5555', 'wifi')];
    expect(listedDevices()).toHaveLength(2);
  });

  it('não esconde aparelhos diferentes nem o Wi-Fi sem resumo lido', () => {
    app.devices = [dev('PB1SP39E70207', 'usb'), dev('192.168.207.56:5555', 'wifi'), dev('192.168.207.70:5555', 'wifi')];
    app.summaries['192.168.207.56:5555'] = sum({ 'ro.serialno': 'P31824AA70028' });
    expect(listedDevices()).toHaveLength(3);
  });

  it('o USB nunca é escondido', () => {
    app.devices = [dev('4AF508088', 'usb'), dev('192.168.207.60:5555', 'wifi')];
    app.summaries['192.168.207.60:5555'] = sum({ 'ro.serialno': '4AF508088' });
    expect(hiddenByUsb('4AF508088')).toBe(false);
  });

  it('acha o Wi-Fi pronto do mesmo aparelho a partir do USB (para não abrir o "Passar para Wi-Fi")', () => {
    app.devices = [dev('4AF508088', 'usb'), dev('192.168.207.60:5555', 'wifi')];
    app.summaries['192.168.207.60:5555'] = sum({ 'ro.serialno': '4AF508088' });
    expect(wifiTwin('4AF508088')).toBe('192.168.207.60:5555');
    app.devices = [dev('4AF508088', 'usb'), dev('192.168.207.60:5555', 'wifi', 'offline')];
    expect(wifiTwin('4AF508088')).toBeNull();
    app.devices = [dev('PB1SP39E70207', 'usb'), dev('192.168.207.60:5555', 'wifi')];
    expect(wifiTwin('PB1SP39E70207')).toBeNull();
  });
});
