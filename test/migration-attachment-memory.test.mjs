import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("legal 25 MiB migration attachment decoding fits a 128 MiB heap", () => {
  const source = readFileSync(new URL("../cloud/src/index.mjs", import.meta.url), "utf8");
  const decode = source.match(/const binary = atob\(attachment\.bodyBase64\);([\s\S]*?)\n    } catch/)[0].replace(/\n    } catch$/, "");
  const result = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const attachment = { bodyBase64: Buffer.alloc(25 * 1024 * 1024, 173).toString('base64') };
    let body;
    ${decode}
    assert.equal(body.length, 25 * 1024 * 1024);
    assert.equal(body[0], 173);
    assert.equal(body.at(-1), 173);
    console.log('decoded');
  `], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(result.trim(), "decoded");
});
