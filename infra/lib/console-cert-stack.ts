import { CfnOutput, CustomResource, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

// The us-east-1 certificate for the Lens Console (console.lens.instagrowapp.com).
// CloudFront only takes us-east-1 certificates and CDK isn't bootstrapped there, so a
// small function in this region requests it and returns the DNS validation record
// (added once at Hostinger). The certificate is kept if this stack is ever removed.
export class ConsoleCertStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { domain: string }) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'RequestCert', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.minutes(3),
      code: lambda.Code.fromInline(`
const { ACMClient, RequestCertificateCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');
const acm = new ACMClient({ region: 'us-east-1' });
exports.handler = async (event) => {
  const domain = event.ResourceProperties.Domain;
  if (event.RequestType === 'Delete') return { PhysicalResourceId: event.PhysicalResourceId };
  let arn = event.RequestType === 'Update' && event.OldResourceProperties.Domain === domain ? event.PhysicalResourceId : undefined;
  if (!arn) {
    const r = await acm.send(new RequestCertificateCommand({
      DomainName: domain, ValidationMethod: 'DNS', KeyAlgorithm: 'RSA_2048',
      IdempotencyToken: domain.replace(/[^a-z0-9]/gi, '').slice(0, 32),
      Tags: [{ Key: 'app', Value: 'lens' }, { Key: 'use', Value: 'console' }],
    }));
    arn = r.CertificateArn;
  }
  for (let i = 0; i < 40; i++) {
    const c = (await acm.send(new DescribeCertificateCommand({ CertificateArn: arn }))).Certificate;
    const rec = c?.DomainValidationOptions?.[0]?.ResourceRecord;
    if (rec) return { PhysicalResourceId: arn, Data: { Arn: arn, RecordName: rec.Name, RecordValue: rec.Value, Status: c.Status } };
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error('No validation record yet for ' + arn);
};`),
    });
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['acm:RequestCertificate', 'acm:DescribeCertificate', 'acm:AddTagsToCertificate'], resources: ['*'] }));

    const cert = new CustomResource(this, 'Cert', {
      serviceToken: new cr.Provider(this, 'CertProvider', { onEventHandler: fn }).serviceToken,
      properties: { Domain: props.domain },
    });

    new CfnOutput(this, 'CertificateArn', { value: cert.getAttString('Arn') });
    new CfnOutput(this, 'ValidationName', { value: cert.getAttString('RecordName') });
    new CfnOutput(this, 'ValidationValue', { value: cert.getAttString('RecordValue') });
  }
}
