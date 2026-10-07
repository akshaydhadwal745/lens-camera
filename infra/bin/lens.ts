import { App } from 'aws-cdk-lib';

import { LensStack } from '../lib/lens-stack';

const app = new App();

new LensStack(app, 'Lens', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1' },
  description: 'Lens: cloud-first camera app (media bucket, CDN, API, data)',
  tags: { app: 'lens' },
});
