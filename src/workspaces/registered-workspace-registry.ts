import { realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

import { CoreError } from "../core/errors.js";

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export interface WorkspaceRegistration {
  readonly id: string;
  readonly root: string;
  readonly allow_write?: boolean | undefined;
  readonly allow_development?: boolean | undefined;
  readonly development_remote?: string | undefined;
}

export interface WorkspaceLookup {
  readonly id: string;
  readonly root: string;
  readonly allowWrite: boolean;
  readonly source: "manual" | "managed";
}

type Registration = {
  root: string;
  canonicalRoot: string;
  allowWrite: boolean;
  allowDevelopment: boolean;
  developmentRemote?: string | undefined;
  source: "manual" | "managed";
};

export class RegisteredWorkspaceRegistry {
  private readonly registrations = new Map<string, Registration>();
  private readonly canonicalRoots = new Map<string, string>();
  private readonly canonicalize: (root: string) => string;

  constructor(
    entries: readonly WorkspaceRegistration[],
    canonicalize: (root: string) => string = bestEffortCanonicalRoot
  ) {
    this.canonicalize = canonicalize;
    for (const entry of entries) {
      const developmentConfigValid = entry.allow_development === true
        ? typeof entry.development_remote === "string" && REMOTE_NAME.test(entry.development_remote)
        : entry.development_remote === undefined;
      if (typeof entry.id !== "string" || entry.id.length === 0 ||
          typeof entry.root !== "string" || entry.root.length === 0 ||
          (entry.allow_write !== undefined && typeof entry.allow_write !== "boolean") ||
          (entry.allow_development !== undefined && typeof entry.allow_development !== "boolean") ||
          !developmentConfigValid ||
          !isAbsolute(entry.root) || normalize(entry.root) !== entry.root ||
          this.registrations.has(entry.id)) {
        throw new CoreError("WORKSPACE_BOUNDARY_VIOLATION");
      }
      const canonicalRoot = canonicalize(entry.root);
      this.registrations.set(entry.id, {
        root: entry.root,
        canonicalRoot,
        allowWrite: entry.allow_write ?? false,
        allowDevelopment: entry.allow_development ?? false,
        ...(entry.development_remote === undefined ? {} : { developmentRemote: entry.development_remote }),
        source: "manual"
      });
      if (!this.canonicalRoots.has(canonicalRoot)) this.canonicalRoots.set(canonicalRoot, entry.id);
    }
  }

  resolve(workspaceId: string): string {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    return registration.root;
  }

  resolveExecution(workspaceId: string): { root: string; allowWrite: boolean } {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    return { root: registration.root, allowWrite: registration.allowWrite };
  }

  resolveDevelopment(workspaceId: string): { root: string; remote: string } {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    if (registration.source !== "manual" || !registration.allowDevelopment || registration.developmentRemote === undefined) {
      throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
    }
    return { root: registration.root, remote: registration.developmentRemote };
  }

  resolveWritable(workspaceId: string): string {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    if (!registration.allowWrite) throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
    return registration.root;
  }

  findByRoot(canonicalRoot: string): WorkspaceLookup | undefined {
    const id = this.canonicalRoots.get(canonicalRoot);
    if (id === undefined) return undefined;
    const registration = this.registrations.get(id);
    if (registration === undefined) return undefined;
    return {
      id,
      root: registration.root,
      allowWrite: registration.allowWrite,
      source: registration.source
    };
  }

  registerManaged(id: string, root: string, allowWrite = false): void {
    const existing = this.registrations.get(id);
    if (existing !== undefined) {
      if (existing.root === root) return;
      throw new CoreError("WORKSPACE_BOUNDARY_VIOLATION");
    }
    const canonicalRoot = this.canonicalize(root);
    if (this.canonicalRoots.has(canonicalRoot)) throw new CoreError("WORKSPACE_BOUNDARY_VIOLATION");
    this.registrations.set(id, {
      root,
      canonicalRoot,
      allowWrite,
      allowDevelopment: false,
      source: "managed"
    });
    this.canonicalRoots.set(canonicalRoot, id);
  }

  sourceOf(workspaceId: string): "manual" | "managed" {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    return registration.source;
  }

  authorizeWrite(workspaceId: string): void {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new CoreError("UNKNOWN_WORKSPACE");
    if (registration.source !== "managed") throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
    registration.allowWrite = true;
  }
}

function bestEffortCanonicalRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}
