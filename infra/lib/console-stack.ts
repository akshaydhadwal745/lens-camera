import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Lens Console (console.lens.instagrowapp.com): the admin control centre, deployed apart from
// the Lens app and website. Own CloudFront + origin (user-site scripts can never reach its
// cookies), own Lambda and IAM role. The role has NO access to the media bucket: the console
// can't show anyone's photos or videos, by construction (owner's rule, docs/design/admin-console.md).
const EDGE_SECRET_FILE = path.join(__dirname, '../keys/console-edge-secret.key');
const PRIVATE_KEY_PARAM = '/lens/cloudfront/private-key';
const CONSOLE_PARAMS = '/lens/console';
const DIST = path.join(__dirname, '../../console/dist');

export type ConsoleStackProps = StackProps & {
  domain: string;
  certificateArn: string;
  tableName: string;
  mediaBucketName: string;
  auditBucketName: string;
  feedbackBucketName: string;
};

export class ConsoleStack extends Stack {
  constructor(scope: Construct, id: string, props: ConsoleStackProps) {
    super(scope, id, props);
    const origin = `https://${props.domain}`;
    const edgeSecret = fs.existsSync(EDGE_SECRET_FILE) ? fs.readFileSync(EDGE_SECRET_FILE, 'utf8').trim() : '';
    if (!edgeSecret) throw new Error(`Missing ${EDGE_SECRET_FILE} (openssl rand -hex 32 > it)`);

    const table = dynamodb.Table.fromTableAttributes(this, 'Table', { tableName: props.tableName, globalIndexes: ['gsi1'] });

    const fn = new nodejs.NodejsFunction(this, 'ConsoleApi', {
      entry: path.join(__dirname, '../lambda/console/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'ConsoleApiLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        TABLE: props.tableName,
        // Only for its CloudWatch size metric: no read/write permission on it below.
        BUCKET: props.mediaBucketName,
        AUDIT_BUCKET: props.auditBucketName,
        // Screenshots users attach to feedback: the only user images it may read.
        FEEDBACK_BUCKET: props.feedbackBucketName,
        ADMIN_EMAILS: (this.node.tryGetContext('adminEmails') as string | undefined) ?? '',
        EDGE_SECRET: edgeSecret,
        CONSOLE_ORIGIN: origin,
        CONSOLE_PARAMS,
        // Affiliate payout details are sealed with a key derived from this (affiliates.ts).
        CF_PRIVATE_KEY_PARAM: PRIVATE_KEY_PARAM,
        WEB_ORIGIN: (this.node.tryGetContext('webOrigin') as string | undefined) ?? '',
        CODE_SENDER: `no-reply@${(this.node.tryGetContext('codeDomain') as string | undefined) ?? ''}`,
        PLAY_URL: (this.node.tryGetContext('playUrl') as string | undefined) ?? '',
      },
      bundling: { minify: true, sourceMap: true, target: 'node24', loader: { '.txt': 'text' } },
    });
    table.grantReadWriteData(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [`arn:aws:s3:::${props.auditBucketName}/audit/*`] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [`arn:aws:s3:::${props.feedbackBucketName}/f/*`] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${CONSOLE_PARAMS}/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter${PRIVATE_KEY_PARAM}`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/lens/fcm/*`,
        ],
      }),
    );
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricData'], resources: ['*'] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`] }));
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // ---------- Site ----------
    const site = new s3.Bucket(this, 'ConsoleSite', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const spa = new cloudfront.Function(this, 'ConsoleSpa', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  if (req.uri.slice(req.uri.lastIndexOf('/') + 1).indexOf('.') === -1) req.uri = '/index.html';
  return req;
}`),
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'ConsoleHeaders', {
      comment: 'Lens Console security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy:
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'permissions-policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true },
          { header: 'cross-origin-opener-policy', value: 'same-origin', override: true },
          { header: 'cross-origin-resource-policy', value: 'same-origin', override: true },
          { header: 'x-robots-tag', value: 'noindex, nofollow', override: true },
        ],
      },
    });

    const apiPolicy = new cloudfront.OriginRequestPolicy(this, 'ConsoleApiPolicy', {
      comment: 'Lens Console API: cookies, query, and the headers it checks',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'origin',
        'x-console',
        'user-agent',
        'content-type',
        'cloudfront-viewer-address',
        'cloudfront-viewer-city',
      ),
    });

    const distribution = new cloudfront.Distribution(this, 'ConsoleCdn', {
      comment: 'Lens Console',
      domainNames: [props.domain],
      certificate: acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: spa, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', url.url)), {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: { 'x-lens-edge': edgeSecret },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiPolicy,
          responseHeadersPolicy: headers,
        },
      },
    });

    if (fs.existsSync(path.join(DIST, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'ConsoleDeploy', {
        sources: [s3deploy.Source.asset(DIST)],
        destinationBucket: site,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      });
    }

    new CfnOutput(this, 'ConsoleUrl', { value: origin });
    new CfnOutput(this, 'ConsoleCdnDomain', { value: distribution.distributionDomainName });
  }
}
