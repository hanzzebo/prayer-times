import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNext, sec } from '../js/next.js';
import { zoneOf } from '../scripts/fetch-data.mjs';

const T = ['04:20', '04:30', '05:45', '11:55', '15:15', '17:50', '19:00'];
const Y = ['04:20', '04:30', '05:45', '11:55', '15:15', '17:50', '19:05'];
const N = ['04:21', '04:31', '05:46', '11:56', '15:16', '17:51', '19:01'];

test('next prayer before subuh counts from last night isya', () => {
  assert.deepEqual(computeNext(T, Y, N, sec('02:00')), { i: 1, target: sec('04:30'), prev: sec('19:05') - 86400, tomorrow: false });
});

test('next prayer between prayers skips terbit', () => {
  assert.deepEqual(computeNext(T, Y, N, sec('06:00')), { i: 3, target: sec('11:55'), prev: sec('04:30'), tomorrow: false });
});

test('after isya the next prayer is tomorrow subuh', () => {
  assert.deepEqual(computeNext(T, Y, N, sec('20:00')), { i: 1, target: sec('04:31') + 86400, prev: sec('19:00'), tomorrow: true });
  assert.equal(computeNext(T, Y, null, sec('20:00')).target, null);
});

test('provinces map to the right time zone', () => {
  assert.equal(zoneOf('DKI JAKARTA'), 'WIB');
  assert.equal(zoneOf('KALIMANTAN BARAT'), 'WIB');
  assert.equal(zoneOf('KALIMANTAN TIMUR'), 'WITA');
  assert.equal(zoneOf('BALI'), 'WITA');
  assert.equal(zoneOf('MALUKU UTARA'), 'WIT');
  assert.equal(zoneOf('PAPUA BARAT'), 'WIT');
});
