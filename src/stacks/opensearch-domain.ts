import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as cognitoIdp from "@aws-cdk/aws-cognito-identitypool-alpha";

export class OpensearchDomainStack extends cdk.Stack {
  public readonly opensearchDomain: opensearch.IDomain;
  public readonly ingestionPipelineRole: iam.IRole;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "open-search-dashboard-user-pool",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool,
      cognitoDomain: {
        domainPrefix: "yamatatsu-opensearch-dashboard",
      },
    });

    const idPool = new cognitoIdp.IdentityPool(this, "IdentityPool", {
      identityPoolName: "open-search-dashboard-idp",
      allowUnauthenticatedIdentities: true,
      authenticationProviders: {
        userPools: [
          new cognitoIdp.UserPoolAuthenticationProvider({ userPool }),
        ],
      },
    });

    const dashboardRole = new iam.Role(this, "DashboardRole", {
      assumedBy: new iam.ServicePrincipal("opensearchservice.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonOpenSearchServiceCognitoAccess",
        ),
      ],
    });

    const domain = new opensearch.Domain(this, "Domain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,

      // for production
      // capacity: {
      //   multiAzWithStandbyEnabled: true,
      //   dataNodes: 3,
      //   dataNodeInstanceType: "m6g.large.search",
      //   masterNodes: 3,
      //   masterNodeInstanceType: "r6g.large.search",
      // },
      // ebs: {
      //   enabled: true,
      //   volumeSize: 300,
      //   volumeType: ec2.EbsDeviceVolumeType.GP3,
      // },
      // zoneAwareness: {
      //   enabled: true,
      //   availabilityZoneCount: 3,
      // },

      // for hobby
      capacity: {
        multiAzWithStandbyEnabled: false,
      },

      cognitoDashboardsAuth: {
        userPoolId: userPool.userPoolId,
        identityPoolId: idPool.identityPoolId,
        role: dashboardRole,
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      enforceHttps: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html
     */
    const ingestionPipelineRole = new iam.Role(this, "IngestionRole", {
      assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com", {
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
          ArnLike: {
            "aws:SourceArn": this.formatArn({
              service: "osis",
              resource: "pipeline",
              resourceName: "*",
            }),
          },
        },
      }),
      inlinePolicies: {
        ingestionPipeline: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["es:DescribeDomain"],
              resources: [domain.domainArn],
            }),
            new iam.PolicyStatement({
              actions: ["es:ESHttp*"],
              resources: [`${domain.domainArn}/*`],
            }),
          ],
        }),
      },
    });

    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html#pipeline-access-domain
     */
    domain.addAccessPolicies(
      new iam.PolicyStatement({
        principals: [ingestionPipelineRole],
        actions: ["es:DescribeDomain", "es:ESHttp*"],
        resources: [`${domain.domainArn}/*`],
      }),
    );

    idPool.authenticatedRole.attachInlinePolicy(
      new iam.Policy(this, "IdpAuthenticatedPolicy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [domain.domainArn + "/*"],
            actions: ["es:*"],
          }),
        ],
      }),
    );

    this.opensearchDomain = domain;
    this.ingestionPipelineRole = ingestionPipelineRole;
  }
}
