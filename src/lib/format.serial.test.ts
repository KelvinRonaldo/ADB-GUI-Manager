import { describe, expect, it } from 'vitest';
import { terminalSerial } from './format';

describe('terminalSerial', () => {
  it('prefere o serial do fabricante ao do adb', () => {
    expect(terminalSerial({ 'ro.serialno': '100950089069061453', 'persist.sys.device.sn': '5901152448001549' })).toBe('5901152448001549');
    expect(terminalSerial({ 'ro.serialno': '2840748521', 'pax.sp.SN': '2840748521' })).toBe('2840748521');
    expect(terminalSerial({ 'ro.serialno': '573c062c', 'persist.sys.ft.serialno': 'F200C0411005689', 'persist.sys.customerSN': '5811012502001097' })).toBe('5811012502001097');
    expect(terminalSerial({ 'ro.serialno': 'PB1SP39E70207', 'ro.sunmi.serial': 'PB1SP39E70207' })).toBe('PB1SP39E70207');
  });
  it('ignora valores vazios ou de mentira e cai no ro.serialno', () => {
    expect(terminalSerial({ 'persist.sys.SN': 'unknown', 'persist.sys.device.sn': '0000', 'ro.serialno': 'ABC123' })).toBe('ABC123');
    expect(terminalSerial({})).toBeNull();
    expect(terminalSerial(null)).toBeNull();
  });
});
