import { App } from 'aws-cdk-lib';

import { ConsoleCertStack } from '../lib/console-cert-stack';
import { ConsoleStack } from '../lib/console-stack';
import { LensStack } from '../lib/lens-stack';

const app = new App();

new LensStack(app, 'Lens', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1' },
  description: 'Lens: cloud-first camera app (media bucket, CDN, API, data)',
  tags: { app: 'lens' },
});

new ConsoleCertStack(app, 'LensConsoleCert', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1' },
  description: 'Lens Console: us-east-1 certificate for console.lens.instagrowapp.com',
  tags: { app: 'lens' },
  domain: 'console.lens.instagrowapp.com',
});

const consoleCert = app.node.tryGetContext('consoleCertificateArn') as string | undefined;
if (consoleCert) {
  new ConsoleStack(app, 'LensConsole', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1' },
    description: 'Lens Console: admin control centre (own site, API and sign-in)',
    tags: { app: 'lens' },
    domain: app.node.tryGetContext('consoleDomain') as string,
    certificateArn: consoleCert,
    tableName: 'Lens',
    mediaBucketName: 'lens-media-495026846839',
    auditBucketName: 'lens-audit3d8ade0a-gotgzbiazyz7',
  });
}
