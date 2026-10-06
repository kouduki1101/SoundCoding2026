import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const stages = ["base", "draft", "aligned"];
const paths = ["src/checkout.js", "src/inventory.js", "src/pricing.js"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const tickets = [
  { sku: "floor", unitPrice: 12000, quantity: 2 },
  { sku: "balcony", unitPrice: 8500, quantity: 1 }
];
const expectedAmount = { subtotal: 32500, discount: 3250, total: 29250, currency: "JPY" };
const enoughStock = { floor: 4, balcony: 2 };
const shortStock = { floor: 1, balcony: 2 };
const expectedDraftFailures = ["checkout-rejects-insufficient-stock", "checkout-skips-pricing-after-refusal"];

async function sourceInfo(stage) {
  const files = Object.fromEntries(await Promise.all(paths.map(async (path) =>
    [path, await readFile(new URL(`${stage}/${path}`, root), "utf8")]
  )));
  const fileHashes = Object.fromEntries(paths.map((path) => [path, sha256(files[path])]));
  const hashInput = JSON.stringify(paths.map((path) => [path, files[path]]));
  return { files, fileHashes, sourceSha256: sha256(hashInput) };
}

function lineFor(files, file, needle) {
  const matches = files[file].split("\n").flatMap((line, index) => line.includes(needle) ? [index + 1] : []);
  assert.equal(matches.length, 1, `Evidence anchor must occur exactly once: ${file}: ${needle}`);
  return { file, startLine: matches[0], endLine: matches[0] };
}

function evidenceFor(stage, files) {
  const structured = stage !== "base";
  const guard = stage === "aligned" ? "if (!reservation.ok)" : "if (!reservation)";
  const priceStart = stage === "base" ? "const subtotal = lines.reduce(" : "let subtotal = 0;";
  const records = [];
  // The subtotal range ends before the discount statement in both writing styles.
  records[0] = {
    id: "subtotal-style",
    file: "src/pricing.js",
    startLine: lineFor(files, "src/pricing.js", priceStart).startLine,
    endLine: lineFor(files, "src/pricing.js", "const discount =").startLine - 1,
    meaning: stage === "base" ? "同じ料金の小計を reduce で合計する。" : "同じ料金の小計を for で合計する。書き方の個性であり品質点数ではない。",
    evidenceKind: "source",
    tests: ["pricing-style-equivalence"]
  };
  records.push(
    { id: "discount-rounding", ...lineFor(files, "src/pricing.js", "const discount ="), meaning: "割引額だけを円単位で四捨五入し、小計から引く。", evidenceKind: "source", tests: ["pricing-rounded-discount"] },
    { id: "reserve-failure-contract", ...lineFor(files, "src/inventory.js", structured ? "return { ok: false" : "return false;"), meaning: structured ? "予約拒否もオブジェクトを返す。ok が false。" : "予約拒否は boolean の false を返す。", evidenceKind: "source", tests: ["inventory-refusal-is-atomic"] },
    { id: "reserve-success-contract", ...lineFor(files, "src/inventory.js", structured ? "return { ok: true" : "return true;"), meaning: structured ? "予約成功は ok: true と予約参照 holdId を返す。" : "予約成功は boolean の true を返す。", evidenceKind: "source", tests: ["inventory-success-contract"] },
    { id: "reservation-call", ...lineFor(files, "src/checkout.js", "const reservation ="), meaning: "checkout が在庫予約の返り値を受け取る。", evidenceKind: "source", tests: ["checkout-success"] },
    { id: "reservation-guard", ...lineFor(files, "src/checkout.js", guard), meaning: stage === "draft" ? "オブジェクト自体は truthy なので、ok: false でもこの拒否分岐に入らない。" : stage === "aligned" ? "新契約の ok を確認し、予約拒否で戻る。" : "boolean 契約の false を確認し、予約拒否で戻る。", evidenceKind: "source-and-execution", tests: ["checkout-rejects-insufficient-stock"] },
    { id: "pricing-call", ...lineFor(files, "src/checkout.js", "const amount ="), meaning: "予約を通過した後に料金計算を呼ぶ。テストでは実関数を包んで呼出回数を数える。", evidenceKind: "source-and-execution", tests: ["checkout-skips-pricing-after-refusal", "checkout-success"] },
    { id: "confirmed-result", ...lineFor(files, "src/checkout.js", "return { status: \"confirmed\""), meaning: "確定扱いの結果を返す。外部決済や発券は行わない。", evidenceKind: "source-and-execution", tests: ["checkout-rejects-insufficient-stock", "checkout-success"] }
  );
  return records;
}

async function executeStage(stage) {
  const source = await sourceInfo(stage);
  const { quote: calculatePrice } = await import(new URL(`${stage}/src/pricing.js`, root));
  const { createInventory, reserve } = await import(new URL(`${stage}/src/inventory.js`, root));
  const { checkout } = await import(new URL(`${stage}/src/checkout.js`, root));
  const { quote: basePrice } = await import(new URL("base/src/pricing.js", root));
  const cases = [];
  function check(id, title, input, expected, observe) {
    let actual;
    let failure = null;
    try {
      actual = observe();
      assert.deepStrictEqual(actual, expected);
    } catch (error) {
      failure = { name: error.name, message: error.message, operator: error.operator ?? null };
    }
    const file = id.startsWith("pricing-") ? "src/pricing.js" : id.startsWith("inventory-") ? "src/inventory.js" : "src/checkout.js";
    const needle = id === "checkout-skips-pricing-after-refusal" ? "const amount =" : id === "checkout-rejects-insufficient-stock" ? (stage === "aligned" ? "if (!reservation.ok)" : "if (!reservation)") : id.startsWith("checkout-") ? "const reservation =" : id.startsWith("inventory-") ? "export function reserve(" : "export function quote(";
    cases.push({ id, name: title, title, status: failure ? "failed" : "passed", input, expected, actual: actual ?? null, observed: actual ?? null, source: lineFor(source.files, file, needle), failure });
  }

  check("pricing-normal", "3 枚の料金と 10% 割引", { lines: tickets, discountRate: 0.1 }, expectedAmount,
    () => calculatePrice(tickets, 0.1));
  check("pricing-empty", "料金計算は空配列を 0 円とする", { lines: [], discountRate: 0.1 },
    { subtotal: 0, discount: 0, total: 0, currency: "JPY" }, () => calculatePrice([], 0.1));
  check("pricing-rounded-discount", "円単位で割引を丸める", { lines: [{ sku: "floor", unitPrice: 101, quantity: 1 }], discountRate: 0.15 },
    { subtotal: 101, discount: 15, total: 86, currency: "JPY" },
    () => calculatePrice([{ sku: "floor", unitPrice: 101, quantity: 1 }], 0.15));
  check("pricing-style-equivalence", "reduce / for を 80 組の入力で照合", { unitPrices: [0, 1, 101, 8500], quantities: [0, 1, 2, 9], discountRates: [0, 0.1, 0.15, 0.25, 1] },
    { checked: 80, mismatchCount: 0, mismatches: [] }, () => {
      let checked = 0;
      const mismatches = [];
      for (const unitPrice of [0, 1, 101, 8500]) {
        for (const quantity of [0, 1, 2, 9]) {
          for (const discountRate of [0, 0.1, 0.15, 0.25, 1]) {
            const lines = [{ sku: "floor", unitPrice, quantity }, { sku: "balcony", unitPrice: 250, quantity: 2 }];
            const subtotal = unitPrice * quantity + 500;
            const discount = Math.round(subtotal * discountRate);
            const oracle = { subtotal, discount, total: subtotal - discount, currency: "JPY" };
            const result = calculatePrice(lines, discountRate);
            const baseResult = basePrice(lines, discountRate);
            checked++;
            if (JSON.stringify(result) !== JSON.stringify(oracle) || JSON.stringify(result) !== JSON.stringify(baseResult)) {
              mismatches.push({ lines, discountRate, expected: oracle, actual: result, base: baseResult });
            }
          }
        }
      }
      return { checked, mismatchCount: mismatches.length, mismatches };
    });

  check("inventory-success-contract", "予約成功の返り値と在庫の減少", { stock: enoughStock, lines: tickets },
    { reservation: stage === "base" ? true : { ok: true, holdId: "hold-1" }, remaining: { floor: 2, balcony: 1 } }, () => {
      const inventory = createInventory(enoughStock);
      const reservation = reserve(inventory, tickets);
      return { reservation, remaining: Object.fromEntries(inventory.remaining) };
    });
  const partlyShort = { floor: 4, balcony: 0 };
  check("inventory-refusal-is-atomic", "途中の券種が不足しても在庫を一部だけ減らさない", { stock: partlyShort, lines: tickets },
    { reservation: stage === "base" ? false : { ok: false, holdId: null }, remaining: partlyShort }, () => {
      const inventory = createInventory(partlyShort);
      const reservation = reserve(inventory, tickets);
      return { reservation, remaining: Object.fromEntries(inventory.remaining) };
    });
  const duplicateLines = [{ sku: "floor", unitPrice: 12000, quantity: 2 }, { sku: "floor", unitPrice: 12000, quantity: 2 }];
  check("inventory-aggregates-duplicate-sku", "同じ券種の複数行を合計して在庫を確認する", { stock: { floor: 3 }, lines: duplicateLines },
    { reservation: stage === "base" ? false : { ok: false, holdId: null }, remaining: { floor: 3 } }, () => {
      const inventory = createInventory({ floor: 3 });
      const reservation = reserve(inventory, duplicateLines);
      return { reservation, remaining: Object.fromEntries(inventory.remaining) };
    });

  function observeCheckout(stock) {
    let pricingCalls = 0;
    const inventory = createInventory(stock);
    const result = checkout(tickets, inventory, {
      discountRate: 0.1,
      price(lines, discountRate) {
        pricingCalls++;
        return calculatePrice(lines, discountRate);
      }
    });
    return { result, pricingCalls, remaining: Object.fromEntries(inventory.remaining) };
  }
  check("checkout-success", "在庫があれば一度だけ料金計算して確定する", { stock: enoughStock, lines: tickets, discountRate: 0.1 },
    { result: { status: "confirmed", ...expectedAmount }, pricingCalls: 1, remaining: { floor: 2, balcony: 1 } },
    () => observeCheckout(enoughStock));
  check("checkout-default-price", "計測用の差し替えをしない既定の quote でも同じ結果になる", { stock: enoughStock, lines: tickets, discountRate: 0.1 },
    { status: "confirmed", ...expectedAmount }, () => checkout(tickets, createInventory(enoughStock), { discountRate: 0.1 }));
  check("checkout-rejects-insufficient-stock", "在庫不足では成功扱いにしない", { stock: shortStock, lines: tickets, discountRate: 0.1 },
    { status: "sold-out" }, () => observeCheckout(shortStock).result);
  check("checkout-skips-pricing-after-refusal", "予約拒否の後に不要な料金計算をしない", { stock: shortStock, lines: tickets, discountRate: 0.1 },
    { pricingCalls: 0, remaining: shortStock }, () => {
      const observed = observeCheckout(shortStock);
      return { pricingCalls: observed.pricingCalls, remaining: observed.remaining };
    });

  const sourceAfter = await sourceInfo(stage);
  assert.equal(source.sourceSha256, sourceAfter.sourceSha256, "Fixture source changed while tests were running");
  const passed = cases.filter((test) => test.status === "passed").length;
  return {
    id: stage,
    ...source,
    evidence: evidenceFor(stage, source.files),
    verification: {
      status: passed === cases.length ? "passed" : "failed",
      sourceSha256: source.sourceSha256,
      command: `node verify.mjs --stage ${stage}`,
      testCount: cases.length,
      passed,
      failed: cases.length - passed,
      cases
    }
  };
}

function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  return Array.from({ length: Math.max(a.length, b.length) }, (_, index) => ({
    line: index + 1, before: a[index] ?? null, after: b[index] ?? null
  })).filter((entry) => entry.before !== entry.after);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length) {
    assert.equal(args.length, 2, "Use --stage base|draft|aligned, or no arguments");
    assert.equal(args[0], "--stage");
    assert.ok(stages.includes(args[1]), "Only the three trusted built-in fixture stages can run");
    const result = await executeStage(args[1]);
    console.log(JSON.stringify(result.verification, null, 2));
    process.exitCode = result.verification.failed ? 1 : 0;
    return;
  }

  const results = Object.fromEntries(await Promise.all(stages.map(async (stage) => [stage, await executeStage(stage)])));
  assert.equal(results.base.verification.failed, 0, "Base must satisfy every contract test");
  assert.equal(results.aligned.verification.failed, 0, "Aligned must satisfy every contract test");
  assert.deepStrictEqual(results.draft.verification.cases.filter((test) => test.status === "failed").map((test) => test.id), expectedDraftFailures,
    "Draft must reproduce exactly the intended integration failures");
  assert.equal(results.base.files["src/checkout.js"], results.draft.files["src/checkout.js"], "The caller really was left unchanged during the API change");
  for (const file of ["src/pricing.js", "src/inventory.js"]) {
    assert.equal(results.draft.files[file], results.aligned.files[file], `${file} must stay byte-identical after the repair`);
  }
  const repair = changedLines(results.draft.files["src/checkout.js"], results.aligned.files["src/checkout.js"]);
  assert.deepStrictEqual(repair, [{ line: 7, before: "  if (!reservation) {", after: "  if (!reservation.ok) {" }], "Repair must be a single-line guard change");

  const verification = {
    schemaVersion: "soundcoding-story-verification/1",
    generatedAt: new Date().toISOString(),
    runtime: { name: "Node.js", version: process.version, platform: process.platform, architecture: process.arch },
    harnessFile: "verify.mjs",
    harnessSha256: sha256(await readFile(new URL("verify.mjs", root))),
    sourceHashMethod: "SHA256(UTF-8(JSON.stringify(Object.entries(files).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)))); exact source strings, no newline normalization",
    scope: "Executed only the three bundled, self-authored in-memory fixtures. No uploaded code, network, payment, or real inventory execution.",
    fixtureHarnessStatus: "passed",
    fixtureHarnessMeaning: "Base and aligned pass; draft actually fails exactly the two intended contract tests. This is not a claim that draft passes.",
    stages: Object.fromEntries(stages.map((stage) => [stage, results[stage].verification])),
    invariants: {
      pricingEquivalenceCasesPerStage: 80,
      callerUnchangedFromBaseToDraft: true,
      pricingUnchangedFromDraftToAligned: true,
      inventoryUnchangedFromDraftToAligned: true,
      repairChangedFileCount: 1,
      repairChangedLineCount: 1,
      repair
    }
  };
  await writeFile(new URL("verification.json", root), JSON.stringify(verification, null, 2) + "\n");
  console.log(JSON.stringify({
    fixtureHarnessStatus: verification.fixtureHarnessStatus,
    stages: Object.fromEntries(stages.map((stage) => [stage, {
      status: results[stage].verification.status,
      passed: results[stage].verification.passed,
      failed: results[stage].verification.failed,
      sourceSha256: results[stage].sourceSha256
    }])),
    repair,
    artifacts: [fileURLToPath(new URL("verification.json", root))]
  }, null, 2));
}

await main();
