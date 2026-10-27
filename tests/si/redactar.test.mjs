import test from 'node:test';
import assert from 'node:assert/strict';
import { redactar, recortar } from '../../plugins/si/skills/checkpoint/scripts/redactar.mjs';

test('redacta Bearer, Authorization, --token y token=', () => {
  assert.equal(redactar('curl -H "Bearer abc.def"'), 'curl -H "Bearer [redactado]');
  assert.ok(!redactar('Authorization: Bearer s3cr3t').includes('s3cr3t'));
  assert.equal(redactar('cli --token abc123 x'), 'cli --token=[redactado] x');
  assert.equal(redactar('cli --token=abc123'), 'cli --token=[redactado]');
  assert.equal(redactar('run token=abc123 ok'), 'run token=[redactado] ok');
});

test('redacta cadenas largas y prefijos conocidos', () => {
  const largo = 'A1b2C3d4'.repeat(5);
  assert.ok(!redactar(`x ${largo} y`).includes(largo));
  assert.ok(!redactar('ghp_abcdefghijklmnopqrstuvwxyz0123').includes('ghp_'));
  assert.ok(!redactar('AKIAABCDEFGHIJKLMNOP').includes('AKIA'));
  assert.ok(!redactar('password=hunter2').includes('hunter2'));
});

test('no toca texto normal', () => {
  assert.equal(redactar('until [ -f /tmp/listo ]; do sleep 5; done'), 'until [ -f /tmp/listo ]; do sleep 5; done');
});

test('recortar colapsa espacios y corta a 160', () => {
  assert.equal(recortar('a\n  b'), 'a b');
  assert.equal(recortar('x'.repeat(300)).length, 160);
});
