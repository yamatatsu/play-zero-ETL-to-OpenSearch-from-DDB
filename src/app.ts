import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";
import { PrerequisiteStack } from "./stacks/prerequisite";

const app = new cdk.App();

const { productCatalogTable } = new PrerequisiteStack(
  app,
  "DynamoDB2OpenSearchPrerequisite",
);

const stack = new cdk.Stack(app, "DynamoDB2OpenSearch");

const domain = new opensearch.Domain(stack, "Domain", {
  version: opensearch.EngineVersion.OPENSEARCH_2_11,
  capacity: {
    multiAzWithStandbyEnabled: false,
  },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const bucket = new s3.Bucket(stack, "Bucket", {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  autoDeleteObjects: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const pipelineRole = new iam.Role(stack, "IngestionRole", {
  assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
  inlinePolicies: {
    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html#pipeline-access-configure
     */
    ingestionPipeline: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ["es:DescribeDomain"],
          resources: [domain.domainArn],
        }),
        new iam.PolicyStatement({
          actions: ["es:ESHttp*"],
          resources: [`${domain.domainArn}/*`],
          // conditions: {
          //   StringEquals: {
          //     "aws:SourceAccount": stack.account,
          //   },
          //   ArnLike: {
          //     "aws:SourceArn": stack.formatArn({
          //       service: "osis",
          //       resource: "pipeline",
          //       resourceName: "*",
          //     }),
          //   },
          // },
        }),
      ],
    }),
    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/configure-client-ddb.html#ddb-pipeline-role
     */
    dynamodbIngestion: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "allowRunExportJob",
          actions: [
            "dynamodb:DescribeTable",
            "dynamodb:DescribeContinuousBackups",
            "dynamodb:ExportTableToPointInTime",
          ],
          resources: [productCatalogTable.tableArn + ""],
        }),
        new iam.PolicyStatement({
          sid: "allowCheckExportjob",
          actions: ["dynamodb:DescribeExport"],
          resources: [productCatalogTable.tableArn + "/export/*"],
        }),
        new iam.PolicyStatement({
          sid: "allowReadFromStream",
          actions: [
            "dynamodb:DescribeStream",
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
          ],
          resources: [productCatalogTable.tableArn + "/stream/*"],
        }),
        new iam.PolicyStatement({
          sid: "allowReadAndWriteToS3ForExport",
          actions: [
            "s3:GetObject",
            "s3:AbortMultipartUpload",
            "s3:PutObject",
            "s3:PutObjectAcl",
          ],
          resources: [bucket.bucketArn + "/*"],
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
    principals: [pipelineRole],
    actions: ["es:DescribeDomain", "es:ESHttp*"],
    resources: [`${domain.domainArn}/*`],
  }),
);

new osis.CfnPipeline(stack, "OSISPipeline", {
  pipelineName: "osis-pipeline",
  minUnits: 1,
  maxUnits: 4,
  pipelineConfigurationBody: /* yaml */ `

    version: "2"
    dynamodb-pipeline:
      source:
        dynamodb:
          acknowledgments: true
          tables:
            # REQUIRED: Supply the DynamoDB table ARN and whether export or stream processing is needed, or both
            - table_arn: ${productCatalogTable.tableArn}
              # Remove the stream block if only export is needed
              stream:
                start_position: LATEST # TRIM_HORIZON does not work now. It will make pipeline unstable and cannot be deployed.
              # Remove the export block if only stream is needed
              export:
                # REQUIRED for export: Specify the name of an existing S3 bucket for DynamoDB to write export data files to
                s3_bucket: ${bucket.bucketName}
                # Specify the region of the S3 bucket
                s3_region: ${stack.region}
                # Optionally set the name of a prefix that DynamoDB export data files are written to in the bucket.
                s3_prefix: "table-index-1/"
          aws:
            # REQUIRED: Provide the role to assume that has the necessary permissions to DynamoDB, OpenSearch, and S3.
            sts_role_arn: ${pipelineRole.roleArn}
            # Provide the region to use for aws credentials
            region: ${stack.region}
      sink:
        - opensearch:
            # REQUIRED: Provide an AWS OpenSearch endpoint
            hosts:
              - https://${domain.domainEndpoint}
            index: table-index-1
            index_type: custom
            document_id: \${getMetadata("primary_key")}
            action: \${getMetadata("opensearch_action")}
            document_version: \${getMetadata("document_version")}
            document_version_type: external
            aws:
              # REQUIRED: Provide a Role ARN with access to the domain. This role should have a trust relationship with osis-pipelines.amazonaws.com
              sts_role_arn: ${pipelineRole.roleArn}
              # Provide the region of the domain.
              region: ${stack.region}
              # Enable the 'serverless' flag if the sink is an Amazon OpenSearch Serverless collection
              # serverless: true
              # serverless_options:
                # Specify a name here to create or update network policy for the serverless collection
                # network_policy_name: "network-policy-name"
            # Enable the S3 DLQ to capture any failed requests in an S3 bucket. This is recommended as a best practice for all pipelines.
            # dlq:
              # s3:
                # Provide an S3 bucket
                # bucket: "your-dlq-bucket-name"
                # Provide a key path prefix for the failed requests
                # key_path_prefix: "dynamodb-pipeline/dlq"
                # Provide the region of the bucket.
                # region: "us-east-1"
                # Provide a Role ARN with access to the bucket. This role should have a trust relationship with osis-pipelines.amazonaws.com
                # sts_role_arn: "arn:aws:iam::123456789012:role/Example-Role"

  `,
});
