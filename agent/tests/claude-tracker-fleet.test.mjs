// The fleet (Intune) install builds an all-users logon Scheduled Task. The XML is
// the load-bearing part: get the principal or trigger wrong and it either fails to
// register or runs in the wrong session where capture sees nothing. These lock in
// the choices that make it fire for every user, in their own interactive session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLogonTaskXml, TASK_NAME, SYSTEM_INSTALL_DIR } from '../src/claude_tracker/service.js';

const EXE = 'C:\\ProgramData\\CloudFuze\\ClaudeTracker\\CloudFuzeClaudeTracker.exe';

test('the logon task targets ALL users (Users group SID), not a single account', () => {
  const xml = buildLogonTaskXml(EXE);
  assert.match(xml, /<GroupId>S-1-5-32-545<\/GroupId>/, 'BUILTIN\\Users group principal');
  assert.doesNotMatch(xml, /<UserId>/, 'no per-user UserId — a bare LogonTrigger fires for everyone');
  assert.match(xml, /<LogonTrigger>[\s\S]*<Enabled>true<\/Enabled>[\s\S]*<\/LogonTrigger>/, 'enabled logon trigger');
});

test('it runs at LeastPrivilege (interactive user token) with no execution time limit', () => {
  const xml = buildLogonTaskXml(EXE);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/, "the user's own token, so it lands in their session");
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, 'no 72h kill on a long-running tracker');
});

test('the action runs the given exe in --service mode', () => {
  const xml = buildLogonTaskXml(EXE);
  assert.match(xml, /<Command>C:\\ProgramData\\CloudFuze\\ClaudeTracker\\CloudFuzeClaudeTracker\.exe<\/Command>/);
  assert.match(xml, /<Arguments>--service<\/Arguments>/);
});

test('XML-special characters in the path are escaped, not injected', () => {
  const xml = buildLogonTaskXml('C:\\a & b\\<x>\\y.exe');
  assert.match(xml, /C:\\a &amp; b\\&lt;x&gt;\\y\.exe/, 'ampersand and angle brackets escaped');
  assert.doesNotMatch(xml, /<x>/, 'no raw unescaped tag from the path');
});

test('it declares the UTF-16 prolog schtasks expects and a stable task name', () => {
  const xml = buildLogonTaskXml('C:\\x.exe');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-16"\?>/);
  assert.equal(TASK_NAME, 'CloudFuze\\ClaudeTracker');
  assert.match(SYSTEM_INSTALL_DIR, /CloudFuze[\\/]ClaudeTracker$/);
});
