export interface RoleSaveState {
  kind: 'error' | 'idle' | 'saved' | 'saving';
  message: string;
}

export const idleRoleState: RoleSaveState = { kind: 'idle', message: '' };
