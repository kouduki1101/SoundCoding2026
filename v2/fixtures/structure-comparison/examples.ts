// Teaching source only: the app parses this text and never imports or executes it.
declare const MAX_DAYS: number;
function check() { return true; }
function save() { return true; }
function notify() { return true; }
function audit() { return true; }
export function constantA(days: number) { return days <= 30; }
export function constantB(days: number) { return days <= MAX_DAYS; }
export function loopA(items: number[]) { for (const item of items) { check(); } return items; }
export function loopB(items: number[]) { check(); return items; }
export function addedA() { check(); save(); return true; }
export function addedB() { check(); notify(); save(); return true; }
export function orderA() { check(); save(); notify(); audit(); }
export function orderB() { save(); check(); audit(); notify(); }
export function directA(x: number) { return x * 2; }
export function extractedB(x: number) { return double(x); }
function double(x: number) { return x * 2; }
export function branchA(x: number) { if (x > 0) { return x; } return 0; }
export function branchB(x: number) { return x > 0 ? x : 0; }
// This published policy intentionally differs between products. Syntax does not rate quality.
export function intendedA() { return 30; }
export function intendedB() { return 60; }
// No product policy supplied: neither value is established as correct.
export function unknownA() { return 7; }
export function unknownB() { return 14; }
