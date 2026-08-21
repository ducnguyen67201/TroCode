import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  WorkspaceSelectionSchema,
  type WorkspaceIdentity,
  type WorkspaceRuntimeAvailability,
  type WorkspaceSelection,
} from '../../shared/contracts';

import type { WorkspaceSelectionStore } from './workspace-selection-store';

export interface WorkspaceDirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

const WORKSPACE_AVAILABILITY: WorkspaceRuntimeAvailability = {
  available: true,
  runtimeVersion: null,
  summary: 'Workspace mode is available through the Tro service.',
};

export class WorkspaceSelectionService {
  private readonly selections = new Map<string, WorkspaceIdentity>();
  private loaded = false;

  constructor(
    private readonly picker: WorkspaceDirectoryPicker,
    private readonly now: () => Date = () => new Date(),
    private readonly store?: WorkspaceSelectionStore,
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
    await this.load();
    const canonicalPath = await this.canonicalDirectory(candidate);
    const identity: WorkspaceIdentity = {
      selectionId: randomUUID(),
      canonicalPath,
      displayName: path.basename(canonicalPath) || canonicalPath,
      selectedAt: this.now().toISOString(),
    };
    this.selections.set(identity.selectionId, identity);
    await this.persist();
    return WorkspaceSelectionSchema.parse({
      ...identity,
      runtime: WORKSPACE_AVAILABILITY,
    });
  }

  async resolve(selectionId: string): Promise<WorkspaceIdentity> {
    await this.load();
    const selected = this.selections.get(selectionId);
    if (!selected) {
      throw new Error(
        'The workspace selection is missing or no longer trusted. Select the folder again.',
      );
    }
    const canonicalPath = await this.canonicalDirectory(selected.canonicalPath);
    if (canonicalPath !== selected.canonicalPath) {
      this.selections.delete(selectionId);
      await this.persist();
      throw new Error('The selected workspace changed. Select the folder again.');
    }
    return selected;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.store?.read() ?? [];
    for (const selection of stored) {
      this.selections.set(selection.selectionId, selection);
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.store?.write([...this.selections.values()].slice(-50));
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
