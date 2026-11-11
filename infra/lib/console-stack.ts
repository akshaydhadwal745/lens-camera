import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CfnOutput,
  Duration,
  Size,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

// Lens Console (console.lens.instagrowapp.com): the admin control centre, deployed apart from
// the Lens app and website. Own CloudFront + origin (user-site scripts can never reach its
// cookies), own Lambda and IAM role. The role has NO access to the media bucket: the console
// can't show anyone's photos or videos, by construction (owner's rule, docs/design/admin-console.md).
const EDGE_SECRET_FILE = path.join(__dirname, '../keys/console-edge-secret.key');
const PRIVATE_KEY_PARAM = '/lens/cloudfront/private-key';
const CONSOLE_PARAMS = '/lens/console';
const CONSOLE_APP = path.join(__dirname, '../../console');
const DIST = path.join(CONSOLE_APP, 'dist');

/** The newest modification time of any file under `dir` (ms). */
function newest(dir: string): number {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
    const p = path.join(dir, e.name);
    return Math.max(m, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }, 0);
}

/** The deploy uploads console/dist as it is on this machine, so rebuild it when the source is newer
 * (on 2026-11-02 a deploy shipped a build from three days before). */
function freshConsoleBuild() {
  const index = path.join(DIST, 'index.html');
  const built = fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0;
  const changed = Math.max(newest(path.join(CONSOLE_APP, 'src')), ...['index.html', 'package.json', 'vite.config.ts'].map((f) => fs.statSync(path.join(CONSOLE_APP, f)).mtimeMs));
  if (changed > built) execSync('npm run build', { cwd: CONSOLE_APP, stdio: 'inherit' });
}

export type ConsoleStackProps = StackProps & {
  domain: string;
  certificateArn: string;
  tableName: string;
  mediaBucketName: string;
  auditBucketName: string;
  feedbackBucketName: string;
  /** System health: "label=name" lists (functions, Batch queue ARNs) and the website CDN id. */
  health: { functions: string[]; queues: string[]; distributionId: string };
};

export class ConsoleStack extends Stack {
  constructor(scope: Construct, id: string, props: ConsoleStackProps) {
    super(scope, id, props);
    const origin = `https://${props.domain}`;
    const edgeSecret = fs.existsSync(EDGE_SECRET_FILE) ? fs.readFileSync(EDGE_SECRET_FILE, 'utf8').trim() : '';
    if (!edgeSecret) throw new Error(`Missing ${EDGE_SECRET_FILE} (openssl rand -hex 32 > it)`);

    const table = dynamodb.Table.fromTableAttributes(this, 'Table', { tableName: props.tableName, globalIndexes: ['gsi1'] });

    // Content engine files (docs/growth/content-engine.md): a/ assets (uploads, renders, licensed media),
    // e/ licence evidence, x/ export zips (30 days). Private; the Console shows them through 5-minute signed CloudFront links.
    const content = new s3.Bucket(this, 'GrowthContent', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [origin], allowedHeaders: ['content-type'], maxAge: 3600 }],
      lifecycleRules: [
        { prefix: 'x/', expiration: Duration.days(30) },
        { prefix: 'u/', expiration: Duration.days(1) },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });
    const contentHost = `https://${content.bucketRegionalDomainName}`; // uploads only (browser PUT to u/)
    // Viewing goes through the Console's own CloudFront with signed links (same private key as Lens media).
    const fileKey = new cloudfront.PublicKey(this, 'FileSigningKey', {
      encodedKey: fs.readFileSync(path.join(__dirname, '../keys/cloudfront-public.pem'), 'utf8'),
      comment: 'Lens Console signed file links',
    });
    const fileKeys = new cloudfront.KeyGroup(this, 'FileSigningKeys', { items: [fileKey] });

    const fn = new nodejs.NodejsFunction(this, 'ConsoleApi', {
      entry: path.join(__dirname, '../lambda/console/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60), // the hourly alerts run reads Health and Sentry
      logGroup: new logs.LogGroup(this, 'ConsoleApiLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        TABLE: props.tableName,
        // Only for its CloudWatch size metric: no read/write permission on it below.
        BUCKET: props.mediaBucketName,
        AUDIT_BUCKET: props.auditBucketName,
        // Screenshots users attach to feedback: the only user images it may read.
        FEEDBACK_BUCKET: props.feedbackBucketName,
        GROWTH_CONTENT_BUCKET: content.bucketName,
        ADMIN_EMAILS: (this.node.tryGetContext('adminEmails') as string | undefined) ?? '',
        EDGE_SECRET: edgeSecret,
        CONSOLE_ORIGIN: origin,
        CONSOLE_PARAMS,
        // Affiliate payout details are sealed with a key derived from this (affiliates.ts).
        CF_PRIVATE_KEY_PARAM: PRIVATE_KEY_PARAM,
        CF_KEY_PAIR_ID: fileKey.publicKeyId,
        WEB_ORIGIN: (this.node.tryGetContext('webOrigin') as string | undefined) ?? '',
        CODE_SENDER: `no-reply@${(this.node.tryGetContext('codeDomain') as string | undefined) ?? ''}`,
        PLAY_URL: (this.node.tryGetContext('playUrl') as string | undefined) ?? '',
        HEALTH_FUNCTIONS: props.health.functions.join(','),
        HEALTH_QUEUES: props.health.queues.join(','),
        HEALTH_DISTRIBUTION: props.health.distributionId,
        MONTHLY_BUDGET_USD: String(this.node.tryGetContext('monthlyBudgetUsd') ?? ''),
      },
      bundling: { minify: true, sourceMap: true, target: 'node24', loader: { '.txt': 'text' } },
    });
    table.grantReadWriteData(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [`arn:aws:s3:::${props.auditBucketName}/audit/*`] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [`arn:aws:s3:::${props.feedbackBucketName}/f/*`] }));
    // Content files: people upload to u/ (moved to a/ once checked), view a/ e/ x/, delete unused assets.
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'], resources: [content.arnForObjects('u/*'), content.arnForObjects('a/*')] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [content.arnForObjects('e/*'), content.arnForObjects('x/*')] }));
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
    // Health (read-only service metrics) and costs. None of these can read user data.
    fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricData', 'batch:ListJobs', 'ses:GetAccount', 'ce:GetCostAndUsage', 'ce:GetCostForecast'], resources: ['*'] }),
    );
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`] }));
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    // Hourly: email the owners about red health checks, app error spikes, unhandled reports (alerts.ts).
    new events.Rule(this, 'ConsoleAlerts', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn, { event: events.RuleTargetInput.fromObject({ alerts: true }) })],
    });

    // ---------- Growth analyst (docs/growth/growth-engine.md §2) ----------
    // Weekly growth report: facts computed by code, then written up by the Claude Code CLI with the
    // owner's subscription token. A container because the CLI is a ~230 MB native binary.
    const growth = new lambda.DockerImageFunction(this, 'GrowthAnalyst', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..'), {
        file: 'growth-image/Dockerfile',
        exclude: ['node_modules', 'cdk.out', 'scripts', 'keys', 'test', '*.log'],
        platform: ecrAssets.Platform.LINUX_AMD64,
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008, // reels: Chromium and ffmpeg together; more memory also means more CPU
      ephemeralStorageSize: Size.gibibytes(4), // reels: footage frames in /tmp
      timeout: Duration.minutes(15),
      // A failed run emails the owners and clears its lock; an automatic retry would run Claude and email twice.
      retryAttempts: 0,
      logGroup: new logs.LogGroup(this, 'GrowthAnalystLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        TABLE: props.tableName,
        AUDIT_BUCKET: props.auditBucketName,
        GROWTH_CONTENT_BUCKET: content.bucketName,
        ADMIN_EMAILS: (this.node.tryGetContext('adminEmails') as string | undefined) ?? '',
        CONSOLE_ORIGIN: origin,
        WEB_ORIGIN: (this.node.tryGetContext('webOrigin') as string | undefined) ?? '',
        CODE_SENDER: `no-reply@${(this.node.tryGetContext('codeDomain') as string | undefined) ?? ''}`,
        // Signed CloudFront links Instagram fetches the reel / images from (growth-instagram.ts).
        CF_PRIVATE_KEY_PARAM: PRIVATE_KEY_PARAM,
        CF_KEY_PAIR_ID: fileKey.publicKeyId,
      },
    });
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PRIVATE_KEY_PARAM}`] }));
    // The developer role (Claude on the owner's PC) can start content jobs (images, reels) to test them.
    growth.addPermission('DeveloperInvoke', {
      principal: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:role/lens-developer`),
    });
    // Reads the whole table (facts); writes only its own GROWTH rows, so even a misled analyst can't
    // touch accounts, sessions or anything else.
    table.grantReadData(growth);
    growth.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        resources: [table.tableArn],
        conditions: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['GROWTH'] } },
      }),
    );
    growth.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/lens/growth/*`] }),
    );
    // Content engine: renders, licensed media and their evidence, export zips.
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:GetObject'], resources: [content.arnForObjects('a/*'), content.arnForObjects('e/*'), content.arnForObjects('x/*')] }));
    // A reel runs in steps; each step starts the next one as a fresh call (growth-reel-job.ts). By name pattern, so the
    // role doesn't depend on the function it belongs to.
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [`arn:aws:lambda:${this.region}:${this.account}:function:LensConsole-GrowthAnalyst*`] }));
    // Reel voiceover (growth-voice.ts): Polly's generative voices, synthesis only (no lexicons, no storage).
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`] }));
    // Mondays 02:30 UTC (08:00 IST), after the daily Search Console pull.
    new events.Rule(this, 'WeeklyGrowthReport', {
      schedule: events.Schedule.cron({ weekDay: 'MON', hour: '2', minute: '30' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ growth: true, ai: true, by: 'schedule' }), retryAttempts: 0 })],
    });
    // The content chain: "Make content" on a moment drafts, then makes images, then the reel, one step per tick
    // (growth-chain.ts). An idle tick is a couple of DynamoDB reads (about $0.20 a month).
    // Instagram token (growth-instagram.ts): renewed every Sunday; the engine writes only this one parameter.
    growth.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:PutParameter'], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/lens/growth/instagram`] }));
    new events.Rule(this, 'GrowthInstagramRefresh', {
      schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ igRefresh: true }), retryAttempts: 0 })],
    });
    // Daily reel (growth-daily.ts): 02:00 UTC (07:30 IST); the content chain makes it, the quality gate posts it at 18:30 IST.
    new events.Rule(this, 'GrowthDaily', {
      schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ dailyContent: true }), retryAttempts: 0 })],
    });
    // Sound trends (growth-sound-trends.ts): Mondays 03:30 UTC, the styles reels' music searches try first.
    new events.Rule(this, 'GrowthSoundTrends', {
      schedule: events.Schedule.cron({ weekDay: 'MON', hour: '3', minute: '30' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ soundTrends: true }), retryAttempts: 0 })],
    });
    // The brain (growth-brain.ts): Mondays 04:00 UTC, after the weekend's results are in.
    new events.Rule(this, 'GrowthBrain', {
      schedule: events.Schedule.cron({ weekDay: 'MON', hour: '4', minute: '0' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ brain: true }), retryAttempts: 0 })],
    });
    // Weekly event scout (growth-scout.ts): Claude searches the web for concerts, tours, festivals and parties.
    new events.Rule(this, 'GrowthEventScout', {
      schedule: events.Schedule.cron({ weekDay: 'MON,THU', hour: '2', minute: '30' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ eventScout: true }), retryAttempts: 0 })],
    });
    new events.Rule(this, 'GrowthContentChain', {
      schedule: events.Schedule.rate(Duration.minutes(10)),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ contentChain: true }), retryAttempts: 0 })],
    });
    // The month-in-review: the 1st of each month, 03:30 UTC (09:00 IST).
    new events.Rule(this, 'MonthlyGrowthReview', {
      schedule: events.Schedule.cron({ day: '1', hour: '3', minute: '30' }),
      targets: [new targets.LambdaFunction(growth, { event: events.RuleTargetInput.fromObject({ monthly: true, by: 'schedule' }), retryAttempts: 0 })],
    });
    fn.addEnvironment('GROWTH_FUNCTION', growth.functionName);
    growth.grantInvoke(fn);

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
            `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self' ${contentHost}; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
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

    // Files share the Console's address, so nothing in them may run there: a sandbox CSP on every response.
    const fileHeaders = new cloudfront.ResponseHeadersPolicy(this, 'ConsoleFileHeaders', {
      comment: 'Lens Console content files',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox", override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
      },
      customHeadersBehavior: { customHeaders: [{ header: 'x-robots-tag', value: 'noindex, nofollow', override: true }] },
    });
    const contentOrigin = origins.S3BucketOrigin.withOriginAccessControl(content);
    // Not cached: making images again replaces a file at the same address.
    const fileBehavior = {
      origin: contentOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      trustedKeyGroups: [fileKeys],
      responseHeadersPolicy: fileHeaders,
    };

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
        '/a/*': fileBehavior,
        '/e/*': fileBehavior,
        '/x/*': fileBehavior,
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

    freshConsoleBuild();
    if (fs.existsSync(path.join(DIST, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'ConsoleDeploy', {
        sources: [s3deploy.Source.asset(DIST)],
        destinationBucket: site,
        // Browsers check for a newer index.html on every visit, so people get a deploy at once
        // (without it Chrome kept showing the previous Console after a deploy).
        cacheControl: [s3deploy.CacheControl.noCache()],
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      });
    }

    new CfnOutput(this, 'ConsoleUrl', { value: origin });
    new CfnOutput(this, 'ConsoleCdnDomain', { value: distribution.distributionDomainName });
  }
}
