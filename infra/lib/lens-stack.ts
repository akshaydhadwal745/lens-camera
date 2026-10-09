import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CfnOutput,
  Duration,
  Fn,
  Size,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_batch as batch,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_ses as ses,
  aws_budgets as budgets,
  aws_certificatemanager as acm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const PRIVATE_KEY_PARAM = '/lens/cloudfront/private-key';
/** Secret for signed streaming links (gitignored file; same value in SSM for the API). */
const STREAM_KEY_FILE = path.join(__dirname, '../keys/stream-token.key');
/** Shared secret CloudFront adds on /api requests (gitignored; `openssl rand -hex 32`). */
const EDGE_SECRET_FILE = path.join(__dirname, '../keys/edge-secret.key');
const STREAM_KEY_PARAM = '/lens/stream/token-key';
/** The built website: Astro site + the Expo web app under app/ (see scripts/build-web.sh). */
const WEB_DIST = path.join(__dirname, '../../site/dist');

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
      // Versioning makes deletes/overwrites recoverable for 30 days; originals
      // are never overwritten, so this costs nothing until something is deleted.
      versioned: true,
      lifecycleRules: [
        // Big uploads can pause for days (phone offline); give them a week.
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { noncurrentVersionExpiration: Duration.days(30), expiredObjectDeleteMarker: true },
        // Streaming copies (HLS) are re-made on demand: keep them 90 days.
        { prefix: 'h/', expiration: Duration.days(90) },
      ],
      // Deleted items whose 30-day Trash ended are tagged lens-archive=1 and
      // sink to the Deep Archive Access tier (~$0.002/GB-month) after 180 days
      // unread. Free to restore (~12 h); no transition or retrieval fees.
      intelligentTieringConfigurations: [
        {
          name: 'deleted-archive',
          tags: [{ key: 'lens-archive', value: '1' }],
          deepArchiveAccessTierTime: Duration.days(180),
        },
      ],
    });

    const webBucket = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Audit trail for referral rewards, commissions and payouts. Object Lock keeps
    // every event for 8 years (Indian books-of-account retention); events are tiny.
    // GOVERNANCE while testing (only a special IAM permission can remove test
    // events); switch to COMPLIANCE (nobody, not even root) before launch.
    const auditBucket = new s3.Bucket(this, 'Audit', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.governance(Duration.days(8 * 365)),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'AuditBucketName', { value: auditBucket.bucketName });

    const table = new dynamodb.TableV2(this, 'Table', {
      tableName: 'Lens',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      // Metadata is what makes the media findable; keep 35 days of restore points.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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

    // ---------- Website routing ----------
    // Static site (Astro, /…/index.html), the web app SPA under /app/, and the
    // QR landing /l/<id>/. Clean URLs always end in "/" (one URL per page for
    // search engines); with a custom domain, the cloudfront.net host redirects to it.
    const webDomain = (this.node.tryGetContext('webDomain') as string | undefined) ?? '';
    const certificateArn = (this.node.tryGetContext('webCertificateArn') as string | undefined) ?? '';
    const canonical = webDomain && certificateArn ? webDomain : '';
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
var CANONICAL = '${canonical}';
function query(qs) {
  var parts = [];
  for (var k in qs) {
    var v = qs[k];
    if (v.multiValue) v.multiValue.forEach(function (m) { parts.push(k + '=' + m.value); });
    else parts.push(v.value === '' ? k : k + '=' + v.value);
  }
  return parts.length ? '?' + parts.join('&') : '';
}
function redirect(location) {
  return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: location }, 'cache-control': { value: 'max-age=3600' } } };
}
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  var host = req.headers.host ? req.headers.host.value : '';
  if (CANONICAL && host !== CANONICAL) return redirect('https://' + CANONICAL + uri + query(req.querystring));
  if (uri === '/app') return redirect('/app/' + query(req.querystring));
  // Old web-app addresses (before the site existed at the root).
  if (uri === '/link' || uri === '/link/') return redirect('/signin/');
  if (/^\\/(gallery|settings|trash|storage|share|viewer)(\\/|$)/.test(uri)) return redirect('/app' + uri);
  if (uri.indexOf('/app/') === 0) {
    if (uri.slice(uri.lastIndexOf('/') + 1).indexOf('.') === -1) req.uri = '/app/index.html';
    return req;
  }
  if (uri.indexOf('/l/') === 0) {
    req.uri = '/l/index.html';
    return req;
  }
  if (uri.charAt(uri.length - 1) === '/') {
    req.uri = uri + 'index.html';
    return req;
  }
  if (uri.slice(uri.lastIndexOf('/') + 1).indexOf('.') === -1) return redirect(uri + '/' + query(req.querystring));
  return req;
}`),
    });
    // Security headers for every page (pages add their own script/style CSP hashes).
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'WebSecurityHeaders', {
      comment: 'Lens website security headers',
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'permissions-policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true },
          { header: 'cross-origin-opener-policy', value: 'same-origin', override: true },
        ],
      },
    });

    const mediaOrigin = origins.S3BucketOrigin.withOriginAccessControl(mediaBucket);

    // Streaming (HLS): /t/{exp}-{sig}/h/{owner}/{id}/… The token signs the video's
    // folder, so the playlist's relative segment URLs inherit it; the function
    // checks it and strips it before the cache, so all viewers share the cache.
    const streamKey = fs.existsSync(STREAM_KEY_FILE) ? fs.readFileSync(STREAM_KEY_FILE, 'utf8').trim() : '';
    const streamAuth = new cloudfront.Function(this, 'StreamAuth', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
var crypto = require('crypto');
var KEY = '${streamKey}';
function handler(event) {
  var req = event.request;
  var m = req.uri.match(/^\\/t\\/(\\d+)-([0-9a-f]{32})(\\/h\\/[^\\/]+\\/[^\\/]+\\/)(.+)$/);
  if (!KEY || !m) return { statusCode: 403, statusDescription: 'Forbidden' };
  if (parseInt(m[1], 10) * 1000 < Date.now()) return { statusCode: 403, statusDescription: 'Expired' };
  var sig = crypto.createHmac('sha256', KEY).update(m[1] + ':' + m[3]).digest('hex').substring(0, 32);
  if (sig !== m[2]) return { statusCode: 403, statusDescription: 'Forbidden' };
  req.uri = m[3] + m[4];
  return req;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Lens website + web app + signed media',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes India edges
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultRootObject: 'index.html',
      ...(canonical
        ? { domainNames: [canonical], certificate: acm.Certificate.fromCertificateArn(this, 'WebCertificate', certificateArn) }
        : {}),
      // Unknown pages: the site's own 404 page with a real 404 status. (S3 answers
      // 404 because CloudFront may list the web bucket; see the policy below.)
      errorResponses: [{ httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) }],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      // m/* originals, d/* derivatives (thumbnail/preview): both private, signed URLs only.
      additionalBehaviors: {
        ...Object.fromEntries(
          ['m/*', 'd/*'].map((pattern) => [
            pattern,
            {
              origin: mediaOrigin,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
              cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
              trustedKeyGroups: [keyGroup],
            },
          ]),
        ),
        't/*': {
          origin: mediaOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [{ function: streamAuth, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
      },
    });

    // ---------- API ----------
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Sign-in codes are emailed from our own domain (cdk.json context
    // `codeDomain`, sender `no-reply@<domain>`). SES verifies the domain via 3
    // DKIM CNAME records (printed as outputs) that go into the domain's DNS.
    // SES in this account/region (ap-south-1) has production access (67k/day).
    const codeDomain = this.node.tryGetContext('codeDomain') as string | undefined;
    const codeSender = codeDomain ? `no-reply@${codeDomain}` : undefined;
    const senderIdentity = codeDomain
      ? new ses.EmailIdentity(this, 'CodeDomain', { identity: ses.Identity.domain(codeDomain) })
      : undefined;

    // ---------- Video streaming: lazy HLS transcode on AWS Batch (Fargate Spot) ----------
    // Public subnets only (no NAT gateway cost); tasks get a public IP to reach S3/ECR.
    const batchVpc = new ec2.Vpc(this, 'BatchVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });
    const computeEnv = (id: string, spot: boolean) =>
      new batch.FargateComputeEnvironment(this, id, {
        vpc: batchVpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        spot,
        maxvCpus: 32,
      });
    // Spot first (~70% cheaper); the API re-submits to on-demand after a failed Spot run.
    const spotQueue = new batch.JobQueue(this, 'TranscodeSpot', {
      computeEnvironments: [{ computeEnvironment: computeEnv('FargateSpot', true), order: 1 }],
    });
    const onDemandQueue = new batch.JobQueue(this, 'TranscodeOnDemand', {
      computeEnvironments: [{ computeEnvironment: computeEnv('FargateOnDemand', false), order: 1 }],
    });
    const transcoderImage = new ecrAssets.DockerImageAsset(this, 'TranscoderImage', {
      directory: path.join(__dirname, '../transcoder'),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });
    const transcodeRole = new iam.Role(this, 'TranscodeJobRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    mediaBucket.grantRead(transcodeRole, 'm/*');
    mediaBucket.grantPut(transcodeRole, 'h/*');
    table.grantWriteData(transcodeRole);
    const transcodeJob = new batch.EcsJobDefinition(this, 'TranscodeJob', {
      container: new batch.EcsFargateContainerDefinition(this, 'TranscodeContainer', {
        image: ecs.ContainerImage.fromDockerImageAsset(transcoderImage),
        cpu: 4,
        memory: Size.gibibytes(8),
        ephemeralStorageSize: Size.gibibytes(100),
        assignPublicIp: true,
        jobRole: transcodeRole,
        fargateCpuArchitecture: ecs.CpuArchitecture.X86_64,
        environment: { BUCKET: mediaBucket.bucketName, TABLE: table.tableName },
      }),
      // Spot interruptions and transient errors: Batch retries (the script is idempotent).
      retryAttempts: 3,
      timeout: Duration.hours(3),
    });

    const edgeSecret = fs.existsSync(EDGE_SECRET_FILE) ? fs.readFileSync(EDGE_SECRET_FILE, 'utf8').trim() : '';

    // Per-identity storage quota (testing default 100 GB; becomes the free tier later).
    const quotaGb = Number(this.node.tryGetContext('quotaGb') ?? 100);

    const apiEnv = {
      TABLE: table.tableName,
      BUCKET: mediaBucket.bucketName,
      // A literal (context), not a reference: CloudFront also routes /api to this
      // function, and a reference both ways would be a dependency cycle.
      CDN_DOMAIN: (this.node.tryGetContext('cdnDomain') as string | undefined) ?? distribution.distributionDomainName,
      WEB_ORIGIN: (this.node.tryGetContext('webOrigin') as string | undefined) ?? '',
      EDGE_SECRET: edgeSecret,
      CF_KEY_PAIR_ID: publicKey.publicKeyId,
      CF_PRIVATE_KEY_PARAM: PRIVATE_KEY_PARAM,
      QUOTA_BYTES: String(quotaGb * 1024 ** 3),
      // Guests (not signed in) get this much Lens storage, pooled per device fingerprint.
      GUEST_QUOTA_BYTES: String(Number(this.node.tryGetContext('guestQuotaGb') ?? 5) * 1024 ** 3),
      MAX_FILE_BYTES: String(1024 ** 4), // 1 TiB per file
      CODE_SENDER: codeSender ?? '',
      TRANSCODE_QUEUE_SPOT: spotQueue.jobQueueArn,
      TRANSCODE_QUEUE_ONDEMAND: onDemandQueue.jobQueueArn,
      TRANSCODE_JOB: transcodeJob.jobDefinitionArn,
      STREAM_KEY_PARAM,
      AUDIT_BUCKET: auditBucket.bucketName,
      // Who may open /admin (comma-separated emails).
      ADMIN_EMAILS: (this.node.tryGetContext('adminEmails') as string | undefined) ?? '',
      // Play Store listing for invite/affiliate links; empty until the app is published.
      PLAY_URL: (this.node.tryGetContext('playUrl') as string | undefined) ?? '',
      // Contact-form messages are emailed here (Reply-To = the sender).
      CONTACT_TO: (this.node.tryGetContext('contactEmail') as string | undefined) ?? '',
    };

    const api = new nodejs.NodejsFunction(this, 'Api', {
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60), // sign-in may move a guest's records into an account
      logGroup,
      environment: apiEnv,
      bundling: { minify: true, sourceMap: true, target: 'node24', loader: { '.txt': 'text' } },
    });

    // Daily: Trash → Archive after 30 days, finish recoveries, purge after a year.
    const maintenance = new nodejs.NodejsFunction(this, 'Maintenance', {
      entry: path.join(__dirname, '../lambda/api/maintenance.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(10),
      logGroup,
      environment: apiEnv,
      bundling: { minify: true, sourceMap: true, target: 'node24', loader: { '.txt': 'text' } },
    });
    // The e2e test runs it with a simulated date for its own throwaway identity.
    maintenance.addPermission('DeveloperInvoke', {
      principal: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:role/lens-developer`),
    });
    new events.Rule(this, 'DailyMaintenance', {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new targets.LambdaFunction(maintenance)],
    });

    // Account deletion: the API hands off to Maintenance, which may continue itself.
    api.addEnvironment('MAINTENANCE_FUNCTION', maintenance.functionName);
    maintenance.grantInvoke(api);
    maintenance.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        // By name pattern: referencing its own ARN would be a dependency cycle.
        resources: [`arn:aws:lambda:${this.region}:${this.account}:function:Lens-Maintenance*`],
      }),
    );

    for (const fn of [api, maintenance]) {
      table.grantReadWriteData(fn);
      auditBucket.grantPut(fn, 'audit/*');
      mediaBucket.grantReadWrite(fn); // presigned PUT/multipart, Head, Delete, tagging, versions
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:RestoreObject'], resources: [mediaBucket.arnForObjects('m/*')] }));
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['batch:SubmitJob'],
          resources: [spotQueue.jobQueueArn, onDemandQueue.jobQueueArn, transcodeJob.jobDefinitionArn],
        }),
      );
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['batch:DescribeJobs'], resources: ['*'] }));
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${PRIVATE_KEY_PARAM}`,
          // OAuth client ids/secrets for connecting user storages (set with scripts/set-oauth-client.sh).
          `arn:aws:ssm:${this.region}:${this.account}:parameter/lens/oauth/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter${STREAM_KEY_PARAM}`,
        ],
        }),
      );
    }

    const apiUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // auth is the device token, checked in the handler
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    // ---------- Website API: /api/* on the same domain as the site ----------
    // Same origin = the website's session can be an HttpOnly, SameSite=Strict
    // cookie (no CORS, no token in localStorage). Phones keep calling the
    // Function URL directly with bearer tokens.
    const apiRewrite = new cloudfront.Function(this, 'ApiRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  req.uri = req.uri.replace(/^\\/api/, '') || '/';
  return req;
}`),
    });
    const apiOriginPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginPolicy', {
      comment: 'Lens website API: cookies, query, and the headers the API reads',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      // No Host header: the Function URL only answers on its own host name.
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'user-agent',
        'content-type',
        'accept-language',
        'x-login-secret',
        'x-lens-web',
        'cloudfront-viewer-address',
        'cloudfront-viewer-city',
        'cloudfront-viewer-country',
      ),
    });
    distribution.addBehavior(
      '/api/*',
      new origins.HttpOrigin(Fn.select(2, Fn.split('/', apiUrl.url)), {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        customHeaders: edgeSecret ? { 'x-lens-edge': edgeSecret } : undefined,
      }),
      {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: apiOriginPolicy,
        functionAssociations: [{ function: apiRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    );

    // Invite (/r/<code>) and affiliate (/go/<code>) links: the API counts the
    // click, sets the attribution cookie on this domain and redirects.
    const linkRewrite = new cloudfront.Function(this, 'LinkRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  req.uri = '/v1' + req.uri.replace(/\\/+$/, '');
  return req;
}`),
    });
    for (const pattern of ['/r/*', '/go/*']) {
      distribution.addBehavior(
        pattern,
        new origins.HttpOrigin(Fn.select(2, Fn.split('/', apiUrl.url)), {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          customHeaders: edgeSecret ? { 'x-lens-edge': edgeSecret } : undefined,
        }),
        {
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginPolicy,
          functionAssociations: [{ function: linkRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
      );
    }

    // Missing website files answer 404 (not 403), so the 404 page shows.
    webBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [webBucket.bucketArn],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: { StringEquals: { 'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}` } },
      }),
    );

    // ---------- Website deploys from GitHub Actions (no stored keys) ----------
    // The repo's main branch may only sync the web bucket and clear the CDN cache.
    const github = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const webDeployRole = new iam.Role(this, 'WebDeployRole', {
      roleName: 'lens-web-deploy',
      description: 'GitHub Actions (main branch) deploys the Lens website',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        // Only this repository's main branch. GitHub's subject includes the owner
        // and repository ids (immutable: survives renames, blocks look-alikes).
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': 'repo:akshaydhadwal745@204663223/lens-camera@1408539654:ref:refs/heads/main',
        },
      }),
    });
    webBucket.grantReadWrite(webDeployRole);
    webBucket.grantDelete(webDeployRole);
    webDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
      }),
    );
    new CfnOutput(this, 'WebBucket', { value: webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'WebDeployRoleArn', { value: webDeployRole.roleArn });

    // ---------- Website (local deploys; CI normally syncs site/dist instead) ----------
    if (process.env.LENS_DEPLOY_WEB === '1' && fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'WebDeploy', {
        sources: [s3deploy.Source.asset(WEB_DIST)],
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 256,
      });
    }

    // ---------- Cost guardrails ----------
    // AWS Budgets: the first two budgets are free. Alerts at 50/80/100% of
    // actual spend and when the month is forecast to exceed the limit.
    const alertEmail = this.node.tryGetContext('alertEmail') as string | undefined;
    const monthlyBudgetUsd = Number(this.node.tryGetContext('monthlyBudgetUsd') ?? 10);
    if (alertEmail) {
      const subscribers = [{ subscriptionType: 'EMAIL', address: alertEmail }];
      const notify = (threshold: number, notificationType: 'ACTUAL' | 'FORECASTED') => ({
        notification: { comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE', notificationType },
        subscribers,
      });
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'lens-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [notify(50, 'ACTUAL'), notify(80, 'ACTUAL'), notify(100, 'ACTUAL'), notify(100, 'FORECASTED')],
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: apiUrl.url });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'MediaBucket', { value: mediaBucket.bucketName });
    new CfnOutput(this, 'MaintenanceFunction', { value: maintenance.functionName });
    // DNS records that prove we own the sign-in email domain (add as CNAMEs).
    senderIdentity?.dkimRecords.forEach((r, i) =>
      new CfnOutput(this, `CodeDomainDkim${i + 1}`, { value: `${r.name} CNAME ${r.value}` }),
    );
  }
}
