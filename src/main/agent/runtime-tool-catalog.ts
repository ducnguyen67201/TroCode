import type { StrictJsonObjectSchema } from '../../shared/agent-tool-contracts';
import type { RuntimeToolId } from '../../shared/contracts';

export interface FrozenRuntimeToolCatalog {
  digest: string;
  tools: Array<{
    completionRequired?: boolean;
    toolId: RuntimeToolId;
    modelName: string;
    description: string;
    inputSchema: StrictJsonObjectSchema;
    operations: string[];
    driverCatalogDigest: string | null;
  }>;
}
