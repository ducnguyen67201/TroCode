import type {
  ComputerObservationRoute,
  SurfaceDescriptor,
  SurfaceElement,
} from '../agent/execution-contracts';

export type CuaRawSurfaceReference =
  | {
      kind: 'window';
      elementIndex: number;
      elementToken?: string;
      snapshotId: string;
    }
  | {
      kind: 'browser';
      browserRef: string;
      tabId: string;
      targetId: string;
      snapshotId: string;
    };

export interface CuaBoundReference {
  publicElement: SurfaceElement;
  raw: CuaRawSurfaceReference;
  semanticFingerprint: string;
}

export interface CuaSurfaceBinding {
  applicationId?: string;
  observationId: string;
  observationFingerprint: string;
  processId: number;
  references: Map<string, CuaBoundReference>;
  route: Extract<
    ComputerObservationRoute,
    'browser_semantic' | 'window_accessibility' | 'window_vision'
  >;
  surface: SurfaceDescriptor;
  surfaceIdentityHash: string;
  taskId: string;
  windowId: number;
}

export class CuaSurfaceReferenceStore {
  private readonly bindings = new Map<string, CuaSurfaceBinding>();

  replace(binding: CuaSurfaceBinding): void {
    this.bindings.set(binding.taskId, binding);
  }

  current(taskId: string): CuaSurfaceBinding | undefined {
    return this.bindings.get(taskId);
  }

  require(taskId: string, observationId: string): CuaSurfaceBinding {
    const binding = this.bindings.get(taskId);
    if (!binding || binding.observationId !== observationId) {
      throw new Error('The semantic surface observation is stale. Observe again.');
    }
    return binding;
  }

  resolve(
    taskId: string,
    observationId: string,
    publicRef: string,
  ): CuaBoundReference {
    const binding = this.require(taskId, observationId);
    const reference = binding.references.get(publicRef);
    if (!reference) {
      throw new Error('The semantic element reference is unavailable. Observe again.');
    }
    return reference;
  }

  findUniqueMatch(
    nextBinding: CuaSurfaceBinding,
    semanticFingerprint: string,
  ): CuaBoundReference | undefined {
    const matches = [...nextBinding.references.values()].filter(
      (reference) => reference.semanticFingerprint === semanticFingerprint,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  clearTask(taskId: string): void {
    this.bindings.delete(taskId);
  }

  clear(): void {
    this.bindings.clear();
  }
}
