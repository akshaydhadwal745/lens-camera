// Long Maintenance jobs (Drive moves, exports) hand over to a fresh run before the 10-minute limit.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from './lib';

const lambda = new LambdaClient({});

export async function lambdaContinue(event: Record<string, unknown>) {
  if (!env.maintenanceFunction) return;
  await lambda.send(new InvokeCommand({ FunctionName: env.maintenanceFunction, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(event)) }));
}
