import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
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

const PRIVATE_KEY_PARAM = '/lens/cloudfront/private-key';
const WEB_DIST = path.join(__dirname, '../../dist');

/**
 * Cost notes (kept deliberately minimal):
 * - Lambda Function URL instead of API Gateway (no per-request API fee).
 * - DynamoDB on-demand, no PITR; S3 with lifecycle cleanup of abandoned uploads.
 * - SSM Parameter Store (free) for the CloudFront signing key, not Secrets Manager.
 * - One CloudFront distribution serves both the web viewer and signed media.
 */
export class LensStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ---------- Storage ----------
    const mediaBucket = new s3.Bucket(this, 'Media', {
      bucketName: `lens-media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(3) }],
    });

    const webBucket = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const table = new dynamodb.TableV2(this, 'Table', {
      tableName: 'Lens',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'gsi1',
          partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // ---------- CDN ----------
    const publicKey = new cloudfront.PublicKey(this, 'SigningKey', {
      encodedKey: fs.readFileSync(path.join(__dirname, '../keys/cloudfront-public.pem'), 'utf8'),
      comment: 'Lens signed media URLs',
    });
    const keyGroup = new cloudfront.KeyGroup(this, 'SigningKeyGroup', { items: [publicKey] });

    // SPA routing for the web viewer: extension-less paths -> /index.html.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  if (!req.uri.includes('.')) req.uri = '/index.html';
  return req;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Lens web viewer + signed media',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes India edges
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        'm/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          trustedKeyGroups: [keyGroup],
        },
      },
    });

    // ---------- API ----------
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new nodejs.NodejsFunction(this, 'Api', {
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      logGroup,
      environment: {
        TABLE: table.tableName,
        BUCKET: mediaBucket.bucketName,
        CDN_DOMAIN: distribution.distributionDomainName,
        CF_KEY_PAIR_ID: publicKey.publicKeyId,
        CF_PRIVATE_KEY_PARAM: PRIVATE_KEY_PARAM,
        QUOTA_BYTES: String(5 * 1024 ** 3), // 5 GB per identity
        MAX_FILE_BYTES: String(2 * 1024 ** 3),
      },
      bundling: { minify: true, sourceMap: true, target: 'node24' },
    });

    table.grantReadWriteData(api);
    mediaBucket.grantReadWrite(api); // presigned PUT/multipart + HeadObject/Delete
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PRIVATE_KEY_PARAM}`],
      }),
    );

    const apiUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // auth is the device token, checked in the handler
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    // ---------- Web viewer (deployed only when `npm run build:web` has run) ----------
    if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'WebDeploy', {
        sources: [s3deploy.Source.asset(WEB_DIST)],
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 256,
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: apiUrl.url });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'MediaBucket', { value: mediaBucket.bucketName });
  }
}
