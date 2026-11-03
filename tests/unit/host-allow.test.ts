import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedHosts, judgeHost } from '../../packages/plugin/dist/host-allow.js'

/*
 * ADR-0014 / T-811: the Host rule decides whether a page that reached 127.0.0.1 while believing
 * it is talking to `evil.com` gets an answer. A DNS-rebinding page sends its own name in `Host`
 * and may send no `Origin` at all, so this check is the one that closes the gap.
 *
 * These cases are exhaustive on purpose: the rule is small, and "127.0.0.1.evil.com" is exactly
 * the string a `startsWith` / `includes` implementation would let through.
 */

const base = { boundHost: '127.0.0.1', port: 51_234 }

test('the default binding accepts loopback and nothing else', () => {
  assert.equal(judgeHost({ ...base, host: '127.0.0.1:51234' }).ok, true)
  assert.equal(judgeHost({ ...base, host: 'localhost:51234' }).ok, true)
  assert.equal(judgeHost({ ...base, host: '[::1]:51234' }).ok, true)
  assert.equal(judgeHost({ ...base, host: '127.0.0.1:51235' }).ok, false, 'a different port is a different address')
  assert.equal(judgeHost({ ...base, host: 'evil.com:51234' }).ok, false)
})

test('a name that merely CONTAINS the loopback address is refused', () => {
  // The whole point: suffix/prefix matching would accept these.
  for (const host of ['127.0.0.1.evil.com:51234', 'evil-127.0.0.1:51234', 'localhost.evil.com:51234', '127.0.0.1:51234.evil.com']) {
    assert.equal(judgeHost({ ...base, host }).ok, false, `${host} must not pass`)
  }
})

test('case and a trailing FQDN dot are normalised, not used to slip through', () => {
  assert.equal(judgeHost({ ...base, host: 'LOCALHOST:51234' }).ok, true)
  assert.equal(judgeHost({ ...base, host: 'localhost.:51234' }).ok, true)
})

test('no Host header is refused with its own sentence (not "bad token")', () => {
  const verdict = judgeHost({ ...base, host: undefined })
  assert.equal(verdict.ok, false)
  assert.match(String(verdict.reason), /no Host header/)
})

test('a refusal quotes the exact list it accepts, so the fix is visible', () => {
  const verdict = judgeHost({ ...base, host: 'evil.com:51234' })
  assert.equal(verdict.ok, false)
  assert.match(String(verdict.reason), /127\.0\.0\.1:51234/)
  assert.match(String(verdict.reason), /localhost:51234/)
  assert.match(String(verdict.reason), /ADR-0014|0014-host-header-allowlist/, 'the sentence points at the decision record')
})

test('--allow-host adds exactly the names it was given', () => {
  const withName = { ...base, allowHosts: ['panel.local'] }
  assert.equal(judgeHost({ ...withName, host: 'panel.local:51234' }).ok, true)
  assert.equal(judgeHost({ ...withName, host: 'panel.local:51235' }).ok, false, 'a bare name is pinned to the bound port')
  assert.equal(judgeHost({ ...withName, host: 'other.local:51234' }).ok, false)

  const withPort = { ...base, allowHosts: ['panel.local:8080'] }
  assert.equal(judgeHost({ ...withPort, host: 'panel.local:8080' }).ok, true, 'an explicit port is honoured as written')
  assert.equal(judgeHost({ ...withPort, host: 'panel.local:51234' }).ok, false)
})

test('binding a concrete LAN address accepts that address without extra flags', () => {
  const lan = { boundHost: '192.168.1.7', port: 8080 }
  assert.equal(judgeHost({ ...lan, host: '192.168.1.7:8080' }).ok, true)
  assert.equal(judgeHost({ ...lan, host: '127.0.0.1:8080' }).ok, true, 'loopback keeps working')
  assert.equal(judgeHost({ ...lan, host: '192.168.1.8:8080' }).ok, false)
})

test('a wildcard bind is never itself an accepted Host', () => {
  // 0.0.0.0 is "every interface", not an address a browser can be talking to.
  const allowed = allowedHosts({ boundHost: '0.0.0.0', port: 8080, allowHosts: ['panel.local'] })
  assert.equal(allowed.includes('0.0.0.0:8080'), false)
  assert.equal(allowed.includes('panel.local:8080'), true)
  assert.equal(judgeHost({ boundHost: '0.0.0.0', port: 8080, allowHosts: ['panel.local'], host: '0.0.0.0:8080' }).ok, false)
})

test('the scheme-default port may be omitted (--port 80 must not kill the panel)', () => {
  /*
   * A browser drops `:80` from the Host header for `http://localhost:80/`. The first version of
   * this rule compared against `localhost:80` and refused every request, i.e. the panel was dead on
   * a legitimate configuration (independent reviewer, R75). Only the DEFAULT port is forgiven: for
   * any other port the browser always sends the port, so a missing one is not a browser we serve.
   */
  const onEighty = { boundHost: '127.0.0.1', port: 80 }
  assert.equal(judgeHost({ ...onEighty, host: 'localhost' }).ok, true)
  assert.equal(judgeHost({ ...onEighty, host: '127.0.0.1' }).ok, true)
  assert.equal(judgeHost({ ...onEighty, host: 'localhost:80' }).ok, true)
  assert.equal(judgeHost({ ...onEighty, host: 'evil.com' }).ok, false, 'a name without a port is still a name')

  const onOther = { boundHost: '127.0.0.1', port: 5555 }
  assert.equal(judgeHost({ ...onOther, host: 'localhost' }).ok, false, 'outside port 80 the browser always sends the port')
})
