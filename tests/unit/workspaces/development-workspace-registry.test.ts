import assert from "node:assert/strict";
import test from "node:test";

import { CoreError } from "../../../src/core/errors.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

const ROOT = "/registered/root";

function coreError(code: string) {
  return (error: unknown) => error instanceof CoreError && error.code === code;
}

test("manual workspaces require explicit allow_development and development_remote", () => {
  const registry = new RegisteredWorkspaceRegistry([
    {
      id: "dev",
      root: ROOT,
      allow_write: false,
      allow_development: true,
      development_remote: "origin"
    }
  ]);

  assert.deepEqual(registry.resolveDevelopment("dev"), {
    root: ROOT,
    remote: "origin"
  });
  assert.throws(() => registry.resolveWritable("dev"), coreError("WORKSPACE_PRECONDITION_FAILED"));
});

test("development permission is independent from controlled-write permission", () => {
  const registry = new RegisteredWorkspaceRegistry([
    { id: "write-only", root: ROOT, allow_write: true }
  ]);

  assert.equal(registry.resolveWritable("write-only"), ROOT);
  assert.throws(
    () => registry.resolveDevelopment("write-only"),
    coreError("WORKSPACE_PRECONDITION_FAILED")
  );
});

test("managed workspaces can never gain development permission through authorizeWrite", () => {
  const registry = new RegisteredWorkspaceRegistry([]);
  registry.registerManaged("managed", ROOT, false);
  registry.authorizeWrite("managed");

  assert.equal(registry.resolveWritable("managed"), ROOT);
  assert.throws(
    () => registry.resolveDevelopment("managed"),
    coreError("WORKSPACE_PRECONDITION_FAILED")
  );
});

test("invalid development configuration fails closed", () => {
  for (const registration of [
    { id: "dev", root: ROOT, allow_development: true },
    { id: "dev", root: ROOT, allow_development: false, development_remote: "origin" },
    { id: "dev", root: ROOT, allow_development: true, development_remote: "bad remote" }
  ]) {
    assert.throws(
      () => new RegisteredWorkspaceRegistry([registration]),
      coreError("WORKSPACE_BOUNDARY_VIOLATION")
    );
  }
});
