// Every person name in the dashboards renders as "First Last".
// Run: node --test src/Components/App/AIHub/personName.test.mjs   (from connect-ui/)
import test from "node:test";
import assert from "node:assert/strict";
import { formatPersonName, splitConcatenatedName, personDisplayName } from "./personName.js";

test("the reported shapes all become First Last", () => {
  assert.equal(formatPersonName("SruthiChimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("sruthi.chimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("sruthi_chimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("sruthi-chimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("SUDITYA NIMMALA"), "Suditya Nimmala");
  assert.equal(formatPersonName("suditya nimmala"), "Suditya Nimmala");
  assert.equal(formatPersonName("DOMAIN\\SruthiChimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("CORP\\sruthi.chimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("  SudityaNimmala  "), "Suditya Nimmala");
});

test("a run-together username takes its split from the matching email", () => {
  assert.equal(formatPersonName("Pravallikapunumalli", "pravallika.punumalli@cloudfuze.com"), "Pravallika Punumalli");
  assert.equal(formatPersonName("pravallikapunumalli", "Pravallika.Punumalli@CloudFuze.com"), "Pravallika Punumalli");
  // A non-matching email is not used to rename someone.
  assert.equal(formatPersonName("Pravallikapunumalli", "someone.else@cloudfuze.com"), "Pravallikapunumalli");
  // Without an email there is nothing to split on — just capitalised.
  assert.equal(formatPersonName("pravallikapunumalli"), "Pravallikapunumalli");
});

test("an email used as a name, or a missing name with an email, derives from the local part", () => {
  assert.equal(formatPersonName("sruthi.chimata@cloudfuze.com"), "Sruthi Chimata");
  assert.equal(formatPersonName(null, "sruthi.chimata@cloudfuze.com"), "Sruthi Chimata");
  assert.equal(formatPersonName("", "sruthi_chimata@cloudfuze.com"), "Sruthi Chimata");
});

test("null, empty and non-strings pass through", () => {
  assert.equal(formatPersonName(null), null);
  assert.equal(formatPersonName(undefined), undefined);
  assert.equal(formatPersonName(""), "");
  assert.equal(formatPersonName(42), 42);
});

test("already-correct names are unchanged", () => {
  assert.equal(formatPersonName("Sruthi Chimata"), "Sruthi Chimata");
  assert.equal(formatPersonName("Jane Doe"), "Jane Doe");
  assert.equal(formatPersonName("Madonna"), "Madonna");
});

test("Mc / Mac / O' names and hyphenated names are not mangled", () => {
  assert.equal(formatPersonName("Ronald McDonald"), "Ronald McDonald");
  assert.equal(formatPersonName("RonaldMcDonald"), "Ronald McDonald");
  assert.equal(formatPersonName("Ann MacKenzie"), "Ann MacKenzie");
  assert.equal(formatPersonName("o'brien"), "O'Brien");
  assert.equal(formatPersonName("conan o'brien"), "Conan O'Brien");
  assert.equal(formatPersonName("Mary-Jane Watson"), "Mary-Jane Watson");
  assert.equal(formatPersonName("mary-jane watson"), "Mary-Jane Watson");
  assert.equal(formatPersonName("Anne Smith-Jones"), "Anne Smith-Jones");
  assert.equal(formatPersonName("Mary-Jane"), "Mary-Jane");
});

test("initials stay sensible", () => {
  assert.equal(formatPersonName("JD Smith"), "JD Smith");
  assert.equal(formatPersonName("j. smith"), "J Smith");
  assert.equal(formatPersonName("JSmith"), "J Smith");
  assert.equal(formatPersonName("JOHN F KENNEDY"), "John F Kennedy");
});

test("placeholders, ids and hostnames are never altered", () => {
  assert.equal(formatPersonName("Browser User (abc123)"), "Browser User (abc123)");
  assert.equal(formatPersonName("Browser User (c1469c64)"), "Browser User (c1469c64)");
  assert.equal(formatPersonName("DESKTOP-7F2K9Q"), "DESKTOP-7F2K9Q");
  assert.equal(formatPersonName("LAPTOP-FCRNKB4"), "LAPTOP-FCRNKB4");
  assert.equal(formatPersonName("clicode:1234abcd"), "clicode:1234abcd");
  assert.equal(formatPersonName("user123"), "user123");
});

test("legacy aliases keep working", () => {
  assert.equal(splitConcatenatedName("SudityaNimmala"), "Suditya Nimmala");
  assert.equal(personDisplayName("Pravallikapunumalli", "pravallika.punumalli@cloudfuze.com"), "Pravallika Punumalli");
  assert.equal(personDisplayName(null, "x@y.com"), "X");
  assert.equal(personDisplayName(null, null), null);
});

test("formatRowPerson: machine-shaped hostname fallback stays raw, name-shaped one is formatted", async () => {
  const { formatRowPerson } = await import("./personName.js");
  assert.equal(formatRowPerson("SATYA", null, "SATYA"), "Satya");
  assert.equal(formatRowPerson("SudityaSena", null, "SudityaSena"), "Suditya Sena");
  assert.equal(formatRowPerson("LAPTOP-FCRNKB4", null, "LAPTOP-FCRNKB4"), "LAPTOP-FCRNKB4");
  assert.equal(formatRowPerson("Mozilla-browser-extension", null, "Mozilla-browser-extension"), "Mozilla-browser-extension");
  assert.equal(formatRowPerson("asmith@corp.com", "asmith@corp.com", "BUILD-07"), "Asmith");
  assert.equal(formatRowPerson("SudityaNimmala", null, "SUDITYA-PC"), "Suditya Nimmala");
});
