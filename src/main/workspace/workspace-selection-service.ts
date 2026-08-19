import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  WorkspaceSelectionSchema,
  type WorkspaceIdentity,
  type WorkspaceRuntimeAvailability,
  type WorkspaceSelection,
} from '../../shared/contracts';

export interface WorkspaceDirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

const WORKSPACE_AVAILABILITY: WorkspaceRuntimeAvailability = {
  available: true,
  runtimeVersion: null,
  summary: 'Workspace mode is available through the TroCode service.',
};

export class WorkspaceSelectionService {
  private readonly selections = new Map<string, WorkspaceIdentity>();

  constructor(
    private readonly picker: WorkspaceDirectoryPicker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async availability(): Promise<WorkspaceRuntimeAvailability> {
    return WORKSPACE_AVAILABILITY;
  }

  async select(): Promise<WorkspaceSelection | null> {
    const selectedPath = await this.picker.pickDirectory();
    if (!selectedPath) return null;
    return this.registerTrustedDirectory(selectedPath);
  }

  async selectTrustedParent(): Promise<string | null> {
    const selectedPath = await this.picker.pickDirectory();
    return selectedPath ? this.canonicalDirectory(selectedPath) : null;
  }

  async registerTrustedDirectory(candidate: string): Promise<WorkspaceSelection> {
    const canonicalPath = await this.canonicalDirectory(candidate);
    const identity: WorkspaceIdentity = {
      selectionId: randomUUID(),
      canonicalPath,
      displayName: path.basename(canonicalPath) || canonicalPath,
      selectedAt: this.now().toISOString(),
    };
    this.selections.set(identity.selectionId, identity);
    return WorkspaceSelectionSchema.parse({
      ...identity,
      runtime: WORKSPACE_AVAILABILITY,
    });
  }

  async resolve(selectionId: string): Promise<WorkspaceIdentity> {
    const selected = this.selections.get(selectionId);
    if (!selected) {
      throw new Error(
        'The workspace selection is missing or no longer trusted. Select the folder again.',
      );
    }
    const canonicalPath = await this.canonicalDirectory(selected.canonicalPath);
    if (canonicalPath !== selected.canonicalPath) {
      this.selections.delete(selectionId);
      throw new Error('The selected workspace changed. Select the folder again.');
    }
    return selected;
  }

  private async canonicalDirectory(candidate: string): Promise<string> {
    if (!path.isAbsolute(candidate)) {
      throw new Error('A workspace must be selected through an absolute host path.');
    }
    const canonicalPath = await realpath(candidate);
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error('The selected workspace is not a directory.');
    }
    return canonicalPath;
  }
}
