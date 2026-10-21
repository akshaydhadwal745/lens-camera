// One parallel pass over the whole table (audiences, lifecycle notifications, console numbers).
// Fine to ~100k items; past that these move to per-day rollups (docs/design/analytics.md).
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env } from './lib';

export type Row = Record<string, any>;

/** Every row, with only `fields` (aliased: many are DynamoDB reserved words), or everything. */
export async function scanTable(fields?: string[], segments = 4): Promise<Row[]> {
  const parts = await Promise.all(
    Array.from({ length: segments }, async (_, segment) => {
      const out: Row[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const r = await ddb.send(
          new ScanCommand({
            TableName: env.table,
            Segment: segment,
            TotalSegments: segments,
            ExclusiveStartKey: start,
            ...(fields
              ? { ProjectionExpression: fields.map((_, i) => `#f${i}`).join(', '), ExpressionAttributeNames: Object.fromEntries(fields.map((f, i) => [`#f${i}`, f])) }
              : {}),
          }),
        );
        out.push(...(r.Items ?? []));
        start = r.LastEvaluatedKey;
      } while (start);
      return out;
    }),
  );
  return parts.flat();
}
